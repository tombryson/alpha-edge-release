const date = '2026-09-09T10:00:00Z';
const allocation = (asset_class, display_name, weight_pct) => ({ asset_class, display_name, weight_pct, display_order: 1, value: weight_pct * 100, invested_value: weight_pct * 100, invested_weight_pct: weight_pct, sleeve_cash_value: 0, sleeve_cash_weight_pct: 0, governed_by_q1: true });

async function mockContextPanel(page, { thesis = 'Research fixture thesis.', includeSilverHolding = false } = {}) {
    const writes = [];
    const reads = [];
    const failures = new Set();
    const managementProfiles = [];
    let activeConnections = [{ id: 1, ticker: 'ASX:GOLD', script: 'etf_tms' }, { id: 2, ticker: 'ASX:STOCK', script: 'cdf' }];
    await page.route('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', async route => {
        if (failures.has('tradingview')) return route.abort('failed');
        await route.fulfill({ contentType: 'application/javascript', body: `(() => {
            const script = document.currentScript;
            const config = JSON.parse(script.textContent);
            const frame = document.createElement('iframe');
            frame.dataset.config = JSON.stringify(config);
            frame.srcdoc = '<html><body>Isolated TradingView chart fixture</body></html>';
            script.parentElement.querySelector('.tradingview-widget-container__widget').append(frame);
        })();` });
    });
    const policy = { default_core_ratio_pct: 25, momentum_influence_pct: 50, momentum_source: 'LEGACY_COMPATIBILITY', suggested_exposure_pct: 25 };
    const fund = (ticker, name, assetClass, className, budget, actual, core = true) => ({ ticker, display_name: name, asset_class: assetClass, asset_class_name: className, momentum_weight_pct: 12.5, is_core: core, core_ratio_pct: 25, momentum_influence_pct: 50, class_target_value: budget, momentum_adjustment_value: 0, recommended_target_value: budget / 4, effective_target_value: core ? budget / 4 : 0, core_target_value: core ? budget / 4 : 0, target_weight_pct: 12.5, book_target_pct: budget / 400, actual_value: actual, final_target_value: core ? budget / 4 : 0, status: 'BUY', tactical_status: 'BUY' });
    const rows = [fund('ASX:GOLD', 'Gold Core ETF', 'GOLD_MINERS', 'Gold Miners', 6000, 3000), fund('ASX:SILV', 'Silver Core ETF', 'SILVER_MINERS', 'Silver Miners', 3000, 0)];
    const candidates = [{ ticker: 'ASX:ALT', display_name: 'Alternative Gold ETF', asset_class: 'GOLD_MINERS', asset_class_name: 'Gold Miners', momentum_weight_pct: 10 }];
    const classes = () => rows.map(row => ({ asset_class: row.asset_class, asset_class_name: row.asset_class_name, class_target_value: row.class_target_value, core_ticker: row.is_core ? row.ticker : '', core_ratio_pct: row.core_ratio_pct, momentum_influence_pct: 50, core_base_value: row.core_target_value, momentum_adjustment_value: 0, effective_target_value: row.effective_target_value, actual_etf_value: row.actual_value, stock_capacity_value: row.class_target_value - Math.max(row.effective_target_value, row.actual_value) }));
    const ledger = () => ({ as_of: date, policy, classes: classes(), rows, candidates, summary: { portfolio_value: 10000, actual_etf_value: 3000, actual_exposure_pct: 30, has_approved_shape: true, effective_target_value: rows.reduce((sum, row) => sum + row.effective_target_value, 0) } });
    const shapeRows = [allocation('GOLD_MINERS', 'Gold Miners', 60), allocation('SILVER_MINERS', 'Silver Miners', 30), allocation('CASH', 'Cash / reserve', 10)];
    const currentRows = [allocation('GOLD_MINERS', 'Gold Miners', 60), allocation('CASH', 'Cash / reserve', 40)];
    const stockAnalysis = (id, ticker, name, security_type, primary_asset_class, watch = false) => ({ id, ticker, name, security_type, primary_asset_class, allocation: 10, is_watchlist: watch, current_price: 30, gemini_quality: 70, gemini_value: 80, gemini_pt: 60, gpt_quality: 70, gpt_value: 80, gpt_pt: 60, performance_6m_pct: 15, performance_as_of: date, last_contributed_at: date, thesis, include_in_sizing: true });
    const analysis = [stockAnalysis(1, 'ASX:GOLD', 'Gold Core ETF', 'ETF', 'GOLD_MINERS'), stockAnalysis(2, 'ASX:STOCK', 'Gold Producer', 'STOCK', 'GOLD_MINERS'), stockAnalysis(3, 'ASX:SILV', 'Silver Core ETF', 'ETF', 'SILVER_MINERS', true), stockAnalysis(4, 'ASX:ALT', 'Alternative Gold ETF', 'ETF', 'GOLD_MINERS', true)];
    const holding = (id, ticker, details) => ({ id, statement_id: 1, ticker, exchange_prefix: 'ASX:', details, quantity: 100, current_price: 30, cost_aud: 2000, value_aud: 3000, gain_loss_aud: 1000, gain_loss_pct: 50, market_value: 3000, cash_reserve: 0, currency: 'AUD', created_at: date });
    const holdings = [holding(1, 'GOLD', 'Gold Core ETF'), holding(2, 'STOCK', 'Gold Producer')];
    if (includeSilverHolding) {
        holdings.push(holding(3, 'SILV', 'Silver Core ETF'));
        analysis[2].is_watchlist = false;
    }
    const assetClasses = shapeRows.map((row, i) => ({ code: row.asset_class, key: row.asset_class, asset_class_code: row.asset_class, display_name: row.display_name, class_type: 'ASSET_CLASS', display_order: i, allow_target_weight: true, allow_grouping: true, active: true, analysis_eligible: true, instrument_scope: 'BOTH', cash_reserve: row.asset_class === 'GOLD_MINERS' ? 500 : 0, overlay_eligible: true, q1_category: true }));
    const overlay = { total_portfolio_value: 10000, portfolio_value: 10000, total_cash: 4000, portfolio_risk: { mode: 'NORMAL' }, asset_classes: shapeRows.map(row => ({ asset_class: row.asset_class, display_name: row.display_name, target_weight_pct: row.weight_pct, strategic_weight_pct: row.weight_pct, actual_invested_value: row.asset_class === 'GOLD_MINERS' ? 6000 : 0, allowed_invested_value: row.weight_pct * 100 })) };
    await page.addInitScript(() => {
        if (localStorage.getItem('context-panel-fixture-initialized')) return;
        localStorage.setItem('context-panel-fixture-initialized', 'true');
        localStorage.setItem('alpha-edge-api-token', 'isolated-browser-fixture');
        localStorage.setItem('alpha-edge:welcome-guide:v1:legacy', 'dismissed');
        localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed');
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ activeTab: 'POSITIONS', layout: { left: 'snapped', right: 'open' } }));
        localStorage.setItem('alpha-edge:context-panel', JSON.stringify({ state: { view: 'class', assetClass: 'GOLD_MINERS', allocationView: 'line', security: '', shape: 'current' }, version: 0 }));
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname.replace(/^\/api\/trading/, '/api');
        if (request.method() === 'GET') reads.push(path);
        let data = [];
        if (failures.has(path)) return route.fulfill({ status: 500, body: 'Isolated failure fixture' });
        if (path.includes('/etf/management/') && request.method() === 'PUT') {
            const payload = request.postDataJSON();
            const ticker = decodeURIComponent(path.split('/').pop());
            writes.push({ path, payload });
            const profile = { ticker: ticker.split(':').pop(), mode: payload.mode };
            const index = managementProfiles.findIndex(p => p.ticker === profile.ticker);
            if (index >= 0) managementProfiles[index] = profile; else managementProfiles.push(profile);
            activeConnections = activeConnections.filter(a => a.ticker !== ticker);
            const row = rows.find(row => row.ticker === ticker);
            if (row) { row.management_mode = profile.mode; row.effective_target_value = 0; row.final_target_value = 0; row.tactical_status = 'SELL'; }
            data = profile;
        } else if (path.includes('/etf/core-policies/') && request.method() === 'PUT') {
            const payload = request.postDataJSON(); writes.push({ path, payload });
            const row = rows.find(row => row.asset_class === decodeURIComponent(path.split('/').pop()));
            row.is_core = Boolean(payload.core_ticker);
            if (payload.core_ticker) row.core_ratio_pct = payload.core_ratio_pct;
            row.core_target_value = row.is_core ? row.class_target_value * row.core_ratio_pct / 100 : 0;
            row.effective_target_value = row.core_target_value;
            data = ledger();
        } else if (request.method() !== 'GET' && request.method() !== 'OPTIONS' && !path.endsWith('/sizing/allocations')) {
            writes.push({ path, unexpected: true });
            return route.fulfill({ status: 409, body: 'Writes are disabled in this fixture' });
        } else if (path.endsWith('/etf/allocation-ledger')) data = ledger();
        else if (path.endsWith('/settings')) data = {};
        else if (path.endsWith('/portfolio')) data = { total_value: 10000, cash_on_hand: 4000, exposure: 60, profit_loss: 2000, profit_loss_percent: 20 };
        else if (path.endsWith('/statements/latest')) data = { statement: { id: 1, statement_date: date, total_value_aud: 10000, cash_aud: 4000 }, holdings };
        else if (path.endsWith('/analysis')) data = analysis;
        else if (path.endsWith('/groups')) data = { groups: [{ id: 'gold', name: 'Gold Miners', asset_class_code: 'GOLD_MINERS', order: 0, collapsed: false, parent_id: null }, { id: 'silver', name: 'Silver Miners', asset_class_code: 'SILVER_MINERS', order: 1, collapsed: false, parent_id: null }], assignments: [{ company_name: 'Gold Core ETF', group_id: 'gold' }, { company_name: 'Gold Producer', group_id: 'gold' }, ...(includeSilverHolding ? [{ company_name: 'Silver Core ETF', group_id: 'silver' }] : [])] };
        else if (path.endsWith('/asset-class-config') || path.endsWith('/asset-classes')) data = assetClasses;
        else if (path.endsWith('/portfolio-mix/current')) data = { as_of: date, total_value: 10000, rows: currentRows };
        else if (path.endsWith('/portfolio-mix/approved')) data = { snapshot: { id: 4, status: 'APPROVED', approved_at: date }, rows: shapeRows };
        else if (path.endsWith('/portfolio-overlay-summary')) data = overlay;
        else if (path.endsWith('/portfolio-history')) data = { entries: [{ id: 'shape:4', kind: 'shape', status: 'APPROVED', snapshot_id: 4, occurred_at: date, rows: shapeRows, memo_job_id: 'memo-4' }, { id: 'shape:3', kind: 'shape', status: 'SUPERSEDED', snapshot_id: 3, occurred_at: '2026-06-01', rows: [allocation('GOLD_MINERS', 'Gold Miners', 30), allocation('SILVER_MINERS', 'Silver Miners', 60), allocation('CASH', 'Cash / reserve', 10)], memo_job_id: 'memo-3' }] };
        else if (path.includes('/portfolio-memos/memo-')) data = { memo: { memo_job_id: path.split('/').pop(), executive_summary: 'Saved fixture memo for the selected approval.', analyst_memo_markdown: 'Analyst fixture evidence.', chairman_memo_markdown: 'Chairman fixture conclusion.' } };
        else if (path.endsWith('/portfolio-memos/latest')) data = { memo: null };
        else if (path.endsWith('/positions')) data = [{ ticker: 'ASX:GOLD', position_state: 'BUY' }, { ticker: 'ASX:STOCK', position_state: 'BUY' }];
        else if (path.endsWith('/alerts/active')) data = activeConnections;
        else if (path.endsWith('/etf/management')) data = managementProfiles;
        else if (path.endsWith('/commodity-themes')) data = { themes: [] };
        else if (path.endsWith('/etf/momentum')) data = { latest_run: { id: 1, data_fresh_through: date, rows: [{ ticker: 'ASX:GOLD', return_80_pct: 12.5, score: 3.2, rank: 1, price_date: date }] }, automation: {} };
        else if (path.endsWith('/sizing/allocations')) data = { results: [{ id: 2, eligible_for_target_weight: true, allocation_pct: 100, allocation_dollar: 3000 }], class_budgets_applied: true };
        else if (path.endsWith('/announcement-router/signals')) data = {};
        else if (path.endsWith('/announcement-subscriptions')) data = { items: [] };
        else if (path.endsWith('/security-actions')) data = [];
        else if (path.endsWith('/rebalance/status')) data = { active: false, targets: [] };
        else if (path.includes('/adjustments/')) data = { plan: null };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await require('./browser-access.cjs').mockBrowserAccess(page);
    return { writes, reads, failures, ledger };
}
async function waitForRailLayout(page) {
    await page.locator('.terminal-desktop-rail').evaluateAll(rails => Promise.all(
        rails.flatMap(rail => rail.getAnimations({ subtree: true }))
            .filter(animation => animation instanceof CSSTransition && ['width', 'transform'].includes(animation.transitionProperty))
            .map(animation => animation.finished.catch(() => {})),
    ));
}

module.exports = { mockContextPanel, waitForRailLayout };
