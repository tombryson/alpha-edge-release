const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function checkGeometry(controls, size) {
    const boxes = [];
    for (const button of controls) {
        // Measure both in one frame; hydration can reposition the whole header.
        const { box, icon } = await button.evaluate(element => ({
            box: element.getBoundingClientRect().toJSON(),
            icon: element.querySelector('svg').getBoundingClientRect().toJSON(),
        }));
        assert.equal(box.width, size);
        assert.equal(box.height, size);
        assert.equal(icon.width, 16);
        assert.equal(icon.height, 16);
        assert.ok(Math.abs(icon.x + icon.width / 2 - box.x - size / 2) <= .5);
        assert.ok(Math.abs(icon.y + icon.height / 2 - box.y - size / 2) <= .5);
        boxes.push(box);
    }
    assert.ok(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y)) <= .5);
}

test('header theme, palette and Help controls share dimensions and centres', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await mockContextPanel(page);
    for (const width of [1366, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/#/positions`);
        const header = page.locator('.terminal-unified-header');
        await expect.poll(() => header.getByRole('img', { name: 'Alpha Edge', exact: true })
            .evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        const theme = header.getByRole('button', { name: /Switch to (light|dark) mode/ });
        const palette = header.getByRole('button', { name: 'Select theme' });
        const help = header.getByRole('button', { name: 'Open Help' });
        await expect(theme).toBeVisible();
        await checkGeometry([theme, palette, help], 28);
        await theme.click();
        await checkGeometry([theme, palette, help], 28);
        await expect(palette.locator('svg')).toHaveCSS('stroke-width', '2px');
        const swatches = await palette.locator('circle').evaluateAll(circles => circles.map(circle => getComputedStyle(circle).fill));
        assert.ok(new Set(swatches).size >= 3, 'palette has distinct coloured paint dots');
        assert.notEqual(await palette.locator('svg').evaluate(el => getComputedStyle(el).color), await help.locator('svg').evaluate(el => getComputedStyle(el).color));
        await palette.click();
        await expect(palette).toHaveAttribute('aria-expanded', 'true');
        await expect(header.getByText('THEME', { exact: true })).toBeVisible();
        await palette.click();
        await expect(palette).toHaveAttribute('aria-expanded', 'false');
        await header.screenshot({ path: `/tmp/header-controls-${width}.png` });
        await help.click();
        await expect(page).toHaveURL(/#\/help/);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/#/positions`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const utilities = page.locator('.terminal-mobile-utilities');
    await checkGeometry([
        utilities.getByRole('button', { name: /Switch to (light|dark) mode/ }),
        utilities.getByRole('button', { name: 'Select theme' }),
    ], 40);
});
