const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');

async function setup(t) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await require('./fixtures/browser-access.cjs').mockBrowserAccess(page);
    await page.addInitScript(showPositionBucketRows => {
        localStorage.setItem('terminal-positions-visibility:demo', JSON.stringify({
            showPositionBucketRows, showStockStats: true, showGroupStats: true, showQ1Stats: true,
        }));
    }, true);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3312/#/positions');
    await expect(page.locator('tr.positions-stock-row').first()).toBeVisible();
    return { page, errors };
}

const rows = (page, group) => page.locator(`tr[data-risk-group="${group}"]`);

test('group brackets span every visible class and stock, shortening on collapse', { timeout: 120000 }, async t => {
    const { page, errors } = await setup(t);
    for (const group of ['full_q1', 'partial_q1', 'q1_exempt']) {
        const members = rows(page, group);
        await expect(members.first()).toHaveAttribute('data-risk-start', 'true');
        await expect(members.last()).toHaveAttribute('data-risk-end', 'true');
        assert.ok(await members.count() > 2);
        const structure = await members.evaluateAll(nodes => nodes.map(node => ({
            first: node.hasAttribute('data-risk-start'), last: node.hasAttribute('data-risk-end'),
            previousGroup: node.previousElementSibling?.getAttribute('data-risk-group'),
            border: getComputedStyle(node.firstElementChild, '::after').borderLeftWidth,
        })));
        assert.equal(structure.filter(row => row.first).length, 1);
        assert.equal(structure.filter(row => row.last).length, 1);
        assert.ok(structure.every(row => row.border === '2px'));
        assert.ok(structure.slice(1).every(row => row.previousGroup === group));
        const count = await members.count();
        await members.first().locator('td').first().click();
        await expect(members).toHaveCount(1);
        await expect(members.first()).toHaveAttribute('data-risk-end', 'true');
        await members.first().locator('td').first().click();
        await expect(members).toHaveCount(count);
    }
    await rows(page, 'full_q1').first().locator('td').first().click();
    await rows(page, 'partial_q1').first().hover();
    const stock = page.locator('tr.positions-stock-row[data-risk-group="partial_q1"]').first();
    await expect.poll(() => stock.evaluate(el => getComputedStyle(el).getPropertyValue('--position-row-opacity'))).toBe('0.1');
    assert.equal(await stock.evaluate(el => getComputedStyle(el).opacity), '1');
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/group-brackets-defensive.png' });
    assert.deepEqual(errors, []);
});

test('brackets coexist with stock highlights, themes, sorting and pinned mobile cells', { timeout: 120000 }, async t => {
    const { page, errors } = await setup(t);
    const northern = page.locator('tr.positions-stock-row').filter({ hasText: 'Evolution Mining' });
    await expect(northern).toHaveClass(/is-outperforming/);
    const original = await northern.evaluate(el => ({ height: el.getBoundingClientRect().height, padding: getComputedStyle(el.firstElementChild).paddingLeft }));
    await page.locator('.positions-grid th').filter({ hasText: 'CLASS %' }).click();
    await expect(rows(page, 'full_q1').last()).toHaveAttribute('data-risk-end', 'true');
    mkdirSync('test-results', { recursive: true });
    for (const [theme, width] of [['terminal-dark', 1440], ['terminal-light-soft', 1440], ['terminal-dark', 1280], ['terminal-dark', 650]]) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        await page.setViewportSize({ width, height: 1000 });
        const cell = northern.locator('td').first();
        const style = await cell.evaluate(el => ({
            position: getComputedStyle(el).position, shadow: getComputedStyle(el.parentElement).boxShadow,
            rail: getComputedStyle(el, '::after').borderLeftWidth, pointerEvents: getComputedStyle(el, '::after').pointerEvents,
            padding: getComputedStyle(el).paddingLeft,
            railInset: getComputedStyle(el, '::after').left,
            contentMargin: getComputedStyle(el.firstElementChild).marginInlineStart,
            contentInset: el.firstElementChild.getBoundingClientRect().left - el.getBoundingClientRect().left,
        }));
        assert.equal(style.rail, '2px');
        assert.equal(style.railInset, '8px');
        assert.equal(style.contentMargin, '12px');
        assert.ok(style.contentInset >= 16, 'name content stays clear of the inset bracket');
        assert.equal(style.pointerEvents, 'none');
        assert.notEqual(style.shadow, 'none');
        assert.equal(await northern.evaluate(el => el.getBoundingClientRect().height), original.height);
        if (width === 650) {
            assert.equal(style.position, 'sticky');
            await page.locator('.position-grid-scroll').evaluate(el => el.scrollLeft = 200);
            assert.equal(await cell.evaluate(el => getComputedStyle(el).position), 'sticky');
        } else assert.equal(style.padding, original.padding);
        await page.screenshot({ path: `test-results/group-brackets-${theme}-${width}.png` });
    }
    assert.deepEqual(errors, []);
});

test('hiding risk headings removes their brackets as well', { timeout: 120000 }, async t => {
    const { page, errors } = await setup(t);
    await page.getByTestId('positions-view-menu-trigger').click();
    await page.getByRole('checkbox', { name: 'Q1 sections', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-risk-group]')).toHaveCount(0);
    assert.deepEqual(errors, []);
});
