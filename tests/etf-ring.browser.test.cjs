const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

test('Ring fill is an optional persisted view with the same Core controls and unchanged line, map and sleeve', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixture = await mockContextPanel(page);
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    const line = panel.getByLabel('ETF line allocations', { exact: true });
    await expect(line).toBeVisible();
    await waitForRailLayout(page);
    const lineBounds = await line.boundingBox();
    const dock = page.getByTestId('sleeve-summary-dock');
    const dockBounds = await dock.boundingBox();
    await panel.getByRole('button', { name: 'Ring fill', exact: true }).click();
    await expect(panel.getByLabel('ETF ring allocations', { exact: true })).toBeVisible();
    await expect(line).toHaveCount(0);
    assert.deepEqual(await dock.boundingBox(), dockBounds);
    const gold = panel.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true });
    const core = gold.getByRole('button', { name: 'Configure Core ETF ASX:GOLD', exact: true });
    const difference = gold.getByRole('button', { name: /^ASX:GOLD allocation difference:/ });
    await expect(difference).toHaveText('+100.0%');
    await difference.click();
    await expect(difference).toHaveText('+$1,500');
    await expect(page.getByLabel('Core allocation for ASX:GOLD', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(difference).toHaveText('+100.0%');
    await page.keyboard.press('Enter');
    await expect(difference).toHaveText('+$1,500');
    await expect(panel.locator('button button')).toHaveCount(0);
    assert.deepEqual(fixture.writes, []);
    await core.click({ position: { x: 12, y: 12 } });
    const editor = page.getByLabel('Core allocation for ASX:GOLD', { exact: true });
    await expect(editor).toBeVisible();
    await editor.getByRole('radio', { name: '1:2', exact: true }).click();
    assert.equal(fixture.writes.length, 0, 'ratio selection is a draft, not an automatic submission');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(panel.getByRole('button', { name: 'Ring fill', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(difference).toHaveText('+100.0%');
    await core.focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByRole('radio', { name: '1:4', exact: true })).toHaveAttribute('aria-checked', 'true');
    await editor.getByRole('radio', { name: '1:2', exact: true }).click();
    await editor.getByRole('button', { name: 'Core', exact: true }).click();
    await expect(editor).toHaveCount(0);
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.writes[0].payload.core_ratio_pct, 50);
    await expect(gold.getByRole('img')).toHaveAttribute('aria-label', /100\.0% funded/);
    await expect(gold.locator('[data-ring="excess"]')).toHaveCount(0);
    await expect(difference).toHaveText('0.0%');
    await panel.getByRole('button', { name: 'Capital map', exact: true }).click();
    await expect(panel.getByLabel('ETF capital map', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Line fill', exact: true }).click();
    await expect(line).toBeVisible();
    assert.deepEqual(await line.boundingBox(), lineBounds, 'switching views must not restyle or resize Line Fill');
    assert.deepEqual(await dock.boundingBox(), dockBounds);
    await expect(page).toHaveURL(/#\/positions$/);
});

test('ring rows share the line view hierarchy, full-width dividers and hover across rail sizes', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const fixture = await mockContextPanel(page);
    const rows = fixture.ledger().rows;
    rows.push({ ...rows[0], ticker: 'ASX:LONGTICKERNAME', display_name: 'A long fund name for narrow sidebar coverage', actual_value: 1234567, effective_target_value: 234567, asset_class_name: 'Rare Earths & Critical Minerals' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const backgrounds = [];
    for (const width of [1280, 1440, 1920, 2560, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/#/positions`);
        if (width < 1024) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        const panel = page.getByTestId('context-panel');
        await panel.getByRole('button', { name: 'Line fill', exact: true }).click();
        await waitForRailLayout(page);
        const lineHeight = (await panel.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true }).boundingBox()).height;
        await panel.getByRole('button', { name: 'Ring fill', exact: true }).click();
        await waitForRailLayout(page);
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            await page.mouse.move(0, 0);
            const gold = panel.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true });
            await expect(gold).toHaveCSS('border-radius', '0px');
            await expect(gold).toHaveCSS('padding', width < 1024 ? '8px 11px' : '5px 11px 6px');
            await expect(gold).toHaveCSS('border-top-width', '0px');
            await expect(gold).toHaveCSS('border-left-width', '0px');
            await expect(gold).toHaveCSS('border-right-width', '0px');
            await expect(gold).toHaveCSS('border-bottom-width', '1px');
            await expect(panel.getByLabel('ETF ring allocations', { exact: true })).toHaveCSS('gap', '0px');
            const rail = await page.getByTestId('context-panel-scroll').evaluate(el => ({ x: el.getBoundingClientRect().x + el.clientLeft, width: el.clientWidth }));
            backgrounds.push(await gold.evaluate(el => getComputedStyle(el).backgroundColor));
            await expect(gold.getByRole('img')).toHaveCSS('width', '26px');
            await expect(gold.getByRole('img')).toHaveCSS('height', '26px');
            const connection = await gold.locator('[title="Full monitoring (ETF TMS)"] > div').boundingBox();
            const ticker = await gold.getByText('GOLD', { exact: true }).boundingBox();
            assert.ok(Math.abs(connection.height - 9.6) < .1);
            assert.ok(Math.abs(connection.y + connection.height / 2 - ticker.y - ticker.height / 2) < .5);
            for (const [symbol, amounts] of [['GOLD', ['$3,000', '$1,500']], ['SILV', ['$0', '$750']], ['LONGTICKERNAME', ['$1,234,567', '$234,567']]]) {
                const card = panel.getByRole('group', { name: `ASX:${symbol} ETF allocation`, exact: true });
                const difference = card.getByRole('button', { name: new RegExp(`^ASX:${symbol} allocation difference:`) });
                for (const unit of ['percent', 'dollar']) {
                    const bounds = await card.boundingBox();
                    assert.ok(Math.abs(bounds.x - rail.x) <= 1 && Math.abs(bounds.width - rail.width) <= 1, 'ring rows span the rail edge to edge');
                    assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth), 'card cannot overflow the sidebar');
                    if (symbol !== 'LONGTICKERNAME') assert.ok(await card.getByText(symbol, { exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth), 'the ticker has priority over the longer fund name');
                    for (const text of amounts) {
                        const amount = card.getByText(text, { exact: true });
                        const rect = await amount.boundingBox();
                        assert.ok(rect.x >= bounds.x && rect.x + rect.width <= bounds.x + bounds.width - 8, `${symbol}: money stays within its card`);
                        assert.ok(rect.y >= bounds.y && rect.y + rect.height <= bounds.y + bounds.height - 6);
                        assert.ok(await amount.evaluate(el => el.scrollWidth <= el.clientWidth), 'never truncate a dollar amount');
                    }
                    const number = await difference.boundingBox();
                    const identity = await card.locator('[class*="ringIdentity"]').boundingBox();
                    const details = await card.locator('[class*="ringDetails"]').boundingBox();
                    const wheel = await card.getByRole('img').boundingBox();
                    const ticker = await card.getByText(symbol, { exact: true }).boundingBox();
                    const name = await card.locator('[class*="ringName"]').boundingBox();
                    const amountsHeight = (await card.locator('[class*="amountPair"]').boundingBox()).height;
                    assert.ok(bounds.height >= lineHeight, 'ring rows use the line-fill base height');
                    if (amountsHeight <= 18) assert.equal(bounds.height, lineHeight, 'unwrapped ring rows match the line-fill height exactly');
                    assert.ok(identity.y + identity.height <= number.y, 'identity sits above the funding difference');
                    assert.ok(details.x + details.width <= number.x, 'held/target and difference cannot collide');
                    assert.ok(wheel.x + wheel.width < details.x, 'funding stays clear of the wheel column');
                    assert.ok(wheel.x + wheel.width < identity.x, 'wheel remains separate from the identity');
                    assert.ok(Math.abs(wheel.y + wheel.height / 2 - bounds.y - bounds.height / 2) <= 1, 'wheel centres vertically across the whole card');
                    assert.ok(ticker.x + ticker.width + 5 <= name.x, 'long tickers cannot run into the fund name');
                    await expect(difference).toHaveCSS('font-size', '12px');
                    if (symbol !== 'LONGTICKERNAME') assert.ok(bounds.height <= (width < 1024 ? 82 : 72), 'normal ring rows stay compact, including wrapped funding on narrow rails');
                    assert.ok(number.x >= bounds.x && number.x + number.width <= bounds.x + bounds.width - 8, `${symbol} ${unit}: difference stays inside card`);
                    assert.ok(await difference.evaluate(el => el.scrollWidth <= el.clientWidth), 'never truncate the allocation difference');
                    await difference.click();
                    await expect(page.getByLabel(`Core allocation for ASX:${symbol}`, { exact: true })).toHaveCount(0);
                }
            }
            const summary = panel.getByRole('region', { name: 'ETF allocations', exact: true });
            const controls = await summary.getByRole('group', { name: 'Allocation display' }).boundingBox();
            const heading = await summary.getByRole('heading').boundingBox();
            assert.equal(heading.height, 20, 'third view must not wrap the summary heading');
            assert.ok(heading.x + heading.width <= controls.x);
            await panel.screenshot({ path: `/tmp/etf-ring-${width}-${theme}.png` });
            const background = await gold.evaluate(el => getComputedStyle(el).backgroundColor);
            const border = await gold.evaluate(el => getComputedStyle(el).borderBottomColor);
            await gold.hover({ position: { x: 12, y: 12 } });
            await expect.poll(() => gold.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(background);
            await expect(gold).toHaveCSS('border-bottom-color', border);
            await page.mouse.move(0, 0);
            await expect(gold).toHaveCSS('background-color', background);
        }
    }
    assert.notEqual(backgrounds[0], backgrounds[1], 'ring cards follow light mode rather than retaining a dark fill');
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.writes, []);
});

test('ring progress distinguishes empty, funded, excess, zero and unavailable targets without using momentum as funding', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixture = await mockContextPanel(page);
    const ledger = fixture.ledger();
    const cases = [[0, 100, 0, 0], [50, 100, 50, 0], [100, 100, 100, 0], [125, 100, 100, 25], [200, 100, 100, 100], [500, 0, 0, 100], [0, 0, 0, 0], [436, null, 0, 0]];
    const percentages = ['\u2212100.0%', '\u221250.0%', '0.0%', '+25.0%', '+100.0%', '\u2014', '0.0%', '\u2014'];
    const dollars = ['\u2212$100', '\u2212$50', '$0', '+$25', '+$100', '+$500', '$0'];
    ledger.rows = cases.map(([actual, target], index) => ({ ...ledger.rows[0], ticker: `ASX:R${index}`, actual_value: actual, effective_target_value: target, class_not_in_shape: target === null, momentum_weight_pct: 7.3 }));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.endsWith('/etf/allocation-ledger') ? route.fulfill({ json: ledger }) : route.fallback());
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    await panel.getByRole('button', { name: 'Ring fill', exact: true }).click();
    for (const [index, [actual, target, funded, excess]] of cases.entries()) {
        const card = panel.getByRole('group', { name: `ASX:R${index} ETF allocation`, exact: true });
        const blue = card.locator('[data-ring="funded"]');
        const red = card.locator('[data-ring="excess"]');
        if (funded) await expect(blue).toHaveAttribute('stroke-dasharray', `${funded} 100`);
        else await expect(blue).toHaveCount(0);
        if (excess) {
            await expect(red).toHaveAttribute('stroke-dasharray', `${excess} 100`);
            await expect(red).toHaveAttribute('stroke-dashoffset', String(-(100 - excess)));
        } else await expect(red).toHaveCount(0);
        await expect(card).toHaveAttribute('data-unknown', String(target === null));
        await expect(card.getByText('7.3%', { exact: true })).toHaveCount(0);
        const difference = card.getByRole('button', { name: new RegExp(`^ASX:R${index} allocation difference:`) });
        await expect(difference).toHaveText(percentages[index]);
        await expect(difference).toHaveAttribute('data-direction', target === null || target === 0 || actual === target ? 'neutral' : actual > target ? 'above' : 'below');
        if (target === null) await expect(difference).toBeDisabled();
        else {
            await difference.click();
            await expect(difference).toHaveText(dollars[index]);
            await expect(difference).toHaveAttribute('data-direction', actual === target ? 'neutral' : actual > target ? 'above' : 'below');
            await expect(page.getByLabel(`Core allocation for ASX:R${index}`, { exact: true })).toHaveCount(0);
            await difference.click();
            await expect(difference).toHaveText(percentages[index]);
        }
        const ring = card.getByRole('img');
        if (target > 0) await expect(ring).toHaveAttribute('aria-label', new RegExp(`${(actual / target * 100).toFixed(1)}% funded`));
        if (target === null) {
            await expect(ring).toHaveAttribute('aria-label', /No effective target/);
            await expect(ring.locator('circle').first()).toHaveAttribute('stroke-dasharray', '2 3');
        }
    }
    assert.deepEqual(fixture.writes, []);
});
