const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');

const baseURL = process.env.ALERT_STACK_TEST_BASE_URL || process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const now = '2026-09-09T00:00:00Z';
const names = Array.from({ length: 18 }, (_, i) => i === 0
    ? 'International Critical Minerals Exploration and Development Limited'
    : `Gold exploration company ${i}`);

test('mobile Alert Stack position cards retain full text, padding and reachable actions', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    t.after(() => browser.close());
    page.setDefaultTimeout(10000);
    const writes = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-api-token', 'isolated-browser-fixture');
        localStorage.setItem('alpha-edge-alert-stack-ui', JSON.stringify({ allAssetClassesExpanded: true, pinnedAssetClasses: {} }));
    });
    // All provider traffic is intercepted, including writes. No UAT records change.
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let body = [];
        if (path.endsWith('/sizing/allocations')) body = { allocations: [] };
        else if (!['GET', 'OPTIONS'].includes(route.request().method())) writes.push(path);
        if (path.endsWith('/statements/latest')) body = {
            statement: { id: 1, account_name: 'Fixture', statement_date: now, total_value_aud: 10000, cash_aud: 500, created_at: now },
            holdings: names.map((details, i) => ({
                id: i + 101, statement_id: 1, details, ticker: `GLD${i}`, exchange_prefix: 'ASX:', quantity: 100,
                cost_aud: 500, current_price: 5, value_aud: 500, gain_loss_aud: 0, gain_loss_pct: 0,
                currency: 'AUD', market_value: 500, created_at: now,
            })),
        };
        else if (path.endsWith('/analysis')) body = names.map((name, i) => ({
            id: i + 201, ticker: `ASX:GLD${i}`, name, primary_asset_class: 'GOLD_MINERS', security_type: 'STOCK', is_watchlist: false,
        }));
        else if (path.endsWith('/alerts')) body = names.map((_, i) => ({
            id: i + 1, ticker: `GLD${i}`, alert_type: ['SELL_50', 'BREAKOUT', 'UNDERPERFORM', 'TRIM'][i % 4],
            strength: 'Strong', created_at: now, move_pct: -11.76, alert_price: 5,
        }));
        else if (path.endsWith('/etf/allocation-ledger')) body = { summary: {}, rows: [], classes: [], candidates: [] };
        else if (path.endsWith('/portfolio-risk/header-state')) body = { q3: null, q4: null, baseline_mix: { rows: [] } };
        else if (path.endsWith('/portfolio-mix/current')) body = { rows: [] };
        else if (path.endsWith('/commodity-themes')) body = { themes: [] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${baseURL}/#/alerts`);
    await page.getByRole('button', { name: 'Open Alert Stack', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Alert Stack', exact: true });
    const cards = drawer.locator('div[role="button"][tabindex="0"]');
    await expect(cards).toHaveCount(names.length);
    await expect(drawer.getByTitle(names[0], { exact: true })).toBeVisible();

    for (const width of [320, 390, 768, 1023]) {
        await page.setViewportSize({ width, height: 844 });
        const measurements = await cards.evaluateAll(elements => elements.map(card => {
            const content = card.querySelector('[class*="alertContent"]');
            const details = card.querySelector('[class*="alertDetails"]');
            const name = card.querySelector('[title]');
            const dismiss = card.querySelector('button');
            const bounds = card.getBoundingClientRect();
            const main = content.getBoundingClientRect();
            const close = dismiss.getBoundingClientRect();
            const style = getComputedStyle(card);
            return {
                height: bounds.height,
                paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom),
                contentFits: main.top >= bounds.top + 6 && main.bottom <= bounds.bottom - 6,
                dismissFits: close.left >= main.right && close.right <= bounds.right && close.width >= 32 && close.height >= 32,
                detailsHeight: details.getBoundingClientRect().height,
                lineHeights: [...details.querySelectorAll('span')].map(el => el.getBoundingClientRect().height),
                nameWraps: getComputedStyle(name).whiteSpace === 'normal',
                noTextCrop: [...content.querySelectorAll('span, a, [title]')].filter(el => el.getClientRects().length > 0).every(el => {
                    const r = el.getBoundingClientRect();
                    return r.left >= main.left - 1 && r.right <= main.right + 1 && r.top >= main.top - 1 && r.bottom <= main.bottom + 1;
                }),
            };
        }));
        for (const row of measurements) {
            assert.ok(row.height >= 56 && row.paddingTop === 6 && row.paddingBottom === 6, JSON.stringify(row));
            assert.ok(row.contentFits && row.dismissFits && row.nameWraps && row.noTextCrop, JSON.stringify(row));
            assert.ok(row.detailsHeight >= 18 && row.lineHeights.every(h => h >= 18), 'signal lines are not 6px high');
        }
        assert.ok(measurements[0].height > measurements[1].height, 'long company names grow the card');
        if (width >= 390) assert.ok(measurements[1].height <= 60, 'short alerts stay compact');
        assert.ok((await drawer.boundingBox()).width <= width, 'drawer stays within viewport');
        const group = drawer.locator('[data-expanded="true"]').first();
        assert.equal(await group.evaluate(el => getComputedStyle(el).maxHeight), 'none');
        assert.ok((await group.boundingBox()).height > 900, 'large groups are not cut off');
        await cards.last().scrollIntoViewIfNeeded();
        await expect(cards.last()).toBeInViewport();
        await expect(cards.last().getByRole('link')).toBeInViewport();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await cards.first().scrollIntoViewIfNeeded();
    await expect(cards.first().locator('[class*="alertAgeCompact"]')).not.toBeVisible();
    await expect(cards.first().locator('[class*="alertAgeFull"]')).toBeVisible();
    await page.screenshot({ path: '/tmp/alert-stack-mobile.png' });

    // Opening an alert still opens its existing workflow, without submitting it.
    await cards.first().click();
    await expect(page.getByText('Confirm Sell 50%', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(drawer).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktop = page.getByTestId('shell-left-rail').locator('div[role="button"][tabindex="0"]').first();
    await expect(desktop).toBeVisible();
    await expect(desktop.locator('[class*="alertAgeCompact"]')).toBeVisible();
    await expect(desktop.locator('[class*="alertAgeFull"]')).not.toBeVisible();
    assert.equal(await desktop.getByTitle(names[0], { exact: true }).evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    const desktopBounds = await desktop.boundingBox();
    assert.ok(desktopBounds.height <= 68, 'narrow desktop rails retain compact production cards with room for longer instructions');
    assert.equal(await desktop.locator('[class*="alertDetails"]').evaluate(el => getComputedStyle(el).fontSize), '11px');
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
});
