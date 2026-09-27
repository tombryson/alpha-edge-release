const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

const classes = [
    ['ENERGY_PRODUCERS', 'Energy Producers', 33.7], ['GOLD_MINERS', 'Gold Miners', 22.1],
    ['PHARMA_BIOTECH', 'Pharma & Biotech', 14.3], ['SILVER_MINERS', 'Silver Miners', 8.9],
    ['RARE_EARTHS', 'Rare Earths & Critical Minerals', 3.3], ['HEALTHCARE_SERVICES', 'Healthcare Services', 2.9],
    ['BASE_METALS', 'Base Metals Miners', 2.8], ['COPPER_MINERS', 'Copper Miners', 2.3],
    ['STAPLES', 'Staples', 1.6], ['INSURANCE', 'Insurance', 1.5], ['SEMICONDUCTORS', 'Semiconductors', 1.3],
    ['DEFENCE', 'Defence', 1.1], ['LITHIUM_MINERS', 'Lithium Miners', 1], ['URANIUM_MINERS', 'Uranium Miners', 0.9],
    ['CIVIL_AEROSPACE', 'Civil Aerospace', 0.8], ['TECHNOLOGY', 'Technology', 0.6],
    ['DATACENTRES', 'Datacentres', 0.5], ['CASH', 'Cash / reserve', 0.4],
];
const rows = classes.map(([asset_class, display_name, weight_pct], display_order) => ({
    asset_class, display_name, weight_pct, display_order, value: weight_pct * 100,
    invested_value: weight_pct * 100, invested_weight_pct: weight_pct, sleeve_cash_value: 0,
}));

async function setup(t, options = {}) {
    mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage(options);
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({
        activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' },
    })));
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/portfolio-mix/current')) return route.fulfill({ json: { total_value: 10000, rows } });
        if (path.endsWith('/portfolio-mix/approved')) return route.fulfill({ json: {
            snapshot: { id: 4, status: 'APPROVED' }, rows: rows.map((row, i) => ({ ...row,
                weight_pct: row.weight_pct + (i === 0 ? -0.2 : i === 1 ? 0.2 : 0),
            })),
        } });
        return route.fallback();
    });
    await page.goto(`${base}/#/positions`);
    const footer = page.getByTestId('positions-shape-footer');
    await expect(footer.getByRole('listitem')).toHaveCount(18);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    return { page, footer, fixture, errors };
}

test('comparison footer keeps 18 classes scrollable, values separate and controls aligned at narrow widths', { timeout: 120000 }, async t => {
    const { page, footer, fixture, errors } = await setup(t);
    for (const width of [320, 390, 600, 740, 820, 1024, 1280, 1920]) {
        await page.setViewportSize({ width, height: 844 });
        await waitForRailLayout(page);
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            const strip = footer.getByRole('list');
            const first = footer.getByRole('listitem').first();
            await first.focus();
            await expect(first.locator('[class*="target"]')).toHaveCSS('opacity', '1');
            for (const unit of ['percentages', 'dollars']) {
                await footer.getByRole('button', { name: `Show shape as ${unit}` }).click();
                await first.hover();
                await expect(first.locator('[class*="target"]')).toHaveCSS('opacity', '1');
                const fields = await first.locator('[class*="label"], [class*="target"], [class*="current"]').evaluateAll(nodes => nodes.map(el => ({
                    box: el.getBoundingClientRect().toJSON(), scroll: el.scrollWidth, width: el.clientWidth,
                })));
                assert.ok(fields[0].box.width >= 12, 'class label retains space beside both values');
                assert.ok(fields[0].box.right <= fields[1].box.left && fields[1].box.right <= fields[2].box.left, 'labels and numbers cannot overlap');
                assert.ok(fields.slice(1).every(f => f.scroll <= f.width + 1), 'both values fit in either unit');
            }
            const geometry = await footer.evaluate(el => ({
                box: el.getBoundingClientRect().toJSON(), width: el.clientWidth, scroll: el.scrollWidth,
                strip: el.firstElementChild.getBoundingClientRect().toJSON(),
                controls: el.lastElementChild.getBoundingClientRect().toJSON(),
                buttons: [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect().toJSON()),
            }));
            assert.ok(geometry.scroll <= geometry.width, 'only the class strip scrolls, not the footer');
            assert.ok(geometry.box.x >= 0 && geometry.box.right <= width && geometry.box.bottom <= 844);
            assert.ok(Math.abs(geometry.box.bottom - 844) <= 2, 'footer stays at the bottom of the viewport');
            assert.ok(geometry.box.height <= 90, 'narrow footer remains compact');
            assert.ok(geometry.buttons.every(b => b.top >= geometry.box.top && b.bottom <= geometry.box.bottom && b.left >= geometry.box.left && b.right <= geometry.box.right));
            const centers = geometry.buttons.map(b => b.top + b.height / 2);
            assert.ok(Math.max(...centers) - Math.min(...centers) <= 1, 'Compare and unit buttons share their vertical centre');
            if (geometry.box.width - 26 <= 768) {
                assert.ok(geometry.controls.top >= geometry.strip.bottom, 'controls get their own row when the panel is narrow');
                assert.equal((await first.boundingBox()).width, 200);
            }
            if (width === 1920) assert.equal(geometry.box.height, 48, 'wide desktop keeps its original height');
            const beforeScroll = await footer.boundingBox();
            await strip.evaluate(el => el.scrollLeft = el.scrollWidth);
            const last = footer.getByRole('listitem').last();
            // scrollWidth/clientWidth round to integers; flex edges can remain fractional.
            await expect(last).toBeInViewport({ ratio: 0.99 });
            const end = await last.evaluate(el => {
                const list = el.closest('[role="list"]');
                const clip = list.getBoundingClientRect();
                return {
                    left: Math.max(0, clip.left + list.clientLeft),
                    right: Math.min(innerWidth, clip.left + list.clientLeft + list.clientWidth),
                    top: Math.max(0, clip.top + list.clientTop),
                    bottom: Math.min(innerHeight, clip.top + list.clientTop + list.clientHeight),
                    boxes: [el, ...el.querySelectorAll('[class*="label"], [class*="target"], [class*="current"]')]
                        .map(node => node.getBoundingClientRect().toJSON()),
                };
            });
            assert.ok(end.boxes.every(box => box.left >= end.left - 1 && box.right <= end.right + 1
                && box.top >= end.top - 1 && box.bottom <= end.bottom + 1),
            `last class and its values fit within one CSS pixel at ${width}px (${theme}): ${JSON.stringify(end)}`);
            assert.deepEqual(await footer.boundingBox(), beforeScroll, 'class scrolling cannot move or resize the footer');
            await last.focus();
            await expect(last.locator('[class*="target"]')).toHaveCSS('opacity', '1');
            await strip.evaluate(el => el.scrollLeft = 0);
            await footer.screenshot({ path: `test-results/shape-footer-${width}-${theme}.png` });
        }
    }
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('comparison and unit toggles work on touch, persist on reload and keep the footer docked', { timeout: 60000 }, async t => {
    const { page, footer, fixture, errors } = await setup(t, { hasTouch: true, isMobile: true });
    await page.setViewportSize({ width: 390, height: 700 });
    const compare = footer.getByRole('button', { name: /Compar/ });
    const active = await compare.getAttribute('aria-pressed');
    await compare.tap();
    await expect(compare).toHaveAttribute('aria-pressed', active === 'true' ? 'false' : 'true');
    await footer.getByRole('button', { name: 'Show shape as dollars' }).tap();
    await expect(footer.getByRole('listitem').first().locator('[class*="current"]')).toHaveText('$3.4K');
    await page.reload();
    await expect(footer.getByRole('button', { name: 'Show shape as dollars' })).toHaveAttribute('aria-pressed', 'true');
    await expect(compare).toHaveAttribute('aria-pressed', active === 'true' ? 'false' : 'true');
    const before = await footer.boundingBox();
    await page.locator('.position-grid-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
    assert.deepEqual(await footer.boundingBox(), before);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});
