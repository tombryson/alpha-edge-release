const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');

test('demo starts without Q1 sections or Compare and remembers explicit changes separately', { timeout: 60000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await require('./fixtures/browser-access.cjs').mockBrowserAccess(page);
    await page.addInitScript(() => {
        localStorage.setItem('terminal-positions-visibility', JSON.stringify({ showPositionBucketRows: true }));
        localStorage.setItem('terminal-position-asset-class-row-mode-v1', 'shape');
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ layout: { left: 'open', right: 'open' } }));
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312'}/#/positions`);
    await expect(page.locator('tr.positions-stock-row').first()).toBeVisible();
    await expect(page.locator('[data-risk-group]')).toHaveCount(0);
    await expect(page.locator('.position-shape-comparison-cell')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show Positions shape strip', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.screenshot({ path: '/tmp/alpha-edge-demo-position-defaults.png' });

    await page.getByTestId('positions-view-menu-trigger').click();
    await page.getByRole('checkbox', { name: 'Q1 sections', exact: true }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('[data-risk-group]').first()).toBeVisible();
    await expect(page.locator('.position-shape-comparison-cell').first()).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-risk-group]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Comparing', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const prefs = await page.evaluate(() => ({
        privateVisibility: JSON.parse(localStorage.getItem('terminal-positions-visibility')),
        privateCompare: localStorage.getItem('terminal-position-asset-class-row-mode-v1'),
        demoVisibility: JSON.parse(localStorage.getItem('terminal-positions-visibility:demo')),
        demoCompare: localStorage.getItem('terminal-position-asset-class-row-mode-v1:demo'),
    }));
    assert.deepEqual(prefs.privateVisibility, { showPositionBucketRows: true });
    assert.equal(prefs.privateCompare, 'shape');
    assert.equal(prefs.demoVisibility.showPositionBucketRows, true);
    assert.equal(prefs.demoCompare, 'shape');
    assert.deepEqual(errors, []);
});
