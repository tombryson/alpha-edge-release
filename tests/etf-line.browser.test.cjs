const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel, waitForRailLayout } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';

test('line cards group identity, funding and progress without collisions across themes and rail sizes', { timeout: 120000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const fixture = await mockContextPanel(page);
    fixture.ledger().rows.push({ ...fixture.ledger().rows[0], ticker: 'ASX:LONGTICKERNAME', display_name: 'A long fund name for narrow sidebar coverage', actual_value: 1234567, effective_target_value: 234567 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const backgrounds = [];
    for (const width of [1280, 1440, 1920, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/#/positions`);
        if (width < 1024) await page.getByRole('button', { name: 'Open portfolio tools' }).click();
        const panel = page.getByTestId('context-panel');
        const cards = panel.getByLabel('ETF line allocations', { exact: true });
        await expect(cards).toBeVisible();
        await waitForRailLayout(page);
        await expect(cards).toHaveCSS('gap', '0px');
        await expect(cards).toHaveCSS('padding', '0px');
        const rail = await page.getByTestId('context-panel-scroll').evaluate(el => ({
            x: el.getBoundingClientRect().x + el.clientLeft, width: el.clientWidth,
        }));
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(theme => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.classList.toggle('light', theme === 'terminal-light-soft');
            }, theme);
            await page.mouse.move(0, 0);
            for (const ticker of ['GOLD', 'SILV', 'LONGTICKERNAME']) {
                const card = cards.getByRole('group', { name: `ASX:${ticker} ETF allocation`, exact: true });
                const difference = card.getByRole('button', { name: new RegExp(`^ASX:${ticker} allocation difference:`) });
                if (ticker === 'GOLD') backgrounds.push(await card.evaluate(el => getComputedStyle(el).backgroundColor));
                for (const unit of ['percent', 'dollar']) {
                    const box = await card.boundingBox();
                    assert.ok(Math.abs(box.x - rail.x) <= 1 && Math.abs(box.width - rail.width) <= 1, 'rows span the rail edge to edge');
                    await expect(card).toHaveCSS('border-radius', '0px');
                    await expect(card).toHaveCSS('border-left-width', '0px');
                    await expect(card).toHaveCSS('border-right-width', '0px');
                    await expect(card).toHaveCSS('border-bottom-width', '1px');
                    const identity = await card.locator('[class*="lineIdentity"]').boundingBox();
                    const tickerBox = await card.getByText(ticker, { exact: true }).boundingBox();
                    const name = await card.locator('[class*="fundName"]').boundingBox();
                    const details = await card.locator('[class*="lineDetails"]').boundingBox();
                    const number = await difference.boundingBox();
                    const bar = await card.getByRole('img').boundingBox();
                    assert.ok(identity.y + identity.height <= details.y, 'funding sits below identity');
                    assert.ok(tickerBox.x + tickerBox.width + 5 <= name.x, 'long tickers cannot overrun the fund name');
                    assert.ok(details.x + details.width <= number.x, 'difference and amounts cannot overlap');
                    assert.ok(bar.y >= Math.max(details.y + details.height, number.y + number.height) + 2, 'bar has breathing room below funding');
                    assert.equal(bar.height, 4);
                    assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth), 'card fits the rail');
                    for (const text of await card.locator('[class*="amountPair"] > span').all()) {
                        const rect = await text.boundingBox();
                        assert.ok(rect.x >= box.x && rect.x + rect.width <= number.x, 'complete dollar amounts stay inside the funding column');
                        assert.ok(await text.evaluate(el => el.scrollWidth <= el.clientWidth), 'dollar amounts do not truncate');
                    }
                    assert.ok(number.x + number.width <= box.x + box.width - 8, 'difference stays inside card');
                    if (ticker !== 'LONGTICKERNAME') assert.ok(box.height <= (width < 1024 ? 82 : 68), 'ordinary funds stay compact');
                    await difference.click();
                    await expect(page.getByLabel(`Core allocation for ASX:${ticker}`, { exact: true })).toHaveCount(0);
                }
            }
            const gold = cards.getByRole('group', { name: 'ASX:GOLD ETF allocation', exact: true });
            const marker = await gold.locator('[title="Full monitoring (ETF TMS)"] > div').boundingBox();
            const ticker = await gold.getByText('GOLD', { exact: true }).boundingBox();
            assert.ok(Math.abs(marker.height - 9.6) < .1);
            assert.ok(Math.abs(marker.y + marker.height / 2 - ticker.y - ticker.height / 2) < .5);
            await expect(panel.locator('button button')).toHaveCount(0);
            await panel.screenshot({ path: `/tmp/etf-line-${width}-${theme}.png` });
        }
    }
    assert.notEqual(backgrounds[0], backgrounds[1]);
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.writes, []);
});

test('line progress retains the 80% target marker and safe percentage/dollar toggling for missing or zero targets', { timeout: 60000 }, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixture = await mockContextPanel(page);
    const ledger = fixture.ledger();
    const cases = [
        [0, 100, 0, 0, '\u2212100.0%', '\u2212$100'],
        [50, 100, 40, 0, '\u221250.0%', '\u2212$50'],
        [100, 100, 80, 0, '0.0%', '$0'],
        [125, 100, 80, 20, '+25.0%', '+$25'],
        [200, 100, 80, 20, '+100.0%', '+$100'],
        [500, 0, 0, 20, '\u2014', '+$500'],
        [0, 0, 0, 0, '0.0%', '$0'],
        [436, null, 0, 0, '\u2014', null],
    ];
    ledger.rows = cases.map(([actual, target], i) => ({ ...ledger.rows[0], ticker: `ASX:L${i}`, actual_value: actual, effective_target_value: target, class_not_in_shape: target === null }));
    await page.route('**/api/**', route => new URL(route.request().url()).pathname.endsWith('/etf/allocation-ledger') ? route.fulfill({ json: ledger }) : route.fallback());
    await page.goto(`${base}/#/positions`);
    const cards = page.getByLabel('ETF line allocations', { exact: true });
    for (const [i, [, target, funded, excess, percentage, dollars]] of cases.entries()) {
        const card = cards.getByRole('group', { name: `ASX:L${i} ETF allocation`, exact: true });
        const bar = card.getByRole('img');
        await expect(bar.locator('span').first()).toHaveAttribute('style', `width: ${funded}%;`);
        await expect(bar.locator('span').last()).toHaveAttribute('style', `left: 80%; width: ${excess}%;`);
        if (target > 0) {
            const track = await bar.boundingBox();
            const tick = await bar.locator('i').boundingBox();
            assert.ok(Math.abs((tick.x - track.x) / track.width - .8) < .01);
        } else await expect(bar.locator('i')).toHaveCount(0);
        const difference = card.getByRole('button', { name: new RegExp(`^ASX:L${i} allocation difference:`) });
        await expect(difference).toHaveText(percentage);
        if (target === null) {
            await expect(difference).toBeDisabled();
            await expect(bar).toHaveAttribute('aria-label', /No effective target/);
        } else {
            await difference.click();
            await expect(difference).toHaveText(dollars);
            await expect(page.getByLabel(`Core allocation for ASX:L${i}`, { exact: true })).toHaveCount(0);
            await page.keyboard.press('Space');
            await expect(difference).toHaveText(percentage);
        }
    }
    const core = cards.getByRole('button', { name: 'Configure Core ETF ASX:L0', exact: true });
    await core.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Core allocation for ASX:L0', { exact: true })).toBeVisible();
    assert.deepEqual(fixture.writes, []);
});
