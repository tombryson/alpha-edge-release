const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const fixture = await mockContextPanel(page);
    const ledger = fixture.ledger();
    Object.assign(ledger.summary, { actual_etf_value: 4266, effective_target_value: 3708 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.endsWith('/etf/allocation-ledger')
        ? route.fulfill({ json: ledger }) : route.fallback());
    return { page, fixture, ledger, errors };
}

test('ETF summary has a distinct surface and hierarchy with aligned insets and compact held/target context', { timeout: 90000 }, async t => {
    const { page, fixture, errors } = await setup(t);
    for (const width of [1280, 1440, 1920, 960, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/#/positions`);
        if (width < 1024) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        const summary = page.getByRole('region', { name: 'ETF allocations', exact: true });
        await expect(summary).toBeVisible();
        await waitForRailLayout(page);
        const bounds = await summary.boundingBox();
        assert.equal(bounds.height, width < 1024 ? 97 : 89);
        const header = await page.getByTestId('context-panel').locator('header').evaluate(el => {
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return { x: box.x, bottom: box.bottom, inset: parseFloat(style.paddingLeft), background: style.backgroundColor };
        });
        const availableWidth = await page.getByTestId('context-panel-scroll').evaluate(el => el.clientWidth);
        const scroll = page.getByTestId('context-panel-scroll');
        await expect(scroll).toHaveCSS('scrollbar-gutter', 'auto');
        assert.ok(await scroll.evaluate(el => Math.abs(el.getBoundingClientRect().width - el.clientWidth) <= 1), 'short ETF lists have no reserved right-hand scrollbar strip');
        assert.ok(Math.abs(bounds.x - header.x) <= 1, 'the surface must start at the same left edge as the tab bar');
        assert.ok(Math.abs(bounds.width - availableWidth) <= 1, 'the surface spans the scroll area, not an inset rectangle');
        assert.ok(Math.abs(bounds.y - header.bottom) <= 1, 'no exterior gap may detach the summary from its header');
        assert.notEqual(await summary.evaluate(el => getComputedStyle(el).backgroundColor), header.background, 'summary has its own theme-aware surface');
        const heading = summary.getByRole('heading', { name: 'ETF allocations', exact: true });
        await expect(heading).toBeVisible();
        await expect(heading).toHaveCSS('font-size', '14px');
        await expect(heading).toHaveCSS('font-weight', '600');
        await expect(summary.getByText('$4,266', { exact: true })).toHaveCSS('font-size', '18px');
        await expect(summary.getByText('$3,708', { exact: true })).toHaveCSS('font-size', '14px');
        await expect(summary.getByText('+$558', { exact: true })).toHaveCSS('font-size', '12px');
        await expect(summary.getByText('$4,266', { exact: true })).toBeVisible();
        await expect(summary.getByText('$3,708', { exact: true })).toBeVisible();
        await expect(summary.getByText('+$558', { exact: true })).toBeVisible();
        assert.doesNotMatch(await summary.innerText(), /Above ETF target|\d+ funds|\d+%/);
        const bar = summary.getByRole('img');
        const track = await bar.boundingBox();
        const marker = await bar.locator('i').boundingBox();
        assert.ok(Math.abs(track.x - bounds.x - header.inset) <= 1);
        assert.ok(Math.abs(track.width - (bounds.width - 2 * header.inset)) <= 1, 'the funding bar spans the padded inner width');
        assert.ok(bounds.y + bounds.height - marker.y - marker.height >= 6, 'the target tick must not touch the bottom edge');
        assert.ok(Math.abs((marker.x - track.x) / track.width - .8) < .01);
        assert.equal(marker.height, 10, 'the target tick extends above and below the funding line');
        await expect(bar.locator('span').first()).toHaveAttribute('style', 'width: 80%;');
        const excess = await bar.locator('span').last().boundingBox();
        assert.ok(Math.abs(excess.width / track.width - (4266 / 3708 - 1) * .8) < .01);
        for (const el of await summary.locator('button').all()) {
            const box = await el.boundingBox();
            assert.ok(box.x >= bounds.x + header.inset && box.x + box.width <= bounds.x + bounds.width - 4, 'view buttons retain an edge inset without shrinking their hit areas');
            assert.ok(box.y >= bounds.y + 4 && box.y + box.height <= bounds.y + bounds.height - 6);
        }
        const headingBox = await heading.boundingBox();
        const controlsBox = await summary.getByRole('group', { name: 'Allocation display' }).boundingBox();
        assert.ok(Math.abs(headingBox.x - header.x - header.inset) <= 1, 'summary and tab bar share their text inset');
        assert.ok(headingBox.x + headingBox.width + 2 <= controlsBox.x);
        assert.ok(Math.abs(headingBox.y + headingBox.height / 2 - controlsBox.y - controlsBox.height / 2) < 1);
        const amountsBox = await summary.locator('[class*="summaryAmountsRow"]').boundingBox();
        assert.ok(amountsBox.y >= controlsBox.y + controlsBox.height);
        assert.ok(track.y >= amountsBox.y + amountsBox.height + 7);
        await summary.getByRole('button', { name: 'Capital map', exact: true }).click();
        await expect(page.getByLabel('ETF capital map', { exact: true })).toBeVisible();
        await summary.getByRole('button', { name: 'Line fill', exact: true }).click();
        await expect(page.getByLabel('ETF line allocations', { exact: true })).toBeVisible();
        const trigger = summary.getByRole('button', { name: /^ETF allocation:/ });
        const detail = page.getByRole('dialog', { name: 'ETF allocation details', exact: true });
        if (width < 1024) await trigger.tap(); else await trigger.hover();
        await expect(detail).toBeVisible();
        await expect(detail.getByText('$4,266', { exact: true })).toBeVisible();
        await expect(detail.getByText('$3,708', { exact: true })).toBeVisible();
        const detailBounds = await detail.boundingBox();
        assert.ok(detailBounds.x >= 0 && detailBounds.x + detailBounds.width <= width, JSON.stringify({ width, detailBounds }));
        if (width >= 1024) { await detail.hover(); await expect(detail).toBeVisible(); }
        await page.keyboard.press('Escape');
        await expect(detail).toHaveCount(0);
        await page.getByTestId('context-panel').getByRole('tab', { name: 'ETFs', exact: true }).focus();
        await trigger.focus();
        await expect(detail).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(detail).toHaveCount(0);
        if (width < 1024) await page.getByRole('button', { name: 'Close Portfolio tools', exact: true }).click();
    }
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('funding summary distinguishes below, aligned, empty, zero and missing targets', { timeout: 90000 }, async t => {
    const { page, fixture, ledger, errors } = await setup(t);
    await page.goto(`${base}/#/positions`);
    for (const [actual, target, approved, text, direction, funded, excess, marker] of [
        [1500, 3000, true, '\u2212$1,500', 'below', 40, 0, '80%'],
        [3000, 3000, true, '$0', 'neutral', 80, 0, '80%'],
        [0, 3000, true, '\u2212$3,000', 'below', 0, 0, '80%'],
        [436, 0, true, '+$436', 'above', 0, 100, '0%'],
        [0, 0, true, '$0', 'neutral', 0, 0, '0%'],
        [436, 3000, false, '\u2014', 'neutral', 0, 0, null],
        [436, undefined, true, '\u2014', 'neutral', 0, 0, null],
    ]) {
        Object.assign(ledger.summary, { actual_etf_value: actual, effective_target_value: target, has_approved_shape: approved });
        await page.reload();
        const summary = page.getByRole('region', { name: 'ETF allocations', exact: true });
        const difference = summary.locator('[class*="summaryDifference"]');
        await expect(difference).toHaveText(text);
        await expect(difference).toHaveAttribute('data-direction', direction);
        await expect(summary.locator('[class*="summaryAmounts"]').last()).toContainText(actual.toLocaleString());
        const bar = summary.getByRole('img');
        await expect(bar.locator('span').first()).toHaveAttribute('style', `width: ${funded}%;`);
        await expect(bar.locator('span').last()).toHaveAttribute('style', `left: ${marker || '80%'}; width: ${excess}%;`);
        if (marker) await expect(bar.locator('i')).toHaveAttribute('style', `left: ${marker};`);
        else await expect(bar.locator('i')).toHaveCount(0);
        await summary.getByRole('button', { name: /^ETF allocation:/ }).focus();
        const detail = page.getByRole('dialog', { name: 'ETF allocation details', exact: true });
        await expect(detail).toBeVisible();
        if (marker === null) await expect(detail.getByText('Not set', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
    }
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('summary colours follow the theme and large held/target amounts and differences never truncate', { timeout: 90000 }, async t => {
    const { page, fixture, ledger } = await setup(t);
    Object.assign(ledger.summary, { actual_etf_value: 2234567, effective_target_value: 1000000 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/#/positions`);
    const summary = page.getByRole('region', { name: 'ETF allocations', exact: true });
    for (const theme of ['terminal-dark', 'terminal-light-soft']) {
        await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
        const header = page.getByTestId('context-panel').locator('header');
        const headerBackground = await header.evaluate(el => getComputedStyle(el).backgroundColor);
        assert.notEqual(await summary.evaluate(el => getComputedStyle(el).backgroundColor), headerBackground);
        const value = summary.getByText('+$1,234,567', { exact: true });
        await expect(value).toBeVisible();
        assert.ok(await value.evaluate(el => el.scrollWidth <= el.clientWidth));
        const bounds = await summary.boundingBox();
        const valueBox = await value.boundingBox();
        assert.ok(valueBox.x >= bounds.x && valueBox.x + valueBox.width <= bounds.x + bounds.width);
        for (const amount of ['$2,234,567', '$1,000,000']) {
            const text = summary.getByText(amount, { exact: true });
            await expect(text).toBeVisible();
            const box = await text.boundingBox();
            assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width);
            assert.ok(await text.evaluate(el => el.scrollWidth <= el.clientWidth));
            assert.ok(box.y + box.height <= valueBox.y, 'large differences wrap below the complete held/target pair');
        }
        assert.ok(bounds.height <= 136, 'seven-digit amounts may add two text lines, but never truncate or widen the sidebar');
        const colour = await value.evaluate(el => {
            const marker = document.createElement('span');
            marker.style.color = 'var(--destructive)';
            el.append(marker);
            const colour = getComputedStyle(marker).color;
            marker.remove();
            return colour;
        });
        await expect(value).toHaveCSS('color', colour);
        await summary.getByRole('button', { name: /^ETF allocation:/ }).hover();
        const detail = page.getByRole('dialog', { name: 'ETF allocation details', exact: true });
        await expect(detail).toBeVisible();
        await expect(detail.getByText('$2,234,567', { exact: true })).toBeVisible();
        await expect(detail.getByText('$1,000,000', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.mouse.move(0, 0);
    }
    assert.deepEqual(fixture.writes, []);
});
