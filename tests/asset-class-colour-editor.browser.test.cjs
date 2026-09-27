const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, width = 1600) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const saved = { etf_core_sleeve_ratio_pct: '25' };
    const writes = [];
    const failures = { get: false, post: false };
    await page.route('**/api/**/settings', async route => {
        const post = route.request().method() === 'POST';
        if (failures[post ? 'post' : 'get']) return route.fulfill({ status: 503, body: 'Isolated failure' });
        if (!post) return route.fulfill({ json: saved });
        const payload = route.request().postDataJSON();
        writes.push(payload);
        Object.assign(saved, payload);
        return route.fulfill({ json: { status: 'success', updated: payload } });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/positions`);
    return { page, saved, writes, failures, errors, fixture };
}

async function openEditor(page) {
    if (page.viewportSize().width < 768 && !(await page.getByRole('button', { name: 'Select theme', exact: true }).isVisible())) {
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Select theme', exact: true }).click();
    await page.getByRole('button', { name: 'Asset class colours', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Asset class colours', exact: true, includeHidden: true });
    await expect(dialog.getByRole('button', { name: 'Change Gold Miners colour' })).toBeEnabled();
    return dialog;
}

async function goldEditor(page, dialog) {
    await dialog.getByRole('button', { name: 'Change Gold Miners colour' }).click();
    return page.getByRole('dialog', { name: 'Gold Miners colour', exact: true });
}

test('class colour saves once, updates mounted SVG and historical references, persists, and resets independently', { timeout: 120000 }, async t => {
    const { page, saved, writes, errors, fixture } = await setup(t);
    const panel = page.getByTestId('context-panel');
    await panel.getByRole('tab', { name: 'Shape', exact: true }).click();
    const pie = page.getByTestId('sleeve-summary-dock').locator('svg path[fill*="--asset-class-colour-GOLD_MINERS"]').first();
    await expect(pie).toHaveCSS('fill', 'rgb(212, 167, 44)');
    const dialog = await openEditor(page);
    const editor = await goldEditor(page, dialog);
    await expect(editor.getByRole('radio')).toHaveCount(30);
    await editor.getByRole('radio', { name: 'Steel blue', exact: true }).click();
    await expect(editor.getByRole('radio', { name: 'Steel blue', exact: true })).toBeChecked();
    assert.equal(writes.length, 0, 'selection is draft only');
    await expect(pie).toHaveCSS('fill', 'rgb(212, 167, 44)');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(pie).toHaveCSS('fill', 'rgb(82, 138, 184)');
    assert.deepEqual(writes, [{ 'asset_class_colour:GOLD_MINERS': '#528ab8' }]);
    await dialog.getByRole('button', { name: 'Close asset class colours' }).click();
    await expect(page.getByRole('button', { name: 'Select theme', exact: true })).toBeFocused();
    await expect(panel.getByRole('img', { name: 'Reference shape allocation' }).getByTitle('Gold Miners: 60.0%', { exact: true })).toHaveCSS('background-color', 'rgb(82, 138, 184)');
    await panel.getByLabel('Reference portfolio shape').selectOption('shape:3');
    await expect(panel.getByRole('img', { name: 'Reference shape allocation' }).getByTitle('Gold Miners: 30.0%', { exact: true })).toHaveCSS('background-color', 'rgb(82, 138, 184)');
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect(pie).toHaveCSS('fill', 'rgb(82, 138, 184)');
    await page.goto(`${base}/#/portfolio`);
    await expect(page.locator('[class*="titleLine"]').filter({ hasText: 'Gold Miners' }).locator('[class*="swatch"]')).toHaveCSS('background-color', 'rgb(82, 138, 184)');
    await page.reload();
    await expect(page.locator('[class*="titleLine"]').filter({ hasText: 'Gold Miners' }).locator('[class*="swatch"]')).toHaveCSS('background-color', 'rgb(82, 138, 184)');
    saved['asset_class_colour:SILVER_MINERS'] = '#987654';
    const reopened = await openEditor(page);
    const reset = await goldEditor(page, reopened);
    await reset.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(reset).toHaveCount(0);
    await expect(pie).toHaveCSS('fill', 'rgb(212, 167, 44)');
    assert.equal(saved['asset_class_colour:SILVER_MINERS'], '#987654');
    assert.equal(saved.etf_core_sleeve_ratio_pct, '25');
    assert.equal(writes.length, 2);
    assert.equal(fixture.writes.length, 0, 'no financial or unrelated writes');
    assert.deepEqual(errors, []);
});

test('cancel and failed saves preserve the palette; colours outside the presets remain valid', { timeout: 90000 }, async t => {
    const { page, saved, writes, failures, errors } = await setup(t);
    const dialog = await openEditor(page);
    let editor = await goldEditor(page, dialog);
    await editor.getByRole('radio', { name: 'Silver', exact: true }).click();
    await editor.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(writes.length, 0);
    editor = await goldEditor(page, dialog);
    await expect(editor.getByRole('radio', { name: 'Gold', exact: true })).toBeChecked();
    await expect(editor.locator('input[type="color"], input[type="text"]')).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await editor.getByRole('radio', { name: 'Gold', exact: true }).focus();
    await page.keyboard.down('ArrowRight');
    await expect(editor.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked();
    await page.keyboard.up('ArrowRight');
    assert.equal(writes.length, 0, 'keyboard selection must not submit');
    failures.post = true;
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('could not be saved');
    await expect(dialog.locator('[data-class-colour="GOLD_MINERS"] [class*="swatch"]')).toHaveCSS('background-color', 'rgb(212, 167, 44)');
    failures.post = false;
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    assert.equal(writes.length, 1);
    await dialog.getByRole('button', { name: 'Close asset class colours' }).click();
    saved['asset_class_colour:GOLD_MINERS'] = '#123456';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('sleeve-summary-dock').locator('svg path[fill*="--asset-class-colour-GOLD_MINERS"]').first()).toHaveCSS('fill', 'rgb(18, 52, 86)');
    const reopened = await openEditor(page);
    const retained = await goldEditor(page, reopened);
    await expect(retained.getByText('Current colour', { exact: true })).toBeVisible();
    await expect(retained.locator('[role="radio"][data-state="checked"]')).toHaveCount(0);
    await expect(retained.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await retained.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(saved['asset_class_colour:GOLD_MINERS'], '#123456');
    assert.equal(writes.length, 1);
    assert.deepEqual(errors, []);
});

test('double-click confirms a swatch once, preserves failed saves, and accepts an unchanged colour without writing', { timeout: 90000 }, async t => {
    const { page, writes, failures, errors } = await setup(t);
    const dialog = await openEditor(page);
    let editor = await goldEditor(page, dialog);
    await editor.getByRole('radio', { name: 'Gold', exact: true }).dblclick();
    await expect(editor).toHaveCount(0);
    assert.equal(writes.length, 0);

    editor = await goldEditor(page, dialog);
    failures.post = true;
    await editor.getByRole('radio', { name: 'Silver', exact: true }).dblclick();
    await expect(editor.getByRole('alert')).toContainText('could not be saved');
    await expect(dialog.locator('[data-class-colour="GOLD_MINERS"] [class*="swatch"]')).toHaveCSS('background-color', 'rgb(212, 167, 44)');
    assert.equal(writes.length, 0);

    failures.post = false;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    let attempts = 0;
    await page.route('**/api/**/settings', async route => {
        if (route.request().method() === 'POST') {
            attempts += 1;
            await pending;
        }
        await route.fallback();
    });
    const swatch = editor.getByRole('radio', { name: 'Teal', exact: true });
    await swatch.dblclick();
    await expect(swatch).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled();
    await swatch.dispatchEvent('dblclick');
    await expect.poll(() => attempts).toBe(1);
    release();
    await expect(editor).toHaveCount(0);
    await expect(dialog.locator('[data-class-colour="GOLD_MINERS"] [class*="swatch"]')).toHaveCSS('background-color', 'rgb(20, 184, 166)');
    assert.deepEqual(writes, [{ 'asset_class_colour:GOLD_MINERS': '#14b8a6' }]);
    assert.equal(attempts, 1);
    assert.deepEqual(errors, []);
});

test('colour editor fits mobile and both themes with readable controls and full class names', { timeout: 90000 }, async t => {
    const { page, errors } = await setup(t, 390);
    await page.route('**/api/**/asset-classes', route => route.fulfill({ json: [
        { code: 'GOLD_MINERS', display_name: 'Gold Miners', active: true, allow_target_weight: true },
        { code: 'CUSTOM_FUND_A', display_name: 'Rare Earths & Critical Minerals and Custom Resources', active: true, allow_target_weight: true },
    ] }));
    for (const light of [false, true]) {
        if (light) await page.getByTitle('Switch to light mode', { exact: true }).click();
        const dialog = await openEditor(page);
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 15 && box.x + box.width <= 375);
        assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
        const trigger = dialog.getByRole('button', { name: 'Change Gold Miners colour' });
        assert.ok((await trigger.boundingBox()).height >= 36);
        await page.screenshot({ path: `/tmp/class-colour-editor-mobile-${light ? 'light' : 'dark'}.png` });
        const editor = await goldEditor(page, dialog);
        const bounds = await editor.boundingBox();
        assert.ok(bounds.x >= 15 && bounds.x + bounds.width <= 375);
        await expect(editor.getByRole('radio')).toHaveCount(30);
        const swatch = await editor.getByRole('radio').first().boundingBox();
        assert.ok(swatch.width >= 44 && swatch.height >= 44);
        assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
        await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
        await page.screenshot({ path: `/tmp/class-colour-picker-mobile-${light ? 'light' : 'dark'}.png` });
        await page.keyboard.press('Escape');
        await expect(editor).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await dialog.getByRole('button', { name: 'Close asset class colours' }).click();
    }
    assert.deepEqual(errors, []);
});

test('preset grid stays within a narrow viewport and scrolls on short screens', { timeout: 90000 }, async t => {
    const { page, errors } = await setup(t, 320);
    const dialog = await openEditor(page);
    const editor = await goldEditor(page, dialog);
    let bounds = await editor.boundingBox();
    assert.ok(bounds.x >= 15 && bounds.x + bounds.width <= 305);
    const swatch = await editor.getByRole('radio').first().boundingBox();
    assert.ok(swatch.width >= 44 && swatch.height >= 44);
    await page.setViewportSize({ width: 320, height: 320 });
    await expect.poll(async () => {
        bounds = await editor.boundingBox();
        return bounds.y >= 15 && bounds.y + bounds.height <= 305;
    }).toBe(true);
    await editor.getByRole('radio', { name: 'Stone', exact: true }).click();
    await expect(editor.getByRole('radio', { name: 'Stone', exact: true })).toBeChecked();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(errors, []);
});

test('initial settings failure blocks editing until a successful retry', { timeout: 90000 }, async t => {
    const { page, failures, errors } = await setup(t);
    failures.get = true;
    await page.reload();
    await page.getByRole('button', { name: 'Select theme', exact: true }).click();
    await page.getByRole('button', { name: 'Asset class colours', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Asset class colours', exact: true });
    await expect(dialog.getByRole('alert')).toContainText('could not be loaded');
    await expect(dialog.getByRole('button', { name: 'Change Gold Miners colour' })).toBeDisabled();
    failures.get = false;
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(dialog.getByRole('button', { name: 'Change Gold Miners colour' })).toBeEnabled();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    assert.deepEqual(errors, []);
});

test('Portfolio class squares open the shared selector without expanding holdings or shifting their labels', { timeout: 90000 }, async t => {
    const { page, writes, fixture, errors } = await setup(t);
    await expect(page.getByRole('button', { name: 'Select theme', exact: true })).toBeVisible();
    await page.getByTestId('main-tab-portfolio').click();
    await expect(page.getByText('What is held, by asset class', { exact: true })).toHaveCount(0);
    const title = page.locator('[class*="titleLine"]').filter({ hasText: 'Gold Miners' });
    const square = title.getByRole('button', { name: 'Change Gold Miners colour', exact: true });
    const holdings = page.locator('[data-portfolio-scroll] [class*="holdingRow"]');
    await expect(square).toBeEnabled();
    await expect(holdings).toHaveCount(0);
    const before = await title.boundingBox();
    await square.hover();
    await expect(square).toHaveCSS('outline-style', 'solid');
    await expect(square).toHaveCSS('cursor', 'pointer');
    assert.deepEqual(await title.boundingBox(), before, 'hover must not move the class label');
    await page.screenshot({ path: '/tmp/portfolio-class-colour-hover.png' });
    await square.click();
    let editor = page.getByRole('dialog', { name: 'Gold Miners colour', exact: true });
    await expect(editor.getByRole('radio')).toHaveCount(30);
    await expect(holdings).toHaveCount(0);
    await editor.getByRole('radio', { name: 'Teal', exact: true }).click();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(square).toBeFocused();
    await expect(holdings).toHaveCount(0);
    assert.equal(writes.length, 0);
    await title.getByText('Gold Miners', { exact: true }).click();
    await expect(holdings).toHaveCount(2);
    await square.focus();
    await page.keyboard.press('Enter');
    editor = page.getByRole('dialog', { name: 'Gold Miners colour', exact: true });
    await editor.getByRole('radio', { name: 'Teal', exact: true }).dblclick();
    await expect(editor).toHaveCount(0);
    await expect(holdings).toHaveCount(2);
    await expect(square).toHaveCSS('background-color', 'rgb(20, 184, 166)');
    assert.deepEqual(writes, [{ 'asset_class_colour:GOLD_MINERS': '#14b8a6' }]);
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await square.hover();
    await expect(square).toHaveCSS('outline-style', 'solid');
    await expect(square).toHaveCSS('background-color', 'rgb(20, 184, 166)');
    await page.setViewportSize({ width: 390, height: 844 });
    await square.click();
    editor = page.getByRole('dialog', { name: 'Gold Miners colour', exact: true });
    await expect(editor.getByRole('radio', { name: 'Teal', exact: true })).toBeChecked();
    await editor.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(square).toHaveCSS('background-color', 'rgb(212, 167, 44)');
    await expect(holdings).toHaveCount(2);
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
});

test('Portfolio colour saves preserve the original database class code, including custom underscores', { timeout: 90000 }, async t => {
    const { page, writes } = await setup(t);
    await page.route('**/api/**/portfolio-mix/current', route => route.fulfill({ json: {
        as_of: new Date().toISOString(), total_value: 10000,
        rows: [{ asset_class: 'CUSTOM_FUND_A', display_name: 'Custom Fund Class', weight_pct: 100, value: 10000 }],
    } }));
    await expect(page.getByRole('button', { name: 'Select theme', exact: true })).toBeVisible();
    await page.getByTestId('main-tab-portfolio').click();
    await page.getByRole('button', { name: 'Change Custom Fund Class colour', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Custom Fund Class colour', exact: true });
    await editor.getByRole('radio', { name: 'Silver', exact: true }).click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    assert.deepEqual(writes, [{ 'asset_class_colour:CUSTOM_FUND_A': '#c0c7d2' }]);
    await expect(page.getByRole('button', { name: 'Change Custom Fund Class colour', exact: true })).toHaveCSS('background-color', 'rgb(192, 199, 210)');
});
