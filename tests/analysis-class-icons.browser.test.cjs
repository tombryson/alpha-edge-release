const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const key = 'alpha-edge:position-row-appearance-v1';
const row = (page, code = 'GOLD_MINERS') => page.locator(`tr[data-analysis-class="${code}"]`);
const trigger = (page, code) => row(page, code).locator('button[data-row-icon]');
const palette = page => page.getByRole('dialog', { name: /^Icon for / });
const security = page => page.locator('tr.analysis-stock-row').filter({ hasText: 'Gold Producer' });

async function setup(t, { saved, mobile = false, healthcare = false } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, hasTouch: mobile });
    const fixture = await mockContextPanel(page);
    if (saved) await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key, saved });
    if (healthcare) await page.route('**/api/**/analysis', route => route.fulfill({ json: [
        { id: 1, ticker: 'ASX:GOLD', name: 'Gold Core ETF', primary_asset_class: 'GOLD_MINERS', security_type: 'ETF', current_price: 30 },
        { id: 2, ticker: 'ASX:STOCK', name: 'Gold Producer', primary_asset_class: 'GOLD_MINERS', security_type: 'STOCK', current_price: 30 },
        { id: 7, ticker: 'ASX:PHRM', name: 'Pharma research', primary_asset_class: 'PHARMA', security_type: 'STOCK', is_watchlist: true, current_price: 3 },
    ] }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/analysis`);
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    await expect(row(page)).toBeVisible();
    await waitForRailLayout(page);
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, [], 'icons must not change holdings, research or group records'); });
    return page;
}

test('Analysis and Positions share canonical per-class icons in both directions', { timeout: 90000 }, async t => {
    const page = await setup(t);
    const initial = await row(page).boundingBox();
    const labelX = (await row(page).locator('.analysis-hierarchy-label').boundingBox()).x;
    await trigger(page).press('ArrowDown');
    await palette(page).getByRole('button', { name: 'Gold miners', exact: true }).click();
    await expect(trigger(page)).toHaveAttribute('data-row-icon', 'gold');
    await expect(trigger(page, 'SILVER_MINERS')).toHaveAttribute('data-row-icon', 'none');
    await expect(security(page)).toBeVisible();
    assert.equal((await row(page).boundingBox()).height, initial.height);
    assert.equal((await row(page).locator('.analysis-hierarchy-label').boundingBox()).x, labelX);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).icons, key), { GOLD_MINERS: 'gold' });
    await page.getByTestId('main-tab-positions').click();
    const positionIcon = page.locator('tr[data-position-class="GOLD_MINERS"] button[data-row-icon]');
    await expect(positionIcon).toHaveAttribute('data-row-icon', 'gold');
    await positionIcon.press('ArrowDown');
    await palette(page).getByRole('button', { name: 'Precious metals', exact: true }).click();
    await page.getByTestId('main-tab-analysis').click();
    await expect(trigger(page)).toHaveAttribute('data-row-icon', 'gem');
    await page.reload();
    await expect(trigger(page)).toHaveAttribute('data-row-icon', 'gem');
    await trigger(page).press('ArrowDown');
    await palette(page).getByRole('button', { name: 'Default arrow', exact: true }).click();
    await expect(trigger(page).locator('[data-row-disclosure="down"]')).toBeVisible();
});

test('Technology uses the circuit board and Semiconductors uses the chip in the shared picker and rows', { timeout: 90000 }, async t => {
    const page = await setup(t);
    for (const [name, symbol] of [['Technology', 'circuit-board'], ['Semiconductors', 'cpu']]) {
        await trigger(page).press('ArrowDown');
        const choice = palette(page).getByRole('button', { name, exact: true });
        await expect(choice.locator(`svg.lucide-${symbol}`)).toHaveCount(1);
        await choice.click();
        await expect(trigger(page).locator(`svg.lucide-${symbol}`)).toBeVisible();
    }
});

test('Analysis preserves disclosure clicks, delayed editing, performance and class focus', { timeout: 90000 }, async t => {
    const page = await setup(t);
    const stats = await row(page).locator('.analysis-section-stats').textContent();
    await expect(trigger(page)).not.toHaveAttribute('title');
    await trigger(page).click();
    await expect(security(page)).toHaveCount(0);
    await expect(palette(page)).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(trigger(page).locator('[data-row-disclosure="right"]')).toBeVisible();
    await trigger(page).press('Enter');
    await expect(security(page)).toBeVisible();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await trigger(page).hover();
    await page.clock.runFor(799);
    await expect(trigger(page)).toHaveAttribute('data-icon-mode', 'disclosure');
    await page.clock.runFor(1);
    await expect(trigger(page)).toHaveAttribute('data-icon-mode', 'selector');
    await trigger(page).click();
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole('button', { name: 'Gold miners', exact: true }).click();
    await expect(security(page)).toBeVisible();
    await expect(row(page).locator('.analysis-section-stats')).toHaveText(stats);
    await page.getByTestId('analysis-focus-asset-GOLDMINERS').click();
    await expect(row(page, 'SILVER_MINERS')).toHaveCount(0);
    await page.getByTestId('analysis-clear-asset-class-focus').click();
    await expect(row(page, 'SILVER_MINERS')).toBeVisible();
});

test('direct Analysis entry restores icon preferences, updates across tabs and keeps parent groups independent', { timeout: 90000 }, async t => {
    const page = await setup(t, { healthcare: true, saved: { version: 3, icons: { GOLD_MINERS: 'gold', HEALTHCARE: 'health', PHARMA: 'pharma' }, classColourIcons: { GOLD_MINERS: true } } });
    await expect(trigger(page)).toHaveAttribute('data-row-icon', 'gold');
    await expect(trigger(page).locator('svg')).toHaveCSS('color', 'rgb(212, 167, 44)');
    await expect(trigger(page, 'HEALTHCARE')).toHaveAttribute('data-row-icon', 'health');
    await expect(trigger(page, 'PHARMA')).toHaveAttribute('data-row-icon', 'pharma');
    await trigger(page, 'HEALTHCARE').press('ArrowDown');
    await palette(page).getByRole('button', { name: 'Precious metals', exact: true }).click();
    await expect(trigger(page, 'PHARMA')).toHaveAttribute('data-row-icon', 'pharma');
    await page.evaluate(key => {
        const preferences = JSON.parse(localStorage.getItem(key));
        preferences.icons.GOLD_MINERS = 'gem';
        const newValue = JSON.stringify(preferences);
        localStorage.setItem(key, newValue);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
    }, key);
    await expect(trigger(page)).toHaveAttribute('data-row-icon', 'gem');
});

test('Analysis icon layout and neutral colour follow both themes and fit narrow screens', { timeout: 90000 }, async t => {
    const page = await setup(t, { mobile: true });
    await trigger(page).press('ArrowDown');
    await palette(page).getByRole('button', { name: 'Gold miners', exact: true }).click();
    const darkColour = await trigger(page).evaluate(el => getComputedStyle(el).color);
    await expect(trigger(page).locator('svg')).toHaveCSS('color', darkColour);
    const height = (await row(page).boundingBox()).height;
    mkdirSync('test-results', { recursive: true });
    for (const light of [false, true]) {
        await page.setViewportSize({ width: 1600, height: 1000 });
        if (light) {
            await page.getByTitle('Switch to light mode', { exact: true }).click();
            const lightColour = await trigger(page).evaluate(el => getComputedStyle(el).color);
            assert.notEqual(lightColour, darkColour);
            await expect(trigger(page).locator('svg')).toHaveCSS('color', lightColour);
        }
        for (const width of [1600, 1280, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await waitForRailLayout(page);
            const icon = await trigger(page).boundingBox();
            const label = await row(page).locator('.analysis-hierarchy-label').boundingBox();
            const stats = await row(page).locator('.analysis-section-stats').boundingBox();
            assert.ok(icon.x + icon.width <= label.x && label.x + label.width <= stats.x);
            assert.ok(Math.abs((await row(page).boundingBox()).height - height) < 1);
            await page.screenshot({ path: `test-results/analysis-icons-${light ? 'light' : 'dark'}-${width}.png` });
        }
    }
    await page.clock.install();
    await trigger(page).dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 30, clientY: 150 });
    await page.clock.runFor(800);
    await expect(palette(page)).toBeVisible();
    const rect = await palette(page).boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
    assert.ok(await palette(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.keyboard.press('Escape');
    await expect(security(page)).toBeVisible();
});
