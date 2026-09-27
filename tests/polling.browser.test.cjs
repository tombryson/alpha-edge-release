const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

test('mounted shell/table share connection polling, hidden pages stop, and visible pages recover', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.clock.install({ time: new Date('2026-09-15T00:00:00Z') });
    await mockContextPanel(page);
    const counts = new Map(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api\/trading/, '/api');
        if (route.request().method() === 'GET') counts.set(path, (counts.get(path) || 0) + 1);
        return route.fallback();
    });
    await page.goto(`${base}/#/positions`);
    await expect(page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).first()).toBeVisible();
    await page.waitForTimeout(400);
    counts.clear();
    await page.clock.runFor(31000);
    await expect.poll(() => counts.get('/api/alerts/active') || 0).toBe(1);
    await page.waitForTimeout(200);
    assert.equal(counts.get('/api/alerts/active'), 1, 'shell and table share the same store refresh');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    counts.clear();
    await page.clock.runFor(120000);
    assert.equal(counts.get('/api/alerts/active') || 0, 0);
    assert.equal(counts.get('/api/etf/allocation-ledger') || 0, 0);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => counts.get('/api/alerts/active') || 0).toBe(1);
    await page.waitForTimeout(200);
    assert.equal(counts.get('/api/alerts/active'), 1, 'visibility plus focus causes only one due refresh');
    assert.deepEqual(errors, []);
});

test('ETF page and sidebar share one ledger request per aligned polling cycle', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.clock.install({ time: new Date('2026-09-15T00:00:00Z') });
    const fixture = await mockContextPanel(page);
    let reads = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
        if (new URL(route.request().url()).pathname.endsWith('/etf/allocation-ledger')) {
            reads++;
            await new Promise(resolve => setTimeout(resolve, 100));
            return route.fulfill({ json: fixture.ledger() });
        }
        return route.fallback();
    });
    await page.goto(`${base}/#/positions`);
    await expect(page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).first()).toBeVisible();
    await page.clock.runFor(7000);
    await page.evaluate(() => { location.hash = '#/etf'; });
    await expect(page.getByRole('heading', { name: 'ETF implementation', exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    reads = 0;
    await page.clock.runFor(23000);
    await expect.poll(() => reads).toBe(1);
    await page.waitForTimeout(300);
    assert.equal(reads, 1);
    assert.deepEqual(errors, []);
});
