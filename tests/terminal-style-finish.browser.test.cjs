const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, { hasTouch = false } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 850 }, hasTouch });
    const fixture = await mockContextPanel(page);
    await page.route('**/api/**/portfolio-memos/memo-*', route => route.fulfill({ status: 404, json: { error: 'Fixture memo unavailable' } }));
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
        localStorage.setItem('terminal-history-mode', 'performance');
        localStorage.setItem('terminal-history-performance-range', 'ALL');
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    return { page, fixture };
}

test('Analysis retains useful identity and visible class performance with open laptop sidebars', { timeout: 60000 }, async t => {
    const { page } = await setup(t);
    await page.route('**/api/**/analysis', route => route.fulfill({ json: [
        { id: 21, ticker: 'ASX:LONG', name: 'Long Company Name For Identity Coverage', primary_asset_class: 'GOLD_MINERS', security_type: 'STOCK', is_watchlist: true, current_price: 20, include_in_sizing: true, performance_6m_pct: 10 },
        { id: 22, ticker: 'MISSING', name: 'Missing Exchange Company Identity', primary_asset_class: 'GOLD_MINERS', security_type: 'STOCK', is_watchlist: true, current_price: 20, include_in_sizing: true, performance_6m_pct: 10 },
    ] }));
    await page.goto(`${base}/#/analysis`);
    const name = page.getByRole('button', { name: 'Long Company Name For Identity Coverage', exact: true });
    await expect(name).toBeVisible();
    await waitForRailLayout(page);
    for (const width of [1366, 1024, 390]) {
        await page.setViewportSize({ width, height: 850 });
        await expect.poll(async () => (await name.boundingBox()).width).toBeGreaterThan(100);
        const missing = page.getByRole('button', { name: 'Missing Exchange Company Identity', exact: true });
        assert.ok((await missing.boundingBox()).width >= 80);
        assert.equal(await name.evaluate(el => getComputedStyle(el).fontSize), width < 768 ? '12px' : '13px');
        const stats = page.locator('.analysis-section-stats').first();
        await expect.poll(async () => (await stats.boundingBox()).x + (await stats.boundingBox()).width).toBeLessThan(width);
        const scroll = page.locator('.analysis-grid').locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]');
        await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await expect.poll(async () => (await stats.boundingBox()).x).toBeGreaterThan(0);
        await expect.poll(async () => (await stats.boundingBox()).x + (await stats.boundingBox()).width).toBeLessThan(width);
        await scroll.evaluate(el => { el.scrollLeft = 0; });
        assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing'))), 0.1);
    }
});

test('Portfolio navigation fits its main region and Timeline keeps one title/filter header', { timeout: 60000 }, async t => {
    const { page } = await setup(t);
    await page.goto(`${base}/#/portfolio`);
    for (const width of [1366, 1024, 390]) {
        await page.setViewportSize({ width, height: 850 });
        const button = page.getByRole('button', { name: 'Timeline', exact: true });
        await expect(button).toBeVisible();
        await expect.poll(() => button.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.x >= 0 && rect.right <= innerWidth && el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
        await button.click();
        const timeline = page.getByTestId('portfolio-timeline');
        await expect(timeline.getByRole('heading', { name: 'Portfolio timeline', exact: true })).toBeVisible();
        await expect(timeline.getByRole('button', { name: 'Refresh portfolio history' })).toBeVisible();
        await timeline.getByRole('button', { name: 'Back to shape', exact: true }).click();
    }
});

test('Sleeve legends retain the original side-by-side layout and bottom dock', { timeout: 60000 }, async t => {
    const { page } = await setup(t);
    await page.goto(`${base}/#/positions`);
    const summary = page.getByTestId('sleeve-summary');
    await summary.getByRole('button', { name: 'Show current portfolio shape' }).click();
    async function checkLayout() {
        const label = summary.locator('span[title="Gold Miners"]').first();
        const row = label.locator('..');
        const layout = row.locator('../..');
        const chart = layout.locator(':scope > div').first();
        await expect.poll(async () => {
            const chartBox = await chart.boundingBox();
            const rowBox = await row.boundingBox();
            return rowBox.x >= chartBox.x + chartBox.width &&
                rowBox.y < chartBox.y + chartBox.height;
        }).toBe(true);
        assert.equal(await row.evaluate(el => getComputedStyle(el).fontSize), '10.5px');
        assert.equal(await chart.evaluate(el => getComputedStyle(el).maxWidth), '140px');
        await expect.poll(async () => {
            const dock = await summary.boundingBox();
            return Math.abs(dock.y + dock.height - 850);
        }).toBeLessThanOrEqual(2);
    }
    for (const width of [1366, 1800]) {
        await page.setViewportSize({ width, height: 850 });
        await expect(summary.getByRole('img', { name: 'Portfolio summary', exact: true })).toBeVisible();
        await waitForRailLayout(page);
        await checkLayout();
        await summary.getByRole('button', { name: 'Compare with current allocation' }).click();
        await checkLayout();
        await summary.getByRole('button', { name: 'Show current portfolio shape' }).click();
    }
});

test('ETF allocation and ranking use readable labels and keep provenance accessible', { timeout: 60000 }, async t => {
    const { page } = await setup(t);
    await page.route('**/api/**/etf/momentum', route => route.fulfill({ json: {
        latest_run: { id: 1, created_at: '2026-09-01', data_fresh_through: '2026-09-01', algorithm_version: 'TEST_MODEL', ready_members: 1, expected_members: 1, rows: [{ ticker: 'ASX:GOLD', display_name: 'ASX:GOLD', status: 'READY', rank: 1, return_80_pct: 12.5, final_weight_pct: 20 }] }, automation: {},
    } }));
    await page.goto(`${base}/#/etf`);
    // Level 2 is the ETF tab title; the sidebar's level 3 title links here.
    await expect(page.getByRole('heading', { name: 'ETF allocations', exact: true, level: 2 })).toBeVisible();
    const group = page.getByRole('button', { name: /^Gold Miners .*fund.*class target/ });
    await group.click();
    const fundName = page.locator('span[title="Gold Core ETF"]').first();
    await expect(fundName).toBeVisible();
    assert.equal(await fundName.evaluate(el => getComputedStyle(el).fontSize), '13px');
    await page.getByRole('group', { name: 'ETF view' }).getByRole('button', { name: 'Momentum' }).click();
    await expect(page.getByRole('heading', { name: 'ETF momentum ranking', exact: true })).toBeVisible();
    await expect(page.getByText('Gold Core ETF', { exact: true })).toBeVisible();
    await expect(page.getByText('TEST_MODEL', { exact: true })).not.toBeVisible();
    await page.getByText(/Calculation details/).click();
    await expect(page.getByText('TEST_MODEL', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('Nearby History approvals remain individually selectable after grouping and resizing', { timeout: 60000 }, async t => {
    const { page } = await setup(t);
    const rows = n => [{ asset_class: 'GOLD_MINERS', display_name: 'Gold Miners', weight_pct: n }, { asset_class: 'CASH', display_name: 'Cash / reserve', weight_pct: 100 - n }];
    const entries = Array.from({ length: 20 }, (_, i) => ({ id: `shape:${i + 1}`, kind: 'shape', status: 'APPROVED', snapshot_id: i + 1, occurred_at: new Date(Date.parse('2026-08-01T10:00:00Z') + i * 60000).toISOString(), rows: rows(i + 1) }));
    await page.route('**/api/**/portfolio-history?*', route => route.fulfill({ json: { entries } }));
    await page.route('**/api/**/performance/portfolio', route => route.fulfill({ json: ['2025-09-01', '2026-09-01'].map(observed_at => ({ observed_at, total_value_aud: 10000, invested_value_aud: 8000, statement_cash_aud: 2000 })) }));
    await page.route('**/api/**/performance/asset-classes', route => route.fulfill({ json: ['2025-09-01', '2026-09-01'].flatMap(observed_at => rows(60).map(row => ({ ...row, observed_at, portfolio_weight_pct: row.weight_pct, total_value_aud: row.weight_pct * 100 }))) }));
    await page.goto(`${base}/#/history`);
    for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 850 });
        const marker = page.getByRole('button', { name: '20 approved shapes. View approved allocations' });
        await expect(marker).toBeVisible();
        assert.equal(await page.locator('[data-approval-count]').evaluateAll(nodes => nodes.reduce((sum, el) => sum + Number(el.dataset.approvalCount), 0)), 20);
        await marker.locator('text').click();
        const choices = page.getByRole('group', { name: 'Approvals in this group' });
        await expect(choices.getByRole('button')).toHaveCount(20);
        for (const version of [1, 10, 20]) {
            await choices.getByRole('button', { name: new RegExp(`^Approved v${version}\\b`) }).click();
            const preview = page.getByRole('dialog', { name: `Approved shape v${version}`, exact: true });
            await expect(preview).toBeVisible();
            await expect(preview.getByRole('rowheader', { name: 'Gold Miners' })).toBeVisible();
            const bound = await preview.boundingBox();
            assert.ok(bound.x >= 0 && bound.x + bound.width <= width);
        }
        await page.keyboard.press('Escape');
    }
});

test('News puts stories first and retains failed-run details and maintenance controls', { timeout: 60000 }, async t => {
    const { page } = await setup(t);
    const headline = 'An identifiable story with a longer headline';
    const failure = 'Provider rejected the daily run; detailed diagnostic evidence.';
    await page.route('**/api/**/news/brief', route => route.fulfill({ json: {
        run: { id: 1, run_date: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', model: 'TEST_NEWS_MODEL', daily_summary: 'A saved daily brief with readable supporting context.', market_context: {} },
        foundation_run: null, foundation_job: null,
        daily_job: { id: 'failed-run', status: 'FAILED', stage_message: 'Daily run failed', error_message: failure, progress_pct: 55 },
        items: [{ id: 1, headline, sentiment: 'BULLISH', timeframe: '1D', impact_score: 0.8, summary: 'Expanded story evidence.', sources: [], asset_classes: ['GOLD_MINERS'], tags: [] }],
        theses: [], updates: [],
    } }));
    await page.goto(`${base}/#/news`);
    const root = page.locator('[data-news-root]');
    const story = root.getByRole('button', { name: new RegExp(headline) });
    await expect(story).toBeVisible();
    const title = await story.locator('.news-subject').boundingBox();
    const meta = await story.locator('.news-item-meta').boundingBox();
    assert.ok(title.y + title.height <= meta.y);
    await expect(root.getByText('TEST_NEWS_MODEL', { exact: false })).not.toBeVisible();
    await expect(root.getByText('Daily run failed', { exact: true })).toHaveCount(1);
    await expect(root.getByText(failure, { exact: true })).not.toBeVisible();
    await root.getByText('Error details', { exact: true }).click();
    await expect(root.getByText(failure, { exact: true })).toBeVisible();
    await root.getByText('Error details', { exact: true }).click();
    assert.doesNotMatch(await root.locator('.news-brief time').innerText(), /T00:00/);
    await story.click();
    await expect(root.getByText('Expanded story evidence.', { exact: true })).toBeVisible();
    for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 850 });
        await root.getByRole('button', { name: 'News tools', exact: true }).click();
        await expect(page.getByRole('menuitem', { name: 'Run Foundation' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Deduplicate' })).toBeVisible();
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
});

test('Page modes share stable selected states and visible keyboard focus across themes', { timeout: 90000 }, async t => {
    const { page } = await setup(t);
    await page.route('**/api/**/etf/momentum', route => route.fulfill({ json: {
        latest_run: { id: 1, data_fresh_through: '2026-09-01', rows: [{ ticker: 'ASX:GOLD', status: 'READY', rank: 1, return_80_pct: 12.5, score: 3.2, final_weight_pct: 20 }] }, automation: {},
    } }));
    const dates = ['2026-08-01', '2026-09-01'];
    await page.route('**/api/**/performance/portfolio', route => route.fulfill({ json: dates.map(observed_at => ({ observed_at, total_value_aud: 10000, invested_value_aud: 6000, statement_cash_aud: 4000, sleeve_cash_aud: 0 })) }));
    await page.route('**/api/**/performance/asset-classes', route => route.fulfill({ json: dates.map(observed_at => ({ observed_at, asset_class: 'GOLD_MINERS', display_name: 'Gold Miners', total_value_aud: 6000, portfolio_weight_pct: 60 })) }));
    const selectedSurfaces = new Map();
    const modes = [
        ['etf', 'ETF view', 'Allocation', 'Momentum'],
        ['portfolio', 'Portfolio shape view', 'Shape', 'Cumulative'],
        ['history', 'History view', 'Portfolio', 'Activity'],
    ];
    for (const [route, groupName, current, next] of modes) {
        await page.goto(`${base}/#/${route}`);
        const group = page.getByRole('group', { name: groupName, exact: true });
        const button = group.getByRole('button', { name: current, exact: true });
        await button.click();
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            const toggle = page.getByTitle(theme === 'terminal-dark' ? 'Switch to dark mode' : 'Switch to light mode', { exact: true });
            if (await toggle.count()) await toggle.click();
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await page.waitForFunction(() => !document.documentElement.classList.contains('theme-swap-instant'));
            await waitForRailLayout(page);
            await page.mouse.move(0, 0);
            const style = await button.evaluate(el => {
                const s = getComputedStyle(el);
                return { background: s.backgroundColor, shadow: s.boxShadow, size: s.fontSize };
            });
            assert.equal(style.size, '12px');
            assert.match(style.shadow, /inset/);
            if (selectedSurfaces.has(theme)) assert.equal(style.background, selectedSurfaces.get(theme), `${route} ${theme}`);
            else selectedSurfaces.set(theme, style.background);
            const before = await button.boundingBox();
            await button.hover();
            await expect(button).toHaveCSS('background-color', style.background);
            const after = await button.boundingBox();
            assert.equal(after.width, before.width);
            assert.equal(after.height, before.height);
            await page.keyboard.press('Tab');
            await button.focus();
            assert.equal(await button.evaluate(el => getComputedStyle(el).outlineWidth), '2px');
            assert.equal(await button.evaluate(el => getComputedStyle(el).outlineOffset), '-2px');
            assert.equal(await button.evaluate(el => el.matches(':focus-visible')), true);
            await page.screenshot({ path: `/tmp/terminal-controls-${route}-${theme}.png` });
        }
        await group.getByRole('button', { name: next, exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(group.getByRole('button', { name: next, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        for (const width of [1366, 390]) {
            await page.setViewportSize({ width, height: 850 });
            await waitForRailLayout(page);
            await expect(group).toBeVisible();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
        await page.setViewportSize({ width: 1366, height: 850 });
    }
    assert.notEqual(selectedSurfaces.get('terminal-dark'), selectedSurfaces.get('terminal-light-soft'));
});

test('ETF and News filters expose selection without changing data or losing touch targets', { timeout: 60000 }, async t => {
    const { page } = await setup(t, { hasTouch: true });
    await page.goto(`${base}/#/etf`);
    const filters = page.getByRole('group', { name: 'ETF allocation filters' });
    await filters.getByRole('button', { name: /^Review/ }).click();
    await expect(filters.getByRole('button', { name: /^Review/ })).toHaveAttribute('aria-pressed', 'true');
    assert.ok((await filters.getByRole('button', { name: /^Review/ }).boundingBox()).height >= 36);
    await expect(filters.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('group', { name: 'ETF view' }).getByRole('button', { name: 'Allocation', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`${base}/#/news`);
    for (const name of ['News timeframe', 'News sentiment']) {
        const group = page.getByRole('group', { name, exact: true });
        const selected = group.getByRole('button').nth(1);
        await selected.click();
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        assert.ok((await selected.boundingBox()).height >= 36);
        assert.match(await selected.evaluate(el => getComputedStyle(el).boxShadow), /inset/);
        await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'News tools', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Run Foundation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    const details = page.locator('.news-provenance summary');
    await details.focus();
    assert.equal(await details.evaluate(el => getComputedStyle(el).outlineWidth), '2px');
    await page.screenshot({ path: '/tmp/terminal-news-controls-mobile.png' });
});
