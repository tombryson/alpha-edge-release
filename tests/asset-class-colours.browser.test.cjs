const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const gold = 'rgb(212, 167, 44)';
const silver = 'rgb(192, 199, 210)';

test('class colours match in the pie, sidebar, portfolio and history across themes', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    await panel.getByRole('tab', { name: 'Shape', exact: true }).click();
    for (const light of [false, true]) {
        if (light) await page.getByTitle('Switch to light mode', { exact: true }).click();
        const reference = panel.getByRole('img', { name: 'Reference shape allocation' });
        await expect(reference.getByTitle('Gold Miners: 60.0%', { exact: true })).toHaveCSS('background-color', gold);
        await expect(reference.getByTitle('Silver Miners: 30.0%', { exact: true })).toHaveCSS('background-color', silver);
        await expect(panel.getByRole('row').filter({ hasText: 'Gold Miners' }).locator('i')).toHaveCSS('background-color', gold);
        await expect(page.getByTestId('sleeve-summary-dock').locator('svg path[fill*="--asset-class-colour-GOLD_MINERS"]').first()).toHaveCSS('fill', gold);
        await page.screenshot({ path: `/tmp/asset-class-colours-${light ? 'light' : 'dark'}.png` });
    }
    await page.goto(`${base}/#/portfolio`);
    await expect(page.locator('[class*="titleLine"]').filter({ hasText: 'Gold Miners' }).locator('[class*="swatch"]')).toHaveCSS('background-color', gold);
    await panel.getByLabel('Reference portfolio shape').selectOption('shape:3');
    await expect(panel.getByRole('img', { name: 'Reference shape allocation' }).getByTitle('Gold Miners: 30.0%', { exact: true })).toHaveCSS('background-color', gold);
    await expect(panel.getByRole('img', { name: 'Reference shape allocation' }).getByTitle('Silver Miners: 60.0%', { exact: true })).toHaveCSS('background-color', silver);
    assert.deepEqual(errors, []);
    assert.equal(fixture.writes.length, 0);
});

test('Markets identity and Alert Stack ignore status/legacy palettes without recolouring signals', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const fixture = await mockContextPanel(page);
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
        localStorage.setItem('alpha-edge-alert-stack-ui', JSON.stringify({ pinnedAssetClasses: { 'GOLD|#ff00ff': true }, allAssetClassesExpanded: false }));
    });
    const stage = (key, status, signal) => ({ key, status, signal, label: key, order: 1, scope: 'THEME', source: { kind: 'SYMBOL', symbol: 'AMEX:GLD' } });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/asset-class-config')) return route.fulfill({ json: [{ key: 'GOLD_MINERS', display_name: 'Gold Miners', alert_label: 'Gold', alert_color: '#ff00ff', active: true }] });
        if (path.endsWith('/security-actions')) return route.fulfill({ json: [{ id: 1, alert_id: 100, ticker: 'STOCK', alert_type: 'TRIM', strength: 'Weak', scope: 'SECURITY', intent: 'REDUCE', status: 'OPEN', is_primary: true, created_at: '2026-09-09T10:00:00Z' }] });
        if (path.endsWith('/commodity-themes')) return route.fulfill({ json: { themes: [{ code: 'GOLD', display_name: 'Gold', market_group: 'Precious metals', status: 'BLOCKED', confirmation_count: 1, confirmation_total: 4, equity_sleeve: { asset_class_code: 'GOLD_MINERS' }, tactical: { asset_class_code: 'GOLD_MINERS' }, strategic_floor: { asset_class_code: 'PHYSICAL_GOLD' }, direct_expression: {}, direct_sleeve: {}, reviews: [], eligible_securities: [], stages: [stage('COMMODITY', 'CONFIRMED', 'BUY'), stage('EQUITY_RELATIVE', 'BLOCKED', 'SELL')] }] } });
        return route.fallback();
    });
    await page.goto(`${base}/#/markets`);
    const market = page.getByTestId('market-row-GOLD');
    await expect(market.locator('[data-market-identity-bar]')).toHaveCSS('background-color', gold);
    await expect(market.locator('[data-market-stage-label="COMMODITY"]')).toContainText('BULL');
    await expect(market.locator('[data-market-stage-label="EQUITY_RELATIVE"]')).toContainText('BEAR');
    const node = market.locator('[data-market-stage-node="COMMODITY"]');
    assert.notEqual(await node.evaluate(el => getComputedStyle(el).backgroundColor), gold);
    await expect(page.locator('[class*="groupHeaderRail"]').first()).toHaveCSS('background-color', gold);
    const alertGroup = page.locator('[data-expanded]').filter({ has: page.getByTestId('stack-alert-100') });
    await expect(alertGroup).toHaveAttribute('data-expanded', 'true');
    await page.locator('[class*="groupHeaderRail"]').first().locator('..').click();
    await page.mouse.move(500, 10);
    await expect(alertGroup).toHaveAttribute('data-expanded', 'false');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha-edge-alert-stack-ui')).pinnedAssetClasses.GOLD_MINERS), false);
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect(market.locator('[data-market-identity-bar]')).toHaveCSS('background-color', gold);
    await expect(page.locator('[class*="groupHeaderRail"]').first()).toHaveCSS('background-color', gold);
    assert.equal(fixture.writes.length, 0);
});
