const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const rows = (gold) => [
    {
        asset_class: 'GOLD_MINERS',
        display_name: 'Gold Miners',
        display_order: 1,
        weight_pct: gold,
    },
    {
        asset_class: 'CASH',
        display_name: 'Cash / reserve',
        display_order: 2,
        weight_pct: 100 - gold,
    },
];
const memo = (id, day, gold) => ({
    id: 0,
    memo_job_id: `intelligence:${id}.json`,
    run_id: `${id}.json`,
    mode: 'DEEP',
    status: 'SUCCEEDED',
    analysis_date: day,
    primary_theme: 'Diversification with a liquidity reserve',
    secondary_theme: '',
    overall_conviction: 'MEDIUM',
    executive_summary: 'Review concentration before making a target decision.',
    analyst_memo_markdown:
        '# Analyst evidence\n\nEvidence behind the allocation.',
    chairman_memo_markdown: `# Saved conclusion ${id}\n\nReview the **allocation** and its rationale.\n\n## Allocation reasoning\n\n- Diversify the portfolio.\n- Keep liquidity available.\n\n| Class | Target |\n| --- | --- |\n| Gold | ${gold}% |\n\n<script>window.memoExecuted=true</script>\n\n[Unsafe](javascript:alert(1))`,
    asset_class_targets: rows(gold).map((row) => ({
        ...row,
        target_pct: row.weight_pct,
    })),
    created_at: day,
    updated_at: day,
});

async function setup(t, width = 1440, { extraRecords = 0 } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const writes = [];
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const memos = [
        memo('new', '2026-08-11', 40),
        memo('old', '2026-05-17', 60),
    ];
    const entries = [
        {
            id: 'shape:4',
            kind: 'shape',
            status: 'APPROVED',
            snapshot_id: 4,
            occurred_at: '2026-06-03',
            title: 'Approved portfolio shape',
            source: 'User approved',
            rows: rows(60),
        },
        {
            id: 'shape:3',
            kind: 'shape',
            status: 'SUPERSEDED',
            snapshot_id: 3,
            occurred_at: '2026-06-02',
            title: 'Approved portfolio shape',
            source: 'User approved',
            rows: rows(60),
        },
        {
            id: 'actual:1',
            kind: 'actual',
            status: 'OBSERVED',
            occurred_at: '2026-09-01',
            title: 'Broker snapshot',
            source: 'Broker',
            rows: rows(65),
        },
    ];
    for (let i = 0; i < extraRecords; i++) entries.push({
        id: `shape:older-${i}`, kind: 'shape', status: 'SUPERSEDED', snapshot_id: 20 + i,
        occurred_at: `2026-04-${String(28 - i).padStart(2, '0')}`,
        title: 'Approved portfolio shape', source: 'User approved', rows: rows(35 + i),
    });
    let archiveFails = false;
    let memoSaveFails = false;
    await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/council/portfolio-memos'))
            return archiveFails
                ? route.fulfill({ status: 503, json: { detail: 'Offline' } })
                : route.fulfill({ json: { memos, unavailable: [] } });
        if (url.pathname.endsWith('/portfolio-history'))
            return route.fulfill({ json: { entries } });
        if (
            url.pathname.endsWith('/portfolio-memos') &&
            route.request().method() === 'POST'
        ) {
            writes.push(route.request().postDataJSON());
            return memoSaveFails
                ? route.fulfill({ status: 503, body: 'Offline' })
                : route.fulfill({ json: { memo: writes.at(-1) } });
        }
        return route.fallback();
    });
    await page.goto(`${base}/#/portfolio`);
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    const timeline = page.getByTestId('portfolio-timeline');
    await expect(
        timeline.getByRole('heading', { name: 'Saved conclusion new' }),
    ).toBeVisible();
    return {
        page,
        timeline,
        fixture,
        writes,
        errors,
        failArchive: () => (archiveFails = true),
        failSave: () => (memoSaveFails = true),
        allowSave: () => (memoSaveFails = false),
    };
}

test(
    'timeline reads real memos and compares allocations without utility clutter',
    { timeout: 90000 },
    async (t) => {
        const { page, timeline, writes, fixture, errors } = await setup(t);
        const gold = timeline
            .locator('table')
            .first()
            .getByRole('row')
            .filter({ hasText: 'Gold Miners' });
        await expect(gold).toContainText('40.0%');
        await timeline
            .getByRole('button', { name: 'Compare', exact: true })
            .click();
        await expect(gold).toContainText('-20.0pp');
        await expect(
            timeline.getByRole('heading', { name: 'Saved conclusion old' }),
        ).toBeVisible();
        assert.equal(await page.evaluate(() => window.memoExecuted), undefined);
        assert.equal(
            await timeline.locator('a[href^="javascript:"]').count(),
            0,
        );
        await timeline.getByLabel('Portfolio records').getByRole('button').filter({ hasText: 'Approved v4' }).click();
        await expect(timeline.getByText('No allocation change')).toBeVisible();
        const headings = timeline.locator('[class*="recordHeadings"]');
        await expect(headings.getByRole('heading', { level: 2 })).toHaveText(['Approved v4', 'Approved v3']);
        await expect(headings.locator('time')).toHaveText(['3 June 2026', '2 June 2026']);
        await expect(headings.getByText('User approved · No memo linked')).toHaveCount(0);
        await expect(headings.getByText('Approved portfolio shape')).toHaveCount(0);
        await expect(headings.locator('p')).toHaveCount(0);
        await expect(timeline.getByRole('button', { name: 'Memo-based examples', exact: true })).toHaveCount(0);
        await expect(timeline.getByRole('button', { name: 'Refresh portfolio history' })).toHaveCount(0);
        await expect(timeline.getByLabel('Portfolio history filters')).toHaveCount(0);
        await expect(
            timeline.getByRole('button', { name: 'Create target draft' }),
        ).toHaveCount(0);
        await timeline
            .getByRole('button', { name: 'Bars', exact: true })
            .click();
        await expect(timeline.getByLabel('Shape bar archive')).toBeVisible();
        await timeline
            .getByRole('button', { name: 'Staircase', exact: true })
            .click();
        await expect(
            timeline.getByRole('columnheader', { name: 'Cumulative' }),
        ).toBeVisible();
        assert.deepEqual(writes, []);
        assert.deepEqual(fixture.writes, []);
        assert.deepEqual(errors, []);
    },
);

test(
    'timeline remains readable at phone, laptop and desktop widths in dark and light themes',
    { timeout: 90000 },
    async (t) => {
        const { page, timeline, errors } = await setup(t);
        for (const theme of ['alpha', 'light']) {
            for (const width of [390, 768, 1280, 1920]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.mouse.move(0, 0);
                await page.evaluate(
                    (theme) =>
                        document.documentElement.setAttribute(
                            'data-theme',
                            theme === 'light'
                                ? 'terminal-light-soft'
                                : 'terminal-dark',
                        ),
                    theme,
                );
                await expect(timeline).toBeVisible();
                await expect(timeline).toHaveCSS(
                    'background-color',
                    theme === 'light'
                        ? 'rgb(215, 219, 214)'
                        : 'rgb(18, 21, 26)',
                );
                const bounds = await timeline.boundingBox();
                assert.ok(
                    bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
                    `${theme} ${width}: ${JSON.stringify(bounds)}`,
                );
                const metrics = await timeline.evaluate((el) => ({
                    width: el.clientWidth,
                    scroll: el.scrollWidth,
                }));
                assert.ok(
                    metrics.scroll <= metrics.width + 1,
                    `${theme} ${width}: page overflow ${JSON.stringify(metrics)}`,
                );
                const body = timeline.getByTestId('portfolio-timeline-content');
                const bodyBounds = await body.boundingBox();
                assert.ok(
                    bodyBounds.height >= 300,
                    'record content keeps usable vertical space',
                );
                for (const button of await timeline
                    .locator('button:visible')
                    .all()) {
                    const style = await button.evaluate((el) => ({
                        font: parseFloat(getComputedStyle(el).fontSize),
                        height: el.getBoundingClientRect().height,
                    }));
                    assert.ok(
                        style.font >= 12 && style.height >= 30,
                        JSON.stringify(style),
                    );
                }
                const row = timeline
                    .locator('table')
                    .first()
                    .locator('tbody tr')
                    .first();
                assert.ok(
                    parseFloat(
                        await row
                            .locator('td')
                            .first()
                            .evaluate((el) => getComputedStyle(el).fontSize),
                    ) >= 12,
                );
                await page.screenshot({
                    path: `/tmp/portfolio-timeline-${theme}-${width}.png`,
                });
            }
        }
        assert.deepEqual(errors, []);
    },
);

test(
    'older memo draft uses its own ID, and a failed evidence save never opens the workflow',
    { timeout: 90000 },
    async (t) => {
        const { page, timeline, writes, failSave, allowSave } = await setup(t);
        await timeline.getByLabel('Portfolio records').getByRole('button').filter({ hasText: '17 May 2026' }).click();
        await expect(
            timeline.getByRole('heading', { name: 'Saved conclusion old' }),
        ).toBeVisible();
        failSave();
        await timeline
            .getByRole('button', { name: 'Create target draft' })
            .click();
        await expect(timeline.getByRole('alert')).toContainText(
            'No target was created',
        );
        assert.equal(writes[0].memo_job_id, 'intelligence:old.json');
        assert.equal(
            await page.evaluate(() =>
                localStorage.getItem('alpha-edge-portfolio-memo'),
            ),
            null,
        );
        allowSave();
        await timeline
            .getByRole('button', { name: 'Create target draft' })
            .click();
        await expect(timeline).toHaveCount(0);
        const state = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('alpha-edge-portfolio-memo')),
        );
        assert.equal(state.jobId, 'intelligence:old.json');
        assert.equal(state.runId, 'old.json');
        assert.equal(state.summary.assetClassTargets[0].target_pct, 60);
    },
);

test(
    'unavailable Intelligence leaves saved approvals visible without a page-wide banner',
    { timeout: 90000 },
    async (t) => {
        const { page, timeline, failArchive, fixture, writes } = await setup(t);
        failArchive();
        await timeline.getByRole('button', { name: 'Back to shape' }).click();
        const failedRequest = page.waitForResponse(response => response.url().includes('/council/portfolio-memos') && response.status() === 503);
        await page.getByRole('button', { name: 'Timeline', exact: true }).click();
        await failedRequest;
        await expect(timeline.getByText('Intelligence memos could not be loaded', { exact: false })).toHaveCount(0);
        await expect(
            timeline.getByRole('heading', { name: 'Approved v4', exact: true }),
        ).toBeVisible();
        assert.deepEqual(writes, []);
        assert.deepEqual(fixture.writes, []);
    },
);

test('Timeline keeps the portfolio toolbar and returns without resetting the live view', { timeout: 60000 }, async t => {
    const { page, timeline, errors, fixture } = await setup(t);
    const overview = page.getByTestId('portfolio-overview');
    const toolbar = overview.locator('[class*="toolbar"]').first();
    await expect(toolbar.getByRole('button')).toHaveCount(7);
    await expect(toolbar.getByRole('button', { name: 'Timeline', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbar.getByRole('button', { name: 'Shape', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(overview.getByText('Portfolio value', { exact: true })).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'Cumulative', exact: true }).click();
    await expect(timeline).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await toolbar.getByRole('button', { name: 'Compare', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(timeline).toBeVisible();
    await timeline.getByRole('button', { name: 'Back to shape' }).click();
    await expect(timeline).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Cumulative', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbar.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await toolbar.getByRole('button', { name: 'Timeline', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(timeline).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await toolbar.getByRole('button', { name: 'Timeline', exact: true }).click();
    await toolbar.getByRole('button', { name: 'History', exact: true }).click();
    await expect(timeline).toHaveCount(0);
    await expect(overview.getByRole('region', { name: 'Approved shape history comparison' })).toBeVisible();
    await toolbar.getByRole('button', { name: 'Timeline', exact: true }).click();
    await timeline.getByRole('button', { name: 'Back to shape' }).click();
    await expect(overview.getByRole('region', { name: 'Approved shape history comparison' })).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.writes, []);
});

test('Timeline toggles off from the toolbar and preserves the previous view on desktop and mobile', { timeout: 60000 }, async t => {
    const { page, timeline, errors, fixture } = await setup(t);
    const overview = page.getByTestId('portfolio-overview');
    const toolbar = overview.locator('[class*="toolbar"]').first();
    const toggle = toolbar.getByRole('button', { name: 'Timeline', exact: true });
    const compare = toolbar.getByRole('button', { name: 'Compare', exact: true });
    const history = toolbar.getByRole('button', { name: 'History', exact: true });

    await toggle.click();
    await expect(timeline).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(compare).toHaveAttribute('aria-pressed', 'false');
    await expect(overview.getByRole('img', { name: 'Approved portfolio shape', exact: true })).toBeVisible();
    await expect(overview.getByRole('img', { name: 'Current holdings allocation', exact: true })).toHaveCount(0);

    await toolbar.getByRole('button', { name: 'Cumulative', exact: true }).click();
    await compare.click();
    for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (let cycle = 0; cycle < 2; cycle++) {
            await toggle.click();
            await expect(timeline).toBeVisible();
            await expect(toggle).toHaveAttribute('aria-pressed', 'true');
            await expect(toggle).toHaveClass(/viewButtonActive/);
            await toggle.click();
            await expect(timeline).toHaveCount(0);
            await expect(toggle).toHaveAttribute('aria-pressed', 'false');
            await expect(toggle).not.toHaveClass(/viewButtonActive/);
            await expect(toolbar.getByRole('button', { name: 'Cumulative', exact: true })).toHaveAttribute('aria-pressed', 'true');
            await expect(compare).toHaveAttribute('aria-pressed', 'true');
        }
    }

    await history.click();
    await toggle.click();
    await expect(timeline).toBeVisible();
    await toggle.focus();
    await toggle.press('Enter');
    await expect(timeline).toHaveCount(0);
    await expect(history).toHaveAttribute('aria-pressed', 'true');
    await expect(overview.getByRole('region', { name: 'Approved shape history comparison' })).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.writes, []);
});

test('snapshot selection keeps its preceding record visible, including the last record and resizing', { timeout: 90000 }, async t => {
    const { page, timeline, errors, fixture } = await setup(t, 1366, { extraRecords: 12 });
    const rail = timeline.getByLabel('Portfolio records');
    const records = rail.getByRole('button');
    const count = await records.count();
    assert.ok(count > 12);
    const anchored = () => rail.evaluate(track => {
        const selected = track.querySelector('[aria-pressed="true"]');
        const previous = selected.previousElementSibling;
        const bounds = track.getBoundingClientRect();
        const current = selected.getBoundingClientRect();
        const before = previous?.getBoundingClientRect();
        return {
            fits: current.left >= bounds.left - 1 && current.right <= bounds.right + 1,
            reserved: before ? Math.abs(before.left - bounds.left) < 1 && before.right <= current.left : track.scrollLeft === 0,
        };
    });
    for (const width of [1366, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const index of [2, 5, count - 1, count - 2, 1, 0]) {
            await records.nth(index).click();
            await expect(records.nth(index)).toHaveAttribute('aria-pressed', 'true');
            await expect.poll(anchored).toEqual({ fits: true, reserved: true });
            if (index > 1) {
                await records.nth(index - 1).click();
                await expect(records.nth(index - 1)).toHaveAttribute('aria-pressed', 'true');
                await expect.poll(anchored).toEqual({ fits: true, reserved: true });
            }
        }
        await records.nth(5).click();
        await expect.poll(anchored).toEqual({ fits: true, reserved: true });
        await page.screenshot({ path: `/tmp/portfolio-timeline-reserved-${width}.png` });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.writes, []);
});
