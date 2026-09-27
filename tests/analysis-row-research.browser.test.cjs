const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, { width = 1366, theme = 'dark', overrides = {} } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const fixture = await mockContextPanel(page);
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.route(/\/api\/(?:trading\/)?analysis(?:\?|$)/, route => route.fulfill({ json: [{
        id: 2, ticker: 'ASX:STOCK', name: 'Gold Producer', security_type: 'STOCK', primary_asset_class: 'GOLD_MINERS',
        current_price: 30, gemini_quality: 70, gemini_value: 80, gemini_pt: 60, gemini_webui_input_at: '2026-09-16',
        gpt_quality: 60, gpt_value: 90, gpt_pt: 80, gpt_webui_input_at: '2025-01-01',
        perplexity_quality: 55, perplexity_value: 0, perplexity_pt: 0,
        council_quality: 88, council_value: 92, council_pt: 75, council_source_input_at: '2026-09-16',
        council_run_id: 'fixture-run', include_in_sizing: true,
        deer_flow_pt: 70, tipranks_pt: 90, analyst_pt: 100,
        ...overrides,
    }] }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/analysis`);
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    const trigger = page.getByRole('button', { name: 'Expand research for Gold Producer from Quality', exact: true });
    await trigger.click();
    return { page, panel: page.getByRole('region', { name: 'Gold Producer', exact: true }), fixture };
}

test('row research shows distinct sources, partial evidence and the unchanged price-target average', { timeout: 60000 }, async t => {
    const { panel } = await setup(t);
    const table = panel.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(9);
    await expect(panel).toContainText('2/4 models');
    await expect(panel).not.toContainText('Council mean');
    await expect(panel.locator('.analysis-target-strip, .analysis-model-card')).toHaveCount(0);
    await expect(table.getByRole('row').filter({ hasText: 'Perplexity' })).toContainText('Partial');
    await expect(table.getByRole('row').filter({ hasText: 'Perplexity' })).toContainText('55.0');
    await expect(table.getByRole('row').filter({ hasText: 'Council' })).toContainText('88.0');
    await expect(table.getByRole('row').filter({ hasText: 'Council' })).toContainText('$75.00');
    await expect(table.getByRole('row').filter({ hasText: 'Council' })).not.toContainText('2/4');
    const average = panel.locator('[title^="Equal average"]');
    await expect(average).toContainText('$79.167');
    await expect(average).toHaveAttribute('title', /6 available price targets/);
    for (const source of ['Gemini', 'GPT', 'Council', 'DeerFlow', 'TipRanks', 'TradingView']) {
        await expect(average).toHaveAttribute('title', new RegExp(source));
    }
    await expect(panel).toContainText('+163.9%');
    await expect(table.getByRole('row').filter({ hasText: /^Gemini/ }).locator('time').last()).toHaveAttribute('datetime', '2026-09-16');
    await expect(table.getByRole('row').filter({ hasText: /^GPT/ }).locator('time').last()).toHaveAttribute('title', /More than 90 days old/);
    await expect(panel.getByRole('link', { name: 'Open Council run in Intelligence' })).toHaveAttribute('href', /run_id=fixture-run/);
});

test('saving model output uses the existing persistence workflow', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t);
    const saved = [];
    await page.route(/\/api\/(?:trading\/)?analysis\/2$/, route => {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { id: 2, ...saved.at(-1) } });
    });
    await panel.getByRole('button', { name: 'Add Claude output for Gold Producer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Claude run' });
    await dialog.getByRole('spinbutton', { name: 'Quality', exact: true }).fill('85');
    await dialog.getByRole('spinbutton', { name: 'Value', exact: true }).fill('90');
    await dialog.getByRole('spinbutton', { name: 'Price target', exact: true }).fill('65');
    await dialog.getByLabel('Source text', { exact: true }).fill('Isolated test output');
    await dialog.getByRole('button', { name: 'Save run', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel).toContainText('3/4 models');
    await expect(panel.getByRole('row').filter({ hasText: 'Claude' })).toContainText('$65.00');
    await expect.poll(() => saved.length).toBe(1);
    assert.equal(saved[0].claude_quality, 85);
    assert.equal(saved[0].claude_value, 90);
    assert.equal(saved[0].claude_pt, 65);
    assert.equal(saved[0].claude_webui_output, 'Isolated test output');
    assert.equal(saved[0].gemini_quality, 70);
    assert.equal(saved[0].council_pt, 75);
});

test('missing research is not shown as zero, and rows remain keyboard accessible with score columns hidden', { timeout: 60000 }, async t => {
    const { page } = await setup(t, { overrides: {
        gemini_quality: 0, gemini_value: 0, gemini_pt: 0, gpt_quality: 0, gpt_value: 0, gpt_pt: 0,
        perplexity_quality: 0, council_quality: 0, council_value: 0, council_pt: 0,
        deer_flow_pt: 0, tipranks_pt: 0, analyst_pt: 0,
    } });
    const average = page.locator('.analysis-expanded-panel [title="No price targets available"]');
    await expect(average).toContainText('\u2014');
    await expect(page.locator('.analysis-expanded-panel')).not.toContainText('+0.0%');
    await page.evaluate(() => localStorage.setItem('terminal-analysis-visible-columns-v2', JSON.stringify({ quality: false, value: false })));
    await page.reload();
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    const row = page.locator('tr.analysis-stock-row').filter({ hasText: 'Gold Producer' });
    await expect(row).toHaveAttribute('tabindex', '0');
    await row.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Gold Producer', exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Collapse research for Gold Producer', exact: true }).click();
    await expect(row).toBeFocused();
});

test('model edit and empty add use a bounded dialog, cancel preserves data and returns focus', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t, { width: 390 });
    const edit = panel.getByRole('button', { name: 'Edit Gemini output for Gold Producer' });
    await edit.click();
    const dialog = page.getByRole('dialog', { name: 'Gemini run' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('spinbutton', { name: 'Quality', exact: true })).toHaveValue('70');
    await expect(dialog.getByRole('spinbutton', { name: 'Quality', exact: true })).toBeFocused();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 10 && bounds.x + bounds.width <= 380);
    assert.ok(bounds.y >= 10 && bounds.y + bounds.height <= 890);
    await dialog.getByRole('spinbutton', { name: 'Quality', exact: true }).fill('99');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(panel.getByRole('row').filter({ hasText: 'Gemini' })).toContainText('70.0');
    await panel.getByRole('button', { name: 'Add Claude output for Gold Producer' }).click();
    const empty = page.getByRole('dialog', { name: 'Claude run' });
    await expect(empty.getByRole('spinbutton', { name: 'Quality', exact: true })).toHaveValue('');
    await empty.getByRole('button', { name: 'Save run', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.ok(await empty.evaluate(el => el.contains(document.activeElement)), 'focus stays in the editor');
    await empty.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('the whole model row opens its run and editable source text, not just the action icon', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t, { overrides: { gemini_webui_output: 'Saved Gemini source text' } });
    const row = panel.getByRole('row').filter({ hasText: /^Gemini/ });
    await expect(row).toHaveCSS('cursor', 'pointer');
    for (const target of [row.getByText('Gemini', { exact: true }), row.getByRole('cell').nth(1), row.getByRole('cell').first()]) {
        await target.click();
        const dialog = page.getByRole('dialog', { name: 'Gemini run', exact: true });
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(dialog.getByRole('spinbutton', { name: 'Quality', exact: true })).toHaveValue('70');
        const source = dialog.getByRole('textbox', { name: 'Source text', exact: true });
        await expect(source).toHaveValue('Saved Gemini source text');
        await source.fill('Changed draft');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(row.getByRole('button')).toBeFocused();
    }
    const empty = panel.getByRole('row').filter({ hasText: /^Claude/ });
    await expect(empty).toHaveCSS('cursor', 'pointer');
    await empty.getByRole('cell').first().click();
    const dialog = page.getByRole('dialog', { name: 'Claude run', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue('');
    await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill('New source text');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await empty.getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(dialog).toBeVisible();
});

test('collapse and reopen support keyboard, with no action caused by expansion', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t);
    const toggle = page.getByRole('button', { name: 'Collapse research for Gold Producer from Quality', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await panel.getByRole('button', { name: 'Collapse research for Gold Producer', exact: true }).click();
    await expect(panel).toHaveCount(0);
    const expand = page.getByRole('button', { name: 'Expand research for Gold Producer from Quality', exact: true });
    await expect(expand).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Add Claude output for Gold Producer' }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(expand).toBeFocused();
});

for (const theme of ['dark', 'light']) {
    test(`model actions use primary colour and dotted hover/focus without shifting rows in ${theme}`, { timeout: 60000 }, async t => {
        const { page, panel } = await setup(t, { theme });
        const add = panel.getByRole('button', { name: 'Add Claude output for Gold Producer' });
        const row = panel.getByRole('row').filter({ hasText: /^Claude/ });
        const primary = await add.evaluate(el => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--primary)';
            el.appendChild(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        });
        await expect(add).toHaveCSS('color', primary);
        await expect(add.locator('svg')).toHaveAttribute('stroke-width', '2.75');
        const council = panel.locator('.analysis-council-expanded-trigger');
        await expect(council).toHaveCSS('color', primary);
        await council.hover();
        await expect(council).toHaveCSS('color', primary);
        await expect(council).toHaveCSS('border-top-color', primary);
        const before = await row.boundingBox();
        await row.hover();
        await expect(row).toHaveCSS('outline-style', 'dotted');
        await expect(row).toHaveCSS('outline-color', primary);
        assert.deepEqual(await row.boundingBox(), before, 'hover does not move or resize the row');
        await page.mouse.move(0, 0);
        await add.focus();
        await expect(row).toHaveCSS('outline-style', 'dotted');
        await expect(add).toHaveCSS('color', primary);
        const filled = panel.getByRole('row').filter({ hasText: /^Gemini/ });
        await filled.hover();
        await expect(filled).toHaveCSS('outline-style', 'dotted');
        await expect(filled.getByRole('button')).toHaveCSS('color', primary);
        const readOnly = panel.getByRole('row').filter({ hasText: /^TradingView/ });
        await readOnly.hover();
        await expect(readOnly).toHaveCSS('outline-style', 'none');
        await add.click();
        await expect(page.getByRole('dialog', { name: 'Claude run', exact: true })).toBeVisible();
    });
}

for (const [width, theme] of [[1366, 'dark'], [1366, 'light'], [768, 'dark'], [390, 'dark'], [390, 'light'], [320, 'dark']]) {
    test(`research fits the visible table at ${width}px ${theme}, including after horizontal scroll`, { timeout: 60000 }, async t => {
        const { page, panel } = await setup(t, { width, theme });
        await expect(panel).toBeVisible();
        const viewport = page.locator('.analysis-grid-scroll');
        const check = async () => {
            const bounds = await panel.boundingBox();
            const view = await viewport.boundingBox();
            assert.ok(bounds.x >= view.x - 1 && bounds.x + bounds.width <= view.x + view.width + 1, JSON.stringify({ bounds, view }));
            assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), 'no panel overflow');
            const rows = panel.getByRole('table').getByRole('row');
            for (const row of await rows.all()) {
                assert.ok(await row.evaluate(el => [...el.children].every(cell => cell.scrollWidth <= cell.clientWidth + 1)), 'cells do not overlap');
            }
            await expect(panel.locator('.analysis-council-expanded-trigger')).toBeVisible();
        };
        await check();
        await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await expect.poll(() => panel.evaluate(el => Math.round(el.getBoundingClientRect().x))).toBeGreaterThanOrEqual(0);
        await check();
        await viewport.evaluate(el => { el.scrollLeft = 0; });
        mkdirSync('/tmp/alpha-edge-row-research', { recursive: true });
        await panel.screenshot({ path: `/tmp/alpha-edge-row-research/${width}-${theme}.png` });
    });
}
