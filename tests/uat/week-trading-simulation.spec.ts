import { test, expect, type APIRequestContext } from '@playwright/test';
import {
    baselinePortfolio,
    buildDayAfterPortfolio,
    buildPortfolioFromTargetWeightsWithAdditions,
    buildPortfolioWithMarketMoves,
    buildPortfolioWithValueAdjustments,
    buildStatementImportPayload,
    portfolioInvestedValue,
    portfolioTotalValue,
    type StatementPortfolioFixture,
} from './fixtures/portfolio-states';
import {
    acceptOverlayBaseline,
    applyStage1Plan,
    buildStage1PlanFromSummary,
    completeStage2,
    getOverlaySummary,
    importStatement,
    postQ1Signal,
    postQ4Signal,
    saveStage2Targets,
    type Stage1Plan,
} from './helpers/overlay-api';
import { resetLocalUatDatabaseIfConfigured } from './helpers/local-db';
import {
    approvePortfolioRebalance,
    assertUatSafety,
    buildRecordedDecreaseRows,
    completePortfolioRebalance,
    createPortfolioRebalance,
    getCurrentPortfolioAdjustmentPlan,
    getCurrentPortfolioMix,
    targetWeightsFromAdjustmentPlan,
    type PortfolioMixResponse,
    type PortfolioRebalancePlanRow,
} from './helpers/action-workflows';
import {
    approveCurrentPortfolioMix,
    bulkMapCompanies,
    expectSecurityState,
    postTradingViewSignal,
    recordDecision,
    setAnalysisSecurityType,
    waitForAlert,
} from './helpers/trading-simulation';

const weekDate = (day: number, hour = 9): Date =>
    new Date(Date.UTC(2026, 4, 18 + day, hour, 0, 0));

const q3RedistributionTargets = [
    { asset_class: 'ENERGY', target_pct: 20 },
    { asset_class: 'INSURANCE', target_pct: 10 },
    { asset_class: 'STAPLES', target_pct: 8 },
    { asset_class: 'HEALTHCARE', target_pct: 6 },
];

const newPositionTemplates = [
    {
        details: 'UAT Bond Income Fund',
        isin: 'UAT0101',
        assetClass: 'BONDS',
        current_price: 10,
    },
    {
        details: 'UAT Broad Equity ETF',
        isin: 'UAT0102',
        assetClass: 'BROAD_EQUITY',
        current_price: 25,
    },
];

const resetAndImportBaseline = async (request: APIRequestContext) => {
    assertUatSafety();
    resetLocalUatDatabaseIfConfigured();
    await importStatement(
        request,
        buildStatementImportPayload(baselinePortfolio, weekDate(0)),
    );
    await postQ1Signal(request, 'SPX', 100);
    await postQ1Signal(request, 'XAO', 100);
    await approveCurrentPortfolioMix(request, 'UAT_INITIAL_BASELINE');
};

const applyCurrentRiskReduction = async (
    request: APIRequestContext,
): Promise<Stage1Plan> => {
    const summary = await getOverlaySummary(request);
    expect(Number(summary.required_de_risk_value || 0)).toBeGreaterThan(0);

    const plan = buildStage1PlanFromSummary(summary);
    const tolerance = Math.max(1000, plan.requiredReduction * 0.05);
    expect(
        Math.abs(plan.recordedReduction - plan.requiredReduction),
        'generated reductions must fill the current Portfolio Risk action within tolerance',
    ).toBeLessThanOrEqual(tolerance);

    await applyStage1Plan(request, plan);
    return plan;
};

const completeRiskWorkflowWithStatement = async ({
    request,
    base,
    plan,
    statementDate,
}: {
    request: APIRequestContext;
    base: StatementPortfolioFixture;
    plan: Stage1Plan;
    statementDate: Date;
}): Promise<StatementPortfolioFixture> => {
    const afterAction = buildDayAfterPortfolio({
        base,
        cashAud: plan.expectedReserve,
        mode: 'success',
        sources: plan.sources,
    });

    await importStatement(
        request,
        buildStatementImportPayload(afterAction, statementDate),
    );

    const confirmed = await getOverlaySummary(request);
    expect(confirmed.cash_confirmation_status).toBe('CONFIRMED');
    expect(Math.abs(Number(confirmed.reserve_variance || 0))).toBeLessThanOrEqual(
        1,
    );

    await saveStage2Targets(request, q3RedistributionTargets);
    await completeStage2(request);
    const completed = await getOverlaySummary(request);
    expect(completed.active_event_status).toBe('STAGE2_DONE');

    const baseline = (await acceptOverlayBaseline(request)) as {
        status?: string;
    };
    expect(baseline.status).toBe('baseline_set');

    return afterAction;
};

const addCompensatingPositionSetup = async (request: APIRequestContext) => {
    await bulkMapCompanies(request, [
        {
            company_name: 'UAT Bond Income Fund',
            ticker: 'BOND1',
            exchange_prefix: 'ASX:',
        },
        {
            company_name: 'UAT Broad Equity ETF',
            ticker: 'BROAD1',
            exchange_prefix: 'ASX:',
        },
    ]);

    await setAnalysisSecurityType(request, {
        name: 'UAT Bond Income Fund',
        ticker: 'ASX:BOND1',
        security_type: 'FUND',
        primary_asset_class: 'BONDS',
    });
    await setAnalysisSecurityType(request, {
        name: 'UAT Broad Equity ETF',
        ticker: 'ASX:BROAD1',
        security_type: 'ETF',
        primary_asset_class: 'BROAD_EQUITY',
    });
};

const ensureTargetRow = (
    rows: PortfolioRebalancePlanRow[],
    row: {
        asset_class: string;
        display_name: string;
        display_order: number;
        governed_by_q1: boolean;
    },
): PortfolioRebalancePlanRow => {
    let existing = rows.find((item) => item.asset_class === row.asset_class);
    if (!existing) {
        existing = {
            ...row,
            current_weight_pct: 0,
            target_weight_pct: 0,
            delta_weight_pct: 0,
            note: '',
        };
        rows.push(existing);
    }
    return existing;
};

const moveTarget = (
    rows: PortfolioRebalancePlanRow[],
    assetClass: string,
    deltaPct: number,
) => {
    const row = rows.find((item) => item.asset_class === assetClass);
    expect(row, `missing ${assetClass} target row`).toBeTruthy();
    row!.target_weight_pct = Math.max(
        0,
        Math.round((row!.target_weight_pct + deltaPct) * 1000) / 1000,
    );
    row!.delta_weight_pct =
        Math.round((row!.target_weight_pct - row!.current_weight_pct) * 1000) /
        1000;
};

const setTarget = (
    rows: PortfolioRebalancePlanRow[],
    assetClass: string,
    targetPct: number,
) => {
    const row = rows.find((item) => item.asset_class === assetClass);
    expect(row, `missing ${assetClass} target row`).toBeTruthy();
    row!.target_weight_pct = Math.max(0, Math.round(targetPct * 1000) / 1000);
    row!.delta_weight_pct =
        Math.round((row!.target_weight_pct - row!.current_weight_pct) * 1000) /
        1000;
};

const buildCompensatingTargetRows = (
    mix: PortfolioMixResponse,
): PortfolioRebalancePlanRow[] => {
    const rows = mix.rows.map((row) => ({
        asset_class: row.asset_class,
        display_name: row.display_name || row.asset_class,
        display_order: row.display_order,
        governed_by_q1: row.governed_by_q1,
        current_weight_pct: row.weight_pct || 0,
        target_weight_pct: row.weight_pct || 0,
        delta_weight_pct: 0,
        note: '',
    }));

    ensureTargetRow(rows, {
        asset_class: 'BONDS',
        display_name: 'Bonds',
        display_order: 150,
        governed_by_q1: false,
    });
    ensureTargetRow(rows, {
        asset_class: 'BROAD_EQUITY',
        display_name: 'Broad Equity',
        display_order: 1010,
        governed_by_q1: true,
    });
    ensureTargetRow(rows, {
        asset_class: 'CASH',
        display_name: 'Cash/Reserve',
        display_order: 10000,
        governed_by_q1: false,
    });

    moveTarget(rows, 'GOLD', -4);
    moveTarget(rows, 'TECHNOLOGY', -4);
    moveTarget(rows, 'ENERGY', -2);
    setTarget(rows, 'BONDS', 6);
    setTarget(rows, 'BROAD_EQUITY', 2);
    moveTarget(rows, 'CASH', 2);

    const totalTarget =
        Math.round(
            rows.reduce((sum, row) => sum + row.target_weight_pct, 0) * 1000,
        ) / 1000;
    const cash = rows.find((row) => row.asset_class === 'CASH');
    expect(cash).toBeTruthy();
    cash!.target_weight_pct =
        Math.round((cash!.target_weight_pct + (100 - totalTarget)) * 1000) /
        1000;
    cash!.delta_weight_pct =
        Math.round((cash!.target_weight_pct - cash!.current_weight_pct) * 1000) /
        1000;

    return rows;
};

const recordPortfolioCheckpoint = (
    timeline: unknown[],
    label: string,
    portfolio: StatementPortfolioFixture,
) => {
    timeline.push({
        label,
        cash: portfolio.cashAud,
        invested: portfolioInvestedValue(portfolio),
        total: portfolioTotalValue(portfolio),
        holdings: portfolio.holdings.length,
    });
};

test.describe('UAT one-week trading simulation', () => {
    test.skip(
        process.env.UAT_WEEK_SIMULATION_TEST !== '1',
        'destructive week simulation requires UAT_WEEK_SIMULATION_TEST=1',
    );

    test.beforeEach(async ({ request }) => {
        await resetAndImportBaseline(request);
    });

    test('walks alerts, daily statements, Q3 risk-off, portfolio target adds, and Q4 liquidation', async ({
        request,
    }, testInfo) => {
        const timeline: unknown[] = [];
        recordPortfolioCheckpoint(timeline, 'day 0 baseline', baselinePortfolio);

        await postTradingViewSignal(request, {
            ticker: 'ASX:GOLD1',
            signal: 'sell',
            script: 'cdf',
            close: 17.4,
        });
        await expectSecurityState(request, 'GOLD1', 'SELL');

        await postTradingViewSignal(request, {
            ticker: 'ASX:SILV1',
            signal: 'connect',
            script: 'tms',
        });
        await postTradingViewSignal(request, {
            ticker: 'ASX:SILV1',
            signal: 'cdf_sell_zone',
            script: 'tms',
        });
        const silverSellDown = await waitForAlert(
            request,
            (alert) =>
                alert.ticker === 'SILV1' &&
                alert.alert_type === 'SELL_DOWN' &&
                alert.source === 'tms',
        );
        await recordDecision(
            request,
            silverSellDown,
            'SELL_DOWN',
            'Week simulation trims silver after TMS sell-down.',
        );

        await postTradingViewSignal(request, {
            ticker: 'ASX:ENRG1',
            signal: 'connect',
            script: 'tms',
        });
        await postTradingViewSignal(request, {
            ticker: 'ASX:ENRG1',
            signal: 'add',
            script: 'tms',
        });
        const energyAdd = await waitForAlert(
            request,
            (alert) =>
                alert.ticker === 'ENRG1' &&
                alert.alert_type === 'ADD' &&
                alert.source === 'tms',
        );
        await recordDecision(
            request,
            energyAdd,
            'ADD',
            'Week simulation adds to energy after TMS add.',
        );

        await postTradingViewSignal(request, {
            ticker: 'ASX:TECH1',
            signal: 'breakout',
            script: 'cdf',
        });
        const techBreakout = await waitForAlert(
            request,
            (alert) =>
                alert.ticker === 'TECH1' &&
                alert.alert_type === 'BREAKOUT' &&
                alert.source === 'cdf',
        );
        await recordDecision(
            request,
            techBreakout,
            'BUY',
            'Week simulation accepts technology breakout.',
        );
        await expectSecurityState(request, 'TECH1', 'BUY');

        const day1Redistributed = buildPortfolioWithValueAdjustments({
            base: baselinePortfolio,
            adjustments: [
                { details: 'UAT Silver Producer', deltaValue: -2200 },
                { details: 'UAT Energy Producer', deltaValue: 1300 },
                { details: 'UAT Commercial Pharma', deltaValue: 900 },
            ],
        });
        await importStatement(
            request,
            buildStatementImportPayload(day1Redistributed, weekDate(1)),
        );
        recordPortfolioCheckpoint(
            timeline,
            'day 1 statement after trim/add redistribution',
            day1Redistributed,
        );

        const day2Marked = buildPortfolioWithMarketMoves({
            base: day1Redistributed,
            cashAud: day1Redistributed.cashAud + 2200,
            moves: [
                { details: 'UAT Gold Producer', movePct: -5 },
                { details: 'UAT Data Centre Operator', movePct: 4 },
                { details: 'UAT Energy Producer', movePct: 3 },
                { details: 'UAT Commercial Pharma', movePct: 2 },
            ],
        });
        await importStatement(
            request,
            buildStatementImportPayload(day2Marked, weekDate(2)),
        );
        recordPortfolioCheckpoint(
            timeline,
            'day 2 statement after price moves and new cash',
            day2Marked,
        );

        await postQ1Signal(request, 'SPX', 35);
        const q3Summary = await getOverlaySummary(request);
        expect(q3Summary.portfolio_risk?.mode).toBe('Q3_THROTTLE');
        expect(q3Summary.portfolio_risk?.target_pct).toBe(35);
        expect(Number(q3Summary.active_event_from_q1_exposure_pct)).toBe(100);
        expect(Number(q3Summary.active_event_to_q1_exposure_pct)).toBe(35);

        const q3Plan = await applyCurrentRiskReduction(request);
        const postQ3Statement = await completeRiskWorkflowWithStatement({
            request,
            base: day2Marked,
            plan: q3Plan,
            statementDate: weekDate(3),
        });
        recordPortfolioCheckpoint(
            timeline,
            'day 3 statement after Q3 reduction',
            postQ3Statement,
        );

        await addCompensatingPositionSetup(request);
        const mix = await getCurrentPortfolioMix(request);
        const targetRows = buildCompensatingTargetRows(mix);
        const rebalance = await createPortfolioRebalance(request, targetRows);
        const adjustment = await getCurrentPortfolioAdjustmentPlan(request);
        expect(adjustment.required_decrease_value).toBeGreaterThan(0);
        expect(adjustment.required_increase_value).toBeGreaterThan(0);
        expect(adjustment.rows.some((row) => row.key === 'BONDS')).toBe(true);
        expect(adjustment.rows.some((row) => row.key === 'BROAD_EQUITY')).toBe(
            true,
        );

        await completePortfolioRebalance(
            request,
            rebalance.id,
            buildRecordedDecreaseRows(adjustment),
        );
        const lockedTarget = await getCurrentPortfolioAdjustmentPlan(request);
        expect(lockedTarget.stage).toBe('confirm_statement');

        const targetPortfolio = buildPortfolioFromTargetWeightsWithAdditions({
            base: postQ3Statement,
            targetWeights: targetWeightsFromAdjustmentPlan(lockedTarget),
            newHoldingTemplates: newPositionTemplates,
        });
        await importStatement(
            request,
            buildStatementImportPayload(targetPortfolio, weekDate(4)),
        );
        recordPortfolioCheckpoint(
            timeline,
            'day 4 statement after target rebalance and new positions',
            targetPortfolio,
        );

        const matchedTarget = await getCurrentPortfolioAdjustmentPlan(request);
        expect(matchedTarget.import_validation?.passed).toBe(true);
        const approved = (await approvePortfolioRebalance(
            request,
            rebalance.id,
        )) as { snapshot?: { status?: string }; rows?: unknown[] };
        expect(approved.snapshot?.status).toBe('APPROVED');
        expect(approved.rows?.length || 0).toBeGreaterThan(0);

        await postQ4Signal(request, 'SELL');
        const q4Summary = await getOverlaySummary(request);
        expect(q4Summary.q4_crisis?.active).toBe(true);
        expect(q4Summary.portfolio_risk?.mode).toBe('Q4_CRISIS');
        expect(q4Summary.portfolio_risk?.target_pct).toBe(10);
        expect(q4Summary.portfolio_risk?.inputs?.q3?.effective_target_pct).toBe(
            35,
        );

        const q4Plan = await applyCurrentRiskReduction(request);
        const postQ4Statement = await completeRiskWorkflowWithStatement({
            request,
            base: targetPortfolio,
            plan: q4Plan,
            statementDate: weekDate(5),
        });
        recordPortfolioCheckpoint(
            timeline,
            'day 5 statement after Q4 liquidation',
            postQ4Statement,
        );

        const finalMarketExposure =
            (portfolioInvestedValue(postQ4Statement) /
                portfolioTotalValue(postQ4Statement)) *
            100;
        expect(finalMarketExposure).toBeLessThanOrEqual(12);

        await testInfo.attach('week-trading-simulation-timeline.json', {
            body: JSON.stringify(timeline, null, 2),
            contentType: 'application/json',
        });
    });
});
