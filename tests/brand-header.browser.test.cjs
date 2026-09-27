const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

for (const width of [1920, 1366, 390]) {
    test(`brand chip fits the header at ${width}px in both themes`, { timeout: 60000 }, async t => {
        const browser = await chromium.launch();
        t.after(() => browser.close());
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed');
            localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ layout: { left: 'open', right: 'open' } }));
            localStorage.setItem('alpha-edge-theme', 'terminal-dark');
        });
        await page.goto(`${base}/#/positions`, { waitUntil: 'domcontentloaded' });
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            if (theme === 'terminal-light-soft') {
                if (width >= 1024) {
                    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
                } else {
                    await page.evaluate(() => {
                        document.documentElement.dataset.theme = 'terminal-light-soft';
                        document.documentElement.classList.add('light');
                    });
                }
            }
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            const brand = page.locator('.terminal-brand');
            await expect(brand).toBeVisible();
            await expect(brand).toHaveCSS('height', width < 1024 ? '38px' : '46px');
            await expect(brand).toHaveCSS('gap', '4px');
            await expect(brand).toHaveCSS('border-top-left-radius', '18px');
            await expect(brand).toHaveCSS('border-top-right-radius', '10px');
            await expect(brand).toHaveCSS('border-top-color', 'rgba(127, 128, 128, 0.3)');
            await expect(brand).toHaveCSS('box-shadow', 'rgba(114, 114, 114, 0.25) 0px 0px 3px 1px inset');
            const wordmark = brand.locator('.terminal-brand-wordmark');
            await expect(wordmark).toHaveCSS('color', theme === 'terminal-dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
            await expect(wordmark).toHaveCSS('font-size', '14px');
            await expect(wordmark).toHaveCSS('font-weight', '400');
            await expect(wordmark).toHaveCSS('text-decoration-thickness', '1.2px');
            await expect(wordmark).toHaveCSS('-webkit-text-stroke-width', '0px');
            await brand.locator('img').evaluate(img => img.decode());
            const geometry = await brand.evaluate(el => {
                const box = el.getBoundingClientRect();
                const header = el.closest('header').getBoundingClientRect();
                const img = el.querySelector('img').getBoundingClientRect();
                const word = el.querySelector('.terminal-brand-wordmark').getBoundingClientRect();
                return { box: box.toJSON(), header: header.toJSON(), img: img.toJSON(), word: word.toJSON() };
            });
            const { box, header, img, word } = geometry;
            assert.ok(box.top >= header.top && box.bottom <= header.bottom, 'chip fits within header');
            assert.ok(img.top >= box.top && img.bottom <= box.bottom, 'icon fits within chip');
            if (width >= 1024) {
                assert.ok(word.left >= img.right && word.right <= box.right, 'wordmark fits beside icon');
                const nav = await page.getByRole('navigation', { name: 'Primary navigation' }).boundingBox();
                assert.ok(nav.x >= box.right || nav.y >= box.bottom, 'brand must not overlap either navigation layout');
            } else await expect(brand.locator('.terminal-brand-wordmark')).toBeHidden();
            mkdirSync('/tmp/alpha-edge-brand', { recursive: true });
            await page.locator('.terminal-unified-header').screenshot({ path: `/tmp/alpha-edge-brand/header-${width}-${theme}.png` });
        }
        assert.deepEqual(errors, []);
    });
}

test('wordmark follows live theme changes and cuts through with the exact header surface', { timeout: 60000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed');
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.terminal-brand-wordmark')).toBeVisible();
    const colours = [];
    for (const theme of ['terminal-dark', 'terminal-light-soft', 'terminal-dark']) {
        colours.push(await page.locator('.terminal-brand-wordmark').evaluate((el, theme) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.classList.toggle('light', theme === 'terminal-light-soft');
            const style = getComputedStyle(el);
            const header = getComputedStyle(el.closest('header'));
            return { text: style.color, strike: style.textDecorationColor, surface: header.backgroundColor };
        }, theme));
        const current = colours.at(-1);
        assert.equal(current.text, theme === 'terminal-dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)', `${theme}: pure white or black lettering`);
        assert.equal(current.strike, current.surface, `${theme}: opaque strike matches the actual header background`);
    }
    assert.notEqual(colours[0].text, colours[1].text, 'text changes with the theme');
    assert.notEqual(colours[0].strike, colours[1].strike, 'strike changes with the surface');
    assert.deepEqual(colours[0], colours[2], 'switching back restores both colours');
});
