const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const date = '2026-09-16T00:00:00Z';
const holding = (id, ticker, details, quantity = 100, value = 3000) => ({
    id, ticker, details, quantity, market_value: value, value_aud: value,
    exchange_prefix: 'ASX:', current_price: quantity ? value / quantity : 0,
    cost_aud: 2000, cash_reserve: 0, gain_loss_aud: 0, gain_loss_pct: 0,
});
const groupRow = (page, name) => page.locator('.positions-grid tr.positions-parent-row').filter({
    has: page.locator('span').filter({ hasText: new RegExp(`^${name}( \\(\\d+\\))?$`) }),
});
const securityRow = (page, name) => page.locator('.positions-stock-row').filter({ hasText: name });

async function setup(t, { nested = false, zeroValue = false, actions = false } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.clock.install();
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const groups = [
        { id: 'gold', name: 'Gold Miners', asset_class_code: 'GOLD_MINERS', order: 0, collapsed: false, parent_id: nested ? 'materials' : null },
        { id: 'silver', name: 'Silver Miners', asset_class_code: 'SILVER_MINERS', order: 1, collapsed: false, parent_id: nested ? 'materials' : null },
        { id: 'empty', name: 'Energy Producers', asset_class_code: 'ENERGY_PRODUCERS', order: 2, collapsed: false, parent_id: nested ? 'empty-parent' : null },
    ];
    if (nested) groups.push(
        { id: 'materials', name: 'Materials', order: 0, collapsed: false, parent_id: null },
        { id: 'empty-parent', name: 'Empty parent', order: 1, collapsed: false, parent_id: null },
    );
    const state = { holdings: [holding(1, 'GOLD', 'Gold Core ETF'), holding(2, 'STOCK', 'Gold Producer'), holding(3, 'SILV', 'Silver Core ETF')] };
    if (zeroValue) {
        state.holdings[0] = holding(1, 'GOLD', 'Gold Core ETF', 0, 0);
        state.holdings[1] = holding(2, 'STOCK', 'Gold Producer', 0, 0);
        state.holdings[2] = holding(3, 'SILV', 'Silver Core ETF', 100, 0);
    }
    const assignments = [
        { company_name: 'Gold Core ETF', group_id: 'gold' },
        { company_name: 'Gold Producer', group_id: 'gold' },
        { company_name: 'Silver Core ETF', group_id: 'silver' },
        { company_name: 'Alternative Gold ETF', group_id: 'gold' },
    ];
    const groupWrites = [];
    await page.route('**/api/**/asset-classes', route => route.fulfill({ json: [
        ['GOLD_MINERS', 'Gold Miners'], ['SILVER_MINERS', 'Silver Miners'],
        ['ENERGY_PRODUCERS', 'Energy Producers'], ['CASH', 'Cash/Reserve'],
    ].map(([code, display_name], display_order) => ({
        code, asset_class_code: code, display_name, display_order,
        active: true, allow_grouping: true, allow_target_weight: true,
    })) }));
    await page.route('**/api/**/groups', async route => {
        if (route.request().method() !== 'GET') groupWrites.push(route.request().postDataJSON());
        await route.fulfill({ json: { groups, assignments } });
    });
    await page.route('**/api/**/statements/latest', route => route.fulfill({ json: {
        statement: { id: 1, statement_date: date, total_value_aud: 10000, cash_aud: 1000 }, holdings: state.holdings,
    } }));
    if (actions) await page.route('**/api/**/portfolio-overlay-summary', route => route.fulfill({ json: {
        portfolio_value: 10000, total_portfolio_value: 10000, total_cash: 4000,
        active_event_id: 1, active_event_status: 'PENDING', active_event_governing_source: 'Q3D',
        active_event_signal_value: 50, signal_adjustment_ratio: .5, required_de_risk_value: 3000,
        portfolio_cash_bucket_value: 4000, asset_classes: [{ asset_class: 'GOLD_MINERS', display_name: 'Gold Miners',
            target_weight_pct: 30, strategic_weight_pct: 60, actual_invested_value: 6000,
            allowed_invested_value: 3000, actual_value: 6000, delta_value: 3000, overlay_eligible: true, q1_category: true }],
    } }));
    await page.goto(`${base}/#/positions`);
    await expect(page.locator('.positions-grid')).toHaveAttribute('aria-busy', 'false');
    await expect(securityRow(page, 'Silver Core ETF')).toBeVisible();
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    const refresh = async () => {
        const response = page.waitForResponse(response => response.url().endsWith('/statements/latest'));
        await page.clock.fastForward(121000);
        await response;
    };
    return { page, state, refresh, groupWrites };
}

test('last exit hides its class and empty parents, partial exits keep siblings, repurchase restores the saved group', { timeout: 90000 }, async t => {
    const { page, state, refresh, groupWrites } = await setup(t, { nested: true });
    await expect(groupRow(page, 'Empty parent')).toHaveCount(0);
    await expect(groupRow(page, 'Energy Producers')).toHaveCount(0);
    await expect(groupRow(page, 'Materials')).toBeVisible();
    state.holdings = state.holdings.filter(item => item.ticker !== 'GOLD');
    await refresh();
    await expect(securityRow(page, 'Gold Core ETF')).toHaveCount(0);
    await expect(groupRow(page, 'Gold Miners')).toContainText('(1)');
    state.holdings = state.holdings.filter(item => item.ticker !== 'STOCK');
    await refresh();
    await expect(groupRow(page, 'Gold Miners')).toHaveCount(0);
    await expect(groupRow(page, 'Silver Miners')).toBeVisible();
    await expect(groupRow(page, 'Materials')).toBeVisible();
    state.holdings = [];
    await refresh();
    await expect(page.locator('.positions-parent-row')).toHaveCount(0);
    await expect(page.locator('.positions-grid')).toContainText('Cash/Reserve');
    state.holdings = [holding(1, 'GOLD', 'Gold Core ETF')];
    await refresh();
    await expect(groupRow(page, 'Gold Miners')).toBeVisible();
    await expect(groupRow(page, 'Materials')).toBeVisible();
    assert.deepEqual(groupWrites, [], 'filtering must not delete or rewrite saved groups');
});

test('zero units and value hide an exited class, but unpriced held units and research remain visible', { timeout: 90000 }, async t => {
    const { page, groupWrites } = await setup(t, { zeroValue: true });
    await expect(groupRow(page, 'Gold Miners')).toHaveCount(0);
    await expect(groupRow(page, 'Silver Miners')).toBeVisible();
    await expect(securityRow(page, 'Gold Producer')).toHaveCount(0);
    await page.getByTestId('main-tab-analysis').click();
    await expect(page.locator('.analysis-grid .analysis-company-name').filter({ hasText: 'Gold Producer' })).toBeVisible();
    await expect(page.locator('.analysis-hierarchy-label').filter({ hasText: /^gold miners$/i })).toBeVisible();
    assert.deepEqual(groupWrites, []);
});

test('collapse controls ignore hidden groups without deleting their saved configuration', { timeout: 90000 }, async t => {
    const { page, groupWrites } = await setup(t, { zeroValue: true });
    await groupRow(page, 'Silver Miners').locator('[data-position-class-label]').click();
    const toggle = page.getByTestId('positions-groups-collapse-toggle');
    await expect(toggle).toHaveAttribute('aria-label', 'Expand all groups');
    await toggle.click();
    await expect(securityRow(page, 'Silver Core ETF')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-label', 'Collapse all groups');
    await toggle.click();
    await expect(securityRow(page, 'Silver Core ETF')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-label', 'Expand all groups');
    assert.ok(groupWrites.length >= 3);
    assert.ok(groupWrites.every(write => write.groups.length === 3), 'hidden groups remain saved');
    assert.ok(groupWrites.every(write => write.groups.find(group => group.id === 'gold').collapsed === false));
});

test('Actions retains class evidence even when Normal Positions hides the exited class', { timeout: 90000 }, async t => {
    const { page, groupWrites } = await setup(t, { zeroValue: true, actions: true });
    await expect(groupRow(page, 'Gold Miners')).toHaveCount(0);
    await page.getByTestId('positions-actions-tab').click();
    await expect(page.locator('.positions-actions-grid')).toContainText('Gold Miners');
    assert.deepEqual(groupWrites, []);
});
