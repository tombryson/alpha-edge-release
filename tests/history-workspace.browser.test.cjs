const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.HISTORY_PREVIEW_BASE_URL || 'http://127.0.0.1:3100';

async function fixture(t, initialRecordCount = 50) {
    let recordCount = initialRecordCount;
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const mock = await mockContextPanel(page);
    const dates = Array.from({ length: 32 }, (_, i) => new Date(Date.UTC(2026, 7, i + 1)).toISOString());
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let data;
        if (path.endsWith('/performance/portfolio')) data = dates.map((observed_at, i) => ({ observed_at, total_value_aud: 10000 + i * 100, invested_value_aud: 9000 + i * 90, statement_cash_aud: 1000 + i * 10, sleeve_cash_aud: 0 }));
        else if (path.endsWith('/performance/asset-classes')) data = dates.flatMap(observed_at => [
            { observed_at, asset_class: 'GOLD_MINERS', display_name: 'Gold Miners', total_value_aud: 5000, portfolio_weight_pct: 50 },
            { observed_at, asset_class: 'SILVER_MINERS', display_name: 'Silver Miners', total_value_aud: 4000, portfolio_weight_pct: 40 },
            { observed_at, asset_class: 'CASH', display_name: 'Cash / reserve', total_value_aud: 1000, portfolio_weight_pct: 10 },
        ]);
        else if (path.includes('/performance/security/')) data = dates.map((observed_at, i) => ({ observed_at, ticker: 'STOCK', price: 20 + i / 10, quantity: 100, market_value_aud: 2000 + i * 10 }));
        else if (path.endsWith('/decisions')) data = Array.from({ length: recordCount }, (_, i) => ({ id: i + 1, ticker: i === 300 ? 'OLDER_RECORD' : i % 2 ? 'STOCK' : 'ASSET_CLASS:GOLD_MINERS', alert_type: 'TRIM', decision: 'IGNORE', created_at: i === 300 ? '2020-01-01T00:00:00Z' : dates[i % dates.length] }));
        else if (path.endsWith('/alerts')) data = Array.from({ length: recordCount }, (_, i) => ({ id: i + 1, ticker: i === 300 ? 'OLDER_RECORD' : i % 2 ? 'STOCK' : 'THEME:GOLD_MINERS', alert_type: 'TRIM', source: 'tms', created_at: i === 300 ? '2020-01-01T00:00:00Z' : dates[i % dates.length] }));
        else return route.fallback();
        await route.fulfill({ json: data });
    });
    await page.goto(`${base}/#/positions`);
    await expect(page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).first()).toBeVisible();
    await page.getByTestId('main-tab-history').click();
    return { page, mock, errors, setRecordCount: count => { recordCount = count; } };
}

test('both history ledgers render at most 100 records and search all loaded pages', { timeout: 90000 }, async t => {
    const { page, mock, errors, setRecordCount } = await fixture(t, 350);
    await page.getByRole('group', { name: 'History view', exact: true }).getByRole('button', { name: 'Activity', exact: true }).click();
    const rows = page.locator('tbody tr');
    const pager = page.getByRole('group', { name: 'History pagination', exact: true });
    const next = pager.getByRole('button', { name: 'Next page', exact: true });
    const previous = pager.getByRole('button', { name: 'Previous page', exact: true });

    for (const [view, total, remainder] of [['Decisions', 350, 50], ['Signals', 352, 52]]) {
        await page.getByRole('group', { name: 'History records', exact: true }).getByRole('button', { name: view, exact: true }).click();
        await expect(rows).toHaveCount(100);
        await expect(pager).toContainText(`1-100 of ${total}`);
        await expect(previous).toBeDisabled();
        await expect(page.locator('tbody')).not.toContainText('OLDER_RECORD');
        const firstRows = await rows.allTextContents();
        await page.locator('table').evaluate(table => { table.parentElement.scrollTop = 800; });
        await next.click();
        await expect(pager).toContainText(`101-200 of ${total}`);
        await expect(rows).toHaveCount(100);
        assert.notDeepEqual(await rows.allTextContents(), firstRows);
        assert.equal(await page.locator('table').evaluate(table => table.parentElement.scrollTop), 0);
        await previous.click();
        await expect(pager).toContainText(`1-100 of ${total}`);
        assert.deepEqual(await rows.allTextContents(), firstRows);
        for (let i = 0; i < 3; i++) await next.click();
        await expect(rows).toHaveCount(remainder);
        await expect(pager).toContainText(`301-${total} of ${total}`);
        await expect(next).toBeDisabled();

        const search = page.getByRole('textbox', { name: view === 'Decisions' ? 'Search decision history' : 'Search signal history' });
        await search.fill('older record');
        await expect(rows).toHaveCount(1);
        await expect(rows).toContainText('OLDER_RECORD');
        await expect(pager).toContainText('1-1 of 1');
        await search.fill('no match');
        await expect(rows).toHaveCount(0);
        await expect(pager).toContainText('0 records');
        await search.clear();
        await expect(rows).toHaveCount(100);
        await expect(pager).toContainText(`1-100 of ${total}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    for (let i = 0; i < 3; i++) await next.click();
    const bounds = await pager.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.screenshot({ path: '/tmp/history-pagination-mobile.png' });
    setRecordCount(50);
    await page.evaluate(() => window.dispatchEvent(new Event('security-actions:changed')));
    await expect(rows).toHaveCount(52);
    await expect(pager).toContainText('1-52 of 52');
    assert.equal(mock.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('History charts stay within their frames at desktop, laptop and mobile widths', { timeout: 90000 }, async t => {
    const { page, mock, errors } = await fixture(t);
    await page.getByRole('group', { name: 'History view', exact: true }).getByRole('button', { name: 'Portfolio', exact: true }).click();
    await expect(page.getByText('Asset class weights', { exact: true })).toBeVisible();
    for (const [width, height] of [[1920, 1080], [1366, 768], [1020, 900], [390, 844]]) {
        await page.setViewportSize({ width, height });
        for (const compact of [false, true]) {
            const toggle = page.getByRole('button', { name: compact ? 'Compact charts' : 'Expand charts', exact: true });
            if (await toggle.count()) await toggle.click();
            await expect.poll(async () => page.locator('[data-testid^="history-"][data-testid$="-chart"] .recharts-wrapper').evaluateAll(charts => charts.length === 2 && charts.every(chart => {
                const a = chart.getBoundingClientRect(), b = chart.closest('[data-testid]').getBoundingClientRect();
                return a.height >= 230 && a.top >= b.top && a.bottom <= b.bottom + 1 && a.right <= b.right + 1;
            }))).toBe(true);
            await expect.poll(() => page.evaluate(() => {
                const value = document.querySelector('[data-testid="history-value-chart"]').getBoundingClientRect();
                const weights = document.querySelector('[data-testid="history-weights-chart"]').getBoundingClientRect();
                return value.right <= weights.left + 1 || value.bottom <= weights.top + 1;
            }), { message: 'charts cannot overlap after resize' }).toBe(true);
        }
        const buttons = page.getByRole('group', { name: 'History date range' }).getByRole('button');
        for (let i = 0; i < await buttons.count(); i++) assert.ok((await buttons.nth(i).boundingBox()).height >= 30);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: `/tmp/history-uplift-${width}.png` });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'terminal-light-soft'));
    await page.screenshot({ path: '/tmp/history-uplift-light.png' });
    assert.equal(mock.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('History has one ledger, readable search controls, class labels and usable mobile overflow', { timeout: 90000 }, async t => {
    const { page, mock } = await fixture(t);
    await page.getByRole('group', { name: 'History view', exact: true }).getByRole('button', { name: 'Activity', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'Search decision history' });
    await expect(search).toBeVisible();
    assert.ok((await search.boundingBox()).height >= 30);
    assert.ok((await search.boundingBox()).width >= 180);
    await expect(page.locator('table')).toHaveCount(1);
    await search.fill('gold miners');
    await expect(page.locator('tbody')).toContainText('Gold Miners');
    await expect(page.locator('tbody')).not.toContainText('ASSET_CLASS:');
    await expect(page.locator('tbody')).not.toContainText('STOCK');
    await page.getByRole('group', { name: 'History records' }).getByRole('button', { name: 'Signals', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Signal history', exact: true })).toBeVisible();
    await expect(page.locator('table')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toHaveCount(52);
    for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 768 });
        const box = await page.getByRole('textbox', { name: 'Search signal history' }).boundingBox();
        assert.ok(box.height >= 30 && box.x >= 0 && box.x + box.width <= width);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: `/tmp/history-ledger-${width}.png` });
    }
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('decision-history:open', { detail: { ticker: 'STOCK' } })));
    await expect(page.getByRole('textbox', { name: 'Search decision history' })).toHaveValue('STOCK');
    assert.equal(mock.writes.length, 0);
});

test('Stock History supports keyboard search and updates its canvas on theme change', { timeout: 90000 }, async t => {
    const { page, errors } = await fixture(t);
    await page.getByRole('group', { name: 'History view', exact: true }).getByRole('button', { name: 'Stocks', exact: true }).click();
    await page.getByRole('button', { name: 'Select security', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search securities' }).fill('Gold Producer');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Gold Producer', exact: true })).toBeVisible();
    const chart = page.getByTestId('history-stock-canvas');
    await expect(chart.locator('canvas').first()).toBeVisible();
    const pixel = () => chart.locator('canvas').first().evaluate(canvas => [...canvas.getContext('2d').getImageData(3, 3, 1, 1).data]);
    const dark = await pixel();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'terminal-light-soft'));
    await expect.poll(pixel).not.toEqual(dark);
    await page.getByRole('button', { name: 'Show value', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide value', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: '/tmp/history-stock-light.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Select security', exact: true }).click();
    const picker = await page.getByRole('dialog', { name: 'Select security', exact: true }).boundingBox();
    assert.ok(picker.x >= 0 && picker.x + picker.width <= 390);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Select security', exact: true })).toBeFocused();
    assert.deepEqual(errors, []);
});
