const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const issueButton = page => page.getByRole('button', { name: /Open data issues$/ });
const panel = page => page.getByRole('dialog', { name: 'Data issues', exact: true });
const exchangeSection = page => panel(page).locator('section').filter({ hasText: 'Missing exchanges' });
async function toggleFilter(page) {
    await issueButton(page).click();
    await exchangeSection(page).getByRole('button', { name: /Review securities|Show all securities/ }).click();
    await expect(panel(page)).toBeHidden();
}
async function expectMissingCount(page, count) {
    await issueButton(page).click();
    if (count) await expect(exchangeSection(page)).toContainText(`${count} ${count === 1 ? 'security' : 'securities'}`);
    else await expect(exchangeSection(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
}
const rowFor = (page, name) => page.locator('.analysis-stock-row').filter({
    has: page.getByRole('button', { name, exact: true }),
});

async function setup(t, width = 1440) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const fixture = await mockContextPanel(page);
    await page.route('**/api/**/data-freshness', route => route.fulfill({ json: {
        generated_at: '2026-09-16T00:00:00Z', scheduler: {},
        datasets: ['ANALYSIS_PRICE_HISTORY', 'ETF_MOMENTUM', 'COMMODITY_PRICE_HISTORY', 'REGIME_RETURNS', 'LISTING_VERIFICATION', 'NEWS_DAILY', 'BROKER_STATEMENTS', 'TRADINGVIEW_SIGNALS'].map(dataset => ({
            dataset, status: 'COMPLETE', update_mode: 'DAILY', coverage_complete: true,
            records_expected: 10, records_updated: 10, error_count: 0, data_fresh_through: '2026-09-16',
        })),
    } }));
    const analysis = [
        [1, 'ASX:GOLD', 'Gold Core ETF', 'ETF', false],
        [2, 'STOCK', 'Gold Producer', 'STOCK', false],
        [3, 'SILV', 'Silver Core ETF', 'ETF', true],
        [4, 'ALT', 'Alternative Gold ETF', 'ETF', true],
        [5, 'OLD', 'Hidden entitlement', 'NON_ALLOCATING', true],
    ].map(([id, ticker, name, security_type, is_watchlist]) => ({
        id, ticker, name, security_type, is_watchlist,
        primary_asset_class: id === 3 ? 'SILVER_MINERS' : 'GOLD_MINERS',
        include_in_sizing: true, current_price: 30,
        gemini_quality: 70, gemini_value: 80, gemini_pt: 60,
    }));
    const holdings = analysis.slice(0, 2).map(record => ({
        id: record.id, ticker: record.ticker.split(':').pop(), details: record.name,
        exchange_prefix: record.id === 1 ? 'ASX:' : '',
        quantity: 100, current_price: 30, market_value: 3000, value_aud: 3000,
        cost_aud: 2000, gain_loss_pct: 50, cash_reserve: 0,
    }));
    const writes = [];
    await page.route('**/api/**/analysis', route => route.fulfill({ json: analysis }));
    await page.route(/\/api\/.*analysis\/\d+$/, async route => {
        const id = Number(route.request().url().split('/').pop());
        const payload = route.request().postDataJSON();
        writes.push({ id, payload });
        const record = analysis.find(record => record.id === id);
        Object.assign(record, payload);
        await route.fulfill({ json: record });
    });
    await page.route('**/api/**/mappings/bulk', async route => {
        const payload = route.request().postDataJSON();
        writes.push({ mappings: payload });
        for (const mapping of payload) {
            const holding = holdings.find(record => record.details === mapping.company_name);
            holding.exchange_prefix = mapping.exchange_prefix;
            holding.ticker = mapping.ticker;
        }
        await route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/**/statements/latest', route => route.fulfill({ json: {
        statement: { id: 1, statement_date: '2026-09-16', total_value_aud: 10000, cash_aud: 4000 }, holdings,
    } }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/analysis`);
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    await expect(issueButton(page)).toHaveAccessibleName('Issues 1. Open data issues');
    await waitForRailLayout(page);
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    return { page, writes, holdings, analysis };
}

test('missing exchange uses a name-corner warning and the shared issues panel filters with search and view choices', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    await expect(page.locator('.analysis-exchange-warning')).toHaveCount(3);
    await expect(page.getByTestId('analysis-missing-exchange-filter')).toHaveCount(0);
    await expect(page.getByText('Set exchange', { exact: true })).toHaveCount(0);
    const missing = rowFor(page, 'Gold Producer').getByRole('button', { name: 'Set exchange for Gold Producer', exact: true });
    await expect(missing).toHaveAttribute('title', 'Exchange missing. Click to set.');
    assert.equal((await missing.innerText()).trim(), '!');
    await missing.click();
    await expect(rowFor(page, 'Gold Producer').getByRole('textbox', { name: 'Exchange', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await toggleFilter(page);
    await expect(rowFor(page, 'Gold Core ETF')).toHaveCount(0);
    await expect(page.locator('.analysis-stock-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Flat', exact: true }).click();
    await expect(page.locator('.analysis-stock-row')).toHaveCount(3);
    const search = page.getByRole('searchbox', { name: 'Find a security in Analysis' });
    await search.fill('Silver');
    await expect(page.locator('.analysis-stock-row')).toHaveCount(1);
    await search.clear();
    await page.getByRole('button', { name: 'Analysis view options', exact: true }).click();
    await page.getByRole('button', { name: 'Show ETFs', exact: true }).click();
    await page.keyboard.press('Escape');
    await expectMissingCount(page, 1);
    await expect(page.locator('.analysis-stock-row')).toHaveCount(1);
    await toggleFilter(page);
    assert.deepEqual(writes, []);
});

test('assigning exchanges updates the shared issue and restores all rows when the last missing exchange is fixed', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    await toggleFilter(page);
    const names = ['Gold Producer', 'Silver Core ETF', 'Alternative Gold ETF'];
    for (const [index, name] of names.entries()) {
        const row = rowFor(page, name);
        await row.getByRole('button', { name: `Set exchange for ${name}`, exact: true }).click();
        await row.getByRole('textbox', { name: 'Exchange', exact: true }).fill('ASX');
        await row.getByRole('button', { name: 'Save exchange', exact: true }).click();
        if (index < 2) await expect(row).toHaveCount(0);
        else await expect(page.locator('.analysis-stock-row')).toHaveCount(4);
        await expectMissingCount(page, 2 - index);
    }
    await expect(issueButton(page)).toHaveAccessibleName('Data. Open data issues');
    await expect(page.locator('.analysis-stock-row')).toHaveCount(4);
    await expect(page.locator('.analysis-exchange-warning')).toHaveCount(0);
    assert.deepEqual(writes, [
        { mappings: [{ company_name: 'Gold Producer', ticker: 'STOCK', exchange_prefix: 'ASX:' }] },
        { id: 3, payload: { ticker: 'ASX:SILV' } },
        { id: 4, payload: { ticker: 'ASX:ALT' } },
    ]);
});

test('exchange controls remain readable and reachable in both themes and on small screens', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t, 1366);
    for (const width of [1366, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await waitForRailLayout(page);
        await expect(issueButton(page)).toBeVisible();
        const geometry = await page.locator('.analysis-context-toolbar').evaluate(el => {
            const parent = el.getBoundingClientRect();
            const items = [...el.querySelectorAll('button,input')].filter(item => item.getBoundingClientRect().width > 0);
            return { right: parent.right, bottom: parent.bottom, items: items.map(item => {
                const rect = item.getBoundingClientRect();
                return { right: rect.right, bottom: rect.bottom };
            }) };
        });
        assert.ok(geometry.items.every(item => item.right <= geometry.right + 1 && item.bottom <= geometry.bottom + 1), JSON.stringify({ width, geometry }));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const badge = await rowFor(page, 'Gold Producer').evaluate(row => {
            const name = row.querySelector('.analysis-company-name').getBoundingClientRect();
            const dot = row.querySelector('.analysis-exchange-warning > span').getBoundingClientRect();
            const cell = row.querySelector('.analysis-name-cell').getBoundingClientRect();
            return { name: { top: name.top, right: name.right }, dot: { top: dot.top, left: dot.left, right: dot.right }, cell: { top: cell.top, right: cell.right } };
        });
        assert.ok(badge.dot.top < badge.name.top && badge.dot.top >= badge.cell.top, JSON.stringify(badge));
        assert.ok(Math.abs(badge.dot.left - badge.name.right) <= 12 && badge.dot.right <= badge.cell.right, JSON.stringify(badge));
        await toggleFilter(page);
        await expect(page.locator('.analysis-stock-row')).toHaveCount(3);
        await toggleFilter(page);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    const icon = rowFor(page, 'Gold Producer').locator('.analysis-exchange-warning > span');
    const dark = await icon.evaluate(el => getComputedStyle(el).color);
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    const light = await icon.evaluate(el => getComputedStyle(el).color);
    assert.notEqual(dark, light);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/analysis-exchange-light.png' });
    assert.deepEqual(writes, []);
});

test('auto-assign saves clear matches, reports uncertainty and keeps manual review available', { timeout: 90000 }, async t => {
    const { page, writes, holdings, analysis } = await setup(t);
    const requests = [];
    let finish;
    const responseReady = new Promise(resolve => { finish = resolve; });
    await page.route('**/api/**/analysis/exchanges/auto-assign', async route => {
        requests.push(route.request().postDataJSON());
        await responseReady;
        holdings[1].exchange_prefix = 'ASX:';
        analysis[1].ticker = 'ASX:STOCK';
        analysis[2].ticker = 'AMEX:SILV';
        await route.fulfill({ json: { results: [
            { kind: 'holding', id: 2, name: 'Gold Producer', ticker: 'STOCK', status: 'assigned', exchange_prefix: 'ASX:', source: 'existing records' },
            { kind: 'analysis', id: 3, name: 'Silver Core ETF', ticker: 'SILV', status: 'assigned', exchange_prefix: 'AMEX:', source: 'Yahoo search and listing metadata' },
            { kind: 'analysis', id: 4, name: 'Alternative Gold ETF', ticker: 'ALT', status: 'review', reason: 'Multiple listings match this ticker and name; choose the intended exchange' },
        ] } });
    });
    await issueButton(page).click();
    await exchangeSection(page).getByRole('button', { name: 'Auto-assign', exact: true }).click();
    await expect(exchangeSection(page).getByRole('button', { name: 'Assigning...', exact: true })).toBeDisabled();
    await expect(exchangeSection(page)).toContainText('Checking 1-3 of 3');
    finish();
    await expect(exchangeSection(page)).toContainText('2 assigned · 1 need review');
    await expect(exchangeSection(page)).toContainText('1 security');
    await expect(page.locator('.analysis-exchange-warning')).toHaveCount(1);
    await exchangeSection(page).getByText('Assignment results', { exact: true }).click();
    await expect(exchangeSection(page)).toContainText('Multiple listings match');
    await exchangeSection(page).getByRole('button', { name: 'Review securities', exact: true }).click();
    await expect(page.locator('.analysis-stock-row')).toHaveCount(1);
    await expect(rowFor(page, 'Alternative Gold ETF')).toBeVisible();
    assert.deepEqual(requests[0].items.sort((a,b) => a.id-b.id), [
        { kind: 'holding', id: 2 }, { kind: 'analysis', id: 3 }, { kind: 'analysis', id: 4 },
    ]);
    assert.equal(requests.length, 1);
    assert.deepEqual(writes, []);
});

test('auto-assign errors remain visible, retry works and the last fixed exchange clears the warning', { timeout: 90000 }, async t => {
    const { page, holdings, analysis } = await setup(t, 390);
    let calls = 0;
    await page.route('**/api/**/analysis/exchanges/auto-assign', async route => {
        calls++;
        if (calls === 1) return route.fulfill({ status: 503, body: 'Listing lookup is unavailable; try again later' });
        const results = route.request().postDataJSON().items.map(item => {
            const row = analysis.find(record => record.id === item.id);
            const ticker = row.ticker;
            row.ticker = `ASX:${ticker}`;
            if (item.kind === 'holding') holdings.find(record => record.id === item.id).exchange_prefix = 'ASX:';
            return { ...item, name: row.name, ticker, status: 'assigned', exchange_prefix: 'ASX:', source: 'test listing' };
        });
        await route.fulfill({ json: { results } });
    });
    await toggleFilter(page);
    await issueButton(page).click();
    await exchangeSection(page).getByRole('button', { name: 'Auto-assign', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('Listing lookup is unavailable');
    await expect(page.locator('.analysis-exchange-warning')).toHaveCount(3);
    await exchangeSection(page).getByRole('button', { name: 'Auto-assign', exact: true }).click();
    await expect(exchangeSection(page)).toContainText('3 assigned · 0 need review');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(exchangeSection(page).getByRole('button', { name: 'Auto-assign', exact: true })).toHaveCount(0);
    await expect(page.locator('.analysis-stock-row')).toHaveCount(4);
    await expect(page.locator('.analysis-exchange-warning')).toHaveCount(0);
    await expect(issueButton(page)).toHaveAccessibleName('Data. Open data issues');
    const bounds = await panel(page).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.equal(calls, 2);
});

test('larger missing-exchange lists use successive bounded batches without repeating saved securities', { timeout: 90000 }, async t => {
    const { page, holdings, analysis } = await setup(t);
    for (let id = 6; id <= 9; id++) analysis.push({
        ...analysis[2], id, name: `Additional Fund ${id}`, ticker: `FUND${id}`,
    });
    await page.reload();
    await expect(page.locator('.analysis-exchange-warning')).toHaveCount(7);
    const requests = [];
    await page.route('**/api/**/analysis/exchanges/auto-assign', async route => {
        const { items } = route.request().postDataJSON();
        requests.push(items);
        const results = items.map(item => {
            const record = analysis.find(row => row.id === item.id);
            const ticker = record.ticker;
            record.ticker = `ASX:${ticker}`;
            if (item.kind === 'holding') holdings.find(row => row.id === item.id).exchange_prefix = 'ASX:';
            return { ...item, name: record.name, ticker, status: 'assigned', exchange_prefix: 'ASX:', source: 'test listing' };
        });
        await route.fulfill({ json: { results } });
    });
    await issueButton(page).click();
    await exchangeSection(page).getByRole('button', { name: 'Auto-assign', exact: true }).click();
    await expect(exchangeSection(page)).toContainText('7 assigned · 0 need review');
    await expect(page.locator('.analysis-exchange-warning')).toHaveCount(0);
    assert.deepEqual(requests.map(batch => batch.length), [5, 2]);
    assert.equal(new Set(requests.flat().map(item => `${item.kind}:${item.id}`)).size, 7);
});
