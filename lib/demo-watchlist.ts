import type { WatchlistOpportunity } from './watchlist-opportunities';
import { demoResearch } from './demo-research';

// Synthetic entry scenarios, independent of the demo's held-stock weights.
export const demoWatchlist: WatchlistOpportunity[] = [
    {
        id: 101, ticker: 'ASX:S32', name: 'South32 Limited', asset_class: 'DIVERSIFIED_MINERS', class_name: 'Diversified Miners',
        signal: 'BREAKOUT', outperform: 'BUY', benchmark: 'ASX:XMM', state: 'READY',
        reason: 'Available within current class, signal and funding rules; verify the entry price before trading',
        entry: 100, ideal_pct: 24, class_now: 12.6, class_after: 12.7, class_limit: 13, class_cash: 400, peers: [],
    },
    {
        id: 102, ticker: 'ASX:RRL', name: 'Regis Resources Limited', asset_class: 'GOLD_MINERS', class_name: 'Gold Miners',
        signal: 'BREAKOUT', outperform: 'BUY', benchmark: 'AMEX:GDX', state: 'CAPACITY',
        reason: 'Class has less than $100 of entry capacity',
        entry: 0, ideal_pct: 20, class_now: 9, class_after: 9, class_limit: 9, class_cash: 0, peers: [],
    },
    {
        id: 103, ticker: 'ASX:LYC', name: 'Lynas Rare Earths Limited', asset_class: 'RARE_EARTHS_CRITICAL_MINERALS', class_name: 'Rare Earths & Critical Minerals',
        signal: 'BUY', outperform: 'UNKNOWN', state: 'RESEARCH',
        reason: 'Research incomplete; complete the model results in Analysis',
        entry: 0, ideal_pct: null, class_now: 0, class_after: 0, class_limit: 0, class_cash: 0, peers: [],
    },
    // Public identities: sandfire.com.au, silvermines.com.au, bossenergy.com.
    // These remain watchlist-only; there is no approved budget in these classes.
    ...[
        { id: 104, ticker: 'ASX:SFR', name: 'Sandfire Resources Limited', asset_class: 'COPPER_MINERS', class_name: 'Copper Miners', benchmark: 'AMEX:COPX', outperform: 'BUY' as const },
        { id: 105, ticker: 'ASX:SVL', name: 'Silver Mines Limited', asset_class: 'SILVER_MINERS', class_name: 'Silver Miners', benchmark: 'AMEX:SIL', outperform: 'SELL' as const },
        { id: 106, ticker: 'ASX:BOE', name: 'Boss Energy Limited', asset_class: 'URANIUM_MINERS', class_name: 'Uranium Miners', benchmark: 'AMEX:URA', outperform: 'BUY' as const },
    ].map(item => ({ ...item, signal: 'BUY' as const, state: 'CAPACITY' as const,
        reason: 'No approved class budget', entry: 0, ideal_pct: null,
        class_now: 0, class_after: 0, class_limit: 0, class_cash: 0, peers: [],
    })),
];

export const demoWatchlistResearch = demoWatchlist.map(item => ({
    id: item.id, ticker: item.ticker, name: item.name, primary_asset_class: item.asset_class,
    security_type: 'STOCK', is_watchlist: true, include_in_sizing: true, current_price: 5,
    performance_6m_pct: item.outperform === 'BUY' ? 18 : -6,
    performance_as_of: '2026-09-24T09:00:00Z',
    ...(item.state !== 'RESEARCH' ? { gemini_quality: 75, gemini_value: 70, gemini_pt: 7, gpt_quality: 75, gpt_value: 70, gpt_pt: 7 } : {}),
    thesis: 'Synthetic watchlist scenario. Prices, signals and entry assessments are illustrative, not investment advice.',
    ...demoResearch(item.ticker, item.name, 5, item.id, '2026-09-24T09:00:00Z'),
}));
