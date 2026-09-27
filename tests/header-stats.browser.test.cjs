const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(page, pnl) {
    await mockContextPanel(page);
    await page.route(/\/api\/(?:(?:trading|terminal)\/)?(?:portfolio|statements\/latest)$/, async route => {
        const total = 60000;
        const data = route.request().url().endsWith('/portfolio')
            ? { total_value: total, cash_on_hand: 300, profit_loss: pnl, profit_loss_percent: pnl / total * 100 }
            : { statement: { id: 1, total_value_aud: total, cash_aud: 300 }, holdings: [{ id: 1, ticker: 'GOLD', exchange_prefix: 'ASX:', details: 'Gold Core ETF', quantity: 10, cost_aud: 1000, value_aud: 1000 + pnl, gain_loss_aud: pnl, gain_loss_pct: pnl / 10 }] };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`${base}/#/positions`);
}

test('header P/L toggles dollars and percentage without shifting or losing colour', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    for (const [pnl, text, tone, token] of [[-420, '-$420 · -0.7%', 'loss', '--destructive'], [420, '+$420 · +0.7%', 'gain', '--success'], [0, '$0 · 0.0%', 'neutral', '--foreground']]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await setup(page, pnl);
        const value = page.locator(`.terminal-header-stat-value[data-tone="${tone}"]`);
        const [amount, percentage] = text.split(' · ');
        await expect(value).toHaveText(amount);
        await expect(value).toHaveAttribute('title', `P/L: ${amount} (${percentage})`);
        const before = await value.boundingBox();
        await value.click();
        await expect(value).toHaveText(percentage);
        await expect(value).toHaveAttribute('aria-pressed', 'true');
        const after = await value.boundingBox();
        assert.ok(Math.abs(before.width - after.width) <= 0.5, 'toggle cannot resize the value beyond subpixel rounding');
        assert.ok(Math.abs(before.x - after.x) <= 0.5, 'toggle cannot move the value beyond subpixel rounding');
        await page.keyboard.press('Enter');
        await expect(value).toHaveText(amount);
        await expect(value).toHaveAttribute('aria-pressed', 'false');
        for (const light of [false, true]) {
            if (light) await page.getByTitle('Switch to light mode').click();
            await expect.poll(() => value.evaluate((el, token) => {
                const probe = document.createElement('span');
                probe.style.color = `var(${token})`;
                el.parentElement.appendChild(probe);
                const expected = getComputedStyle(probe).color;
                probe.remove();
                return getComputedStyle(el).color === expected;
            }, token), { message: `${tone} colour in ${light ? 'light' : 'dark'} mode` }).toBe(true);
        }
        await page.close();
    }
});

test('cash shows amount only and exposes existing reserve arithmetic on hover, keyboard and tap', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    for (const mobile of [false, true]) {
        const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
        await setup(page, -420);
        if (mobile) {
            const profit = page.getByRole('button', { name: 'Show P/L as percentage' });
            await profit.tap();
            await expect(profit).toHaveText('-0.7%');
            await profit.tap();
            await expect(profit).toHaveText('-$420');
        }
        const cash = page.getByRole('button', { name: 'Cash $300. View breakdown' });
        await expect(cash).toHaveText('$300');
        if (mobile) await cash.tap(); else await cash.hover();
        const popover = page.getByRole('dialog', { name: 'Cash breakdown' });
        await expect(popover).toBeVisible();
        const row = label => popover.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) });
        await expect(row('Of portfolio')).toContainText('0.50%');
        await expect(row('Assigned to sleeves')).toContainText('$500');
        await expect(row('Unallocated')).toContainText('$0');
        await expect(row('Reserve shortfall')).toContainText('$200');
        const bounds = await popover.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (mobile ? 390 : 1440));
        if (!mobile) {
            await popover.hover();
            await expect(popover).toBeVisible();
            await page.mouse.move(0, 899);
            await expect(popover).not.toBeVisible();
            await cash.focus();
            await expect(popover).toBeVisible();
        }
        await page.keyboard.press('Escape');
        await expect(popover).not.toBeVisible();
        await page.close();
    }
});
