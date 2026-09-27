const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const catalogue = require('../backend/research-catalogue.json');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, width = 1440, theme = 'dark', fixtureOptions = {}) {
    const browser = await chromium.launch(); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const fixture = await mockContextPanel(page, fixtureOptions);
    await page.addInitScript(theme => { localStorage.setItem('theme', theme); }, theme);
    let job;
    let submissions = 0;
    let loseResponse = false;
    const calls = [];
    await page.route('**/api/**/source-research/**', async route => {
        const request = route.request(); const url = new URL(request.url()); calls.push({ method: request.method(), path: url.pathname });
        if (url.pathname.endsWith('/templates')) return route.fulfill({ json: { configured: true, processor: 'ultra4x', estimated_cost_usd: 1.2, templates: catalogue.map(({ id, label, version }) => ({ id, label, version })) } });
        if (request.method() === 'POST') {
            submissions++;
            const input = request.postDataJSON();
            if (job) assert.equal(input.request_id, job.request_id);
            job ||= { ...input, id: 'local_research_fixture', company: 'Gold Producer', ticker: 'ASX:STOCK', exchange: 'ASX', asset_class: 'GOLD_MINERS',
                provider: 'parallel', processor: 'ultra4x', estimated_cost_usd: 1.2, provider_run_id: 'trun_fixture', status: 'queued', created_at: '2026-09-17T01:00:00Z', updated_at: '2026-09-17T01:00:00Z' };
            if (loseResponse) { loseResponse = false; return route.abort('failed'); }
            return route.fulfill({ status: 202, json: job });
        }
        if (url.pathname.endsWith('/jobs')) return route.fulfill({ json: job ? [job] : [] });
        return route.fulfill({ json: job });
    });
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${base}/#/analysis`);
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    t.after(() => assert.deepEqual(errors, []));
    return { page, calls, fixture, submissions: () => submissions, lose: () => { loseResponse = true; }, review: () => {
        job.status = 'review'; job.error = 'Source packet identity does not match this request.';
        job.provider_result = { output: { content: 'Wrong company packet' } };
    }, complete: () => {
        job.status = 'succeeded';
        job.packet = { company: job.company, ticker: job.ticker, exchange: 'ASX', asset_class: 'gold_miner', retrieval_date: '2026-09-17', source_count: 1,
            sources: [{ title: 'Quarterly report', source_type: 'primary_filing', url: 'https://example.com/report', date: '2026-09-01', named_source: 'Gold Producer', factual_summary: ['Reported cash $10m.'], relevance: 'Funding' }],
            rejected_sources: [], known_gaps: ['No newer cash balance.'] };
    } };
}
async function openSecurity(page) {
    await page.getByRole('button', { name: 'Open Council controls for Gold Producer', exact: true }).click();
    await page.getByRole('button', { name: 'Source research', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await expect(dialog.getByRole('button', { name: 'Retrieve sources', exact: true })).toBeEnabled();
    return dialog;
}

async function useOwnSources(dialog) {
    const back = dialog.getByRole('button', { name: 'Source options', exact: true });
    if (await back.isVisible()) await back.click();
    await dialog.getByRole('radio', { name: 'Attach your own', exact: true }).check();
}

async function openSavedResearch(dialog) {
    const button = dialog.getByRole('button', { name: /^Saved research \d+$/ });
    await expect(button).toBeVisible();
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
    await expect(dialog.getByRole('region', { name: 'Saved source research', exact: true })).toBeVisible();
}

test('source methods show only their own controls and preserve drafts without starting research', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    const dialog = await openSecurity(page);
    await expect(dialog.getByRole('group', { name: 'Research mode', exact: true }).getByRole('button').first()).toHaveText('Source research');
    await expect(dialog.getByRole('group', { name: 'Research mode', exact: true }).getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('radiogroup', { name: 'Source method', exact: true }).getByRole('radio').first()).toHaveAccessibleName('Retrieve automatically');
    await expect(dialog.getByRole('radio', { name: 'Retrieve automatically', exact: true })).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Paste', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Saved research/ })).toHaveCount(0);
    await expect(dialog.getByRole('region', { name: 'Saved source research', exact: true })).toHaveCount(0);
    await expect(dialog.getByText('No source research saved for this security.', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Copy prompt', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Retrieval instructions', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Copy prompt', exact: true })).toBeVisible();

    await useOwnSources(dialog);
    await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Retrieve sources', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('combobox', { name: 'Template', exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Parallel Ultra 4x', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Retrieval instructions', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
    const draft = 'Unattached primary-source evidence retained between methods.';
    await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill(draft);
    await dialog.getByRole('radio', { name: 'Retrieve automatically', exact: true }).check();
    await expect(dialog.getByRole('textbox', { name: 'Source text', exact: true })).toHaveCount(0);
    await useOwnSources(dialog);
    await expect(dialog.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue(draft);
    await dialog.getByRole('button', { name: 'Web UI prompts', exact: true }).click();
    await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Attach your own', exact: true })).toBeChecked();
    await expect(dialog.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue(draft);
    assert.equal(state.submissions(), 0);
    assert.equal(state.fixture.writes.length, 0);
});

test('saved research opens on demand in the same dialog without losing a manual draft', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    const dialog = await openSecurity(page);
    await dialog.getByRole('button', { name: 'Retrieve sources', exact: true }).click();
    await expect(dialog).toContainText('Queued');
    await page.keyboard.press('Escape'); state.complete();
    const detailReads = () => state.calls.filter(call => call.method === 'GET' && call.path.endsWith('/jobs/local_research_fixture')).length;
    const before = detailReads();
    await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Saved research 1', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByRole('region', { name: 'Saved source research', exact: true })).toHaveCount(0);
    assert.equal(detailReads(), before, 'opening source options must not expand or fetch a saved packet');
    await page.setViewportSize({ width: 320, height: 800 });
    const savedButton = dialog.getByRole('button', { name: 'Saved research 1', exact: true });
    const methods = dialog.getByRole('radiogroup', { name: 'Source method', exact: true });
    const methodsBox = await methods.boundingBox();
    const savedBox = await savedButton.boundingBox();
    assert.ok(savedBox.y >= methodsBox.y + methodsBox.height, 'saved research should wrap below the method choice on mobile');
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await useOwnSources(dialog);
    await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill('Keep my manual draft.');
    await openSavedResearch(dialog);
    await expect(dialog.getByRole('button', { name: 'Attach to Council', exact: true })).toBeEnabled();
    assert.ok(detailReads() > before);
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(1);
    await expect(dialog.getByRole('radiogroup', { name: 'Source method', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Paste', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('combobox', { name: 'Template', exact: true })).toHaveCount(0);
    mkdirSync('/tmp/alpha-edge-research-audit', { recursive: true });
    await dialog.screenshot({ path: '/tmp/alpha-edge-research-audit/saved-research-320-dark.png' });
    await dialog.getByRole('button', { name: 'Source options', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Attach your own', exact: true })).toBeChecked();
    await expect(dialog.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue('Keep my manual draft.');
    assert.equal(state.submissions(), 1);
    assert.equal(state.fixture.writes.length, 0);
});

test('library has clear labels, retained class selection, populated prompts and keyboard dismissal', { timeout: 90000 }, async t => {
    const { page, submissions } = await setup(t);
    await page.getByTitle('Template library', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Research templates', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Template', exact: true }).selectOption('rare_earths_critical_minerals');
    await expect(dialog.locator('pre')).toContainText('Investment analysis prompt');
    await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
    await expect(dialog.getByRole('combobox')).toHaveValue('rare_earths_critical_minerals');
    await expect(dialog.locator('pre')).toContainText('Return a source packet, not an investment memo.');
    await expect(dialog.locator('pre')).not.toContainText('ESTIMATE tag');
    await dialog.getByRole('combobox').selectOption('gold_miner');
    await expect(dialog.locator('pre')).toContainText('"asset_class": "gold_miner"');
    await dialog.getByRole('combobox').selectOption('silver_miner');
    await expect(dialog.locator('pre')).toContainText('"asset_class": "silver_miner"');
    await expect(dialog.getByText('Template router', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Copy/Paste', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Copy prompt', exact: true }).click();
    assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('silver_miner'));
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    assert.equal(submissions(), 0);
});

test('source retrieval is explicit, survives closing, and attaches a saved packet without running Council', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    let dialog = await openSecurity(page);
    await expect(dialog.getByRole('combobox')).toHaveValue('gold_miner');
    await expect(dialog).not.toContainText('Parallel Ultra 4x');
    await expect(dialog).not.toContainText('Estimated US$');
    await dialog.getByRole('button', { name: 'Retrieval instructions', exact: true }).click();
    await expect(dialog.locator('pre')).toContainText('Gold Producer');
    await expect(dialog.locator('pre')).not.toContainText('[PRIMARY_COMMODITY]');
    await dialog.getByRole('button', { name: 'Retrieve sources', exact: true }).dblclick();
    await expect(dialog).toContainText('Queued'); assert.equal(state.submissions(), 1);
    await page.keyboard.press('Escape'); state.complete();
    // Source research and Council use the same dialog; Escape returns to Council.
    await page.getByRole('button', { name: 'Source research', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await openSavedResearch(dialog);
    await expect(dialog.getByRole('button', { name: 'Attach to Council', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Attach to Council', exact: true }).click();
    await expect(dialog).toContainText('Council has not been started.');
    assert.equal(state.submissions(), 1);
    assert.equal(state.fixture.writes.length, 0, 'attaching must not submit Council or edit Analysis');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Source research', exact: true })).toHaveAttribute('title', /Attached: source-research-ASX-STOCK/);
    await page.getByRole('button', { name: 'Source research', exact: true }).click();
    await openSavedResearch(dialog);
    await expect(page.getByRole('button', { name: 'Replace Council attachment', exact: true })).toBeEnabled();
});

test('invalid provider output remains inspectable without becoming a Council attachment', { timeout: 90000 }, async t => {
    const state = await setup(t); let dialog = await openSecurity(state.page);
    await dialog.getByRole('button', { name: 'Retrieve sources', exact: true }).click();
    await expect(dialog).toContainText('Queued');
    await state.page.keyboard.press('Escape'); state.review();
    await state.page.getByRole('button', { name: 'Source research', exact: true }).click();
    dialog = state.page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await openSavedResearch(dialog);
    await expect(dialog.getByRole('button', { name: 'Download result for review', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Attach to Council', exact: true })).toHaveCount(0);
    assert.equal(state.fixture.writes.length, 0);
});

test('an older backend leaves manual prompts usable and disables paid retrieval', { timeout: 90000 }, async t => {
    const state = await setup(t);
    await state.page.route('**/api/**/source-research/templates', route => route.fulfill({ status: 404, contentType: 'text/plain', body: '404 page not found' }));
    await state.page.getByRole('button', { name: 'Open Council controls for Gold Producer', exact: true }).click();
    await state.page.getByRole('button', { name: 'Source research', exact: true }).click();
    const dialog = state.page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await expect(dialog).toContainText('Source research is not available on this backend yet.');
    await expect(dialog.getByRole('button', { name: 'Retrieve sources', exact: true })).toBeDisabled();
    await useOwnSources(dialog);
    await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill('Company filings already available.');
    await dialog.getByRole('button', { name: 'Attach sources', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Council sources', exact: true })).toContainText('sources-ASX-STOCK.txt');
    await dialog.getByRole('button', { name: 'Web UI prompts', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Copy prompt', exact: true })).toBeEnabled();
    assert.equal(state.submissions(), 0);
    assert.equal(state.fixture.writes.length, 0);
});

test('pasted sources retain drafts across modes and submit only on a confirmed Council run', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    let dialog = await openSecurity(page);
    const source = '# Primary evidence\nReported cash: $10m.\nNo valuation supplied.\n';
    await useOwnSources(dialog);
    await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Attach sources', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill('   ');
    await expect(dialog.getByRole('button', { name: 'Attach sources', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill(source);
    await dialog.getByRole('button', { name: 'Web UI prompts', exact: true }).click();
    await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue(source);
    await dialog.getByRole('button', { name: 'Attach sources', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Council sources', exact: true })).toContainText('sources-ASX-STOCK.txt');
    await page.keyboard.press('Escape');
    const controls = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await expect(controls.getByText('DOC', { exact: true })).toHaveCount(0);
    await expect(controls.locator('input[type="file"]')).toHaveCount(0);
    await controls.getByRole('button', { name: 'Source research', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await useOwnSources(dialog);
    await expect(dialog.getByRole('region', { name: 'Council sources', exact: true })).toContainText('sources-ASX-STOCK.txt');
    assert.equal(state.submissions(), 0); assert.equal(state.fixture.writes.length, 0);
    await page.keyboard.press('Escape');
    await controls.getByRole('button', { name: /^(Run|Rerun) Council$/ }).click();
    await expect(controls).toContainText('Document: sources-ASX-STOCK.txt');
    const requests = [];
    await page.route('**/api/council/jobs', async route => {
        requests.push(route.request());
        await route.fulfill({ status: 400, json: { error: 'Isolated submission fixture' } });
    });
    await controls.getByRole('button', { name: 'Confirm and run', exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    assert.match(requests[0].headers()['content-type'], /^multipart\/form-data/);
    const multipart = requests[0].postDataBuffer().toString('utf8');
    assert.match(multipart, /name="supplementary_file"; filename="sources-ASX-STOCK.txt"/);
    assert.ok(multipart.includes(source.replace(/\n/g, '\r\n')) || multipart.includes(source));
    assert.equal(state.submissions(), 0);
});

test('uploads validate locally and replacement or removal keeps provider attach controls accurate', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    let dialog = await openSecurity(page);
    await dialog.getByRole('button', { name: 'Retrieve sources', exact: true }).click();
    await expect(dialog).toContainText('Queued');
    await page.keyboard.press('Escape'); state.complete();
    await page.getByRole('button', { name: 'Source research', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await openSavedResearch(dialog);
    await dialog.getByRole('button', { name: 'Attach to Council', exact: true }).click();
    await useOwnSources(dialog);
    const sources = dialog.getByRole('region', { name: 'Council sources', exact: true });
    const input = sources.locator('input[type="file"]');
    await input.setInputFiles({ name: 'report.html', mimeType: 'text/html', buffer: Buffer.from('<p>Source</p>') });
    await expect(sources.getByRole('alert')).toContainText('Choose a PDF');
    await expect(sources).toContainText('source-research-ASX-STOCK');
    await input.setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
    await expect(sources.getByRole('alert')).toContainText('empty');
    await input.setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 'a') });
    await expect(sources.getByRole('alert')).toContainText('20 MB');
    await openSavedResearch(dialog);
    await expect(dialog.getByRole('button', { name: 'Attach to Council', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
    await useOwnSources(dialog);
    for (const [extension, mime] of [['pdf', 'application/pdf'], ['md', 'text/markdown'], ['txt', 'text/plain'], ['json', 'application/json']]) {
        await input.setInputFiles({ name: `company-report.${extension}`, mimeType: mime, buffer: Buffer.from(extension === 'json' ? '{"cash":10000000}' : 'Company cash report') });
        await expect(sources).toContainText(`company-report.${extension}`);
        await expect(sources.getByRole('alert')).toHaveCount(0);
    }
    await useOwnSources(dialog);
    await sources.getByRole('button', { name: 'Paste', exact: true }).click();
    await sources.getByRole('textbox', { name: 'Source text', exact: true }).fill('Unattached draft');
    await sources.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(sources).toContainText('company-report.json');
    await useOwnSources(dialog);
    await sources.getByRole('button', { name: 'Paste', exact: true }).click();
    await expect(sources.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue('');
    await sources.getByRole('textbox', { name: 'Source text', exact: true }).fill('Replacement manual evidence');
    await sources.getByRole('button', { name: 'Replace attachment', exact: true }).click();
    await expect(sources).toContainText('sources-ASX-STOCK.txt');
    await openSavedResearch(dialog);
    await expect(dialog.getByRole('button', { name: 'Replace Council attachment', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Replace Council attachment', exact: true }).click();
    await useOwnSources(dialog);
    await sources.getByRole('button', { name: 'Remove Council attachment', exact: true }).click();
    await expect(sources.getByRole('status')).toHaveCount(0);
    await openSavedResearch(dialog);
    await expect(dialog.getByRole('button', { name: 'Attach to Council', exact: true })).toBeEnabled();
    assert.equal(state.submissions(), 1); assert.equal(state.fixture.writes.length, 0);
});

test('attachments stay scoped to the selected security', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    await page.route('**/api/**/analysis', route => route.fulfill({ json: [
        { id: 2, ticker: 'ASX:STOCK', name: 'Gold Producer', security_type: 'STOCK', primary_asset_class: 'GOLD_MINERS', current_price: 30, include_in_sizing: true },
        { id: 5, ticker: 'ASX:SECOND', name: 'Silver Producer', security_type: 'STOCK', primary_asset_class: 'SILVER_MINERS', current_price: 30, include_in_sizing: true, is_watchlist: true },
    ] }));
    await page.reload();
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    const dialog = await openSecurity(page);
    await useOwnSources(dialog);
    await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill('Gold Producer evidence');
    await dialog.getByRole('button', { name: 'Attach sources', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close Council controls for Gold Producer', exact: true }).click();
    await page.getByRole('button', { name: 'Open Council controls for Silver Producer', exact: true }).click();
    await page.getByRole('button', { name: 'Source research', exact: true }).click();
    const other = page.getByRole('dialog', { name: 'Council controls for Silver Producer', exact: true });
    await useOwnSources(other);
    await expect(other.getByRole('region', { name: 'Council sources', exact: true }).getByRole('status')).toHaveCount(0);
    assert.equal(state.submissions(), 0); assert.equal(state.fixture.writes.length, 0);
});

for (const [existing, hideColumn] of [[true, false], [false, false], [true, true]]) {
    test(`expanded Council ${existing ? 'rerun' : 'run'} opens setup before confirmation${hideColumn ? ' with the column hidden' : ''}`, { timeout: 90000 }, async t => {
        const state = await setup(t, 1440, 'dark', { thesis: existing ? 'Saved research evidence' : '' });
        const { page } = state;
        if (hideColumn) {
            await page.evaluate(() => localStorage.setItem('terminal-analysis-visible-columns-v2', JSON.stringify({ council: false })));
            await page.reload();
            await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
            await expect(page.locator('.analysis-council-cell')).toHaveCount(0);
        }
        const row = page.locator('.analysis-stock-row').filter({ hasText: 'Gold Producer' });
        await row.locator('.analysis-score-cell button').first().click();
        const expanded = page.locator('.analysis-expanded-panel');
        const trigger = expanded.locator('.analysis-council-expanded-trigger');
        await expect(trigger).toHaveText(existing ? 'Rerun Council' : 'Run Council');
        await trigger.dblclick();
        const controls = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
        await expect(controls).toBeVisible();
        await expect(controls.getByRole('button', { name: 'Source research', exact: true })).toBeVisible();
        await expect(controls.getByRole('button', { name: 'Confirm and run', exact: true })).toHaveCount(0);
        assert.equal(state.fixture.writes.length, 0); assert.equal(state.submissions(), 0);

        await controls.getByRole('button', { name: /^(Run|Rerun) Council$/ }).click();
        await expect(controls.getByRole('button', { name: 'Confirm and run', exact: true })).toBeEnabled();
        await expect(controls).toContainText('ASX:STOCK');
        assert.equal(state.fixture.writes.length, 0);
        await controls.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(controls.getByRole('button', { name: 'Source research', exact: true })).toBeVisible();
        await controls.getByRole('button', { name: /^(Run|Rerun) Council$/ }).click();
        await controls.getByRole('button', { name: 'Close Council controls for Gold Producer', exact: true }).click();
        await trigger.click();
        await expect(controls.getByRole('button', { name: 'Confirm and run', exact: true })).toHaveCount(0);

        if (!hideColumn) {
            await page.keyboard.press('Escape');
            await expect(trigger).toBeFocused();
            await page.getByRole('button', { name: 'Open Council controls for Gold Producer', exact: true }).click();
            await expect(controls).toHaveCount(1);
            await expect(controls).toHaveAttribute('id', 'council-controls-2');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('button', { name: 'Open Council controls for Gold Producer', exact: true })).toBeFocused();
            await trigger.click();
            await expect(controls).toHaveCount(1);
            await expect(controls).toHaveAttribute('id', 'council-controls-2');
        }
        await controls.getByRole('button', { name: 'Source research', exact: true }).click();
        const research = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
        await useOwnSources(research);
        await research.getByRole('button', { name: 'Paste', exact: true }).click();
        await research.getByRole('textbox', { name: 'Source text', exact: true }).fill('Evidence for the next run');
        await research.getByRole('button', { name: 'Attach sources', exact: true }).click();
        await page.keyboard.press('Escape');
        await controls.getByRole('button', { name: /^(Run|Rerun) Council$/ }).click();
        await expect(controls).toContainText('Document: sources-ASX-STOCK.txt');
        assert.equal(state.fixture.writes.length, 0); assert.equal(state.submissions(), 0);

        const requests = [];
        await page.route('**/api/council/jobs', async route => {
            requests.push(route.request());
            await route.fulfill({ status: 400, json: { error: 'Isolated submission fixture' } });
        });
        await controls.getByRole('button', { name: 'Confirm and run', exact: true }).click();
        await expect.poll(() => requests.length).toBe(1);
        assert.ok(requests[0].postDataBuffer().toString('utf8').includes('Evidence for the next run'));
    });
}

test('uncertain browser submission reuses its request ID', { timeout: 90000 }, async t => {
    const state = await setup(t); const dialog = await openSecurity(state.page);
    state.lose();
    await dialog.getByRole('button', { name: 'Retrieve sources', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Check submission', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Check submission', exact: true }).click();
    await expect(dialog).toContainText('Queued'); assert.equal(state.submissions(), 2);
});

for (const [width, theme] of [[1366, 'dark'], [1366, 'light'], [390, 'dark'], [390, 'light'], [320, 'dark']]) {
    test(`Council dialog remains readable at ${width}px ${theme}`, { timeout: 90000 }, async t => {
        const state = await setup(t, 1366, theme); const { page } = state;
        const trigger = page.getByRole('button', { name: 'Open Council controls for Gold Producer', exact: true });
        await trigger.click();
        await page.setViewportSize({ width, height: 700 });
        const dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
        await expect(dialog).toBeVisible();
        const assertLayout = async () => {
            const box = await dialog.boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 701);
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            const controls = await dialog.locator('button, input, textarea').evaluateAll(elements => elements
                .filter(el => el.getBoundingClientRect().width).map(el => ({
                    size: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height,
                    width: el.clientWidth, content: el.scrollWidth,
                })));
            assert.ok(controls.every(el => el.size >= 12 && el.height >= 32 && el.content <= el.width + 1));
        };
        await assertLayout();
        const initialBox = await dialog.boundingBox();
        assert.ok(initialBox.height <= (width > 600 ? 440 : 460), 'the opening Council modal must stay compact');
        const sourceRow = dialog.getByRole('region', { name: 'Source preparation', exact: true });
        const sourceEntry = sourceRow.getByRole('button', { name: 'Source research', exact: true });
        const sourceEntryBox = await sourceEntry.boundingBox();
        assert.equal(sourceEntryBox.width, (await sourceRow.boundingBox()).width, 'the complete source row should be clickable');
        assert.ok(sourceEntryBox.height <= 90, 'source preparation must not become another oversized section');
        const sourceAppearance = await sourceEntry.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth }));
        assert.notEqual(sourceAppearance.background, 'rgba(0, 0, 0, 0)', 'source research should have a visible button surface');
        assert.equal(sourceAppearance.border, '1px');
        for (const name of ['Load latest', 'Saved runs', 'Clear result']) {
            await expect(dialog.getByRole('region', { name: 'Saved Council result', exact: true }).getByTitle(name, { exact: true })).toBeInViewport();
        }
        mkdirSync('/tmp/alpha-edge-research-audit', { recursive: true });
        await dialog.screenshot({ path: `/tmp/alpha-edge-research-audit/council-${width}-${theme}.png` });
        const outputButton = dialog.getByRole('button', { name: 'Model output', exact: true });
        await expect(outputButton).toHaveText('');
        await expect(outputButton).toHaveAttribute('aria-expanded', 'false');
        const outputBox = await outputButton.boundingBox();
        const headingBox = await dialog.getByRole('heading', { name: 'Saved result', exact: true }).boundingBox();
        assert.ok(outputBox.x >= headingBox.x + headingBox.width && outputBox.x <= headingBox.x + headingBox.width + 12);
        assert.ok(Math.abs(outputBox.y + outputBox.height / 2 - headingBox.y - headingBox.height / 2) <= 1);
        await outputButton.focus();
        await page.keyboard.press('Enter');
        await expect(outputButton).toHaveAttribute('aria-expanded', 'true');
        await expect(dialog.getByLabel('Source text', { exact: true })).toBeVisible();
        await assertLayout();
        await outputButton.click();
        await expect(dialog.getByLabel('Source text', { exact: true })).toBeHidden();
        await dialog.getByLabel('Price target', { exact: true }).focus();
        await dialog.getByRole('button', { name: 'Rerun Council', exact: true }).click();
        await expect(dialog.getByRole('heading', { name: 'Confirm Council rerun', exact: true })).toBeFocused();
        await assertLayout();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Rerun Council', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        assert.equal(state.submissions(), 0); assert.equal(state.fixture.writes.length, 0);
    });
}

test('Council keeps attachment focus and exposes saved-run errors without starting analysis', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    await openSecurity(page);
    await page.keyboard.press('Escape');
    const dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await expect(dialog.getByRole('button', { name: 'Source research', exact: true })).toBeFocused();
    await page.route('**/api/council/runs?*', route => route.fulfill({ json: { runs: [] } }));
    await dialog.getByRole('button', { name: 'Saved runs', exact: true }).click();
    await expect(dialog).toContainText('No saved runs yet.');
    const requests = [];
    let respond;
    await page.route('**/api/council/runs/latest?*', async route => {
        requests.push(route.request());
        await new Promise(resolve => { respond = resolve; });
        await route.fulfill({ status: 404, json: { detail: 'No saved Council run' } });
    });
    await dialog.getByRole('button', { name: 'Load latest', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Loading saved analysis...');
    await expect(dialog.getByRole('button', { name: 'Load latest', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Rerun Council', exact: true })).toBeDisabled();
    await expect.poll(() => requests.length).toBe(1); respond();
    await expect(dialog.getByRole('alert')).toHaveText('No saved run');
    await expect(dialog.getByRole('button', { name: 'Rerun Council', exact: true })).toBeEnabled();
    assert.equal(state.submissions(), 0); assert.equal(state.fixture.writes.length, 0);
});

test('Council result fields and source output retain their existing save workflow', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    const saved = [];
    await page.route('**/api/**/analysis/2', async route => {
        assert.equal(route.request().method(), 'PATCH');
        saved.push(route.request().postDataJSON());
        await route.fulfill({ json: {} });
    });
    const trigger = page.getByRole('button', { name: 'Open Council controls for Gold Producer', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
    await dialog.getByLabel('Quality', { exact: true }).fill('81.5');
    await dialog.getByLabel('Value', { exact: true }).fill('72');
    await dialog.getByLabel('Price target', { exact: true }).fill('41.125');
    await dialog.getByRole('button', { name: 'Model output', exact: true }).click();
    await dialog.getByLabel('Input date', { exact: true }).fill('2026-09-16');
    await dialog.getByLabel('Source text', { exact: true }).fill('  Saved Council output, not next-run source evidence.  ');
    await dialog.getByRole('heading', { name: 'Council analysis', exact: true }).click();
    await expect.poll(() => saved.at(-1)?.council_source_output).toBe('Saved Council output, not next-run source evidence.');
    assert.equal(saved.at(-1).council_quality, 81.5);
    assert.equal(saved.at(-1).council_value, 72);
    assert.equal(saved.at(-1).council_pt, 41.125);
    assert.equal(saved.at(-1).council_source_input_at, '2026-09-16');
    await expect(dialog).toContainText('No sources attached');
    await page.keyboard.press('Escape'); await trigger.click();
    await expect(dialog.getByLabel('Price target', { exact: true })).toHaveValue('41.125');
    await dialog.getByRole('button', { name: 'Clear result', exact: true }).click();
    await expect(dialog).toContainText('No saved Council result.');
    await expect.poll(() => saved.at(-1)?.council_pt).toBe(0);
    assert.equal(state.submissions(), 0); assert.equal(state.fixture.writes.length, 0);
});

test('Council confirmation still blocks a security without an exchange', { timeout: 90000 }, async t => {
    const state = await setup(t); const { page } = state;
    await page.route('**/api/**/analysis', route => route.fulfill({ json: [
        { id: 99, ticker: 'UNMAPPED', name: 'Unmapped Producer', security_type: 'STOCK', primary_asset_class: 'GOLD_MINERS', is_watchlist: true, include_in_sizing: true },
    ] }));
    await page.reload();
    await expect(page.locator('.analysis-grid')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Open Council controls for Unmapped Producer', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Council controls for Unmapped Producer', exact: true });
    await dialog.getByRole('button', { name: 'Run Council', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Add an exchange prefix before starting this run.');
    await expect(dialog.getByRole('button', { name: 'Confirm and run', exact: true })).toBeDisabled();
    assert.equal(state.submissions(), 0); assert.equal(state.fixture.writes.length, 0);
});

for (const [width, theme] of [[1366, 'dark'], [1366, 'light'], [390, 'dark'], [390, 'light'], [320, 'dark']]) {
    test(`Source research matches the Council frame across modes at ${width}px ${theme}`, { timeout: 90000 }, async t => {
        const state = await setup(t, 1366, theme); const { page } = state;
        await page.getByRole('button', { name: 'Open Council controls for Gold Producer', exact: true }).click();
        await page.setViewportSize({ width, height: 800 });
        const dialog = page.getByRole('dialog', { name: 'Council controls for Gold Producer', exact: true });
        const before = await dialog.boundingBox();
        const dialogNode = await dialog.elementHandle();
        mkdirSync('/tmp/alpha-edge-research-audit', { recursive: true });
        await page.screenshot({ path: `/tmp/alpha-edge-research-audit/council-overview-${width}-${theme}.png` });
        const typography = await dialog.evaluate(el => ({
            title: parseFloat(getComputedStyle(el.querySelector('h2')).fontSize),
            heading: parseFloat(getComputedStyle(el.querySelector('h3')).fontSize),
            score: parseFloat(getComputedStyle(el.querySelector('input[type="number"]')).fontSize),
        }));
        assert.ok(typography.title >= 18 && typography.heading >= 15 && typography.score >= 20);
        await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Retrieve sources', exact: true })).toBeEnabled();
        await expect(dialog.getByRole('radio', { name: 'Retrieve automatically', exact: true })).toBeFocused();
        await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(1);
        await expect(page.locator('[data-council-backdrop]')).toHaveCount(1);
        assert.equal(await dialogNode.evaluate(el => el.isConnected), true);
        const after = await dialog.boundingBox();
        assert.deepEqual(after, before, 'Source research must match the Council dialog size and position');
        assert.ok(after.y >= 0 && after.y + after.height <= 801);
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        const instructions = dialog.getByRole('button', { name: 'Retrieval instructions', exact: true });
        const footer = dialog.locator('footer:visible');
        await expect(footer.getByRole('button', { name: 'Retrieval instructions', exact: true })).toBeVisible();
        await expect(footer).toContainText('No sources attached');
        const retrieve = dialog.getByRole('button', { name: 'Retrieve sources', exact: true });
        const retrieveBox = await retrieve.boundingBox();
        await expect(footer.getByRole('button', { name: 'Retrieve sources', exact: true })).toBeInViewport();
        const footerBox = await footer.boundingBox();
        assert.ok(retrieveBox.height >= 36 && retrieveBox.x + retrieveBox.width > after.x + after.width - 30,
            'retrieval must be the main bottom-right action');
        assert.ok(retrieveBox.y >= footerBox.y && retrieveBox.y + retrieveBox.height <= footerBox.y + footerBox.height);
        assert.ok(after.height <= (width > 600 ? 440 : 460), 'research should retain the shared Council dimensions');
        const emphasis = await retrieve.evaluate(el => ({ fontSize: parseFloat(getComputedStyle(el).fontSize), fontWeight: Number(getComputedStyle(el).fontWeight), background: getComputedStyle(el).backgroundColor }));
        assert.ok(emphasis.fontSize >= 13 && emphasis.fontWeight >= 500);
        assert.notEqual(emphasis.background, 'rgba(0, 0, 0, 0)');
        const template = dialog.locator('header').getByRole('combobox', { name: 'Template', exact: true });
        await expect(template).toHaveValue('gold_miner');
        const templateBox = await template.boundingBox();
        assert.ok(templateBox.height <= 26 && templateBox.width <= 160, 'template should stay compact beside the security identity');
        await expect(dialog.getByRole('textbox', { name: 'Find research template', exact: true })).toHaveCount(0);
        assert.ok(await footer.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        const backdrop = await page.locator('[data-council-backdrop]').evaluate(el => getComputedStyle(el).backgroundColor);
        assert.equal(backdrop, 'rgba(0, 0, 0, 0.2)');
        await page.screenshot({ path: `/tmp/alpha-edge-research-audit/council-research-${width}-${theme}.png` });
        await instructions.click();
        await expect(dialog.locator('pre')).toContainText('Return a source packet');
        const expanded = await dialog.boundingBox();
        assert.deepEqual(expanded, before, 'opening instructions must not resize or move the dialog');
        await expect(footer.getByRole('button', { name: 'Retrieve sources', exact: true })).toBeInViewport();
        const scrollBody = dialog.locator('[data-research-scroll]:visible');
        const scrolling = await scrollBody.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
        assert.ok(scrolling.content > scrolling.height, 'long instructions should scroll within the dialog');
        const tabs = dialog.getByRole('group', { name: 'Research mode', exact: true });
        const tabsBox = await tabs.boundingBox();
        await scrollBody.evaluate(el => { el.scrollTop = el.scrollHeight; });
        assert.deepEqual(await tabs.boundingBox(), tabsBox, 'research navigation must not scroll with instructions');
        await expect(tabs.getByRole('button', { name: 'Web UI prompts', exact: true })).toBeInViewport();
        await instructions.click();
        assert.deepEqual(await dialog.boundingBox(), before, 'closing instructions must keep the same frame');
        await template.selectOption('silver_miner');
        await instructions.click();
        await expect(dialog.locator('pre:visible')).toContainText('"asset_class": "silver_miner"');
        await dialog.getByRole('button', { name: 'Copy prompt', exact: true }).click();
        assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('silver_miner'));
        await instructions.click();
        await dialog.getByRole('button', { name: 'Web UI prompts', exact: true }).click();
        await expect(template).toHaveValue('silver_miner');
        await expect(dialog.locator('pre:visible')).toContainText('Investment analysis prompt');
        assert.deepEqual(await dialog.boundingBox(), before, 'Web UI prompts must use the same Council frame');
        await expect(footer.getByRole('button', { name: 'Copy prompt', exact: true })).toBeInViewport();
        await page.screenshot({ path: `/tmp/alpha-edge-research-audit/web-ui-prompts-${width}-${theme}.png` });
        await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
        await expect(template).toHaveValue('silver_miner');
        assert.deepEqual(await dialog.boundingBox(), before, 'returning to automatic retrieval must not resize the dialog');
        await useOwnSources(dialog);
        assert.deepEqual(await dialog.boundingBox(), before, 'manual attachments must keep the same Council frame');
        await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
        await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill('Evidence retained when returning to Council.');
        assert.deepEqual(await dialog.boundingBox(), before, 'opening the paste editor must not resize the dialog');
        await dialog.getByRole('button', { name: 'Attach sources', exact: true }).click();
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Source research', exact: true })).toBeFocused();
        await expect(dialog.getByRole('region', { name: 'Source preparation', exact: true })).toContainText('sources-ASX-STOCK.txt');
        await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
        await dialog.getByRole('button', { name: 'Back to Council', exact: true }).click();
        await expect(dialog.getByRole('heading', { name: 'Council analysis', exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Source research', exact: true }).click();
        await dialog.getByRole('button', { name: 'Close Council controls for Gold Producer', exact: true }).click();
        await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
        assert.equal(state.submissions(), 0); assert.equal(state.fixture.writes.length, 0);
    });
}

for (const [width, theme] of [[1366, 'dark'], [390, 'light']]) {
    test(`research library fits ${width}px ${theme}`, { timeout: 90000 }, async t => {
        const { page } = await setup(t, width, theme);
        if (width < 600) {
            // The global library is independent of mobile table column visibility.
            await page.getByTitle('Template library', { exact: true }).click();
        } else await openSecurity(page);
        const dialog = page.locator('[role="dialog"]').last();
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 901);
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        const sizes = await dialog.getByRole('button').evaluateAll(buttons => buttons.filter(b => b.getBoundingClientRect().width).map(b => parseFloat(getComputedStyle(b).fontSize)));
        assert.ok(sizes.every(size => size >= 12));
        mkdirSync('/tmp/alpha-edge-research-audit', { recursive: true });
        await page.screenshot({ path: `/tmp/alpha-edge-research-audit/library-${width}-${theme}.png` });
    });
}

for (const [width, theme] of [[1366, 'dark'], [1366, 'light'], [390, 'dark'], [390, 'light'], [320, 'dark']]) {
    test(`source attachments fit ${width}px ${theme} without clipping controls`, { timeout: 90000 }, async t => {
        const { page } = await setup(t, 1366, theme);
        const dialog = await openSecurity(page);
        await page.setViewportSize({ width, height: 800 });
        await useOwnSources(dialog);
        await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
        await dialog.getByRole('textbox', { name: 'Source text', exact: true }).fill('Quarterly report\nReported cash: $10m\nSource date: 1 September 2026');
        const editor = dialog.getByRole('textbox', { name: 'Source text', exact: true });
        const editorBox = await editor.boundingBox();
        const bodyBox = await dialog.locator('[data-research-scroll]:visible').boundingBox();
        assert.ok(editorBox.height >= 72 && editorBox.y >= bodyBox.y && editorBox.y + editorBox.height <= bodyBox.y + bodyBox.height,
            'the entire paste editor must fit inside the working area');
        await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toBeInViewport();
        await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
        await expect(dialog.locator('footer:visible').getByRole('button', { name: 'Attach sources', exact: true })).toBeInViewport();
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 801);
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        const controls = await dialog.locator('button, textarea, select').evaluateAll(els => els.filter(el => el.getBoundingClientRect().width).map(el => ({
            size: parseFloat(getComputedStyle(el).fontSize), width: el.clientWidth, content: el.scrollWidth,
        })));
        assert.ok(controls.every(el => el.size >= 12 && el.content <= el.width + 1));
        mkdirSync('/tmp/alpha-edge-research-audit', { recursive: true });
        await dialog.screenshot({ path: `/tmp/alpha-edge-research-audit/attachments-${width}-${theme}.png` });
        await dialog.getByRole('button', { name: 'Attach sources', exact: true }).click();
        await expect(dialog.getByRole('region', { name: 'Council sources', exact: true })).toContainText('sources-ASX-STOCK.txt');
    });
}
