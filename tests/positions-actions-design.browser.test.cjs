const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, { mode = 'pending', width = 1600, light = false, q3TargetPct = 50 } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ light }) => {
        localStorage.setItem('theme', light ? 'light' : 'dark');
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'snapped', right: 'snapped' } }));
    }, { light });
    const portfolio = mode.startsWith('portfolio');
    const waiting = mode === 'waiting' || mode === 'variance';
    const variance = mode === 'variance';
    const matched = mode === 'portfolio-matched';
    const completed = portfolio && mode !== 'portfolio-pending';
    const gold = { asset_class: 'GOLD_MINERS', display_name: 'Gold Miners', display_order: 0, governed_by_q1: true,
        current_weight_pct: 60, target_weight_pct: 30, delta_weight_pct: -30, recorded_move_value: completed ? 2500 : 0 };
    const cash = { asset_class: 'CASH', display_name: 'Cash / reserve', display_order: 1, governed_by_q1: false,
        current_weight_pct: 40, target_weight_pct: 70, delta_weight_pct: 30, recorded_move_value: 0 };
    const plan = { id: 73, status: completed ? 'COMPLETED' : 'OPEN', title: 'September portfolio target', driver: 'MANUAL', rows: [gold, cash] };
    const check = { key: 'GOLD_MINERS', label: 'Gold Miners', expected_weight_pct: 30, imported_weight_pct: matched ? 30 : 60,
        variance_weight_pct: matched ? 0 : 30, expected_value: 3000, imported_value: matched ? 3000 : 6000,
        variance_value: matched ? 0 : 3000, status: matched ? 'MATCHED' : 'VARIANCE' };
    const adjustment = { id: 'portfolio:73', source_id: 73, source_type: 'PORTFOLIO_TARGET', source_status: plan.status,
        title: plan.title, stage: completed ? 'confirm_statement' : 'action_positions', status: completed ? matched ? 'MATCHED' : 'VARIANCE' : 'PENDING',
        total_value: 10000, required_decrease_value: 3000, recorded_decrease_value: completed ? 2500 : 0,
        remaining_decrease_value: completed ? 500 : 3000, required_increase_value: 3000, tolerance_value: 1000,
        ready_to_confirm: completed, rows: [{ key: 'GOLD_MINERS', label: 'Gold Miners', direction: 'decrease',
            current_weight_pct: 60, target_weight_pct: 30, required_value: 3000, recorded_value: completed ? 2500 : 0,
            remaining_value: completed ? 500 : 3000, current_value: 6000, target_value: 3000, delta_value: -3000 }],
        import_validation: completed ? { passed: matched, checked_rows: 1, variance_rows: matched ? 0 : 1,
            total_abs_variance_value: matched ? 0 : 3000, total_abs_variance_pct: matched ? 0 : 30,
            tolerance_pct: 1, tolerance_value: 100, checks: [check] } : null };
    const q3Reduction = 6000 * (1 - q3TargetPct / 100);
    const overlay = { portfolio_value: 10000, total_portfolio_value: 10000, total_cash: 4000,
        active_event_id: portfolio ? null : 1, active_event_status: waiting ? 'STAGE1_DONE' : 'PENDING',
        active_event_governing_source: 'Q3D', active_event_signal_value: q3TargetPct,
        active_event_from_q1_exposure_pct: 100, active_event_to_q1_exposure_pct: q3TargetPct,
        signal_adjustment_ratio: q3TargetPct / 100, required_de_risk_value: portfolio ? 0 : q3Reduction,
        stage1_recorded_reduction_value: waiting ? 3000 : 0,
        active_event_stage1_applied_at: waiting ? '2026-09-10T10:00:00Z' : null,
        cash_confirmation_status: variance ? 'VARIANCE' : waiting ? 'AWAITING_IMPORT' : 'PENDING',
        portfolio_cash_bucket_value: 4000, q1_target_pct: 30,
        asset_classes: [{ asset_class: 'GOLD_MINERS', display_name: 'Gold Miners', target_weight_pct: 30,
            strategic_weight_pct: 60, actual_invested_value: 6000, allowed_invested_value: portfolio ? 6000 : 6000 - q3Reduction,
            actual_value: 6000, delta_value: portfolio ? 0 : q3Reduction, overlay_eligible: true, q1_category: true }] };
    const reconciliation = { import_received: variance, overall_status: variance ? 'VARIANCE' : 'AWAITING_IMPORT',
        source_status: variance ? 'VARIANCE' : 'AWAITING_IMPORT', asset_class_status: variance ? 'VARIANCE' : 'AWAITING_IMPORT',
        cash: { baseline_reserve_value: 4000, expected_reserve_value: 7000, imported_reserve_value: 4000, reserve_variance: -3000, status: variance ? 'VARIANCE' : 'AWAITING_IMPORT' },
        source_checks: variance ? ['Gold Core ETF', 'Gold Producer'].map(stock_name => ({ stock_name, before_value: 3000, expected_after_value: 1500, imported_value: 3000, variance: 1500, status: 'VARIANCE' })) : [],
        asset_class_checks: variance ? [{ asset_class: 'GOLD_MINERS', before_value: 6000, expected_after_value: 3000, imported_value: 6000, variance: 3000, status: 'VARIANCE' }] : [] };
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api\/trading/, '/api');
        if (path.endsWith('/sync/changes/acknowledge')) return route.fulfill({ json: { status: 'ok' } });
        if (route.request().method() !== 'GET') return route.fallback();
        const data = path.endsWith('/portfolio-overlay-summary') ? overlay
            : path.endsWith('/portfolio-overlay/reconciliation') ? waiting ? reconciliation : {}
            : path.endsWith('/portfolio-rebalances/current/adjustment-plan') ? { plan: portfolio ? adjustment : null }
            : path.endsWith('/portfolio-rebalances/current') ? { plan: portfolio ? plan : null } : undefined;
        if (data === undefined) return route.fallback();
        return route.fulfill({ json: data });
    });
    await page.goto(`${base}/#/positions`);
    await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
    const actions = page.getByTestId('positions-actions-tab');
    await expect(actions).toBeEnabled();
    await actions.click();
    const rail = page.getByTestId('actions-workflow');
    await expect(rail).toBeVisible();
    if (variance) await page.getByRole('button', { name: 'Acknowledge Reserve Import', exact: true }).click();
    if (portfolio) await rail.getByRole('button', { name: /September portfolio target/ }).click();
    const table = page.locator('table.positions-actions-grid');
    return { page, rail, table, errors, fixture };
}

test('adjustment stage has readable core columns, local recording and unchanged confirmation gate', { timeout: 90000 }, async t => {
    const { page, rail, table, errors, fixture } = await setup(t);
    await expect(rail.getByRole('heading', { name: 'Reduce Q1 by 50%' })).toBeVisible();
    await expect(rail).toContainText('Q1 exposure target: 50%.');
    await expect(table.locator('thead')).toContainText('Required / guide');
    await expect(table.locator('th')).toHaveCount(5);
    await table.getByTitle('Choose visible columns', { exact: true }).click();
    await table.getByRole('checkbox', { name: 'Guide / recorded %', exact: true }).check();
    await expect(table.locator('th')).toHaveCount(7);
    await table.getByRole('checkbox', { name: 'Guide / recorded %', exact: true }).uncheck();
    await table.getByTitle('Choose visible columns', { exact: true }).click();
    await expect(table.locator('th')).toHaveCount(5);
    const review = page.getByTestId('risk-review-totals');
    await expect(review).toBeDisabled();
    const inputs = table.locator('[data-position-adjustment-input]');
    await expect(inputs).toHaveCount(2);
    for (const input of await inputs.all()) { await input.focus(); await input.press('Enter'); }
    await expect(page.getByTestId('risk-dock-recorded')).toHaveText('$3,000');
    await expect(page.getByTestId('risk-dock-remaining')).toHaveText('$0');
    await expect(review).toBeEnabled();
    await review.click();
    await expect(rail.getByRole('heading', { name: 'Review recorded reductions' })).toBeVisible();
    await expect(page.getByTestId('risk-confirm-reserve-move')).toBeEnabled();
    await rail.getByRole('button', { name: 'Back to adjustments' }).click();
    await expect(inputs).toHaveCount(2);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('Q3 headline distinguishes the reduction from retained exposure', { timeout: 90000 }, async t => {
    const { rail, fixture, errors } = await setup(t, { q3TargetPct: 49 });
    await expect(rail.getByTestId('actions-current-task')).toHaveText('Reduce Q1 by 51%');
    await expect(rail).toContainText('Q1 exposure target: 49%.');
    await expect(rail.getByLabel('Portfolio reduction totals')).toContainText('$3,060');
    await expect(rail).not.toContainText('Stock amounts are proportional guides; the class requirement remains authoritative.');
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('waiting stage never presents missing stock records as outstanding zero-recorded trades', { timeout: 90000 }, async t => {
    const { page, rail, table, errors, fixture } = await setup(t, { mode: 'waiting', width: 390 });
    await expect(rail.getByRole('heading', { name: 'Waiting for a broker statement' })).toHaveCount(1);
    await expect(table.locator('th')).toHaveCount(2);
    await table.getByTitle('Choose visible columns', { exact: true }).click();
    await expect(table.getByRole('checkbox')).toHaveCount(1);
    await expect(table.getByRole('checkbox', { name: 'Statement value' })).toBeDisabled();
    await table.getByTitle('Choose visible columns', { exact: true }).click();
    await expect(table.locator('[data-position-adjustment-input]')).toHaveCount(0);
    await expect(page.getByTestId('risk-review-totals')).toHaveCount(0);
    assert.ok((await rail.boundingBox()).y < (await table.boundingBox()).y);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: 'test-results/actions-waiting-mobile.png' });
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('statement mismatch shows evidence columns and guarded reopening', { timeout: 90000 }, async t => {
    const { page, rail, table, fixture, errors } = await setup(t, { mode: 'variance' });
    await expect(rail.getByTestId('actions-current-task')).toHaveText('Review statement differences');
    await expect(table.locator('thead')).toContainText('Expected');
    await expect(table.locator('thead')).toContainText('Statement');
    await expect(table.locator('thead')).toContainText('Difference');
    await expect(table.locator('th')).toHaveCount(4);
    await expect(table.locator('[data-position-adjustment-input]')).toHaveCount(0);
    await rail.getByRole('button', { name: 'Review and reopen' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Reopen Actions?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('recorded rebalance prioritises statement review and keeps baseline approval locked', { timeout: 90000 }, async t => {
    const { page, rail, table, fixture, errors } = await setup(t, { mode: 'portfolio-variance', width: 1000 });
    await expect(rail.getByTestId('actions-current-task')).toHaveText('Review statement differences');
    await expect(rail.getByLabel('Portfolio reduction totals')).toContainText('$3,000');
    await expect(rail.getByLabel('Portfolio reduction totals')).toContainText('$2,500');
    await expect(rail.getByLabel('Portfolio reduction totals')).toContainText('$500');
    await expect(rail).toContainText('within the $1,000 tolerance');
    await expect(rail).not.toContainText('Reduce by $3,000');
    await expect(page.getByTestId('portfolio-approve-baseline')).toBeDisabled();
    await expect(page.getByTestId('portfolio-clear-draft')).toHaveCount(0);
    const approval = await page.getByTestId('portfolio-approve-baseline').boundingBox();
    assert.ok(approval.y < (await table.boundingBox()).y, 'next action comes before holdings on compact workspaces');
    await rail.getByText('Review class differences (1)', { exact: true }).click();
    await expect(rail.getByRole('table')).toContainText('Gold Miners');
    await expect(table.locator('[data-position-adjustment-input]')).toHaveCount(0);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('matched statement enables only the existing explicit approval action', { timeout: 90000 }, async t => {
    const { page, rail, fixture, errors } = await setup(t, { mode: 'portfolio-matched' });
    await expect(rail.getByTestId('actions-current-task')).toHaveText('Ready to approve baseline');
    await expect(page.getByTestId('portfolio-approve-baseline')).toBeEnabled();
    await expect(page.getByTestId('portfolio-confirm-position-actions')).toHaveCount(0);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('desktop and compact layouts preserve legibility, theme contrast and independent Normal columns', { timeout: 90000 }, async t => {
    mkdirSync('test-results', { recursive: true });
    const { page, rail, table, fixture, errors } = await setup(t, { mode: 'portfolio-pending', width: 1800 });
    const fonts = await rail.evaluate(el => [...el.querySelectorAll('h2,h3,p,small,dt,dd,button')].map(node => parseFloat(getComputedStyle(node).fontSize)));
    assert.ok(fonts.every(size => size >= 11));
    assert.ok((await rail.boundingBox()).x > (await table.boundingBox()).x);
    const widths = await table.evaluate(el => ({ width: el.getBoundingClientRect().width, parent: el.parentElement.clientWidth }));
    assert.ok(widths.width <= widths.parent + 4, `default action columns fit desktop table: ${JSON.stringify(widths)}`);
    await page.screenshot({ path: 'test-results/actions-pending-desktop.png' });
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    const contrast = await rail.evaluate(el => {
        const rgb = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = colour => rgb(colour).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((s, c, i) => s + c * [.2126,.7152,.0722][i], 0);
        const a = luminance(getComputedStyle(el).backgroundColor);
        const b = luminance(getComputedStyle(el.querySelector('p')).color);
        return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
    });
    assert.ok(contrast >= 4.5, `light-mode explanation contrast: ${contrast}`);
    await page.setViewportSize({ width: 700, height: 1000 });
    assert.ok((await rail.boundingBox()).y < (await table.boundingBox()).y);
    await page.screenshot({ path: 'test-results/actions-pending-light-compact.png' });
    await page.getByRole('button', { name: 'NORMAL', exact: true }).click();
    await expect(rail).toHaveCount(0);
    await expect(page.locator('table.positions-grid thead')).toContainText('P/L%');
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});
