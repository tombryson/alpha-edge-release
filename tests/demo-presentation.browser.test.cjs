const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

for (const width of [1366, 390]) {
    test(`demo portfolio and market fixtures render at ${width}px`, { timeout: 60000 }, async t => {
        const browser = await chromium.launch();
        t.after(() => browser.close());
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            localStorage.setItem('theme', 'dark');
            localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed');
            localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
        });
        // External charts are isolated; all portfolio and market data comes from the real demo gateway.
        await page.route('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', route => route.fulfill({
            contentType: 'application/javascript', body: `(() => {
                const script = document.currentScript;
                const frame = document.createElement('iframe');
                frame.srcdoc = '<html><body>Chart test fixture</body></html>';
                script.parentElement.querySelector('.tradingview-widget-container__widget').append(frame);
            })();`,
        }));
        await page.goto(`${base}/#/positions`, { waitUntil: 'domcontentloaded' });
        const stats = page.locator('.terminal-portfolio-stats');
        await expect(stats).toContainText('$283,350');
        await expect(stats).toContainText('$14,648');
        await stats.getByRole('button', { name: 'Show P/L as percentage' }).click();
        await expect(stats).toContainText('+31.7%');
        if (width > 768) {
            await expect(page.getByRole('button', { name: 'Unassigned, 1 alerts', exact: true })).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Pharma, 1 alerts', exact: true })).toBeVisible();
            await expect(page.getByRole('navigation', { name: 'Alert scope' })
                .getByRole('button', { name: 'Positions, 8 alerts', exact: true })).toHaveAttribute('aria-pressed', 'true');
            await page.getByRole('button', { name: 'Expand all asset classes', exact: true }).click();
            const ignore = page.getByRole('button', { name: 'Ignore CSL Limited alert', exact: true });
            await expect(ignore).toBeDisabled();
            await expect(ignore).toHaveAttribute('title', 'Demo alerts are read-only');
            await expect(page.getByTestId('stack-alert-2')).toHaveCount(0);
            await expect(page.getByTestId('stack-alert-6')).toHaveCount(0);
            await expect(page.getByText('The alert could not be ignored.', { exact: true })).toHaveCount(0);
            await page.getByRole('button', { name: 'Collapse all asset classes', exact: true }).click();
            await expect(page.getByRole('button', { name: 'Show Positions shape strip', exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Show Positions shape strip', exact: true }).click();
            await page.reload();
            await expect(page.getByRole('button', { name: 'Hide Positions shape strip', exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Hide Positions shape strip', exact: true }).click();
        }
        mkdirSync('/tmp/alpha-edge-demo-presentation', { recursive: true });
        await page.screenshot({ path: `/tmp/alpha-edge-demo-presentation/positions-${width}.png` });
        await page.goto(`${base}/#/markets`, { waitUntil: 'domcontentloaded' });
        for (const code of ['GOLD', 'SILVER', 'COPPER', 'BASE_METALS', 'IRON_ORE', 'OIL', 'URANIUM']) {
            await expect(page.getByTestId(`market-row-${code}`)).toBeVisible();
        }
        await expect(page.getByText('Data unavailable', { exact: true })).toHaveCount(0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page must not overflow');
        await page.screenshot({ path: `/tmp/alpha-edge-demo-presentation/markets-${width}.png` });
        await page.getByTestId('market-theme-GOLD').click();
        for (const stage of ['COMMODITY', 'EQUITY_RELATIVE', 'SECURITY_TREND', 'SECURITY_OUTPERFORM']) {
            await expect(page.getByTestId(`market-chart-${stage}`)).toHaveCount(1);
        }
        await page.screenshot({ path: `/tmp/alpha-edge-demo-presentation/gold-${width}.png` });
        await page.goto(`${base}/#/analysis`, { waitUntil: 'domcontentloaded' });
        const row = name => page.locator('.analysis-stock-row').filter({ has: page.getByRole('button', { name, exact: true }) });
        for (const [name, signal, drift] of [
            ['BHP Group Limited', 'Buy', '+2.4'], ['CSL Limited', 'Sell', '-2.8'], ['Sandfire Resources Limited', 'Buy', '+2.9'],
        ]) {
            await expect(row(name).locator('.analysis-signal')).toContainText(signal);
            await expect(row(name).locator('.analysis-router-drift')).toHaveText(drift);
            await expect(row(name).getByRole('button', { name: `Open Council controls for ${name}` })).not.toContainText('Run');
        }
        await page.screenshot({ path: `/tmp/alpha-edge-demo-presentation/analysis-${width}.png` });
        await row('BHP Group Limited').getByRole('button', { name: 'Open Council controls for BHP Group Limited' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Model output', exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue(/Synthetic demo research/);
        await page.screenshot({ path: `/tmp/alpha-edge-demo-presentation/council-${width}.png` });
        assert.deepEqual(errors, []);
    });
}

test('signal lookup accepts unique legacy symbols but not a different exchange', { timeout: 60000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.addInitScript(() => localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed'));
    let ticker = 'BHP';
    await page.route('**/api/terminal/positions', route => route.fulfill({ json: [{ ticker, position_state: 'SELL' }] }));
    await page.goto(`${base}/#/analysis`);
    const row = page.locator('.analysis-stock-row').filter({ has: page.getByRole('button', { name: 'BHP Group Limited', exact: true }) });
    await expect(row.locator('.analysis-signal')).toContainText('Sell');
    ticker = 'NYSE:BHP';
    await page.reload();
    await expect(row).toBeVisible();
    await expect(row.locator('.analysis-signal')).toHaveCount(0);
    ticker = 'ASX:BHP';
    await page.reload();
    await expect(row.locator('.analysis-signal')).toContainText('Sell');
});
