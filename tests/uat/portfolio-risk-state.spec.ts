import { test, expect } from '@playwright/test';
import {
    baselinePortfolio,
    buildDayAfterPortfolio,
    buildStatementImportPayload,
} from './fixtures/portfolio-states';
import { resetLocalUatDatabaseIfConfigured } from './helpers/local-db';
import {
    acceptOverlayBaseline,
    applyStage1Plan,
    buildStage1PlanFromSummary,
    completeStage2,
    getOverlaySummary,
    importStatement,
    markSignalReviewed,
    postQ1Signal,
    postQ4Signal,
    saveStage2Targets,
} from './helpers/overlay-api';
import { assertUatSafety } from './helpers/action-workflows';

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

const completeCurrentRiskReduction = async (request: any) => {
    const summary = await getOverlaySummary(request);
    const plan = buildStage1PlanFromSummary(summary);
    await applyStage1Plan(request, plan);
    await importStatement(
        request,
        buildStatementImportPayload(
            buildDayAfterPortfolio({
                cashAud: plan.expectedReserve,
                mode: 'success',
                sources: plan.sources,
            }),
            nowPlus(5),
        ),
    );
    await expect
        .poll(async () => (await getOverlaySummary(request)).cash_confirmation_status, {
            timeout: 20_000,
        })
        .toBe('CONFIRMED');
    await saveStage2Targets(request, stage2Targets);
    await completeStage2(request);
    await acceptOverlayBaseline(request);
};

test.describe('UAT portfolio risk state semantics', () => {
    test.skip(
        process.env.UAT_PORTFOLIO_RISK_STATE_TEST !== '1',
        'destructive portfolio risk state tests require UAT_PORTFOLIO_RISK_STATE_TEST=1',
    );

    test.beforeEach(resetAndImportBaseline);

    test('Q4 resolves above Q3 while accepting Q3 changes before, during, and after crisis', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPX', 35);
        await expect
            .poll(async () => (await getOverlaySummary(request)).portfolio_risk?.mode, {
                timeout: 20_000,
            })
            .toBe('Q3_THROTTLE');

        await postQ4Signal(request, 'SELL');
        await expect
            .poll(async () => (await getOverlaySummary(request)).portfolio_risk?.mode, {
                timeout: 20_000,
            })
            .toBe('Q4_CRISIS');

        let summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.target_pct).toBe(10);
        expect(summary.portfolio_risk?.inputs?.q3?.active).toBe(true);
        expect(summary.portfolio_risk?.inputs?.q3?.effective_target_pct).toBe(35);
        expect(summary.portfolio_risk?.inputs?.q4?.active).toBe(true);

        await postQ1Signal(request, 'XAO', 25);
        await expect
            .poll(
                async () =>
                    (await getOverlaySummary(request)).portfolio_risk?.inputs?.q3
                        ?.effective_target_pct,
                { timeout: 20_000 },
            )
            .toBe(25);

        summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.mode).toBe('Q4_CRISIS');
        expect(summary.portfolio_risk?.target_pct).toBe(10);

        await postQ4Signal(request, 'BUY');
        await expect
            .poll(async () => (await getOverlaySummary(request)).portfolio_risk?.mode, {
                timeout: 20_000,
            })
            .toBe('Q3_THROTTLE');

        summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.target_pct).toBe(25);
        expect(summary.q4_crisis?.active).toBe(false);
        expect(summary.portfolio_risk?.inputs?.q3?.effective_target_pct).toBe(25);
    });

    test('Q3 risk-on can be marked reviewed without creating trades or a target', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPX', 30);
        await expect
            .poll(async () => Number((await getOverlaySummary(request)).required_de_risk_value || 0), {
                timeout: 20_000,
            })
            .toBeGreaterThan(0);

        await completeCurrentRiskReduction(request);

        await postQ1Signal(request, 'SPX', 80);
        await expect
            .poll(async () => Number((await getOverlaySummary(request)).available_headroom_value || 0), {
                timeout: 20_000,
            })
            .toBeGreaterThan(0);

        const beforeReview = await getOverlaySummary(request);
        expect(beforeReview.portfolio_risk?.target_pct).toBe(80);
        expect(Number(beforeReview.required_de_risk_value || 0)).toBe(0);

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
        expect(Number(afterReview.required_de_risk_value || 0)).toBe(0);
        expect(Number(afterReview.available_headroom_value || 0)).toBe(0);
        expect(String(afterReview.active_event_status || '')).not.toMatch(
            /PENDING|PARTIAL/,
        );
    });
});
