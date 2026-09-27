const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

test('five alerts and five ETF chips fit laptop rails at 100% zoom without hiding either sidebar', { timeout: 120000 }, async t => {
    mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const tickers = ['STOCK', 'GOLD', 'SILV', 'COPJ', 'SEMI'];
    const ledger = fixture.ledger();
    ledger.rows = tickers.map((ticker, i) => ({ ...ledger.rows[0], ticker, display_name: `Example fund ${i}` }));
    ledger.summary.actual_etf_value = 15000;
    ledger.summary.effective_target_value = 7500;
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
        localStorage.setItem('alpha-edge-alert-stack-ui', JSON.stringify({ allAssetClassesExpanded: true, pinnedAssetClasses: {} }));
        localStorage.setItem('alpha-edge:context-panel', JSON.stringify({ state: { view: 'etf', allocationView: 'line' }, version: 0 }));
        document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = 'nextjs-portal { display: none !important; }';
            document.head.append(style);
        });
    });
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/alerts')) return route.fulfill({ json: tickers.map((ticker, i) => ({
            id: 201 + i, ticker, alert_type: ['SELL_50', 'BREAKOUT', 'UNDERPERFORM', 'TRIM', 'SELL_50'][i],
            strength: 'Strong', move_pct: -11.76, created_at: '2026-09-09T10:00:00Z',
        })) });
        if (path.endsWith('/etf/allocation-ledger')) return route.fulfill({ json: ledger });
        if (path.endsWith('/portfolio-overlay-summary')) return route.fulfill({ json: { portfolio_risk: { mode: 'Q3_THROTTLE', target_pct: 49 }, asset_classes: [] } });
        return route.fallback();
    });
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 800 }, { width: 1470, height: 800 }]) {
        await page.setViewportSize(viewport);
        await page.goto(`${base}/#/positions`);
        const left = page.getByTestId('shell-left-rail');
        const right = page.getByTestId('shell-right-rail');
        const alerts = left.locator('[data-testid^="stack-alert-"]');
        const chips = right.getByLabel('ETF line allocations', { exact: true }).getByRole('button');
        await expect(alerts).toHaveCount(5);
        await expect(chips).toHaveCount(5);
        await waitForRailLayout(page);
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            const geometry = await alerts.evaluateAll(elements => elements.map(el => {
                const rect = el.getBoundingClientRect();
                const fields = ['alertTicker', 'alertName', 'alertAge', 'signal', 'alertMove'].map(name => el.querySelector(`[class*="${name}"]`));
                const controls = [...el.querySelectorAll('a, button')].map(control => control.getBoundingClientRect());
                return { height: rect.height, fieldsFit: fields.every(field => {
                    const box = field.getBoundingClientRect();
                    return box.width > 0 && box.left >= rect.left && box.right <= rect.right - 20 && box.top >= rect.top && box.bottom <= rect.bottom;
                }), nameFont: getComputedStyle(fields[1]).fontSize, controlsApart: controls[0].bottom <= controls[1].top };
            }));
            assert.ok(geometry.every(row => row.height >= 50 && row.height <= 68 && row.fieldsFit && row.controlsApart && row.nameFont === '12px'), JSON.stringify({ viewport, geometry }));
            const groupList = await left.locator('[class*="groupList"]').boundingBox();
            const heightBudget = viewport.width <= 1280 ? 400 : viewport.height / 2;
            assert.ok(groupList.height < heightBudget, `production cards and three headers must fit the density budget (${groupList.height}px / ${heightBudget}px); long instructions may wrap in the 204px rail`);
            await expect(alerts.last()).toBeInViewport({ ratio: 1 });
            for (const chip of await chips.all()) {
                assert.equal((await chip.boundingBox()).height, 53);
                for (const text of ['$3,000', '+$1,500']) {
                    const amount = chip.getByText(text, { exact: true });
                    assert.ok(await amount.evaluate(el => el.scrollWidth <= el.clientWidth), 'dollars cannot be truncated to achieve density');
                }
            }
            await expect(chips.last()).toBeInViewport({ ratio: 1 });
            const summaryRegion = right.getByRole('region', { name: 'ETF allocations', exact: true });
            const summary = await summaryRegion.boundingBox();
            await page.screenshot({ path: `test-results/sidebar-density-${viewport.width}-${theme}.png` });
            assert.ok(summary.height >= 80 && summary.height <= 136, `summary allows heading and amount wrapping with platform fonts, while five cards stay visible: ${summary.height}px`);
            for (const text of ['$15,000', '$7,500', '+$7,500']) {
                const amount = summaryRegion.getByText(text, { exact: true });
                const bounds = await amount.boundingBox();
                assert.ok(bounds.x >= summary.x && bounds.x + bounds.width <= summary.x + summary.width
                    && bounds.y >= summary.y && bounds.y + bounds.height <= summary.y + summary.height,
                    'summary amounts must stay inside the section without clipping');
                assert.ok(await amount.evaluate(el => el.scrollWidth <= el.clientWidth));
            }
            await expect(left.getByRole('heading', { name: 'ALERT STACK' })).toBeInViewport();
            await expect(right.getByRole('tab', { name: 'ETFs', exact: true })).toBeInViewport();
            await page.screenshot({ path: `test-results/sidebar-density-${viewport.width}-${theme}.png` });
        }
    }
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('laptop density preserves company identity and class names with nine funds and older alerts', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const fixture = await mockContextPanel(page);
    const ledger = fixture.ledger();
    const funds = [['SLVR', 'Silver Miners'], ['WREE', 'Rare Earths & Critical Minerals'], ['COPJ', 'Copper Miners'], ['SEMI', 'Semiconductors'], ['JEDI', 'Defence'], ['NUCL', 'Uranium Miners'], ['DRAM', 'Semiconductors'], ['LITP', 'Lithium Miners'], ['UFO', 'Civil Aerospace']];
    ledger.rows = funds.map(([ticker, asset_class_name], i) => ({ ...ledger.rows[0], ticker, asset_class_name, actual_value: 1200 - 80 * i, effective_target_value: 1600 - 150 * i }));
    ledger.summary.actual_etf_value = 4500;
    ledger.summary.effective_target_value = 4000;
    const names = ['Astral Resources NL', 'Ausgold Limited', 'Meeka Metals Limited', 'Turaco Gold Limited', 'UAT Event Simulator'];
    const tickers = ['AAR', 'AUC', 'MEK', 'TCG', 'AEVT'];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
        localStorage.setItem('alpha-edge-alert-stack-ui', JSON.stringify({ allAssetClassesExpanded: true, pinnedAssetClasses: {} }));
        localStorage.setItem('alpha-edge:context-panel', JSON.stringify({ state: { view: 'etf', allocationView: 'line' }, version: 0 }));
    });
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/statements/latest')) return route.fulfill({ json: { statement: { id: 1, statement_date: '2026-09-09T10:00:00Z', total_value_aud: 60000, cash_aud: 300 }, holdings: tickers.map((ticker, i) => ({ id: i + 1, statement_id: 1, ticker, exchange_prefix: 'ASX:', details: names[i], quantity: 100, current_price: 30, cost_aud: 2000, value_aud: 3000, gain_loss_aud: 1000, gain_loss_pct: 50, market_value: 3000, currency: 'AUD' })) } });
        if (path.endsWith('/analysis')) return route.fulfill({ json: tickers.map((ticker, i) => ({ id: 50 + i, ticker: `ASX:${ticker}`, name: names[i], primary_asset_class: i < 4 ? 'GOLD_MINERS' : 'SILVER_MINERS' })) });
        if (path.endsWith('/groups')) return route.fulfill({ json: { groups: [{ id: 'gold', name: 'Gold Miners', asset_class_code: 'GOLD_MINERS', order: 0, collapsed: false, parent_id: null }, { id: 'silver', name: 'Silver Miners', asset_class_code: 'SILVER_MINERS', order: 1, collapsed: false, parent_id: null }], assignments: names.map((company_name, i) => ({ company_name, group_id: i < 4 ? 'gold' : 'silver' })) } });
        if (path.endsWith('/alerts')) return route.fulfill({ json: tickers.map((ticker, i) => ({ id: 201 + i, ticker, alert_type: ['SELL_50', 'SELL', 'SELL', 'BREAKOUT', 'UNDERPERFORM'][i], created_at: '2026-06-01T10:00:00Z', move_pct: i === 4 ? null : -11.76 })) });
        if (path.endsWith('/etf/allocation-ledger')) return route.fulfill({ json: ledger });
        if (path.endsWith('/alerts/active')) return route.fulfill({ json: funds.map(([ticker], i) => ({ id: i + 1, ticker: `ASX:${ticker}`, script: 'etf_tms' })) });
        if (path.endsWith('/portfolio-overlay-summary')) return route.fulfill({ json: { portfolio_risk: { mode: 'Q3_THROTTLE', target_pct: 49 }, asset_classes: [] } });
        return route.fallback();
    });
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 800 }, { width: 1470, height: 800 }]) {
        await page.setViewportSize(viewport);
        await page.goto(`${base}/#/positions`);
        await expect(page.getByTestId('stack-alert-201')).toContainText(names[0]);
        await expect(page.getByRole('button', { name: 'Configure Core ETF UFO' })).toBeVisible();
        await waitForRailLayout(page);
        await page.addStyleTag({ content: 'nextjs-portal {display:none!important}' });
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
            const alert = page.getByTestId('stack-alert-201');
            const name = alert.getByText(names[0], { exact: true });
            const nameBox = await name.boundingBox();
            const tickerBox = await alert.getByText('AAR', { exact: true }).boundingBox();
            assert.ok(nameBox.width >= 100, 'company name must not be squeezed between ticker and age');
            assert.ok(tickerBox.y >= nameBox.y + nameBox.height, 'ticker belongs with the instruction, below the company name');
            await expect(name).toHaveCSS('font-size', '12px');
            await expect(alert.locator('[class*="alertContent"]')).toHaveCSS('gap', '1.6px');
            await expect(alert.locator('[class*="alertSignals"]')).toHaveCSS('gap', '3.2px');
            await expect(alert).toHaveCSS('padding-top', '4.8px');
            for (const [ticker, className] of funds) {
                const chip = page.getByRole('button', { name: `Configure Core ETF ${ticker}` });
                const classLabel = chip.getByText(className, { exact: true });
                const classBox = await classLabel.boundingBox();
                const tickerBox = await chip.getByText(ticker, { exact: true }).boundingBox();
                assert.equal((await chip.boundingBox()).height, 53);
                assert.ok(classBox.width >= 64, 'the secondary class label keeps a readable preview beside the trend and difference');
                await expect(classLabel).toHaveAttribute('title', className);
                assert.ok(classBox.y >= tickerBox.y + tickerBox.height, 'class sits below the primary ticker row');
                await expect(classLabel).toHaveCSS('font-size', '11.5px');
                await expect(chip.getByText(ticker, { exact: true })).toHaveCSS('font-size', '13px');
                await expect(chip).toHaveCSS('padding-top', '5px');
                await expect(chip.locator('[class*="chipRow"]')).toHaveCSS('row-gap', '1px');
            }
            const visibleFunds = viewport.height >= 800 ? 7 : 6;
            const last = await page.getByRole('button', { name: `Configure Core ETF ${funds[visibleFunds - 1][0]}` }).boundingBox();
            const dock = await page.getByTestId('sleeve-summary-dock').boundingBox();
            assert.ok(last.y + last.height <= dock.y, `${visibleFunds} complete fund chips must fit above the dock at ${viewport.width}x${viewport.height}`);
            const scroll = page.getByTestId('context-panel-scroll');
            const gap = await scroll.evaluate(el => el.getBoundingClientRect().width - el.clientWidth);
            assert.ok(gap <= 6, 'only a thin active scrollbar may occupy the right edge');
            const finalFund = page.getByRole('button', { name: 'Configure Core ETF UFO' });
            await finalFund.scrollIntoViewIfNeeded();
            await expect(finalFund).toBeInViewport({ ratio: 1 });
            assert.deepEqual(await page.getByTestId('sleeve-summary-dock').boundingBox(), dock, 'scrolling the ETF list cannot move the sleeve dock');
            await scroll.evaluate(el => el.scrollTop = 0);
            await page.screenshot({ path: `test-results/sidebar-identity-${viewport.width}-${theme}.png` });
        }
    }
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});
