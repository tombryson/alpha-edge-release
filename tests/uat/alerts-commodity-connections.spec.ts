import { expect, test, type Page } from '@playwright/test';

const now = '2026-08-15T02:00:00Z';

const goldTheme = {
    code: 'GOLD',
    display_name: 'Gold',
    status: 'DISCONNECTED',
    confirmation_count: 0,
    confirmation_total: 3,
    strategic_floor: { asset_class_code: 'PHYSICAL_GOLD', target_value: 0, actual_value: 0 },
    tactical: {
        asset_class_code: 'GOLD_MINERS',
        maximum_value: 10_000,
        permitted_value: 0,
        actual_value: 0,
        available_value: 10_000,
        budget_approved: true,
    },
    direct_expression: { status: 'SIGNAL_ONLY', existing_position_treatment: 'CLASS_DEFINED' },
    direct_sleeve: { asset_class_code: 'PHYSICAL_GOLD', target_value: 0, invested_value: 0, sleeve_cash_value: 0, capital_value: 0, budget_approved: true },
    equity_sleeve: { asset_class_code: 'GOLD_MINERS', target_value: 10_000, invested_value: 0, sleeve_cash_value: 0, capital_value: 0, budget_approved: true },
    reviews: [],
    stages: [
        {
            key: 'COMMODITY',
            order: 1,
            scope: 'THEME',
            label: 'Gold price',
            status: 'DISCONNECTED',
            source: { kind: 'UNDERLYING_PRICE', symbol: 'AMEX:GLD', label: 'Gold price' },
        },
        {
            key: 'EQUITY_RELATIVE',
            order: 2,
            scope: 'THEME',
            label: 'Gold equities / gold',
            status: 'DISCONNECTED',
            source: { kind: 'RELATIVE_STRENGTH', numerator: 'AMEX:GDX', denominator: 'AMEX:GLD', label: 'Gold equities / gold' },
        },
    ],
};

const incompletePlatinumTheme = {
    ...goldTheme,
    code: 'PLATINUM',
    display_name: 'Platinum',
    tactical: { ...goldTheme.tactical, asset_class_code: 'PLATINUM_MINERS' },
    stages: [
        {
            ...goldTheme.stages[0],
            label: 'Platinum price',
            source: { ...goldTheme.stages[0].source, symbol: '', label: 'Platinum price' },
        },
        {
            ...goldTheme.stages[1],
            label: 'Platinum equities / platinum',
            source: {
                ...goldTheme.stages[1].source,
                numerator: 'AMEX:SBSW',
                denominator: '',
                label: 'Platinum equities / platinum',
            },
        },
    ],
};

async function mockAlertsApi(
    page: Page,
    setupPayloads: Array<Record<string, unknown>>,
    initialAlerts: Array<{ id: number; ticker: string; script: string; created_at: string }> = [],
) {
    let nextAlertID = 1;
    let activeAlerts = initialAlerts;
    const theme = structuredClone(goldTheme);

    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        let body: unknown = [];

        if (path.endsWith('/alerts/active') && route.request().method() === 'GET') {
            body = activeAlerts;
        } else if (path.endsWith('/commodity-themes/initialise-feed')) {
            const payload = route.request().postDataJSON() as Record<string, unknown>;
            setupPayloads.push(payload);
            const stage = String(payload.stage);
            const ticker = stage === 'COMMODITY'
                ? 'AMEX:GLD'
                : stage === 'EQUITY_RELATIVE'
                    ? 'AMEX:GDX/AMEX:GLD'
                    : 'ASX:AEVT/AMEX:GDX';
            activeAlerts = [
                ...activeAlerts.filter((alert) => alert.ticker !== ticker || alert.script !== 'cdf'),
                { id: nextAlertID++, ticker, script: 'cdf', created_at: now },
            ];
            const stageState = payload.signal === 'BUY' ? 'CONFIRMED' : 'BLOCKED';
            const configuredStage = theme.stages.find((candidate) => candidate.key === stage);
            if (configuredStage) configuredStage.status = stageState;
            body = { status: 'initialised' };
        } else if (path.endsWith('/alerts/active/setup')) {
            const payload = route.request().postDataJSON() as Record<string, unknown>;
            setupPayloads.push(payload);
            activeAlerts = [
                ...activeAlerts.filter((alert) => alert.ticker !== payload.ticker || alert.script !== payload.script),
                { id: nextAlertID++, ticker: String(payload.ticker), script: String(payload.script), created_at: now },
            ];
            body = { message: 'Alert setup initialised' };
        } else if (path.endsWith('/alerts/active/remove')) {
            const payload = route.request().postDataJSON() as { id?: number; ticker?: string; script?: string };
            activeAlerts = activeAlerts.filter((alert) =>
                payload.id ? alert.id !== payload.id : alert.ticker !== payload.ticker || alert.script !== payload.script,
            );
            body = { message: 'Active alert removed' };
        } else if (path.endsWith('/commodity-themes')) {
            body = { generated_at: now, themes: [theme, incompletePlatinumTheme] };
        } else if (path.endsWith('/statements/latest')) {
            body = {
                statement: { id: 1, account_name: 'UAT', statement_date: now, total_value_aud: 50_000, cash_aud: 0, usd_value: 0, usd_aud: 0, gbp_value: 0, gbp_aud: 0, aud_value: 50_000, created_at: now },
                holdings: [{ id: 101, statement_id: 1, details: 'Australis Gold Ltd', ticker: 'AEVT', exchange_prefix: 'ASX:', quantity: 1000, cost_aud: 1_000, current_price: 1, value_aud: 1_000, gain_loss_aud: 0, gain_loss_pct: 0, currency: 'AUD', market_value: 1_000, cash_reserve: 0, template_id: null, created_at: now }],
            };
        } else if (path.endsWith('/analysis')) {
            body = [{ id: 201, ticker: 'ASX:AEVT', name: 'Australis Gold Ltd', primary_asset_class: 'GOLD_MINERS', security_type: 'STOCK', is_watchlist: false }];
        } else if (path.endsWith('/etf/allocation-ledger')) {
            body = {
                as_of: now,
                policy: {
                    suggested_exposure_pct: 25,
                    default_core_ratio_pct: 25,
                    momentum_influence_pct: 50,
                    momentum_source: 'INTERNAL_PUBLISHED',
                    minimum_exposure_pct: 25,
                    core_sleeve_ratio_pct: 25,
                },
                summary: {
                    portfolio_value: 50_000,
                    suggested_etf_value: 12_500,
                    suggested_exposure_pct: 25,
                    actual_exposure_pct: 0,
                    momentum_adjustment_value: 0,
                    recommended_target_value: 0,
                    effective_target_value: 0,
                    remaining_to_suggestion_value: 12_500,
                    minimum_etf_value: 12_500,
                    actual_etf_value: 0,
                    core_target_value: 0,
                    tactical_target_value: 0,
                    final_target_value: 0,
                    remaining_to_minimum_value: 12_500,
                    remaining_to_target_value: 0,
                    has_approved_shape: false,
                },
                classes: [],
                rows: [],
            };
        } else if (path.endsWith('/portfolio-risk/header-state')) {
            body = { q3: null, q4: null, baseline_mix: { rows: [] } };
        } else if (path.endsWith('/portfolio-mix/current')) {
            body = { as_of: now, total_value: 50_000, rows: [] };
        } else if (path.endsWith('/statements') || path.endsWith('/alerts') || path.endsWith('/security-actions') || path.endsWith('/asset-classes') || path.endsWith('/asset-class-config') || path.endsWith('/sync/history') || path.endsWith('/sync/changes') || path.endsWith('/regime/proposed-actions') || path.endsWith('/webhook-dead-letters') || path.endsWith('/etf/rebalance')) {
            body = [];
        }

        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
}

async function openConnectionScope(page: Page, label: 'Positions' | 'Commodities') {
    await expect.poll(() => page.evaluate((scopeLabel) => {
        const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
            candidate.textContent?.trim().startsWith(scopeLabel)
        );
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
    }, label), { timeout: 15_000 }).toBe(true);
}

test('uses the Stock Connections ledger for commodity and Outperform alerts', async ({ page }) => {
    const setupPayloads: Array<Record<string, unknown>> = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('alpha-edge-api-token', 'alerts-connection-fixture-token');
        window.localStorage.removeItem('terminal-cached-data');
        window.localStorage.removeItem('alpha-edge-active-tab');
    });
    await mockAlertsApi(page, setupPayloads);
    await page.route('https://s3.tradingview.com/**', (route) => route.abort());

    await page.goto('/#/alerts');
    await openConnectionScope(page, 'Commodities');

    const commodityTable = page.getByTestId('alerts-commodity-connections');
    await expect(commodityTable).toBeVisible();
    await expect(commodityTable.getByText('COMMODITY CONNECTIONS', { exact: true })).toBeVisible();
    await expect(commodityTable.getByText('Gold', { exact: true })).toBeVisible();
    await expect(commodityTable.getByText('Platinum', { exact: true })).toBeVisible();
    await expect(commodityTable.getByText('Missing ticker', { exact: true }).first()).toBeVisible();
    await expect(commodityTable.getByRole('checkbox', { name: 'Platinum physical commodity ticker missing' })).toBeDisabled();

    const physical = commodityTable.getByRole('checkbox', { name: 'Gold physical commodity CDF connection' });
    const equities = commodityTable.getByRole('checkbox', { name: 'Gold equity trend CDF connection' });
    await expect(physical).not.toBeChecked();
    await expect(equities).not.toBeChecked();

    await physical.click();
    const physicalModal = page.getByTestId('commodity-feed-setup-modal');
    await expect(physicalModal).toBeVisible();
    await physicalModal.getByRole('button', { name: 'BUY', exact: true }).click();
    await physicalModal.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(physical).toBeChecked();
    await expect.poll(() => setupPayloads[0]).toMatchObject({
        theme: 'GOLD', stage: 'COMMODITY', signal: 'BUY',
    });

    await openConnectionScope(page, 'Positions');
    const outperform = page.getByRole('checkbox', { name: 'Australis Gold Ltd Outperform CDF connection' });
    await expect(outperform).not.toBeChecked();
    await outperform.click();
    const outperformModal = page.getByTestId('commodity-feed-setup-modal');
    await expect(outperformModal).toBeVisible();
    await outperformModal.getByRole('button', { name: 'SELL', exact: true }).click();
    await outperformModal.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(outperform).toBeChecked();
    await expect.poll(() => setupPayloads[1]).toMatchObject({
        theme: 'GOLD', stage: 'SECURITY_OUTPERFORM', signal: 'SELL', security: { ticker: 'ASX:AEVT' },
    });

    await openConnectionScope(page, 'Commodities');
    await physical.click();
    await expect(physical).not.toBeChecked();
    await expect(equities).not.toBeChecked();
});

test('initialises an existing commodity connection that has no directional baseline', async ({ page }) => {
    const setupPayloads: Array<Record<string, unknown>> = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('alpha-edge-api-token', 'alerts-connection-fixture-token');
        window.localStorage.removeItem('terminal-cached-data');
        window.localStorage.removeItem('alpha-edge-active-tab');
    });
    await mockAlertsApi(page, setupPayloads, [
        { id: 99, ticker: 'AMEX:GLD', script: 'cdf', created_at: now },
    ]);
    await page.goto('/#/alerts');
    await openConnectionScope(page, 'Commodities');

    const physical = page.getByRole('checkbox', { name: 'Gold physical commodity CDF connection' });
    await expect(physical).toBeChecked();
    await physical.click();
    const modal = page.getByTestId('commodity-feed-setup-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'SELL', exact: true }).click();
    await modal.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(physical).toBeChecked();
    await expect.poll(() => setupPayloads[0]).toMatchObject({
        theme: 'GOLD', stage: 'COMMODITY', signal: 'SELL',
    });
});
