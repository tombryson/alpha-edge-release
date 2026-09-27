import { isNonAllocatingSecurityType } from './security-types';

export type WatchlistOpportunity = {
    id: number;
    ticker: string;
    name: string;
    asset_class: string;
    class_name: string;
    signal: string;
    signal_at?: string;
    outperform: string;
    benchmark?: string;
    state: string;
    reason: string;
    entry: number;
    ideal_pct: number | null;
    class_now: number;
    class_after: number;
    class_limit: number;
    class_cash: number;
    action_id?: number;
    peers: { ticker: string; before: number; after: number }[];
};

export type WatchlistAssessment = { items: WatchlistOpportunity[]; as_of: string };
export const WATCHLIST_ENTRY_REQUESTED = 'watchlist-entry:open';

export function openWatchlistEntry(ticker: string) {
    window.dispatchEvent(new CustomEvent(WATCHLIST_ENTRY_REQUESTED, { detail: { ticker } }));
}

export function watchlistStatus(state: string): string {
    return ({ READY: 'Ready to review', RESEARCH: 'Research needed', DATA: 'Refresh data', PENDING: 'Awaiting statement',
        CAPACITY: 'Class at capacity', CAPACITY_REACHED: 'Class at capacity', FUNDING: 'Needs funding', WEIGHT_LIMIT: 'Below entry minimum',
        CDF_BLOCKED: 'Waiting for Buy', WAITING: 'Waiting for signal', FEED_DISCONNECTED: 'Connect signals',
        TREND_UNKNOWN: 'Initialise signals', Q4_BLOCKED: 'Q4 paused', RISK_UNKNOWN: 'Risk state missing',
        MARKET_BLOCKED: 'Market paused', TARGET_UNAVAILABLE: 'Review identity',
    } as Record<string, string>)[state] || 'Entry paused';
}

export function isWatchlistStock(stock: { isWatchlist?: boolean; isExternal?: boolean; securityType?: string | null; position: number; positionValue: number }) {
    return Boolean(stock.isWatchlist && !stock.isExternal && !isNonAllocatingSecurityType(stock.securityType) && stock.position <= 0 && stock.positionValue <= 0);
}
