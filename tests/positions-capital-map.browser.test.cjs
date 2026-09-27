const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';
const definitions = [
    ['GOLD_MINERS', 'Gold Miners', [['Northern Gold Resources', 6000], ['Gold Core Fund', 4000], ['Westland Mining', 2500], ['Aurora Gold', 1500], ['Central Gold', 1000], ['Small Gold Holding', 1]]],
    ['ENERGY_PRODUCERS', 'Energy Producers', [['Pacific Energy', 8500], ['Eastern Coal', 6000], ['Coastal Energy', 3000], ['Northern Gas', 1300]]],
    ['PHARMA_BIOTECH', 'Pharma & Biotech', [['Precision Therapeutics', 4000], ['New Horizon Biotech', 2600], ['Clinical Research Group', 900]]],
    ['SILVER_MINERS', 'Silver Miners', [['Silver Core Fund', 3000], ['Silver Plains', 700]]],
    ['COPPER_MINERS', 'Copper Miners', [['Copper Valley', 800], ['Southern Copper', 500]]],
    ['SEMICONDUCTORS', 'Semiconductors', [['Advanced Chip Systems', 1000], ['Memory Technologies', 250], ['Next Silicon', 200]]],
    ['UNASSIGNED', 'Unassigned', [['Unclassified Holding', 300], ['Zero Entitlement', 0]]],
];
const seed = definitions.flatMap(([code, className, names]) => names.map(([name, value]) => ({ code, className, name, value })))
    .map((row, i) => ({ ...row, id: i + 1, ticker: `S${i + 1}`, etf: row.name.includes('Fund'), gainLossPercent: i === 0 ? 12.34 : i === 1 ? -5.67 : i === 2 ? 0 : undefined }));
const totalHeld = seed.reduce((sum, row) => sum + row.value, 0);

async function setup(t, { viewport = { width: 1600, height: 1000 }, empty = false, actions = false, storageBlocked = false, holdings = seed } = {}) {
    mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport });
    const fixture = await mockContextPanel(page);
    if (storageBlocked) await page.addInitScript(() => {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (['alpha-edge:positions-presentation', 'alpha-edge:positions-map-layout', 'alpha-edge:positions-map-colour'].includes(key)) throw new Error('Isolated storage failure');
            return write.call(this, key, value);
        };
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const rows = empty ? [] : holdings;
    const heldValue = rows.reduce((sum, row) => sum + row.value, 0);
    const analysis = rows.map(row => ({ id: row.id, ticker: `ASX:${row.ticker}`, name: row.name,
        security_type: row.etf ? 'ETF' : 'STOCK', primary_asset_class: row.code, current_price: 10, is_watchlist: false }));
    analysis.push({ id: 1000, ticker: 'ASX:WATCH', name: 'Watchlist not held', security_type: 'STOCK', primary_asset_class: 'GOLD_MINERS', is_watchlist: true });
    await page.route('**/api/**/analysis', route => route.fulfill({ json: analysis }));
    await page.route('**/api/**/positions', route => route.fulfill({ json: [{ ticker: 'S1', position_state: 'BUY' }, { ticker: 'S2', position_state: 'SELL' }] }));
    await page.route('**/api/**/portfolio', route => route.fulfill({ json: { total_value: heldValue + 4000, cash_on_hand: 4000 } }));
    await page.route('**/api/**/statements/latest', route => route.fulfill({ json: {
        statement: { id: 1, statement_date: '2026-09-14', total_value_aud: heldValue + 4000, cash_aud: 4000 },
        holdings: rows.map(row => ({ id: row.id, statement_id: 1, ticker: row.ticker, exchange_prefix: 'ASX:', details: row.name,
            quantity: row.value === 0 ? 1 : row.value / 10, current_price: 10, cost_aud: row.value, value_aud: row.value, market_value: row.value, gain_loss_pct: row.gainLossPercent, cash_reserve: 0, currency: 'AUD' })),
    } }));
    await page.route('**/api/**/asset-classes', route => route.fulfill({ json: definitions.map(([code, display_name], i) => ({ code, asset_class_code: code, display_name, active: true, display_order: i, allow_grouping: true })) }));
    if (actions) await page.route('**/api/**/portfolio-overlay-summary', route => route.fulfill({ json: {
        total_portfolio_value: totalHeld + 4000, total_cash: 4000, asset_classes: [],
        active_event_id: 1, active_event_status: 'PENDING', available_headroom_value: 500,
    } }));
    await page.goto(`${base}/#/positions`);
    // The Next development badge is not part of the application surface.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const simple = page.getByRole('button', { name: 'Simple view', exact: true });
    await expect(simple).toBeVisible();
    await simple.click();
    const map = page.getByTestId('positions-capital-map');
    await expect(map).toBeVisible();
    await expect(map.getByRole('navigation', { name: 'Focus asset class' })).toHaveCount(0);
    if (!empty) await expect(map.locator('[data-map-holding]')).toHaveCount(rows.filter(row => row.value > 0).length);
    return { page, map, fixture, errors };
}

test('Simple maps the same held values with proportional areas and no financial writes', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t);
    await expect(page.locator('table.positions-grid')).toHaveCount(0);
    await expect(page.getByTestId('positions-view-menu-trigger')).toHaveCount(0);
    await expect(map).not.toContainText('Watchlist not held');
    const geometry = await map.locator('[data-map-holding]').evaluateAll(nodes => nodes.map(node => {
        const rect = node.querySelector('rect');
        return { id: Number(node.dataset.mapHolding), value: Number(node.dataset.value),
            area: (Number(rect.getAttribute('width')) + 2) * (Number(rect.getAttribute('height')) + 2) };
    }));
    assert.equal(geometry.reduce((sum, node) => sum + node.value, 0), totalHeld);
    const totalArea = geometry.reduce((sum, node) => sum + node.area, 0);
    for (const node of geometry) assert.ok(Math.abs(node.area / totalArea - node.value / totalHeld) < .003, `holding ${node.id} area must reflect its held value`);
    await expect(map.getByRole('button', { name: '1 without positive value', exact: true })).toBeVisible();
    await map.getByRole('button', { name: '1 without positive value', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Holdings without positive value' })).toContainText('Zero Entitlement');
    await page.keyboard.press('Escape');
    await map.locator('[data-map-holding="1"]').hover();
    await expect(map.getByLabel('Holding allocation details')).toContainText('Northern Gold Resources');
    await expect(map.getByLabel('Holding allocation details')).toContainText('$6,000');
    await map.screenshot({ path: 'test-results/positions-capital-map-desktop.png' });
    await page.getByRole('button', { name: 'Table view', exact: true }).click();
    await expect(map).toHaveCount(0);
    await expect(page.locator('tr.positions-stock-row').filter({ hasText: 'Northern Gold Resources' })).toBeVisible();
    await page.getByRole('button', { name: 'Simple view', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Simple view', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(map).toBeVisible();
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('class focus, tiny-holding search and keyboard selection preserve values and open the existing sidebar', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t);
    const tile = map.locator('[data-map-holding="6"]');
    const search = map.getByRole('searchbox', { name: 'Find a holding' });
    const before = await tile.boundingBox();
    await search.fill('small gold');
    await expect(map.getByRole('status')).toHaveText('1 / 1');
    await expect(map.getByLabel('Holding allocation details')).toContainText('Small Gold Holding');
    await expect(tile).toHaveAttribute('data-active', 'true');
    assert.deepEqual(await tile.boundingBox(), before, 'search highlights without rescaling allocations');
    await search.fill('asx:s1');
    await expect(map.getByRole('button', { name: 'Next matching holding' })).toBeEnabled();
    await map.getByRole('button', { name: 'Next matching holding' }).click();
    await expect(map.getByRole('status')).toContainText('2 /');
    await search.fill('no such holding');
    await expect(map.getByLabel('Holding allocation details')).toContainText('No matching holdings');
    await search.press('Escape');
    await map.locator('[data-map-holding="1"]').focus();
    await map.getByRole('button', { name: 'Focus Gold Miners from holding', exact: true }).click();
    await expect(map.locator('[data-map-holding]')).toHaveCount(6);
    await expect(map.getByRole('heading', { name: 'Gold Miners', exact: true })).toBeVisible();
    assert.equal(await map.locator('[data-map-holding]').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.dataset.value), 0)), 15001);
    await map.getByRole('button', { name: 'Show all asset classes', exact: true }).click();
    await expect(map.locator('[data-map-holding]')).toHaveCount(21);
    const first = map.locator('[data-map-holding="1"]');
    await first.focus();
    await expect(map.getByLabel('Holding allocation details')).toContainText('Northern Gold Resources');
    await first.press('Enter');
    const panel = page.getByTestId('context-panel');
    await expect(panel.getByRole('heading', { name: 'Northern Gold Resources', exact: true })).toBeVisible();
    await expect(panel.getByTestId('security-price-chart')).toHaveAttribute('data-symbol', 'ASX:S1');
    await page.evaluate(() => { location.hash = '/analysis'; });
    await expect(map).toHaveCount(0);
    await page.evaluate(() => { location.hash = '/positions'; });
    await expect(map).toBeVisible();
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('holding details show broker P/L and Positions trend for stocks and ETFs in both map layouts', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t);
    const details = map.getByLabel('Holding allocation details');
    const pl = details.locator('dl > div').filter({ hasText: 'P/L %' }).locator('dd');
    const trend = details.locator('dl > div').filter({ hasText: 'Trend' }).locator('dd');
    const colour = locator => locator.evaluate(el => getComputedStyle(el).color);
    const token = name => details.evaluate((el, name) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        el.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
    }, name);
    for (const layout of ['2D', '1D']) {
        await map.getByRole('button', { name: `${layout} capital map`, exact: true }).click();
        await map.locator('[data-map-holding="1"]').focus();
        await expect(pl).toHaveText('+12.34%');
        await expect(trend).toHaveText('Buy');
        assert.equal(await colour(pl), await token('--primary'));
        assert.equal(await colour(trend), await token('--primary'));
        await map.locator('[data-map-holding="2"]').focus();
        await expect(pl).toHaveText('-5.67%');
        await expect(trend).toHaveText('Sell');
        assert.equal(await colour(pl), await token('--destructive'));
        assert.equal(await colour(trend), await token('--destructive'));
        await map.locator('[data-map-holding="3"]').focus();
        await expect(pl).toHaveText('0.00%');
        await expect(trend).toHaveText('—');
        assert.equal(await colour(pl), await token('--muted-foreground'));
        await map.getByRole('searchbox', { name: 'Find a holding' }).fill('small gold');
        await expect(pl).toHaveText('—');
        await expect(trend).toHaveText('—');
        await map.getByRole('searchbox', { name: 'Find a holding' }).press('Escape');
    }
    await map.locator('[data-map-holding="1"]').focus();
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    assert.equal(await colour(pl), await token('--primary'));
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.ok(await details.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'bottom detail bar fits mobile');
        await expect(pl).toBeVisible();
        await expect(trend).toBeVisible();
    }
    await map.screenshot({ path: 'test-results/positions-capital-map-details-mobile.png' });
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('P/L colour toggle preserves geometry, class identity and readable labels across layouts and themes', { timeout: 90000 }, async t => {
    const returns = [-100, -50, -25, -5, 0, undefined, 5, 25, 50, 100];
    const { page, map, fixture, errors } = await setup(t, { holdings: seed.map((row, i) => ({ ...row, gainLossPercent: returns[i % returns.length] })) });
    const toggle = map.getByRole('button', { name: 'Colour by P/L', exact: true });
    const geometry = () => map.locator('[data-map-holding]').evaluateAll(nodes => nodes.map(el => {
        const rect = el.getBoundingClientRect();
        return { id: el.dataset.mapHolding, value: el.dataset.value, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const colours = () => map.locator('[data-map-holding]').evaluateAll(nodes => nodes.map(el => {
        const surface = el.querySelector('rect') || el;
        const content = el.querySelector('foreignObject > div') || el;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        const rgb = value => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        return { id: Number(el.dataset.mapHolding), background: rgb(getComputedStyle(surface)[surface === el ? 'backgroundColor' : 'fill']), foreground: rgb(getComputedStyle(content).color), themeBackground: rgb(getComputedStyle(el.closest('[data-testid="positions-capital-map"]')).backgroundColor) };
    }));
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    for (const layout of ['2D', '1D']) {
        await map.getByRole('button', { name: `${layout} capital map`, exact: true }).click();
        const before = await geometry();
        const classColours = await colours();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        assert.deepEqual(await geometry(), before, 'performance must not alter allocation sizes or ordering');
        for (const theme of ['dark', 'light']) {
            if (theme === 'light') await page.getByTitle('Switch to light mode', { exact: true }).click();
            const values = await colours();
            const fill = id => values.find(row => row.id === id).background;
            assert.deepEqual(fill(1), fill(2), 'loss colours saturate at -50%');
            assert.deepEqual(fill(9), fill(10), 'gain colours saturate at +50%');
            assert.deepEqual(fill(5), fill(6), 'zero and missing P/L are neutral');
            assert.deepEqual(fill(5), values.find(row => row.id === 5).themeBackground, 'zero and missing P/L use the active theme background');
            assert.ok(fill(2)[0] > fill(2)[1], 'losses are red');
            assert.ok(fill(9)[1] > fill(9)[0], 'gains are green');
            const hsl = rgb => {
                const [r, g, b] = rgb.map(v => v / 255);
                const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
                const lightness = (max + min) / 2;
                const hue = d === 0 ? 0 : 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
                return { hue, saturation: d === 0 ? 0 : d / (1 - Math.abs(2 * lightness - 1)), lightness };
            };
            for (const [ids, hue] of [[[4, 3, 2], 0], [[7, 8, 9], 135]]) {
                const shades = ids.map(id => hsl(fill(id)));
                for (const shade of shades) assert.ok(Math.abs(shade.hue - hue) <= 2, 'P/L hue stays fixed as its magnitude changes');
                for (let i = 1; i < shades.length; i++) {
                    assert.ok(shades[i].saturation > shades[i - 1].saturation, 'saturation grows with magnitude');
                    assert.ok(theme === 'dark' ? shades[i].lightness > shades[i - 1].lightness : shades[i].lightness < shades[i - 1].lightness, 'lightness changes monotonically');
                }
            }
            for (const pair of [[2, 3], [3, 4], [4, 5], [5, 7], [7, 8], [8, 9]]) assert.notDeepEqual(fill(pair[0]), fill(pair[1]), 'P/L magnitude changes intensity');
            for (const row of values) {
                const a = luminance(row.background), b = luminance(row.foreground);
                assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `holding ${row.id} text contrast in ${theme}`);
            }
            await map.locator('[data-map-holding="1"]').focus();
            assert.deepEqual((await colours()).find(row => row.id === 1).background, fill(1), 'focus keeps the encoded return colour');
            await expect(map.getByLabel('Holding allocation details')).toContainText('-100.00%');
            const classToken = await map.locator('[data-map-holding="1"]').evaluate(el => el.style.getPropertyValue('--class-colour'));
            await map.getByRole('button', { name: 'Focus Gold Miners from holding', exact: true }).click();
            assert.equal(await map.locator('[data-map-holding="1"]').evaluate(el => el.style.getPropertyValue('--class-colour')), classToken);
            assert.deepEqual((await colours()).find(row => row.id === 1).background, fill(1), 'class focus does not rebase the colour scale');
            await map.getByRole('button', { name: 'Show all asset classes', exact: true }).click();
            await map.screenshot({ path: `test-results/positions-capital-map-performance-${layout}-${theme}.png` });
        }
        await page.getByTitle('Switch to dark mode', { exact: true }).click();
        await toggle.click();
        await page.mouse.move(0, 0);
        await map.getByRole('searchbox', { name: 'Find a holding' }).focus();
        // Inspecting a holding can change its outline, not its canonical class token.
        assert.equal((await colours()).find(row => row.id === 2).background.join(','), classColours.find(row => row.id === 2).background.join(','));
    }
    await toggle.click();
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    for (const width of [1366, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(toggle).toBeVisible();
        assert.ok(await map.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `performance toolbar fits ${width}px`);
    }
    await map.screenshot({ path: 'test-results/positions-capital-map-performance-mobile.png' });
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('map remains readable and nonblank across widths and themes; class colours stay shared', { timeout: 90000 }, async t => {
    const { page, map, errors } = await setup(t);
    const first = map.locator('[data-map-holding="1"]');
    const fill = () => first.locator('rect').evaluate(el => getComputedStyle(el).fill);
    const darkFill = await fill();
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect.poll(fill).not.toBe(darkFill);
    await map.screenshot({ path: 'test-results/positions-capital-map-light.png' });
    for (const width of [2560, 1366, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
        await expect(map).toBeVisible();
        const chart = map.getByTestId('positions-capital-map-chart');
        const bounds = await chart.boundingBox();
        assert.ok(bounds.width > 250 && bounds.height >= 329, `usable chart dimensions at ${width}px`);
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `chart remains within ${width}px viewport`);
        await expect(map.locator('[data-map-holding]')).toHaveCount(21);
        assert.ok(await map.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `no horizontal overflow at ${width}px`);
        const badText = await map.locator('foreignObject > div').evaluateAll(nodes => nodes.filter(el => el.scrollHeight > el.clientHeight + 1).length);
        assert.equal(badText, 0, `labels fit their tile height at ${width}px`);
        if (width === 390) await map.screenshot({ path: 'test-results/positions-capital-map-mobile.png' });
    }
    assert.deepEqual(errors, []);
});

test('empty holdings show an explicit empty state instead of fabricated areas', { timeout: 90000 }, async t => {
    const { map, fixture, errors } = await setup(t, { empty: true });
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    await expect(map.getByRole('status')).toHaveText('No positive-value holdings to display.');
    await expect(map.locator('[data-map-holding]')).toHaveCount(0);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('Actions keeps its existing table and returning to Normal restores Simple', { timeout: 90000 }, async t => {
    const { page, map, errors } = await setup(t, { actions: true });
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    const actions = page.getByTestId('positions-actions-tab');
    await expect(actions).toBeEnabled();
    await actions.click();
    await expect(map).toHaveCount(0);
    await expect(page.locator('table.positions-grid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Simple view', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'NORMAL', exact: true }).click();
    await expect(map).toBeVisible();
    await expect(map).toHaveAttribute('data-layout', '1d');
    assert.deepEqual(errors, []);
});

test('blocked preference storage does not prevent switching views', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t, { storageBlocked: true });
    await map.getByRole('button', { name: 'Colour by P/L', exact: true }).click();
    await expect(map).toHaveAttribute('data-colour', 'performance');
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    await expect(map).toHaveAttribute('data-layout', '1d');
    await map.getByRole('button', { name: '2D capital map', exact: true }).click();
    await expect(map).toHaveAttribute('data-layout', '2d');
    await page.getByRole('button', { name: 'Table view', exact: true }).click();
    await expect(map).toHaveCount(0);
    await page.getByRole('button', { name: 'Simple view', exact: true }).click();
    await expect(map).toBeVisible();
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('1D uses strictly proportional row heights without a readability floor and preserves inspection', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t);
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    await expect(map).toHaveAttribute('data-layout', '1d');
    const rows = map.locator('button[data-map-holding]');
    await expect(rows).toHaveCount(21);
    await expect(map.locator('.recharts-wrapper')).toHaveCount(0);
    const chart = map.getByTestId('positions-capital-map-chart');
    const dimensions = await chart.evaluate(el => ({ width: el.clientWidth, height: el.getBoundingClientRect().height }));
    const geometry = await rows.evaluateAll(nodes => nodes.map(el => ({ value: Number(el.dataset.value), height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width })));
    assert.equal(geometry.reduce((sum, row) => sum + row.value, 0), totalHeld);
    for (const row of geometry) {
        assert.ok(Math.abs(row.height - row.value / totalHeld * dimensions.height) < .05, 'row height represents held capital without a floor');
        assert.ok(Math.abs(row.width + 44 - dimensions.width) < 1, 'all rows span the available width beside the percentage axis');
    }
    const tiny = map.locator('[data-map-holding="6"]');
    assert.ok((await tiny.boundingBox()).height < 1, 'a negligible holding may occupy less than one pixel');
    await expect(tiny).toHaveAccessibleName(/Small Gold Holding.*\$1,/);
    const search = map.getByRole('searchbox', { name: 'Find a holding' });
    await search.fill('small gold');
    await expect(tiny).toHaveAttribute('data-active', 'true');
    await expect(map.getByLabel('Holding allocation details')).toContainText('$1');
    const selected = await tiny.boundingBox();
    const visible = await chart.boundingBox();
    assert.ok(selected.y >= visible.y - 1 && selected.y + selected.height <= visible.y + visible.height + 1, 'search reveals a small row inside the chart');
    assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().height)), geometry.map(row => row.height), 'search never resizes rows');
    await search.press('Enter');
    await expect(page.getByTestId('context-panel').getByRole('heading', { name: 'Small Gold Holding', exact: true })).toBeVisible();
    await search.press('Escape');
    await map.locator('[data-map-holding="1"]').focus();
    await map.getByRole('button', { name: 'Focus Gold Miners from holding', exact: true }).click();
    await expect(rows).toHaveCount(6);
    const focusedHeight = await chart.evaluate(el => el.getBoundingClientRect().height);
    for (const row of await rows.evaluateAll(nodes => nodes.map(el => ({ value: Number(el.dataset.value), height: el.getBoundingClientRect().height })))) {
        assert.ok(Math.abs(row.height - row.value / 15001 * focusedHeight) < .05, 'class focus preserves exact proportions within the class');
    }
    await map.locator('[data-map-holding="1"]').focus();
    await expect(map.getByLabel('Holding allocation details')).toContainText('11.5%');
    await map.getByRole('button', { name: '2D capital map', exact: true }).click();
    await expect(map.locator('[data-map-holding]')).toHaveCount(6);
    await expect(map.getByRole('heading', { name: 'Gold Miners', exact: true })).toBeVisible();
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    await map.getByRole('button', { name: 'Show all asset classes', exact: true }).click();
    await map.screenshot({ path: 'test-results/positions-capital-map-1d-desktop.png' });
    await page.reload();
    await expect(map).toHaveAttribute('data-layout', '1d');
    await expect(map.locator('button[data-map-holding]')).toHaveCount(21);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('1D clips labels inside thin rows without inflating them across widths and themes', { timeout: 90000 }, async t => {
    const { page, map, errors } = await setup(t);
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    const first = map.locator('[data-map-holding="7"]');
    const background = () => first.evaluate(el => getComputedStyle(el).backgroundColor);
    const dark = await background();
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect.poll(background).not.toBe(dark);
    for (const width of [1366, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
        await expect(map.getByRole('button', { name: '1D capital map', exact: true })).toBeVisible();
        await expect(map.getByRole('button', { name: '2D capital map', exact: true })).toBeVisible();
        assert.ok(await map.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `no horizontal overflow at ${width}px`);
        const chartHeight = await map.getByTestId('positions-capital-map-chart').evaluate(el => el.getBoundingClientRect().height);
        const rows = await map.locator('button[data-map-holding]').evaluateAll(nodes => nodes.map(el => ({
            value: Number(el.dataset.value),
            height: el.getBoundingClientRect().height,
            horizontalOverflow: el.scrollWidth > el.clientWidth + 1,
            clipping: getComputedStyle(el).overflowY,
            labelled: getComputedStyle(el.firstElementChild).display !== 'none',
            numberOverflow: [...el.querySelectorAll(':scope > span:not(:first-child), :scope > strong')].some(value => value.scrollWidth > value.clientWidth + 1),
        })));
        assert.ok(rows.every(row => Math.abs(row.height - row.value / totalHeld * chartHeight) < .05), `proportional rows at ${width}px`);
        assert.ok(rows.every(row => row.labelled && row.clipping === 'hidden' && !row.horizontalOverflow && !row.numberOverflow), `labels render but cannot spill into adjacent rows at ${width}px: ${JSON.stringify(rows)}`);
        if (width === 390) await map.screenshot({ path: 'test-results/positions-capital-map-1d-mobile.png' });
    }
    assert.deepEqual(errors, []);
});

test('1D scale enlarges every row proportionally, preserves scroll position and keeps search usable', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t);
    await expect(map.getByRole('slider', { name: '1D map scale' })).toHaveCount(0);
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    const slider = map.getByRole('slider', { name: '1D map scale' });
    const chart = map.getByTestId('positions-capital-map-chart');
    const rows = map.locator('button[data-map-holding]');
    await expect(slider).toHaveValue('1');
    const geometry = () => rows.evaluateAll(nodes => nodes.map(el => ({ value: Number(el.dataset.value), height: el.getBoundingClientRect().height })));
    const checkScale = async scale => {
        const height = await chart.evaluate(el => el.getBoundingClientRect().height);
        for (const row of await geometry()) assert.ok(Math.abs(row.height - row.value / totalHeld * height * scale) < .1, `row at ${scale}x: ${JSON.stringify(row)}`);
    };
    await checkScale(1);
    await slider.focus();
    for (let i = 0; i < 5; i++) await slider.press('ArrowRight');
    await expect(slider).toHaveValue('1.5');
    await expect(slider).toHaveAttribute('aria-valuetext', '1.5 times');
    await checkScale(1.5);
    await chart.evaluate(el => { el.scrollTop = el.clientHeight / 4; });
    const scrollBefore = await chart.evaluate(el => el.scrollTop);
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('1.6');
    assert.ok(Math.abs(await chart.evaluate(el => el.scrollTop) - scrollBefore * 1.6 / 1.5) < 1, 'zoom retains the same top-of-view capital position');
    await slider.press('End');
    await expect(slider).toHaveValue('2');
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('2');
    await checkScale(2);
    const small = map.locator('[data-map-holding="19"]');
    const search = map.getByRole('searchbox', { name: 'Find a holding' });
    await search.fill('Memory Technologies');
    await expect(map.getByLabel('Holding allocation details')).toContainText('$250');
    const viewport = await chart.boundingBox();
    const selected = await small.boundingBox();
    assert.ok(selected.y >= viewport.y - 1 && selected.y + selected.height <= viewport.y + viewport.height + 1, 'search scrolls to the off-screen small holding');
    await search.fill('Pacific Energy');
    const large = await map.locator('[data-map-holding="7"]').boundingBox();
    assert.ok(large.y >= viewport.y - 1 && large.y + large.height <= viewport.y + viewport.height + 1, 'search brings a larger holding back into view');
    await search.press('Escape');
    await map.getByRole('button', { name: '2D capital map', exact: true }).click();
    await expect(slider).toHaveCount(0);
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    await expect(slider).toHaveValue('2');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(slider).toBeVisible();
    await checkScale(2);
    assert.ok(await map.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'mobile scale controls do not overflow');
    await map.screenshot({ path: 'test-results/positions-capital-map-zoom-mobile.png' });
    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveValue('1');
    await checkScale(1);
    assert.ok(await chart.evaluate(el => el.scrollHeight <= el.clientHeight + 1), '1x returns to the original fitted map');
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('1D label toggle switches between clipped text and labels that fit without resizing allocations', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t);
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    const toggle = map.getByRole('button', { name: 'Clip row labels', exact: true });
    const rows = map.locator('button[data-map-holding]');
    const heights = () => rows.evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().height));
    const before = await heights();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    assert.deepEqual(await heights(), before);
    for (const row of await rows.evaluateAll(nodes => nodes.map(el => ({ height: el.getBoundingClientRect().height, labelled: getComputedStyle(el.firstElementChild).display !== 'none' })))) {
        assert.equal(row.labelled, row.height > 27, 'small rows hide their text, large rows retain it');
    }
    await expect(map.locator('[data-map-holding="6"]')).toHaveAccessibleName(/Small Gold Holding/);
    await map.getByRole('searchbox', { name: 'Find a holding' }).fill('small gold');
    await expect(map.getByLabel('Holding allocation details')).toContainText('$1');
    await map.getByRole('button', { name: '2D capital map', exact: true }).click();
    await expect(toggle).toHaveCount(0);
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    assert.ok(await rows.evaluateAll(nodes => nodes.every(el => getComputedStyle(el.firstElementChild).display !== 'none')));
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(toggle).toBeVisible();
    assert.ok(await map.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'toggle fits mobile controls');
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('1D distinguishes 4.1%, 3%, 2%, 1% and 0.5% allocations without adding scroll space', { timeout: 90000 }, async t => {
    const holdings = [33700, 25000, 18000, 12000, 4100, 3000, 2000, 1000, 500, 500, 200]
        .map((value, i) => ({ ...seed[0], id: i + 1, ticker: `S${i + 1}`, name: `Allocation ${value / 1000}%`, value }));
    const { page, map, fixture, errors } = await setup(t, { holdings });
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    for (const viewport of [{ width: 2560, height: 1440 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const chart = await map.getByTestId('positions-capital-map-chart').evaluate(el => ({ height: el.getBoundingClientRect().height, scrollHeight: el.scrollHeight }));
        const sizes = await map.locator('button[data-map-holding]').evaluateAll(nodes => nodes.map(el => ({ value: Number(el.dataset.value), height: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })));
        for (const [i, row] of sizes.entries()) {
            assert.ok(Math.abs(row.height - row.value / 100000 * chart.height) < .05, JSON.stringify({ viewport, row, chart }));
            if (i > 0) assert.ok(Math.abs(row.top - sizes[i - 1].bottom) < .05, 'no inter-row gaps inflate the map');
        }
        const small = sizes.find(row => row.value === 500);
        assert.ok(small.height < 8, '0.5% remains a thin band, not a full-height row');
        assert.ok(Math.abs(sizes[0].height / small.height - 67.4) < 1, '33.7% is about 67.4 times the height of 0.5%');
        assert.ok(chart.scrollHeight <= chart.height + 1, 'all allocations fit the chart without floor-induced overflow');
    }
    await map.getByRole('searchbox', { name: 'Find a holding' }).fill('Allocation 0.5%');
    await expect(map.getByRole('status')).toHaveText('1 / 2');
    await expect(map.getByLabel('Holding allocation details')).toContainText('$500');
    await map.getByRole('button', { name: 'Next matching holding' }).click();
    await expect(map.getByRole('status')).toHaveText('2 / 2');
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('1D portfolio percentage axis tracks capital, zoom, scrolling and class focus', { timeout: 90000 }, async t => {
    const { page, map, fixture, errors } = await setup(t);
    const axis = map.getByRole('img', { name: 'Cumulative share of total portfolio' });
    await expect(axis).toHaveCount(0);
    await map.getByRole('button', { name: '1D capital map', exact: true }).click();
    await expect(axis).toBeVisible();
    await expect(axis.locator('[data-percentage]')).toHaveText(['0%', '25%', '50%', '75%']);
    const chart = map.getByTestId('positions-capital-map-chart');
    const slider = map.getByRole('slider', { name: '1D map scale' });
    const checkTicks = async (visibleValue, scale) => {
        const chartBounds = await chart.boundingBox();
        const axisBounds = await axis.boundingBox();
        const ticks = await axis.locator('[data-percentage]').evaluateAll(nodes => nodes.map(el => ({ percentage: Number(el.dataset.percentage), y: el.getBoundingClientRect().top })));
        for (const tick of ticks) {
            const expected = (totalHeld + 4000) * tick.percentage / 100 / visibleValue * chartBounds.height * scale;
            assert.ok(Math.abs(tick.y - axisBounds.y - expected) < .1, `tick at ${tick.percentage}% must include cash in its denominator`);
        }
        const firstRow = await map.locator('button[data-map-holding]').first().boundingBox();
        assert.ok(axisBounds.x + axisBounds.width <= firstRow.x + .1, 'axis labels occupy their own gutter');
        assert.ok(await axis.locator('[data-percentage] > span').evaluateAll(nodes => nodes.every(el => {
            const label = el.getBoundingClientRect();
            const axis = el.closest('[role="img"]').getBoundingClientRect();
            return label.x >= axis.x && label.right <= axis.right;
        })), 'tick text fits the gutter');
    };
    await checkTicks(totalHeld, 1);
    await slider.focus();
    await slider.press('End');
    await checkTicks(totalHeld, 2);
    await chart.evaluate(el => { el.scrollTop = el.clientHeight / 3; });
    await checkTicks(totalHeld, 2);
    await map.locator('[data-map-holding="1"]').focus();
    await map.getByRole('button', { name: 'Focus Gold Miners from holding', exact: true }).click();
    await expect(axis.locator('[data-percentage]')).toHaveText(['0%', '10%', '20%']);
    await checkTicks(15001, 2);
    await map.getByRole('button', { name: 'Show all asset classes', exact: true }).click();
    await slider.focus();
    await slider.press('Home');
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await checkTicks(totalHeld, 1);
    assert.ok(await map.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'axis does not add mobile horizontal overflow');
    await map.screenshot({ path: 'test-results/positions-capital-map-axis-mobile.png' });
    await map.getByRole('button', { name: '2D capital map', exact: true }).click();
    await expect(axis).toHaveCount(0);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});
