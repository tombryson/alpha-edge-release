const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3100';

async function setup(t, options = {}) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
    });
    const fixture = await mockContextPanel(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const stage = (key, status, label) => ({
        key,
        scope: 'THEME',
        status,
        label,
        source: { label },
        order: 1,
    });
    const themes = [
        {
            code: 'GOLD',
            display_name: 'Gold',
            equity_sleeve: { asset_class_code: 'GOLD_MINERS' },
            stages: [
                stage('COMMODITY', 'CONFIRMED', 'Gold price'),
                stage('EQUITY_RELATIVE', 'BLOCKED', 'GDX / GLD'),
            ],
            eligible_securities: [
                {
                    ticker: 'ASX:STOCK',
                    stage_states: { SECURITY_OUTPERFORM: 'BLOCKED' },
                },
            ],
        },
        {
            code: 'SILVER',
            display_name: 'Silver',
            equity_sleeve: { asset_class_code: 'SILVER_MINERS' },
            stages: [
                stage('COMMODITY', 'DISCONNECTED', 'Silver price'),
                stage('EQUITY_RELATIVE', 'CONFIRMED', 'SILJ / SLV'),
            ],
            eligible_securities: [],
        },
        {
            code: 'RARE_EARTHS',
            display_name: 'Rare Earths & Critical Minerals',
            equity_sleeve: { asset_class_code: 'RARE_EARTHS' },
            stages: [
                stage('COMMODITY', 'WAITING', 'Source awaiting baseline'),
                stage(
                    'EQUITY_RELATIVE',
                    'PARTIAL',
                    'Rare-earth producer basket',
                ),
            ],
            eligible_securities: [],
        },
    ].map((theme) => ({
        status: 'DISCONNECTED',
        confirmation_count: 0,
        confirmation_total: 3,
        strategic_floor: {
            asset_class_code: `PHYSICAL_${theme.code}`,
            target_value: 0,
            actual_value: 0,
        },
        tactical: {
            asset_class_code: theme.equity_sleeve.asset_class_code,
            maximum_value: 0,
            permitted_value: 0,
            actual_value: 0,
            available_value: 0,
            budget_approved: false,
        },
        direct_expression: { status: 'SIGNAL_ONLY' },
        direct_sleeve: {
            asset_class_code: `PHYSICAL_${theme.code}`,
            target_value: 0,
            invested_value: 0,
            sleeve_cash_value: 0,
            capital_value: 0,
            budget_approved: false,
        },
        reviews: [],
        ...theme,
    }));
    let failMarkets = Boolean(options.failMarkets);
    let failRisk = Boolean(options.failRisk);
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/commodity-themes'))
            return failMarkets
                ? route.fulfill({ status: 503, body: 'Offline' })
                : route.fulfill({ json: { themes } });
        if (path.endsWith('/portfolio-overlay-summary'))
            return failRisk
                ? route.fulfill({ status: 503, body: 'Offline' })
                : route.fulfill({
                      json: {
                          total_portfolio_value: 10000,
                          portfolio_risk: {
                              mode: 'Q3_THROTTLE',
                              inputs: { q3: { effective_target_pct: 49 } },
                          },
                          q4_crisis: { active: false },
                          asset_classes: [],
                      },
                  });
        return route.fallback();
    });
    await page.goto(`${base}/#/positions`);
    await page
        .locator('tr.positions-stock-row')
        .filter({ hasText: 'Gold Producer' })
        .waitFor();
    await page.getByTestId('main-tab-system').click();
    const system = page.getByTestId('system-architecture-tab');
    await expect(
        system.getByRole('button', { name: 'Refresh architecture state' }),
    ).toBeEnabled();
    await expect(
        system.getByRole('heading', { name: /02\s*Current allocation/ }),
    ).toBeVisible();
    return {
        page,
        system,
        fixture,
        errors,
        failMarkets: () => (failMarkets = true),
        restoreMarkets: () => (failMarkets = false),
    };
}

test(
    'System preserves risk, holdings, distinct evidence and navigation without writes',
    { timeout: 90000 },
    async (t) => {
        const { page, system, fixture, errors } = await setup(t);
        await expect(system.getByRole('heading', { level: 2 })).toHaveText([
            '01Portfolio risk',
            '02Current allocation',
            '03Market signals',
            '04Position signals',
        ]);
        await expect(system.getByRole('navigation').getByRole('listitem')).toHaveText([
            '01Risk', '02Allocation', '03Markets', '04Positions',
        ]);
        await expect(system.getByTestId('system-layer-risk')).toContainText(
            'Equity limit 49.0%',
        );
        await expect(system.getByTestId('system-layer-risk')).toContainText(
            'Throttle',
        );
        const market = system.getByRole('table', { name: 'Market signals' });
        const gold = market.getByRole('row').filter({ hasText: 'Gold' });
        await expect(gold.getByRole('button', { name: 'Gold', exact: true })).toHaveAttribute('title', 'GDX / GLD');
        await expect(market).not.toContainText('GDX / GLD');
        await expect(gold).toContainText('Bull');
        await expect(gold).toContainText('Bear');
        await expect(
            market.getByRole('row').filter({ hasText: 'Silver' }),
        ).toContainText('No signal');
        await expect(
            market
                .getByRole('row')
                .filter({ hasText: 'Rare Earths & Critical Minerals' }),
        ).toContainText('Waiting');
        await expect(
            system.getByRole('button', { name: /Gold Miners 60.0%/ }),
        ).toBeVisible();
        const holdings = system.getByRole('table', {
            name: 'Held position signals',
        });
        await expect(holdings).toContainText('Gold Producer');
        await expect(holdings.getByRole('button', { name: 'Gold Producer', exact: true })).toHaveAttribute('title', 'STOCK');
        await expect(holdings).not.toContainText('STOCK');
        await expect(holdings).toContainText('Underperform');
        await expect(holdings).not.toContainText('Alternative Gold ETF');
        await system
            .getByRole('navigation')
            .getByRole('button', { name: 'Positions', exact: true })
            .click();
        await expect(
            system.getByTestId('system-layer-positions'),
        ).toBeFocused();
        const group = holdings.getByRole('button', { name: /Gold Miners/ });
        await group.click();
        await expect(group).toHaveAttribute('aria-expanded', 'false');
        await expect(holdings).not.toContainText('Gold Producer');
        await system
            .getByRole('textbox', { name: 'Search held positions' })
            .fill('producer');
        await expect(holdings).toContainText('Gold Producer');
        await expect(holdings).not.toContainText('Gold Core ETF');
        await expect(group).toContainText('$3,000');
        await expect(group).toBeDisabled();
        await system.getByRole('button', { name: 'Clear search' }).click();
        await expect(group).toHaveAttribute('aria-expanded', 'false');
        await group.click();
        await holdings.getByRole('button', { name: /Gold Producer/ }).click();
        await expect(page).toHaveURL(/#\/positions$/);
        assert.deepEqual(fixture.writes, []);
        assert.deepEqual(errors, []);
    },
);

test(
    'System sections collapse independently and navigation reopens them without losing row state',
    { timeout: 90000 },
    async (t) => {
        const { page, system, fixture, errors } = await setup(t);
        const sections = [
            ['risk', 'Portfolio risk', 'Risk'],
            ['portfolio', 'Current allocation', 'Allocation'],
            ['gates', 'Market signals', 'Markets'],
            ['positions', 'Position signals', 'Positions'],
        ];
        const holdings = system.getByRole('table', { name: 'Held position signals' });
        const group = holdings.getByRole('button', { name: /Gold Miners/ });
        await group.click();
        await system.getByRole('textbox', { name: 'Search held positions' }).fill('producer');

        for (const [id, title] of sections) {
            const section = system.getByTestId(`system-layer-${id}`);
            const before = await section.boundingBox();
            const toggle = section.getByRole('button', { name: `Collapse ${title}`, exact: true });
            await expect(toggle).toHaveAttribute('aria-controls', `system-${id}-content`);
            await toggle.click();
            await expect(section.locator(`#system-${id}-content`)).toBeHidden();
            await expect(section.getByRole('heading', { level: 2 })).toBeVisible();
            await expect(section.getByRole('button', { name: `Expand ${title}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
            assert.ok((await section.boundingBox()).height < before.height);
        }

        await page.setViewportSize({ width: 390, height: 850 });
        await page.screenshot({ path: '/tmp/system-sections-collapsed-mobile.png' });
        for (const [id, title, nav] of sections) {
            await system.getByRole('navigation').getByRole('button', { name: nav, exact: true }).click();
            const section = system.getByTestId(`system-layer-${id}`);
            await expect(section).toBeFocused();
            await expect(section.locator(`#system-${id}-content`)).toBeVisible();
            const toggle = section.getByRole('button', { name: `Collapse ${title}`, exact: true });
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await toggle.focus();
            await page.keyboard.press('Space');
            await expect(section.locator(`#system-${id}-content`)).toBeHidden();
            await page.keyboard.press('Enter');
            await expect(section.locator(`#system-${id}-content`)).toBeVisible();
        }

        await expect(system.getByRole('textbox', { name: 'Search held positions' })).toHaveValue('producer');
        await expect(holdings).toContainText('Gold Producer');
        await expect(holdings).not.toContainText('Gold Core ETF');
        await system.getByRole('button', { name: 'Clear search' }).click();
        await expect(group).toHaveAttribute('aria-expanded', 'false');
        assert.deepEqual(fixture.writes, []);
        assert.deepEqual(errors, []);
    },
);

test(
    'System exposes partial failures, retains received values and recovers on refresh',
    { timeout: 90000 },
    async (t) => {
        const { system, failMarkets, restoreMarkets, fixture, errors } =
            await setup(t);
        failMarkets();
        await system
            .getByRole('button', { name: 'Refresh architecture state' })
            .click();
        await expect(system.getByRole('status')).toContainText(
            'Could not refresh: Market signals',
        );
        await expect(
            system.getByRole('table', { name: 'Market signals' }),
        ).toContainText('Gold');
        await expect(system.getByTestId('system-layer-risk')).toContainText(
            'Throttle',
        );
        restoreMarkets();
        await system
            .getByRole('button', { name: 'Refresh architecture state' })
            .click();
        await expect(system.getByRole('status')).toHaveCount(0);
        assert.deepEqual(fixture.writes, []);
        assert.deepEqual(errors, []);
    },
);

test(
    'System never labels unavailable risk or market data as clear or empty-success',
    { timeout: 90000 },
    async (t) => {
        const { system } = await setup(t, {
            failMarkets: true,
            failRisk: true,
        });
        await expect(system.getByRole('status')).toContainText(
            'Portfolio risk',
        );
        await expect(system.getByTestId('system-layer-risk')).not.toContainText(
            'Clear',
        );
        await expect(system.getByTestId('system-layer-risk')).not.toContainText(
            'Normal',
        );
        await expect(system.getByTestId('system-layer-gates')).toContainText(
            'Market signals unavailable',
        );
        await expect(
            system.getByTestId('system-layer-positions'),
        ).toContainText('Gold Producer');
    },
);

test(
    'System uses readable theme-aware rows and one scroll flow at phone and desktop widths',
    { timeout: 90000 },
    async (t) => {
        const { page, system, errors } = await setup(t);
        for (const theme of ['terminal-dark', 'terminal-light-soft']) {
            await page.evaluate(
                (theme) =>
                    document.documentElement.setAttribute('data-theme', theme),
                theme,
            );
            for (const width of [360, 390, 768, 1366, 1920]) {
                await page.setViewportSize({ width, height: 850 });
                await system
                    .getByRole('navigation')
                    .getByRole('button', { name: 'Risk', exact: true })
                    .click();
                const dimensions = await system.evaluate((root) => {
                    const content = root.querySelector(
                        '[data-testid="system-scroll-area"]',
                    );
                    const tables = [...root.querySelectorAll('table')];
                    const bar = root.querySelector('[aria-label="Open current allocation in Portfolio"]');
                    const shapeSection = root.querySelector('[data-testid="system-layer-portfolio"]');
                    return {
                        width: root.clientWidth,
                        scroll: root.scrollWidth,
                        bodyWidth: content.clientWidth,
                        bodyScroll: content.scrollWidth,
                        shapeWidth: bar.getBoundingClientRect().width,
                        shapeHeight: bar.firstElementChild.getBoundingClientRect().height,
                        shapeInset: bar.getBoundingClientRect().left - shapeSection.getBoundingClientRect().left,
                        titleFont: parseFloat(
                            getComputedStyle(root.querySelector('h1')).fontSize,
                        ),
                        positionGroups: [...root.querySelectorAll('table[aria-label="Held position signals"] tbody')].map((group) => {
                            const header = group.querySelector('th[scope="rowgroup"]');
                            const title = header.querySelector('button > span');
                            const securityCell = group.querySelector('td');
                            const security = securityCell.querySelector('button strong');
                            return {
                                titleLeft: title.getBoundingClientRect().left,
                                securityLeft: security.getBoundingClientRect().left,
                                headerBackground: getComputedStyle(header).backgroundColor,
                                rowBackground: getComputedStyle(securityCell).backgroundColor,
                            };
                        }),
                        cells: [...root.querySelectorAll('td')].map((cell) => ({
                            font: parseFloat(getComputedStyle(cell).fontSize),
                            height: cell.getBoundingClientRect().height,
                        })),
                        tableWidths: tables.map(
                            (el) => el.getBoundingClientRect().width,
                        ),
                        nestedScroll: [...content.querySelectorAll('*')].filter(
                            (el) =>
                                ['auto', 'scroll'].includes(
                                    getComputedStyle(el).overflowY,
                                ) && el.scrollHeight > el.clientHeight + 1,
                        ).length,
                    };
                });
                assert.ok(
                    dimensions.scroll <= dimensions.width + 1,
                    `${width} ${theme} ${JSON.stringify(dimensions)}`,
                );
                assert.ok(
                    dimensions.bodyScroll <= dimensions.bodyWidth + 1,
                    `${width} content overflow`,
                );
                assert.equal(dimensions.nestedScroll, 0);
                assert.ok(dimensions.shapeWidth <= 961, 'shape and tables keep a bounded reading width');
                assert.equal(dimensions.shapeHeight, 32, 'the coloured shape bar has a 32px visible height');
                assert.ok(dimensions.shapeInset >= (dimensions.width > 560 ? 40 : 16) - 1, 'content retains generous desktop gutters and compact phone gutters');
                assert.ok(dimensions.titleFont >= 15);
                for (const group of dimensions.positionGroups) {
                    assert.ok(group.securityLeft > group.titleLeft, `${width}: securities are nested beneath their class`);
                    assert.notEqual(group.headerBackground, group.rowBackground, `${theme}: class headers remain distinct`);
                }
                assert.ok(
                    dimensions.cells.every(
                        (cell) =>
                            cell.font >= 12 &&
                            (cell.height === 0 || cell.height >= 34),
                    ),
                    JSON.stringify(dimensions.cells),
                );
                if (dimensions.width >= 1000) {
                    assert.ok(dimensions.cells.every(cell => cell.height <= 38), 'single-line signal rows stay near 37px, not the old 47-54px');
                }
                for (const row of await system
                    .getByRole('table', { name: 'Market signals' })
                    .locator('tbody tr')
                    .all()) {
                    const cells = await row
                        .locator('td')
                        .evaluateAll((cells) =>
                            cells.map((cell) =>
                                cell.getBoundingClientRect().toJSON(),
                            ),
                        );
                    assert.ok(
                        cells[0].right <= cells[1].x + 1 &&
                            cells[1].right <= cells[2].x + 1,
                    );
                }
                if ([390, 1366].includes(width))
                    await page.screenshot({
                        path: `/tmp/system-uplift-${theme}-${width}.png`,
                    });
            }
        }
        assert.deepEqual(errors, []);
    },
);
