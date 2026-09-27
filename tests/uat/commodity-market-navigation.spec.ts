import { expect, test, type Page } from '@playwright/test';
import type { CommodityTheme, CommodityThemeStage } from '@/lib/api';

const stages: CommodityThemeStage[] = [
    {
        key: 'COMMODITY',
        order: 1,
        scope: 'THEME' as const,
        label: 'Gold price',
        status: 'CONFIRMED' as const,
        signal: 'BUY' as const,
        return_60d_pct: 4.8,
        performance_as_of: '2026-08-18T00:00:00Z',
        source: { kind: 'UNDERLYING_PRICE', symbol: 'AMEX:GLD', label: 'Gold price' },
    },
    {
        key: 'EQUITY_RELATIVE',
        order: 2,
        scope: 'THEME' as const,
        label: 'Gold equities / gold',
        status: 'CONFIRMED' as const,
        signal: 'BUY' as const,
        source: { kind: 'RELATIVE_STRENGTH', numerator: 'AMEX:GDX', denominator: 'AMEX:GLD', label: 'Gold equities / gold' },
    },
    {
        key: 'SECURITY_TREND',
        order: 3,
        scope: 'SECURITY' as const,
        label: 'Company trend',
        status: 'CONFIRMED' as const,
        eligible_security_count: 1,
        source: { kind: 'SECURITY_TREND', symbol: 'SECURITY', label: 'Company trend' },
    },
    {
        key: 'SECURITY_OUTPERFORM',
        order: 4,
        scope: 'SECURITY' as const,
        label: 'Outperform',
        status: 'BLOCKED' as const,
        eligible_security_count: 0,
        blocked_security_count: 1,
        eligible_security_total: 4,
        source: { kind: 'RELATIVE_STRENGTH', numerator: 'SECURITY', denominator: 'AMEX:GDX', label: 'Company / core fund' },
    },
];

const goldTheme: CommodityTheme = {
    code: 'GOLD',
    display_name: 'Gold',
    status: 'PARTIAL' as const,
    confirmation_count: 1,
    confirmation_total: 3,
    strategic_floor: { asset_class_code: 'PHYSICAL_GOLD', target_value: 0, actual_value: 0 },
    direct_expression: {
        status: 'SIGNAL_ONLY',
        existing_position_treatment: 'CLASS_DEFINED',
    },
    direct_sleeve: {
        asset_class_code: 'PHYSICAL_GOLD',
        target_value: 0,
        invested_value: 0,
        sleeve_cash_value: 0,
        capital_value: 0,
        budget_approved: true,
    },
    equity_sleeve: {
        asset_class_code: 'GOLD_MINERS',
        target_value: 10_000,
        invested_value: 2_000,
        sleeve_cash_value: 0,
        capital_value: 2_000,
        budget_approved: true,
    },
    reviews: [],
    tactical: {
        asset_class_code: 'GOLD_MINERS',
        maximum_value: 10_000,
        permitted_value: 3_333.33,
        actual_value: 2_000,
        available_value: 3_000,
        budget_approved: true,
    },
    stages,
    eligible_securities: [
        { security_id: 1, ticker: 'ASX:ONE', name: 'Gold Producer One', include_in_sizing: true, stage_states: { SECURITY_OUTPERFORM: 'BLOCKED' }, latest_events: {} },
        { security_id: 2, ticker: 'ASX:TWO', name: 'Gold Producer Two', include_in_sizing: true, stage_states: { SECURITY_OUTPERFORM: 'CONFIRMED' }, latest_events: {} },
        { security_id: 3, ticker: 'ASX:THREE', name: 'Gold Producer Three', include_in_sizing: true, stage_states: { SECURITY_OUTPERFORM: 'CONFIRMED' }, latest_events: {} },
        { security_id: 4, ticker: 'ASX:FOUR', name: 'Gold Producer Four', include_in_sizing: true, stage_states: { SECURITY_OUTPERFORM: 'CONFIRMED' }, latest_events: {} },
    ],
    producer_funds: [
        { security_id: 50, ticker: 'ASX:GDX', name: 'Gold Miners Fund', trend_state: 'CONFIRMED' },
    ],
};

async function mockMarketApi(page: Page, themes: CommodityTheme[] = [goldTheme]): Promise<void> {
    await page.route(/\/api\/commodity-themes(?:\?include_securities=true)?$/, async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ generated_at: '2026-08-06T00:00:00Z', themes }),
        });
    });
    await page.route('**/api/commodity-themes/GOLD', async (route) => {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(goldTheme) });
    });
    await page.route('**/api/asset-classes', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                { code: 'PHYSICAL_GOLD', asset_class_code: 'PHYSICAL_GOLD', display_name: 'Physical Gold', allow_target_weight: true, active: true },
                { code: 'GOLD_MINERS', asset_class_code: 'GOLD', display_name: 'Gold Miners', allow_target_weight: true, active: true },
            ]),
        });
    });
}

test.describe('commodity market navigation', () => {
    test('keeps tabs and market detail replayable through browser history', async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('alpha-edge-api-token', 'local-test-token');
        });
        await mockMarketApi(page);
        await page.route('https://s3.tradingview.com/**', (route) => route.abort());

        await page.goto('/');
        await page.getByTestId('main-tab-markets').click();

        await expect(page).toHaveURL(/#\/markets$/);
        await expect(page.getByRole('heading', { name: 'Market Map' })).toBeVisible();
        await expect(page.getByTestId('shell-left-rail')).toHaveCSS('width', '288px');
        await expect(page.getByTestId('shell-right-rail')).toHaveCSS('width', '328px');
        await page.getByTestId('main-tab-markets').click();
        await expect(page.getByTestId('shell-left-rail')).toHaveCSS('width', '1px');
        await expect(page.getByTestId('shell-right-rail')).toHaveCSS('width', '1px');
        await page.getByTestId('main-tab-markets').click();
        await expect(page.getByTestId('shell-left-rail')).toHaveCSS('width', '288px');
        await expect(page.getByTestId('shell-right-rail')).toHaveCSS('width', '328px');
        await expect(page.getByRole('heading', { name: 'Precious metals' })).toHaveCSS('font-size', '11px');
        const goldRow = page.getByTestId('market-theme-GOLD');
        await expect(goldRow.locator('[data-market-stage-label="COMMODITY"]')).toHaveText('BULL');
        await expect(goldRow.locator('[data-market-stage-label="SECURITY_TREND"]')).toHaveText('BULL 1/4');
        await expect(goldRow.locator('[data-market-stage-label="SECURITY_OUTPERFORM"]')).toHaveText('UNDERPERFORM 1/4');
        await expect(goldRow).not.toContainText('Confirmed');
        await expect(goldRow).not.toContainText('Blocked');
        await expect(goldRow.locator('[data-market-identity-bar]')).toHaveCSS('width', '10px');
        await expect(goldRow.locator('[data-market-identity-bar]')).toHaveCSS('height', '10px');
        await expect(goldRow.locator('[data-market-identity-pair]')).toHaveText('GDX / GLD');
        await expect(goldRow).not.toContainText('Gold price');
        await expect(goldRow).not.toContainText('Gold equities / gold');
        // Direct commodity and producer equities are separate column groups; the equity regime reads as a gate.
        await expect(goldRow.locator('[data-market-cell="direct-trend"]')).toContainText('Bull');
        await expect(goldRow.locator('[data-market-regime]')).toHaveAttribute('data-market-regime', 'BULL');
        await expect(goldRow.locator('[data-market-regime]')).toContainText('Open');
        // Fixture stocks have no CDF trend state: missing evidence is reported as incomplete,
        // not counted as four failed companies.
        await expect(goldRow.locator('[data-market-cell="qualifying"]')).toContainText('—');
        await expect(goldRow.locator('[data-market-cell="qualifying"]')).not.toContainText('0 of 4');
        await expect(goldRow.locator('[data-market-cell="qualifying"]')).toHaveAttribute('title', /4 incomplete/);
        await expect(goldRow.locator('[data-market-standing-summary="marks"]')).toBeVisible();
        await expect(page.getByTestId('market-open-regime-count')).toHaveText('1 of 1 equity regimes open');
        await expect(page.getByText('60D', { exact: true })).toBeVisible();
        await expect(page.getByTestId('market-commodity-return-GOLD')).toHaveText('+4.8%');
        await expect(page.getByTestId('market-commodity-return-GOLD')).toHaveAttribute('title', /60 calendar days/);
        const metricBeforeNextStep = await page.evaluate(() => {
            const metric = document.querySelector('[data-testid="market-commodity-return-GOLD"]');
            const toggle = document.querySelector('[data-testid="market-stock-evidence-toggle-GOLD"]');
            if (!metric || !toggle) return false;
            return metric.getBoundingClientRect().right <= toggle.getBoundingClientRect().left + 0.5;
        });
        expect(metricBeforeNextStep).toBe(true);
        await expect(page.getByTestId('market-next-step-GOLD')).toHaveCount(0);
        await expect(page.getByText('Connections ready', { exact: true })).toHaveCount(0);
        const stockEvidenceToggle = page.getByTestId('market-stock-evidence-toggle-GOLD');
        await expect(stockEvidenceToggle).toHaveCSS('height', '28px');
        await expect(stockEvidenceToggle).toHaveCSS('width', '28px');
        await expect(stockEvidenceToggle.locator('[data-market-evidence-icon]')).toHaveCSS('height', '16px');
        await expect(stockEvidenceToggle.locator('[data-market-evidence-icon]')).toHaveCSS('width', '16px');
        await expect(page.getByText('Evidence', { exact: true })).toHaveCount(0);
        await expect(stockEvidenceToggle).toHaveAttribute('aria-expanded', 'false');
        await stockEvidenceToggle.click();
        await expect(page).toHaveURL(/#\/markets$/);
        await expect(stockEvidenceToggle).toHaveAttribute('aria-expanded', 'true');
        const stockEvidence = page.getByTestId('market-stock-evidence-GOLD');
        await expect(stockEvidence.getByText('Gold Producer One', { exact: true })).toBeVisible();
        await expect(stockEvidence.getByText('Gold Producer Four', { exact: true })).toBeVisible();
        await expect(stockEvidence.getByTestId('market-stock-evidence-row-1').locator('[data-market-stock-evidence-node]')).toHaveCount(2);
        await expect(stockEvidence.getByText('Trend', { exact: true })).toHaveCount(4);
        await expect(stockEvidence.getByText('Incomplete', { exact: true })).toHaveCount(4);
        await expect(stockEvidence.getByText('Outperform', { exact: true })).toHaveCount(0);

        await page.getByRole('button', { name: 'ANALYSIS', exact: true }).click();
        await expect(page).toHaveURL(/#\/analysis$/);
        await page.goBack();
        await expect(page).toHaveURL(/#\/markets$/);
        await expect(page.getByRole('heading', { name: 'Market Map' })).toBeVisible();
        await page.goForward();
        await expect(page).toHaveURL(/#\/analysis$/);
        await page.goBack();

        await page.getByTestId('market-theme-GOLD').click();
        await expect(page).toHaveURL(/#\/markets\/GOLD$/);
        await expect(page.getByRole('heading', { name: 'Gold' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Gold · direct commodity' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Gold · producer equities' })).toBeVisible();
        await expect(page.getByText('Signal only: no approved broker vehicle')).toHaveCount(0);
        await expect(page.getByText('1 / 3', { exact: true }).first()).toBeVisible();
        // The detail sleeve shows held / budget / class cash, never the legacy aggregate capacity.
        await expect(page.getByText('Approved budget', { exact: true })).toBeVisible();
        await expect(page.getByText('Permitted equity capacity', { exact: true })).toHaveCount(0);
        await expect(page.locator('[data-market-detail-stage="EQUITY_RELATIVE"]')).toContainText('Open');
        // One selected company drives both company charts.
        const trendChartTitle = page.getByTestId('market-chart-SECURITY_TREND').locator('[data-market-chart-title]');
        const outperformChartTitle = page.getByTestId('market-chart-SECURITY_OUTPERFORM').locator('[data-market-chart-title]');
        await expect(outperformChartTitle).toContainText('ONE');
        await expect(trendChartTitle).toContainText('ONE');
        await page.getByTestId('market-detail-company-2').click();
        await expect(page.getByTestId('market-detail-company-2')).toHaveAttribute('aria-selected', 'true');
        await expect(outperformChartTitle).toContainText('TWO');
        await expect(trendChartTitle).toContainText('TWO');
        // Producer funds list beside companies: trend and chart only, no Outperform.
        await page.getByTestId('market-detail-fund-50').click();
        await expect(page.getByTestId('market-detail-fund-50')).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('market-detail-company-2')).toHaveAttribute('aria-selected', 'false');
        await expect(trendChartTitle).toContainText('GDX');
        await expect(page.getByTestId('market-chart-SECURITY_OUTPERFORM')).toContainText('Outperform applies to companies, not funds');

        await page.goBack();
        await expect(page).toHaveURL(/#\/markets$/);
        await expect(page.getByRole('heading', { name: 'Market Map' })).toBeVisible();
        await page.goForward();
        await expect(page).toHaveURL(/#\/markets\/GOLD$/);

        await page.getByTestId('market-detail-back').click();
        await expect(page).toHaveURL(/#\/markets$/);
        await expect(page.getByRole('heading', { name: 'Market Map' })).toBeVisible();
    });

    test('lists the first missing commodity connection as the next step', async ({ page }) => {
        const physicalPending = structuredClone(goldTheme);
        physicalPending.stages[0].status = 'DISCONNECTED';

        const equityPending = structuredClone(goldTheme);
        equityPending.code = 'SILVER';
        equityPending.display_name = 'Silver';
        equityPending.stages[1].status = 'DISCONNECTED';

        const outperformPending = structuredClone(goldTheme);
        outperformPending.code = 'COPPER';
        outperformPending.display_name = 'Copper';
        outperformPending.stages[3].status = 'DISCONNECTED';
        outperformPending.stages[3].blocked_security_count = 0;
        outperformPending.eligible_securities?.forEach((security) => {
            security.stage_states.SECURITY_OUTPERFORM = 'DISCONNECTED';
        });

        await page.addInitScript(() => {
            window.localStorage.setItem('alpha-edge-api-token', 'local-test-token');
        });
        await mockMarketApi(page, [physicalPending, equityPending, outperformPending]);
        await page.route('https://s3.tradingview.com/**', (route) => route.abort());

        await page.goto('/');
        await page.getByTestId('main-tab-markets').click();

        await expect(page.getByTestId('market-theme-GOLD').locator('[data-market-stage-label="COMMODITY"]')).toHaveText('');
        await expect(page.getByTestId('market-next-step-GOLD')).toHaveText('Connect physical CDF');
        await expect(page.getByTestId('market-next-step-SILVER')).toHaveText('Connect equity CDF');
        await expect(page.getByTestId('market-next-step-COPPER')).toHaveText('Connect 4 Outperform CDFs');

        await page.getByTestId('market-next-step-GOLD').click();
        await expect(page).toHaveURL(/#\/alerts$/);
    });

    test('highlights a market row and saves a source-pair configuration without opening the detail route', async ({ page }) => {
        const theme = structuredClone(goldTheme);
        let savedPayload: Record<string, unknown> | null = null;
        let savedDirectExpressionPayload: Record<string, unknown> | null = null;
        await page.addInitScript(() => {
            window.localStorage.setItem('alpha-edge-api-token', 'local-test-token');
        });
        await mockMarketApi(page, [theme]);
        await page.route('**/api/commodity-themes/GOLD/configuration', async (route) => {
            savedPayload = route.request().postDataJSON() as Record<string, unknown>;
            const commodity = savedPayload.commodity as Record<string, string>;
            const equity = savedPayload.equity_relative as Record<string, string>;
            theme.display_name = String(savedPayload.display_name);
            theme.market_group = String(savedPayload.market_group);
            theme.stages[0]!.source = {
                kind: 'UNDERLYING_PRICE',
                symbol: commodity.symbol,
                label: commodity.label,
            };
            theme.stages[1]!.source = {
                kind: 'RELATIVE_STRENGTH',
                numerator: equity.numerator,
                denominator: equity.denominator,
                label: equity.label,
            };
            theme.stages[3]!.source = {
                kind: 'RELATIVE_STRENGTH',
                numerator: 'SECURITY',
                denominator: equity.numerator,
                label: 'Company / core fund',
            };
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(theme) });
        });
        await page.route('**/api/commodity-themes/GOLD/direct-expression', async (route) => {
            savedDirectExpressionPayload = route.request().postDataJSON() as Record<string, unknown>;
            theme.direct_expression = {
                status: String(savedDirectExpressionPayload.status) as 'SIGNAL_ONLY' | 'APPROVED',
                instrument_label: String(savedDirectExpressionPayload.instrument_label || '') || undefined,
                instrument_ticker: String(savedDirectExpressionPayload.instrument_ticker || '') || undefined,
                instrument_kind: String(savedDirectExpressionPayload.instrument_kind || '') || undefined,
                existing_position_treatment: 'CLASS_DEFINED',
            };
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(theme) });
        });
        await page.route('https://s3.tradingview.com/**', (route) => route.abort());

        await page.goto('/');
        await page.getByTestId('main-tab-markets').click();

        const row = page.getByTestId('market-theme-GOLD');
        const marketRow = page.getByTestId('market-row-GOLD');
        const edit = page.getByTestId('market-edit-GOLD');
        const identityContent = row.locator('[data-market-identity-content]');
        const addMarket = page.getByTestId('market-add');
        const refreshPrices = page.getByTestId('market-price-history-refresh');
        await expect(edit).toHaveCSS('opacity', '0');
        await expect(addMarket).toHaveCSS('width', '36px');
        await expect(refreshPrices).toHaveCSS('width', '36px');
        const backgroundBeforeHover = await marketRow.evaluate((element) => getComputedStyle(element).backgroundColor);
        const identityBeforeHover = await identityContent.boundingBox();
        await row.hover();
        await page.waitForTimeout(120);
        const backgroundOnHover = await marketRow.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(backgroundOnHover).not.toBe(backgroundBeforeHover);
        const rowBox = await row.boundingBox();
        if (!rowBox) throw new Error('Gold market row has no bounding box');
        await page.mouse.move(rowBox.x + 12, rowBox.y + 26);
        await expect(edit).toHaveCSS('opacity', '1');
        await expect(edit).toBeVisible();
        await expect(edit).toHaveCSS('border-top-width', '0px');
        await expect(identityContent).toHaveCSS('margin-left', '68px');
        const editBox = await edit.boundingBox();
        const identityOnEditHover = await identityContent.boundingBox();
        expect(editBox?.width).toBeGreaterThanOrEqual(64);
        expect((identityOnEditHover?.x || 0) - (identityBeforeHover?.x || 0)).toBeGreaterThanOrEqual(50);
        expect((identityOnEditHover?.x || 0) + 0.5).toBeGreaterThanOrEqual((editBox?.x || 0) + (editBox?.width || 0));
        await edit.click();
        await expect(page).toHaveURL(/#\/markets$/);

        const dialog = page.getByTestId('market-configuration-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS('max-width', '920px');
        await expect(dialog.getByLabel('Close market configuration')).toHaveCSS('width', '32px');
        await expect(dialog.getByLabel('Market name')).toHaveCSS('height', '34px');
        await expect(dialog.getByLabel('Market name')).toHaveCSS('padding-left', '10px');
        await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCSS('height', '34px');
        await expect(dialog.getByTestId('market-direct-expression')).toBeVisible();
        await expect.poll(() => dialog.getByLabel('Market name').evaluate((input) => getComputedStyle(input, '::placeholder').opacity)).toBe('0.4');
        await dialog.getByLabel('Market name').fill('Gold producers');
        await dialog.getByLabel('Equity numerator').fill('AMEX:GDXJ');
        await dialog.getByLabel('Display label').last().fill('GDXJ / GLD');
        await dialog.getByLabel('Available through IG').check();
        await dialog.getByLabel('IG product').fill('Gold CFD');
        await dialog.getByLabel('IG market / epic').fill('CS.D.CFDGOLD.CE');
        await dialog.getByLabel('Type').selectOption('CFD');
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();

        await expect.poll(() => savedPayload).toMatchObject({
            display_name: 'Gold producers',
            commodity: { symbol: 'AMEX:GLD' },
            equity_relative: { numerator: 'AMEX:GDXJ', denominator: 'AMEX:GLD' },
        });
        await expect.poll(() => savedDirectExpressionPayload).toMatchObject({
            status: 'APPROVED',
            instrument_label: 'Gold CFD',
            instrument_ticker: 'CS.D.CFDGOLD.CE',
            instrument_kind: 'CFD',
        });
        await expect(page.getByTestId('market-theme-GOLD')).toContainText('Gold producers');
        await expect(page.getByTestId('market-theme-GOLD').locator('[data-market-identity-pair]')).toHaveText('GDXJ / GLD');
    });

    test('keeps each embedded chart iframe aligned with its full visual card', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));
        await page.addInitScript(() => {
            window.localStorage.setItem('alpha-edge-api-token', 'local-test-token');
        });
        await mockMarketApi(page);
        await page.route('https://s3.tradingview.com/external-embedding/**', (route) => route.fulfill({
            contentType: 'application/javascript',
            body: `(() => {
                const host = document.currentScript.parentElement.querySelector('.tradingview-widget-container__widget');
                const frame = document.createElement('iframe');
                frame.style.width = '100%';
                frame.style.height = '20%';
                host.appendChild(frame);
            })();`,
        }));

        await page.goto('/');
        await page.getByTestId('main-tab-markets').click();
        await page.getByTestId('market-theme-GOLD').click();
        await expect(page.getByRole('heading', { name: 'Gold' })).toBeVisible();
        const chart = page.getByTestId('market-chart-COMMODITY');
        await chart.scrollIntoViewIfNeeded();
        const chartSurface = chart.locator('.tradingview-widget-container');
        const frame = chartSurface.locator('iframe');
        await expect(frame).toBeAttached();
        await expect(chartSurface).toHaveCSS('height', '250px');
        await expect(frame).toHaveCSS('height', '250px');
        await expect.poll(async () => frame.evaluate((element) => {
            const frameWidth = element.getBoundingClientRect().width;
            const hostWidth = element.parentElement?.getBoundingClientRect().width ?? 0;
            return Math.round(frameWidth) === Math.round(hostWidth);
        })).toBe(true);

        await page.getByTestId('market-detail-back').click();
        await expect(page.getByRole('heading', { name: 'Market Map' })).toBeVisible();
        expect(pageErrors).toEqual([]);
    });

});
