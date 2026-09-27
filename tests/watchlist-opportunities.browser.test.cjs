const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

async function setup(t, { width = 1366, theme = 'dark' } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (request.method() !== 'GET' && request.url().includes('/api/') && !request.url().endsWith('/sizing/allocations')) writes.push(request.url());
    });
    await page.addInitScript(theme => {
        localStorage.setItem('theme', theme);
        localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed');
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
    }, theme);
    await page.goto(`${base}/#/positions`, { waitUntil: 'domcontentloaded' });
    if (width < 1024) await page.getByRole('button', { name: 'Open Alert Stack', exact: true }).click();
    const scope = page.getByRole('navigation', { name: 'Alert scope' });
    await expect(scope.getByRole('button', { name: 'Positions, 8 alerts' })).toBeVisible();
    await expect(scope.getByRole('button', { name: 'Watchlist, 2 alerts' })).toBeVisible();
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(writes, []); });
    return { page, scope };
}

async function openWatchlist(page, scope) {
    await scope.getByRole('button', { name: /^Watchlist,/ }).click();
    const expand = page.getByRole('button', { name: 'Expand all asset classes', exact: true });
    if (await expand.isVisible()) await expand.click();
    await expect(page.getByTestId('stack-alert-11')).toBeVisible();
}

for (const [width, theme] of [[1366, 'dark'], [1366, 'light'], [390, 'dark'], [320, 'light']]) {
    test(`horizontal stack selector and entry review at ${width}px ${theme}`, { timeout: 60000 }, async t => {
        const { page, scope } = await setup(t, { width, theme });
        const header = scope.locator('..');
        assert.ok(await header.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'selector and collapse control must fit');
        await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(header).toHaveCSS('border-bottom-width', '0px');
        await expect(scope).toHaveCSS('border-bottom-width', '1px');
        await expect(scope.getByRole('button', { name: /all asset classes/ })).toHaveCount(0);
        const before = await page.getByRole('button', { name: 'Expand all asset classes', exact: true }).boundingBox();
        await openWatchlist(page, scope);
        const after = await page.getByRole('button', { name: 'Collapse all asset classes', exact: true }).boundingBox();
        assert.deepEqual(after, before, 'collapse button must not move or resize when switching');
        const alert = page.getByTestId('stack-alert-11');
        await expect(alert).toContainText('South32 Limited');
        await expect(alert).toContainText('Breakout');
        await expect(page.getByTestId('stack-alert-12')).toContainText('Outperform');
        await expect(page.getByTestId('stack-alert-1')).toHaveCount(0);
        mkdirSync('/tmp/alpha-edge-watchlist', { recursive: true });
        await page.screenshot({ path: `/tmp/alpha-edge-watchlist/stack-${width}-${theme}.png` });
        await alert.focus();
        await page.keyboard.press('Enter');
        const panel = page.getByRole('complementary', { name: 'Watchlist entry review' });
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('$100');
        await expect(panel).toContainText('13.3%');
        await panel.getByRole('button', { name: 'About this entry estimate' }).click();
        await expect(page.getByText(/Alternative estimate, not reserved cash/)).toBeVisible();
        await page.keyboard.press('Escape');
        await panel.getByText('Peer Ideal wt', { exact: true }).click();
        await expect(panel.getByRole('table')).toContainText('ASX:BHP');
        assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'entry review must not overflow');
        if (width < 1024) await page.getByRole('dialog', { name: 'Entry review' }).getByRole('button', { name: /Close/ }).click();
        else await panel.getByRole('button', { name: 'Close entry review' }).click();
        await expect(panel).toHaveCount(0);
    });
}

test('Alerts stays a setup ledger; blocked entry opens from the stack', { timeout: 60000 }, async t => {
    const { page, scope } = await setup(t);
    await page.getByTestId('main-tab-alerts').click();
    await page.getByRole('navigation', { name: 'Connection scope' }).getByRole('button', { name: /Watchlist/ }).click();
    await expect(page.getByRole('searchbox', { name: 'Search watchlist connections' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Watchlist opportunities' })).toHaveCount(0);
    await expect(page.getByText('TradingView setup ledger', { exact: true })).toBeVisible();
    await openWatchlist(page, scope);
    await page.getByTestId('stack-alert-12').click();
    const panel = page.getByRole('complementary', { name: 'Watchlist entry review' });
    await expect(panel).toContainText('Class at capacity');
    await expect(panel.getByRole('button', { name: 'Review action' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Research', exact: true }).click();
    await expect(page).toHaveURL(/#\/analysis$/);
    await expect(page.locator('.analysis-stock-row').filter({ hasText: 'Regis Resources Limited' })).toBeVisible();
});

test('CSL alerts resolve the held name, class, chart and trim details with qualified or bare tickers', { timeout: 60000 }, async t => {
    const { page } = await setup(t);
    let ticker = 'ASX:CSL';
    await page.route(/\/api\/terminal\/alerts(?:\?|$)/, route => route.fulfill({ json: [{
        id: 901, ticker, alert_type: 'TRIM', strength: 'Weak', source: 'tms', is_active: true,
        created_at: new Date().toISOString(), expiry_date: null,
    }] }));
    for (const symbol of ['ASX:CSL', 'CSL']) {
        ticker = symbol;
        await page.reload();
        const group = page.getByRole('button', { name: 'Pharma, 1 alerts', exact: true });
        await expect(group).toBeVisible();
        await expect(page.getByRole('button', { name: 'Unassigned, 1 alerts', exact: true })).toHaveCount(0);
        await group.hover();
        const alert = page.getByTestId('stack-alert-901');
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('CSL Limited');
        await expect(alert.getByRole('link')).toHaveAttribute('href', 'https://www.tradingview.com/chart/?symbol=ASX%3ACSL');
        await alert.click();
        const dialog = page.locator('.terminal-action-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('CSL Limited');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
});

test('scope persists without losing collapse state or silently merging signal records', { timeout: 60000 }, async t => {
    const { page, scope } = await setup(t);
    const alerts = await (await page.request.get(`${base}/api/terminal/alerts`)).json();
    await page.route(/\/api\/terminal\/alerts(?:\?|$)/, route => route.fulfill({ json: [...alerts, {
        id: 900, ticker: 'S32', alert_type: 'BREAKOUT', strength: 'Strong', source: 'cdf', is_active: true,
        created_at: new Date().toISOString(), expiry_date: null,
    }] }));
    await page.reload();
    await expect(scope.getByRole('button', { name: 'Watchlist, 3 alerts' })).toBeVisible();
    await openWatchlist(page, scope);
    await expect(page.getByTestId('stack-alert-900')).toBeVisible();
    await page.getByRole('button', { name: 'Collapse all asset classes', exact: true }).click();
    await expect(page.getByTestId('stack-alert-900')).not.toBeVisible();
    await page.reload();
    await expect(scope.getByRole('button', { name: /^Watchlist,/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Expand all asset classes', exact: true })).toBeVisible();
    await scope.getByRole('button', { name: /^Positions,/ }).click();
    await expect(page.getByTestId('stack-alert-900')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand all asset classes', exact: true }).click();
    await expect(page.getByTestId('stack-alert-1')).toBeVisible();
});

test('both scope buttons remain available when either or both lists are empty', { timeout: 60000 }, async t => {
    const { page, scope } = await setup(t);
    const alerts = await (await page.request.get(`${base}/api/terminal/alerts`)).json();
    let items = alerts.filter(alert => alert.id === 11);
    await page.route(/\/api\/terminal\/alerts(?:\?|$)/, route => route.fulfill({ json: items }));
    await page.reload();
    await expect(scope.getByRole('button', { name: 'Positions, 0 alerts' })).toBeVisible();
    await expect(page.getByText('No position alerts', { exact: true })).toBeVisible();
    await openWatchlist(page, scope);
    items = [];
    await page.reload();
    await expect(scope.getByRole('button', { name: 'Watchlist, 0 alerts' })).toBeVisible();
    await expect(page.getByText('No watchlist alerts', { exact: true })).toBeVisible();
    await scope.getByRole('button', { name: /^Positions,/ }).click();
    await expect(page.getByText('No position alerts', { exact: true })).toBeVisible();
});

test('assessment failure leaves watchlist signals visible and can be retried', { timeout: 60000 }, async t => {
    const { page, scope } = await setup(t);
    await openWatchlist(page, scope);
    await page.route('**/api/terminal/watchlist/opportunities', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.getByTestId('stack-alert-11').click();
    const panel = page.getByRole('complementary', { name: 'Watchlist entry review' });
    await expect(panel.getByRole('status')).toContainText('unavailable');
    await expect(page.getByTestId('stack-alert-11')).toBeVisible();
    await expect(panel).not.toContainText('Ready to review');
    await page.unroute('**/api/terminal/watchlist/opportunities');
    await panel.getByRole('button', { name: 'Refresh entry review' }).click();
    await expect(panel).toContainText('Ready to review');
});

test('an action change during an in-flight read discards the old assessment', { timeout: 60000 }, async t => {
    const { page, scope } = await setup(t);
    const data = await (await page.request.get(`${base}/api/terminal/watchlist/opportunities`)).json();
    let release, requests = 0;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/terminal/watchlist/opportunities', async route => {
        const current = ++requests;
        if (current === 1) await gate;
        await route.fulfill({ json: current === 1 ? data : { ...data, items: data.items.map(item => ({ ...item, state: 'PENDING', entry: 0 })) } });
    });
    await openWatchlist(page, scope);
    await page.getByTestId('stack-alert-11').click();
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('security-actions:changed')));
    release();
    await expect(page.getByRole('complementary', { name: 'Watchlist entry review' })).toContainText('Awaiting statement');
    assert.equal(requests, 2);
});
