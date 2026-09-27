const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const date = new Date().toISOString();
    const security = (id, ticker, name, assetClass, performance, extra = {}) => ({
        id, ticker, name, primary_asset_class: assetClass, security_type: 'STOCK',
        is_watchlist: true, current_price: 30, allocation: 10, include_in_sizing: true,
        performance_6m_pct: performance, performance_as_of: date,
        ...extra,
    });
    await page.route('**/api/**/analysis', route => route.fulfill({ json: [
        security(1, 'ASX:GOLD', 'Gold Core ETF', 'GOLD_MINERS', 30, { security_type: 'ETF', is_watchlist: false }),
        security(2, 'ASX:STOCK', 'Gold Producer', 'GOLD_MINERS', -10, { is_watchlist: false }),
        security(3, 'ASX:SILV', 'Silver Core ETF', 'SILVER_MINERS', -20, { security_type: 'ETF', performance_as_of: '2020-01-01' }),
        security(4, 'ASX:ALT', 'Alternative Gold ETF', 'GOLD_MINERS', null, { security_type: 'ETF' }),
        security(5, 'ASX:ZERO', 'Zero Return Technology', 'TECHNOLOGY', 0),
        security(6, 'ASX:NODATA', 'Unpriced Insurance', 'INSURANCE', null),
        security(7, 'ASX:PHRA', 'Pharma A', 'PHARMA', 30),
        security(8, 'ASX:PHRB', 'Pharma B', 'PHARMA', -10),
        security(9, 'ASX:PHRC', 'Pharma C', 'PHARMA', null),
        security(10, 'ASX:MED', 'Medical Technology', 'MEDTECH', -20, { performance_as_of: '2020-01-01' }),
    ] }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/positions`);
    await expect(page.getByRole('button', { name: 'Select theme', exact: true })).toBeVisible();
    await page.getByTestId('main-tab-analysis').click();
    return { page, fixture, errors };
}

const group = (page, label) => page.locator('.analysis-grid tr').filter({
    has: page.locator('.analysis-hierarchy-label').filter({ hasText: new RegExp(`^${label}$`, 'i') }),
});

test('Analysis headings show comparable 6M returns with coverage, neutral missing data and stale warnings', { timeout: 90000 }, async t => {
    const { page, fixture, errors } = await setup(t);
    const gold = group(page, 'Gold Miners');
    const silver = group(page, 'Silver Miners');
    const technology = group(page, 'Technology');
    const healthcare = group(page, 'Healthcare');
    const insurance = group(page, 'Insurance');
    await expect(gold.locator('.analysis-section-stats')).toHaveText('+10.0%');
    await expect(gold.getByText('+10.0%', { exact: true })).toHaveClass(/text-success/);
    await expect(gold.locator('.analysis-section-stats')).toHaveAttribute('title', /2 of 3 securities/);
    await expect(gold.locator('.analysis-section-stats')).toHaveAttribute('title', /six-month adjusted-close returns/);
    await expect(gold.locator('.analysis-section-stats')).toHaveAttribute('title', /not portfolio P\/L or a sector index/);
    await expect(silver.locator('.analysis-section-stats')).toHaveText('-20.0%Stale');
    await expect(silver.getByText('-20.0%', { exact: true })).toHaveClass(/text-destructive/);
    await expect(silver.locator('.analysis-section-stats')).toHaveAttribute('title', /Oldest price data: 2020-01-01/);
    await expect(healthcare.locator('.analysis-section-stats')).toHaveText('0.0%Stale');
    await expect(healthcare.locator('.analysis-section-stats')).toHaveAttribute('title', /3 of 4 securities/);
    await expect(technology.locator('.analysis-section-stats')).toHaveText('0.0%');
    await expect(technology.getByText('0.0%', { exact: true })).toHaveClass(/text-muted-foreground/);
    await expect(insurance.locator('.analysis-section-stats')).toHaveText('\u2014');
    await expect(insurance.locator('.analysis-section-stats')).toHaveAttribute('title', /0 of 1 securities/);
    for (const row of [gold, silver, technology, healthcare, insurance]) {
        assert.doesNotMatch(await row.innerText(), /\$|score|\bstocks?\b/i);
    }

    await gold.locator('.analysis-hierarchy-label').click();
    await expect(gold.locator('.analysis-section-stats')).toHaveText('+10.0%');
    await gold.locator('.analysis-hierarchy-label').click();
    const search = page.getByRole('searchbox', { name: 'Find a security in Analysis' });
    await search.fill('Gold Producer');
    await expect(gold.locator('.analysis-section-stats')).toHaveText('-10.0%');
    await expect(gold.locator('.analysis-section-stats')).toHaveAttribute('title', /1 of 1 securities/);
    await search.fill('');
    await expect(gold.locator('.analysis-section-stats')).toHaveText('+10.0%');
    await page.getByTestId('analysis-focus-asset-GOLDMINERS').click();
    await expect(technology).toHaveCount(0);
    await expect(gold.locator('.analysis-section-stats')).toHaveText('+10.0%');
    await page.getByTestId('analysis-clear-asset-class-focus').click();
    await expect(technology).toHaveCount(1);
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('Analysis performance headings preserve row sizing and label separation in both themes and narrow layouts', { timeout: 90000 }, async t => {
    const { page, errors } = await setup(t);
    const gold = group(page, 'Gold Miners');
    await expect(gold.locator('.analysis-section-stats')).toContainText('+10.0%');
    const initialHeight = (await gold.boundingBox()).height;
    for (const light of [false, true]) {
        if (light) await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
        for (const width of [1600, 1280, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await expect.poll(async () => {
                const title = await gold.locator('.analysis-hierarchy-label').boundingBox();
                const stats = await gold.locator('.analysis-section-stats').boundingBox();
                const row = await gold.boundingBox();
                return title.x + title.width <= stats.x && stats.y >= row.y && stats.y + stats.height <= row.y + row.height;
            }).toBe(true);
            assert.ok(Math.abs((await gold.boundingBox()).height - initialHeight) <= 1);
            assert.ok(parseFloat(await gold.getByText('+10.0%', { exact: true }).evaluate(el => getComputedStyle(el).fontSize)) >= 12);
            const insetRem = await gold.locator('.analysis-section-stats').evaluate(el =>
                parseFloat(getComputedStyle(el).marginInlineEnd) / parseFloat(getComputedStyle(document.documentElement).fontSize));
            assert.equal(insetRem, 1.5);
            await page.screenshot({ path: `/tmp/analysis-group-performance-${light ? 'light' : 'dark'}-${width}.png` });
        }
        await page.setViewportSize({ width: 1600, height: 1000 });
    }
    assert.deepEqual(errors, []);
});
