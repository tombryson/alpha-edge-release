const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const longName = 'Alternative Gold and Precious Metals Global Exploration Investment Fund';
const rowFor = (page, name) => page.locator('.analysis-stock-row').filter({
    has: page.getByRole('button', { name, exact: true }),
});

async function setup(t, { failArchive = false } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const analysis = [
        [1, 'GOLD', 'Gold Core ETF', 'ETF', false],
        [2, 'STOCK', 'Gold Producer', 'STOCK', false],
        [3, 'SILV', 'Silver Core ETF', 'ETF', true],
        [4, 'ALT', longName, 'ETF', true],
        [5, 'OLD', 'Hidden entitlement', 'NON_ALLOCATING', true],
    ].map(([id, ticker, name, security_type, is_watchlist]) => ({
        id, ticker: `ASX:${ticker}`, name, security_type, is_watchlist,
        primary_asset_class: ticker === 'SILV' ? 'SILVER_MINERS' : 'GOLD_MINERS',
        include_in_sizing: true, allocation: 10, current_price: 30,
        gemini_quality: 70, gemini_value: 80, gemini_pt: 60,
    }));
    const writes = [];
    await page.route('**/api/**/analysis', route => route.fulfill({ json: analysis }));
    await page.route('**/api/**/analysis/2', async route => {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        Object.assign(analysis[1], payload);
        await route.fulfill({ json: analysis[1] });
    });
    await page.route('**/api/**/analysis/security-type', async route => {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        if (failArchive && payload.security_type === 'NON_ALLOCATING') {
            return route.fulfill({ status: 409, json: { error: 'Archive unavailable. Try again.' } });
        }
        const record = analysis.find(item => item.id === payload.analysis_id);
        Object.assign(record, payload);
        await route.fulfill({ json: record });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/analysis`);
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    await expect(rowFor(page, 'Silver Core ETF')).toBeVisible();
    await waitForRailLayout(page);
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    return { page, writes };
}

async function nameGeometry(row) {
    return row.locator('.analysis-name-content').evaluate(el => {
        const name = el.querySelector('.analysis-company-name');
        const watch = el.querySelector('.analysis-watchlist-indicator');
        const etf = el.querySelector('.analysis-security-type-toggle.is-etf');
        const exchange = el.querySelector('.analysis-exchange-tag');
        const nameBox = name.getBoundingClientRect();
        const watchBox = watch?.getBoundingClientRect();
        const etfBox = etf.getBoundingClientRect();
        const cell = el.closest('td').getBoundingClientRect();
        return {
            gap: (watchBox || etfBox).left - nameBox.right,
            etfGap: watchBox ? etfBox.left - watchBox.right : 0,
            iconRight: etfBox.right, cellRight: cell.right,
            exchangeLeft: exchange.getBoundingClientRect().left,
            nameWidth: nameBox.width, textWidth: name.scrollWidth,
        };
    });
}

test('watchlist and ETF indicators follow the name rather than the cell edge, including hover and resizing', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    const short = rowFor(page, 'Silver Core ETF');
    const separator = page.locator('.analysis-grid th[data-column-key="name"]').getByRole('separator');
    await separator.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    const before = await nameGeometry(short);
    assert.ok(before.gap >= 0 && before.gap <= 8, JSON.stringify(before));
    assert.ok(before.etfGap >= 0 && before.etfGap <= 8);
    assert.ok(before.cellRight - before.iconRight > 80, 'icons must not be pushed to the cell edge');
    await short.getByRole('button', { name: 'Silver Core ETF', exact: true }).hover();
    await expect(short.locator('.analysis-exchange-tag')).toHaveCSS('opacity', '0.8');
    const hovered = await nameGeometry(short);
    assert.ok(Math.abs(hovered.iconRight - before.iconRight) < 1, 'revealing the exchange must not displace the icons');
    assert.ok(hovered.exchangeLeft > hovered.iconRight);
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    assert.ok((await nameGeometry(short)).gap <= 8);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/analysis-name-indicators.png' });
    assert.deepEqual(writes, []);
});

test('long names truncate without pushing indicators beyond the resized name column', { timeout: 90000 }, async t => {
    const { page } = await setup(t);
    const separator = page.locator('.analysis-grid th[data-column-key="name"]').getByRole('separator');
    await separator.focus();
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowLeft');
    const geometry = await nameGeometry(rowFor(page, longName));
    assert.ok(geometry.textWidth > geometry.nameWidth, JSON.stringify(geometry));
    assert.ok(geometry.gap >= 0 && geometry.gap <= 8);
    assert.ok(geometry.iconRight <= geometry.cellRight);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rowFor(page, longName)).toBeVisible();
    assert.ok(await rowFor(page, longName).locator('.analysis-name-cell').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
});

test('Analysis offers archive separately from In/Out and ETF editing, and can restore hidden instruments', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    await expect(page.locator('.analysis-stock-row .is-archive')).toHaveCount(4);
    const stock = rowFor(page, 'Gold Producer');
    await stock.getByRole('button', { name: 'In', exact: true }).click();
    await expect(stock.getByRole('button', { name: 'Out', exact: true })).toBeVisible();
    await expect.poll(() => writes.some(payload => payload.include_in_sizing === false)).toBe(true);
    assert.ok(writes.every(payload => !payload.security_type));
    await stock.getByRole('button', { name: 'Out', exact: true }).click();
    await expect.poll(() => writes.some(payload => payload.include_in_sizing === true)).toBe(true);
    await stock.hover();
    await stock.getByRole('button', { name: 'Mark as ETF', exact: true }).click();
    await expect(stock.getByRole('button', { name: 'Remove ETF flag', exact: true })).toBeVisible();
    await expect.poll(() => writes.some(payload => payload.security_type === 'ETF')).toBe(true);
    await page.getByRole('button', { name: 'Analysis view options', exact: true }).click();
    await page.getByRole('button', { name: 'Show excluded instruments', exact: true }).click();
    await page.keyboard.press('Escape');
    const hidden = rowFor(page, 'Hidden entitlement');
    await hidden.getByRole('button', { name: 'Return instrument to strategy', exact: true }).click();
    await expect.poll(() => writes.some(payload => payload.analysis_id === 5 && payload.security_type === 'STOCK')).toBe(true);
    assert.ok(writes.every(payload => payload.security_type !== 'NON_ALLOCATING'));
});

test('Archive follows row hover and keyboard focus without revealing other rows', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    const stock = rowFor(page, 'Gold Producer');
    const archive = stock.getByRole('button', { name: 'Archive Gold Producer', exact: true });
    const otherArchive = rowFor(page, 'Silver Core ETF').locator('.is-archive');
    for (const theme of ['dark', 'light']) {
        if (theme === 'light') await page.getByTitle('Switch to light mode', { exact: true }).click();
        await page.getByRole('button', { name: 'Analysis view options', exact: true }).hover();
        await expect(archive).toHaveCSS('opacity', '0');
        await stock.getByRole('button', { name: 'Gold Producer', exact: true }).hover();
        await expect(archive).toHaveCSS('opacity', '0.72');
        await expect(otherArchive).toHaveCSS('opacity', '0');
        await page.getByRole('button', { name: 'Analysis view options', exact: true }).hover();
        await stock.getByRole('button', { name: 'Mark as ETF', exact: true }).focus();
        await page.keyboard.press('Tab');
        await expect(archive).toBeFocused();
        await expect(archive).toHaveCSS('opacity', '1');
        await page.keyboard.press('Tab');
        await expect(archive).toHaveCSS('opacity', '0');
    }
    assert.deepEqual(writes, []);
});

test('archiving a held Analysis security requires confirmation and can be restored', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    const stock = rowFor(page, 'Gold Producer');
    const archive = stock.getByRole('button', { name: 'Archive Gold Producer', exact: true });
    await stock.hover();
    await expect(archive).toBeVisible();
    await expect(archive).toHaveCSS('opacity', '0.72');
    await archive.click();
    const dialog = page.getByRole('alertdialog', { name: 'Exclude from strategy' });
    await expect(dialog).toContainText('Broker holdings, account value and statement history stay unchanged.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(writes, []);
    await expect(stock).toBeVisible();
    await archive.click();
    await dialog.getByRole('button', { name: 'Exclude', exact: true }).click();
    await expect(stock).toHaveCount(0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].analysis_id, 2);
    assert.equal(writes[0].security_type, 'NON_ALLOCATING');
    await page.getByRole('button', { name: 'Analysis view options', exact: true }).click();
    await page.getByRole('button', { name: 'Show excluded instruments', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(stock).toBeVisible();
    await stock.getByRole('button', { name: 'Return instrument to strategy', exact: true }).click();
    await expect(archive).toBeVisible();
    await expect.poll(() => writes.some(payload => payload.analysis_id === 2 && payload.security_type === 'STOCK')).toBe(true);
});

test('an unheld security can be archived without a held-position confirmation', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    const stock = rowFor(page, 'Silver Core ETF');
    await stock.getByRole('button', { name: 'Archive Silver Core ETF', exact: true }).click();
    await expect(stock).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].analysis_id, 3);
    assert.equal(writes[0].security_type, 'NON_ALLOCATING');
});

test('failed archive requests preserve the row and In/Out state', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t, { failArchive: true });
    const stock = rowFor(page, 'Gold Producer');
    await stock.getByRole('button', { name: 'Archive Gold Producer', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Exclude', exact: true }).click();
    await expect(stock.getByRole('alert')).toContainText('Could not archive this instrument');
    await expect(stock.getByRole('button', { name: 'In', exact: true })).toBeVisible();
    await expect(stock.getByRole('button', { name: 'Archive Gold Producer', exact: true })).toBeEnabled();
    assert.equal(writes.length, 1);
});
