const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');

const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, { rankingUnavailable = false } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const today = new Date().toISOString().slice(0, 10);
    const security = (id, ticker, name, type, performance, extra = {}) => ({
        id, ticker: `ASX:${ticker}`, name, security_type: type,
        primary_asset_class: 'GOLD_MINERS', is_watchlist: true,
        current_price: 30, include_in_sizing: true,
        gemini_quality: 70, gemini_value: 80, gemini_pt: 60,
        performance_6m_pct: performance, performance_as_of: today,
        ...extra,
    });
    await page.route('**/api/**/analysis', route => route.fulfill({ json: [
        security(1, 'GOLD', 'Gold Core ETF', 'ETF', 30, { is_watchlist: false }),
        security(2, 'STOCK', 'Gold Producer', 'STOCK', 10, { is_watchlist: false }),
        security(3, 'LOW', 'Negative ETF', 'ETF', -20, { performance_as_of: '2020-01-01' }),
        security(4, 'ALT', 'Missing History ETF', 'ETF', null),
        security(5, 'ZERO', 'Zero Return ETF', 'ETF', 0),
        security(6, 'LOSS', 'Negative Stock', 'STOCK', -5),
        security(7, 'FLAT', 'Zero Return Stock', 'STOCK', 0),
        security(8, 'NONE', 'Missing History Stock', 'STOCK', null),
    ] }));
    await page.route('**/api/**/etf/momentum', route => rankingUnavailable
        ? route.fulfill({ status: 503, body: 'Ranking unavailable' })
        : route.fulfill({ json: {
            latest_run: { id: 1, data_fresh_through: today, rows: [
                { ticker: 'ASX:GOLD', status: 'READY', rank: 3, return_80_pct: -80, score: 3.2, final_weight_pct: 20 },
                { ticker: 'ASX:LOW', status: 'READY', rank: 2, return_80_pct: 80, score: 4.2, final_weight_pct: 30 },
                { ticker: 'ASX:ALT', status: 'READY', rank: 1, return_80_pct: 90, score: 5.2, final_weight_pct: 50 },
            ] }, automation: {},
        } }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/analysis`);
    await expect(page.locator('.analysis-grid')).toBeVisible();
    const nameCell = name => page.locator('.analysis-company-name').filter({ hasText: new RegExp(`^${name}$`) });
    const row = name => page.locator('.analysis-grid tbody tr').filter({ has: nameCell(name) });
    const columnIndex = await page.locator('.analysis-grid th[data-column-key="performance6m"]').evaluate(el => el.cellIndex);
    const momentum = name => row(name).locator('td').nth(columnIndex);
    await expect(momentum('Gold Core ETF')).toHaveText('+30.0%');
    return { page, row, momentum, fixture, errors };
}

test('Analysis uses shared six-month returns, not ETF ranking returns, and preserves stock-only modifiers', { timeout: 90000 }, async t => {
    const { page, momentum, fixture, errors } = await setup(t);
    await expect(momentum('Negative ETF')).toHaveText('-20.0%');
    await expect(momentum('Zero Return ETF')).toHaveText('0.0%');
    await expect(momentum('Missing History ETF')).toHaveText('-');
    await expect(momentum('Missing History Stock')).toHaveText('-');
    await expect(momentum('Missing History ETF')).toHaveAttribute('title', /Insufficient.*six-month/);
    await expect(momentum('Gold Core ETF')).toHaveAttribute('title', /6M adjusted-close return \+30.0%/);
    await expect(momentum('Negative ETF')).toHaveAttribute('title', /2020-01-01.*stale/);
    await expect(momentum('Gold Core ETF')).toHaveAttribute('title', /no stock sizing modifier/);
    await expect(momentum('Gold Core ETF').locator('.analysis-momentum-modifier')).toHaveCount(0);
    await expect(momentum('Gold Producer').locator('.analysis-momentum-return')).toHaveText('+10.0%');
    await expect(momentum('Gold Producer').locator('.analysis-momentum-modifier')).toHaveText('+3.1');
    await expect(momentum('Zero Return Stock').locator('.analysis-momentum-return')).toHaveText('0.0%');
    await expect(momentum('Zero Return Stock').locator('.analysis-momentum-modifier')).toHaveText('+2.5');
    for (const light of [false, true]) {
        if (light) await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
        const returnValue = name => momentum(name).locator('.analysis-momentum-return');
        await expect(returnValue('Gold Core ETF')).toHaveAttribute('style', /color: var\(--signal-buy\)/);
        await expect(returnValue('Negative ETF')).toHaveAttribute('style', /color: var\(--signal-sell\)/);
        // Sign-only colour: any positive return is buy-toned, zero is neutral.
        await expect(returnValue('Gold Producer')).toHaveAttribute('style', /color: var\(--signal-buy\)/);
        await expect(returnValue('Zero Return ETF')).toHaveAttribute('style', /color: var\(--muted-foreground\)/);
        const stockColour = name => returnValue(name).evaluate(el => getComputedStyle(el).color);
        await expect(returnValue('Negative ETF')).toHaveCSS('color', await stockColour('Negative Stock'));
        await expect(returnValue('Zero Return ETF')).toHaveCSS('color', await stockColour('Zero Return Stock'));
        for (const width of [1600, 1280, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            const etfReturn = momentum('Gold Core ETF').locator('.analysis-momentum-return');
            await etfReturn.hover();
            await expect(etfReturn).toHaveCSS('opacity', '0.9');
            await expect(etfReturn).toHaveText('+30.0%');
            await momentum('Missing History ETF').hover();
            await expect(momentum('Missing History ETF').locator('.analysis-score-empty')).toHaveCSS('opacity', '1');
            await page.screenshot({ path: `/tmp/analysis-momentum-${light ? 'light' : 'dark'}-${width}.png` });
        }
        await page.setViewportSize({ width: 1600, height: 1000 });
    }
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('MOM sorts ETFs and stocks by six-month returns in both directions, retaining ETF-first grouping', { timeout: 90000 }, async t => {
    const { page, errors } = await setup(t);
    const order = () => page.locator('.analysis-grid .analysis-company-name').allTextContents();
    await page.getByRole('button', { name: 'MOM: sort descending', exact: true }).click();
    await expect.poll(order).toEqual([
        'Gold Core ETF', 'Zero Return ETF', 'Negative ETF', 'Missing History ETF',
        'Gold Producer', 'Zero Return Stock', 'Negative Stock', 'Missing History Stock',
    ]);
    await page.getByRole('button', { name: 'MOM: sorted descending', exact: true }).click();
    await expect.poll(order).toEqual([
        'Missing History ETF', 'Negative ETF', 'Zero Return ETF', 'Gold Core ETF',
        'Missing History Stock', 'Negative Stock', 'Zero Return Stock', 'Gold Producer',
    ]);
    assert.deepEqual(errors, []);
});

test('ETF ranking remains on its independent 80-session return', { timeout: 90000 }, async t => {
    const { page, errors } = await setup(t);
    await page.goto(`${base}/#/etf`);
    await page.getByRole('group', { name: 'ETF view', exact: true }).getByRole('button', { name: 'Momentum', exact: true }).click();
    await expect(page.locator('[data-mobile-label="80D return"]')).toHaveText(['+90.0%', '+80.0%', '-80.0%']);
    assert.deepEqual(errors, []);
});

test('Analysis ETF returns do not depend on the ETF ranking service', { timeout: 90000 }, async t => {
    const { momentum, errors } = await setup(t, { rankingUnavailable: true });
    await expect(momentum('Gold Core ETF')).toHaveText('+30.0%');
    await expect(momentum('Zero Return ETF')).toHaveText('0.0%');
    await expect(momentum('Missing History ETF')).toHaveText('-');
    assert.deepEqual(errors, []);
});
