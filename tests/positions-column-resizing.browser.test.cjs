const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const storageKey = 'terminal-position-column-widths-v4';
const header = (page, key) => page.locator(`.positions-grid th[data-column-key="${key}"]`);
const handle = (page, key) => header(page, key).getByRole('separator');
const dimensions = page => page.locator('.positions-grid thead th').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.columnKey, Math.round(node.getBoundingClientRect().width)])));
const saved = page => page.evaluate(key => localStorage.getItem(key), storageKey);

async function settle(page) {
    await expect(page.locator('tr[data-position-class="GOLD_MINERS"]')).toBeVisible();
    await expect(page.locator('.positions-grid')).toHaveAttribute('aria-busy', 'false');
    await waitForRailLayout(page);
    let previous;
    let stable = 0;
    await expect.poll(async () => {
        const next = JSON.stringify(await dimensions(page));
        stable = previous === next ? stable + 1 : 0;
        previous = next;
        return stable;
    }).toBeGreaterThanOrEqual(3);
}

async function setup(t, { width = 1440, storage = {}, ...options } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 900 }, ...options });
    const fixture = await mockContextPanel(page);
    await page.addInitScript(storage => {
        if (sessionStorage.getItem('resize-fixture')) return;
        sessionStorage.setItem('resize-fixture', 'true');
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    }, storage);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/positions`);
    await settle(page);
    t.after(() => { assert.deepEqual(fixture.writes, []); assert.deepEqual(errors, []); });
    return page;
}

async function start(page, key) {
    await handle(page, key).scrollIntoViewIfNeeded();
    const box = await handle(page, key).boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return point;
}

async function drag(page, key, delta) {
    const point = await start(page, key);
    await page.mouse.move(point.x + delta, point.y, { steps: 8 });
    await page.mouse.up();
}

test('drag tracks pixels without resizing neighbours, sorting or reordering; release and reload retain widths', { timeout: 90000 }, async t => {
    const page = await setup(t);
    const before = await dimensions(page);
    const labels = await page.locator('.positions-grid thead th').allTextContents();
    const point = await start(page, 'cdf');
    assert.deepEqual(await dimensions(page), before, 'pointer-down cannot change the grid');
    await page.mouse.move(point.x + 60, point.y, { steps: 8 });
    await expect.poll(() => dimensions(page)).toEqual({ ...before, cdf: before.cdf + 60 });
    assert.equal(await saved(page), null, 'do not write storage during the drag');
    await page.mouse.up();
    assert.deepEqual(await dimensions(page), { ...before, cdf: before.cdf + 60 });
    assert.deepEqual(await page.locator('.positions-grid thead th').allTextContents(), labels);
    await page.reload();
    await settle(page);
    assert.deepEqual(await dimensions(page), { ...before, cdf: before.cdf + 60 });
    await drag(page, 'cdf', -60);
    assert.deepEqual(await dimensions(page), before, 'returning to the original width remains a saved width');
    await page.setViewportSize({ width: 1152, height: 900 });
    await settle(page);
    assert.deepEqual(await dimensions(page), before, 'viewport shrink must not squeeze saved columns');
    await page.setViewportSize({ width: 2560, height: 1440 });
    await settle(page);
    assert.deepEqual(await dimensions(page), before, 'viewport growth must not stretch saved columns');
});

test('last column resizes independently after horizontal scrolling without sorting', { timeout: 90000 }, async t => {
    const page = await setup(t, { width: 1100 });
    const before = await dimensions(page);
    const text = await header(page, 'portfolioPercent').textContent();
    await drag(page, 'portfolioPercent', -24);
    assert.deepEqual(await dimensions(page), { ...before, portfolioPercent: before.portfolioPercent - 24 });
    assert.equal(await header(page, 'portfolioPercent').textContent(), text);
    await expect(header(page, 'portfolioPercent').getByRole('checkbox')).toHaveCount(0);
    await header(page, 'portfolioPercent').locator('span').first().click();
    assert.notEqual(await header(page, 'portfolioPercent').textContent(), text, 'ordinary clicks still sort');
});

test('Escape, blur, cancelled capture and navigation leave no resize lock or partial save', { timeout: 90000 }, async t => {
    const page = await setup(t);
    const before = await dimensions(page);
    for (const reason of ['escape', 'blur', 'cancel', 'capture']) {
        const point = await start(page, 'name');
        await page.mouse.move(point.x + 80, point.y, { steps: 3 });
        if (reason === 'escape') await page.keyboard.press('Escape');
        if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        if (reason === 'cancel') await handle(page, 'name').dispatchEvent('pointercancel', { pointerId: 1 });
        if (reason === 'capture') await handle(page, 'name').evaluate(el => el.releasePointerCapture(1));
        await page.mouse.up();
        await expect.poll(() => dimensions(page), { message: `${reason} restores the original widths` }).toEqual(before);
        assert.equal(await saved(page), null);
        await expect(page.locator('body')).not.toHaveClass(/position-column-resizing/);
    }
    const point = await start(page, 'name');
    await page.mouse.move(point.x + 40, point.y);
    await page.evaluate(() => { location.hash = '/analysis'; });
    await expect(page.locator('.positions-grid')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('body')).not.toHaveClass(/position-column-resizing/);
});

test('keyboard resizing, double-click reset and reset-all are usable without changing row order', { timeout: 90000 }, async t => {
    const page = await setup(t);
    const before = await dimensions(page);
    await handle(page, 'cdf').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowLeft');
    assert.deepEqual(await dimensions(page), { ...before, cdf: before.cdf + 9 });
    await handle(page, 'cdf').dblclick();
    assert.equal(JSON.parse(await saved(page))['normal:cdf'], null);
    await drag(page, 'name', 50);
    await page.getByTitle('Choose visible columns', { exact: true }).click();
    await page.getByRole('button', { name: 'Reset column widths', exact: true }).click();
    await expect.poll(() => dimensions(page)).toEqual(before);
    await page.reload();
    await settle(page);
    assert.deepEqual(await dimensions(page), before);
});

test('name column uses its whole width; column reorder and visibility retain widths by identity', { timeout: 90000 }, async t => {
    const page = await setup(t, { width: 1920 });
    await drag(page, 'name', 160);
    const before = await dimensions(page);
    const innerWidth = await page.locator('.positions-stock-row td:first-child > div').first().evaluate(el => el.getBoundingClientRect().width);
    assert.ok(innerWidth > before.name - 30, 'old 22rem descendant cap must not waste resized name space');
    await header(page, 'cdf').dragTo(header(page, 'mktValue'));
    await expect.poll(() => page.locator('.positions-grid thead th').evaluateAll(nodes => nodes.map(el => el.dataset.columnKey))).toEqual(['name', 'atr', 'dca', 'mktValue', 'cdf', 'reduce', 'plPercent', 'classPercent', 'modelWeight', 'portfolioPercent']);
    assert.deepEqual(await dimensions(page), before);
    await page.getByTitle('Choose visible columns', { exact: true }).click();
    await page.getByLabel('TREND', { exact: true }).uncheck();
    await expect(header(page, 'cdf')).toHaveCount(0);
    await page.getByLabel('TREND', { exact: true }).check();
    assert.deepEqual(await dimensions(page), before);
});

test('mobile touch resizing preserves its pinned name and never overwrites desktop widths', { timeout: 90000 }, async t => {
    const page = await setup(t, { hasTouch: true, width: 1440 });
    await drag(page, 'name', 20);
    const desktop = await saved(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    const before = await dimensions(page);
    assert.equal(before.name, 200);
    const cdp = await page.context().newCDPSession(page);
    const box = await handle(page, 'name').boundingBox();
    const x = box.x + 4, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 30, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => dimensions(page)).toEqual({ ...before, name: 170 });
    const all = JSON.parse(await saved(page));
    for (const [key, value] of Object.entries(JSON.parse(desktop))) assert.equal(all[key], value);
    await page.locator('.position-grid-scroll').evaluate(el => { el.scrollLeft = 160; });
    await drag(page, 'name', 10);
    assert.equal((await dimensions(page)).name, 180, 'pinned column must not incorporate horizontal scroll');
    await page.reload();
    await settle(page);
    assert.equal((await dimensions(page)).name, 180);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/positions-resize-mobile.png' });
});

test('legacy preferences migrate to pixels, survive reset and cannot return on reload', { timeout: 90000 }, async t => {
    const page = await setup(t, { storage: { 'terminal-position-column-width-deltas-v3': JSON.stringify({ 'normal:name': 80, 'normal:cdf': 0, 'normal:atr': -20 }) } });
    const values = JSON.parse(await saved(page));
    assert.equal(values['normal:cdf'], 65);
    assert.equal(values['normal:atr'], 45);
    await page.getByTitle('Choose visible columns', { exact: true }).click();
    await page.getByRole('button', { name: 'Reset column widths', exact: true }).click();
    assert.equal(JSON.parse(await saved(page))['normal:name'], null);
    await page.reload();
    await settle(page);
    assert.equal(JSON.parse(await saved(page))['normal:name'], null);
});

test('limits, fast release and viewport changes cannot jump neighbours or leave a drag active', { timeout: 90000 }, async t => {
    const page = await setup(t, { width: 1920 });
    const before = await dimensions(page);
    const point = await start(page, 'cdf');
    await page.mouse.move(0, point.y);
    await page.mouse.up();
    assert.deepEqual(await dimensions(page), { ...before, cdf: 38 });
    await drag(page, 'cdf', 700);
    assert.deepEqual(await dimensions(page), { ...before, cdf: 420 });
    const stored = await saved(page);
    const next = await start(page, 'name');
    await page.mouse.move(next.x + 80, next.y);
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.locator('body')).not.toHaveClass(/position-column-resizing/);
    await page.mouse.up();
    assert.equal(await saved(page), stored);
    assert.deepEqual(await dimensions(page), { ...before, cdf: 420 });
});

test('both open sidebars, light theme and narrow desktop preserve independent grid widths', { timeout: 90000 }, async t => {
    const page = await setup(t, { width: 1366, storage: {
        'alpha-edge-shell-ui': JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }),
    } });
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    const before = await dimensions(page);
    await drag(page, 'name', 45);
    assert.deepEqual(await dimensions(page), { ...before, name: before.name + 45 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const scroll = page.locator('.position-grid-scroll');
    assert.ok(await scroll.evaluate(el => el.scrollWidth > el.clientWidth), 'overflow remains inside the grid');
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/positions-resize-light-sidebars.png' });
});
