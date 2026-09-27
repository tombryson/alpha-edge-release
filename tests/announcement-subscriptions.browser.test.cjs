const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, { width = 1366, light = false } = {}) {
    const browser = await chromium.launch(); t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: light ? 1366 : width, height: width < 500 ? 844 : 900 } });
    const fixture = await mockContextPanel(page);
    const items = [
        { kind: 'holding', id: 1, security_id: 1, name: 'Gold Core ETF', ticker: 'GOLD', exchange_prefix: 'ASX:', provider: '', configured: false, needs_recheck: false },
        { kind: 'holding', id: 2, security_id: 2, name: 'Gold Producer', ticker: 'STOCK', exchange_prefix: 'ASX:', provider: '', configured: false, needs_recheck: false },
        { kind: 'analysis', id: 3, security_id: 3, name: 'US Research Candidate', ticker: 'US', exchange_prefix: 'NASDAQ:', provider: '', configured: false, needs_recheck: false },
        { kind: 'analysis', id: 4, security_id: 4, name: 'Missing exchange', ticker: 'MISS', exchange_prefix: '', provider: '', configured: false, needs_recheck: false },
    ];
    const writes = [];
    let rejectNext = false;
    await page.route('**/api/**/announcement-subscriptions', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
        const payload = route.request().postDataJSON(); writes.push(payload);
        if (rejectNext) { rejectNext = false; return route.fulfill({ status: 409, body: 'Security changed. Reload announcement setup before confirming.' }); }
        for (const update of payload.items) {
            const item = items.find(row => row.kind === update.kind && row.id === update.id);
            Object.assign(item, update, { confirmed_at: update.configured ? '2026-09-18T01:00:00Z' : undefined, needs_recheck: false });
        }
        await route.fulfill({ json: { updated: payload.items.length } });
    });
    await page.route('**/api/**/data-freshness', route => route.fulfill({ json: {
        scheduler: {}, datasets: ['ANALYSIS_PRICE_HISTORY', 'ETF_MOMENTUM', 'COMMODITY_PRICE_HISTORY', 'REGIME_RETURNS', 'LISTING_VERIFICATION', 'NEWS_DAILY', 'BROKER_STATEMENTS', 'TRADINGVIEW_SIGNALS'].map(dataset => ({
            dataset, status: 'COMPLETE', update_mode: 'DAILY', coverage_complete: true, error_count: 0, records_expected: 1, records_updated: 1, data_fresh_through: '2026-09-18',
        })),
    } }));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/alerts`);
    await expect(page.getByRole('button', { name: /4 securities need announcement alerts/ })).toBeVisible();
    if (light) {
        await page.getByTitle('Switch to light mode', { exact: true }).click();
        await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    }
    const open = async () => {
        await page.getByRole('navigation', { name: 'Connection scope' }).getByRole('button', { name: /^Announcements/ }).click();
        await expect(page.getByRole('region', { name: 'Announcement alerts', exact: true })).toBeVisible();
    };
    await page.getByRole('button', { name: /4 securities need announcement alerts/ }).click();
    await expect(page.getByRole('navigation', { name: 'Connection scope' }).getByRole('button', { name: /^Announcements/ })).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Announcement alerts', exact: true })).toHaveCount(0);
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    return { page, items, writes, open, reject: () => { rejectNext = true; } };
}

test('announcement setup supports explicit bulk confirmation, reload persistence and reset without trade writes', { timeout: 120000 }, async t => {
    const { page, items, writes, open } = await setup(t);
    const dialog = page.getByRole('region', { name: 'Announcement alerts', exact: true });
    await expect(dialog.getByRole('combobox', { name: 'Announcement provider for US Research Candidate' })).toHaveValue('SEEKING_ALPHA');
    await expect(dialog.getByRole('button', { name: 'Mark configured for Missing exchange' })).toBeDisabled();
    await expect(dialog.getByRole('link', { name: 'Open HotCopper for Gold Producer' })).toHaveAttribute('href', 'https://hotcopper.com.au/watchlist/');
    assert.equal(writes.length, 0);
    await dialog.getByRole('checkbox', { name: 'Select visible unconfigured securities' }).check();
    await expect(dialog).toContainText('3 selected');
    await dialog.getByRole('button', { name: 'Mark configured', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Needs setup 1', exact: true })).toBeVisible();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].items.length, 3);
    assert.equal(items.filter(item => item.configured).length, 3);
    await page.getByRole('navigation', { name: 'Connection scope' }).getByRole('button', { name: /^Positions/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /1 security needs announcement alerts/ })).toBeVisible();
    await page.reload(); await open();
    await dialog.getByRole('button', { name: 'All', exact: true }).click();
    await expect(dialog.getByText('Configured', { exact: true })).toHaveCount(3);
    await dialog.getByRole('button', { name: 'Reset announcement setup for Gold Producer' }).click();
    await expect(dialog.getByText('Configured', { exact: true })).toHaveCount(2);
    assert.equal(writes.at(-1).items[0].configured, false);
    await dialog.getByRole('combobox', { name: 'Announcement provider for Gold Producer' }).selectOption('SEEKING_ALPHA');
    await dialog.getByRole('button', { name: 'Mark configured for Gold Producer' }).click();
    await expect(dialog.getByText('Configured', { exact: true })).toHaveCount(3);
    assert.equal(items[1].provider, 'SEEKING_ALPHA');
    await page.goto(`${base}/#/analysis`);
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('region', { name: 'Announcement alerts', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /Open data issues$/ }).click();
    await expect(page.getByText('Announcement alerts', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Set up alerts|Manage setup)$/ })).toHaveCount(0);
});

test('failed confirmation stays actionable; setup remains accessible when all are configured', { timeout: 90000 }, async t => {
    const { page, items, reject, open } = await setup(t);
    const dialog = page.getByRole('region', { name: 'Announcement alerts', exact: true });
    reject();
    await dialog.getByRole('button', { name: 'Mark configured for Gold Producer' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Security changed');
    assert.equal(items[1].configured, false);
    await expect(dialog.getByRole('button', { name: 'Mark configured for Gold Producer' })).toBeEnabled();
    for (const item of items) { item.configured = true; item.provider = 'HOTCOPPER'; }
    await page.reload(); await open();
    await expect(dialog).toContainText('All announcement subscriptions confirmed.');
    await dialog.getByRole('button', { name: 'All', exact: true }).click();
    await expect(dialog.getByText('Configured', { exact: true })).toHaveCount(4);
    await page.getByRole('navigation', { name: 'Connection scope' }).getByRole('button', { name: /^Positions/ }).click();
    await expect(page.getByRole('button', { name: /securities need announcement alerts/ })).toHaveCount(0);
    await open();
    await expect(dialog).toBeVisible();
});

test('failed setup load is visible in Alerts and can be retried inline', { timeout: 90000 }, async t => {
    const { page, items } = await setup(t);
    await page.route('**/api/**/announcement-subscriptions', route => route.fulfill({ status: 500, body: 'Unavailable' }));
    await page.reload();
    await page.getByRole('button', { name: /Announcement setup unavailable/ }).click();
    const panel = page.getByRole('region', { name: 'Announcement alerts', exact: true });
    await expect(panel.getByRole('alert')).toContainText('could not be loaded');
    await page.route('**/api/**/announcement-subscriptions', route => route.fulfill({ json: { items } }));
    await panel.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Mark configured for Gold Producer' })).toBeEnabled();
});

for (const width of [1366, 390]) for (const light of [false, true]) {
    test(`announcement setup fits ${width}px ${light ? 'light' : 'dark'}`, { timeout: 90000 }, async t => {
        const { page } = await setup(t, { width, light });
        await expect(page.locator('html')).toHaveAttribute('data-theme', light ? 'terminal-light-soft' : 'terminal-dark');
        const dialog = page.getByRole('region', { name: 'Announcement alerts', exact: true });
        const scopes = page.getByRole('navigation', { name: 'Connection scope' });
        assert.ok(await scopes.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
        for (const button of await scopes.getByRole('button').all()) {
            assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 1), await button.textContent());
        }
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width);
        assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth));
        await expect(dialog.getByRole('button', { name: 'Mark configured', exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Mark configured for Gold Producer' })).toBeVisible();
        const search = dialog.getByRole('searchbox', { name: 'Find announcement security' });
        await search.fill('US Research');
        await expect(dialog.getByRole('combobox')).toHaveCount(1);
        await search.clear();
        mkdirSync('/tmp/alpha-edge-announcement-ui', { recursive: true });
        await page.screenshot({ path: `/tmp/alpha-edge-announcement-ui/${width}-${light ? 'light' : 'dark'}.png` });
    });
}
