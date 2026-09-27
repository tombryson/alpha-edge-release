const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const keys = ['ANALYSIS_PRICE_HISTORY', 'ETF_MOMENTUM', 'COMMODITY_PRICE_HISTORY', 'REGIME_RETURNS', 'LISTING_VERIFICATION', 'NEWS_DAILY', 'BROKER_STATEMENTS', 'TRADINGVIEW_SIGNALS'];

async function setup(t) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const data = {
        generated_at: '2026-09-14T10:00:00Z',
        scheduler: { enabled: true, daily_utc_hour: 10, listing_enabled: true, listing_utc_hour: 11, news_enabled: false, news_daily_utc_hour: 12, poll_interval_minutes: 5 },
        datasets: keys.map((dataset, index) => ({
            id: index + 1, dataset, source: index > 5 ? 'EVENT' : 'YAHOO', update_mode: index > 5 ? 'EVENT_INGESTION' : 'DAILY', cadence: 'DAILY',
            trigger_source: 'SCHEDULED', status: 'COMPLETE', last_attempt_at: '2026-09-14T10:00:00Z', last_success_at: '2026-09-14T10:01:00Z',
            data_fresh_through: index > 5 ? '2026-01-01T00:00:00Z' : '2026-09-13T00:00:00Z',
            coverage_complete: true, records_expected: 10, records_updated: 10, error_count: 0, stale_after_days: index > 5 ? 0 : 4,
        })),
    };
    data.datasets[0].status = 'STALE';
    data.datasets[1] = { ...data.datasets[1], status: 'PARTIAL', records_updated: 8, coverage_complete: false };
    data.datasets[5] = { ...data.datasets[5], status: 'FAILED', last_error: 'xAI API error 403: permission-denied; provider quota exhausted' };
    let reads = 0;
    let refreshes = 0;
    let failure = false;
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/data-freshness')) {
            reads++;
            return route.fulfill(failure ? { status: 503, body: 'Unavailable' } : { json: data });
        }
        if (path.endsWith('/analysis/performance/refresh')) {
            assert.equal(route.request().method(), 'POST');
            refreshes++;
            data.datasets[0].status = 'COMPLETE';
            return route.fulfill({ json: { updated_tickers: 10, points_upserted: 100, errors: [] } });
        }
        return route.fallback();
    });
    await page.goto(`${base}/#/positions`);
    await expect(page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).first()).toBeVisible();
    return { page, fixture, errors, data, get reads() { return reads; }, get refreshes() { return refreshes; }, fail: () => { failure = true; } };
}

test('freshness distinguishes stale history from quiet events; checks are read-only and retain failures', { timeout: 90000 }, async t => {
    const app = await setup(t);
    const { page } = app;
    await page.getByTestId('main-tab-system').click();
    await page.getByRole('button', { name: 'Issues 3. Open data issues' }).click();
    const panel = page.getByRole('dialog', { name: 'Data issues' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('section').filter({ hasText: 'ETF momentum' })).toContainText('8 / 10');
    await expect(panel.locator('section').filter({ hasText: 'ETF momentum' })).toContainText('Incomplete');
    await expect(panel.locator('section')).toHaveCount(3);
    await expect(panel.locator('section').first()).toContainText('Daily narrative');
    await expect(panel.locator('section').filter({ hasText: 'TradingView events' })).toHaveCount(0);
    await expect(panel.locator('section').filter({ hasText: 'Broker statements' })).toHaveCount(0);
    await expect(panel.getByText(/xAI API error/)).toBeHidden();
    await panel.getByText('Details', { exact: true }).click();
    await expect(panel.getByText(/xAI API error/)).toBeVisible();
    assert.equal(app.refreshes, 0);
    assert.equal(app.fixture.writes.length, 0);
    const firstReads = app.reads;
    app.fail();
    await panel.getByRole('button', { name: 'Recheck data' }).click();
    await expect(panel.getByRole('status')).toContainText('Last known issues shown');
    assert.equal(app.reads, firstReads + 1);
    for (const theme of ['terminal-dark', 'terminal-light-soft']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      for (const width of [390, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(async () => {
            const box = await panel.boundingBox();
            return Boolean(box && box.x >= 0 && box.x + box.width <= width + 1);
        }).toBe(true);
        assert.ok(await panel.evaluate(node => node.scrollWidth <= node.clientWidth), `no horizontal content overflow ${width}`);
        if (width === 390) await page.screenshot({ path: `/tmp/alpha-edge-freshness-${theme}-mobile.png` });
      }
    }
    await page.screenshot({ path: '/tmp/alpha-edge-freshness-desktop.png' });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    assert.deepEqual(app.errors, []);
});

test('Analysis history refresh is explicit and separate from reading freshness', { timeout: 90000 }, async t => {
    const app = await setup(t);
    const { page } = app;
    await page.getByTestId('main-tab-analysis').click();
    await page.getByRole('button', { name: 'Issues 3. Open data issues' }).click();
    const panel = page.getByRole('dialog', { name: 'Data issues' });
    assert.equal(app.refreshes, 0);
    await panel.getByRole('button', { name: 'Refresh history', exact: true }).click();
    await expect(panel.locator('section').filter({ hasText: 'Analysis history' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Issues 2. Open data issues' })).toBeVisible();
    assert.equal(app.refreshes, 1);
    assert.deepEqual(app.errors, []);
});

test('a healthy ledger shows a quiet empty state without triggering any provider work', { timeout: 90000 }, async t => {
    const app = await setup(t);
    const { page } = app;
    app.data.datasets.forEach(row => { row.status = 'COMPLETE'; row.coverage_complete = true; row.records_updated = row.records_expected; row.last_error = ''; });
    await page.getByTestId('main-tab-system').click();
    await page.getByRole('button', { name: /Open data issues$/ }).click();
    const panel = page.getByRole('dialog', { name: 'Data issues' });
    await panel.getByRole('button', { name: 'Recheck data' }).click();
    await expect(panel.locator('section')).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText('No data issues reported.');
    await expect(page.getByRole('button', { name: 'Data. Open data issues' })).toBeVisible();
    assert.equal(app.refreshes, 0);
    assert.deepEqual(app.fixture.writes, []);
    assert.deepEqual(app.errors, []);
});
