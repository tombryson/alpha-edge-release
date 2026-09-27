const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const base = process.env.MODEL_WEIGHT_BASE_URL || 'http://127.0.0.1:3312';

const action = overrides => ({ id: 9001, alert_id: 9001, ticker: 'CBA', alert_type: 'ADD',
    source: 'tms', scope: 'SECURITY', asset_class_code: 'BANKS', intent: 'DEPLOY',
    instruction_basis: 'NONE', instruction: 'Add paused: at ideal weight, including pending purchases',
    priority: 2, status: 'OPEN', deployment_state: 'WEIGHT_LIMIT', is_primary: true,
    queue_count: 1, is_external: false, can_record_purchase_exception: true,
    created_at: '2026-09-18T02:00:00Z', updated_at: '2026-09-18T02:00:00Z', ...overrides });

async function setup(t, rows = []) {
    assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
    const browser = await chromium.launch(); t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await require('./fixtures/browser-access.cjs').mockBrowserAccess(page);
    const errors = [], writes = [];
    await page.addInitScript(() => localStorage.setItem('alpha-edge-alert-stack-ui', JSON.stringify({ allAssetClassesExpanded: true })));
    const state = { enabled: false, epoch: 0, rows };
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/terminal/weight-policy', async route => {
        const request = route.request();
        if (request.method() === 'PATCH') {
            const body = request.postDataJSON(); writes.push(body);
            assert.equal(body.epoch, state.epoch);
            state.enabled = body.enabled; state.epoch++;
            return route.fulfill({ json: { enabled: state.enabled, epoch: state.epoch, version: 'ideal-weight-v1', targets: [] } });
        }
        const response = await route.fetch(); const policy = await response.json();
        await route.fulfill({ response, json: { ...policy, enabled: state.enabled, epoch: state.epoch, read_only: false } });
    });
    await page.route('**/api/terminal/security-actions**', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (request.method() === 'POST') {
            assert.ok(url.pathname.endsWith('/record-execution'));
            writes.push(request.postDataJSON());
            state.rows = state.rows.map(row => ({ ...row, status: 'AWAITING_STATEMENT', execution_reported_at: '2026-09-18T03:00:00Z' }));
            return route.fulfill({ json: { status: 'AWAITING_STATEMENT', id: 901, message: 'Decision recorded' } });
        }
        const ticker = url.searchParams.get('ticker');
        await route.fulfill({ json: state.rows.filter(row => !ticker || row.ticker === ticker) });
    });
    await page.goto(`${base}/#/positions`);
    await expect(page.locator('.positions-grid')).toBeVisible({ timeout: 30000 });
    t.after(() => assert.deepEqual(errors, []));
    return { page, writes, state };
}

test('weight control is opt-in, keyboard accessible, does not sort or resize the column', { timeout: 60000 }, async t => {
    const { page, writes } = await setup(t);
    const header = page.locator('th[data-column-key="modelWeight"]');
    const before = await header.boundingBox();
    await page.getByRole('button', { name: 'Weight management', exact: true }).focus();
    await page.keyboard.press('Enter');
    const toggle = page.getByRole('switch', { name: 'Weight management enabled' });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    const popover = page.locator('[data-radix-popper-content-wrapper]');
    assert.ok((await popover.boundingBox()).width >= 250);
    assert.deepEqual(writes, [{ enabled: true, epoch: 0 }]);
    assert.ok(Math.abs((await header.boundingBox()).width-before.width)<1);
    await expect(header).not.toContainText('↓');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Weight management', exact: true }).click();
    await expect(toggle).toBeChecked();
    mkdirSync('/tmp/alpha-edge-weight-policy', { recursive: true });
    await page.screenshot({ path: '/tmp/alpha-edge-weight-policy/control.png' });
});

test('paused Add remains visible, explains the reason and retains the exception path', { timeout: 60000 }, async t => {
    const { page, writes } = await setup(t, [action({})]);
    const label = page.getByText('Add paused · At ideal', { exact: true });
    await expect(label).toBeVisible();
    await label.click();
    const detail = page.getByTestId('alert-action-detail');
    await expect(detail).toContainText('at ideal weight');
    await expect(detail.getByRole('button', { name: 'Record execution', exact: true })).toHaveCount(0);
    await expect(detail).toContainText('Record purchase exception');
    assert.deepEqual(writes, []);
});

test('class review reuses Portfolio and never becomes a stock trade card', { timeout: 60000 }, async t => {
    const { page, writes } = await setup(t, [action({ ticker: 'BANKS', scope: 'ASSET_CLASS', intent: 'REVIEW',
        alert_type: 'WEIGHT_CLASS_REVIEW', source: 'weight_policy', instruction: 'Review class allocation',
        deployment_state: '', weight_evidence: { role:'CLASS',held:40000,ideal:26000,observed_date:'2026-09-18' },
    })]);
    await expect(page.getByText('Review class allocation', { exact: true })).toHaveCount(0);
    await page.goto(`${base}/#/portfolio`);
    await page.getByRole('button', { name: 'Review Banks allocation', exact:true }).click();
    const detail=page.getByTestId('alert-action-detail');
    await expect(detail.getByRole('button', { name: 'Dismiss review', exact:true })).toBeVisible();
    await expect(detail.getByRole('button', { name:/Record/ })).toHaveCount(0);
    assert.deepEqual(writes,[]);
});

test('one reduction uses existing compact chip and detail, including on mobile', { timeout: 60000 }, async t => {
    const { page, writes } = await setup(t, [action({ alert_type: 'WEIGHT_REDUCE', intent: 'REDUCE',
        deployment_state: '', source: 'weight_policy', priority: 1, instruction_basis: 'DOLLAR_VALUE', instruction_value: 250,
        instruction: 'Reduce exposure by $250', can_record_purchase_exception: false,
        weight_evidence: { role: 'STOCK', held: 1500, ideal: 1000, reduction: 250, remaining: 1250, observed_date: '2026-09-18' },
    })]);
    await page.getByText('Reduce $250', { exact: true }).first().click();
    const detail = page.getByTestId('alert-action-detail');
    await expect(detail).toContainText('150% trigger; reduce to 125% of ideal');
    await expect(detail).toContainText('$1,250');
    await page.screenshot({ path: '/tmp/alpha-edge-weight-policy/reduction.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/alpha-edge-weight-policy/reduction-mobile.png' });
    const box = await detail.boundingBox(); assert.ok(box.x >= 0 && box.x+box.width<=391);
    await detail.getByRole('button', { name: 'Record reduction', exact: true }).click();
    await expect(detail).toHaveCount(0);
    assert.equal(writes.length, 1); assert.equal(writes[0].expected_instruction_value, 250);
    await expect(page.getByText('Reduce $250', { exact: true })).toHaveCount(0);
});
