const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, options = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install();
    const fixture = await mockContextPanel(page);
    const state = {
        connections: [
            { ticker: 'ASX:GOLD', script: 'etf_tms' },
            { ticker: 'ASX:STOCK', script: 'cdf' }, { ticker: 'ASX:STOCK', script: 'tms' },
            { ticker: 'ASX:SILV', script: 'etf_tms' }, { ticker: 'ASX:SILV', script: 'cdf' },
            { ticker: 'ASX:ALT', script: 'cdf' }, { ticker: 'ASX:ALT', script: 'tms' },
        ],
        profiles: [{ ticker: 'SILV', mode: 'tms' }],
        benchmark: 'AMEX:GDX',
        fail: '',
        ...options,
    };
    for (const endpoint of ['alerts/active', 'etf/management', 'commodity-themes']) {
        await page.route(`**/api/**/${endpoint}*`, async route => {
            if (state.fail === endpoint) return route.fulfill({ status: 503, json: { error: 'Isolated unavailable fixture' } });
            const data = endpoint === 'alerts/active' ? state.connections
                : endpoint === 'etf/management' ? state.profiles : { themes: [{
                    code: 'GOLD', display_name: 'Gold', confirmation_count: 0, confirmation_total: 3,
                    tactical: { asset_class_code: 'GOLD_MINERS', budget_approved: true },
                    strategic_floor: { asset_class_code: 'PHYSICAL_GOLD' }, eligible_securities: [],
                    stages: [
                        { key: 'COMMODITY', status: 'CONFIRMED', source: { symbol: 'AMEX:GLD' } },
                        { key: 'EQUITY_RELATIVE', status: 'BLOCKED', source: { numerator: state.benchmark, denominator: 'AMEX:GLD' } },
                    ],
                }] };
            await route.fulfill({ json: data });
        });
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/positions`);
    await page.getByTestId('main-tab-analysis').click();
    return { page, fixture, state, errors };
}

const indicator = (page, name) => page.locator('.analysis-stock-row').filter({ hasText: name }).locator('.analysis-connection-lane > div');
const refreshConnections = async page => {
    await page.getByTestId('main-tab-positions').click();
    await page.getByTestId('main-tab-analysis').click();
    // The shared poller stays subscribed across tabs; navigation is not a refresh.
    const refreshed = page.waitForResponse(response => response.url().endsWith('/alerts/active'));
    await page.clock.fastForward(31000);
    await refreshed;
};

test('Analysis requires the commodity stock Outperform pair and honours ETF profiles without changing layout', { timeout: 90000 }, async t => {
    const { page, state, fixture, errors } = await setup(t);
    const stock = indicator(page, 'Gold Producer');
    await expect(stock).toHaveAttribute('title', 'Partial monitoring - missing Outperform');
    await expect(stock.locator('div')).toHaveClass('bg-yellow-500');
    await expect(indicator(page, 'Gold Core ETF')).toHaveAttribute('title', 'Full monitoring (ETF TMS)');
    await expect(indicator(page, 'Silver Core ETF')).toHaveAttribute('title', 'Partial monitoring - missing TMS');
    await expect(indicator(page, 'Alternative Gold ETF')).toHaveAttribute('title', 'No ETF TMS connection');
    const size = await stock.boundingBox();
    state.connections.push({ ticker: ' ASX_DLY:STOCK / BATS:GDX ', script: 'cdf', direction: 'SELL' });
    state.connections.push({ ticker: 'ASX:SILV', script: 'atr_oscillator' });
    await refreshConnections(page);
    await expect(stock).toHaveAttribute('title', 'Full monitoring (CDF + TMS + Outperform)');
    await expect(indicator(page, 'Silver Core ETF')).toHaveAttribute('title', 'Full monitoring (CDF + TMS)');
    await expect(stock.locator('div')).toHaveClass('bg-green-500');
    assert.equal((await stock.boundingBox()).height, size.height);
    assert.equal((await stock.boundingBox()).width, size.width);

    await page.getByTestId('main-tab-positions').click();
    const position = page.locator('.positions-stock-row').filter({ hasText: 'Gold Producer' });
    await expect(position.locator('[title="Full monitoring (CDF + TMS + Outperform)"] > div')).toHaveClass('bg-green-500');
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('Analysis refreshes Outperform requirements after a configured benchmark changes', { timeout: 90000 }, async t => {
    const { page, state, fixture, errors } = await setup(t);
    const stock = indicator(page, 'Gold Producer');
    state.connections.push({ ticker: 'ASX:STOCK/AMEX:GDX', script: 'cdf' });
    await refreshConnections(page);
    await expect(stock).toHaveAttribute('title', 'Full monitoring (CDF + TMS + Outperform)');
    state.benchmark = 'AMEX:GDXJ';
    await page.evaluate(() => window.dispatchEvent(new Event('alpha-edge:commodity-theme-configuration-changed')));
    await expect(stock).toHaveAttribute('title', 'Partial monitoring - missing Outperform');
    state.connections.push({ ticker: 'ASX:STOCK/AMEX:GDXJ', script: 'cdf' });
    await refreshConnections(page);
    await expect(stock).toHaveAttribute('title', 'Full monitoring (CDF + TMS + Outperform)');
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('failed commodity configuration stays neutral without hiding independently verified ETF coverage', { timeout: 90000 }, async t => {
    const { page, fixture, errors } = await setup(t, { fail: 'commodity-themes' });
    await expect(indicator(page, 'Gold Producer')).toHaveAttribute('title', 'Monitoring requirements unavailable');
    await expect(indicator(page, 'Gold Producer').locator('div')).toHaveClass('bg-gray-500');
    await expect(indicator(page, 'Gold Core ETF')).toHaveAttribute('title', 'Full monitoring (ETF TMS)');
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('failed ETF profiles stay neutral and recover on the next successful fetch', { timeout: 90000 }, async t => {
    const { page, state, fixture, errors } = await setup(t, { fail: 'etf/management' });
    const fund = indicator(page, 'Gold Core ETF');
    await expect(fund).toHaveAttribute('title', 'Management mode unavailable');
    await expect(fund.locator('div')).toHaveClass('bg-gray-500');
    state.fail = '';
    state.profiles.push({ ticker: 'GOLD', mode: 'tms' });
    await refreshConnections(page);
    await expect(fund).toHaveAttribute('title', 'No connections - missing CDF + TMS');
    state.connections.push({ ticker: 'ASX:GOLD', script: 'cdf' }, { ticker: 'ASX:GOLD', script: 'tms' });
    await refreshConnections(page);
    await expect(fund).toHaveAttribute('title', 'Full monitoring (CDF + TMS)');
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('failed connection ledger never claims full monitoring', { timeout: 90000 }, async t => {
    const { page, fixture, errors } = await setup(t, { fail: 'alerts/active' });
    await expect(indicator(page, 'Gold Core ETF')).toHaveAttribute('title', 'Connection data unavailable');
    await expect(indicator(page, 'Gold Producer')).toHaveAttribute('title', 'Connection data unavailable');
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});
