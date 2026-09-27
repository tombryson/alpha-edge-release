const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

test('Security chart follows selection and theme without changing data or the bottom dock', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fixture = await mockContextPanel(page);
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    const chart = panel.getByTestId('security-price-chart');
    const producer = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' });
    await producer.locator('td').first().dblclick();
    await expect(chart).toHaveAttribute('data-symbol', 'ASX:STOCK');
    const frame = chart.locator('iframe');
    await expect(frame).toHaveAttribute('title', 'ASX:STOCK price chart by TradingView');
    await expect(chart.getByRole('status')).toHaveCount(0);
    const providerFrame = frame.contentFrame().locator('iframe');
    const config = async () => JSON.parse(await providerFrame.getAttribute('data-config'));
    assert.equal((await config()).symbol, 'ASX:STOCK');
    assert.equal((await config()).theme, 'dark');
    assert.equal((await config()).interval, 'D');
    assert.equal((await config()).overrides['mainSeriesProperties.priceAxisProperties.autoScale'], true);
    assert.equal((await config()).overrides['mainSeriesProperties.priceAxisProperties.lockScale'], false);
    assert.equal((await config()).allow_symbol_change, false);
    await expect(panel.getByRole('link', { name: 'Open ASX:STOCK in TradingView' })).toHaveAttribute('href', 'https://www.tradingview.com/chart/?symbol=ASX%3ASTOCK');
    const dock = page.getByTestId('sleeve-summary-dock');
    const originalDock = await dock.boundingBox();
    await chart.scrollIntoViewIfNeeded();
    assert.equal((await dock.boundingBox()).y, originalDock.y);
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect.poll(async () => (await config()).theme).toBe('light');
    await expect(chart.locator('iframe')).toHaveCount(1);
    await expect(providerFrame).toHaveCount(1);
    const lightBackground = (await config()).backgroundColor.match(/\d+/g).map(Number);
    assert.ok(lightBackground.every(value => value > 150));
    await page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Core ETF' }).locator('td').first().dblclick();
    await expect(chart).toHaveAttribute('data-symbol', 'ASX:GOLD');
    await expect.poll(async () => (await config()).symbol).toBe('ASX:GOLD');
    await expect(panel.getByRole('heading', { name: 'Gold Core ETF', exact: true })).toBeVisible();
    for (const width of [1920, 1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 390) await producer.locator('td').first().dblclick();
        await chart.scrollIntoViewIfNeeded();
        const bounds = await chart.boundingBox();
        const iframe = await providerFrame.boundingBox();
        assert.equal(bounds.height, 218);
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.ok(Math.abs(bounds.width - iframe.width) <= 1, 'provider frame must fit the sidebar');
        assert.ok(Math.abs(bounds.height - iframe.height) <= 1);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await panel.getByRole('tab', { name: 'ETFs', exact: true }).click();
    await expect(chart).toHaveCount(0);
    fixture.failures.add('tradingview');
    await panel.getByRole('tab', { name: 'Security', exact: true }).click();
    await expect(chart.getByText('TradingView could not be loaded.')).toBeVisible();
    fixture.failures.delete('tradingview');
    await chart.getByRole('button', { name: 'Retry chart' }).click();
    await expect(frame).toHaveCount(1);
    await expect(chart.getByRole('status')).toHaveCount(0);
    await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('alpha-edge:context-panel'));
        saved.state.security = 'NOEXCHANGE';
        localStorage.setItem('alpha-edge:context-panel', JSON.stringify(saved));
    });
    await page.reload();
    await expect(panel.getByText('Chart unavailable: no exchange-qualified ticker.')).toBeVisible();
    await expect(chart).toHaveCount(0);
    assert.equal(fixture.writes.length, 0, 'chart browsing must not modify application data');
});

async function assertPanelTabsFit(panel) {
    const tabs = await panel.getByRole('tablist', { name: 'Panel view' }).getByRole('tab').evaluateAll(elements => elements.map(el => {
        const rect = el.getBoundingClientRect();
        const icon = el.querySelector('svg').getBoundingClientRect();
        return { left: rect.left, right: rect.right, height: rect.height, text: el.textContent.trim(), title: el.title, iconSize: icon.width, iconOffset: Math.abs(icon.x + icon.width / 2 - rect.x - rect.width / 2), overflow: el.scrollWidth - el.clientWidth };
    }));
    assert.equal(tabs.length, 3);
    for (let i = 0; i < tabs.length; i++) {
        assert.ok(tabs[i].height >= 32 && tabs[i].iconSize === 20);
        assert.equal(tabs[i].text, '', 'view tabs should display symbols without visible text');
        assert.ok(tabs[i].title && tabs[i].iconOffset <= 1, 'icons need tooltips and must be centred');
        assert.ok(tabs[i].overflow <= 1, 'tab icons must fit without clipping');
        if (i) assert.ok(tabs[i - 1].right <= tabs[i].left + 1, 'tabs must not overlap');
    }
    await expect(panel.getByRole('button', { name: 'Refresh panel data' })).toHaveCount(0);
}

test('ETF management requires an explicit mode and direction without changing Core or momentum', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fixture = await mockContextPanel(page);
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    const before = { ...fixture.ledger().rows[0] };
    await panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }).click();
    await page.getByRole('button', { name: 'Management mode for ASX:GOLD' }).click();
    const editor = page.getByLabel('Management for ASX:GOLD', { exact: true });
    await editor.getByRole('radio', { name: 'TMS', exact: true }).check();
    await expect(editor.getByRole('button', { name: 'Save mode' })).toBeDisabled();
    assert.equal(fixture.writes.length, 0);
    await editor.getByRole('radio', { name: 'Buy', exact: true }).check();
    assert.equal(fixture.writes.length, 0, 'choosing a direction must not submit');
    await page.screenshot({ path: '/tmp/etf-management-editor.png' });
    await editor.getByRole('button', { name: 'Save mode' }).click();
    await expect(editor.getByRole('status')).toContainText('Mode saved');
    assert.equal(fixture.writes.length, 1);
    assert.deepEqual(fixture.writes[0].payload, { mode: 'tms', previous_mode: 'etf_tms', initial_state: 'BUY' });
    for (const key of ['core_ratio_pct', 'momentum_influence_pct', 'momentum_weight_pct', 'asset_class', 'recommended_target_value']) {
        assert.equal(fixture.ledger().rows[0][key], before[key], `${key} must stay unchanged`);
    }
    await editor.getByRole('button', { name: 'Open Alerts' }).click();
    await expect(page).toHaveURL(/#\/alerts/);
    await expect(page.getByRole('checkbox', { name: 'Initialise CDF for Gold Core ETF', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Initialise TMS for Gold Core ETF', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Initialise ETF TMS for Gold Core ETF', exact: true })).toHaveCount(0);
    await page.reload();
    const gold = page.getByTestId('context-panel').getByRole('button', { name: 'Configure Core ETF ASX:GOLD' });
    await gold.click();
    await expect(page.getByRole('button', { name: 'Management mode for ASX:GOLD' })).toHaveText('TMS');
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true }).locator('[title="No connections - missing CDF + TMS"] > div')).toHaveClass('bg-red-500');
    await page.getByTestId('main-tab-analysis').click();
    await expect(page.locator('.analysis-stock-row').filter({ hasText: 'Gold Core ETF' })
        .locator('.analysis-connection-lane > div')).toHaveAttribute('title', 'No connections - missing CDF + TMS');
});

test('management save failures keep the old mode and Core policy', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fixture = await mockContextPanel(page);
    fixture.failures.add('/api/etf/management/ASX%3AGOLD');
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    await panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }).click();
    await page.getByRole('button', { name: 'Management mode for ASX:GOLD' }).click();
    const editor = page.getByLabel('Management for ASX:GOLD', { exact: true });
    await editor.getByRole('radio', { name: 'TMS', exact: true }).check();
    await editor.getByRole('radio', { name: 'Sell', exact: true }).check();
    await editor.getByRole('button', { name: 'Save mode' }).click();
    await expect(editor.getByRole('alert')).toContainText('Isolated failure fixture');
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.ledger().rows[0].core_ratio_pct, 25);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }).click();
    await expect(page.getByRole('button', { name: 'Management mode for ASX:GOLD' })).toHaveText('ETF');
});

test('portfolio tools migration: views, Core edits, selection, shape memo and responsive bounds', { timeout: 180000 }, async t => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(10000);
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    const fixture = await mockContextPanel(page);
    t.after(async () => {
        if (process.env.CONTEXT_PANEL_DEBUG) {
            await page.screenshot({ path: '/tmp/context-panel-debug.png', fullPage: true });
            console.log((await page.locator('body').innerText()).slice(0, 7000));
        }
        await browser.close();
    });
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    await expect(panel.getByRole('tab', { name: 'ETFs', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const name of ['ETFs', 'Security', 'Shape']) await expect(panel.getByRole('tab', { name, exact: true })).toBeVisible();
    await expect(panel.getByRole('combobox', { name: 'Panel view' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Close tools panel' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' })).toBeVisible();
    await expect(panel.getByRole('region', { name: 'ETF allocations', exact: true }).getByText('+$750', { exact: true })).toBeVisible();
    assert.equal(fixture.reads.includes('/api/portfolio-implementation'), false);
    await expect(page.getByTestId('unfunded-core-target')).toHaveCount(0);
    await expect(page.locator('tr.positions-core-target-row')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Unfunded Core targets' })).toHaveCount(0);
    const fundRow = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Core ETF' });
    const ratioChip = fundRow.locator('.positions-core-etf-chip');
    await expect(ratioChip).toHaveText('1:4');
    await expect(ratioChip).toHaveCSS('height', '13px');
    await expect(ratioChip).toHaveCSS('border-radius', '3px');
    await expect(ratioChip).toHaveCSS('padding-left', '6px');
    await expect(ratioChip).toHaveCSS('margin', '2px');
    await expect(fundRow).toHaveCSS('border-radius', '12px');
    await expect(fundRow).toHaveCSS('background-color', 'color(srgb 0.490196 0.827451 0.988235 / 0.04)');
    await expect(fundRow).toHaveCSS('box-shadow', 'color(srgb 0.490196 0.827451 0.988235 / 0.08) 0px 0px 5px 1px inset');
    await expect(fundRow.locator('[data-etf-allocation]')).toHaveCount(0);
    await expect(fundRow.getByRole('button', { name: /Configure Core ETF|Set Core/ })).toHaveCount(0);
    const stockRow = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' });
    for (const width of [1600, 1280, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const fundBounds = await fundRow.boundingBox();
        const stockBounds = await stockRow.boundingBox();
        assert.ok(Math.abs(fundBounds.height - stockBounds.height) <= 1, 'ETF rows must retain normal security row height');
        const name = await fundRow.getByText('Gold Core ETF', { exact: true }).boundingBox();
        const chip = await ratioChip.boundingBox();
        assert.ok(Math.abs(name.y + name.height / 2 - chip.y - chip.height / 2) <= 1, 'ratio chip stays beside the name on the same line');
        assert.ok(chip.x >= name.x + name.width, 'ratio must not overlap the security name');
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await ratioChip.click();
    await expect(page.getByRole('radiogroup', { name: 'Core share of asset class' })).toHaveCount(0);
    assert.equal(fixture.writes.length, 0, 'the Positions chip is read-only');
    await fundRow.locator('td').first().dblclick();
    await expect(panel.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }).click();
    await page.getByRole('radio', { name: '1:2', exact: true }).click();
    await page.keyboard.down('ArrowDown');
    await expect(page.getByRole('radio', { name: '1:1', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.up('ArrowDown');
    await page.keyboard.down('ArrowUp');
    await expect(page.getByRole('radio', { name: '1:2', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.up('ArrowUp');
    assert.equal(fixture.writes.length, 0, 'ratio choice must not submit');
    await page.getByRole('button', { name: 'Core', exact: true }).click();
    await expect(ratioChip).toHaveText('1:2');
    assert.equal(fixture.writes[0].payload.core_ratio_pct, 50);
    await panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }).click();
    await page.getByRole('button', { name: 'Non-Core', exact: true }).click();
    await expect(ratioChip).toHaveCount(0);
    await expect(fundRow.getByText('Set Core', { exact: true })).toHaveCount(0);
    await expect(fundRow).not.toHaveClass(/is-core-etf/);
    await expect(panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' })).toHaveText('Set Core');
    await panel.getByRole('tab', { name: 'ETFs', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Numbers', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Ring fill', exact: true })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Capital map', exact: true }).click();
    await expect(panel.getByLabel('ETF capital map', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('ETF line allocations', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Configure Core ETF ASX:SILV' })).toHaveCount(1);
    await page.screenshot({ path: '/tmp/context-panel-etf-desktop.png' });
    await panel.getByRole('tab', { name: 'Shape', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Reference portfolio shape' }).selectOption('shape:3');
    await expect(panel.getByRole('cell', { name: '30.0%', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Read associated memo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Portfolio memo' });
    await expect(dialog.getByText('Saved fixture memo for the selected approval.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(panel.getByRole('tab', { name: 'Shape', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('combobox', { name: 'Reference portfolio shape' })).toHaveValue('shape:3');
    await page.getByRole('button', { name: 'Collapse portfolio tools', exact: true }).click();
    await expect.poll(() => page.getByTestId('shell-right-rail').evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(14);
    const producer = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' });
    await producer.click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha-edge-shell-ui')).layout.right), 'snapped');
    await producer.locator('td').first().dblclick();
    await expect(page).toHaveURL(/#\/positions/);
    await expect(panel.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.getByTestId('shell-right-rail').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(200);
    await expect(panel.getByRole('combobox', { name: 'Inspect security' })).toHaveCount(0);
    await expect(panel.getByRole('searchbox')).toHaveCount(0);
    await expect(panel.getByText('Gold Producer', { exact: true })).toBeVisible();
    await expect(panel.getByText('Research score', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Performance history', exact: true }).click();
    await expect(page).toHaveURL(/#\/history/);
    await expect.poll(() => fixture.reads.includes('/api/performance/security/STOCK')).toBe(true);
    await panel.getByRole('button', { name: 'Open research' }).click();
    await expect(page).toHaveURL(/#\/analysis/);
    await expect(panel.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true');
    const analysisRows = page.locator('tr.analysis-stock-row');
    await expect(analysisRows).toHaveCount(1);
    await expect(analysisRows.first()).toContainText('Gold Producer');
    // Explicit selection updates context, not mode or the saved rail state.
    await panel.getByRole('tab', { name: 'Shape', exact: true }).click();
    await analysisRows.first().click();
    await expect(panel.getByRole('tab', { name: 'Shape', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Collapse portfolio tools', exact: true }).click();
    await expect.poll(() => page.getByTestId('shell-right-rail').evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(14);
    await analysisRows.first().click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha-edge-shell-ui')).layout.right), 'snapped');
    await expect.poll(() => page.getByTestId('shell-right-rail').evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(14);
    for (const width of [1366, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 1366) await page.getByTitle('Switch to light mode', { exact: true }).click();
        if (width <= 768) {
            await page.getByRole('button', { name: 'Open portfolio tools' }).click();
            await expect(panel).toBeVisible();
            await assertPanelTabsFit(panel);
            await panel.getByRole('tab', { name: 'ETFs', exact: true }).click();
            await expect(panel.getByRole('button', { name: 'Capital map', exact: true })).toHaveAttribute('aria-pressed', 'true');
            const bounds = await panel.boundingBox();
            assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
            const overflow = await panel.evaluate(el => el.scrollWidth - el.clientWidth);
            assert.ok(overflow < 2, `panel overflow ${overflow}px at ${width}`);
            const coreButton = panel.getByRole('button', { name: 'Configure Core ETF ASX:SILV' });
            await coreButton.click();
            const editor = page.getByLabel('Core allocation for ASX:SILV', { exact: true });
            const editorBounds = await editor.boundingBox();
            assert.ok(editorBounds.x >= 0 && editorBounds.x + editorBounds.width <= width);
            await page.keyboard.press('Escape');
            await page.screenshot({ path: `/tmp/context-panel-${width}.png` });
            await page.getByRole('button', { name: 'Close Portfolio tools', exact: true }).click();
        }
    }
    assert.deepEqual(failures, []);
    assert.equal(fixture.writes.filter(write => write.unexpected).length, 0);
});

test('Positions Core shading and ratio chips invert across every light theme', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await mockContextPanel(page);
    await page.goto(`${base}/#/positions`);
    const row = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Core ETF' });
    const chip = row.locator('.positions-core-etf-chip');
    await expect(chip).toBeVisible();
    const darkTheme = await page.locator('html').getAttribute('data-theme');
    for (const theme of ['terminal-light-soft', 'theme1-light', 'amber-light', 'catppuccin-light', 'vintage-light']) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        await expect(row).toHaveCSS('background-color', 'color(srgb 0.0117647 0.411765 0.631373 / 0.04)');
        await expect(row).toHaveCSS('box-shadow', 'color(srgb 0.0117647 0.411765 0.631373 / 0.08) 0px 0px 5px 1px inset');
        await expect(chip).toHaveCSS('color', 'rgb(7, 89, 133)');
        await expect(chip).toHaveCSS('background-color', 'color(srgb 0.0117647 0.411765 0.631373 / 0.12)');
        await expect(row).toHaveCSS('border-radius', '12px');
        await expect(chip).toHaveCSS('margin', '2px');
    }
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), darkTheme);
    await expect(row).toHaveCSS('background-color', 'color(srgb 0.490196 0.827451 0.988235 / 0.04)');
    await expect(chip).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('two-row ETF line chips retain readable amounts and a click-positioned Core menu at 100% zoom', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const fixture = await mockContextPanel(page);
    for (const width of [1280, 1440, 1920, 2560, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/#/positions`);
        if (width === 390) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        const panel = page.getByTestId('context-panel');
        const gold = panel.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true });
        const core = gold.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' });
        await expect(gold).toBeVisible();
        await waitForRailLayout(page);
        const bounds = await gold.boundingBox();
        assert.ok(bounds.height <= (width >= 1024 ? 68 : 82), 'normal cards retain two compact text rows and a separate full-width line');
        const ticker = gold.getByText('GOLD', { exact: true });
        const fundName = gold.getByText('Gold Core ETF', { exact: true });
        await expect(fundName).toHaveCSS('font-size', '11px');
        const tickerBox = await ticker.boundingBox();
        const connectionBox = await gold.locator('[title="Full monitoring (ETF TMS)"] > div').boundingBox();
        assert.ok(Math.abs(connectionBox.height - 9.6) < .1, 'connection bar matches the production 9.6px indicator');
        assert.ok(Math.abs(connectionBox.width - 3.2) < .1, 'connection bar retains the production width');
        assert.ok(Math.abs(tickerBox.x - connectionBox.x - connectionBox.width - 4.8) < .1, 'production spacing separates the indicator and ticker');
        assert.ok(Math.abs(connectionBox.y + connectionBox.height / 2 - tickerBox.y - tickerBox.height / 2) <= .5, 'connection bar stays centred on the ticker');
        const nameBox = await fundName.boundingBox();
        assert.ok(Math.abs(nameBox.y - tickerBox.y) < 1, 'fund name shares the identity row');
        const difference = gold.getByRole('button', { name: /^ASX:GOLD allocation difference:/ });
        if (await difference.getAttribute('aria-pressed') === 'false') await difference.click();
        const heldBox = await gold.getByText('$3,000', { exact: true }).boundingBox();
        const deltaBox = await gold.getByText('+$1,500', { exact: true }).boundingBox();
        const fillBox = await gold.getByRole('img').boundingBox();
        assert.ok(fillBox.y >= heldBox.y + heldBox.height + 2, 'funding has breathing room above the bar');
        assert.ok(heldBox.y >= tickerBox.y + tickerBox.height, 'held/target sits below the identity');
        assert.ok(Math.abs(heldBox.x - tickerBox.x) < 1, 'ticker and funding share the left inset');
        assert.ok(Math.abs(heldBox.y + heldBox.height / 2 - deltaBox.y - deltaBox.height / 2) < 1, 'amounts and difference share the funding row');
        assert.ok(fillBox.y >= deltaBox.y + deltaBox.height, 'the line cannot run behind any text');
        assert.ok(fillBox.y + fillBox.height <= bounds.y + bounds.height - 1, 'fill stays inside the chip');
        assert.ok(Math.abs(fillBox.x - tickerBox.x) < 1);
        assert.ok(Math.abs(fillBox.x + fillBox.width - deltaBox.x - deltaBox.width) < 1, 'line spans the full financial row');
        for (const text of ['$3,000', '$1,500', '+$1,500']) {
            const amount = gold.getByText(text, { exact: true });
            const rect = await amount.boundingBox();
            assert.ok(rect.x >= bounds.x && rect.x + rect.width <= bounds.x + bounds.width - 5, 'amounts remain inside their chip');
            assert.ok(await amount.evaluate(el => el.scrollWidth <= el.clientWidth), 'amounts never truncate');
            assert.ok(await amount.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 12), 'no miniature numeric labels');
        }
        await core.click({ position: { x: 12, y: 12 } });
        const editor = page.getByLabel('Core allocation for ASX:GOLD', { exact: true });
        await expect(editor).toBeVisible();
        const menu = await editor.boundingBox();
        assert.ok(menu.x >= 0 && menu.x + menu.width <= width, 'menu stays inside the viewport');
        assert.ok(Math.abs(menu.x - Math.min(bounds.x + 12, width - menu.width - 12)) <= 2, 'pointer menu opens at the click, clamped at the viewport edge');
        await expect(editor.getByRole('button', { name: 'Core', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(editor.getByRole('button', { name: /Save Core|Remove Core/ })).toHaveCount(0);
        await editor.getByRole('radio', { name: '1:2', exact: true }).click();
        assert.equal(fixture.writes.length, 0, 'opening and changing a ratio never submits');
        await page.keyboard.press('Escape');
        await core.focus();
        await page.keyboard.press('Enter');
        await expect(editor).toBeVisible();
        await expect(editor.getByRole('radio', { name: '1:4', exact: true })).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');
        await panel.screenshot({ path: `/tmp/etf-line-restored-${width}.png` });
    }
});

test('two-row ETF cards preserve large amounts and empty or unknown targets across themes', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    const fixture = await mockContextPanel(page);
    const rows = fixture.ledger().rows;
    Object.assign(rows[0], { actual_value: 1234567, effective_target_value: 234567, asset_class_name: 'Rare Earths & Critical Minerals', tactical_status: 'SELL' });
    Object.assign(rows[1], { is_core: false, actual_value: 436, asset_class_name: '', asset_class: 'UNASSIGNED' });
    rows.push({ ...rows[0], ticker: 'ASX:EMPTY', actual_value: 0, effective_target_value: 750 });
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    await expect(panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' })).toBeVisible();
    const darkTheme = await page.locator('html').getAttribute('data-theme');
    for (const width of [1280, 1920, 390]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 390) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        await waitForRailLayout(page);
        for (const theme of ['light', 'dark']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme === 'light' ? 'terminal-light-soft' : darkTheme);
            for (const [ticker, amount, difference] of [['GOLD', '$1,234,567', '+$1,000,000'], ['SILV', '$436', '\u2014'], ['EMPTY', '$0', '\u2212$750']]) {
                const card = panel.getByRole('group', { name: `ASX:${ticker} ETF allocation`, exact: true });
                const toggle = card.getByRole('button', { name: new RegExp(`^ASX:${ticker} allocation difference:`) });
                if (await toggle.isEnabled() && await toggle.getAttribute('aria-pressed') === 'false') await toggle.click();
                const bounds = await card.boundingBox();
                const baseHeight = width >= 1024 ? 62 : 76;
                assert.ok(bounds.height >= baseHeight && bounds.height <= baseHeight + 36, 'exceptional money lengths may wrap without clipping');
                const tickerBox = await card.getByText(ticker, { exact: true }).boundingBox();
                const amountBox = await card.getByText(amount, { exact: true }).boundingBox();
                assert.ok(amountBox.y >= tickerBox.y + tickerBox.height, 'large held amounts stay below the identity');
                assert.ok(Math.abs(amountBox.x - tickerBox.x) < 1, 'large amounts share the ticker inset');
                const pairBox = await card.locator('[class*="amountPair"]').boundingBox();
                for (const label of await card.locator('[data-signal]').all()) {
                    const labelBox = await label.boundingBox();
                    assert.ok(labelBox.y + labelBox.height <= pairBox.y, 'signal stays in the identity row above funding');
                    assert.ok(labelBox.x + labelBox.width <= bounds.x + bounds.width - 5);
                    await expect(label).toHaveText('SELL');
                }
                for (const text of [amount, difference]) {
                    const value = text === difference ? toggle : card.getByText(text, { exact: true });
                    const box = await value.boundingBox();
                    assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width - 5);
                    assert.ok(await value.evaluate(el => el.scrollWidth <= el.clientWidth), `${text} must remain untruncated`);
                }
                const line = card.getByRole('img');
                assert.ok((await line.boundingBox()).width > 24, 'the fill must remain a readable line');
                if (ticker !== 'GOLD') {
                    await expect(line.locator('span').first()).toHaveCSS('width', '0px');
                    await expect(line.locator('span').last()).toHaveCSS('width', '0px');
                }
            }
            await expect(panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' })).toHaveAttribute('title', /Rare Earths & Critical Minerals/);
            await expect(panel.getByRole('button', { name: 'Configure Core ETF ASX:SILV' })).toHaveAttribute('title', /Unassigned/);
            await panel.screenshot({ path: `/tmp/etf-two-row-${width}-${theme}.png` });
        }
    }
    assert.deepEqual(fixture.writes, []);
});

test('ETF allocation cards and Portfolio summary share the lighter background across themes without restyling the capital map', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fixture = await mockContextPanel(page);
    fixture.ledger().rows[1].is_core = false;
    fixture.ledger().rows[1].actual_value = 100;
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    const gold = panel.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true });
    const silver = panel.getByRole('group', { name: 'ASX:SILV ETF allocation', exact: true });
    const background = chip => chip.evaluate(el => getComputedStyle(el).backgroundColor);
    const backgrounds = [];
    for (const light of [false, true]) {
        if (light) await page.getByTitle('Switch to light mode', { exact: true }).click();
        await page.mouse.move(0, 0);
        await expect(gold).toBeVisible();
        await expect.poll(() => background(gold)).toBe(await background(silver));
        await expect.poll(() => background(page.getByTestId('sleeve-summary'))).toBe(await background(gold));
        backgrounds.push(await background(gold));
        await expect(gold).toHaveCSS('border-top-width', '0px');
        await expect(gold).toHaveCSS('border-bottom-width', '1px');
        await panel.getByRole('button', { name: 'Capital map', exact: true }).click();
        await page.mouse.move(0, 0);
        await expect.poll(() => background(panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }))).not.toBe(backgrounds.at(-1));
        await panel.getByRole('button', { name: 'Line fill', exact: true }).click();
    }
    assert.notEqual(backgrounds[0], backgrounds[1]);
    assert.equal(fixture.writes.length, 0);
});

test('ETF capital map spans the rail with readable small blocks and unchanged allocation sizing', { timeout: 90000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const fixture = await mockContextPanel(page);
    const rows = fixture.ledger().rows;
    for (const [ticker, actual] of [['COPJ', 800], ['NUCL', 400], ['SEMI', 200], ['ARMR', 100], ['VPN', 50], ['FANG', 25], ['LSF', 1]]) {
        rows.push({ ...rows[0], ticker: `ASX:${ticker}`, actual_value: actual, effective_target_value: actual, asset_class_name: 'Broad Equity' });
    }
    for (const width of [1280, 1440, 1920, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/#/positions`);
        if (width < 1024) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        const panel = page.getByTestId('context-panel');
        await panel.getByRole('button', { name: 'Capital map', exact: true }).click();
        await waitForRailLayout(page);
        const map = panel.getByLabel('ETF capital map', { exact: true });
        await expect(map).toHaveCSS('height', '400px');
        const rail = await page.getByTestId('context-panel-scroll').evaluate(el => ({ x: el.getBoundingClientRect().x + el.clientLeft, width: el.clientWidth }));
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            for (const row of rows) {
                const card = map.getByRole('button', { name: `Configure Core ETF ${row.ticker}`, exact: true });
                const ticker = card.getByText(row.ticker.split(':')[1], { exact: true });
                const values = card.locator('[class*="values"]');
                await expect(ticker).toHaveCSS('font-size', '12.5px');
                await expect(values).toHaveCSS('font-size', '11.5px');
                await expect(card.locator('[class*="assetClass"]')).toHaveCSS('font-size', '11px');
                const bounds = await card.boundingBox();
                assert.ok(Math.abs(bounds.x - rail.x) <= 1 && Math.abs(bounds.width - rail.width) <= 1, 'capital-map borders reach both edges of the rail');
                assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth), 'capital-map cards do not overflow the rail');
                const nameBounds = await ticker.boundingBox();
                const amountBounds = await values.boundingBox();
                assert.ok(nameBounds.x + nameBounds.width < amountBounds.x, 'ticker and amounts must not collide');
                for (const rect of [nameBounds, amountBounds]) {
                    assert.ok(rect.x >= bounds.x && rect.x + rect.width <= bounds.x + bounds.width - 6);
                    assert.ok(rect.y >= bounds.y + 2 && rect.y + rect.height <= bounds.y + bounds.height - 2, 'text fits even the smallest block');
                }
                assert.ok(await values.evaluate(el => el.scrollWidth <= el.clientWidth), 'amounts remain fully visible');
                const span = rows.reduce((sum, fund) => sum + Math.max(fund.actual_value, fund.effective_target_value, 1), 0);
                assert.ok(Math.abs(Number(await card.evaluate(el => getComputedStyle(el).flexGrow)) - Math.max(row.actual_value, row.effective_target_value, 1) / span) < 1e-5);
            }
            await panel.screenshot({ path: `/tmp/etf-capital-map-${width}-${theme}.png` });
        }
        await map.getByRole('button', { name: 'Configure Core ETF ASX:GOLD', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByLabel('Core allocation for ASX:GOLD', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
    }
    assert.deepEqual(fixture.writes, []);
});

test('compact ETF cards and Positions details retain keyboard, theme and mobile behavior', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fixture = await mockContextPanel(page);
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    const gold = panel.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true });
    await expect(gold.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' })).toHaveAttribute('title', 'Gold Core ETF: $3,000 held / $1,500 target. Gold Miners');
    await assertPanelTabsFit(panel);
    await panel.getByRole('tab', { name: 'ETFs', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(panel.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByText('No security selected.', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(panel.getByRole('tab', { name: 'Shape', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(panel.getByRole('tab', { name: 'ETFs', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/#\/positions/);
    const goldLine = gold.getByRole('img');
    await expect(goldLine.locator('span').first()).toHaveAttribute('style', 'width: 80%;');
    await expect(goldLine.locator('span').last()).toHaveAttribute('style', 'left: 80%; width: 20%;');
    await expect(gold).toHaveCSS('border-top-width', '0px');
    await expect(gold).toHaveCSS('box-shadow', 'none');
    await expect(panel.getByRole('group', { name: 'ASX:SILV ETF allocation', exact: true }).getByRole('img').locator('span').last()).toHaveCSS('width', '0px');
    await expect(gold).toHaveCSS('border-top-left-radius', '0px');
    await expect(gold.getByText('GOLD', { exact: true })).toHaveCSS('font-size', '13px');
    await expect(gold.getByText('Gold Core ETF', { exact: true })).toHaveCSS('font-size', '11px');
    await expect(gold.getByText('$3,000', { exact: true })).toHaveCSS('font-size', '12px');
    await expect(gold.getByText('$1,500', { exact: true })).toBeVisible();
    const connection = gold.locator('[title="Full monitoring (ETF TMS)"]');
    const tickerBounds = await gold.getByText('GOLD', { exact: true }).boundingBox();
    const connectionBounds = await connection.locator('div').boundingBox();
    assert.ok(Math.abs(connectionBounds.height - 9.6) < .1);
    assert.ok(Math.abs(connectionBounds.y + connectionBounds.height / 2 - tickerBounds.y - tickerBounds.height / 2) <= .5, 'connection line spans only the ticker');
    assert.ok(Math.abs(connectionBounds.width - 3.2) < .1);
    await expect(connection.locator('div')).toHaveClass('bg-green-500');
    const disconnected = panel.getByRole('group', { name: 'ASX:SILV ETF allocation', exact: true }).locator('[title="No ETF TMS connection"] > div');
    await expect(disconnected).toHaveClass('bg-red-500');
    const allocation = panel.getByRole('region', { name: 'ETF allocations', exact: true });
    await expect(allocation.getByText('Above ETF target', { exact: true })).toHaveCount(0);
    await expect(allocation.getByText('+$750', { exact: true })).toHaveCSS('font-size', '12px');
    const allocationBounds = await allocation.boundingBox();
    assert.equal(allocationBounds.height, 89, 'the padded summary retains compact heading controls, amounts and bar');
    for (const value of await allocation.locator('[class*="summaryDifference"]').all()) {
        const rect = await value.boundingBox();
        assert.ok(rect.x >= allocationBounds.x && rect.x + rect.width <= allocationBounds.x + allocationBounds.width);
    }
    const darkBackground = await gold.evaluate(el => getComputedStyle(el).backgroundColor);
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'terminal-light-soft');
    await expect.poll(() => gold.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(darkBackground);
    const lightPixel = await gold.evaluate(el => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = getComputedStyle(el).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    });
    assert.ok(lightPixel.slice(0, 3).every(channel => channel > 150), 'light-theme cards must not retain a dark background');
    await page.screenshot({ path: '/tmp/context-panel-etf-line-light.png' });
    const fundRow = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Core ETF' });
    await fundRow.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('heading', { name: 'Gold Core ETF', exact: true })).toBeVisible();
    await expect(panel.getByTestId('security-symbol')).toHaveText('GOLD');
    await expect(panel.getByTestId('security-exchange')).toHaveText('ASX');
    await expect(panel.getByText('80-session return', { exact: true })).toBeVisible();
    await expect(panel.getByText('3.20', { exact: true })).toBeVisible();
    await expect(panel.getByText('Buy', { exact: true })).toBeVisible();
    const definitions = await panel.getByRole('tabpanel', { name: 'Security', exact: true }).locator('dd').evaluateAll(elements => elements.map(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const rect = range.getBoundingClientRect();
        const parent = el.parentElement.getBoundingClientRect();
        return { left: rect.left, right: rect.right, parentLeft: parent.left, parentRight: parent.right, overflow: el.scrollWidth - el.clientWidth };
    }));
    assert.ok(definitions.length >= 5);
    for (const value of definitions) assert.ok(value.overflow <= 1 && value.left >= value.parentLeft - 1 && value.right <= value.parentRight + 1, 'security figures must remain untruncated and inside their metric row');
    await expect(panel.getByText(/Price data/).filter({ hasText: 'T10:00:00' })).toHaveCount(0);
    await expect(page).toHaveURL(/#\/positions/);
    await page.screenshot({ path: '/tmp/context-panel-security.png' });
    await page.getByRole('button', { name: 'Collapse portfolio tools', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const producer = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' });
    await producer.locator('td').first().dblclick();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Gold Producer', exact: true })).toBeVisible();
    await expect(panel.getByRole('combobox', { name: 'Inspect security' })).toHaveCount(0);
    await expect(page).toHaveURL(/#\/positions/);
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await panel.getByRole('button', { name: 'Performance history', exact: true }).click();
    await expect(page).toHaveURL(/#\/history/);
    await expect.poll(() => fixture.reads.some(path => path.endsWith('/performance/security/STOCK'))).toBe(true);
    assert.deepEqual(fixture.writes, []);
});

test('Security spacing and hierarchy hold across rail widths and themes', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    for (const theme of ['dark', 'light']) {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        await mockContextPanel(page);
        await page.goto(`${base}/#/positions`);
        if (theme === 'light') await page.getByTitle('Switch to light mode', { exact: true }).click();
        await page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).locator('td').first().dblclick();
        const panel = page.getByTestId('context-panel');
        const details = panel.getByRole('tabpanel', { name: 'Security', exact: true });
        for (const width of [1920, 1366, 390]) {
            await page.setViewportSize({ width, height: 900 });
            if (width === 390) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
            await expect(details.getByRole('heading', { name: 'Gold Producer', exact: true })).toBeVisible();
            await expect(details.getByTestId('security-symbol')).toHaveText('STOCK');
            await expect(details.getByTestId('security-exchange')).toHaveText('ASX');
            const signals = await details.getByRole('region', { name: 'Signal evidence', exact: true }).boundingBox();
            const research = await details.getByRole('region', { name: 'Research', exact: true }).boundingBox();
            assert.ok(signals.y + signals.height <= research.y, 'current signal evidence must precede supporting research');
            await expect(details.locator('details')).toHaveJSProperty('open', false);
            const layout = await details.evaluate(el => {
                const sections = [...el.querySelectorAll('section')];
                const research = el.querySelector('section[aria-label="Research"]');
                const metrics = [...research.querySelector('dl').children].map(row => {
                    const label = row.querySelector('dt'), value = row.querySelector('dd');
                    const labelRect = label.getBoundingClientRect(), valueRect = value.getBoundingClientRect();
                    return { gap: valueRect.left - labelRect.right, topDifference: Math.abs(valueRect.top - labelRect.top), labelFont: parseFloat(getComputedStyle(label).fontSize), valueFont: parseFloat(getComputedStyle(value).fontSize), right: valueRect.right, overflow: value.scrollWidth - value.clientWidth };
                });
                return {
                    metrics,
                    headingFont: parseFloat(getComputedStyle(sections[0].querySelector('h3')).fontSize),
                    headingBottom: sections[0].querySelector('h3').getBoundingClientRect().bottom,
                    tickerTop: el.querySelector('[data-testid="security-symbol"]').getBoundingClientRect().top,
                    tickerFont: parseFloat(getComputedStyle(el.querySelector('[data-testid="security-symbol"]')).fontSize),
                    heldFont: parseFloat(getComputedStyle(sections[0].querySelector('dd')).fontSize),
                    right: research.getBoundingClientRect().right,
                    overflow: el.scrollWidth - el.clientWidth,
                    inset: research.getBoundingClientRect().left - el.closest('[data-testid="context-panel"]').getBoundingClientRect().left,
                    links: [...el.querySelectorAll('button')].map(button => ({ height: button.getBoundingClientRect().height, border: getComputedStyle(button).borderTopWidth, background: getComputedStyle(button).backgroundColor })),
                };
            });
            assert.ok(layout.inset >= 16 && layout.overflow <= 1, `Security must retain its inset without overflow at ${width}`);
            assert.ok(layout.headingFont >= 20 && layout.heldFont >= 20);
            assert.ok(layout.headingBottom < layout.tickerTop && layout.tickerFont < layout.headingFont, 'company name must precede the smaller ticker and exchange');
            for (const metric of layout.metrics) {
                assert.ok(metric.gap >= 10 && metric.topDifference <= 4, 'each research label must sit beside its value, not above a reserved blank line');
                assert.ok(metric.labelFont >= 13 && metric.valueFont > metric.labelFont && metric.valueFont < layout.heldFont);
                assert.ok(metric.overflow <= 1 && Math.abs(metric.right - layout.right) <= 1, 'research values must align to a common right edge');
            }
            for (const link of layout.links) {
                assert.ok(link.height >= (width === 390 ? 40 : 32));
                assert.equal(link.border, '0px');
                assert.equal(link.background, 'rgba(0, 0, 0, 0)');
            }
            await page.screenshot({ path: `/tmp/security-hierarchy-${theme}-${width}.png` });
        }
        const note = details.locator('details');
        await note.locator('summary').focus();
        await page.keyboard.press('Space');
        await expect(note).toHaveJSProperty('open', true);
        await expect(note.getByText('Research fixture thesis.', { exact: true })).toBeVisible();
        await page.keyboard.press('Space');
        await expect(note).toHaveJSProperty('open', false);
        await page.close();
    }
});

test('Portfolio summary stays docked below independent sidebar content', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const fixture = await mockContextPanel(page, { thesis: 'A long research paragraph to exercise the independent sidebar scroll area. '.repeat(50) });
    await page.goto(`${base}/#/positions`);
    const dock = page.getByTestId('sleeve-summary-dock');
    const panel = page.getByTestId('context-panel');
    const sidebar = page.getByTestId('portfolio-sidebar');
    const chart = dock.getByRole('img', { name: 'Portfolio summary', exact: true });
    await dock.getByRole('button', { name: 'Show current portfolio shape' }).click();
    await expect(chart).toBeVisible();
    const assertDocked = async () => {
        const bounds = await dock.boundingBox();
        const parent = await sidebar.boundingBox();
        const workspace = await page.getByTestId('sidebar-workspace').boundingBox();
        const summary = await dock.getByTestId('sleeve-summary').boundingBox();
        const geometry = await dock.evaluate(el => ({
            padding: getComputedStyle(el).padding,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
        }));
        assert.equal(geometry.padding, '0px', 'the dock must not add an outer gutter');
        assert.ok(geometry.scrollWidth <= geometry.clientWidth, 'summary must fit without horizontal scrolling');
        assert.ok(Math.abs(summary.x + summary.width - bounds.x - bounds.width) <= 1, 'widget surface must reach the right edge of its dock');
        if (geometry.scrollHeight <= geometry.clientHeight) {
            assert.ok(Math.abs(summary.y + summary.height - bounds.y - bounds.height) <= 1, 'widget surface must reach the bottom edge, not just its wrapper');
        }
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1);
        assert.ok(Math.abs(bounds.y + bounds.height - parent.y - parent.height) <= 1, 'summary must sit at the bottom of the right sidebar');
        assert.ok(Math.abs(bounds.y + bounds.height - page.viewportSize().height) <= 2, 'summary must stay at the viewport bottom');
        assert.ok(workspace.y + workspace.height <= bounds.y + 1, 'workspace must stop above the dock, not overlap it');
        assert.ok(workspace.height >= parent.height / 2 - 1, 'short screens must retain usable space above the widget');
        return bounds;
    };
    const initial = await assertDocked();
    await page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Producer' }).locator('td').first().dblclick();
    await expect(panel.getByRole('heading', { name: 'Gold Producer', exact: true })).toBeVisible();
    assert.equal(Math.round((await assertDocked()).y), Math.round(initial.y), 'selecting Security must not move the widget');
    await panel.locator('summary').filter({ hasText: 'Research note' }).click();
    const scroll = page.getByTestId('context-panel-scroll');
    assert.equal(await scroll.getByTestId('sleeve-summary-dock').count(), 0, 'summary must be outside the scrolling workspace');
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    assert.equal(Math.round((await assertDocked()).y), Math.round(initial.y), 'scrolling long research must not move the widget');
    for (const view of ['Shape', 'ETFs', 'Security']) {
        await panel.getByRole('tab', { name: view, exact: true }).click();
        assert.equal(Math.round((await assertDocked()).y), Math.round(initial.y));
        await expect(chart).toBeVisible();
    }
    await dock.getByRole('button', { name: 'Compare with current allocation', exact: true }).click();
    const comparison = dock.getByRole('img', { name: 'Approved asset-class targets compared with current holdings', exact: true });
    await expect(comparison).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('buy-flow:start', { detail: {} })));
    await expect(page.getByTestId('buy-decision-flow-panel')).toBeVisible();
    await expect(comparison).toBeVisible();
    await assertDocked();
    await page.getByTestId('buy-flow-close').click();
    await expect(comparison).toBeVisible();
    await page.getByRole('button', { name: 'Collapse portfolio tools', exact: true }).click();
    await expect.poll(() => page.getByTestId('shell-right-rail').evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(14);
    await expect(comparison).not.toBeInViewport();
    await page.getByRole('button', { name: 'Expand portfolio tools', exact: true }).click();
    await expect(comparison).toBeInViewport();
    await expect.poll(async () => Math.abs((await dock.boundingBox()).x + (await dock.boundingBox()).width - page.viewportSize().width)).toBeLessThan(2);
    for (const size of [{ width: 1366, height: 768 }, { width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        if (size.width === 390) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        await assertDocked();
        await expect(dock).toBeVisible();
        await page.screenshot({ path: `/tmp/sleeve-dock-${size.width}.png` });
    }
    await page.getByRole('button', { name: 'Close Portfolio tools', exact: true }).click();
    await expect(dock).not.toBeVisible();
    assert.deepEqual(fixture.writes, []);
});

test('Portfolio summary controls stay readable, aligned and functional in the flush dock', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    const fixture = await mockContextPanel(page);
    await page.goto(`${base}/#/positions`);
    const dock = page.getByTestId('sleeve-summary-dock');
    const summary = dock.getByTestId('sleeve-summary');
    await summary.getByRole('button', { name: 'Show current portfolio shape' }).click();
    await expect(summary.getByRole('img', { name: 'Portfolio summary', exact: true })).toBeVisible();
    for (const width of [2560, 1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 390) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        await summary.getByRole('button', { name: 'Show current portfolio shape' }).click();
        await waitForRailLayout(page);
        const size = width < 768 ? 32 : 24;
        const bounds = await summary.boundingBox();
        assert.ok(Math.abs(bounds.x + bounds.width - width) <= 1, 'widget must reach the viewport right edge');
        assert.ok(Math.abs(bounds.y + bounds.height - 900) <= 1, 'widget must reach the viewport bottom');
        const heading = await summary.getByRole('heading', { name: 'Portfolio summary', exact: true }).boundingBox();
        const collapse = await summary.getByRole('button', { name: 'Minimise widget', exact: true }).boundingBox();
        assert.ok(heading.x + heading.width < collapse.x, 'title must not collide with its control');
        if (width >= 1024) {
            const handle = await page.getByRole('button', { name: 'Collapse portfolio tools', exact: true }).boundingBox();
            assert.ok(heading.x >= handle.x + handle.width, 'title must clear the sidebar handle');
        }
        const controls = await summary.locator('[class*="header"] button, [class*="toolbar"] button').all();
        const buttonBounds = [];
        for (const button of controls) {
            const rect = await button.boundingBox();
            const icon = await button.locator('svg').boundingBox();
            assert.equal(rect.width, size);
            assert.equal(rect.height, size);
            assert.equal(icon.width, 14);
            assert.equal(icon.height, 14);
            assert.ok(Math.abs(rect.x + rect.width / 2 - icon.x - icon.width / 2) < 1);
            assert.ok(Math.abs(rect.y + rect.height / 2 - icon.y - icon.height / 2) < 1);
            assert.ok(rect.x >= bounds.x && rect.x + rect.width <= bounds.x + bounds.width);
            for (const previous of buttonBounds) {
                assert.ok(rect.x >= previous.x + previous.width || previous.x >= rect.x + rect.width ||
                    rect.y >= previous.y + previous.height || previous.y >= rect.y + rect.height,
                    'control hit areas must not overlap');
            }
            buttonBounds.push(rect);
        }
        await summary.getByRole('button', { name: 'Hide summary list', exact: true }).click();
        await expect(summary.getByRole('button', { name: 'Show summary list', exact: true })).toHaveAttribute('aria-pressed', 'false');
        await summary.getByRole('button', { name: 'Show summary list', exact: true }).click();
        await expect(summary.getByRole('button', { name: 'Show sleeve weights', exact: true })).toHaveCount(0);
        await expect(summary.getByRole('group', { name: 'Summary view', exact: true }).getByRole('button')).toHaveCount(2);
        await summary.getByRole('button', { name: 'Compare with current allocation', exact: true }).click();
        await expect(summary.getByRole('button', { name: 'Compare with current allocation', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(summary.getByRole('button', { name: 'Hide summary list', exact: true })).toBeVisible();
        await summary.getByRole('button', { name: 'Show current portfolio shape', exact: true }).click();
        await summary.getByRole('button', { name: 'Minimise widget', exact: true }).click();
        await expect(summary.getByRole('button')).toHaveCount(1);
        const collapsed = await summary.boundingBox();
        assert.ok(Math.abs(collapsed.y + collapsed.height - 900) <= 1, 'collapsed widget must remain bottom anchored');
        await summary.getByRole('button', { name: 'Expand widget', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(summary.getByRole('img', { name: 'Portfolio summary', exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Close Portfolio tools', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await summary.getByRole('button', { name: 'Show current portfolio shape' }).click();
    const before = await summary.evaluate(el => getComputedStyle(el).backgroundColor);
    await page.getByTitle('Switch to light mode', { exact: true }).click();
    await expect.poll(() => summary.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(before);
    for (const button of await summary.getByRole('button').all()) {
        assert.equal(await button.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    }
    await expect(summary.getByRole('img', { name: 'Portfolio summary', exact: true })).toBeVisible();
    assert.deepEqual(fixture.writes, []);
});

test('failed requests do not change Core policy or imply an updated target', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const fixture = await mockContextPanel(page);
    await page.goto(`${base}/#/positions`);
    const panel = page.getByTestId('context-panel');
    const fundRow = page.locator('tr.positions-stock-row').filter({ hasText: 'Gold Core ETF' });
    const ratioChip = fundRow.locator('.positions-core-etf-chip');
    await expect(ratioChip).toHaveText('1:4');
    fixture.failures.add('/api/etf/core-policies/GOLD_MINERS');
    await panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }).click();
    await page.getByRole('radio', { name: '1:2', exact: true }).click();
    await page.getByRole('button', { name: 'Core', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Isolated failure fixture' })).toBeVisible();
    await expect(ratioChip).toHaveText('1:4');
    assert.equal(fixture.ledger().rows[0].core_ratio_pct, 25);
    await page.keyboard.press('Escape');
    fixture.failures.add('/api/etf/allocation-ledger');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('etfAllocationPolicyChanged')));
    await expect(ratioChip).toHaveText('1:4');
    await expect(panel.getByRole('alert')).toContainText('Last loaded values shown');
    await panel.getByRole('button', { name: 'Configure Core ETF ASX:GOLD' }).click();
    await expect(page.getByRole('button', { name: 'Core', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Non-Core', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    fixture.failures.clear();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('etfAllocationPolicyChanged')));
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(ratioChip).toHaveText('1:4');
    assert.equal(fixture.writes.length, 0);
});
