const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const embedUrl = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

function collectRuntimeErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (['error', 'warning'].includes(message.type()) && /hydrat|unique.*key|same key|contentWindow|Cannot listen/.test(message.text())) {
            errors.push(message.text());
        }
    });
    return errors;
}

test('saved themes hydrate without warnings and stock rows retain identity through sorting', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    for (const theme of ['terminal-dark', 'terminal-light-soft', 'amber-dark', 'catppuccin-light']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const fixture = await mockContextPanel(page);
        await page.addInitScript(theme => localStorage.setItem('alpha-edge-theme', theme), theme);
        const errors = collectRuntimeErrors(page);
        await page.goto(`${base}/#/positions`);
        const rows = page.locator('tr.positions-stock-row');
        await expect(rows).toHaveCount(2);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('light')), theme.endsWith('light') || theme === 'terminal-light-soft');
        const producer = rows.filter({ hasText: 'Gold Producer' });
        const originalNode = await producer.elementHandle();
        const nameHeader = page.locator('.positions-grid thead th').filter({ hasText: 'NAME' }).first();
        await nameHeader.click();
        await nameHeader.click();
        assert.ok(await producer.evaluate((el, original) => el === original, originalNode), 'sorting must move the existing keyed row, not recreate it');
        await page.evaluate(() => { location.hash = '/etf'; });
        await expect(page.getByRole('region', { name: 'ETF allocations', exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('region', { name: 'ETF allocations', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        assert.deepEqual(errors, []);
        assert.deepEqual(fixture.writes, []);
        await page.close();
    }
});

// Like the provider, this script replaces its host and attaches iframe listeners.
// Executing it after its document is detached reproduces the reported warning.
const widgetScript = `(() => {
    const script = document.currentScript;
    const config = JSON.parse(script.textContent);
    const frame = document.createElement('iframe');
    frame.dataset.config = JSON.stringify(config);
    frame.srcdoc = '<html><body>Chart lifecycle fixture</body></html>';
    script.parentElement.querySelector('.tradingview-widget-container__widget').replaceWith(frame);
    if (!frame.contentWindow) console.error('Cannot listen to the event from the provided iframe, contentWindow is not available');
})();`;

test('late chart scripts cannot initialise detached views after closing, selecting or changing theme', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixture = await mockContextPanel(page);
    const errors = collectRuntimeErrors(page);
    let delay = false;
    const pending = [];
    await page.route(embedUrl, route => {
        if (delay) { pending.push(route); return; }
        return route.fulfill({ contentType: 'application/javascript', body: widgetScript });
    });
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    const chart = panel.getByTestId('security-price-chart');
    const producer = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' });
    for (const action of ['close', 'symbol', 'theme']) {
        await panel.getByRole('tab', { name: 'ETFs', exact: true }).click();
        delay = true;
        await producer.locator('td').first().dblclick();
        await expect.poll(() => pending.length).toBeGreaterThan(0);
        delay = false;
        if (action === 'close') {
            await panel.getByRole('tab', { name: 'ETFs', exact: true }).click();
            await expect(chart).toHaveCount(0);
        } else if (action === 'symbol') {
            await page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Core ETF' }).locator('td').first().dblclick();
            await expect(chart).toHaveAttribute('data-symbol', 'ASX:GOLD');
        } else {
            await page.getByTitle('Switch to light mode', { exact: true }).click();
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'terminal-light-soft');
        }
        for (const route of pending.splice(0)) {
            await route.fulfill({ contentType: 'application/javascript', body: widgetScript });
        }
        if (action !== 'close') {
            const provider = chart.locator('iframe').contentFrame().locator('iframe');
            await expect(provider).toHaveCount(1);
            await expect(chart.getByRole('status')).toHaveCount(0);
            const config = JSON.parse(await provider.getAttribute('data-config'));
            assert.equal(config.symbol, action === 'symbol' ? 'ASX:GOLD' : 'ASX:STOCK');
            assert.equal(config.theme, action === 'theme' ? 'light' : 'dark');
        }
        // Let any detached response execute before checking for runtime warnings.
        await page.waitForTimeout(150);
        assert.deepEqual(errors, []);
    }
    await panel.getByRole('tab', { name: 'ETFs', exact: true }).click();
    await expect(page.locator('iframe[srcdoc]')).toHaveCount(0);
    assert.deepEqual(fixture.writes, []);
});

test('market charts use the same cancellable lifecycle and preserve their full chart area', { timeout: 60000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const errors = collectRuntimeErrors(page);
    const theme = {
        code: 'GOLD', display_name: 'Gold', market_group: 'Precious metals',
        status: 'CONFIRMED', confirmation_count: 1, confirmation_total: 4,
        tactical: {}, strategic_floor: {}, eligible_securities: [],
        stages: [{ key: 'COMMODITY', label: 'Commodity', status: 'CONFIRMED', signal: 'BUY', source: { kind: 'SYMBOL', symbol: 'AMEX:GLD' } }],
    };
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/commodity-themes/GOLD')) return route.fulfill({ json: theme });
        return route.fallback();
    });
    await page.route(embedUrl, route => route.fulfill({ contentType: 'application/javascript', body: widgetScript }));
    await page.goto(`${base}/#/markets/GOLD`);
    const chart = page.getByTestId('market-chart-COMMODITY');
    await chart.scrollIntoViewIfNeeded();
    const frame = chart.locator('iframe');
    const provider = frame.contentFrame().locator('iframe');
    await expect(provider).toHaveCount(1);
    const config = JSON.parse(await provider.getAttribute('data-config'));
    assert.equal(config.symbol, 'AMEX:GLD');
    assert.equal(config.range, '12M');
    const outer = await frame.boundingBox();
    const inner = await provider.boundingBox();
    assert.equal(outer.height, 250);
    assert.equal(inner.height, outer.height);
    assert.ok(Math.abs(inner.width - outer.width) <= 1, 'iframe viewport rounding must stay within one CSS pixel');
    await page.evaluate(() => { location.hash = '/etf'; });
    await expect(chart).toHaveCount(0);
    await expect(page.locator('iframe[srcdoc]')).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.writes, []);
});
