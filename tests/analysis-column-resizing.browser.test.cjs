const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const storageKey = 'terminal-analysis-column-widths-v1';
const positionsKey = 'terminal-position-column-widths-v4';
const header = (page, key) => page.locator(`.analysis-grid th[data-column-key="${key}"]`);
const handle = (page, key) => header(page, key).getByRole('separator');
const dimensions = page => page.locator('.analysis-grid thead th').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.columnKey, Math.round(node.getBoundingClientRect().width)])));
const saved = page => page.evaluate(key => localStorage.getItem(key), storageKey);

async function settle(page) {
    await expect(page.locator('.analysis-grid .analysis-company-name').first()).toBeVisible();
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    await waitForRailLayout(page);
    let previous, stable = 0;
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
        if (sessionStorage.getItem('analysis-resize-fixture')) return;
        sessionStorage.setItem('analysis-resize-fixture', 'true');
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    }, storage);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/analysis`);
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

test('Analysis resizes independently, saves only on release and does not sort', { timeout: 90000 }, async t => {
    const page = await setup(t);
    const before = await dimensions(page);
    const sort = await header(page, 'price').getAttribute('aria-sort');
    const point = await start(page, 'price');
    assert.deepEqual(await dimensions(page), before);
    await page.mouse.move(point.x + 65, point.y, { steps: 8 });
    await expect.poll(() => dimensions(page)).toEqual({ ...before, price: before.price + 65 });
    assert.equal(await saved(page), null);
    await page.mouse.up();
    await expect(header(page, 'price')).toHaveAttribute('aria-sort', sort);
    await page.reload();
    await settle(page);
    assert.deepEqual(await dimensions(page), { ...before, price: before.price + 65 });
    await header(page, 'price').getByRole('button').click();
    await expect(header(page, 'price')).not.toHaveAttribute('aria-sort', sort);
    await page.setViewportSize({ width: 2560, height: 1440 });
    await settle(page);
    assert.deepEqual(await dimensions(page), { ...before, price: before.price + 65 });
    await page.setViewportSize({ width: 1100, height: 900 });
    await settle(page);
    assert.deepEqual(await dimensions(page), { ...before, price: before.price + 65 });
});

test('hidden columns and expanded notes keep widths, matching headers, bodies and colgroups', { timeout: 90000 }, async t => {
    const page = await setup(t, { width: 1920 });
    await drag(page, 'price', 50);
    const before = await dimensions(page);
    const menu = page.getByRole('button', { name: 'Choose visible Analysis columns', exact: true });
    await menu.click();
    await page.getByRole('checkbox', { name: 'PRICE', exact: true }).uncheck();
    await expect(header(page, 'price')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'PRICE', exact: true }).check();
    assert.deepEqual(await dimensions(page), before);
    await page.getByRole('checkbox', { name: 'THESIS', exact: true }).check();
    await page.getByRole('checkbox', { name: 'NEXT CATALYST', exact: true }).check();
    await page.keyboard.press('Escape');
    await page.getByTitle('Show thesis and catalyst columns').click();
    await expect(header(page, 'nextCatalyst')).toBeVisible();
    await drag(page, 'nextCatalyst', 45);
    const expanded = await dimensions(page);
    for (const [key, value] of Object.entries(before)) assert.equal(expanded[key], value);
    const table = page.locator('.analysis-grid');
    const count = Object.keys(expanded).length;
    await expect(table.locator('colgroup col')).toHaveCount(count);
    const bodyCount = await table.locator('.analysis-company-name').first().evaluate(el => el.closest('tr').cells.length);
    assert.equal(bodyCount, count);
    await page.getByTitle('Collapse notes columns').click();
    await page.getByTitle('Show thesis and catalyst columns').click();
    assert.deepEqual(await dimensions(page), expanded);
});

test('last Analysis column can shrink at the scroll boundary without shifting its neighbours', { timeout: 90000 }, async t => {
    const page = await setup(t, { width: 1100 });
    const before = await dimensions(page);
    const key = Object.keys(before).at(-1);
    await drag(page, key, 80);
    assert.deepEqual(await dimensions(page), { ...before, [key]: before[key] + 80 });
    await page.locator('.analysis-grid-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await drag(page, key, -35);
    assert.deepEqual(await dimensions(page), { ...before, [key]: before[key] + 45 });
});

test('keyboard, cancellation, per-column reset and reset-all retain Analysis interactions', { timeout: 90000 }, async t => {
    const page = await setup(t);
    const before = await dimensions(page);
    const point = await start(page, 'name');
    await page.mouse.move(point.x + 60, point.y);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await dimensions(page), before);
    assert.equal(await saved(page), null);
    await expect(page.locator('body')).not.toHaveClass(/position-column-resizing/);
    await handle(page, 'quality').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowLeft');
    assert.deepEqual(await dimensions(page), { ...before, quality: before.quality + 9 });
    await handle(page, 'quality').dblclick();
    assert.equal(JSON.parse(await saved(page))['analysis:quality'], null);
    await drag(page, 'name', 70);
    await page.getByRole('button', { name: 'Choose visible Analysis columns', exact: true }).click();
    await page.getByRole('button', { name: 'Reset column widths', exact: true }).click();
    await expect.poll(() => dimensions(page)).toEqual(before);
    await page.reload();
    await settle(page);
    assert.deepEqual(await dimensions(page), before);
    await page.locator('.analysis-ticker-hover-trigger').hover();
    await page.getByRole('button', { name: 'Pin tickers open', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpin tickers', exact: true })).toBeVisible();
    await drag(page, 'name', 50);
    const pinned = (await dimensions(page)).name;
    await page.getByRole('button', { name: 'Unpin tickers', exact: true }).click();
    assert.equal((await dimensions(page)).name, pinned, 'unpinning tickers must respect the chosen width');
});

test('Analysis and Positions preferences stay separate across navigation', { timeout: 90000 }, async t => {
    const positionWidths = JSON.stringify({ 'normal:name': 432, 'normal:cdf': 120 });
    const page = await setup(t, { storage: { [positionsKey]: positionWidths } });
    await drag(page, 'name', 60);
    const widths = await dimensions(page);
    await page.getByTestId('main-tab-positions').click();
    await expect(page.locator('.positions-grid')).toHaveAttribute('aria-busy', 'false');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), positionsKey), positionWidths);
    await page.getByTestId('main-tab-analysis').click();
    await settle(page);
    assert.deepEqual(await dimensions(page), widths);
});

test('mobile touch and horizontal scrolling preserve the pinned Analysis name', { timeout: 90000 }, async t => {
    const page = await setup(t, { hasTouch: true });
    await drag(page, 'price', 40);
    const desktop = JSON.parse(await saved(page));
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    const before = await dimensions(page);
    assert.equal(before.name, 200);
    const cdp = await page.context().newCDPSession(page);
    const box = await handle(page, 'name').boundingBox();
    const x = box.x + 4, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 25, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => dimensions(page)).toEqual({ ...before, name: 175 });
    const all = JSON.parse(await saved(page));
    for (const [key, value] of Object.entries(desktop)) assert.equal(all[key], value);
    await page.locator('.analysis-grid-scroll').evaluate(el => { el.scrollLeft = 160; });
    await drag(page, 'name', 10);
    assert.equal((await dimensions(page)).name, 185);
    const pinned = await header(page, 'name').boundingBox();
    assert.ok(pinned.x >= 0 && pinned.x < 20);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.reload();
    await settle(page);
    assert.equal((await dimensions(page)).name, 185);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/analysis-resize-mobile.png' });
});

test('narrow desktop and light theme keep overflow inside the Analysis grid', { timeout: 90000 }, async t => {
    const page = await setup(t, { width: 1366, storage: {
        'alpha-edge-shell-ui': JSON.stringify({ activeTab: 'ANALYSIS', layout: { left: 'open', right: 'open' } }),
    } });
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    const before = await dimensions(page);
    await drag(page, 'name', 40);
    assert.deepEqual(await dimensions(page), { ...before, name: before.name + 40 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await expect(page.locator('.analysis-grid-scroll')).toHaveCount(1);
    assert.ok(await page.locator('.analysis-grid-scroll').evaluate(el => el.scrollWidth > el.clientWidth));
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/analysis-resize-light-sidebars.png' });
});
