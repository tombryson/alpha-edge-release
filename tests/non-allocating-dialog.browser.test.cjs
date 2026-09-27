const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');

async function setup(t, mobile = false) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: mobile ? { width: 360, height: 740 } : { width: 1440, height: 900 }, hasTouch: mobile });
    await require('./fixtures/browser-access.cjs').mockBrowserAccess(page);
    const writes = [];
    await page.route('**/api/**', async route => {
        if (['GET', 'HEAD'].includes(route.request().method()) || route.request().url().endsWith('/sizing/allocations')) return route.fallback();
        writes.push(route.request().postDataJSON());
        return route.fulfill({ json: { success: true } });
    });
    await page.goto('http://127.0.0.1:3312/#/positions');
    return { page, writes };
}

async function open(page, name = 'Transurban Group') {
    const row = page.locator('tr.positions-stock-row').filter({ hasText: name });
    await row.hover();
    await row.getByRole('button', { name: 'Exclude instrument from strategy', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Exclude from strategy' });
    await expect(dialog).toBeVisible();
    return dialog;
}

test('exclusion dialog is compact, theme-aware and cancellation never writes', { timeout: 120000 }, async t => {
    const { page, writes } = await setup(t);
    const dialog = await open(page);
    await expect(dialog).not.toContainText('Strategy universe');
    await expect(dialog).toContainText('$1,800');
    await expect(dialog).toContainText('Broker holdings, account value and statement history stay unchanged.');
    const geometry = await dialog.evaluate(el => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        bodyPadding: getComputedStyle(el.querySelector('header').nextElementSibling).padding,
        buttons: [...el.querySelectorAll('footer button')].map(button => button.getBoundingClientRect().height),
    }));
    assert.equal(geometry.width, 420);
    assert.ok(geometry.height < 330);
    assert.equal(geometry.bodyPadding, '16px');
    assert.ok(geometry.buttons.every(height => height >= 32));
    mkdirSync('test-results', { recursive: true });
    const backgrounds = [];
    for (const theme of ['terminal-dark', 'terminal-light-soft']) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        backgrounds.push(await dialog.evaluate(el => getComputedStyle(el).backgroundImage));
        await dialog.screenshot({ path: `test-results/exclude-dialog-${theme}.png` });
    }
    assert.notEqual(backgrounds[0], backgrounds[1]);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await open(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await open(page);
    await dialog.getByRole('button', { name: 'Cancel exclusion', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(writes, []);
});

test('mobile supports long names and explicit exclusion submits once', { timeout: 120000 }, async t => {
    const { page, writes } = await setup(t, true);
    const dialog = await open(page, 'Commonwealth Bank');
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 16 && bounds.x + bounds.width <= 344);
    const overflow = await dialog.evaluate(el => [...el.querySelectorAll('div, dl, dd, p, h2, button')]
        .filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1)
        .map(node => node.textContent));
    assert.deepEqual(overflow, []);
    await dialog.screenshot({ path: 'test-results/exclude-dialog-mobile.png' });
    await dialog.getByRole('button', { name: 'Exclude', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => writes.length).toBe(1);
    assert.equal(writes[0].security_type, 'NON_ALLOCATING');
    assert.equal(writes[0].ticker, 'ASX:CBA');
});
