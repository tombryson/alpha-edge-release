import { test, expect } from '@playwright/test';
import {
    baselinePortfolio,
    buildDayAfterPortfolio,
    buildPortfolioFromTargetWeights,
    buildStatementImportPayload,
} from './fixtures/portfolio-states';
import {
    acceptOverlayBaseline,
    applyStage1Plan,
    apiBaseUrl,
    buildStage1PlanFromSummary,
    completeStage2,
    getOverlaySummary,
    importStatement,
    markSignalReviewed,
    postQ1Signal,
    postQ4Signal,
    postJson,
    saveStage2Targets,
} from './helpers/overlay-api';
import { resetLocalUatDatabaseIfConfigured } from './helpers/local-db';
import { reconcilePortfolioAgainstStage1Sources } from './helpers/portfolio-diff';
import {
    approvePortfolioRebalance,
    assertUatSafety,
    buildManualPortfolioTargetRows,
    buildRecordedDecreaseRows,
    completePortfolioRebalance,
    createPortfolioRebalance,
    getCurrentPortfolioAdjustmentPlan,
    getCurrentPortfolioMix,
    targetWeightsFromAdjustmentPlan,
} from './helpers/action-workflows';

const nowPlus = (minutes: number): Date =>
    new Date(Date.now() + minutes * 60 * 1000);

const stage2Targets = [
    { asset_class: 'ENERGY', target_pct: 20 },
    { asset_class: 'INSURANCE', target_pct: 10 },
    { asset_class: 'STAPLES', target_pct: 8 },
    { asset_class: 'HEALTHCARE', target_pct: 6 },
];

const resetAndImportBaseline = async ({ request }: { request: any }) => {
    assertUatSafety();
    resetLocalUatDatabaseIfConfigured();
    await importStatement(
        request,
        buildStatementImportPayload(baselinePortfolio, nowPlus(-30)),
    );
};

const applyCurrentRiskReduction = async (request: any) => {
    const summary = await getOverlaySummary(request);
    expect(Number(summary.required_de_risk_value || 0)).toBeGreaterThan(0);

    const plan = buildStage1PlanFromSummary(summary);
    const tolerance = Math.max(1000, plan.requiredReduction * 0.05);
    expect(
        Math.abs(plan.recordedReduction - plan.requiredReduction),
        'generated position reductions must fill the required move within tolerance',
    ).toBeLessThanOrEqual(tolerance);

    await applyStage1Plan(request, plan);
    return plan;
};

const finaliseRiskWorkflowAfterCorrectStatement = async (
    request: any,
    plan: ReturnType<typeof buildStage1PlanFromSummary>,
) => {
    const dayAfter = buildDayAfterPortfolio({
        cashAud: plan.expectedReserve,
        mode: 'success',
        sources: plan.sources,
    });

    await importStatement(
        request,
        buildStatementImportPayload(dayAfter, nowPlus(5)),
    );

    const confirmed = await getOverlaySummary(request);
    expect(confirmed.cash_confirmation_status).toBe('CONFIRMED');
    expect(Math.abs(Number(confirmed.reserve_variance || 0))).toBeLessThanOrEqual(
        1,
    );

    await saveStage2Targets(request, stage2Targets);
    await completeStage2(request);
    const completed = await getOverlaySummary(request);
    expect(completed.active_event_status).toBe('STAGE2_DONE');

    const baselined = (await acceptOverlayBaseline(request)) as {
        status?: string;
        q1_exposure_pct?: number;
        last_applied_q1_exposure_pct?: number;
    };
    expect(baselined.status).toBe('baseline_set');
    expect(Number(baselined.last_applied_q1_exposure_pct)).toBeCloseTo(
        Number(baselined.q1_exposure_pct),
        2,
    );
};

test.describe('UAT action workflows', () => {
    test.skip(
        process.env.UAT_ACTION_WORKFLOW_TEST !== '1',
        'destructive action workflow tests require UAT_ACTION_WORKFLOW_TEST=1',
    );

    test.beforeEach(resetAndImportBaseline);

    test('Q3 100 -> 30 reduction completes through correct statement and baseline', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPY', 100);
        await postQ1Signal(request, 'XAO', 100);
        await postQ1Signal(request, 'SPY', 30);

        const summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.mode).toBe('Q3_THROTTLE');
        expect(summary.portfolio_risk?.target_kind).toBe('Q1_EXPOSURE');
        expect(Number(summary.active_event_from_q1_exposure_pct)).toBe(100);
        expect(Number(summary.active_event_to_q1_exposure_pct)).toBe(30);

        const plan = await applyCurrentRiskReduction(request);
        await finaliseRiskWorkflowAfterCorrectStatement(request, plan);
    });

    test('Q3 reduction flags an incorrect statement with no reductions', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPY', 30);
        const plan = await applyCurrentRiskReduction(request);

        const dayAfter = buildDayAfterPortfolio({
            cashAud: plan.baselineReserve,
            mode: 'no-reduction',
            sources: plan.sources,
        });
        await importStatement(
            request,
            buildStatementImportPayload(dayAfter, nowPlus(5)),
        );

        const summary = await getOverlaySummary(request);
        expect(summary.cash_confirmation_status).toBe('VARIANCE');
        expect(Number(summary.reserve_variance || 0)).toBeLessThan(0);
    });

    test('Q3 reduction detects wrong holdings even when cash arrives', async ({
        request,
    }, testInfo) => {
        await postQ1Signal(request, 'SPY', 30);
        const plan = await applyCurrentRiskReduction(request);

        const dayAfter = buildDayAfterPortfolio({
            cashAud: plan.expectedReserve,
            mode: 'wrong-holdings',
            sources: plan.sources,
        });
        await importStatement(
            request,
            buildStatementImportPayload(dayAfter, nowPlus(5)),
        );

        const summary = await getOverlaySummary(request);
        const diff = reconcilePortfolioAgainstStage1Sources({
            actual: dayAfter,
            baseline: baselinePortfolio,
            expectedCashAud: plan.expectedReserve,
            sources: plan.sources,
        });

        await testInfo.attach('q3-wrong-holdings-diff.json', {
            body: JSON.stringify(diff, null, 2),
            contentType: 'application/json',
        });

        expect(summary.cash_confirmation_status).toBe('CONFIRMED');
        expect(diff.discrepancies.length).toBeGreaterThan(0);
    });

    test('Q4 crisis follows the same reduction workflow and then clears', async ({
        request,
    }) => {
        await postQ4Signal(request, 'SELL');

        const summary = await getOverlaySummary(request);
        expect(summary.q4_crisis?.active).toBe(true);
        expect(summary.portfolio_risk?.mode).toBe('Q4_CRISIS');
        expect(summary.portfolio_risk?.priority).toBe(2);
        expect(summary.portfolio_risk?.target_pct).toBe(10);
        expect(summary.portfolio_risk?.target_kind).toBe('MARKET_EXPOSURE');

        const plan = await applyCurrentRiskReduction(request);
        await finaliseRiskWorkflowAfterCorrectStatement(request, plan);

        await postQ4Signal(request, 'BUY');
        const cleared = await getOverlaySummary(request);
        expect(cleared.q4_crisis?.active).toBe(false);
        expect(cleared.portfolio_risk?.mode).not.toBe('Q4_CRISIS');
    });

    test('Q4 outranks Q3 while still retaining the Q3 input state', async ({
        request,
    }) => {
        await postQ4Signal(request, 'SELL');
        await postQ1Signal(request, 'SPY', 30);

        const summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.mode).toBe('Q4_CRISIS');
        expect(summary.portfolio_risk?.target_pct).toBe(10);
        expect(summary.portfolio_risk?.inputs?.q3?.active).toBe(true);
        expect(summary.portfolio_risk?.inputs?.q3?.effective_target_pct).toBe(30);
    });

    test('Q3 30 -> 80 creates allocation-available action instead of a forced buy', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPY', 30);
        const plan = await applyCurrentRiskReduction(request);
        await finaliseRiskWorkflowAfterCorrectStatement(request, plan);

        await postQ1Signal(request, 'SPY', 80);
        const summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.mode).toBe('Q3_THROTTLE');
        expect(summary.portfolio_risk?.target_pct).toBe(80);
        expect(Number(summary.required_de_risk_value || 0)).toBe(0);
        expect(Number(summary.available_headroom_value || 0)).toBeGreaterThan(0);
        expect(Number(summary.active_event_from_q1_exposure_pct)).toBe(30);
        expect(Number(summary.active_event_to_q1_exposure_pct)).toBe(80);

        const reviewed = (await markSignalReviewed(request)) as {
            status?: string;
            q1_exposure_pct?: number;
            last_applied_q1_exposure_pct?: number;
        };
        expect(reviewed.status).toBe('signal_reviewed');
        expect(Number(reviewed.q1_exposure_pct)).toBe(80);
        expect(Number(reviewed.last_applied_q1_exposure_pct)).toBe(80);

        const afterReview = await getOverlaySummary(request);
        expect(Number(afterReview.last_applied_q1_exposure_pct)).toBe(80);
        expect(Number(afterReview.available_headroom_value || 0)).toBe(0);
    });

    test('manual portfolio target completes, validates a matching statement, and approves baseline', async ({
        request,
    }) => {
        const mix = await getCurrentPortfolioMix(request);
        const targetRows = buildManualPortfolioTargetRows(mix);
        const plan = await createPortfolioRebalance(request, targetRows);
        const adjustment = await getCurrentPortfolioAdjustmentPlan(request);

        expect(adjustment.required_decrease_value).toBeGreaterThan(0);
        expect(adjustment.required_increase_value).toBeGreaterThan(0);
        expect(adjustment.ready_to_confirm).toBe(false);
        expect(adjustment.rows.some((row) => row.direction === 'decrease')).toBe(true);
        expect(adjustment.rows.some((row) => row.direction === 'increase')).toBe(true);

        const recordedRows = buildRecordedDecreaseRows(adjustment);
        await completePortfolioRebalance(request, plan.id, recordedRows);

        const locked = await getCurrentPortfolioAdjustmentPlan(request);
        expect(locked.stage).toBe('confirm_statement');
        expect(locked.status).toMatch(/AWAITING_STATEMENT|VARIANCE/);

        const targetPortfolio = buildPortfolioFromTargetWeights({
            targetWeights: targetWeightsFromAdjustmentPlan(locked),
        });
        await importStatement(
            request,
            buildStatementImportPayload(targetPortfolio, nowPlus(5)),
        );

        const matched = await getCurrentPortfolioAdjustmentPlan(request);
        expect(matched.import_validation?.passed).toBe(true);
        expect(matched.import_validation?.variance_rows).toBe(0);

        const approved = (await approvePortfolioRebalance(request, plan.id)) as {
            snapshot?: { status?: string };
            rows?: unknown[];
        };
        expect(approved.snapshot?.status).toBe('APPROVED');
        expect(approved.rows?.length || 0).toBeGreaterThan(0);
    });

    test('manual portfolio target reports statement variance before baseline approval', async ({
        request,
    }) => {
        const mix = await getCurrentPortfolioMix(request);
        const targetRows = buildManualPortfolioTargetRows(mix);
        const plan = await createPortfolioRebalance(request, targetRows);
        const adjustment = await getCurrentPortfolioAdjustmentPlan(request);

        await completePortfolioRebalance(
            request,
            plan.id,
            buildRecordedDecreaseRows(adjustment),
        );
        await importStatement(
            request,
            buildStatementImportPayload(baselinePortfolio, nowPlus(5)),
        );

        const variance = await getCurrentPortfolioAdjustmentPlan(request);
        expect(variance.stage).toBe('confirm_statement');
        expect(variance.status).toBe('VARIANCE');
        expect(variance.import_validation?.passed).toBe(false);
        expect(Number(variance.import_validation?.variance_rows || 0)).toBeGreaterThan(
            0,
        );
    });

    test('manual portfolio target cannot be approved before position actions complete', async ({
        request,
    }) => {
        const mix = await getCurrentPortfolioMix(request);
        const targetRows = buildManualPortfolioTargetRows(mix);
        const plan = await createPortfolioRebalance(request, targetRows);

        const response = await request.post(
            `${apiBaseUrl}/portfolio-rebalances/${plan.id}/approve`,
        );
        expect(response.ok()).toBe(false);
        expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('positions UI exposes Q4 as Portfolio Risk action', async ({
        request,
        page,
    }) => {
        await postQ4Signal(request, 'SELL');
        await postJson(request, '/sync/changes/acknowledge', { change_ids: [] });

        await page.goto('/');
        await page.getByRole('button', { name: 'POSITIONS' }).click();
        await page.getByRole('button', { name: /ACTIONS/ }).click();
        await expect(page.getByRole('navigation', { name: 'Choose portfolio action' })).toBeVisible();
        await expect(page.getByText('Q4 Crisis').first()).toBeVisible();
        await expect(page.getByText('Portfolio Risk').first()).toBeVisible();
    });
});
