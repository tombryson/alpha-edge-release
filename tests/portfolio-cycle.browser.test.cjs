const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const base = process.env.PORTFOLIO_CYCLE_BASE_URL || 'http://127.0.0.1:3312';

async function setup(t, width = 1366, theme = 'terminal-dark') {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await require('./fixtures/browser-access.cjs').mockBrowserAccess(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.addInitScript(theme => {
        localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed');
        localStorage.setItem('alpha-edge-theme', theme);
    }, theme);
    return page;
}

test('cycle returns follow approval periods, not allocation differences', { timeout: 90000 }, async t => {
    const page = await setup(t);
    await page.goto(`${base}/#/portfolio`);
    const overview = page.getByTestId('portfolio-overview');
    const summary = overview.getByTestId('portfolio-cycle-summary');
    await expect(summary).toContainText('Cycle v3');
    await expect(summary).toContainText('Northern Star Resources Limited');
    await expect(summary).toContainText('+28.0%');
    const gold = overview.locator('[data-asset-class="GOLDMINERS"]');
    await expect(gold.locator('[data-mobile-label="Return %"]')).toContainText('%');
    const original = await gold.locator('[data-mobile-label="Return %"]').innerText();
    const labels = await gold.evaluate(row => [...row.children].map(cell => cell.getAttribute('data-mobile-label')).filter(Boolean));
    assert.equal(labels[labels.indexOf('Approved') + 1], 'Return %');
    await overview.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(gold.locator('[data-mobile-label="Return %"]')).toHaveText(original);
    await expect(overview.locator('[data-asset-class="CASH"] [data-mobile-label="Return %"]')).toHaveText('—');
    await summary.getByRole('button', { name: 'About cycle returns' }).click();
    await expect(page.getByText('Opening holdings, weighted by their starting capital.', { exact: false })).toBeVisible();
    await page.keyboard.press('Escape');
    await overview.getByRole('button', { name: 'Timeline', exact: true }).click();
    await page.locator('button[aria-pressed]').filter({ hasText: 'Approved v3' }).first().click();
    await expect(page.getByTestId('portfolio-cycle-summary')).toContainText('Cycle v3');
    const previous = page.locator('button[aria-pressed]').filter({ hasText: 'Approved v2' }).first();
    await previous.click();
    await expect(page.getByTestId('portfolio-cycle-summary')).toContainText('Cycle v2');
    await expect(page.getByTestId('portfolio-cycle-summary')).toContainText('+21.0%');
    await expect(page.getByTestId('portfolio-cycle-summary')).not.toContainText('now');
    await page.screenshot({ path: '/tmp/alpha-edge-cycle-timeline.png' });
});

test('missing evidence and endpoint failure cannot turn into zero returns', { timeout: 90000 }, async t => {
    const page = await setup(t);
    await page.route('**/portfolio-mix/cycle-performance?*', route => route.fulfill({ json: {
        cycle: { snapshot_id: 3, started_at: '2026-06-15T09:00:00Z', ended_at: '2026-09-18T09:00:00Z', closed: false },
        method: 'opening_basket_adjusted_price_return', baseline_at: null, covered: 0, securities: [], best_performer: null,
        classes: [{ asset_class: 'GOLD_MINERS', return_pct: null, covered: 0, securities: 3, coverage_pct: 0, reason: 'Opening price evidence missing.' }], reason: 'No opening statement.',
    } }));
    await page.goto(`${base}/#/portfolio`);
    const gold = page.locator('[data-asset-class="GOLDMINERS"] [data-mobile-label="Return %"]');
    await expect(gold).toHaveText('—');
    await expect(gold.locator('span')).toHaveAttribute('title', 'Opening price evidence missing.');
    await expect(page.getByTestId('portfolio-cycle-summary')).toContainText('Return unavailable');
    await page.unroute('**/portfolio-mix/cycle-performance?*');
    await page.route('**/portfolio-mix/cycle-performance?*', route => route.fulfill({ status: 503, json: { error: 'Cycle performance unavailable' } }));
    await page.reload();
    await expect(gold).toHaveText('—');
    await expect(page.getByTestId('portfolio-cycle-summary')).toContainText('Return unavailable', { timeout: 20000 });
    await page.getByRole('button', { name: 'About cycle returns' }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Cycle performance unavailable');
});

for (const [width, theme] of [[1366, 'terminal-dark'], [1366, 'terminal-light-soft'], [390, 'terminal-dark']]) {
    test(`cycle layout fits ${width}px ${theme}`, { timeout: 90000 }, async t => {
        const page = await setup(t, width, theme);
        await page.goto(`${base}/#/portfolio`);
        await expect(page.getByTestId('portfolio-cycle-summary')).toContainText('Best performer');
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const summary = await page.getByTestId('portfolio-cycle-summary').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(summary.scroll <= summary.width + 1);
        const gold = page.locator('[data-asset-class="GOLDMINERS"]');
        const boxes = await gold.locator('[data-mobile-label]').evaluateAll(elements => elements.map(el => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'Numeric columns overlap');
        }
        await page.screenshot({ path: `/tmp/alpha-edge-cycle-${width}-${theme}.png`, fullPage: true });
    });
}
