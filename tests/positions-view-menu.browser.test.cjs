const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, options = {}) {
    mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, ...options });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/positions`);
    await expect(page.locator('tr[data-position-class="GOLD_MINERS"]')).toBeVisible();
    const trigger = page.getByTestId('positions-view-menu-trigger');
    await trigger.click();
    const menu = page.getByRole('dialog', { name: 'Position view options', exact: true });
    await expect(menu).toBeVisible();
    return { page, menu, trigger, fixture, errors };
}

test('view menu uses readable pixel sizes and retains sort, direction, row controls and keyboard focus', { timeout: 90000 }, async t => {
    const { page, menu, trigger, fixture, errors } = await setup(t);
    await expect(menu.getByTestId('positions-order-saved')).toBeFocused();
    const geometry = await menu.evaluate(el => ({
        padding: getComputedStyle(el).padding,
        controls: [...el.querySelectorAll('button')].map(b => ({ height: b.getBoundingClientRect().height, font: parseFloat(getComputedStyle(b).fontSize) })),
        inputs: [...el.querySelectorAll('input')].map(b => b.getBoundingClientRect().width),
    }));
    assert.equal(geometry.padding, '12px');
    assert.ok(geometry.controls.every(b => b.height >= 34 && b.font >= 13));
    assert.ok(geometry.inputs.every(width => width === 18));
    const triggerBounds = await trigger.boundingBox();
    const collapseBounds = await page.getByTestId('positions-groups-collapse-toggle').boundingBox();
    assert.equal(triggerBounds.height, 32);
    assert.equal(collapseBounds.height, 32);
    assert.equal(triggerBounds.y, collapseBounds.y);
    const target = menu.getByTestId('positions-order-target');
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect(target.getByLabel('Descending')).toBeVisible();
    await target.click();
    await expect(target.getByLabel('Ascending')).toBeVisible();
    await menu.getByTestId('positions-order-saved').click();
    await menu.getByRole('button', { name: 'Fixed', exact: true }).click();
    await expect(menu.getByRole('button', { name: 'Fixed', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByRole('checkbox', { name: 'Group values', exact: true })).toBeVisible();
    const q1 = menu.getByRole('checkbox', { name: 'Q1 summary', exact: true });
    const checked = await q1.isChecked();
    await q1.click();
    await expect(q1).toBeChecked({ checked: !checked });
    await q1.click();
    await menu.getByRole('button', { name: 'Peek', exact: true }).click();
    await expect(menu.getByRole('checkbox', { name: 'Group values', exact: true })).toHaveCount(0);
    await menu.screenshot({ path: 'test-results/positions-view-menu-dark.png' });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('menu adapts to light theme and fits small viewports without shrinking controls', { timeout: 90000 }, async t => {
    const { page, menu, trigger, errors } = await setup(t, { hasTouch: true });
    const dark = await menu.evaluate(el => getComputedStyle(el).backgroundColor);
    await page.keyboard.press('Escape');
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await trigger.click();
    assert.notEqual(await menu.evaluate(el => getComputedStyle(el).backgroundColor), dark);
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 740, height: 390 }]) {
        await page.setViewportSize(viewport);
        await expect.poll(async () => {
            const bounds = await menu.boundingBox();
            return bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1
                && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1;
        }, { message: `menu fits ${viewport.width}x${viewport.height} after repositioning` }).toBe(true);
        assert.ok(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        assert.ok(await menu.locator('button').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().height >= 40)));
        await menu.getByRole('button', { name: 'Groups', exact: true }).scrollIntoViewIfNeeded();
        await expect(menu.getByRole('button', { name: 'Groups', exact: true })).toBeInViewport();
        if (viewport.width === 390) await menu.screenshot({ path: 'test-results/positions-view-menu-mobile-light.png' });
    }
    await menu.getByRole('button', { name: 'Groups', exact: true }).click();
    await expect(menu).toHaveCount(0);
    assert.deepEqual(errors, []);
});
