import { test, expect } from '@playwright/test';
import {
    baselinePortfolio,
    buildStatementImportPayload,
} from './fixtures/portfolio-states';
import { assertUatSafety } from './helpers/action-workflows';
import { resetLocalUatDatabaseIfConfigured } from './helpers/local-db';
import {
    apiBaseUrl,
    getEquitySizing,
    getPortfolioRiskHeaderState,
    importStatement,
    postQ1Signal,
    postQ4Signal,
} from './helpers/overlay-api';

const nowPlus = (minutes: number): Date =>
    new Date(Date.now() + minutes * 60 * 1000);

const resetAndImportBaseline = async ({ request }: { request: any }) => {
    assertUatSafety();
    resetLocalUatDatabaseIfConfigured();
    await importStatement(
        request,
        buildStatementImportPayload(baselinePortfolio, nowPlus(-30)),
    );
};

test.describe('UAT webhook contracts', () => {
    test.skip(
        process.env.UAT_WEBHOOK_CONTRACT_TEST !== '1',
        'destructive webhook contract tests require UAT_WEBHOOK_CONTRACT_TEST=1',
    );

    test.beforeEach(resetAndImportBaseline);

    test('tradingview endpoint rejects Q3 and Q4 detector packets', async ({
        request,
    }) => {
        for (const payload of [
            { ticker: 'SP:SPX', script: 'q3d', target_equity_pct: 35 },
            { ticker: 'Q4', signal: 'SELL', script: 'q4d' },
        ]) {
            const response = await request.post(`${apiBaseUrl}/webhook/tradingview`, {
                data: payload,
            });
            expect(response.status()).toBe(400);
            await expect(response.text()).resolves.toContain(
                'regime detector signals must use /api/webhook/regime',
            );
        }

        const sizing = await getEquitySizing(request);
        expect(sizing.sources || []).toEqual([]);
    });

    test('Q3 uses SPX as preferred S&P state while keeping legacy SPY compatible', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPY', 80);
        await postQ1Signal(request, 'SPX', 35);
        await postQ1Signal(request, 'XAO', 70);

        await expect
            .poll(async () => (await getPortfolioRiskHeaderState(request)).q3?.source, {
                timeout: 20_000,
            })
            .toBe('SPX');

        const header = await getPortfolioRiskHeaderState(request);
        expect(header.q3?.target_pct).toBe(35);
        expect(header.q3?.active).toBe(true);
        expect(header.q3?.spx_target_pct).toBe(35);
        expect(header.q3?.spy_target_pct).toBe(35);
        expect(header.q3?.xao_target_pct).toBe(70);

        const sizing = await getEquitySizing(request);
        const bySource = new Map(
            (sizing.sources || []).map((row) => [
                row.source_ticker,
                row.target_equity_pct,
            ]),
        );
        expect(bySource.get('SPY')).toBe(80);
        expect(bySource.get('SPX')).toBe(35);
        expect(bySource.get('XAO')).toBe(70);
    });

    test('Q4 SELL and BUY map to persisted 10/100 crisis state', async ({
        request,
    }) => {
        await postQ4Signal(request, 'SELL');

        await expect
            .poll(async () => (await getPortfolioRiskHeaderState(request)).q4?.active, {
                timeout: 20_000,
            })
            .toBe(true);

        let header = await getPortfolioRiskHeaderState(request);
        expect(header.q4?.reason).toBe('q4d_sell_signal');
        expect(header.q4?.target_equity_pct).toBe(10);

        let sizing = await getEquitySizing(request);
        expect(
            (sizing.sources || []).find((row) => row.source_ticker === 'Q4D')
                ?.target_equity_pct,
        ).toBe(10);

        await postQ4Signal(request, 'BUY');

        await expect
            .poll(async () => (await getPortfolioRiskHeaderState(request)).q4?.active, {
                timeout: 20_000,
            })
            .toBe(false);

        header = await getPortfolioRiskHeaderState(request);
        expect(header.q4?.reason).toBe('q4d_buy_signal');

        sizing = await getEquitySizing(request);
        expect(
            (sizing.sources || []).find((row) => row.source_ticker === 'Q4D')
                ?.target_equity_pct,
        ).toBe(100);
    });
});
