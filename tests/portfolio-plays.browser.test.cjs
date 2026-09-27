const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

async function setup(t, { reject = false, settings = {}, failStorage = false, failRead = false, saveDelay = 0 } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const starts = [], errors = [];
    const storage = { settings: { ...settings }, failStorage, failRead, writes: [] };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/settings', async route => {
        if (route.request().method() === 'GET') return storage.failRead
            ? route.fulfill({ status: 503, json: { error: 'Storage unavailable' } })
            : route.fulfill({ json: storage.settings });
        const updates = route.request().postDataJSON();
        storage.writes.push(updates);
        if (saveDelay) await new Promise(resolve => setTimeout(resolve, saveDelay));
        if (storage.failStorage) return route.fulfill({ status: 503, json: { error: 'Storage unavailable' } });
        Object.assign(storage.settings, updates);
        return route.fulfill({ json: { status: 'success', updated: updates } });
    });
    await page.route('**/api/council/jobs**', async route => {
        if (route.request().method() === 'POST') {
            starts.push(route.request().postDataJSON());
            await new Promise(resolve => setTimeout(resolve, 300));
            return reject
                ? route.fulfill({ status: 402, json: { detail: 'Insufficient analysis credit', submission_status: 'not_submitted' } })
                : route.fulfill({ status: 202, json: { job_id: 'offline-plays-job', status: 'queued' } });
        }
        return route.fulfill({ json: { job_id: 'offline-plays-job', status: 'running', stage: 'research' } });
    });
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    await page.goto(`${base}/#/portfolio`);
    const launch = page.getByRole('button', { name: 'Run portfolio analysis', exact: true });
    await expect(launch).toBeEnabled();
    await launch.click();
    const dialog = page.getByRole('dialog', { name: 'Portfolio analysis', exact: true });
    await expect(dialog).toBeVisible();
    return { page, starts, dialog, launch, storage };
}

test('plays are collected before the original job, with no submission on open or cancel', { timeout: 120000 }, async t => {
    const { page, starts, dialog, launch } = await setup(t);
    assert.equal(starts.length, 0);
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Play 1 title', exact: true }).fill(' Fertiliser supply ');
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Complete the title and thesis');
    assert.equal(starts.length, 0);
    await dialog.getByRole('textbox', { name: 'Play 1 thesis', exact: true }).fill(' Test supply constraints against producers\' own input costs. ');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(starts.length, 0);
    await launch.click();
    await expect(dialog.getByRole('textbox', { name: 'Play 1 title', exact: true })).toHaveValue(' Fertiliser supply ');
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete saved play 2', exact: true }).click();
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            const bounds = await dialog.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
            assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 800);
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            await page.screenshot({ path: `/tmp/portfolio-plays-${width}-${theme}.png` });
        }
    }
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Starting analysis...', exact: true })).toBeDisabled();
    await expect(dialog).toHaveCount(0);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].job_type, 'portfolio_positioning');
    assert.equal(starts[0].reassess_portfolio_run_id, undefined);
    assert.deepEqual(starts[0].portfolio_context.investment_plays, [{
        title: 'Fertiliser supply', thesis: 'Test supply constraints against producers\' own input costs.',
    }]);
    assert.ok(starts[0].portfolio_context.asset_classes.length > 0);
    assert.ok(!starts[0].query.includes('Fertiliser'));
});

test('analysis can start without plays', { timeout: 90000 }, async t => {
    const { dialog, starts } = await setup(t);
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].portfolio_context.investment_plays, []);
});

test('reload recovers a pending submission ahead of an older saved result without another POST', { timeout: 60000 }, async t => {
    const { page, dialog, starts } = await setup(t);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => {
        localStorage.setItem('alpha-edge-portfolio-memo', JSON.stringify({
            jobId: 'old-completed-job', mode: 'DEEP', status: 'succeeded',
            summary: { assetClassTargets: [{ asset_class: 'GOLD_MINERS', target_pct: 100 }] },
        }));
        localStorage.setItem('alpha-edge-council-submission:portfolio_positioning:portfolio', '5329b13a-1198-4c38-86b7-ea9da3f26d23');
    });
    const reads = [];
    page.on('request', request => { if (request.url().includes('/api/council/jobs') && request.method() === 'GET') reads.push(request.url()); });
    await page.reload();
    await expect(page.getByTestId('portfolio-memo-status')).toContainText('Portfolio analysis running');
    assert.ok(reads.some(url => url.includes('submission_id=5329b13a-1198-4c38-86b7-ea9da3f26d23')));
    assert.equal(starts.length, 0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('alpha-edge-council-submission:portfolio_positioning:portfolio'))).toBe(null);
});

test('a rejected submission preserves all entered ideas and does not retry', { timeout: 90000 }, async t => {
    const { page, dialog, starts } = await setup(t, { reject: true });
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Play 1 title', exact: true }).fill('Gold margins');
    await dialog.getByRole('textbox', { name: 'Play 1 thesis', exact: true }).fill('Compare miners with bullion.');
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Insufficient analysis credit');
    await expect(dialog.getByRole('textbox', { name: 'Play 1 thesis', exact: true })).toHaveValue('Compare miners with bullion.');
    await page.waitForTimeout(500);
    assert.equal(starts.length, 1);
});

test('plays survive reload, selection is separate, and deletion persists', { timeout: 90000 }, async t => {
    const { page, dialog, storage, starts } = await setup(t);
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Play 1 title', exact: true }).fill('Agriculture');
    await dialog.getByRole('textbox', { name: 'Play 1 thesis', exact: true }).fill('Test margins against fertiliser costs.');
    await expect(dialog.getByRole('status', { name: 'Investment plays storage' })).toHaveText('Saved');
    assert.ok(Object.values(storage.settings).some(value => value.includes('Agriculture')));
    await page.reload();
    await page.getByRole('button', { name: 'Run portfolio analysis', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Play 1 title', exact: true })).toHaveValue('Agriculture');
    await expect(dialog.getByRole('checkbox', { name: 'Include play 1' })).not.toBeChecked();
    assert.equal(starts.length, 0);
    await dialog.getByRole('button', { name: 'Delete saved play 1' }).click();
    await expect(dialog.getByRole('status', { name: 'Investment plays storage' })).toHaveText('Saved');
    await page.reload();
    await page.getByRole('button', { name: 'Run portfolio analysis', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Add play', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
});

test('unselected plays remain saved but are not submitted', { timeout: 90000 }, async t => {
    const row = { version: 1, id: 'existing', title: 'Existing idea', thesis: 'Do not include automatically.', created_at: '2026-09-18', updated_at: '2026-09-18' };
    const { dialog, starts, storage } = await setup(t, { settings: { 'portfolio_investment_play:existing': JSON.stringify(row) } });
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Play 2 title', exact: true }).fill('New idea');
    await dialog.getByRole('textbox', { name: 'Play 2 thesis', exact: true }).fill('Include this one.');
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(starts[0].portfolio_context.investment_plays, [{ title: 'New idea', thesis: 'Include this one.' }]);
    assert.equal(JSON.parse(storage.settings['portfolio_investment_play:existing']).title, 'Existing idea');
    assert.ok(storage.writes.every(update => !('portfolio_investment_play:existing' in update)));
});

test('failed saves retain drafts, report the failure, and can be retried without a paid run', { timeout: 90000 }, async t => {
    const { dialog, storage, starts } = await setup(t, { failStorage: true });
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Play 1 title', exact: true }).fill('Keep this draft');
    await expect(dialog.getByRole('alert')).toContainText('not been saved');
    await expect(dialog.getByRole('textbox', { name: 'Play 1 title', exact: true })).toHaveValue('Keep this draft');
    storage.failStorage = false;
    await dialog.getByRole('button', { name: 'Retry plays storage' }).click();
    await expect(dialog.getByRole('status', { name: 'Investment plays storage' })).toHaveText('Saved');
    assert.equal(starts.length, 0);
});

test('failed library reads cannot overwrite existing plays and can be retried', { timeout: 90000 }, async t => {
    const { dialog, storage, starts } = await setup(t, { failRead: true });
    await expect(dialog.getByRole('alert').filter({ hasText: 'Saved investment plays could not be loaded' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add play', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Start analysis', exact: true })).toBeDisabled();
    assert.deepEqual(storage.writes, []);
    storage.failRead = false;
    await dialog.getByRole('button', { name: 'Retry plays storage' }).click();
    await expect(dialog.getByRole('button', { name: 'Add play', exact: true })).toBeEnabled();
    assert.equal(starts.length, 0);
});

test('investment brief persists and reaches the original job without any automatic play selection', { timeout: 120000 }, async t => {
    const { page, dialog, storage, starts } = await setup(t);
    await dialog.locator('summary').filter({ hasText: 'Investment brief' }).click();
    await dialog.getByLabel('Portfolio scope', { exact: true }).selectOption('thematic_sleeve');
    await dialog.getByLabel('Investment objective', { exact: true }).fill('Resource scarcity, not a whole-wealth allocation.');
    await dialog.getByLabel('Base currency', { exact: true }).fill('AUD');
    await dialog.getByLabel('Time horizon', { exact: true }).selectOption('1-2 years');
    await dialog.getByLabel('Risk tolerance', { exact: true }).selectOption('high');
    await dialog.locator('summary').filter({ hasText: 'Risk and implementation' }).click();
    await dialog.getByLabel('Tax and trading-cost policy', { exact: true }).fill('Consider realised gains before replacing holdings.');
    await expect.poll(() => JSON.parse(storage.settings.portfolio_investment_brief || '{}').tax_cost_policy).toContain('realised gains');
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            await page.screenshot({ path: `/tmp/portfolio-brief-${width}-${theme}.png` });
        }
    }
    await page.reload();
    await page.getByRole('button', { name: 'Run portfolio analysis', exact: true }).click();
    await dialog.locator('summary').filter({ hasText: 'Investment brief' }).click();
    await expect(dialog.getByLabel('Portfolio scope', { exact: true })).toHaveValue('thematic_sleeve');
    await expect(dialog.getByLabel('Investment objective', { exact: true })).toHaveValue('Resource scarcity, not a whole-wealth allocation.');
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].portfolio_context.mandate.portfolio_scope, 'thematic_sleeve');
    assert.equal(starts[0].portfolio_context.mandate.time_horizon, '1-2 years');
    assert.equal(starts[0].portfolio_context.mandate.risk_tolerance, 'high');
    assert.equal(starts[0].portfolio_context.mandate.horizon_months, undefined);
    assert.deepEqual(starts[0].portfolio_context.investment_plays, []);
});

test('edits and deletion during an in-flight save do not resurrect a deleted play', { timeout: 90000 }, async t => {
    const { dialog, storage, starts } = await setup(t, { saveDelay: 1000 });
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Play 1 title', exact: true }).fill('First draft');
    await expect.poll(() => storage.writes.length).toBe(1);
    await dialog.getByRole('textbox', { name: 'Play 1 title', exact: true }).fill('Revised draft');
    await dialog.getByRole('button', { name: 'Delete saved play 1' }).click();
    await expect(dialog.getByRole('status', { name: 'Investment plays storage' })).toHaveText('Saved');
    assert.ok(Object.values(storage.settings).every(value => value === ''));
    assert.equal(starts.length, 0);
});

test('risk and horizon are visible, optional, saved and sent with the selected plays', { timeout: 120000 }, async t => {
    const { page, dialog, storage, starts, launch } = await setup(t);
    const risk = dialog.getByRole('combobox', { name: 'Risk tolerance', exact: true });
    const horizon = dialog.getByRole('combobox', { name: 'Time horizon', exact: true });
    await expect(risk).toBeVisible();
    await expect(horizon).toBeVisible();
    await expect(risk).toHaveValue('');
    await expect(horizon).toHaveValue('');
    assert.deepEqual(await risk.locator('option').allTextContents(), ['Not specified', 'Low', 'Medium', 'High']);
    assert.deepEqual(await horizon.locator('option').allTextContents(), ['Not specified', '1-2 years', '3-5 years', '5+ years']);
    await risk.selectOption('medium');
    await horizon.selectOption('3-5 years');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => JSON.parse(storage.settings.portfolio_investment_brief || '{}')).toEqual({ risk_tolerance: 'medium', time_horizon: '3-5 years' });
    await page.reload();
    await launch.click();
    await expect(risk).toHaveValue('medium');
    await expect(horizon).toHaveValue('3-5 years');
    await dialog.getByRole('button', { name: 'Add play', exact: true }).click();
    await dialog.getByLabel('Play 1 title', { exact: true }).fill('Scarcity trade');
    await dialog.getByLabel('Play 1 thesis', { exact: true }).fill('Assess producer margins and valuations.');
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            const a = await risk.boundingBox(), b = await horizon.boundingBox();
            assert.ok(a.x + a.width <= b.x && a.y === b.y);
            await page.screenshot({ path: `/tmp/portfolio-profile-${width}-${theme}.png` });
        }
    }
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].portfolio_context.mandate, { risk_tolerance: 'medium', time_horizon: '3-5 years' });
    assert.equal(starts[0].portfolio_context.investment_plays[0].title, 'Scarcity trade');
});

test('previous exact horizon survives until replaced and both preferences can be cleared', { timeout: 90000 }, async t => {
    const { dialog, storage, starts } = await setup(t, { settings: {
        portfolio_investment_brief: JSON.stringify({ horizon_months: 18, base_currency: 'AUD' }),
    } });
    const risk = dialog.getByLabel('Risk tolerance', { exact: true });
    const horizon = dialog.getByLabel('Time horizon', { exact: true });
    await expect(horizon).toHaveValue('saved_months');
    await expect(horizon.locator('option:checked')).toHaveText('18 months (saved)');
    await risk.selectOption('low');
    await expect.poll(() => JSON.parse(storage.settings.portfolio_investment_brief || '{}')).toEqual({ risk_tolerance: 'low', horizon_months: 18, base_currency: 'AUD' });
    await horizon.selectOption('5+ years');
    await expect.poll(() => JSON.parse(storage.settings.portfolio_investment_brief || '{}')).toEqual({ risk_tolerance: 'low', time_horizon: '5+ years', base_currency: 'AUD' });
    await risk.selectOption('');
    await horizon.selectOption('');
    await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(starts[0].portfolio_context.mandate, { base_currency: 'AUD' });
});
