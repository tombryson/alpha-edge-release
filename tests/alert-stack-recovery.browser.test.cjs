const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t) {
    mkdirSync('test-results', { recursive: true });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const state = { mode: 'Q3_THROTTLE', target: 49, alerts: [
        { id: 201, ticker: 'STOCK', alert_type: 'SELL_50', move_pct: -11.76 },
        { id: 202, ticker: 'GOLD', alert_type: 'BREAKOUT', move_pct: 9.4 },
        { id: 203, ticker: 'SILV', alert_type: 'UNDERPERFORM', move_pct: 0 },
        { id: 204, ticker: 'REGIME:SPY', alert_type: 'REGIME', signal: 'SELL', affected_positions: JSON.stringify([{ ticker: 'ASX:STOCK', action: 'Reduce', target_position_pct: 50 }]) },
    ] };
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = 'nextjs-portal { display: none !important; }';
            document.head.append(style);
        });
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'open', right: 'open' } }));
        if (!localStorage.getItem('alpha-edge-alert-stack-ui')) localStorage.setItem('alpha-edge-alert-stack-ui', JSON.stringify({ allAssetClassesExpanded: true, pinnedAssetClasses: {} }));
    });
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/alerts')) return route.fulfill({ json: state.alerts.map(a => ({ created_at: '2026-09-09T10:00:00Z', strength: 'Strong', ...a })) });
        if (path.endsWith('/portfolio-overlay-summary')) return route.fulfill({ json: { portfolio_risk: { mode: state.mode, target_pct: state.target }, asset_classes: [] } });
        return route.fallback();
    });
    await browser.contexts()[0].route('https://www.tradingview.com/**', route => route.fulfill({ body: 'Isolated chart destination' }));
    await page.goto(`${base}/#/positions`);
    const rail = page.getByTestId('shell-left-rail');
    await expect(rail.getByTestId('stack-alert-201')).toBeVisible();
    return { page, rail, fixture, errors, state };
}

test('Alert Stack restores production card typography and borders without losing evidence or theme support', { timeout: 90000 }, async t => {
    const { page, rail, fixture, errors } = await setup(t);
    await expect(rail.getByLabel('3 position alerts', { exact: true })).toBeVisible();
    await expect(rail.getByText('Q3 Detector', { exact: true })).toBeVisible();
    await expect(rail.getByText('49%', { exact: true })).toBeVisible();
    await expect(rail.getByText('Reduce to 50%', { exact: true })).toBeVisible();
    const headerStyle = await rail.getByRole('button', { name: 'Gold, 2 alerts', exact: true }).evaluate(el => {
        const header = getComputedStyle(el);
        const group = getComputedStyle(el.parentElement);
        const marker = getComputedStyle(el.querySelector('[class*="groupMarker"]'));
        return {
            left: group.borderLeftWidth, top: group.borderTopWidth,
            background: header.backgroundColor, bottom: header.borderBottomWidth,
            markerMatches: marker.backgroundColor === group.borderLeftColor,
            extraRail: getComputedStyle(el, '::before').content,
        };
    });
    assert.deepEqual(headerStyle, {
        left: '2px', top: '1px', background: 'rgba(0, 0, 0, 0)', bottom: '0px',
        markerMatches: true, extraRail: 'none',
    });
    const card = rail.getByTestId('stack-alert-201');
    const dark = await card.evaluate(el => getComputedStyle(el).backgroundColor);
    for (const theme of ['terminal-dark', 'terminal-light-soft']) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        for (const width of [1280, 1440, 1920]) {
            await page.setViewportSize({ width, height: 1080 });
            await expect.poll(() => rail.evaluate(el => el.getBoundingClientRect().width)).toBe(width > 1600 ? 288 : width > 1280 ? 224 : 204);
            const geometry = await card.evaluate(el => {
                const name = el.querySelector('[class*="alertName"]');
                const details = el.querySelector('[class*="alertDetails"]');
                const group = el.closest('[class*="groupList"]');
                const title = group.querySelector('[class*="groupTitle"]');
                const rect = el.getBoundingClientRect();
                return {
                    font: parseFloat(getComputedStyle(name).fontSize), titleFont: parseFloat(getComputedStyle(title).fontSize),
                    border: getComputedStyle(el).borderTopWidth, radius: getComputedStyle(el).borderRadius,
                    padding: getComputedStyle(el).paddingTop, gap: getComputedStyle(el.querySelector('[class*="alertContent"]')).gap,
                    detailFont: parseFloat(getComputedStyle(details).fontSize), height: rect.height, width: rect.width,
                    fits: [...details.querySelectorAll('span, a')].every(node => { const r = node.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right && r.top >= rect.top && r.bottom <= rect.bottom; }),
                    transition: getComputedStyle(el).transitionDuration,
                    evidence: [...details.querySelectorAll('span')].map(node => ({ text: node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
                };
            });
            assert.equal(geometry.font, 12);
            assert.equal(geometry.titleFont, 11);
            assert.equal(geometry.detailFont, 11);
            assert.equal(geometry.border, '1px');
            assert.equal(geometry.radius, '3px');
            assert.equal(geometry.padding, '4.8px');
            assert.equal(geometry.gap, '1.6px');
            assert.ok(geometry.fits && geometry.height >= 50 && geometry.height <= 68, JSON.stringify(geometry));
            assert.equal(geometry.transition, '0s');
            await expect(card).toContainText('Sell Down 50%');
            await expect(card).toContainText('-11.76%');
            assert.ok((await rail.getByRole('button', { name: 'Collapse all asset classes' }).boundingBox()).width >= 24);
        }
        await rail.screenshot({ path: `test-results/alert-stack-recovery-${theme}.png` });
    }
    assert.notEqual(await card.evaluate(el => getComputedStyle(el).backgroundColor), dark);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('hover preview, pinned groups, keyboard actions and History keep their existing behaviour', { timeout: 90000 }, async t => {
    const { page, rail, fixture, errors } = await setup(t);
    await rail.getByRole('button', { name: 'Collapse all asset classes' }).click();
    await rail.getByRole('heading', { name: 'ALERT STACK', exact: true }).hover();
    const group = rail.getByRole('button', { name: 'Gold, 2 alerts', exact: true });
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(rail.getByTestId('stack-alert-201')).not.toBeVisible();
    await group.hover();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await group.click();
    await rail.getByRole('heading', { name: 'ALERT STACK', exact: true }).hover();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await expect(group).toHaveAttribute('title', 'Unpin group');
    await expect(group.locator('svg.lucide-pin')).toBeVisible();
    const card = rail.getByTestId('stack-alert-201');
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Confirm Sell 50%', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const chart = card.getByRole('link');
    await expect(chart).toHaveAttribute('href', /symbol=ASX%3ASTOCK/);
    await chart.focus();
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await popup.close();
    await expect(page.getByText('Confirm Sell 50%', { exact: true })).toHaveCount(0);
    await rail.getByRole('button', { name: 'Decision history', exact: true }).click();
    await expect(page).toHaveURL(/#\/history/);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(errors, []);
});

test('Q4 and empty states use the existing risk payload, without a fabricated normal notice', { timeout: 90000 }, async t => {
    const { page, rail, state, errors } = await setup(t);
    state.mode = 'Q4_CRISIS'; state.target = 10;
    await page.reload();
    await expect(rail.getByText('Q4 Detector', { exact: true })).toBeVisible();
    await expect(rail.getByText('Crisis', { exact: true })).toBeVisible();
    await expect(rail.getByText('10%', { exact: true })).toBeVisible();
    await expect(rail.getByText('Q3 Detector', { exact: true })).toHaveCount(0);
    state.mode = 'NORMAL'; state.alerts = [];
    await page.reload();
    await expect(rail.getByText('No active alerts', { exact: true })).toBeVisible();
    await expect(rail.getByText('PORTFOLIO RISK', { exact: true })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'Decision history', exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
});
