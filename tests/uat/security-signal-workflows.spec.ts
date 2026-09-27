import { test, expect, type APIRequestContext } from '@playwright/test';
import {
    baselinePortfolio,
    buildStatementImportPayload,
} from './fixtures/portfolio-states';
import { assertUatSafety } from './helpers/action-workflows';
import { resetLocalUatDatabaseIfConfigured } from './helpers/local-db';
import { apiBaseUrl, importStatement } from './helpers/overlay-api';

const nowPlus = (minutes: number): Date =>
    new Date(Date.now() + minutes * 60 * 1000);

type AlertRow = {
    ticker: string;
    alert_type: string;
    source?: string;
    is_active?: boolean;
};

type SecurityPosition = {
    ticker: string;
    position_state: string;
    stopped_waiting_reentry?: boolean;
};

type ActiveAlert = {
    ticker: string;
    script: string;
};

const resetAndImportBaseline = async ({
    request,
}: {
    request: APIRequestContext;
}) => {
    assertUatSafety();
    resetLocalUatDatabaseIfConfigured();
    await importStatement(
        request,
        buildStatementImportPayload(baselinePortfolio, nowPlus(-30)),
    );
};

const postTradingView = async (
    request: APIRequestContext,
    payload: unknown,
): Promise<void> => {
    const response = await request.post(`${apiBaseUrl}/webhook/tradingview`, {
        data: payload,
    });
    expect(response.ok(), `/webhook/tradingview failed: ${await response.text()}`).toBe(
        true,
    );
};

const getSecurityPositions = async (
    request: APIRequestContext,
): Promise<SecurityPosition[]> => {
    const response = await request.get(`${apiBaseUrl}/positions`);
    expect(response.ok(), `/positions failed: ${await response.text()}`).toBe(true);
    return (await response.json()) as SecurityPosition[];
};

const getAlerts = async (request: APIRequestContext): Promise<AlertRow[]> => {
    const response = await request.get(`${apiBaseUrl}/alerts?includeHistory=true`);
    expect(response.ok(), `/alerts failed: ${await response.text()}`).toBe(true);
    return (await response.json()) as AlertRow[];
};

const getActiveAlerts = async (
    request: APIRequestContext,
): Promise<ActiveAlert[]> => {
    const response = await request.get(`${apiBaseUrl}/alerts/active`);
    expect(response.ok(), `/alerts/active failed: ${await response.text()}`).toBe(
        true,
    );
    return (await response.json()) as ActiveAlert[];
};

const registerTmsSetup = async (request: APIRequestContext, ticker = 'ASX:GOLD1') => {
    await postTradingView(request, {
        ticker,
        signal: 'connect',
        script: 'tms',
    });

    await expect
        .poll(
            async () =>
                (await getActiveAlerts(request)).some(
                    (alert) => alert.ticker === ticker && alert.script === 'tms',
                ),
            { timeout: 20_000 },
        )
        .toBe(true);
};

test.describe('UAT per-security signal workflows', () => {
    test.skip(
        process.env.UAT_SECURITY_SIGNAL_TEST !== '1',
        'destructive security signal tests require UAT_SECURITY_SIGNAL_TEST=1',
    );

    test.beforeEach(resetAndImportBaseline);

    test('plain CDF BUY/SELL syncs security state without creating action alerts', async ({
        request,
    }) => {
        expect(await getAlerts(request)).toHaveLength(0);

        await postTradingView(request, {
            ticker: 'ASX:GOLD1',
            signal: 'sell',
            script: 'cdf',
        });

        await expect
            .poll(
                async () =>
                    (await getSecurityPositions(request)).find(
                        (position) => position.ticker === 'GOLD1',
                    )?.position_state,
                { timeout: 20_000 },
            )
            .toBe('SELL');

        expect(await getAlerts(request)).toHaveLength(0);

        await postTradingView(request, {
            ticker: 'ASX:GOLD1',
            signal: 'buy',
            script: 'cdf',
        });

        await expect
            .poll(
                async () =>
                    (await getSecurityPositions(request)).find(
                        (position) => position.ticker === 'GOLD1',
                    )?.position_state,
                { timeout: 20_000 },
            )
            .toBe('BUY');

        expect(await getAlerts(request)).toHaveLength(0);
    });

    test('TMS cdf_sell_zone creates explicit SELL_DOWN action alert when setup is active', async ({
        request,
    }) => {
        await registerTmsSetup(request);

        await postTradingView(request, {
            ticker: 'ASX:GOLD1',
            signal: 'cdf_sell_zone',
            script: 'tms',
        });

        await expect
            .poll(
                async () =>
                    (await getAlerts(request)).find(
                        (alert) =>
                            alert.ticker === 'GOLD1' &&
                            alert.alert_type === 'SELL_DOWN' &&
                            alert.source === 'tms',
                    ),
                { timeout: 20_000 },
            )
            .toBeTruthy();
    });

    test('TMS stop uses embedded CDF state to choose Sell 50% versus Liquidate', async ({
        request,
    }) => {
        await registerTmsSetup(request);

        await postTradingView(request, {
            ticker: 'ASX:GOLD1',
            signal: 'sell',
            script: 'tms',
            cdf_state: 'BUY',
        });

        await expect
            .poll(
                async () =>
                    (await getAlerts(request)).find(
                        (alert) =>
                            alert.ticker === 'GOLD1' &&
                            alert.alert_type === 'SELL_50' &&
                            alert.source === 'tms',
                    ),
                { timeout: 20_000 },
            )
            .toBeTruthy();

        await expect
            .poll(
                async () =>
                    (await getSecurityPositions(request)).find(
                        (position) => position.ticker === 'GOLD1',
                    )?.stopped_waiting_reentry,
                { timeout: 20_000 },
            )
            .toBe(true);

        await resetAndImportBaseline({ request });
        await registerTmsSetup(request);

        await postTradingView(request, {
            ticker: 'ASX:GOLD1',
            signal: 'sell',
            script: 'tms',
            cdf_state: 'SELL',
        });

        await expect
            .poll(
                async () =>
                    (await getAlerts(request)).find(
                        (alert) =>
                            alert.ticker === 'GOLD1' &&
                            alert.alert_type === 'SELL' &&
                            alert.source === 'tms',
                    ),
                { timeout: 20_000 },
            )
            .toBeTruthy();

        await expect
            .poll(
                async () =>
                    (await getSecurityPositions(request)).find(
                        (position) => position.ticker === 'GOLD1',
                    )?.stopped_waiting_reentry,
                { timeout: 20_000 },
            )
            .toBe(false);
    });
});
