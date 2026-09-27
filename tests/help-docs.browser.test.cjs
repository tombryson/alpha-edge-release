const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, viewport) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#/help`);
    await expect(page.getByTestId('help-tab')).toBeVisible();
    return { page, fixture, errors };
}

test('Help retains clickable contents, diagrams, all guides and browser history', { timeout: 90000 }, async t => {
    const { page, fixture, errors } = await setup(t, { width: 1600, height: 1000 });
    const contents = page.getByRole('navigation', { name: 'Overview contents' });
    for (const name of ['Current positions', 'Research ledger', 'Portfolio shape', 'Market gates']) {
        await expect(contents.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
    }
    await contents.getByRole('button', { name: 'Open Market gates', exact: true }).click();
    await expect(page).toHaveURL(/#\/help\/markets$/);
    const diagram = page.getByTestId('help-market-equity-diagram');
    await expect(diagram.locator('[data-help-path-node]')).toHaveCount(3);
    await expect(diagram.locator('[data-help-path-connector]')).toHaveCount(3);
    for (const name of ['Equity', 'Company', 'Outperform']) await expect(diagram).toContainText(name);
    assert.equal(await diagram.locator('[data-help-path-connector]').first().evaluate(el => getComputedStyle(el).height), '2px');
    await page.goBack();
    await expect(page.getByTestId('help-article-overview')).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId('help-article-markets')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('help-article-overview')).toBeVisible();
    for (const [label, id] of [['Positions', 'positions'], ['Analysis', 'analysis'], ['Portfolio', 'portfolio'], ['ETFs', 'etfs'], ['Markets', 'markets'], ['Alerts', 'alerts'], ['System', 'system'], ['News', 'news'], ['History', 'history']]) {
        await page.getByRole('navigation', { name: 'Help contents', exact: true }).getByRole('button', { name: label, exact: true }).click();
        await expect(page.getByTestId(`help-article-${id}`)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#/help/${id}$`));
    }
    await page.reload();
    await expect(page.getByTestId('help-article-history')).toBeVisible();
    await page.goto(`${base}/#/help/positions`);
    await page.getByTestId('help-article-positions').getByRole('link', { name: 'History / Activity' }).click();
    await expect(page.getByTestId('help-article-history')).toBeVisible();
    await page.screenshot({ path: '/tmp/alpha-edge-help-desktop.png' });
    assert.deepEqual(errors, []);
    assert.equal(fixture.writes.length, 0);
});

test('mobile Help keeps readable content and contains diagram overflow locally', { timeout: 90000 }, async t => {
    const { page, fixture, errors } = await setup(t, { width: 390, height: 844 });
    await page.goto(`${base}/#/help/markets`);
    await expect(page.getByTestId('help-article-markets')).toBeVisible();
    const geometry = await page.getByTestId('help-tab').evaluate(el => {
        const area = el.querySelector('[data-testid="help-scroll-area"]');
        const paragraph = area.querySelector('p');
        return { viewport: innerWidth, width: el.getBoundingClientRect().width, content: area.getBoundingClientRect().width, overflow: el.scrollWidth > el.clientWidth + 1, font: parseFloat(getComputedStyle(paragraph).fontSize), line: parseFloat(getComputedStyle(paragraph).lineHeight) };
    });
    assert.ok(geometry.width <= geometry.viewport);
    assert.ok(geometry.content > 300, JSON.stringify(geometry));
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.font >= 13 && geometry.line >= 20);
    const history = page.getByRole('navigation', { name: 'Help contents', exact: true }).getByRole('button', { name: 'History', exact: true });
    await history.scrollIntoViewIfNeeded();
    await history.click();
    await expect(page.getByTestId('help-article-history')).toBeVisible();
    await page.screenshot({ path: '/tmp/alpha-edge-help-mobile.png' });
    assert.deepEqual(errors, []);
    assert.equal(fixture.writes.length, 0);
});

test('Ideal weight Help explains opt-in limits without implying automatic trades', { timeout: 90000 }, async t => {
    const { page, fixture, errors } = await setup(t, { width: 1440, height: 900 });
    await page.goto(`${base}/#/help/positions`);
    const article = page.getByTestId('help-article-positions');
    const policy = article.locator('#optional-weight-management');
    await expect(policy).toContainText('shield beside Ideal wt');
    await expect(policy).toContainText('Off by default');
    await expect(policy).toContainText('removes the old individual allocation ceiling');
    await expect(policy).toContainText('150%');
    await expect(policy).toContainText('125%');
    await expect(policy).toContainText('0.25%');
    await policy.getByRole('heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/alpha-edge-weight-policy-help.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await policy.getByRole('heading').scrollIntoViewIfNeeded();
    assert.equal(await page.getByTestId('help-tab').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: '/tmp/alpha-edge-weight-policy-help-mobile.png' });
    await page.goto(`${base}/#/help/etfs`);
    await page.getByTestId('help-article-etfs').getByRole('link', { name: 'Positions', exact: true }).click();
    await expect(article).toBeVisible();
    assert.deepEqual(errors, []);
    assert.equal(fixture.writes.length, 0);
});
