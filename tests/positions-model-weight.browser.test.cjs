const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { waitForRailLayout } = require('./fixtures/context-panel.cjs');
const ts = require('typescript');
const metrics = {};
new Function('exports', ts.transpileModule(readFileSync('lib/analysis-metrics.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(metrics);
const base = process.env.MODEL_WEIGHT_BASE_URL || 'http://127.0.0.1:3312';
const column = page => page.locator('.positions-grid th[data-column-key="modelWeight"]');
const weight = (page, name) => page.locator('.positions-stock-row').filter({ hasText: name }).locator('td[data-column-key="modelWeight"]');

async function settleGrid(page) {
    await waitForRailLayout(page);
    let previous, stable = 0;
    await expect.poll(async () => {
        const widths = await page.locator('.positions-grid thead th').evaluateAll(nodes =>
            JSON.stringify(nodes.map(node => node.getBoundingClientRect().width)),
        );
        stable = previous === widths ? stable + 1 : 0;
        previous = widths;
        return stable;
    }).toBeGreaterThanOrEqual(2);
}

async function setup(t, { incomplete = false, colourStates = false, touch = false } = {}) {
    assert.ok(new URL(base).hostname === '127.0.0.1' || new URL(base).hostname === 'localhost', 'Local isolated demo only');
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({
        viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        hasTouch: touch, isMobile: touch,
    });
    await require('./fixtures/browser-access.cjs').mockBrowserAccess(page);
    const errors = [], writes = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !request.url().endsWith('/sizing/allocations')) writes.push(request.url());
    });
    await page.addInitScript(() => {
        if (sessionStorage.getItem('model-weight-test')) return;
        sessionStorage.setItem('model-weight-test', '1');
        localStorage.setItem('terminal-position-column-order-v2', JSON.stringify(['name', 'plPercent', 'classPercent', 'portfolioPercent', 'mktValue']));
        localStorage.setItem('terminal-positions-visibility', JSON.stringify({ showStockStats: true, showGroupStats: true, showQ1Stats: true, positionStatsPeekEnabled: false }));
        localStorage.setItem('terminal-percent-fill-columns', JSON.stringify({ classPercent: false, portfolioPercent: false }));
    });
    if (colourStates) {
        await page.route('**/api/terminal/weight-policy', async route => {
            const response = await route.fetch(); const policy = await response.json();
            const classHeld = new Map();
            for (const row of policy.targets) classHeld.set(row.asset_class, (classHeld.get(row.asset_class) || 0) + row.held);
            for (const row of policy.targets) {
                const coverage = { 'ASX:CBA': 1.5, 'ASX:WBC': 0.75, 'ASX:NAB': 1.1, 'ASX:ANZ': 2, 'ASX:MQG': 2, 'ASX:MVB': 1.25 }[row.ticker];
                if (coverage == null) continue;
                const classBudget = row.ideal / row.percent * 100;
                row.percent = row.held / classHeld.get(row.asset_class) * 100 / coverage;
                row.ideal = row.percent / 100 * classBudget;
                row.coverage = row.held / row.ideal;
                if (row.ticker === 'ASX:ANZ') row.fresh = false;
                if (row.ticker === 'ASX:MQG') row.research_missing = 1;
            }
            await route.fulfill({ response, json: { ...policy, enabled: false } });
        });
    }
    if (incomplete) {
        await page.route('**/api/terminal/weight-policy', async route => {
            const response = await route.fetch(); const policy = await response.json();
            policy.targets = policy.targets.filter(row => row.ticker !== 'ASX:MQG');
            // Include an older backend response that still marks researched peers available.
            for (const row of policy.targets) if (row.asset_class === 'BANKS' && row.role === 'STOCK') row.research_missing = 1;
            for (const row of policy.targets) if (row.ticker === 'ASX:WBC') { row.available = false; row.reason = 'Research incomplete'; }
            await route.fulfill({ response, json: policy });
        });
        await page.route('**/api/terminal/analysis', async route => {
            const response = await route.fetch(); const rows = await response.json();
            for (const row of rows) {
                if (row.ticker === 'ASX:CBA') row.include_in_sizing = false;
                if (row.ticker === 'ASX:WBC') { row.gemini_pt = 0; row.gpt_pt = 0; }
                if (row.ticker === 'ASX:MQG') row.is_watchlist = true;
            }
            await route.fulfill({ response, json: rows });
        });
        await page.route('**/api/terminal/statements/latest', async route => {
            const response = await route.fetch(); const book = await response.json();
            book.holdings = book.holdings.filter(row => row.ticker !== 'MQG');
            await route.fulfill({ response, json: book });
        });
    }
    await page.route('**/api/terminal/sizing/allocations', async route => {
        const request = route.request().postDataJSON(); requests.push(request);
        if (!incomplete) return route.continue();
        const inputs = request.stocks.map(row => {
            const stock = { geminiQuality: row.gemini_quality, geminiValue: row.gemini_value, geminiPT: row.gemini_pt,
                gptQuality: row.gpt_quality, gptValue: row.gpt_value, gptPT: row.gpt_pt, price: row.current_price, performance6MPct: row.performance_6m_pct };
            return { ...row, weight: metrics.calculateAnalysisTargetWeight(stock), eligible: metrics.hasAnalysisSizingEvidence(stock) };
        });
        const results = inputs.map(row => {
            const total = inputs.filter(peer => peer.asset_class === row.asset_class).reduce((sum, peer) => sum + peer.weight, 0);
            const pct = total ? row.weight / total * 100 : 0;
            const classBudget = request.class_budgets?.find(budget => budget.asset_class === row.asset_class)?.class_budget || 0;
            return { id: row.id, asset_class: row.asset_class, eligible_for_target_weight: row.eligible, allocation_pct: pct,
                allocation_dollar: pct / 100 * (classBudget - (row.asset_class === 'BANKS' ? 6500 : 0)) };
        });
        await route.fulfill({ json: { results, class_budgets_applied: true, router_scores_applied: false } });
    });
    await page.goto(`${base}/#/positions`);
    await expect(column(page)).toBeVisible({ timeout: 30000 });
    await expect(weight(page, 'Commonwealth Bank')).toHaveText(incomplete ? '-' : /\d+\.\d%/, { timeout: 30000 });
    t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(writes, []); });
    return { page, requests };
}

test('Ideal wt fill matches displayed weights, including 100% single holdings, without changing geometry', { timeout: 90000 }, async t => {
    const { page } = await setup(t, { colourStates: true });
    const fill = name => weight(page, name).locator('.position-model-weight-bar > span');
    for (const [name, tone] of [['Commonwealth Bank', 'overstretch'], ['VanEck Australian Banks ETF', 'overstretch'],
        ['Westpac', 'under'], ['National Australia', 'neutral'], ['ANZ Group', 'neutral'],
        ['Fortescue', 'aligned'], ['Amcor', 'aligned'], ['Wesfarmers', 'aligned']]) {
        await expect(weight(page, name).locator('.position-model-weight')).toHaveAttribute('data-weight-tone', tone);
    }
    await expect(weight(page, 'Macquarie')).toHaveText('-');
    await expect(weight(page, 'Westpac').locator('.position-model-weight')).toHaveAttribute('title', /Class % is below Ideal wt/);
    await expect(weight(page, 'Fortescue')).toHaveText('100.0%');
    await expect(weight(page, 'Fortescue').locator('.position-model-weight')).toHaveAttribute('title', /Class % matches Ideal wt/);
    const rgb = async name => fill(name).evaluate(node => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(node).backgroundColor;
        ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
    const darkUnder = await rgb('Westpac'), darkNeutral = await rgb('National Australia'), darkOver = await rgb('Commonwealth Bank');
    assert.ok(darkUnder.every((channel, index) => channel > darkNeutral[index]), 'Underweight fill should be lighter in dark mode');
    assert.ok(darkOver[0] > darkOver[1] * 1.5 && darkOver[0] > darkOver[2] * 1.5, 'Overstretch should be red');
    const darkAligned = await rgb('Fortescue');
    assert.ok(darkAligned[1] > darkAligned[0] * 1.5 && darkAligned[1] > darkAligned[2] * 1.5, '100% / 100% should be green');
    const geometry = async () => weight(page, 'Westpac').evaluate(cell => {
        const fill = cell.querySelector('.position-model-weight-bar > span').getBoundingClientRect();
        return { fillHeight: fill.height, fillWidth: fill.width, rowHeight: cell.parentElement.getBoundingClientRect().height };
    });
    const before = await geometry();
    assert.equal(before.fillHeight, 2);
    assert.ok(Math.abs(before.rowHeight - 29) < 0.5);
    mkdirSync('/tmp/alpha-edge-model-weight', { recursive: true });
    await page.screenshot({ path: '/tmp/alpha-edge-model-weight/colour-dark.png' });
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect.poll(() => rgb('Westpac')).not.toEqual(darkUnder);
    const lightUnder = await rgb('Westpac'), lightNeutral = await rgb('National Australia'), lightOver = await rgb('Commonwealth Bank');
    assert.ok(lightUnder.every((channel, index) => channel < lightNeutral[index]), 'Underweight fill should stay visible in light mode');
    assert.ok(lightOver[0] > lightOver[1] * 1.5 && lightOver[0] > lightOver[2] * 1.5);
    const lightAligned = await rgb('Fortescue');
    assert.ok(lightAligned[1] > lightAligned[0] * 1.5 && lightAligned[1] > lightAligned[2] * 1.5);
    assert.deepEqual(await geometry(), before);
    await page.screenshot({ path: '/tmp/alpha-edge-model-weight/colour-light.png' });
});

test('Ideal wt sits beside Class %, respects ETF capacity, and supports resizing, sorting and saved visibility', { timeout: 90000 }, async t => {
    const { page } = await setup(t);
    const order = await page.locator('.positions-grid th[data-column-key]').evaluateAll(nodes => nodes.map(node => node.dataset.columnKey));
    assert.equal(order[order.indexOf('classPercent') + 1], 'modelWeight');
    await expect(weight(page, 'VanEck Australian Banks ETF')).toHaveText('25.0%');
    const etfWeight = weight(page, 'VanEck Australian Banks ETF');
    await expect(etfWeight.locator('.position-model-weight')).toHaveAttribute('title', /^\$6,500 - /);
    const barGeometry = await etfWeight.evaluate(cell => {
        const track = cell.querySelector('.position-model-weight-bar').getBoundingClientRect();
        const fill = cell.querySelector('.position-model-weight-bar > span').getBoundingClientRect();
        const number = cell.querySelector('.position-model-weight-number');
        return { trackHeight: track.height, fillRatio: fill.width / track.width,
            numberFits: number.scrollWidth <= number.clientWidth, rowHeight: cell.parentElement.getBoundingClientRect().height };
    });
    assert.equal(barGeometry.trackHeight, 2);
    assert.ok(Math.abs(barGeometry.fillRatio - 0.25) < 0.01);
    assert.ok(barGeometry.numberFits);
    assert.ok(Math.abs(barGeometry.rowHeight - 29) < 0.5, `Existing 29px row height changed: ${barGeometry.rowHeight}`);
    const bankNames = ['Commonwealth Bank', 'Westpac', 'National Australia', 'ANZ Group', 'Macquarie'];
    const sum = (await Promise.all(bankNames.map(async name => parseFloat(await weight(page, name).innerText())))).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 75) < 0.3, `Banks stock budget is 75%, got ${sum}`);
    await column(page).click();
    await expect(column(page)).toContainText('↓');
    const before = (await column(page).boundingBox()).width;
    const resize = column(page).getByRole('separator');
    await resize.focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await column(page).boundingBox()).width).toBeGreaterThan(before);
    await page.getByTitle('Choose visible columns', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Ideal wt', exact: true }).uncheck();
    await expect(column(page)).toHaveCount(0);
    await page.reload(); await expect(page.locator('.positions-grid')).toBeVisible();
    await expect(column(page)).toHaveCount(0);
    await page.getByTitle('Choose visible columns', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Ideal wt', exact: true }).check();
    await page.getByTitle('Choose visible columns', { exact: true }).click();
    await expect(weight(page, 'VanEck Australian Banks ETF')).toHaveText('25.0%');
    mkdirSync('/tmp/alpha-edge-model-weight', { recursive: true });
    await page.screenshot({ path: '/tmp/alpha-edge-model-weight/desktop.png' });
    const darkBar = await etfWeight.locator('.position-model-weight-bar').evaluate(node => getComputedStyle(node).backgroundColor);
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect.poll(() => etfWeight.locator('.position-model-weight-bar').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(darkBar);
    await page.screenshot({ path: '/tmp/alpha-edge-model-weight/light.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await column(page).scrollIntoViewIfNeeded();
    const alignment = await column(page).evaluate(header => {
        const index = [...header.parentElement.children].indexOf(header);
        const table = header.closest('table');
        const cell = table.querySelector('tr.positions-stock-row').children[index];
        return { header: header.getBoundingClientRect().width, cell: cell.getBoundingClientRect().width,
            cellCount: cell.parentElement.children.length, headerCount: header.parentElement.children.length };
    });
    assert.equal(alignment.cellCount, alignment.headerCount);
    assert.ok(Math.abs(alignment.header - alignment.cell) < 1);
    await page.screenshot({ path: '/tmp/alpha-edge-model-weight/mobile.png' });
});

test('incomplete held class shows dashes with a reason, leaves Core and other classes intact, and links to research review', { timeout: 90000 }, async t => {
    const { page, requests } = await setup(t, { incomplete: true });
    await expect(weight(page, 'Westpac')).toHaveText('-');
    await expect(weight(page, 'Westpac').locator('.position-model-weight-bar')).toHaveCount(0);
    await expect(weight(page, 'Commonwealth Bank')).toHaveText('-');
    await expect(weight(page, 'Commonwealth Bank').locator('[title]')).toHaveAttribute('title', /Incomplete class research/);
    await expect(weight(page, 'Commonwealth Bank').locator('.position-model-weight-bar')).toHaveCount(0);
    await expect(weight(page, 'VanEck Australian Banks ETF')).toHaveText('25.0%');
    await expect(weight(page, 'Fortescue')).toHaveText('100.0%');
    await expect.poll(() => requests.some(request => !request.stocks.some(row => row.ticker === 'ASX:CBA') && request.stocks.some(row => row.ticker === 'ASX:MQG'))).toBe(true);
    await page.goto(`${base}/#/analysis`);
    await page.getByRole('button', { name: /Open data issues/ }).click();
    await expect(page.getByRole('heading', { name: 'Incomplete sizing research' })).toBeVisible();
    await page.getByRole('button', { name: 'Review research', exact: true }).click();
    await expect(page.locator('.analysis-company-name')).toHaveCount(1);
    await expect(page.locator('.analysis-company-name')).toContainText('Westpac');
    await page.getByRole('button', { name: /Open data issues/ }).click();
    await page.getByRole('button', { name: 'Show all securities', exact: true }).click();
    await expect.poll(() => page.locator('.analysis-company-name').count()).toBeGreaterThan(20);
});

test('Ideal wt column hover and focus reveal all bars together, not an isolated row, without shifting numbers', { timeout: 90000 }, async t => {
    const { page } = await setup(t, { colourStates: true });
    const cell = weight(page, 'Westpac');
    const row = page.locator('.positions-stock-row').filter({ hasText: 'Westpac' });
    const bar = cell.locator('.position-model-weight-bar');
    const warning = weight(page, 'Commonwealth Bank').locator('.position-model-weight-bar');
    const aligned = weight(page, 'Fortescue').locator('.position-model-weight-bar');
    const ordinaryBars = page.locator('.position-model-weight:not([data-weight-tone="overstretch"]) .position-model-weight-bar');
    const expectColumnOpacity = opacity => expect.poll(() => ordinaryBars.evaluateAll(bars =>
        [...new Set(bars.map(bar => getComputedStyle(bar).opacity))],
    )).toEqual([opacity]);
    const geometry = () => cell.evaluate(cell => {
        const number = cell.querySelector('.position-model-weight-number');
        const actual = cell.previousElementSibling.querySelector('span');
        const textRect = el => {
            const range = document.createRange(); range.selectNodeContents(el);
            const rect = range.getBoundingClientRect();
            const cellRect = el.closest('td').getBoundingClientRect();
            return { x: rect.x - cellRect.x, y: rect.y - cellRect.y, width: rect.width, height: rect.height };
        };
        const row = cell.parentElement.getBoundingClientRect();
        const bar = cell.querySelector('.position-model-weight-bar').getBoundingClientRect();
        const wrapper = cell.querySelector('.position-model-weight').getBoundingClientRect();
        return { number: textRect(number), actual: textRect(actual), rowHeight: row.height,
            barInside: bar.top >= Math.max(row.top, wrapper.top) && bar.bottom <= Math.min(row.bottom, wrapper.bottom),
            fontSize: getComputedStyle(number).fontSize, fontWeight: getComputedStyle(number).fontWeight };
    });
    for (const light of [false, true]) {
        await page.setViewportSize({ width: 1440, height: 900 });
        if (light) await page.getByTitle('Switch to light mode', { exact: true }).click();
        for (const width of [1440, 1280, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await settleGrid(page);
            await cell.scrollIntoViewIfNeeded();
            await page.mouse.move(0, 0);
            await expect(bar).toHaveCSS('opacity', '0');
            await expect(aligned).toHaveCSS('opacity', '0');
            await expect(warning).toHaveCSS('opacity', '1');
            const before = await geometry();
            assert.equal(before.fontSize, '13px');
            assert.equal(before.fontWeight, '400');
            assert.ok(Math.abs(before.number.y - before.actual.y) < 1, 'Ideal and Class percentages should share a text baseline');
            assert.ok(before.barInside, 'Bar must stay within its existing row');
            await cell.hover();
            await expect(bar).toHaveCSS('opacity', '1');
            await expectColumnOpacity('1');
            assert.deepEqual(await geometry(), before);
            await page.mouse.move(0, 0);
            await expectColumnOpacity('0');
            await column(page).hover();
            await expectColumnOpacity('1');
            await page.mouse.move(0, 0);
            await expectColumnOpacity('0');
            await column(page).getByRole('separator').focus();
            await expectColumnOpacity('1');
            await row.focus();
            await expectColumnOpacity('0');
            await cell.scrollIntoViewIfNeeded();
            mkdirSync('/tmp/alpha-edge-model-weight', { recursive: true });
            await page.screenshot({ path: `/tmp/alpha-edge-model-weight/quiet-${light ? 'light' : 'dark'}-${width}.png` });
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await row.locator('td').first().hover();
    await expectColumnOpacity('0');
    await expect(warning).toHaveCSS('opacity', '1');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(bar).toHaveCSS('transition-duration', '0s');
});

test('Touch users retain Ideal wt percentages and overstretch warnings without hover', { timeout: 90000 }, async t => {
    const { page } = await setup(t, { colourStates: true, touch: true });
    assert.equal(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), false);
    const cell = weight(page, 'Commonwealth Bank');
    await cell.scrollIntoViewIfNeeded();
    await expect(cell.locator('.position-model-weight-number')).toBeVisible();
    await expect(cell.locator('.position-model-weight-bar')).toHaveCSS('opacity', '1');
    await expect(weight(page, 'Westpac').locator('.position-model-weight-bar')).toHaveCSS('opacity', '0');
    await expect(weight(page, 'Fortescue')).toHaveText('100.0%');
    await expect(weight(page, 'Fortescue').locator('.position-model-weight-bar')).toHaveCSS('opacity', '0');
    const row = page.locator('.positions-stock-row').filter({ hasText: 'Commonwealth Bank' });
    for (const key of ['classPercent', 'portfolioPercent']) {
        const cell = row.locator(`td[data-column-key="${key}"]`);
        await cell.scrollIntoViewIfNeeded();
        await expect(cell).toHaveText(/\d+\.\d%/);
        await expect(cell.locator('.position-percent-fill')).toHaveCSS('opacity', '0');
    }
});

test('Class % and Portfolio % reveal independent whole-column fills without checkboxes or geometry changes', { timeout: 90000 }, async t => {
    const { page } = await setup(t);
    const keys = ['classPercent', 'portfolioPercent'];
    const header = key => page.locator(`.positions-grid th[data-column-key="${key}"]`);
    const fills = key => page.locator(`.positions-grid td[data-column-key="${key}"] .position-percent-fill`);
    const row = page.locator('.positions-stock-row').filter({ hasText: 'Commonwealth Bank' });
    const regularIdealBars = page.locator('.position-model-weight:not([data-weight-tone="overstretch"]) .position-model-weight-bar');
    const expectFills = (key, opacity) => expect.poll(() => fills(key).evaluateAll(nodes =>
        [...new Set(nodes.map(node => getComputedStyle(node).opacity))],
    )).toEqual([opacity]);
    for (const key of keys) {
        await expect(header(key).getByRole('checkbox')).toHaveCount(0);
        assert.ok(await fills(key).count() > 20, 'Includes all held rows, not just the hovered stock');
    }
    for (const light of [false, true]) {
        await page.setViewportSize({ width: 1440, height: 900 });
        if (light) await page.getByTitle('Switch to light mode', { exact: true }).click();
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await settleGrid(page);
            for (const key of keys) {
                const other = keys.find(candidate => candidate !== key);
                const cell = row.locator(`td[data-column-key="${key}"]`);
                await cell.scrollIntoViewIfNeeded();
                await page.mouse.move(0, 0);
                await expectFills(key, '0');
                const numbers = await page.locator(`.positions-stock-row td[data-column-key="${key}"]`).allTextContents();
                const geometry = () => cell.evaluate(cell => {
                    const rect = cell.getBoundingClientRect();
                    const number = cell.querySelector('span').getBoundingClientRect();
                    return { width: rect.width, height: rect.height, numberX: number.x - rect.x,
                        numberY: number.y - rect.y, numberWidth: number.width, numberHeight: number.height };
                });
                const before = await geometry();
                await cell.hover();
                await expectFills(key, '1');
                await expectFills(other, '0');
                await expect.poll(() => regularIdealBars.evaluateAll(nodes =>
                    [...new Set(nodes.map(node => getComputedStyle(node).opacity))],
                )).toEqual(['0']);
                assert.deepEqual(await geometry(), before);
                assert.deepEqual(await page.locator(`.positions-stock-row td[data-column-key="${key}"]`).allTextContents(), numbers);
                await page.mouse.move(0, 0);
                await expectFills(key, '0');
                await header(key).hover();
                await expectFills(key, '1');
                await expectFills(other, '0');
                await page.mouse.move(0, 0);
                await header(key).getByRole('separator').focus();
                await expectFills(key, '1');
                await expectFills(other, '0');
                await row.focus();
                await expectFills(key, '0');
            }
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await row.locator('td').first().hover();
    for (const key of keys) await expectFills(key, '0');
    await header('classPercent').dragTo(header('portfolioPercent'));
    await header('classPercent').hover();
    await expectFills('classPercent', '1');
    await expectFills('portfolioPercent', '0');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const key of keys) await expect(fills(key).first()).toHaveCSS('transition-duration', '0s');
    await page.reload();
    await expect(weight(page, 'Commonwealth Bank')).toHaveText(/\d+\.\d%/);
    await header('portfolioPercent').hover();
    await expectFills('portfolioPercent', '1');
    await expectFills('classPercent', '0');
    mkdirSync('/tmp/alpha-edge-model-weight', { recursive: true });
    await page.screenshot({ path: '/tmp/alpha-edge-model-weight/portfolio-column-hover.png' });
    await page.mouse.move(0, 0);
    await expectFills('portfolioPercent', '0');
    await page.screenshot({ path: '/tmp/alpha-edge-model-weight/percent-columns-idle.png' });
});
