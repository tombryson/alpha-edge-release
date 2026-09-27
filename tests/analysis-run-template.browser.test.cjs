const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

async function setup(t, { width = 1366, theme = 'dark', overrides = {} } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const fixture = await mockContextPanel(page);
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.route(/\/api\/(?:(?:trading|terminal)\/)?analysis(?:\?|$)/, route => route.fulfill({ json: [{
        id: 7, ticker: 'ASX:SGLLV', name: 'Ricegrowers Limited', security_type: 'STOCK',
        primary_asset_class: 'AGRICULTURE_AGRIBUSINESS', is_watchlist: true, current_price: 7,
        include_in_sizing: true, ...overrides,
    }] }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/analysis`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    await page.locator('.analysis-stock-row').filter({ hasText: 'Ricegrowers Limited' }).focus();
    await page.keyboard.press('Enter');
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    return { page, panel: page.getByRole('region', { name: 'Ricegrowers Limited', exact: true }) };
}

for (const [width, theme] of [[1366, 'dark'], [1366, 'light'], [390, 'dark'], [320, 'light']]) {
    test(`populated GPT template copies without changing draft or dialog bounds at ${width}px ${theme}`, { timeout: 60000 }, async t => {
        const { page, panel } = await setup(t, { width, theme });
        await panel.getByRole('button', { name: 'Add GPT output for Ricegrowers Limited' }).click();
        const dialog = page.getByRole('dialog', { name: 'GPT run', exact: true });
        await dialog.getByLabel('Source text', { exact: true }).fill('Unsaved original source text');
        await dialog.getByRole('spinbutton', { name: 'Quality', exact: true }).fill('82');
        await dialog.getByLabel('Run date', { exact: true }).fill('2026-09-20');
        const before = await dialog.boundingBox();
        await dialog.getByRole('button', { name: 'Template', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(dialog.getByRole('combobox', { name: 'Research template' })).toHaveValue('agriculture_agribusiness');
        const prompt = dialog.getByRole('textbox', { name: 'Investment analysis prompt' });
        await expect(prompt).toHaveValue(/- Company name: Ricegrowers Limited\./);
        await expect(prompt).toHaveValue(/- Ticker: ASX:SGLLV\./);
        await expect(prompt).toHaveValue(/- Exchange: ASX\./);
        assert.deepEqual(await dialog.boundingBox(), before, 'changing views preserves the dialog frame');
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no horizontal overflow');
        await dialog.getByRole('button', { name: 'Copy prompt', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await prompt.inputValue());
        mkdirSync('/tmp/alpha-edge-run-template', { recursive: true });
        await dialog.screenshot({ path: `/tmp/alpha-edge-run-template/prompt-${width}-${theme}.png` });
        await dialog.getByRole('button', { name: 'Back to run', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Template', exact: true })).toBeFocused();
        await expect(dialog.getByLabel('Source text', { exact: true })).toHaveValue('Unsaved original source text');
        await expect(dialog.getByRole('spinbutton', { name: 'Quality', exact: true })).toHaveValue('82');
        await expect(dialog.getByLabel('Run date', { exact: true })).toHaveValue('2026-09-20');
        await dialog.screenshot({ path: `/tmp/alpha-edge-run-template/editor-${width}-${theme}.png` });
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
}

test('the same template is available for every Web UI model, with an explicit rubric override', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t);
    for (const model of ['Gemini', 'GPT', 'Perplexity', 'Claude']) {
        await panel.getByRole('button', { name: `Add ${model} output for Ricegrowers Limited` }).click();
        const dialog = page.getByRole('dialog', { name: `${model} run`, exact: true });
        await dialog.getByRole('button', { name: 'Template', exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Investment analysis prompt' })).toHaveValue(/Template: agriculture_agribusiness/);
        await dialog.getByRole('combobox', { name: 'Research template' }).selectOption('consumer_staples');
        await expect(dialog.getByRole('textbox', { name: 'Investment analysis prompt' })).toHaveValue(/Template: consumer_staples/);
        await page.keyboard.press('Escape');
    }
});

test('missing exchange blocks copying, and an unmapped class never silently defaults to another sector', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t, { overrides: { ticker: 'SGLLV', primary_asset_class: 'UNMAPPED' } });
    await panel.getByRole('button', { name: 'Add GPT output for Ricegrowers Limited' }).click();
    const dialog = page.getByRole('dialog', { name: 'GPT run', exact: true });
    await dialog.getByRole('button', { name: 'Template', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'Research template' })).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Copy prompt', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText('Set exchange');
    await dialog.getByRole('combobox', { name: 'Research template' }).selectOption('agriculture_agribusiness');
    await expect(dialog.getByRole('textbox', { name: 'Investment analysis prompt' })).toHaveValue(/Ricegrowers Limited/);
    await expect(dialog.getByRole('button', { name: 'Copy prompt', exact: true })).toBeDisabled();
});

test('failed template fetch can be retried and cannot copy stale instructions', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t);
    let fail = true;
    await page.route('**/enrichment-prompts/copy-paste-research-prompts/agriculture_agribusiness.yaml', route =>
        fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
    await panel.getByRole('button', { name: 'Add GPT output for Ricegrowers Limited' }).click();
    const dialog = page.getByRole('dialog', { name: 'GPT run', exact: true });
    await dialog.getByRole('button', { name: 'Template', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Could not load this template.');
    await expect(dialog.getByRole('button', { name: 'Copy prompt', exact: true })).toBeDisabled();
    fail = false;
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Copy prompt', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('textbox', { name: 'Investment analysis prompt' })).toHaveValue(/Ricegrowers Limited/);
});

test('saving after viewing a template persists only the model output, not the prompt', { timeout: 60000 }, async t => {
    const { page, panel } = await setup(t);
    const saved = [];
    await page.route(/\/api\/(?:(?:trading|terminal)\/)?analysis\/7$/, route => {
        const payload = route.request().postDataJSON();
        saved.push(payload);
        return route.fulfill({ json: { id: 7, ...payload } });
    });
    await panel.getByRole('button', { name: 'Add GPT output for Ricegrowers Limited' }).click();
    const dialog = page.getByRole('dialog', { name: 'GPT run', exact: true });
    await dialog.getByRole('spinbutton', { name: 'Quality', exact: true }).fill('82');
    await dialog.getByRole('spinbutton', { name: 'Value', exact: true }).fill('74');
    await dialog.getByRole('spinbutton', { name: 'Price target', exact: true }).fill('9.5');
    await dialog.getByLabel('Source text', { exact: true }).fill('Isolated GPT output fixture');
    await dialog.getByRole('button', { name: 'Template', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Investment analysis prompt' })).toHaveValue(/Investment analysis prompt/);
    await dialog.getByRole('button', { name: 'Back to run', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save run', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => saved.length).toBe(1);
    assert.equal(saved[0].gpt_webui_output, 'Isolated GPT output fixture');
    assert.equal(saved[0].gpt_quality, 82);
    assert.equal(saved[0].gpt_value, 74);
    assert.equal(saved[0].gpt_pt, 9.5);
});
