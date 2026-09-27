const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

test('outperformers share the core ETF row treatment, with gold instead of blue', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await require('./fixtures/browser-access.cjs').mockBrowserAccess(page);
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-theme', 'terminal-dark');
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ layout: { left: 'open', right: 'open' } }));
    });
    await page.goto(`${base}/#/positions`);
    const row = name => page.locator('tr.positions-stock-row').filter({ hasText: name });
    const outperformer = row('Evolution Mining');
    const core = page.locator('tr.positions-stock-row.is-core-etf').first();
    await expect(row('Northern Star Resources')).not.toHaveClass(/is-outperforming/);
    await expect(row('BHP Group')).not.toHaveClass(/is-outperforming/);
    await expect(row('Evolution Mining')).toHaveClass(/is-outperforming/);
    await expect(row('Newmont')).not.toHaveClass(/is-outperforming/);
    await expect(core).not.toHaveClass(/is-outperforming/);

    for (const width of [1440, 650]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.classList.toggle('light', theme === 'terminal-light-soft');
            }, theme);
            await page.mouse.move(0, 0);
            const expected = await outperformer.evaluate(el => {
                const probe = document.createElement('div');
                probe.style.cssText = `background-color: color-mix(in srgb, var(--positions-outperform-accent) 4%, transparent);
                    box-shadow: inset 0 0 5px 1px color-mix(in srgb, var(--positions-outperform-accent) 8%, transparent)`;
                probe.style.setProperty('--positions-outperform-accent', getComputedStyle(el).getPropertyValue('--positions-outperform-accent'));
                document.body.append(probe);
                const style = getComputedStyle(probe);
                const result = { background: style.backgroundColor, shadow: style.boxShadow };
                probe.style.boxShadow = 'inset 0 1px 0 color-mix(in oklab, var(--primary) 18%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--primary) 14%, transparent)';
                result.hover = getComputedStyle(probe).boxShadow;
                probe.remove();
                return result;
            });
            await expect(outperformer).toHaveCSS('background-color', expected.background);
            await expect(outperformer).toHaveCSS('box-shadow', expected.shadow);
            await expect(outperformer).toHaveCSS('border-radius', await core.evaluate(el => getComputedStyle(el).borderRadius));
            for (const cell of [outperformer.locator('td').first(), outperformer.locator('td').nth(1), outperformer.locator('td').last()]) {
                await expect(cell).toHaveCSS('box-shadow', 'none');
            }
            const geometry = await outperformer.evaluate(el => {
                const highlighted = el.getBoundingClientRect().height;
                el.classList.remove('is-outperforming');
                const plain = el.getBoundingClientRect().height;
                el.classList.add('is-outperforming');
                return { highlighted, plain };
            });
            assert.equal(geometry.highlighted, geometry.plain, 'highlight does not change row height');
            if (width === 650) {
                const pinned = await outperformer.locator('td').first().evaluate(el => {
                    const style = getComputedStyle(el);
                    return { background: style.backgroundImage, position: style.position };
                });
                assert.equal(pinned.position, 'sticky');
                assert.ok(pinned.background.includes('linear-gradient'), 'pinned name keeps its opaque backing');
                assert.ok(pinned.background.includes(expected.background), 'pinned name carries the same gold tint');
            }
            await page.screenshot({ path: `/tmp/alpha-edge-outperform-${width}-${theme}.png` });
            await outperformer.hover();
            await expect(outperformer.locator('td').first()).toHaveCSS('box-shadow', expected.hover);
            await core.hover();
            await expect(core.locator('td').first()).toHaveCSS('box-shadow', expected.hover);
        }
    }
});
