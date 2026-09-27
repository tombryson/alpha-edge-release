import type { CommodityTheme, CommodityThemeStage, CommodityThemeStatus } from './api';

type Research = { id: number; ticker: string; name: string; primary_asset_class: string; security_type: string; current_price: number };
type Allocation = { asset_class: string; value: number };

// These are synthetic signal paths, not live commodity observations.
const scenarios = [
    { code: 'GOLD', name: 'Gold', group: 'Precious metals', direct: 'PHYSICAL_GOLD', equity: 'GOLD_MINERS',
        price: 'AMEX:GLD', basket: 'AMEX:GDX', commodity: 'BUY', relative: 'BUY', returns: [14.8, 8.2], laggards: ['ASX:NEM', 'ASX:NST'] },
    { code: 'SILVER', name: 'Silver', group: 'Precious metals', direct: 'PHYSICAL_SILVER', equity: 'SILVER_MINERS',
        price: 'AMEX:SLV', basket: 'AMEX:SIL', commodity: 'BUY', relative: 'SELL', returns: [11.2, -2.8], laggards: ['ASX:SVL'] },
    { code: 'COPPER', name: 'Copper', group: 'Industrial metals', direct: 'PHYSICAL_COPPER', equity: 'COPPER_MINERS',
        price: 'AMEX:CPER', basket: 'AMEX:COPX', commodity: 'BUY', relative: 'BUY', returns: [9.3, 5.7], laggards: [] },
    { code: 'BASE_METALS', name: 'Base metals', group: 'Industrial metals', direct: 'PHYSICAL_BASE_METALS', equity: 'DIVERSIFIED_MINERS',
        price: 'AMEX:DBB', basket: 'AMEX:XME', commodity: 'BUY', relative: 'BUY', returns: [6.4, 4.1], laggards: ['ASX:BHP'] },
    { code: 'IRON_ORE', name: 'Iron ore', group: 'Industrial metals', direct: 'PHYSICAL_IRON_ORE', equity: 'IRON_ORE_MINERS',
        price: 'SGX:FEF1!', basket: 'ASX:FMG', commodity: 'SELL', relative: 'SELL', returns: [-9.6, -5.3], laggards: ['ASX:FMG'] },
    { code: 'OIL', name: 'Oil & energy', group: 'Energy', direct: 'PHYSICAL_OIL', equity: 'ENERGY_PRODUCERS',
        price: 'AMEX:USO', basket: 'AMEX:XLE', commodity: 'BUY', relative: 'SELL', returns: [2.7, -3.2], laggards: ['ASX:WDS', 'ASX:STO'] },
    { code: 'URANIUM', name: 'Uranium', group: 'Energy', direct: 'PHYSICAL_URANIUM', equity: 'URANIUM_MINERS',
        price: 'TSX:U.UN', basket: 'AMEX:URA', commodity: 'SELL', relative: 'BUY', returns: [-4.2, 7.1], laggards: [] },
] as const;

const state = (buy: boolean): CommodityThemeStatus => buy ? 'CONFIRMED' : 'BLOCKED';

export function buildDemoMarkets(research: Research[], approved: Allocation[], current: Allocation[], date: string): CommodityTheme[] {
    return scenarios.map(scenario => {
        const budget = approved.find(row => row.asset_class === scenario.equity)?.value ?? 0;
        const held = current.find(row => row.asset_class === scenario.equity)?.value ?? 0;
        const securities = research.filter(row => row.primary_asset_class === scenario.equity && row.security_type !== 'ETF').map(row => {
            const trend = scenario.code !== 'IRON_ORE';
            const outperform = !(scenario.laggards as readonly string[]).includes(row.ticker);
            return {
                security_id: row.id, ticker: row.ticker, name: row.name, include_in_sizing: true,
                stage_states: { SECURITY_TREND: state(trend), SECURITY_OUTPERFORM: state(outperform) },
                latest_events: {
                    SECURITY_TREND: { signal: trend ? 'BUY' as const : 'SELL' as const, close: row.current_price, script: 'cdf', timeframe: '1D', occurred_at: date,
                        source: { kind: 'SECURITY_TREND', symbol: row.ticker } },
                    SECURITY_OUTPERFORM: { signal: outperform ? 'BUY' as const : 'SELL' as const, script: 'cdf', timeframe: '1D', occurred_at: date,
                        source: { kind: 'RELATIVE_STRENGTH', numerator: row.ticker, denominator: scenario.basket } },
                },
            };
        });
        const producerFunds = research.filter(row => row.primary_asset_class === scenario.equity && row.security_type === 'ETF').map(row => ({
            security_id: row.id, ticker: row.ticker, name: row.name,
            trend_state: state(scenario.relative === 'BUY'), trend_updated_at: date,
        }));
        const stages = ([
            { key: 'COMMODITY', order: 1, scope: 'THEME', label: `${scenario.name} price`, signal: scenario.commodity,
                status: state(scenario.commodity === 'BUY'), return_60d_pct: scenario.returns[0],
                source: { kind: 'UNDERLYING_PRICE', symbol: scenario.price, label: `${scenario.name} price` } },
            { key: 'EQUITY_RELATIVE', order: 2, scope: 'THEME', label: 'Equities / commodity', signal: scenario.relative,
                status: state(scenario.relative === 'BUY'), return_60d_pct: scenario.returns[1],
                source: { kind: 'RELATIVE_STRENGTH', numerator: scenario.basket, denominator: scenario.price, label: 'Equities / commodity' } },
            ...(['SECURITY_TREND', 'SECURITY_OUTPERFORM'] as const).map((key, index): CommodityThemeStage => {
                const confirmed = securities.filter(row => row.stage_states[key] === 'CONFIRMED').length;
                return { key, order: index + 3, scope: 'SECURITY', label: index ? 'Outperform' : 'Company trend',
                    status: confirmed === securities.length ? 'CONFIRMED' : confirmed === 0 ? 'BLOCKED' : 'PARTIAL',
                    eligible_security_count: confirmed, blocked_security_count: securities.length - confirmed, eligible_security_total: securities.length,
                    source: index ? { kind: 'RELATIVE_STRENGTH', numerator: 'SECURITY', denominator: scenario.basket, label: 'Company / producer basket' }
                        : { kind: 'SECURITY_TREND', symbol: 'SECURITY', label: 'Company trend' } };
            }),
        ] satisfies CommodityThemeStage[]).map(stage => ({ ...stage, timeframe: '1D', last_confirmed_at: date, last_event_at: date, performance_as_of: date }));
        const confirmations = stages.slice(1).filter(stage => stage.status === 'CONFIRMED').length;
        const permitted = scenario.relative === 'BUY' ? budget : 0;
        return {
            code: scenario.code, display_name: scenario.name, market_group: scenario.group,
            status: confirmations === 3 ? 'CONFIRMED' : scenario.relative === 'SELL' ? 'BLOCKED' : 'PARTIAL',
            confirmation_count: confirmations, confirmation_total: 3,
            strategic_floor: { asset_class_code: scenario.direct, target_value: 0, actual_value: 0 },
            direct_expression: { status: 'SIGNAL_ONLY', existing_position_treatment: 'CLASS_DEFINED' },
            direct_sleeve: { asset_class_code: scenario.direct, target_value: 0, invested_value: 0, sleeve_cash_value: 0, capital_value: 0, budget_approved: false },
            equity_sleeve: { asset_class_code: scenario.equity, target_value: budget, invested_value: held, sleeve_cash_value: 0, capital_value: held, budget_approved: budget > 0 },
            tactical: { asset_class_code: scenario.equity, maximum_value: budget, permitted_value: permitted, actual_value: held, available_value: Math.max(0, permitted - held), budget_approved: budget > 0 },
            reviews: [], stages, eligible_securities: securities, producer_funds: producerFunds,
        };
    });
}
