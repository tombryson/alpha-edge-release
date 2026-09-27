const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, overrides = {}, extraActions = []) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => t.diagnostic(error.message));
    t.after(async () => { if (!page.isClosed() && t.error) { t.diagnostic(await page.locator('body').innerText()); await page.screenshot({ path: '/tmp/alert-action-failure.png' }); } });
    t.after(() => browser.close());
    await mockContextPanel(page);
    let action = { id: 1, alert_id: 100, ticker: 'STOCK', alert_type: 'TRIM', strength: 'Weak', scope: 'SECURITY', intent: 'REDUCE', instruction: 'Trim using source instruction', status: 'OPEN', is_primary: true, queue_count: 5, created_at: '2026-09-09T10:00:00Z', source: 'tms', ...overrides };
    const closed = { ...action, id: 2, alert_id: 101, is_primary: false, status: 'NOT_APPLICABLE', updated_at: '2026-09-10T10:00:00Z' };
    const writes = [];
    let fail = false;
    let failReads = false;
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/security-actions')) {
            if (failReads) return route.fulfill({ status: 503, body: 'Unavailable' });
            const active = [action, ...extraActions].filter(row => !['CONFIRMED', 'IGNORED', 'NOT_APPLICABLE', 'EXPIRED'].includes(row.status));
            return route.fulfill({ json: url.searchParams.has('includeHistory') ? [action, closed, ...extraActions] : active });
        }
        if (url.pathname.endsWith('/alerts')) return route.fulfill({ json: [action, ...extraActions].filter(row => !['CONFIRMED', 'IGNORED', 'NOT_APPLICABLE', 'EXPIRED'].includes(row.status)).map(row => ({
            id: row.alert_id, ticker: row.ticker, exchange_prefix: 'ASX:', alert_type: row.alert_type,
            strength: row.strength || '', source: row.source, created_at: row.created_at,
            is_active: !['CONFIRMED', 'IGNORED', 'NOT_APPLICABLE', 'EXPIRED'].includes(row.status),
        })) });
        if (url.pathname.includes('/security-actions/1/')) {
            const payload = route.request().postData() ? route.request().postDataJSON() : null;
            writes.push({ path: url.pathname, payload });
            if (fail) return route.fulfill({ status: 409, body: 'Recorded action changed. Reload before trying again.' });
            const status = url.pathname.endsWith('/ignore') ? 'IGNORED' : url.pathname.endsWith('/override-exit') ? 'OVERRIDDEN' : action.is_external ? 'CONFIRMED' : 'AWAITING_STATEMENT';
            action = { ...action, status, execution_units: payload?.units, execution_cash_value: payload?.cash_value,
                execution_note: payload?.notes, execution_exception_reason: payload?.exception_reason, override_reason: payload?.reason,
                execution_reported_at: '2026-09-10T01:00:00Z', reconciliation_method: action.is_external ? 'MANUAL_EXTERNAL' : payload?.units ? 'REPORTED_UNITS' : 'ESTIMATED_UNITS' };
            return route.fulfill({ json: { status } });
        }
        if (url.pathname.endsWith('/decisions')) return route.fulfill({ json: [{ id: 8, alert_id: 100, ticker: 'STOCK', alert_type: action.alert_type, decision: 'TRIM', notes: 'Broker order 123', created_at: '2026-09-10T01:00:00Z' }] });
        return route.fallback();
    });
    await page.goto(`${base}/#/positions`);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await expect(page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' })).toBeVisible();
    const open = async () => { await page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).getByTitle(/Open in Alert Stack/).click(); };
    return { page, writes, open, action: () => action, setAction: patch => { action = { ...action, ...patch }; }, fail: () => { fail = true; }, failReads: () => { failReads = true; } };
}

test('recording execution closes the detail and removes the chip; Positions Pending opens its evidence in History', { timeout: 90000 }, async t => {
    const f = await setup(t);
    await f.open();
    const dialog = f.page.getByTestId('alert-action-detail');
    await expect(dialog.getByRole('heading', { name: 'Gold Producer' })).toBeVisible();
    await expect(f.page.getByTestId('security-action-drawer')).toHaveCount(0);
    await expect(dialog).toContainText('Trim 5%');
    await dialog.getByLabel('Units traded (optional)').fill('6');
    await dialog.getByLabel('Execution note (optional)').fill('Broker order 123');
    await dialog.getByRole('button', { name: 'Record execution', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(f.action().status, 'AWAITING_STATEMENT');
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].payload.units, 6);
    const card = f.page.getByTestId('stack-alert-100');
    await expect(card).toHaveCount(0);
    await f.page.reload();
    const pending = f.page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).getByTitle(/View in Decision History/);
    await expect(pending).toContainText('Pending');
    await expect(card).toHaveCount(0);
    await pending.click();
    await expect(f.page).toHaveURL(/#\/history/);
    const history = f.page.getByRole('region', { name: 'Decision history', exact: true });
    await expect(history.getByTestId('decision-record-decision:8')).toContainText('Awaiting statement');
    await history.getByTestId('decision-record-decision:8').getByText('View record', { exact: true }).click();
    await expect(history.getByTestId('decision-record-decision:8')).toContainText('Broker order 123');
    await expect(history.getByTestId('decision-record-decision:8')).toContainText('Units reported6');
    await expect(history.getByTestId('decision-record-action:2')).toContainText('Not applicable');
    await expect(history).not.toContainText('No holding remaining');
    assert.equal(f.writes.length, 1);
});

test('failed execution and stale status retain the alert and prevent further writes', { timeout: 90000 }, async t => {
    const f = await setup(t);
    f.fail();
    await f.open();
    const dialog = f.page.getByTestId('alert-action-detail');
    await dialog.getByRole('button', { name: 'Record execution', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Recorded action changed');
    assert.equal(f.action().status, 'OPEN');
    assert.equal(f.writes.length, 1);
    f.failReads();
    await f.page.evaluate(() => window.dispatchEvent(new Event('security-actions:changed')));
    await expect(dialog.getByRole('button', { name: 'Record execution', exact: true })).toBeDisabled();
    await expect(dialog).toContainText('Last loaded values');
    assert.equal(f.writes.length, 1);
});

test('Exit cannot be ignored; explicit retention stays unresolved on mobile', { timeout: 90000 }, async t => {
    const f = await setup(t, { intent: 'EXIT', alert_type: 'SELL', instruction: 'Exit remaining holding' });
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.open();
    const dialog = f.page.getByTestId('alert-action-detail');
    await expect(dialog.getByRole('button', { name: 'Ignore', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Retain with reason' }).click();
    await expect(dialog.getByRole('button', { name: 'Record override', exact: true })).toBeDisabled();
    await dialog.getByLabel('Reason for retaining the position').fill('Review with next statement');
    await dialog.getByRole('button', { name: 'Record override', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(f.action().status, 'OVERRIDDEN');
    await f.page.getByRole('button', { name: 'Expand all asset classes', exact: true }).click();
    await f.page.getByTestId('stack-alert-100').click();
    await expect(dialog).toContainText('Exit retained for review');
    await expect(dialog).toContainText('Review with next statement');
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
    await dialog.screenshot({ path: '/tmp/alert-action-mobile.png' });
    await f.page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
});

test('funding gates and explicit purchase exceptions remain enforced', { timeout: 90000 }, async t => {
    const f = await setup(t, { intent: 'DEPLOY', alert_type: 'ADD', deployment_state: 'Q4_BLOCKED', instruction: 'Q4 purchase pause', can_record_purchase_exception: true });
    await f.open();
    const dialog = f.page.getByTestId('alert-action-detail');
    await expect(dialog).toContainText('Q4 purchase pause');
    await expect(dialog.getByRole('button', { name: 'Record execution', exact: true })).toHaveCount(0);
    assert.equal(f.writes.length, 0);
    await dialog.getByText('Record purchase exception', { exact: true }).click();
    const submit = dialog.getByRole('button', { name: 'Record exception', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Units bought', { exact: true }).fill('10');
    await dialog.getByLabel('AUD spent', { exact: true }).fill('600');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Exception reason', { exact: true }).fill('Order filled before checking Q4');
    await submit.click();
    await expect(dialog).toHaveCount(0);
    assert.equal(f.action().status, 'AWAITING_STATEMENT');
    await expect(f.page.getByTestId('stack-alert-100')).toHaveCount(0);
    assert.deepEqual(f.writes[0].payload, { notes: '', units: 10, cash_value: 600, exception_reason: 'Order filled before checking Q4' });
});

test('ordinary blocked actions cannot execute and external execution stays unverified by IG', { timeout: 90000 }, async t => {
    const f = await setup(t, { status: 'BLOCKED', is_primary: false, blocked_by_instruction: 'Exit remaining holding' });
    await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('alert-action:open', { detail: { id: 1, ticker: 'STOCK' } })));
    const dialog = f.page.getByTestId('alert-action-detail');
    await expect(dialog).toContainText('Waiting for: Exit remaining holding');
    await expect(dialog.getByRole('button', { name: 'Record execution', exact: true })).toHaveCount(0);
    assert.equal(f.writes.length, 0);
    f.setAction({ status: 'OPEN', is_primary: true, is_external: true });
    await f.page.evaluate(() => window.dispatchEvent(new Event('security-actions:changed')));
    await dialog.getByRole('button', { name: 'Record external execution', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await f.page.getByRole('button', { name: 'Decision history', exact: true }).click();
    const record = f.page.getByTestId('decision-record-decision:8');
    await expect(record).toContainText('Recorded externally');
    await record.getByText('View record', { exact: true }).click();
    await expect(record).toContainText('not verified by IG');
});

test('a funded purchase shows its ticket and ignoring it stays explicit', { timeout: 90000 }, async t => {
    const f = await setup(t, { intent: 'DEPLOY', alert_type: 'ADD', instruction: 'Add within current permitted capacity', deployment_state: 'FUNDED', instruction_value: 600 });
    await f.open();
    const dialog = f.page.getByTestId('alert-action-detail');
    await expect(dialog).toContainText('$600 AUD');
    await expect(dialog.getByRole('button', { name: 'Record execution', exact: true })).toBeEnabled();
    await dialog.screenshot({ path: '/tmp/alert-action-funded-dark.png' });
    await f.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'terminal-light-soft'));
    const layout = await dialog.evaluate(element => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { left: box.left, right: box.right, font: parseFloat(style.fontSize), padding: parseFloat(style.paddingTop), background: style.backgroundColor };
    });
    assert.ok(layout.left >= 0 && layout.right <= 1440 && layout.font >= 13 && layout.padding >= 16);
    assert.notEqual(layout.background, 'rgba(0, 0, 0, 0)');
    await dialog.screenshot({ path: '/tmp/alert-action-funded-light.png' });
    await dialog.getByRole('button', { name: 'Ignore', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(f.action().status, 'IGNORED');
    assert.equal(f.writes.length, 1);
    assert.ok(f.writes[0].path.endsWith('/ignore'));
    await expect(f.page.getByTestId('stack-alert-100')).toHaveCount(0);
});

test('class actions remain one shared record, with no aggregate units input', { timeout: 90000 }, async t => {
    const f = await setup(t, { scope: 'ASSET_CLASS', ticker: 'THEME:GOLD_MINERS', asset_class_code: 'GOLD_MINERS', alert_type: 'EQUITY_REGIME_STRONG_TRIM', affected_tickers: ['ASX:STOCK', 'ASX:GOLD'], instruction: 'Reduce producer exposure 20%' });
    await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('alert-action:open', { detail: { id: 1, ticker: 'THEME:GOLD_MINERS' } })));
    const dialog = f.page.getByTestId('alert-action-detail');
    await expect(dialog).toContainText('ASX:STOCK, ASX:GOLD');
    await expect(dialog.getByLabel('Units traded (optional)')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Record execution', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(f.action().status, 'AWAITING_STATEMENT');
    await expect(f.page.getByTestId('stack-alert-100')).toHaveCount(0);
    assert.deepEqual(f.writes[0].payload, { notes: '' });
    assert.equal(f.writes.length, 1);
});

test('a repeated backlog stays in History; one mismatch returns and backend promotion exposes only the next instruction', { timeout: 90000 }, async t => {
    const extra = Array.from({ length: 10 }, (_, i) => ({
        id: i + 10, alert_id: i + 1000, ticker: 'STOCK', alert_type: 'TRIM', scope: 'SECURITY',
        intent: 'REDUCE', instruction: 'Trim using source instruction', strength: 'Weak', source: 'tms',
        status: i < 5 ? 'AWAITING_STATEMENT' : 'BLOCKED', is_primary: false,
        created_at: '2026-09-09T11:00:00Z', blocked_by_instruction: 'Trim using source instruction',
    }));
    const f = await setup(t, { status: 'AWAITING_STATEMENT' }, extra);
    await expect(f.page.getByTitle(/Awaiting statement.*View in Decision History/)).toBeVisible();
    await expect(f.page.locator('[data-testid^="stack-alert-"]')).toHaveCount(0);
    f.setAction({ status: 'VARIANCE' });
    extra[0].status = 'VARIANCE';
    await f.page.evaluate(() => window.dispatchEvent(new Event('security-actions:changed')));
    await expect(f.page.locator('[data-testid^="stack-alert-"]')).toHaveCount(1);
    await expect(f.page.getByTestId('stack-alert-100')).toContainText('Statement mismatch');
    await expect(f.page.getByTestId('stack-alert-100')).not.toContainText('5%');
    await f.open();
    await expect(f.page.getByTestId('alert-action-detail')).toContainText('The later statement did not match');
    await expect(f.page.getByTestId('alert-action-detail').getByRole('button', { name: 'Record execution', exact: true })).toHaveCount(0);
    await f.page.keyboard.press('Escape');
    await f.page.getByRole('button', { name: 'Expand all asset classes', exact: true }).click();
    await f.page.getByTestId('stack-alert-100').screenshot({ path: '/tmp/alert-stack-single-review.png' });
    f.setAction({ status: 'CONFIRMED' });
    for (const row of extra) if (row.status === 'AWAITING_STATEMENT' || row.status === 'VARIANCE') row.status = 'CONFIRMED';
    extra[5].status = 'OPEN';
    extra[5].is_primary = true;
    await f.page.evaluate(() => window.dispatchEvent(new Event('security-actions:changed')));
    await expect(f.page.getByTestId('stack-alert-100')).toHaveCount(0);
    await expect(f.page.locator('[data-testid^="stack-alert-"]')).toHaveCount(1);
    await expect(f.page.getByTestId('stack-alert-1005')).toContainText('5%');
    await f.page.getByRole('button', { name: 'Decision history', exact: true }).click();
    const blocked = f.page.getByTestId('decision-record-action:16');
    await expect(blocked).toContainText('Not recorded');
    await expect(blocked).toContainText('Waiting on earlier action');
    await expect(blocked).not.toContainText('System closure');
    await expect(f.page.locator('[data-testid^="decision-record-"]')).toHaveCount(12);
    assert.equal(f.writes.length, 0, 'filtering never dismisses or executes records');
});
