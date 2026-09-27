const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');

const baseURL = process.env.PURCHASE_TEST_BASE_URL || 'http://127.0.0.1:3100';

test('purchase exception stays explicit, validates evidence and awaits a statement', { timeout: 90000 }, async (t) => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => t.diagnostic(error.message));
    t.after(async () => {
        if (!page.isClosed() && t.error) {
            t.diagnostic(await page.locator('body').innerText());
            await page.screenshot({ path: '/tmp/purchase-exception-failure.png' });
        }
    });
    t.after(() => browser.close());
    page.setDefaultTimeout(10000);
    const now = '2026-09-09T00:00:00Z';
    let action = {
        id: 1, alert_id: 1, ticker: 'AEVT', alert_type: 'ADD', source: 'tms',
        scope: 'SECURITY', asset_class_code: 'GOLD_MINERS', intent: 'DEPLOY',
        status: 'OPEN', priority: 2, instruction_basis: 'CLASS_POOL',
        instruction: 'Q4 is active; increases in this asset class are paused',
        deployment_state: 'Q4_BLOCKED', is_primary: true, queue_count: 1,
        created_at: now, updated_at: now,
    };
    const writes = [];
    await mockContextPanel(page);
    await page.addInitScript(() => localStorage.setItem('alpha-edge-api-token', 'isolated-browser-fixture'));
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let data = [];
        if (path.endsWith('/record-execution')) {
            const payload = route.request().postDataJSON();
            writes.push(payload);
            action = { ...action, status: 'AWAITING_STATEMENT', reconciliation_method: 'REPORTED_UNITS',
                execution_units: payload.units, execution_cash_value: payload.cash_value,
                execution_exception_reason: payload.exception_reason };
            data = { status: 'AWAITING_STATEMENT' };
        } else if (path.endsWith('/sizing/allocations')) {
            data = { allocations: [] }; // Read-only calculation uses POST.
        } else if (!['GET', 'OPTIONS'].includes(route.request().method())) {
            throw new Error(`Unexpected write: ${path}`);
        } else if (path.endsWith('/security-actions')) data = [action];
        else if (path.endsWith('/statements/latest')) data = {
            statement: { id: 1, account_name: 'Fixture', statement_date: now, total_value_aud: 10000, cash_aud: 500, created_at: now },
            holdings: [{ id: 101, statement_id: 1, details: 'Australis Gold Ltd', ticker: 'AEVT', exchange_prefix: 'ASX:', quantity: 100,
                cost_aud: 500, current_price: 5, value_aud: 500, gain_loss_aud: 0, gain_loss_pct: 0, currency: 'AUD', market_value: 500, created_at: now }],
        };
        else if (path.endsWith('/analysis')) data = [{ id: 201, ticker: 'ASX:AEVT', name: 'Australis Gold Ltd', primary_asset_class: 'GOLD_MINERS', security_type: 'STOCK', allocation: 10, is_watchlist: false }];
        else if (path.endsWith('/etf/allocation-ledger')) data = { summary: {}, rows: [], classes: [], candidates: [] };
        else if (path.endsWith('/portfolio-risk/header-state')) data = { q3: null, q4: null, baseline_mix: { rows: [] } };
        else if (path.endsWith('/portfolio-mix/current')) data = { rows: [] };
        else if (path.endsWith('/commodity-themes')) data = { themes: [] };
        else return route.fallback();
        await route.fulfill({ status: 200, contentType: 'application/json', headers: {
            'Access-Control-Allow-Origin': new URL(baseURL).origin,
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        }, body: JSON.stringify(data) });
    });
    await page.goto(`${baseURL}/#/positions`);
    await page.getByTitle('Add: Needs action. Open in Alert Stack.', { exact: true }).click();
    const drawer = page.getByTestId('alert-action-detail');
    await expect(drawer.getByText('Record purchase exception', { exact: true })).toHaveCount(0);
    action = { ...action, can_record_purchase_exception: true };
    await page.reload();
    await page.getByTitle('Add: Needs action. Open in Alert Stack.', { exact: true }).click();
    await expect(drawer.getByText('Q4 is active; increases in this asset class are paused')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Record execution', exact: true })).toBeDisabled();
    await drawer.getByText('Record purchase exception', { exact: true }).click();
    const submit = drawer.getByRole('button', { name: 'Record exception', exact: true });
    await expect(submit).toBeDisabled();
    assert.equal(writes.length, 0);
    await drawer.getByLabel('Units bought').fill('10');
    await drawer.getByLabel('AUD spent').fill('600');
    await expect(submit).toBeDisabled();
    await drawer.getByLabel('Exception reason').fill('Order already filled before checking Q4');
    await expect(submit).toBeEnabled();
    assert.equal(writes.length, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await drawer.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.screenshot({ path: '/tmp/purchase-exception-form-mobile.png' });
    for (const label of ['Units bought', 'AUD spent', 'Exception reason']) {
        const control = await drawer.getByLabel(label).boundingBox();
        assert.ok(control.width > 100 && control.height >= 32 && control.x >= bounds.x
            && control.x + control.width <= bounds.x + bounds.width, `${label} fits the mobile drawer: ${JSON.stringify({control, bounds})}`);
    }
    await page.screenshot({ path: '/tmp/purchase-exception-form-mobile.png' });
    await submit.click();
    await expect(drawer).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTitle(/Awaiting statement.*View in Decision History/).click();
    const record = page.getByTestId('decision-record-action:1');
    await record.getByText('View record', { exact: true }).click();
    await expect(record.getByText('$600', { exact: true })).toBeVisible();
    await expect(record.getByText('Order already filled before checking Q4', { exact: true })).toBeVisible();
    await expect(record).toContainText('Awaiting statement');
    await expect(record).toContainText('Execution recorded');
    await expect(record).not.toContainText('System closure');
    assert.deepEqual(writes, [{ notes: '', units: 10, cash_value: 600, exception_reason: 'Order already filled before checking Q4' }]);
    await page.screenshot({ path: '/tmp/purchase-exception-mobile.png' });
});
