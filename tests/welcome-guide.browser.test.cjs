const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const base = process.env.WELCOME_GUIDE_BASE_URL || 'http://127.0.0.1:3312';
const key = 'alpha-edge:welcome-guide:v1:demo';

async function setup(t, { width = 1366, height = 900, theme = 'terminal-dark' } = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
        const request = route.request();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !request.url().endsWith('/sizing/allocations')) {
            writes.push(new URL(request.url()).pathname);
            return route.abort();
        }
        return route.continue();
    });
    await page.addInitScript(theme => localStorage.setItem('alpha-edge-theme', theme), theme);
    const setTheme = () => page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    return { page, errors, writes, setTheme };
}

test('first visit offers a skippable welcome and remembers it; Help reopens it', { timeout: 120000 }, async t => {
    const { page, errors, writes } = await setup(t);
    await page.goto(`${base}/#/positions`);
    const welcome = page.getByRole('dialog', { name: 'Welcome to Alpha Edge' });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByText('Hi there!', { exact: true })).toBeVisible();
    await expect(welcome).toContainText('Alpha Edge is designed as a modern Investment Advisory application, to help resolve the toughest decisions in portfolio construction and maintenance.');
    await expect(welcome).toContainText('read-only demo');
    await expect(welcome.getByRole('button', { name: 'Show me around' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(welcome).not.toBeVisible();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), 'dismissed');
    await expect(page.getByTestId('header-help')).toBeFocused();
    await page.reload();
    await expect(page.locator('.terminal-unified-header')).toBeVisible();
    await expect(welcome).not.toBeVisible();
    await page.getByTestId('header-help').click();
    await page.getByRole('button', { name: 'Guided tour', exact: true }).click();
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Explore on my own' }).click();
    await expect(page.getByTestId('help-tab')).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
});

test('tour navigates the real workspace, preserves rails and never executes a command', { timeout: 120000 }, async t => {
    const { page, errors, writes } = await setup(t);
    await page.goto(`${base}/#/positions`);
    const welcome = page.getByRole('dialog', { name: 'Welcome to Alpha Edge' });
    await expect(welcome).toBeVisible();
    const rails = () => page.locator('[data-testid="shell-left-rail"], [data-testid="shell-right-rail"]').evaluateAll(nodes => nodes.map(n => n.style.width));
    const before = await rails();
    await welcome.getByRole('button', { name: 'Show me around' }).click();
    const guide = page.getByRole('region', { name: 'Getting started guide' });
    for (const tab of ['portfolio', 'analysis', 'positions', 'alerts', 'markets', 'system', 'history']) {
        await expect(page).toHaveURL(new RegExp(`#/${tab}$`));
        await expect(guide).toBeVisible();
        await expect(guide.getByRole('heading')).toBeFocused();
        await expect(page.getByTestId(`main-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
        assert.deepEqual(await rails(), before);
        if (tab !== 'history') await guide.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await guide.getByRole('button', { name: 'Previous guide step' }).click();
    await expect(page).toHaveURL(/#\/system$/);
    await guide.getByRole('button', { name: 'Next', exact: true }).click();
    await guide.getByRole('button', { name: 'Finish tour' }).click();
    await expect(guide).not.toBeVisible();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), 'completed');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
});

test('deep links are uninterrupted and manual navigation keeps the guide honest', { timeout: 120000 }, async t => {
    const { page, errors } = await setup(t);
    await page.goto(`${base}/#/help/analysis`);
    await expect(page.getByTestId('help-article-analysis')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Welcome to Alpha Edge' })).not.toBeVisible();
    await page.getByRole('button', { name: 'Guided tour', exact: true }).click();
    await page.getByRole('button', { name: 'Show me around' }).click();
    const guide = page.getByRole('region', { name: 'Getting started guide' });
    await page.getByTestId('main-tab-alerts').click();
    await expect(guide).toContainText('Connect the information you rely on');
    await page.goBack();
    await expect(page).toHaveURL(/#\/portfolio$/);
    await expect(guide).toContainText('Start with constructing your portfolio');
    await page.getByTestId('main-tab-news').click();
    await expect(guide).not.toBeVisible();
    await page.getByTestId('main-tab-portfolio').click();
    await expect(guide).not.toBeVisible();
    assert.deepEqual(errors, []);
});

test('demo invitation is independent of private preferences and tolerates unavailable guide storage', { timeout: 120000 }, async t => {
    const { page, errors, writes } = await setup(t);
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge:welcome-guide:v1:legacy', 'completed');
        localStorage.setItem('alpha-edge:welcome-guide:v1:owner', 'completed');
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) {
            if (key === 'alpha-edge:welcome-guide:v1:demo') throw new DOMException('Storage unavailable', 'SecurityError');
            return get.call(this, key);
        };
        Storage.prototype.setItem = function(key, value) {
            if (key === 'alpha-edge:welcome-guide:v1:demo') throw new DOMException('Storage unavailable', 'SecurityError');
            return set.call(this, key, value);
        };
    });
    await page.goto(`${base}/#/positions`);
    await expect(page.getByRole('dialog', { name: 'Welcome to Alpha Edge' })).toBeVisible();
    await page.getByRole('button', { name: 'Show me around' }).click();
    const guide = page.getByRole('region', { name: 'Getting started guide' });
    await expect(guide).toBeVisible();
    await guide.getByRole('button', { name: 'Close guide' }).click();
    await expect(guide).not.toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
});

for (const [width, height, theme] of [[1366, 900, 'terminal-dark'], [1366, 900, 'terminal-light-soft'], [768, 900, 'terminal-dark'], [390, 844, 'terminal-dark'], [390, 844, 'terminal-light-soft'], [320, 568, 'terminal-dark']]) {
    test(`welcome and guide fit ${width}px ${theme}`, { timeout: 120000 }, async t => {
        const { page, errors, setTheme } = await setup(t, { width, height, theme });
        await page.goto(`${base}/#/positions`);
        const welcome = page.getByRole('dialog', { name: 'Welcome to Alpha Edge' });
        await expect(welcome).toBeVisible();
        await setTheme();
        const inspect = locator => locator.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, overflow: el.scrollWidth > el.clientWidth + 1 };
        });
        let box = await inspect(welcome);
        assert.ok(box.left >= 0 && box.right <= box.width && box.top >= 0 && box.bottom <= box.height && !box.overflow, JSON.stringify(box));
        const cards = await welcome.locator('ol > li').evaluateAll(nodes => nodes.map(node => {
            const style = getComputedStyle(node);
            return ['Top', 'Right', 'Bottom', 'Left'].every(side => style[`border${side}Width`] === '1px' && style[`border${side}Style`] === 'solid');
        }));
        assert.deepEqual(cards, [true, true, true], 'Each welcome section should have its own complete border');
        if (width >= 768) {
            assert.ok((box.right - box.left) / (box.bottom - box.top) > 1.4, 'Desktop welcome should be landscape');
            const tops = await welcome.locator('ol > li').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
            assert.ok(tops.every(top => Math.abs(top - tops[0]) < 1), 'Welcome sections should sit side by side');
        }
        await page.screenshot({ path: `/tmp/alpha-edge-welcome-${width}-${theme}.png` });
        await welcome.getByRole('button', { name: 'Show me around' }).click();
        const guide = page.getByRole('region', { name: 'Getting started guide' });
        await expect(guide).toBeVisible();
        box = await inspect(guide);
        assert.ok(box.left >= 0 && box.right <= box.width + 1 && !box.overflow, JSON.stringify(box));
        assert.ok(await page.locator('.terminal-page-content').evaluate(el => el.clientHeight >= 150));
        await expect(guide.getByRole('button', { name: 'Next', exact: true })).toBeInViewport();
        await page.screenshot({ path: `/tmp/alpha-edge-guide-${width}-${theme}.png` });
        await guide.getByRole('button', { name: 'Close guide' }).click();
        await expect(guide).not.toBeVisible();
        assert.deepEqual(errors, []);
    });
}
