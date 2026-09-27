import { test, expect } from '@playwright/test';
import {
    baselinePortfolio,
    buildDayAfterPortfolio,
    buildStatementImportPayload,
} from './fixtures/portfolio-states';
import {
    getOverlaySummary,
    importStatement,
    preparePendingStage1,
} from './helpers/overlay-api';
import {
    resetLocalUatDatabaseIfConfigured,
} from './helpers/local-db';
import { reconcilePortfolioAgainstStage1Sources } from './helpers/portfolio-diff';

const nowPlus = (minutes: number): Date =>
    new Date(Date.now() + minutes * 60 * 1000);

test.describe('portfolio overlay day-after reconciliation', () => {
    test.skip(
        process.env.UAT_OVERLAY_RECONCILIATION !== '1',
        'destructive UAT reconciliation tests require UAT_OVERLAY_RECONCILIATION=1',
    );

    test.beforeEach(async ({ request }) => {
        resetLocalUatDatabaseIfConfigured();

        await importStatement(
            request,
            buildStatementImportPayload(baselinePortfolio, nowPlus(-30)),
        );
    });

    test('confirms reserve cash when the day-after portfolio reflects the recorded reductions', async ({
        request,
    }) => {
        const { plan } = await preparePendingStage1(request);
        const dayAfter = buildDayAfterPortfolio({
            cashAud: plan.expectedReserve,
            mode: 'success',
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

        expect(summary.cash_confirmation_status).toBe('CONFIRMED');
        expect(Math.abs(Number(summary.reserve_variance || 0))).toBeLessThanOrEqual(
            1,
        );
        expect(diff.cashVariance).toBe(0);
        expect(diff.discrepancies).toEqual([]);
    });

    test('flags reserve variance when the day-after import shows no reduction occurred', async ({
        request,
    }) => {
        const { plan } = await preparePendingStage1(request);
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
        const diff = reconcilePortfolioAgainstStage1Sources({
            actual: dayAfter,
            baseline: baselinePortfolio,
            expectedCashAud: plan.expectedReserve,
            sources: plan.sources,
        });

        expect(summary.cash_confirmation_status).toBe('VARIANCE');
        expect(Number(summary.reserve_variance || 0)).toBeLessThan(0);
        expect(diff.cashVariance).toBeLessThan(0);
        expect(diff.discrepancies.length).toBeGreaterThan(0);
    });

    test('reports source mismatches when cash arrives but the wrong holdings were reduced', async ({
        request,
    }, testInfo) => {
        const { plan } = await preparePendingStage1(request);
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

        await testInfo.attach('portfolio-source-diff.json', {
            body: JSON.stringify(diff, null, 2),
            contentType: 'application/json',
        });

        expect(summary.cash_confirmation_status).toBe('CONFIRMED');
        expect(diff.cashVariance).toBe(0);
        expect(diff.discrepancies.length).toBeGreaterThan(0);
    });
});
