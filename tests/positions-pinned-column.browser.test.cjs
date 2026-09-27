const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

test('small-screen pinned names occlude scrolled values in normal, Core, hover and selection states', { timeout: 120000 }, async t => {
    mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/positions`);
    const rows = page.locator('tr.positions-stock-row');
    await expect(rows).toHaveCount(2);
    const scroll = page.locator('.position-grid-scroll');
    for (const width of [320, 390, 600, 767]) {
        await page.setViewportSize({ width, height: 844 });
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            await scroll.evaluate(el => el.scrollLeft = el.scrollWidth);
            for (const row of await rows.all()) {
                const name = row.locator('td:first-child');
                await expect(name).toHaveCSS('position', 'sticky');
                const bounds = await name.boundingBox();
                const scrollBounds = await scroll.boundingBox();
                assert.ok(Math.abs(bounds.x - scrollBounds.x) < 2, 'name remains pinned');
                assert.equal(bounds.width, 200);
                const clip = { x: bounds.x + 2, y: bounds.y + 2, width: bounds.width - 4, height: bounds.height - 4 };
                for (const state of ['normal', 'hover', 'selected']) {
                    if (state === 'normal') await page.mouse.move(0, 0);
                    else await page.mouse.move(bounds.x + 110, bounds.y + 12);
                    if (state === 'selected') await page.mouse.click(bounds.x + 110, bounds.y + 12);
                    if (state === 'selected') await expect(row).toHaveClass(/is-position-selected/);
                    const captures = [];
                    // A bright cell under the pinned name must have no effect on its pixels.
                    for (const color of ['#ff0000', '#00ffff']) {
                        await row.locator('td:not(:first-child)').evaluateAll((cells, color) => cells.forEach(cell => {
                            cell.style.setProperty('background', color, 'important');
                            cell.style.setProperty('color', color, 'important');
                        }), color);
                        captures.push(await page.screenshot({ clip, animations: 'disabled' }));
                    }
                    assert.deepEqual(captures[0], captures[1], `${width} ${theme} ${state}: scrolled values must not bleed through`);
                    if (state === 'selected') await page.mouse.click(bounds.x + 110, bounds.y + 12);
                }
                await row.locator('td:not(:first-child)').evaluateAll(cells => cells.forEach(cell => {
                    cell.style.removeProperty('background');
                    cell.style.removeProperty('color');
                }));
            }
            await page.screenshot({ path: `test-results/positions-pinned-${width}-${theme}.png` });
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(rows.first().locator('td:first-child')).toHaveCSS('position', 'static');
    await expect(rows.first().locator('td:first-child')).toHaveCSS('background-image', 'none');
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});
