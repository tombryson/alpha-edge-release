// Real public security identities; every holding, price, return and signal is simulated.
// Illustrative selection from large ASX companies, excluding hybrid securities:
// https://marketcap.company/stock-exchanges/au-australian-securities-exchange-market-capitalization/
// https://www.vaneck.com.au/investments/equity/mvb-vaneck-australian-banks-etf/
// https://www.vaneck.com.au/etf/equity/gdx/snapshot
// https://www.betashares.com.au/fund/global-energy-companies-etf/
// https://fund-docs.vanguard.com/ETF-Vanguard_Australian_Property_Securities_Index_ETF_8206_FS_VAP.pdf
// No production exports, provider requests or database.
import { DEMO_ASSET_CLASS_CATALOGUE } from './demo-asset-classes.generated';
import marketPreview from './market-preview';
import { calculateAnalysisTargetWeight, calculateBaseRatingTotal } from './analysis-metrics';
import { demoWatchlist, demoWatchlistResearch } from './demo-watchlist';
import { buildDemoMarkets } from './demo-markets';
import { demoResearch, demoRouterScores } from './demo-research';
import { DATASET_LABELS, type DataFreshnessResponse } from './data-freshness';

const date = '2026-09-24T09:00:00Z';
const portfolioValue = 283350;
const cash = 14648;
const profitLossPct = 31.7;
const investedValue = portfolioValue - cash;
const money = (value: number) => Math.round(value * 100) / 100;
const percent = (value: number) => value / portfolioValue * 100;
const classConfig = DEMO_ASSET_CLASS_CATALOGUE.config;
const configByCode = new Map(classConfig.map(config => [config.key, config]));
const classDefinitions = [
    ['BANKS', 'Banks', 24],
    ['DIVERSIFIED_MINERS', 'Diversified Miners', 15],
    ['GOLD_MINERS', 'Gold Miners', 12],
    ['PHARMA_BIOTECH', 'Pharma & Biotech', 8],
    ['CONSUMER_DISCRETIONARY', 'Consumer Discretionary', 6],
    ['ENERGY_PRODUCERS', 'Energy Producers', 7],
    ['REAL_ESTATE_REIT', 'Real Estate / REIT', 3.5],
    ['IRON_ORE_MINERS', 'Iron Ore Miners', 3],
    ['CONSUMER_STAPLES', 'Consumer Staples', 5],
    ['INFRASTRUCTURE', 'Infrastructure', 2],
    ['GAMING_GAMBLING', 'Gaming & Gambling', 2.5],
    ['INSURANCE', 'Insurance', 2],
] as const;
type AssetClass = typeof classDefinitions[number][0];
type Security = { ticker: string; name: string; assetClass: AssetClass; quantity: number; price: number; returnPct: number; isETF: boolean };
// Quantities, prices and returns below are fixture inputs, not market quotes.
const definitions: Security[] = ([
    ['BHP', 'BHP Group Limited', 'DIVERSIFIED_MINERS', 180, 45, 14],
    ['CBA', 'Commonwealth Bank of Australia', 'BANKS', 60, 120, 18],
    ['NEM', 'Newmont Corporation', 'GOLD_MINERS', 50, 90, 24],
    ['WBC', 'Westpac Banking Corporation', 'BANKS', 150, 30, 8],
    ['NAB', 'National Australia Bank Limited', 'BANKS', 150, 30, 10],
    ['ANZ', 'ANZ Group Holdings Limited', 'BANKS', 120, 30, -3],
    ['MQG', 'Macquarie Group Limited', 'BANKS', 20, 180, 12],
    ['CSL', 'CSL Limited', 'PHARMA_BIOTECH', 42, 180, -12],
    ['WES', 'Wesfarmers Limited', 'CONSUMER_DISCRETIONARY', 90, 50, 9],
    ['WDS', 'Woodside Energy Group Limited', 'ENERGY_PRODUCERS', 100, 37.74, -8],
    ['RIO', 'Rio Tinto Limited', 'DIVERSIFIED_MINERS', 50, 90, 11],
    ['GMG', 'Goodman Group', 'REAL_ESTATE_REIT', 100, 27, 6],
    ['FMG', 'Fortescue Ltd', 'IRON_ORE_MINERS', 150, 18, -15],
    ['WOW', 'Woolworths Group Limited', 'CONSUMER_STAPLES', 100, 31.5, -4],
    ['TCL', 'Transurban Group', 'INFRASTRUCTURE', 150, 12, 3],
    ['ALL', 'Aristocrat Leisure Limited', 'GAMING_GAMBLING', 60, 45, 20],
    ['QBE', 'QBE Insurance Group Limited', 'INSURANCE', 100, 18, 16],
    ['COL', 'Coles Group Limited', 'CONSUMER_STAPLES', 100, 22.5, 7],
    ['NST', 'Northern Star Resources Limited', 'GOLD_MINERS', 150, 18, 28],
    ['STO', 'Santos Limited', 'ENERGY_PRODUCERS', 300, 6, -5],
    ['EVN', 'Evolution Mining Limited', 'GOLD_MINERS', 200, 9, 22],
    ['MVB', 'VanEck Australian Banks ETF', 'BANKS', 150, 36, 7],
] satisfies [string, string, AssetClass, number, number, number][]).map(([ticker, name, assetClass, quantity, price, returnPct]) => ({ ticker, name, assetClass, quantity: quantity * 3, price, returnPct, isETF: ticker === 'MVB' }));
definitions.push(
    { ticker: 'GDX', name: 'VanEck Gold Miners ETF', assetClass: 'GOLD_MINERS', quantity: 200, price: 35, returnPct: 19, isETF: true },
    { ticker: 'FUEL', name: 'Betashares Global Energy Companies Currency Hedged ETF', assetClass: 'ENERGY_PRODUCERS', quantity: 300, price: 9, returnPct: 6, isETF: true },
    { ticker: 'VAP', name: 'Vanguard Australian Property Securities Index ETF', assetClass: 'REAL_ESTATE_REIT', quantity: 40, price: 90, returnPct: 8, isETF: true },
);
const valueOf = (security: Security) => security.quantity * security.price;
const weight = (code: string, name: string, pct: number, order: number) => ({ asset_class: code, display_name: name, weight_pct: pct, value: money(pct * portfolioValue / 100), display_order: order, governed_by_q1: configByCode.get(code)?.overlay_eligible ?? false, invested_weight_pct: code === 'CASH' ? 0 : pct, invested_value: code === 'CASH' ? 0 : money(pct * portfolioValue / 100), sleeve_cash_weight_pct: 0, sleeve_cash_value: 0 });
const approved = [...classDefinitions.map(([code, name, pct], i) => weight(code, name, pct, i)), weight('CASH', 'Cash / reserve', 10, classDefinitions.length)];
const current = approved.map(row => weight(row.asset_class, row.display_name, percent(row.asset_class === 'CASH' ? cash : definitions.filter(d => d.assetClass === row.asset_class).reduce((sum, d) => sum + valueOf(d), 0)), row.display_order));
// Header P/L uses gain / portfolio value. Reconcile cost bases to that contract,
// preserving losing positions and keeping six-month momentum separate from holding returns.
const targetCost = money(investedValue - portfolioValue * profitLossPct / 100);
const seedCost = (d: Security) => valueOf(d) / (1 + d.returnPct / 100);
const losingCost = definitions.filter(d => d.returnPct < 0).reduce((sum, d) => sum + money(seedCost(d)), 0);
const winningCost = definitions.filter(d => d.returnPct >= 0).reduce((sum, d) => sum + seedCost(d), 0);
const costs = definitions.map(d => money(seedCost(d) * (d.returnPct < 0 ? 1 : (targetCost - losingCost) / winningCost)));
costs[costs.length - 1] = money(costs[costs.length - 1] + targetCost - costs.reduce((sum, value) => sum + value, 0));
const holdings = definitions.map((d, i) => ({ id: i + 1, statement_id: 1, ticker: d.ticker, exchange_prefix: 'ASX:', details: d.name, name: d.name, quantity: d.quantity, current_price: d.price, cost_aud: costs[i], value_aud: valueOf(d), gain_loss_aud: money(valueOf(d) - costs[i]), gain_loss_pct: (valueOf(d) / costs[i] - 1) * 100, market_value: valueOf(d), cash_reserve: 0, currency: 'AUD', created_at: date }));
const profitLoss = holdings.reduce((sum, holding) => sum + holding.gain_loss_aud, 0);
const analysis = definitions.map((d, i) => ({ id: i + 1, ticker: `ASX:${d.ticker}`, name: d.name, security_type: d.isETF ? 'ETF' : 'STOCK', primary_asset_class: d.assetClass, allocation: 100 / definitions.filter(peer => peer.assetClass === d.assetClass && peer.isETF === d.isETF).length, current_price: d.price, include_in_sizing: !d.isETF, gemini_quality: 65 + (i % 6) * 4, gemini_value: 76 - (i % 6) * 3, gemini_pt: d.price * 1.4, gpt_quality: 68 + (i % 6) * 3, gpt_value: 72 - (i % 6) * 2, gpt_pt: d.price * 1.3, performance_6m_pct: d.returnPct, performance_as_of: date, last_contributed_at: date, thesis: 'Simulated research for a real listed security. Prices, returns, scores and assessments are illustrative, not live research or investment advice.', is_watchlist: false,
    ...demoResearch(`ASX:${d.ticker}`, d.name, d.price, i, date),
}));
const classes = DEMO_ASSET_CLASS_CATALOGUE.assetClasses.map(assetClass => {
    const target = approved.find(row => row.asset_class === assetClass.code)?.weight_pct ?? 0;
    return { ...assetClass, in_mandate: target > 0, mandate_weight_pct: target };
});
const approvals = [1, 2, 3].map((version, index) => ({ id: `shape:${version}`, kind: 'shape', status: version === 3 ? 'APPROVED' : 'SUPERSEDED', snapshot_id: version, occurred_at: ['2025-10-15T09:00:00Z', '2026-02-15T09:00:00Z', '2026-06-15T09:00:00Z'][index], title: `Approved v${version}`, source: 'Synthetic example', memo_job_id: `demo-memo-${version}`, rows: approved.map(row => weight(row.asset_class, row.display_name, row.asset_class === 'GOLD_MINERS' ? [16, 14, 12][index] : row.asset_class === 'BANKS' ? [20, 22, 24][index] : row.weight_pct, row.display_order)) }));
const memos = approvals.map(entry => ({
    id: entry.snapshot_id, memo_job_id: entry.memo_job_id, job_id: entry.memo_job_id, run_id: entry.memo_job_id,
    mode: 'DEMO', status: 'SUCCEEDED', model: 'Synthetic example', primary_theme: 'Illustrative rotation', secondary_theme: '', overall_conviction: '',
    analysis_date: entry.occurred_at, created_at: entry.occurred_at, updated_at: entry.occurred_at, completed_at: entry.occurred_at,
    asset_class_targets: entry.rows.map(row => ({ asset_class: row.asset_class, display_name: row.display_name, target_pct: row.weight_pct })),
    executive_summary: `Synthetic scenario ${entry.snapshot_id}: a staged change from gold miners into banks, with reserve held at 10%.`,
    analyst_memo_markdown: '# Demonstration research\n\nThis is invented evidence for an illustrative portfolio of real listed securities. It is not live research or investment advice.',
    chairman_memo_markdown: `# Example conclusion\n\nScenario ${entry.snapshot_id} allocates ${entry.rows.find(row => row.asset_class === 'GOLD_MINERS')?.weight_pct}% to gold miners and ${entry.rows.find(row => row.asset_class === 'BANKS')?.weight_pct}% to banks.`,
    proposed_allocations: entry.rows, target_allocations: entry.rows,
}));

const funds = definitions.filter(d => d.isETF).map(d => {
    const row = approved.find(row => row.asset_class === d.assetClass)!;
    const target = row.value * 0.25;
    const actual = valueOf(d);
    return { ...d, className: row.display_name, budget: row.value, target, actual, delta: target - actual };
});
const fundForClass = (code: string) => funds.find(fund => fund.assetClass === code);
const etfTarget = funds.reduce((sum, fund) => sum + fund.target, 0);
const etfActual = funds.reduce((sum, fund) => sum + fund.actual, 0);
const etfDelta = etfTarget - etfActual;

// Keep the read-only demo's DCA spectrum useful as calendar time moves forward.
const contributionAges = [2, 14, 35, 7, 49, 70, 21, 84, 28, 56, 42, 63, 10, 91, 18, 4, 32, 45, 60, 5, 77, 24, 38, 68, 12, 30];
const dayMs = 86400000;
const markets = buildDemoMarkets([...analysis, ...demoWatchlistResearch], approved, current, date);
const alertExamples = [
    [1, 'CSL', 'SELL', 'Strong', 'cdf', 6],
    [3, 'NST', 'BREAKOUT', 'Strong', 'cdf', 0.1], [4, 'BHP', 'ADD', 'Strong', 'tms', 1],
    [5, 'CBA', 'TRIM', 'Weak', 'tms', 2],
    [7, 'VAP', 'BUY', 'Strong', 'etf_tms', 0.5], [8, 'GDX', 'BUY', 'Strong', 'etf_tms', 0.3],
    [9, 'QBE', 'BREAKOUT', 'Strong', 'cdf', 5], [10, 'COL', 'ADD', 'Weak', 'tms', 0.2],
    [11, 'S32', 'BREAKOUT', 'Strong', 'cdf', 0.2], [12, 'RRL', 'OUTPERFORM_CONFIRMED', 'Strong', 'cdf', 1],
] as const;

function payload(path: string, sizingIDs?: Set<number>): unknown {
    if (process.env.NODE_ENV !== 'production' && process.env.DEMO_MARKET_PREVIEW === '1') {
        if (path === '/commodity-themes') return { themes: marketPreview.themes };
        const market = marketPreview.themes.find(theme => path === `/commodity-themes/${theme.code}`);
        if (market) return market;
    }
    // Opt-in local preview scenario; never change the public demo's default evidence.
    const today = Math.floor(Date.now() / dayMs) * dayMs;
    const research = analysis.map((row, i) => ({
        ...row,
        last_contributed_at: new Date(today - contributionAges[i] * dayMs).toISOString(),
        ...(process.env.NODE_ENV !== 'production' && process.env.DEMO_INCOMPLETE_RESEARCH === '1' && row.ticker === 'ASX:WBC'
            ? { gemini_pt: 0, gpt_pt: 0 } : {}),
    }));
    if (path === '/weight-policy') {
        const sizing = payload('/sizing/allocations') as { results: Array<{ id: number; asset_class: string; base_rating: number; allocation_dollar: number }> };
        const missingByClass = new Map<string, number>();
        for (const row of sizing.results) {
            if (row.base_rating <= 0 || !(research.find(stock => stock.id === row.id)!.current_price > 0)) {
                missingByClass.set(row.asset_class, (missingByClass.get(row.asset_class) || 0) + 1);
            }
        }
        return { enabled: false, epoch: 0, version: 'ideal-weight-v1', read_only: true, targets: research.map(a => {
            const held = holdings.find(h => h.id === a.id)!.value_aud;
            const researchMissing = a.security_type === 'ETF' ? 0 : missingByClass.get(a.primary_asset_class) || 0;
            const ideal = researchMissing ? 0 : a.security_type === 'ETF' ? fundForClass(a.primary_asset_class)!.target : sizing.results.find(row => row.id === a.id)!.allocation_dollar;
            const budget = approved.find(row => row.asset_class === a.primary_asset_class)!.value;
            return { id: a.id, ticker: a.ticker, asset_class: a.primary_asset_class, role: a.security_type === 'ETF' ? 'CORE_ETF' : 'STOCK',
                held, ideal, percent: ideal / budget * 100, coverage: ideal > 0 ? held / ideal : 0, available: !researchMissing, fresh: true, research_missing: researchMissing,
                reason: researchMissing ? `Incomplete class research (${researchMissing}). Review Analysis data issues.` : undefined,
                observed_date: date.slice(0,10), statement_id: 1, portfolio_value: portfolioValue, reduction: 0, remaining: researchMissing ? 0 : held };
        }) };
    }
    if (path === '/portfolio') return { total_value: portfolioValue, cash_on_hand: cash, exposure: percent(investedValue), profit_loss: profitLoss, profit_loss_percent: percent(profitLoss) };
    if (path === '/statements/latest') return { statement: { id: 1, statement_date: date, total_value_aud: portfolioValue, cash_aud: cash }, holdings };
    if (path === '/statements') return [{ id: 1, statement_date: date, total_value_aud: portfolioValue, cash_aud: cash }];
    if (path === '/analysis') return [...research, ...demoWatchlistResearch];
    if (path === '/watchlist/opportunities') {
        const { targets } = payload('/weight-policy') as { targets: { ticker: string; asset_class: string; percent: number; role: string }[] };
        const items = demoWatchlist.map(item => {
            const now = current.find(row => row.asset_class === item.asset_class)?.weight_pct ?? 0;
            const limit = approved.find(row => row.asset_class === item.asset_class)?.weight_pct ?? 0;
            const peers = targets.filter(peer => peer.asset_class === item.asset_class);
            const stockWeight = peers.filter(peer => peer.role === 'STOCK').reduce((sum, peer) => sum + peer.percent, 0);
            return { ...item, class_now: now, class_after: now + percent(item.entry), class_limit: limit, class_cash: 0,
                peers: item.ideal_pct === null ? [] : peers.map(peer => ({ ticker: peer.ticker, before: peer.percent,
                    after: peer.role === 'CORE_ETF' ? peer.percent : peer.percent * Math.max(0, 1 - item.ideal_pct! / stockWeight) })) };
        });
        return { items, as_of: new Date().toISOString() };
    }
    if (path === '/announcement-subscriptions') return { items: definitions.map((d, i) => ({
        kind: 'holding', id: i + 1, security_id: i + 1, name: d.name, ticker: d.ticker,
        exchange_prefix: 'ASX:', provider: '', configured: false, needs_recheck: false,
    })) };
    if (path === '/groups') return { groups: classDefinitions.map(([code, name], i) => ({ id: code, name, asset_class_code: code, order: i, collapsed: false, parent_id: null })), assignments: definitions.map(d => ({ company_name: d.name, group_id: d.assetClass })) };
    if (path === '/asset-classes') return classes;
    if (path === '/asset-class-config') return classConfig;
    if (path === '/portfolio-mix/current') return { as_of: date, total_value: portfolioValue, rows: current };
    if (path === '/portfolio-mix/approved') return { snapshot: { id: 3, status: 'APPROVED', approved_at: approvals[2].occurred_at }, rows: approved, approval_policy: { minimum_months: 4, can_approve: false, next_allowed_at: '2026-10-15T09:00:00Z' } };
    if (path === '/portfolio-history') return { entries: [...approvals].reverse() };
    if (path === '/council/portfolio-memos') return { memos, unavailable: [] };
    if (path === '/portfolio-memos/latest') return { memo: memos[2] };
    if (path.startsWith('/portfolio-memos/')) return { memo: memos.find(m => m.memo_job_id === path.split('/').pop()) ?? null };
    if (path === '/positions') return [...research, ...demoWatchlistResearch].map(row => ({ ticker: row.ticker, position_state: ['ASX:CSL', 'ASX:FMG'].includes(row.ticker) ? 'SELL' : 'BUY' }));
    if (path === '/alerts') return alertExamples.map(([id, ticker, alert_type, strength, script, age]) => {
        const stock = [...research, ...demoWatchlistResearch].find(row => row.ticker === `ASX:${ticker}`)!;
        return { id, ticker: stock.ticker, alert_type, strength, script, source: script,
            created_at: new Date(today - age * dayMs).toISOString(), exchange_prefix: 'ASX:', name: stock.name,
            asset_class: stock.primary_asset_class, current_price: stock.current_price, alert_price: stock.current_price / (1 + (id % 2 === 0 ? -0.025 : 0.04)), is_active: true };
    });
    if (path === '/alerts/active') return [
        ...[...research, ...demoWatchlistResearch].flatMap(row => (row.security_type === 'ETF' ? ['etf_tms'] : ['cdf', 'tms']).map(script => ({ ticker: row.ticker, script }))),
        ...markets.flatMap(theme => theme.eligible_securities!.map(row => ({ ticker: `${row.ticker}/${row.latest_events.SECURITY_OUTPERFORM!.source.denominator}`, script: 'cdf' }))),
    ].map((row, i) => ({ ...row, id: i + 1 }));
    if (path === '/portfolio-overlay-summary') return { total_portfolio_value: portfolioValue, portfolio_value: portfolioValue, total_cash: cash, portfolio_risk: { mode: 'NORMAL' }, asset_classes: approved.map((row, i) => ({ asset_class: row.asset_class, display_name: row.display_name, target_weight_pct: row.weight_pct, strategic_weight_pct: row.weight_pct, actual_invested_value: current[i].invested_value, actual_invested_pct: current[i].invested_weight_pct, allowed_invested_value: row.invested_value, allowed_invested_pct: row.invested_weight_pct })) };
    if (path === '/sizing/allocations') {
        const universe = sizingIDs ? [...research, ...demoWatchlistResearch] : research;
        const inputs = universe.filter(a => a.security_type === 'STOCK' && (!sizingIDs || sizingIDs.has(a.id) || (a.is_watchlist && sizingIDs.has(-a.id)))).map(a => {
            const stock = { geminiQuality: a.gemini_quality, geminiValue: a.gemini_value, geminiPT: a.gemini_pt,
                gptQuality: a.gpt_quality, gptValue: a.gpt_value, gptPT: a.gpt_pt, councilPT: a.council_pt,
                price: a.current_price, performance6MPct: a.performance_6m_pct };
            const rawWeight = calculateAnalysisTargetWeight(stock);
            const routerScore = demoRouterScores[a.ticker] ?? null;
            const routerMultiplier = 1 + Math.max(-5, Math.min(5, routerScore ?? 0)) * 0.03;
            return { ...a, rawWeight, routerScore, routerMultiplier, weight: rawWeight * routerMultiplier, baseRating: calculateBaseRatingTotal(stock) };
        });
        return { results: inputs.map(a => {
        const budget = approved.find(row => row.asset_class === a.primary_asset_class)?.value ?? 0;
        const fund = fundForClass(a.primary_asset_class);
        const stockBudget = Math.max(0, budget - (fund ? Math.max(fund.target, fund.actual) : 0));
        const totalWeight = inputs.filter(peer => peer.primary_asset_class === a.primary_asset_class).reduce((sum, peer) => sum + peer.weight, 0);
        const pct = totalWeight > 0 ? a.weight / totalWeight * 100 : 0;
        return { id: a.is_watchlist && sizingIDs?.has(-a.id) ? -a.id : a.id, ticker: a.ticker, asset_class: a.primary_asset_class, base_rating: a.baseRating,
            eligible_for_target_weight: a.baseRating > 0, raw_weight: a.rawWeight, effective_weight: a.weight,
            router_score: a.routerScore, router_multiplier: a.routerMultiplier,
            allocation_pct: pct, allocation_dollar: stockBudget * pct / 100 };
        }), class_budgets_applied: true, advisory_only: true, router_scores_applied: true, class_budget_source: 'APPROVED_CLASS_MINUS_ETF_TARGET_OR_HELD', total_portfolio_value: portfolioValue };
    }
    if (path === '/etf/allocation-ledger') return {
        as_of: date,
        policy: { default_core_ratio_pct: 25, momentum_influence_pct: 50, suggested_exposure_pct: 25 },
        classes: classDefinitions.map(([code, name, pct]) => {
            const fund = fundForClass(code);
            return { asset_class: code, asset_class_name: name,
                class_target_value: pct * portfolioValue / 100, core_ticker: fund ? `ASX:${fund.ticker}` : '',
                core_selection_source: fund ? 'EXPLICIT' : 'NONE', core_ratio_pct: fund ? 25 : 0,
                momentum_influence_pct: 50, core_base_value: fund?.target ?? 0, momentum_adjustment_value: 0,
                recommended_target_value: fund?.target ?? 0, effective_target_value: fund?.target ?? 0,
                effective_target_ratio_pct: fund ? 25 : 0, actual_etf_value: fund?.actual ?? 0,
                target_delta_value: fund?.delta ?? 0, stock_capacity_value: pct * portfolioValue / 100 - (fund ? Math.max(fund.target, fund.actual) : 0) };
        }),
        rows: funds.map(fund => ({ ticker: `ASX:${fund.ticker}`, display_name: fund.name, asset_class: fund.assetClass, asset_class_name: fund.className, management_mode: 'etf_tms', is_core: true, core_selection_source: 'EXPLICIT', core_ratio_pct: 25, momentum_influence_pct: 50, class_target_value: fund.budget, actual_value: fund.actual, core_actual_value: fund.actual, core_target_value: fund.target, recommended_target_value: fund.target, effective_target_value: fund.target, final_target_value: fund.target, momentum_adjustment_value: 0, target_delta_value: fund.delta, book_target_pct: percent(fund.target), target_weight_pct: percent(fund.target), tactical_target_value: 0, tactical_actual_value: 0, excess_value: Math.max(0, -fund.delta), remaining_value: Math.max(0, fund.delta), momentum_weight_pct: fund.target / etfTarget * 100, tactical_status: 'BUY', status: 'CORE' })),
        candidates: [],
        summary: { portfolio_value: portfolioValue, actual_etf_value: etfActual, actual_exposure_pct: percent(etfActual), has_approved_shape: true, effective_target_value: etfTarget, core_target_value: etfTarget, recommended_target_value: etfTarget, final_target_value: etfTarget, tactical_target_value: 0, momentum_adjustment_value: 0, suggested_exposure_pct: 25, suggested_etf_value: portfolioValue * 0.25, minimum_etf_value: portfolioValue * 0.25, remaining_to_suggestion_value: portfolioValue * 0.25 - etfActual, remaining_to_minimum_value: portfolioValue * 0.25 - etfActual, remaining_to_target_value: etfDelta },
    };
    if (path === '/etf/momentum') return { latest_run: { id: 1, data_fresh_through: date, rows: [...funds].sort((a, b) => b.returnPct - a.returnPct).map((fund, i) => ({ ticker: `ASX:${fund.ticker}`, display_name: fund.name, asset_class: fund.assetClass, return_80_pct: fund.returnPct * 0.8, score: fund.returnPct / 5, rank: i + 1, price_date: date })) }, automation: {} };
    if (path === '/settings') return {};
    if (path === '/announcement-router/signals' || path === '/council/announcement-router/signals') return demoRouterScores;
    if (path === '/data-freshness') return {
        generated_at: date,
        scheduler: { enabled: false, daily_utc_hour: 6, listing_enabled: false, listing_utc_hour: 6, news_enabled: false, news_daily_utc_hour: 7, poll_interval_minutes: 60 },
        datasets: Object.keys(DATASET_LABELS).map((dataset, i) => {
            const event = ['BROKER_STATEMENTS', 'TRADINGVIEW_SIGNALS'].includes(dataset);
            const count = ({ ANALYSIS_PRICE_HISTORY: research.length + demoWatchlistResearch.length, ETF_MOMENTUM: funds.length,
                COMMODITY_PRICE_HISTORY: markets.length, REGIME_RETURNS: 4, LISTING_VERIFICATION: research.length + demoWatchlistResearch.length,
                TRADINGVIEW_SIGNALS: alertExamples.length } as Record<string, number>)[dataset] ?? 1;
            return { id: i + 1, dataset, source: 'SYNTHETIC_DEMO', update_mode: event ? 'EVENT_INGESTION' : 'SCHEDULED', cadence: event ? 'EVENT' : 'DAILY',
                trigger_source: 'DEMO_FIXTURE', status: 'COMPLETE', last_attempt_at: date, finished_at: date, last_success_at: date, data_fresh_through: date,
                coverage_complete: true, records_expected: count, records_updated: count, error_count: 0, stale_after_days: 7 };
        }),
    } satisfies DataFreshnessResponse;
    if (path === '/commodity-themes') return { generated_at: date, themes: markets };
    if (path.startsWith('/commodity-themes/')) return markets.find(theme => theme.code === path.split('/').pop()) ?? null;
    if (path === '/rebalance/status') return { active: false, targets: [] };
    if (path.includes('/adjustments/')) return { plan: null };
    if (path === '/source-research/templates') return { configured: false, templates: [], processor: 'demo', estimated_cost_usd: 0 };
    return [];
}

export async function demoResponse(path: string, request: Request): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store', 'X-Alpha-Edge-Demo': 'synthetic-read-only' };
    if (!['GET', 'HEAD'].includes(request.method) && !(path === '/sizing/allocations' && request.method === 'POST')) {
        return Response.json({ error: 'This demonstration is read-only. No changes or paid jobs are submitted.', code: 'DEMO_READ_ONLY' }, { status: 403, headers });
    }
    if (path.startsWith('/auth/') || path.startsWith('/webhook') || path.startsWith('/migrate/')) return new Response(null, { status: 403, headers });
    if (path === '/alerts/stream') return new Response('data: {"type":"connected"}\n\n', { headers: { ...headers, 'Content-Type': 'text/event-stream' } });
    if (path === '/portfolio-mix/cycle-performance') {
        const raw = new URL(request.url).searchParams.get('snapshot_id');
        const id = raw === null ? 3 : Number(raw);
        if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: 'snapshot_id must be a positive approval ID' }, { status: 400, headers });
        const index = approvals.findIndex(entry => entry.snapshot_id === id);
        if (index < 0) return Response.json({ error: 'Approved shape not found' }, { status: 404, headers });
        const start = approvals[index].occurred_at;
        const end = approvals[index + 1]?.occurred_at ?? date;
        const previousDay = (value: string) => new Date(Date.parse(value) - 86400000).toISOString().slice(0, 10);
        // Illustrative opening baskets and adjusted-price returns, never real account evidence.
        const securities = definitions.map(d => ({ ticker: d.ticker, exchange: 'ASX:', name: d.name, asset_class: d.assetClass,
            opening_value_aud: valueOf(d) / (1 + d.returnPct / 100), return_pct: d.returnPct * [0.5, 0.75, 1][index],
            start_price_date: previousDay(start), end_price_date: previousDay(end) }));
        const classes = approved.map(row => {
            const members = securities.filter(d => d.asset_class === row.asset_class);
            const capital = members.reduce((sum, d) => sum + d.opening_value_aud, 0);
            return { asset_class: row.asset_class, securities: members.length, covered: members.length, coverage_pct: capital ? 100 : 0,
                return_pct: capital ? members.reduce((sum, d) => sum + d.opening_value_aud * d.return_pct, 0) / capital : null,
                reason: capital ? undefined : 'Cash interest is not included in price returns.' };
        });
        return Response.json({ cycle: { snapshot_id: id, started_at: start, ended_at: end, closed: index < 2 },
            baseline_at: previousDay(start), method: 'opening_basket_adjusted_price_return', synthetic: true, classes, securities,
            covered: securities.length, best_performer: [...securities].sort((a, b) => b.return_pct - a.return_pct)[0] }, { headers });
    }
    if (path === '/sizing/allocations' && request.method === 'POST') {
        try {
            const body = await request.json();
            if (!Array.isArray(body.stocks)) return Response.json({ error: 'Stocks are required.' }, { status: 400, headers });
            // Only fixture identities are accepted; no private or submitted data is retained.
            return Response.json(payload(path, new Set(body.stocks.map((stock: { id: number }) => stock.id))), { headers });
        } catch { return Response.json({ error: 'Invalid sizing request.' }, { status: 400, headers }); }
    }
    return Response.json(payload(path), { headers });
}
