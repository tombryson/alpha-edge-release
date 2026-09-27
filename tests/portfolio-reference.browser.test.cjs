const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const allocation = (asset_class, display_name, weight_pct) => ({
    asset_class, display_name, weight_pct, value: weight_pct * 100, display_order: 1,
    governed_by_q1: true, invested_weight_pct: weight_pct, invested_value: weight_pct * 100,
    sleeve_cash_weight_pct: 0, sleeve_cash_value: 0,
});
const approvedRows = [allocation('GOLD_MINERS', 'Gold Miners', 60), allocation('SILVER_MINERS', 'Silver Miners', 30), allocation('CASH', 'Cash / reserve', 10)];
const heldRows = [allocation('GOLD_MINERS', 'Gold Miners', 20), allocation('TECHNOLOGY', 'Technology', 70), allocation('CASH', 'Cash / reserve', 10)];

async function setup(t, options = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/portfolio-mix/current')) return options.failedCurrent
            ? route.fulfill({ status: 503, json: { error: 'Holdings unavailable' } })
            : route.fulfill({ json: { as_of: options.stale ? '2020-01-01T00:00:00Z' : new Date().toISOString(), total_value: 10000, rows: heldRows } });
        if (path.endsWith('/portfolio-mix/approved')) return options.failedApproved
            ? route.fulfill({ status: 503, json: { error: 'Approval unavailable' } })
            : route.fulfill({ json: { snapshot: options.noApproved ? null : { id: 4, status: 'APPROVED', approved_at: '2026-09-01T00:00:00Z' }, rows: options.noApproved ? [] : options.approvedRows || approvedRows } });
        if (path.endsWith('/portfolio-history') && options.historyState) return options.historyState === 'failed'
            ? route.fulfill({ status: 503, json: { error: 'History unavailable' } })
            : route.fulfill({ json: { entries: [], kind: 'shape' } });
        if (options.riskMode && path.endsWith('/portfolio-overlay-summary')) return route.fulfill({ json: {
            portfolio_value: 10000, portfolio_risk: { mode: options.riskMode },
            asset_classes: approvedRows.map(row => ({ asset_class: row.asset_class, strategic_weight_pct: row.weight_pct,
                actual_invested_pct: row.asset_class === 'GOLD_MINERS' ? 20 : 0,
                allowed_invested_pct: row.asset_class === 'GOLD_MINERS' ? 25 : 0 })),
        } });
        return route.fallback();
    });
    await page.goto(`${base}/#/portfolio`);
    const overview = page.getByTestId('portfolio-overview');
    await expect(overview.locator('[data-asset-class]').first()).toBeVisible();
    return { page, overview, summary: page.getByTestId('sleeve-summary') };
}

test('navigation starts with approved only; Compare adds holdings without changing the reference', { timeout: 90000 }, async t => {
    const { page, overview } = await setup(t);
    const compare = overview.getByRole('button', { name: 'Compare', exact: true });
    const approved = overview.getByRole('img', { name: 'Approved portfolio shape', exact: true });
    const held = overview.getByRole('img', { name: 'Current holdings allocation', exact: true });
    const gold = overview.locator('[data-asset-class="GOLDMINERS"]');
    await expect(compare).toHaveAttribute('aria-pressed', 'false');
    await expect(approved).toBeVisible();
    await expect(held).toHaveCount(0);
    const goldSegment = approved.locator('[title="Gold Miners: 60.0%"]');
    assert.equal(await goldSegment.evaluate(el => el.style.width), '60%');
    await expect(gold.locator('[data-mobile-label="Approved"]')).toHaveText('60.0%');
    await expect(gold.locator('[data-mobile-label="Approved per $1K"]')).toHaveText('$600');
    await expect(gold.locator('[data-mobile-label="Held"]')).toHaveCount(0);
    await expect(gold.locator('[title="Held: 20.0%"]')).toHaveCount(0);
    const approvedBarWidth = await gold.locator('[class*="shapeFill"]').evaluate(el => el.style.width);

    await compare.click();
    await expect(held).toBeVisible();
    await expect(held.locator('[title="Gold Miners: 20.0%"]')).toBeVisible();
    await expect(gold.locator('[data-mobile-label="Held"]')).toHaveText('20.0%');
    await expect(gold.locator('[title="Held: 20.0%"]')).toBeVisible();
    assert.equal(await gold.locator('[class*="shapeFill"]').evaluate(el => el.style.width), approvedBarWidth);
    await compare.click();
    await expect(approved).toBeVisible();
    await expect(held).toHaveCount(0);
    await overview.getByRole('button', { name: 'Cumulative', exact: true }).click();
    await expect(overview.locator('[data-asset-class="SILVERMINERS"] [data-mobile-label="Approved cumulative"]')).toHaveText('90.0%');
    await overview.getByRole('button', { name: 'Radial', exact: true }).click();
    const radial = overview.getByRole('region', { name: 'Radial portfolio shape', exact: true });
    await expect(radial.locator('[class*="targetLine"]')).toHaveCount(0);
    await expect(radial.locator('[class*="readout"]')).toContainText('Approved60.0%');
    await expect(radial.locator('[class*="readout"]')).not.toContainText('Held');
    const approvedPath = await radial.locator('[class*="heldLine"]').getAttribute('d');
    await compare.click();
    await expect(radial.locator('[class*="targetLine"]')).toHaveCount(1);
    await expect(radial.locator('[class*="readout"]')).toContainText('Held20.0%');
    assert.equal(await radial.locator('[class*="heldLine"]').getAttribute('d'), approvedPath);
    await overview.getByRole('button', { name: 'Difference', exact: true }).click();
    await expect(compare).toHaveAttribute('aria-pressed', 'true');
    await compare.click();
    await expect(overview.getByRole('button', { name: 'Shape', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(approved).toBeVisible();
    await expect(held).toHaveCount(0);
    await compare.click();
    await page.evaluate(() => { location.hash = '/positions'; });
    await expect(overview).toHaveCount(0);
    await page.evaluate(() => { location.hash = '/portfolio'; });
    await expect(approved).toBeVisible();
    await expect(compare).toHaveAttribute('aria-pressed', 'false');
    await expect(held).toHaveCount(0);
    await page.reload();
    await expect(approved).toBeVisible();
    await expect(compare).toHaveAttribute('aria-pressed', 'false');
    await expect(held).toHaveCount(0);
    for (const width of [1600, 1366, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await waitForRailLayout(page);
        await expect(approved).toBeInViewport();
        await expect(gold.locator('[data-mobile-label="Approved"]')).toBeVisible();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: `/tmp/portfolio-approved-default-${width}.png` });
    }
});

test('approved shape leads both overviews, including unfilled classes and off-shape holdings', { timeout: 90000 }, async t => {
    const { page, overview, summary } = await setup(t);
    await expect(overview.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(overview.getByRole('img', { name: 'Approved portfolio shape', exact: true })).toBeVisible();
    await expect(overview.getByRole('img', { name: 'Current holdings allocation', exact: true })).toHaveCount(0);
    await overview.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(overview.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.deepEqual(await overview.locator('div[role="img"]').evaluateAll(nodes => nodes.map(el => el.getAttribute('aria-label'))), ['Approved portfolio shape', 'Current holdings allocation']);
    assert.deepEqual(await overview.locator('[data-asset-class]').evaluateAll(nodes => nodes.map(el => el.dataset.assetClass)), ['GOLDMINERS', 'SILVERMINERS', 'CASH', 'TECHNOLOGY']);
    const silver = overview.locator('[data-asset-class="SILVERMINERS"]');
    await expect(silver.locator('[data-mobile-label="Approved"]')).toHaveText('30.0%');
    await expect(silver.locator('[data-mobile-label="Held"]')).toHaveText('0.0%');
    await expect(overview.locator('[data-asset-class="TECHNOLOGY"]')).toContainText('Outside approved shape');
    await expect(summary.getByRole('button', { name: 'Show current portfolio shape' })).toHaveAttribute('aria-pressed', 'true');
    await expect(summary.getByRole('button', { name: 'Compare with current allocation' })).toHaveAttribute('aria-pressed', 'false');
    await expect(summary.getByRole('img', { name: 'Portfolio summary', exact: true })).toContainText('60.0%');
    await expect(summary.locator('[data-ring="current"]')).toHaveCount(0);
    await expect(summary.locator('span[title="Silver Miners"]').locator('..')).toContainText('30.0%');
    await expect(summary.locator('span[title="Technology"]')).toHaveCount(0);
    await summary.getByRole('button', { name: 'Compare with current allocation' }).click();
    await expect(summary.getByRole('button', { name: 'Compare with current allocation' })).toHaveAttribute('aria-pressed', 'true');
    await expect(summary.locator('span[title="Technology"]')).toBeVisible();
    await expect(summary.getByRole('status')).toHaveText('Approved v4 · 01/09/2026');
    const ribbons = overview.getByRole('img', { name: 'Approved portfolio shape', exact: true }).locator('..');
    await expect(ribbons.locator('[class*="ribbonLabel"]')).toHaveText(['Approved', 'Current holdings']);
    await expect(ribbons.locator('[class*="ribbonCaption"]')).toHaveCount(0);
    await expect(summary.getByText('Outer approved · inner held', { exact: true })).toHaveCount(0);
    await expect(summary.locator('[data-ring="target"][data-asset-class="SILVERMINERS"]')).toHaveAttribute('opacity', '1');
    await expect(summary.locator('[data-ring="current"][data-asset-class="GOLDMINERS"]')).toHaveAttribute('opacity', '0.65');
    await overview.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(overview.getByRole('img', { name: 'Approved portfolio shape', exact: true })).toBeVisible();
    await expect(overview.getByRole('img', { name: 'Current holdings allocation', exact: true })).toHaveCount(0);
    await overview.getByRole('button', { name: 'Compare', exact: true }).click();
    await overview.getByRole('button', { name: 'Cumulative', exact: true }).click();
    await expect(silver.locator('[data-mobile-label="Approved cumulative"]')).toHaveText('90.0%');
    await overview.getByRole('button', { name: 'Radial', exact: true }).click();
    await expect(overview.getByRole('img', { name: /Portfolio weights by asset class/ })).toContainText('Shaded colours are approved allocations');
    await overview.getByRole('button', { name: 'Shape', exact: true }).click();
    for (const width of [1600, 1366, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await waitForRailLayout(page);
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await expect(silver.locator('[data-mobile-label="Approved"]')).toBeVisible();
            if (width >= 1024) {
                const name = summary.locator('span[title="Gold Miners"]');
                assert.ok((await name.boundingBox()).width >= 30, 'comparison legend reserves visible space for class names');
            }
            await page.screenshot({ path: `/tmp/portfolio-reference-${width}-${theme}.png` });
        }
    }
    await page.getByRole('button', { name: 'Open portfolio tools' }).click();
    await expect(summary.getByRole('button', { name: 'Show current portfolio shape' })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: '/tmp/portfolio-reference-mobile-summary.png' });
});

test('comparison controls describe the selected state and both ribbons fit at desktop and mobile sizes', { timeout: 90000 }, async t => {
    const { page, overview } = await setup(t);
    const compareHoldings = overview.getByRole('button', { name: 'Compare', exact: true });
    await compareHoldings.click();
    const compareHistory = overview.getByRole('button', { name: 'History', exact: true });
    const history = overview.getByRole('region', { name: 'Approved shape history comparison' });
    const back = history.getByRole('button', { name: 'Back to portfolio' });
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await waitForRailLayout(page);
        await expect(compareHoldings).toHaveAttribute('aria-pressed', 'true');
        await expect(compareHoldings).toHaveClass(/viewButtonActive/);
        await expect(compareHistory).toHaveAttribute('aria-pressed', 'false');
        await expect(compareHistory).not.toHaveClass(/viewButtonActive/);
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            const bars = await overview.locator('div[role="img"]').evaluateAll(nodes => nodes.map(node => {
                const rect = node.getBoundingClientRect();
                const label = node.previousElementSibling;
                const labelRect = label.getBoundingClientRect();
                return {
                    label: label.textContent, height: rect.height, bottom: rect.bottom,
                    labelFits: labelRect.bottom <= rect.top && labelRect.top >= 0,
                    widthFits: node.scrollWidth <= node.clientWidth + 1,
                    textFits: [...node.querySelectorAll('span')].every(span => {
                        const bounds = span.getBoundingClientRect();
                        return bounds.top >= rect.top && bounds.bottom <= rect.bottom;
                    }),
                };
            }));
            assert.deepEqual(bars.map(bar => bar.label), ['Approved', 'Current holdings']);
            assert.equal(bars[0].height, bars[1].height, 'both ribbons reserve the same text height');
            assert.ok(bars.every(bar => bar.labelFits && bar.widthFits && bar.textFits && bar.bottom <= viewport.height), `${viewport.width}px ${theme}: ${JSON.stringify(bars)}`);
        }

        await compareHoldings.click();
        await expect(compareHoldings).toHaveAttribute('aria-pressed', 'false');
        await expect(compareHoldings).not.toHaveClass(/viewButtonActive/);
        await expect(back).toHaveCount(0);
        await expect(overview.getByRole('img', { name: 'Approved portfolio shape', exact: true })).toBeVisible();
        await expect(overview.getByRole('img', { name: 'Current holdings allocation', exact: true })).toHaveCount(0);
        await compareHistory.click();
        await expect(history).toBeVisible();
        await expect(back).toBeInViewport();
        await page.screenshot({ path: `/tmp/portfolio-history-back-${viewport.width}.png` });
        await expect(compareHistory).toHaveAttribute('aria-pressed', 'true');
        await expect(compareHistory).toHaveClass(/viewButtonActive/);
        await expect(overview.getByRole('button', { name: 'Current portfolio', exact: true })).toHaveCount(0);
        await expect(compareHoldings).toBeVisible();
        await expect(compareHoldings).toBeEnabled();
        await expect(compareHoldings).toHaveAttribute('aria-pressed', 'false');
        await expect(compareHoldings).not.toHaveClass(/viewButtonActive/);
        for (const view of ['Cumulative', 'Difference', 'Radial', 'Shape']) {
            const button = overview.getByRole('button', { name: view, exact: true });
            await button.click();
            await expect(button).toHaveAttribute('aria-pressed', 'true');
            await expect(compareHistory).toHaveAttribute('aria-pressed', 'true');
            await expect(history).toBeVisible();
            await compareHoldings.click();
            await expect(history).toHaveCount(0);
            await expect(compareHoldings).toHaveAttribute('aria-pressed', 'true');
            await expect(compareHoldings).toHaveClass(/viewButtonActive/);
            await expect(compareHistory).toHaveAttribute('aria-pressed', 'false');
            await expect(compareHistory).not.toHaveClass(/viewButtonActive/);
            await expect(button).toHaveAttribute('aria-pressed', 'true');
            await compareHistory.click();
            await expect(history).toBeVisible();
            await expect(compareHoldings).toHaveAttribute('aria-pressed', 'false');
            await expect(compareHoldings).not.toHaveClass(/viewButtonActive/);
            await expect(back).toBeVisible();
            await back.click();
            await expect(history).toHaveCount(0);
            await expect(compareHoldings).toHaveAttribute('aria-pressed', 'true');
            await expect(compareHistory).toHaveAttribute('aria-pressed', 'false');
            await expect(button).toHaveAttribute('aria-pressed', 'true');
            await compareHistory.click();
        }
        await compareHistory.click();
        await expect(history).toHaveCount(0);
        await expect(compareHistory).toHaveAttribute('aria-pressed', 'false');
        await expect(compareHistory).not.toHaveClass(/viewButtonActive/);
        await expect(compareHoldings).toHaveAttribute('aria-pressed', 'true');
        await compareHoldings.click();
        await expect(compareHoldings).toHaveAttribute('aria-pressed', 'false');
        await compareHistory.click();
        await expect(history).toBeVisible();
        await back.click();
        await expect(history).toHaveCount(0);
        await expect(compareHoldings).toHaveAttribute('aria-pressed', 'false');
        await compareHoldings.click();
        await expect(compareHoldings).toHaveAttribute('aria-pressed', 'true');
        if (viewport.width < 768) {
            const gold = overview.locator('[data-asset-class="GOLDMINERS"]');
            const held = gold.locator('[data-mobile-label="Held"]');
            await held.scrollIntoViewIfNeeded();
            await expect(held).toBeInViewport();
            const scroll = overview.locator('[data-portfolio-scroll]');
            assert.ok((await scroll.boundingBox()).height > 100, 'the table must not collapse beneath fixed header content');
            await compareHoldings.scrollIntoViewIfNeeded();
            await expect(compareHoldings).toBeInViewport();
        }
        await page.screenshot({ path: `/tmp/portfolio-comparison-fixed-${viewport.width}.png` });
    }
});

test('portfolio toolbar geometry stays fixed across analytic and comparison modes', { timeout: 90000 }, async t => {
    const { page, overview } = await setup(t);
    const toolbar = overview.locator('[class*="toolbar"]').first();
    const compareHoldings = overview.getByRole('button', { name: 'Compare', exact: true });
    const compareHistory = overview.getByRole('button', { name: 'History', exact: true });
    const measure = async () => toolbar.evaluate(element => {
        const parent = element.getBoundingClientRect();
        return {
            height: parent.height,
            buttons: [...element.querySelectorAll('button')].map(button => {
                const rect = button.getBoundingClientRect();
                return { label: button.textContent.trim(), x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height };
            }),
        };
    });
    for (const width of [1600, 1366, 1100, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await waitForRailLayout(page);
        await overview.getByRole('button', { name: 'Shape', exact: true }).click();
        const baseline = await measure();
        const unchanged = async mode => {
            const current = await measure();
            assert.equal(current.height, baseline.height, `${width}px ${mode}: toolbar height changed`);
            assert.deepEqual(current.buttons, baseline.buttons, `${width}px ${mode}: controls moved or resized`);
        };
        for (const mode of ['Shape', 'Cumulative', 'Difference', 'Radial']) {
            await overview.getByRole('button', { name: mode, exact: true }).click();
            await unchanged(mode);
            await compareHoldings.click();
            await unchanged(`${mode}, comparison toggled`);
            await compareHoldings.click();
            await compareHistory.click();
            await unchanged(`${mode}, history`);
            await overview.getByRole('button', { name: 'Back to portfolio' }).click();
            await unchanged(`${mode}, back`);
        }
        await overview.getByRole('button', { name: 'Shape', exact: true }).click();
        await page.screenshot({ path: `/tmp/portfolio-stable-toolbar-${width}.png` });
    }
});

for (const historyState of ['empty', 'failed']) test(`Back leaves ${historyState} history without changing the live comparison`, { timeout: 60000 }, async t => {
    const { overview } = await setup(t, { historyState });
    await overview.getByRole('button', { name: 'History', exact: true }).click();
    const history = overview.getByRole('region', { name: 'Approved shape history comparison' });
    if (historyState === 'empty') await expect(history.getByText('No approved shapes are available.')).toBeVisible();
    else await expect(history.getByRole('alert')).toBeVisible();
    const back = history.getByRole('button', { name: 'Back to portfolio' });
    await expect(back).toBeEnabled();
    await back.focus();
    await back.press('Enter');
    await expect(history).toHaveCount(0);
    await expect(overview.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(overview.getByRole('button', { name: 'History', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(overview.getByRole('img', { name: 'Approved portfolio shape', exact: true })).toBeVisible();
});

for (const scenario of ['stale', 'failedCurrent']) test(`approved weights survive ${scenario} holdings without fabricated differences`, { timeout: 60000 }, async t => {
    const { overview, summary } = await setup(t, { [scenario]: true });
    await overview.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(overview.getByRole('img', { name: 'Approved portfolio shape', exact: true })).toBeVisible();
    const silver = overview.locator('[data-asset-class="SILVERMINERS"]');
    await expect(silver.locator('[data-mobile-label="Approved"]')).toHaveText('30.0%');
    await expect(silver.locator('[data-mobile-label="Held"]')).toHaveText('—');
    await expect(silver.locator('[data-mobile-label="Difference"]')).toHaveText('—');
    await expect(summary.locator('[data-ring="target"]')).toHaveCount(3);
    await expect(summary.locator('[data-ring="current"]')).toHaveCount(0);
    await summary.getByRole('button', { name: 'Compare with current allocation' }).click();
    await expect(summary.locator('[data-ring="target"]')).toHaveCount(3);
    await expect(summary.locator('[data-ring="current"]')).toHaveCount(0);
    await overview.getByRole('button', { name: 'Radial', exact: true }).click();
    await expect(overview.getByRole('img', { name: /Portfolio weights by asset class/ })).toBeVisible();
    await expect(overview.getByText(/Saved approved weights remain visible/)).toBeVisible();
});

for (const scenario of ['noApproved', 'failedApproved']) test(`${scenario} never substitutes holdings for the approved shape`, { timeout: 60000 }, async t => {
    const { overview, summary } = await setup(t, { [scenario]: true });
    await expect(overview.getByRole('img', { name: 'Approved portfolio shape', exact: true })).toHaveCount(0);
    await expect(overview.getByRole('button', { name: 'Compare', exact: true })).toBeDisabled();
    await expect(overview.locator('[data-mobile-label="Approved"]').first()).toHaveText('—');
    await expect(summary.getByRole('img', { name: 'Portfolio summary', exact: true })).toHaveCount(0);
    await expect(summary.getByRole('button', { name: 'Compare with current allocation' })).toBeDisabled();
    await expect(summary.getByText(scenario === 'noApproved' ? 'No approved shape' : 'Approved shape unavailable', { exact: true })).toBeVisible();
});

test('single ring preserves saved percentages without normalising partial shapes or showing dollars', { timeout: 60000 }, async t => {
    const { page, summary } = await setup(t, { approvedRows: [allocation('GOLD_MINERS', 'Gold Miners', 40), allocation('SILVER_MINERS', 'Silver Miners', 20)] });
    const chart = summary.getByRole('img', { name: 'Portfolio summary', exact: true });
    await expect(chart).toContainText('40.0%');
    assert.doesNotMatch(await summary.innerText(), /\$/);
    await expect(summary.locator('span[title="Silver Miners"]').locator('..')).toContainText('20.0%');
    await summary.getByRole('button', { name: 'Compare with current allocation' }).click();
    await expect(summary.locator('[data-ring="current"]')).toHaveCount(3);
    await summary.getByRole('button', { name: 'Show current portfolio shape' }).click();
    await expect(chart).toContainText('40.0%');
    await expect(summary.locator('[data-ring="current"]')).toHaveCount(0);
    await page.reload();
    await expect(summary.getByRole('button', { name: 'Show current portfolio shape' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chart).toContainText('40.0%');
});

for (const riskMode of ['Q3_THROTTLE', 'Q4_CRISIS']) test(`${riskMode} does not replace approved weights with permitted capacity`, { timeout: 60000 }, async t => {
    const { overview } = await setup(t, { riskMode });
    await overview.getByRole('button', { name: 'Compare', exact: true }).click();
    const gold = overview.locator('[data-asset-class="GOLDMINERS"]');
    await expect(gold.locator('[data-mobile-label="Approved"]')).toHaveText('60.0%');
    await expect(gold.locator('[data-mobile-label="Held"]')).toHaveText('20.0%');
    await expect(gold).toContainText(riskMode === 'Q3_THROTTLE' ? '5.0pp permitted' : 'new deployment suspended');
});
