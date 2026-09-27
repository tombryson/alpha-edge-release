const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');

// Isolated browser fixtures: never contact the broker, mutate UAT, or use a real token.
const baseURL = process.env.HISTORY_PREVIEW_BASE_URL || 'http://127.0.0.1:3100';
const approval = (id, date, rows) => ({
    id: `shape:${id}`, kind: 'shape', status: id === 4 ? 'APPROVED' : 'SUPERSEDED',
    snapshot_id: id, occurred_at: date, source: 'Portfolio target approval', rows,
});
const row = (code, name, weight) => ({ asset_class: code, display_name: name, weight_pct: weight, display_order: 0 });
const entries = [
    approval(3, '2026-08-01T10:00:00Z', [row('GOLD', 'Gold miners', 40), row('CASH', 'Cash / reserve', 54.7)]),
    approval(4, '2026-08-20T10:00:00Z', [row('GOLD', 'Gold miners', 25), row('CASH', 'Cash / reserve', 75)]),
];
const observations = ['2026-07-20T10:00:00Z', '2026-08-10T10:00:00Z', '2026-08-30T10:00:00Z'];

async function openDemo(page, version) {
    const single = page.getByRole('button', { name: new RegExp(`^Demo approval ${version},`) });
    if (await single.count()) return single.click();
    const groups = page.getByRole('button', { name: /^\d+ demo shapes\. View approved allocations/ });
    for (const group of await groups.all()) {
        await group.locator('text').click();
        const choice = page.getByRole('group', { name: 'Approvals in this group' }).getByRole('button', { name: new RegExp(`^Demo v${version}\\b`) });
        if (await choice.count()) { await choice.click(); return; }
        await page.keyboard.press('Escape');
    }
    throw new Error(`Missing demo approval ${version}`);
}

async function assertShapeBar(dialog, expected, previous = false) {
    const bar = dialog.getByRole('img', { name: previous ? /^Previous portfolio shape:/ : /^Saved portfolio shape:/ });
    await expect(bar).toBeVisible();
    const bounds = await bar.boundingBox();
    const heading = await dialog.getByRole('columnheader', { name: 'Asset class', exact: true }).boundingBox();
    assert.ok(bounds.y + bounds.height <= heading.y, 'shape bar sits above the asset-class heading');
    let occupied = 0;
    for (const [name, weight] of expected) {
        const segment = bar.getByTitle(`${name}: ${weight}%`, { exact: true });
        const segmentBounds = await segment.boundingBox();
        assert.ok(Math.abs(segmentBounds.width / bounds.width * 100 - weight) < 0.02, 'saved weight is not rescaled');
        const swatch = dialog.getByRole('rowheader', { name, exact: true }).locator('i');
        assert.equal(await segment.evaluate(el => getComputedStyle(el).backgroundColor),
            await swatch.evaluate(el => getComputedStyle(el).backgroundColor));
        occupied += segmentBounds.width;
    }
    assert.ok(Math.abs(occupied / bounds.width * 100 - expected.reduce((sum, [, weight]) => sum + weight, 0)) < 0.04);
    return bar;
}

test('approved shape preview: hover, pinned click, keyboard, themes and mobile', { timeout: 90000 }, async (t) => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    page.setDefaultTimeout(10000);
    t.after(async () => {
        if (process.env.HISTORY_PREVIEW_DEBUG) {
            await page.screenshot({ path: '/tmp/history-shape-debug.png' });
            console.log((await page.locator('body').innerText()).slice(0, 6000));
        }
        await browser.close();
    });
    page.on('pageerror', error => t.diagnostic(error.message));
    const writes = [];
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-api-token', 'isolated-browser-fixture');
        localStorage.setItem('terminal-history-mode', 'performance');
        localStorage.setItem('terminal-history-performance-range', 'ALL');
    });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (!['GET', 'OPTIONS'].includes(route.request().method())) writes.push(path);
        let data = [];
        if (path.endsWith('/etf/allocation-ledger')) data = { summary: {}, rows: [], candidates: [] };
        if (path.endsWith('/portfolio-history')) data = { entries };
        if (path.endsWith('/performance/portfolio')) data = observations.map(observed_at => ({
            observed_at, total_value_aud: 10000, invested_value_aud: 9000, statement_cash_aud: 1000, sleeve_cash_aud: 0,
        }));
        if (path.endsWith('/performance/asset-classes')) data = observations.flatMap(observed_at => [
            { observed_at, asset_class: 'GOLD', display_name: 'Gold miners', total_value_aud: 5000, portfolio_weight_pct: 50 },
            { observed_at, asset_class: 'CASH', display_name: 'Cash / reserve', total_value_aud: 5000, portfolio_weight_pct: 50 },
        ]);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
                'Access-Control-Allow-Origin': new URL(baseURL).origin,
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
            body: JSON.stringify(data),
        });
    });
    await page.goto(`${baseURL}/#/history`);
    await expect(page.locator('.recharts-area-area[fill*="--asset-class-colour-GOLD_MINERS"]')).toHaveCSS('fill', 'rgb(212, 167, 44)');
    const marker = page.getByRole('button', { name: /^Approved shape v3,/ });
    const latest = page.getByRole('button', { name: /^Approved shape v4,/ });
    const dialog = page.getByRole('dialog', { name: 'Approved shape v3', exact: true });
    await marker.hover();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('row', { name: 'Gold miners 40%' })).toBeVisible();
    await expect(dialog.getByText('94.7%', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Incomplete saved shape/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Compare previous approved shape' })).toHaveCount(0);
    await expect(dialog.getByRole('columnheader')).toHaveCount(2);
    await expect(dialog.getByRole('img')).toHaveCount(1);
    await assertShapeBar(dialog, [['Cash / reserve', 54.7], ['Gold miners', 40]]);
    await dialog.hover();
    await page.waitForTimeout(250);
    await expect(dialog).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(dialog).toBeHidden();
    await page.getByText('v3', { exact: true }).hover();
    await expect(dialog).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(dialog).toBeHidden();

    await marker.click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await latest.focus();
    await marker.focus();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(marker).toBeFocused();
    await expect(dialog).toBeHidden();

    await latest.hover();
    const latestDialog = page.getByRole('dialog', { name: 'Approved shape v4', exact: true });
    await expect(latestDialog.getByText('100%', { exact: true })).toBeVisible();
    await assertShapeBar(latestDialog, [['Cash / reserve', 75], ['Gold miners', 25]]);
    await expect(latestDialog.getByRole('button', { name: 'Compare previous approved shape' })).toHaveCount(0);
    await expect(latestDialog.getByRole('columnheader')).toHaveCount(3);
    await expect(latestDialog.getByRole('row', { name: 'Gold miners 40% 25%', exact: true })).toBeVisible();
    await expect(latestDialog.getByText('Previous v3', { exact: true })).toBeVisible();
    const beforeBar = await assertShapeBar(latestDialog, [['Cash / reserve', 54.7], ['Gold miners', 40]], true);
    const afterBar = await assertShapeBar(latestDialog, [['Cash / reserve', 75], ['Gold miners', 25]]);
    const beforeBounds = await beforeBar.boundingBox();
    const afterBounds = await afterBar.boundingBox();
    assert.ok(beforeBounds.y + beforeBounds.height < afterBounds.y, 'previous bar is above the approved bar');
    assert.ok(Math.abs(beforeBounds.width - afterBounds.width) < 1 && Math.abs(beforeBounds.x - afterBounds.x) < 1,
        'comparison bars share the same width and horizontal origin');
    await expect(latestDialog.getByText(/Previous shape is incomplete/)).toBeVisible();
    await page.screenshot({ path: '/tmp/history-shape-comparison-dark.png' });
    await expect(page.getByRole('dialog')).toHaveCount(1);
    // The compact chart can place its preview over the chart title; dismiss outside the chart.
    await page.getByRole('heading', { name: 'Performance', exact: true }).click();
    await expect(latestDialog).toBeHidden();
    await latest.hover();
    await page.screenshot({ path: '/tmp/history-shape-preview-dark.png' });
    const darkBackground = await latestDialog.evaluate(el => getComputedStyle(el).backgroundColor);
    const theme = page.getByTitle('Switch to light mode', { exact: true });
    await theme.click();
    await latest.hover();
    await expect(latestDialog).toBeVisible();
    assert.notEqual(await latestDialog.evaluate(el => getComputedStyle(el).backgroundColor), darkBackground);
    await page.screenshot({ path: '/tmp/history-shape-preview-light.png' });
    await page.screenshot({ path: '/tmp/history-shape-comparison-light.png' });

    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await latest.tap();
    await expect(latestDialog).toBeVisible();
    const bounds = await latestDialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
    await expect(latestDialog.getByRole('row', { name: 'Gold miners 40% 25%', exact: true })).toBeVisible();
    const mobileBar = await assertShapeBar(latestDialog, [['Cash / reserve', 75], ['Gold miners', 25]]);
    const barBounds = await mobileBar.boundingBox();
    assert.ok(barBounds.x >= bounds.x && barBounds.x + barBounds.width <= bounds.x + bounds.width);
    await page.screenshot({ path: '/tmp/history-shape-preview-mobile.png' });
    const comparisonBounds = await latestDialog.boundingBox();
    assert.ok(comparisonBounds.x >= 0 && comparisonBounds.x + comparisonBounds.width <= 390);
    assert.ok(comparisonBounds.y >= 0 && comparisonBounds.y + comparisonBounds.height <= 844);
    assert.ok(await latestDialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    await assertShapeBar(latestDialog, [['Cash / reserve', 54.7], ['Gold miners', 40]], true);
    const mobileBefore = await latestDialog.getByRole('img', { name: /^Previous portfolio shape:/ }).boundingBox();
    const mobileAfter = await latestDialog.getByRole('img', { name: /^Saved portfolio shape:/ }).boundingBox();
    assert.ok(mobileBefore.y + mobileBefore.height < mobileAfter.y);
    assert.ok(Math.abs(mobileBefore.width - mobileAfter.width) < 1 && Math.abs(mobileBefore.x - mobileAfter.x) < 1);
    await page.screenshot({ path: '/tmp/history-shape-comparison-mobile.png' });
    await latestDialog.getByRole('button', { name: 'Close approved shape preview' }).click();
    await expect(latestDialog).toBeHidden();

    entries[1].rows.push(...Array.from({ length: 18 }, (_, index) => row(`CUSTOM_${index}`, `Historical custom asset class ${index}`, 0)));
    await page.reload();
    await latest.tap();
    const list = latestDialog.getByRole('region', { name: 'Saved asset class allocations' });
    assert.ok(await list.evaluate(el => el.scrollHeight > el.clientHeight));
    const finalRow = latestDialog.getByRole('row', { name: 'Historical custom asset class 17 Unavailable 0%', exact: true });
    await finalRow.scrollIntoViewIfNeeded();
    await expect(finalRow).toBeVisible();
    await expect(latestDialog.getByRole('img', { name: /^Saved portfolio shape:/ })).toBeVisible();
    await expect(latestDialog.getByText('100%', { exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/history-shape-preview-long-mobile.png' });
    const longBounds = await latestDialog.boundingBox();
    assert.ok(longBounds.y >= 0 && longBounds.y + longBounds.height <= 844);
    await expect(latestDialog.getByRole('columnheader', { name: 'Previous %', exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/history-shape-comparison-long-mobile.png' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const demoToggle = page.getByRole('checkbox', { name: 'Demo history', exact: true });
    await expect(demoToggle).not.toBeChecked();
    const liveRange = await page.evaluate(() => localStorage.getItem('terminal-history-performance-range'));
    await demoToggle.check();
    await expect(page.getByText('Demo performance', { exact: true })).toBeVisible();
    await expect(page.getByText(/Simulated approvals and holdings/)).toBeVisible();
    await expect.poll(() => page.locator('[data-approval-count]').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.dataset.approvalCount), 0))).toBe(8);
    await expect(marker).toHaveCount(0);
    await openDemo(page, 2);
    const demoDialog = page.getByRole('dialog', { name: 'Demo approval 2', exact: true });
    await expect(demoDialog.getByText('100%', { exact: true })).toHaveCount(2);
    await expect(demoDialog.getByRole('img')).toHaveCount(2);
    await expect(demoDialog.getByText('Simulated allocation. Not a real approval.')).toBeVisible();
    await page.screenshot({ path: '/tmp/history-demo-desktop.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '1M', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Demo approval \d+,/ })).toHaveCount(1);
    await page.getByRole('button', { name: /^Demo approval 8,/ }).click();
    const rangeDialog = page.getByRole('dialog', { name: 'Demo approval 8', exact: true });
    await expect(rangeDialog.getByText('Previous v7', { exact: true })).toBeVisible();
    await expect(rangeDialog.getByRole('img')).toHaveCount(2);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => localStorage.getItem('terminal-history-performance-range')), liveRange);
    await demoToggle.uncheck();
    await expect(marker).toBeVisible();
    await expect(latest).toBeVisible();
    await expect(page.getByText('Demo performance', { exact: true })).toHaveCount(0);
    await demoToggle.check();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page, 8);
    const mobileDemo = page.getByRole('dialog', { name: 'Demo approval 8', exact: true });
    await expect(mobileDemo).toBeVisible();
    const demoBounds = await mobileDemo.boundingBox();
    assert.ok(demoBounds.x >= 0 && demoBounds.x + demoBounds.width <= 390);
    await page.screenshot({ path: '/tmp/history-demo-mobile.png' });
    await page.reload();
    await expect(demoToggle).not.toBeChecked();
    await expect(latest).toBeVisible();
    entries[1].rows[0].weight_pct = 35;
    await page.reload();
    await latest.tap();
    await expect(latestDialog.getByText('110%', { exact: true })).toBeVisible();
    await expect(latestDialog.getByRole('img', { name: /^Saved portfolio shape:/ })).toHaveCount(0);
    assert.deepEqual(writes, []);
});
