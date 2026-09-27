const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

test('sidebar content and controls clear separator hit areas at zoom-equivalent widths', { timeout: 120000 }, async t => {
    mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
        localStorage.setItem('alpha-edge-alert-stack-ui', JSON.stringify({ allAssetClassesExpanded: true, pinnedAssetClasses: {} }));
        localStorage.setItem('alpha-edge:context-panel', JSON.stringify({ state: { view: 'etf', allocationView: 'line' }, version: 0 }));
    });
    await page.route('**/api/**', route => {
        if (!new URL(route.request().url()).pathname.endsWith('/alerts')) return route.fallback();
        return route.fulfill({ json: [
        { id: 201, ticker: 'STOCK', alert_type: 'SELL_50', move_pct: -11.76, created_at: '2026-09-09T10:00:00Z' },
        { id: 202, ticker: 'GOLD', alert_type: 'BREAKOUT', move_pct: 9.4, created_at: '2026-09-09T10:00:00Z' },
        ] });
    });
    // Browser zoom reduces the CSS viewport; deviceScaleFactor alone does not.
    for (const width of [1920, 1536, 1440, 1280, 1152, 1097, 1024]) {
        await page.setViewportSize({ width, height: 720 });
        await page.goto(`${base}/#/positions`);
        await expect(page.getByTestId('stack-alert-201')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' })).toBeVisible();
        const expectedWidth = width > 1600 ? 288 : width > 1280 ? 224 : 204;
        for (const side of ['left', 'right']) {
            await expect.poll(() => page.getByTestId(`shell-${side}-rail`).evaluate(el => el.getBoundingClientRect().width)).toBe(expectedWidth);
        }
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            for (const spacing of ['0.1rem', '0.2rem']) {
                await page.locator('.terminal-shell').evaluate((el, spacing) => el.style.setProperty('--spacing', spacing), spacing);
                for (const side of ['left', 'right']) {
                    const rail = page.getByTestId(`shell-${side}-rail`);
                    const geometry = await rail.evaluate((el, side) => {
                        const handle = el.querySelector(':scope > button');
                        const h = handle.getBoundingClientRect();
                        const bounds = el.getBoundingClientRect();
                        const selectors = side === 'left'
                            ? '[class*="groupHeader"], [data-testid^="stack-alert-"], [class*="historyButton"]'
                            : '[role="tab"], [aria-label="ETF allocations"], [aria-label="ETF line allocations"] button, [data-testid="sleeve-summary-dock"]';
                        const overlaps = [...el.querySelectorAll(selectors)].flatMap(node => {
                            const box = node.getBoundingClientRect();
                            if (!box.width || !box.height) return [];
                            const fits = side === 'left' ? box.right <= h.left + 0.5 : box.left >= h.right - 0.5;
                            return fits ? [] : [{ text: node.textContent.slice(0, 80), left: box.left, right: box.right }];
                        });
                        return { overlaps, handleWidth: h.width, width: bounds.width, handleInside: h.left >= bounds.left && h.right <= bounds.right };
                    }, side);
                    assert.deepEqual(geometry.overlaps, [], JSON.stringify({ width, theme, spacing, side, geometry }));
                    assert.equal(geometry.handleWidth, 12);
                    assert.ok(geometry.handleInside);
                    assert.equal(geometry.width, expectedWidth, 'do not widen the rails to fit the separator');
                }
            }
            if (width === 1152 || width === 1920) {
                await page.screenshot({ path: `test-results/sidebar-separators-${width}-${theme}.png` });
            }
        }
        for (const [side, label] of [['left', 'alerts panel'], ['right', 'portfolio tools']]) {
            const rail = page.getByTestId(`shell-${side}-rail`);
            await page.getByRole('button', { name: `Collapse ${label}`, exact: true }).click();
            await expect.poll(() => rail.evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(13);
            await page.getByRole('button', { name: `Expand ${label}`, exact: true }).click();
            await expect.poll(() => rail.evaluate(el => el.getBoundingClientRect().width)).toBe(expectedWidth);
        }
    }
    for (const width of [960, 720, 390]) {
        await page.setViewportSize({ width, height: 720 });
        await expect(page.getByTestId('shell-left-rail')).toHaveCount(0);
        await expect(page.getByTestId('shell-right-rail')).toHaveCount(0);
        await page.getByRole('button', { name: 'Open portfolio tools', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' })).toBeVisible();
        await page.getByRole('button', { name: 'Close Portfolio tools', exact: true }).click();
        await page.getByRole('button', { name: 'Open Alert Stack', exact: true }).click();
        await expect(page.getByTestId('stack-alert-201')).toBeVisible();
        await page.getByRole('button', { name: 'Close Alert Stack', exact: true }).click();
    }
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});
