const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const { themes: [gold] } = require('../lib/market-preview.ts').default;
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

async function setup(t, theme = gold) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixture = await mockContextPanel(page);
    await page.route(/\/commodity-themes(?:\/GOLD)?(?:\?.*)?$/, route => route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/GOLD') ? theme : { themes: [theme] },
    }));
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'MARKETS', layout: { left: 'open', right: 'open' } }));
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    await page.goto(`${base}/#/markets`);
    await expect(page.getByTestId('market-theme-GOLD')).toBeVisible();
    await waitForRailLayout(page);
    return page;
}

test('mixed signal labels keep all map nodes and connectors on one baseline', { timeout: 120000 }, async t => {
    const page = await setup(t);
    const row = page.getByTestId('market-theme-GOLD');
    for (const width of [2400, 1440, 1366, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await waitForRailLayout(page);
        await expect.poll(() => row.locator('[data-market-stage-node]').evaluateAll(nodes => {
            const ys = nodes.map(node => { const r = node.getBoundingClientRect(); return r.y + r.height / 2; });
            return Math.max(...ys) - Math.min(...ys);
        })).toBeLessThanOrEqual(0.6);
        const stages = await row.locator('[data-market-stage-cell]').evaluateAll(cells => cells.map(cell => {
            const label = cell.querySelector('[data-market-stage-label]');
            const node = cell.querySelector('[data-market-stage-node]');
            const track = cell.querySelector('[data-market-stage-track]');
            const r = cell.getBoundingClientRect();
            const n = node.getBoundingClientRect();
            return { centered: Math.abs(r.x + r.width / 2 - n.x - n.width / 2), separated: label.getBoundingClientRect().bottom <= track.getBoundingClientRect().top + 1, pieces: track.children.length };
        }));
        assert.ok(stages.every(stage => stage.centered < 1 && stage.separated), JSON.stringify({ width, stages }));
        assert.equal(stages[0].pieces, 1, 'The physical commodity must remain separate from the equity chain');
        assert.equal(stages[2].pieces, 3, 'Company retains both equity connectors');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (width >= 768) {
            const offsets = await page.locator('.market-map-list').evaluate(list => {
                const headers = [...list.querySelector(':scope > div').children].slice(1, 5);
                const cells = [...list.querySelectorAll('[data-market-stage-cell]')];
                return headers.map((header, i) => Math.abs(header.getBoundingClientRect().x - cells[i].getBoundingClientRect().x));
            });
            assert.ok(offsets.every(offset => offset <= 1), JSON.stringify({ width, offsets }));
        }
        if ([1440, 390].includes(width)) await page.screenshot({ path: `/tmp/markets-map-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('market-stock-evidence-toggle-GOLD').click();
    await expect(page.getByTestId('market-stock-evidence-GOLD')).toBeVisible();
    await expect(page).toHaveURL(/#\/markets$/);
    await row.click();
    await expect(page.getByTestId('market-detail-back')).toBeVisible();
    await page.getByTestId('market-detail-back').click();
    await expect(row).toBeVisible();
});

test('detail shows each signal once and keeps labelled capital and company evidence legible', { timeout: 120000 }, async t => {
    const page = await setup(t);
    await page.getByTestId('market-theme-GOLD').click();
    const signals = page.getByRole('region', { name: 'Market signals' });
    await expect(signals.locator('[data-market-detail-stage]')).toHaveCount(4);
    await expect(signals.locator('[data-market-detail-stage="COMMODITY"]')).toHaveText('Gold priceBULL');
    await expect(page.getByText('2 / 3', { exact: true })).toHaveCount(0);
    await expect(signals.getByText('$0', { exact: true })).toHaveCount(0);
    const capital = page.locator('dl[aria-label="Equity allocation"]');
    await expect(capital).toContainText('Approved equity maximum$10.0K');
    await expect(capital).toContainText('Permitted equity capacity$3.3K');
    await expect(capital).toContainText('Held equities$2.0K');
    const table = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Outperform', exact: true }) });
    await expect(page.locator('[data-testid^="market-chart-"]')).toHaveCount(4);
    await expect(table.getByRole('row')).toHaveCount(5);
    await expect(table.getByRole('row').filter({ hasText: 'Northern Star' })).toContainText('BullYes');
    await expect(table.getByRole('row').filter({ hasText: 'Genesis' })).toContainText('BearNo');
    for (const mode of ['dark', 'light']) {
        await page.setViewportSize({ width: 1440, height: 900 });
        if (mode === 'light') await page.getByTitle('Switch to light mode', { exact: true }).click();
        for (const width of [2400, 1440, 1366, 1280, 1024, 900, 768, 650, 480, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await waitForRailLayout(page);
            await expect.poll(() => signals.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            assert.equal(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            const back = await page.getByTestId('market-detail-back').boundingBox();
            assert.ok(back.x >= 0 && back.x + back.width <= width);
            if ([1440, 390].includes(width)) await page.screenshot({ path: `/tmp/markets-detail-${mode}-${width}.png` });
        }
    }
});

test('missing signals and unapproved budgets are not presented as confirmed or zero', { timeout: 60000 }, async t => {
    const missing = structuredClone(gold);
    missing.stages.forEach(stage => { stage.status = 'DISCONNECTED'; stage.eligible_security_count = 0; stage.blocked_security_count = 0; delete stage.signal; });
    missing.eligible_securities = [];
    missing.tactical.budget_approved = false;
    missing.strategic_floor.actual_value = 1000;
    missing.strategic_floor.target_value = 2000;
    const page = await setup(t, missing);
    await expect(page.getByTestId('market-theme-GOLD')).not.toContainText('BULL');
    await page.getByTestId('market-theme-GOLD').click();
    await expect(page.getByText('No mandate', { exact: true })).toHaveCount(2);
    await expect(page.getByText('No company signals received.')).toBeVisible();
    const signals = page.getByRole('region', { name: 'Market signals' });
    await expect(signals).toContainText('Held$1.0K');
    await expect(signals).toContainText('Target$2.0K');
});

test('all four charts retain symbols, recover from provider failures and follow theme changes', { timeout: 60000 }, async t => {
    const page = await setup(t);
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    const directives = Object.fromEntries(policy.split(';').map(value => {
        const [name, ...sources] = value.trim().split(/\s+/);
        return [name, sources];
    }));
    assert.deepEqual(directives['script-src'], ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js']);
    assert.deepEqual(directives['frame-src'], ["'self'", 'https://www.tradingview-widget.com']);
    assert.deepEqual(directives['connect-src'], ["'self'"]);
    assert.deepEqual(directives['default-src'], ["'self'"]);
    assert.deepEqual(directives['object-src'], ["'none'"]);
    let fail = true;
    await page.route('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', route => {
        if (fail) return route.abort('failed');
        return route.fulfill({ contentType: 'application/javascript', body: `(() => {
            const script = document.currentScript;
            const config = JSON.parse(script.textContent);
            const frame = document.createElement('iframe');
            frame.dataset.config = JSON.stringify(config);
            frame.srcdoc = '<html><body>Isolated chart fixture</body></html>';
            script.parentElement.querySelector('.tradingview-widget-container__widget').replaceWith(frame);
        })();` });
    });
    await page.getByTestId('market-theme-GOLD').click();
    const symbols = {
        COMMODITY: 'AMEX:GLD', EQUITY_RELATIVE: 'AMEX:GDX/AMEX:GLD',
        SECURITY_TREND: 'ASX:NST', SECURITY_OUTPERFORM: 'ASX:NST/AMEX:GDX',
    };
    for (const key of Object.keys(symbols)) {
        const chart = page.getByTestId(`market-chart-${key}`);
        await chart.scrollIntoViewIfNeeded();
        await expect(chart.getByText('TradingView could not be loaded.')).toBeVisible();
    }
    fail = false;
    for (const [key, symbol] of Object.entries(symbols)) {
        const chart = page.getByTestId(`market-chart-${key}`);
        await chart.getByRole('button', { name: 'Retry chart' }).click();
        await expect(chart.getByRole('status')).toHaveCount(0);
        const provider = chart.locator('iframe').contentFrame().locator('iframe');
        const config = JSON.parse(await provider.getAttribute('data-config'));
        assert.equal(config.symbol, symbol);
        assert.equal(config.theme, 'dark');
        assert.equal(config.range, '12M');
    }
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    for (const key of Object.keys(symbols)) {
        const chart = page.getByTestId(`market-chart-${key}`);
        const provider = chart.locator('iframe').contentFrame().locator('iframe');
        await expect.poll(async () => JSON.parse(await provider.getAttribute('data-config')).theme).toBe('light');
        await expect(chart.getByRole('status')).toHaveCount(0);
        await expect(chart.locator('iframe')).toHaveCount(1);
    }
    await page.getByTestId('market-detail-back').click();
    await expect(page.locator('[data-testid^="market-chart-"]')).toHaveCount(0);
});

test('a loaded wrapper without a provider chart times out rather than showing a blank success', { timeout: 40000 }, async t => {
    const page = await setup(t);
    let requests = 0;
    await page.route('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', route => {
        requests++;
        return route.fulfill({ contentType: 'application/javascript', body: '/* Provider failed to initialise. */' });
    });
    await page.getByTestId('market-theme-GOLD').click();
    const chart = page.getByTestId('market-chart-COMMODITY');
    await expect(chart.getByText('Loading chart...')).toBeVisible();
    await expect.poll(() => requests).toBeGreaterThan(0);
    const started = Date.now();
    await expect(chart.getByText('TradingView could not be loaded.')).toBeVisible({ timeout: 25000 });
    assert.ok(Date.now() - started > 15000, 'A mounted wrapper must not bypass the provider timeout');
    await expect(chart.getByRole('button', { name: 'Retry chart' })).toBeVisible();
    await expect(page.locator('[data-testid^="market-chart-"]')).toHaveCount(4);
});

test('live TradingView charts render in the demo policy', { skip: process.env.MARKET_LIVE_CHART_SMOKE !== '1', timeout: 120000 }, async t => {
    const page = await setup(t);
    await page.route('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', route => route.continue());
    await page.route('**/api/**', route => {
        const frameOrigin = new URL(route.request().frame().url()).origin;
        return frameOrigin === 'https://www.tradingview-widget.com'
            ? route.continue() : route.fallback();
    });
    page.on('console', message => { if (message.type() === 'error') t.diagnostic(message.text()); });
    page.on('requestfailed', request => t.diagnostic(`${request.url().split('#')[0]} ${request.failure()?.errorText}`));
    await page.getByTestId('market-theme-GOLD').click();
    for (const key of ['COMMODITY', 'EQUITY_RELATIVE', 'SECURITY_TREND', 'SECURITY_OUTPERFORM']) {
        const chart = page.getByTestId(`market-chart-${key}`);
        await chart.scrollIntoViewIfNeeded();
        const widget = chart.locator('iframe').contentFrame().locator('iframe').contentFrame();
        await expect(widget.locator('canvas').first()).toBeVisible({ timeout: 30000 });
        await expect.poll(() => widget.locator('canvas').evaluateAll(canvases => canvases.some(canvas => {
            try {
                const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
                let colored = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 50) colored++;
                }
                return colored > 100;
            } catch { return false; }
        })), { timeout: 30000 }).toBe(true);
        await chart.screenshot({ path: `/tmp/markets-live-${key}.png` });
    }
});
