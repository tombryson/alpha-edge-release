const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const base = process.env.CLASS_INDEX_BASE_URL || 'http://127.0.0.1:3312';

test('asset-class index is compact, single-line, theme-aware and usable on narrow screens', { timeout: 90000 }, async t => {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local demo only');
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !request.url().endsWith('/sizing/allocations')) writes.push(request.url());
    });
    await page.goto(`${base}/#/system`);
    await page.getByRole('button', { name: 'Asset classes', exact: true }).click();
    const index = page.getByTestId('asset-class-index');
    const rows = index.locator('[data-class-code]');
    await expect.poll(() => rows.count()).toBeGreaterThan(60);
    const geometry = () => rows.evaluateAll(nodes => nodes.map(node => {
        const reason = node.querySelector('p');
        const rect = node.getBoundingClientRect();
        const swatch = node.querySelector('i').getBoundingClientRect();
        const name = node.querySelector('strong').getBoundingClientRect();
        return { height: rect.height, overflow: node.scrollWidth > node.clientWidth,
            reasonHeight: reason.getBoundingClientRect().height, reasonTitle: reason.title === reason.textContent,
            nowrap: getComputedStyle(reason).whiteSpace === 'nowrap',
            swatchOffset: Math.abs(swatch.y + swatch.height / 2 - name.y - name.height / 2) };
    }));
    for (const row of await geometry()) {
        assert.ok(row.height <= 31 && row.height >= 29, JSON.stringify(row));
        assert.equal(row.reasonHeight, 20);
        assert.equal(row.reasonTitle, true);
        assert.equal(row.nowrap, true);
        assert.equal(row.overflow, false);
        assert.ok(row.swatchOffset < 1);
    }
    mkdirSync('/tmp/alpha-edge-class-index', { recursive: true });
    await page.screenshot({ path: '/tmp/alpha-edge-class-index/desktop-dark.png' });
    const background = () => rows.first().evaluate(node => getComputedStyle(node).backgroundColor);
    const dark = await background();
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect.poll(background).not.toBe(dark);
    await page.screenshot({ path: '/tmp/alpha-edge-class-index/desktop-light.png' });
    const search = index.getByRole('searchbox', { name: 'Search asset classes' });
    await search.fill('banks');
    await expect(rows.filter({ has: page.locator('strong', { hasText: /^Banks$/ }) })).toHaveCount(1);
    await index.getByRole('button', { name: 'Clear asset-class search' }).click();
    await index.getByRole('button', { name: 'Q1-Defensive', exact: true }).click();
    await expect(index.locator('h2')).toHaveCount(1);
    await expect(index.locator('h2')).toContainText('Q1-Defensive');
    await index.getByRole('button', { name: 'All', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(search).toBeVisible();
    for (const row of await geometry()) {
        assert.ok(row.height <= 50, JSON.stringify(row));
        assert.equal(row.reasonHeight, 20);
        assert.equal(row.overflow, false);
        assert.equal(row.nowrap, true);
    }
    assert.ok(await index.evaluate(node => node.getBoundingClientRect().right <= innerWidth));
    await page.screenshot({ path: '/tmp/alpha-edge-class-index/mobile.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
});
