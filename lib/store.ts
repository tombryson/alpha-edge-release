import { create } from 'zustand';
import { getAccessMode } from './access-mode';
import { useETFManagement } from './etf-management-store';
import {
    api,
    type AlertResponse,
    type ActiveAlertResponse,
    type StatementHolding,
    type StockAnalysisResponse,
} from './api';
import { canonicalAlertType } from './alert-format';
import {
    isNonAllocatingSecurityType,
    normalizeSecurityType,
    preferredSecurityType,
} from './security-types';

export interface Stock {
    id: number;
    analysisId?: number;
    symbol: string;
    name: string;
    templateId?: string | null;
    councilRunId?: string | null;
    councilRunLabel?: string | null;
    price: number;
    change: number;
    changePercent: number;
    changeValue: number;
    signal: 'BUY' | 'SELL';
    position: number;
    positionValue: number;
    bookValue: number;
    cashReserve: number;
    exposure: number;
    prefix?: string;
    quality?: number;
    valueScore?: number;
    totalScore?: number;
    upside24M?: number;
    allocation?: number;
    performance6MPct?: number | null;
    performance12MPct?: number | null;
    performanceAsOf?: string | null;
    performanceSource?: string | null;
    primaryAssetClass?: string | null;
    securityType?: 'STOCK' | 'ETF' | string | null;
    overlaySellPriority?: number;
    marketCap?: string | null;
    notes?: string | null;
    grokQuality?: number;
    grokValue?: number;
    geminiQuality?: number;
    geminiValue?: number;
    gptQuality?: number;
    gptValue?: number;
    deerFlowQuality?: number;
    deerFlowValue?: number;
    perplexityQuality?: number;
    perplexityValue?: number;
    claudeQuality?: number;
    claudeValue?: number;
    councilQuality?: number;
    councilValue?: number;
    geminiPT?: number;
    grokPT?: number;
    gptPT?: number;
    deerFlowPT?: number;
    perplexityPT?: number;
    claudePT?: number;
    councilPT?: number;
    geminiWebuiOutput?: string | null;
    geminiWebuiInputAt?: string | null;
    perplexityWebuiOutput?: string | null;
    perplexityWebuiInputAt?: string | null;
    gptWebuiOutput?: string | null;
    gptWebuiInputAt?: string | null;
    claudeWebuiOutput?: string | null;
    claudeWebuiInputAt?: string | null;
    councilSourceOutput?: string | null;
    councilSourceInputAt?: string | null;
    tipRanksPT?: number;
    analystPT?: number;
    riskProfile?: 'RISK_ON' | 'RISK_OFF' | null;
    thesis?: string | null;
    bearCasePT?: number;
    baseCasePT?: number;
    bullCasePT?: number;
    bearCasePT12M?: number;
    baseCasePT12M?: number;
    bullCasePT12M?: number;
    bearProbability?: number;
    baseProbability?: number;
    bullProbability?: number;
    bearProbability12M?: number;
    baseProbability12M?: number;
    bullProbability12M?: number;
    catalysts?: string | null;
    lastContributedAt?: Date | null;
    includeInSizing?: boolean;
    isWatchlist?: boolean; // true if this is a watchlist item (not a held position)
    isExternal?: boolean;  // true if held on an external broker (e.g. CMC) — not in IG feed
}

export interface ETF {
    symbol: string;
    name: string;
    price: number;
    status: 'STRONG' | 'WEAK' | 'NEUTRAL';
    position?: 'BUY' | 'SELL';
    lastSignal?: 'ADD' | 'TRIM' | null;
    lastSignalDate?: Date;
}

export interface Alert {
    id: string;
    symbol: string;
    signal: 'BUY' | 'SELL' | 'SELL_50' | 'ADD' | 'TRIM' | 'BREAKOUT' | 'SELL_DOWN' | 'DCA' | 'REENTRY' | 'OUTPERFORM_CONFIRMED' | 'OUTPERFORM_LOST' | 'WEIGHT_REDUCE';
    timestamp: Date;
    reason: string;
    confidence: number;
    strength?: 'Strong' | 'Weak' | null;
    dismissed?: boolean;
    alert_type?: 'REGIME' | string; // REGIME alerts vs normal stock/ETF alerts
    affected_positions?: string | null; // JSON string of affected positions for regime alerts
    expiry_date?: Date; // For CDF buy-zone alerts (30 days) and other expiring signals
    source?: string; // 'cdf' | 'tms'/'atr_oscillator' | 'regime' | 'unknown'
    alertPrice?: number | null;
    currentPrice?: number | null;
    movePct?: number | null;
    themeAssetClass?: string;
}

export interface Portfolio {
    totalValue: number;
    cashOnHand: number;
    exposure: number;
    profitLoss: number;
    profitLossPercent: number;
}

interface StoreState {
    stocks: Stock[];
    etfs: ETF[];
    alerts: Alert[];
    activeAlerts: ActiveAlertResponse[];
    activeAlertsReady: boolean;
    portfolio: Portfolio;
    lastSyncTime: Date | null;
    isLoading: boolean;
    error: string | null;
    fetchAlerts: () => Promise<void>;
    fetchActiveAlerts: () => Promise<void>;
    fetchPortfolio: () => Promise<void>;
    fetchHoldings: () => Promise<void>;
    updateStock: (id: number, updates: Partial<Stock>) => void;
    executeAlert: (alertId: string, action: 'buy' | 'trim' | 'ignore') => void;
    dismissAlert: (alertId: string) => Promise<void>;
    hydrateFromCache: () => void;
    initialize: () => Promise<void>;
}

const normalizeAlertType = (alertType: string) => {
    return canonicalAlertType(alertType);
};

const convertAlert = (apiAlert: AlertResponse): Alert => {
    const alertType = normalizeAlertType(apiAlert.alert_type);
    const themeAssetClass =
        apiAlert.exchange_prefix === 'THEME:' ||
        apiAlert.exchange_prefix === 'ASSET_CLASS:' ||
        /^(?:THEME|ASSET_CLASS):/i.test(apiAlert.ticker)
            ? apiAlert.ticker.replace(/^(?:THEME|ASSET_CLASS):/i, '').trim() || undefined
            : undefined;

    // For REGIME alerts, the signal (BUY/SELL) is in the strength field
    const isRegimeAlert = alertType === 'REGIME';

    // Determine reason based on alert type
    let reason = apiAlert.strength || 'Position Alert';
    if (isRegimeAlert) {
        reason = 'Regime Change';
    } else if (alertType === 'BREAKOUT') {
        reason = 'CDF buy zone window';
    } else if (alertType === 'SELL_DOWN') {
        reason = 'CDF sell 20% zone';
    } else if (alertType === 'SELL_50') {
        reason = 'TMS stop in CDF buy zone';
    }

    return {
        id: apiAlert.id.toString(),
        symbol: apiAlert.ticker,
        signal: isRegimeAlert
            ? (apiAlert.strength as 'BUY' | 'SELL')
            : (alertType as Alert['signal']),
        timestamp: new Date(apiAlert.created_at),
        reason,
        confidence: 80,
        strength: isRegimeAlert ? null : (apiAlert.strength as 'Strong' | 'Weak' | null),
        alert_type: alertType,
        affected_positions: apiAlert.affected_positions,
        expiry_date: apiAlert.expiry_date ? new Date(apiAlert.expiry_date) : undefined,
        source: apiAlert.source,
        alertPrice: apiAlert.alert_price ?? null,
        currentPrice: apiAlert.current_price ?? null,
        movePct: apiAlert.move_pct ?? null,
        themeAssetClass,
    };
};

const convertHoldingToStock = (
    holding: StatementHolding,
    totalPortfolioValue: number,
    analysis?: StockAnalysisResponse,
): Stock => {
    // Use ticker from company_mappings, NO fallback - leave empty if not mapped
    const symbol = holding.ticker || '';

    // Use exchange_prefix from company_mappings, NO fallback - leave empty if not mapped
    const prefix = holding.exchange_prefix || '';

    // Calculate position exposure (% of this position's allocation that is invested)
    const totalPositionAllocation = holding.value_aud + holding.cash_reserve;
    const positionExposure =
        totalPositionAllocation > 0
            ? (holding.value_aud / totalPositionAllocation) * 100
            : 0;

    return {
        id: holding.id,
        analysisId: analysis?.id,
        symbol: symbol,
        name: holding.details,
        templateId: holding.template_id || null,
        councilRunId: analysis?.council_run_id || null,
        councilRunLabel: analysis?.council_run_label || null,
        price: holding.current_price,
        change: holding.gain_loss_aud,
        changePercent: holding.gain_loss_pct,
        changeValue: holding.gain_loss_aud,
        signal: 'BUY', // Default - will be overridden by security_positions data in component
        position: holding.quantity,
        positionValue: holding.market_value,
        bookValue: holding.cost_aud,
        cashReserve: holding.cash_reserve,
        exposure: positionExposure,
        prefix: prefix,
        // Analysis data from database
        grokQuality: analysis?.grok_quality || 0,
        grokValue: analysis?.grok_value || 0,
        geminiQuality: analysis?.gemini_quality || 0,
        geminiValue: analysis?.gemini_value || 0,
        gptQuality: analysis?.gpt_quality || 0,
        gptValue: analysis?.gpt_value || 0,
        deerFlowQuality: analysis?.deer_flow_quality || 0,
        deerFlowValue: analysis?.deer_flow_value || 0,
        perplexityQuality: analysis?.perplexity_quality || 0,
        perplexityValue: analysis?.perplexity_value || 0,
        claudeQuality: analysis?.claude_quality || 0,
        claudeValue: analysis?.claude_value || 0,
        councilQuality: analysis?.council_quality || 0,
        councilValue: analysis?.council_value || 0,
        grokPT: analysis?.grok_pt || 0,
        geminiPT: analysis?.gemini_pt || 0,
        gptPT: analysis?.gpt_pt || 0,
        deerFlowPT: analysis?.deer_flow_pt || 0,
        perplexityPT: analysis?.perplexity_pt || 0,
        claudePT: analysis?.claude_pt || 0,
        councilPT: analysis?.council_pt || 0,
        geminiWebuiOutput: analysis?.gemini_webui_output || null,
        geminiWebuiInputAt: analysis?.gemini_webui_input_at || null,
        perplexityWebuiOutput: analysis?.perplexity_webui_output || null,
        perplexityWebuiInputAt: analysis?.perplexity_webui_input_at || null,
        gptWebuiOutput: analysis?.gpt_webui_output || null,
        gptWebuiInputAt: analysis?.gpt_webui_input_at || null,
        claudeWebuiOutput: analysis?.claude_webui_output || null,
        claudeWebuiInputAt: analysis?.claude_webui_input_at || null,
        councilSourceOutput: analysis?.council_source_output || null,
        councilSourceInputAt: analysis?.council_source_input_at || null,
        tipRanksPT: analysis?.tipranks_pt || 0,
        analystPT: analysis?.analyst_pt || 0,
        upside24M: analysis?.upside_24m || 0,
        allocation: analysis?.allocation || 0,
        includeInSizing: analysis?.include_in_sizing ?? true,
        performance6MPct: analysis?.performance_6m_pct ?? null,
        performance12MPct: analysis?.performance_12m_pct ?? null,
        performanceAsOf: analysis?.performance_as_of || null,
        performanceSource: analysis?.performance_source || null,
        primaryAssetClass: analysis?.primary_asset_class || null,
        securityType: analysis?.security_type || null,
        overlaySellPriority: analysis?.overlay_sell_priority || 3,
        riskProfile: analysis?.risk_profile as 'RISK_ON' | 'RISK_OFF' | null | undefined,
        thesis: analysis?.thesis || null,
        bearCasePT: analysis?.bear_case_pt || 0,
        baseCasePT: analysis?.base_case_pt || 0,
        bullCasePT: analysis?.bull_case_pt || 0,
        bearProbability: analysis?.bear_probability || 0,
        baseProbability: analysis?.base_probability || 0,
        bullProbability: analysis?.bull_probability || 0,
        catalysts: analysis?.catalysts || null,
        lastContributedAt: analysis?.last_contributed_at ? new Date(analysis.last_contributed_at) : null,
    };
};

// Load cached data from localStorage
const loadCachedData = () => {
    if (getAccessMode() !== 'legacy') return null;
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const cached = localStorage.getItem('terminal-cached-data');
        if (cached) {
            const parsed = JSON.parse(cached);

            // If cached portfolio has $0 values, clear the cache and return null to force fresh fetch
            if (parsed.portfolio && parsed.portfolio.totalValue === 0 && parsed.portfolio.cashOnHand === 0) {
                localStorage.removeItem('terminal-cached-data');
                return null;
            }

            // Convert date strings back to Date objects
            if (parsed.lastSyncTime) {
                parsed.lastSyncTime = new Date(parsed.lastSyncTime);
            }
            if (parsed.alerts) {
                parsed.alerts = parsed.alerts.map((alert: any) => ({
                    ...alert,
                    timestamp: new Date(alert.timestamp),
                    expiry_date: alert.expiry_date
                        ? new Date(alert.expiry_date)
                        : undefined,
                }));
            }
            if (parsed.stocks) {
                parsed.stocks = parsed.stocks.map((stock: any) => ({
                    ...stock,
                    lastContributedAt: stock.lastContributedAt
                        ? new Date(stock.lastContributedAt)
                        : null,
                }));
            }
            if (parsed.etfs) {
                parsed.etfs = parsed.etfs.map((etf: any) => ({
                    ...etf,
                    lastSignalDate: etf.lastSignalDate
                        ? new Date(etf.lastSignalDate)
                        : undefined,
                }));
            }
            return parsed;
        }
    } catch (e) {
        console.error('[ALPHA EDGE] Failed to load cached data:', e);
    }
    return null;
};

export const useStore = create<StoreState>((set, get) => ({
    stocks: [],
    etfs: [],
    alerts: [],
    activeAlerts: [],
    activeAlertsReady: false,
    portfolio: {
        totalValue: 0,
        cashOnHand: 0,
        exposure: 0,
        profitLoss: 0,
        profitLossPercent: 0,
    },
    lastSyncTime: null,
    isLoading: false,
    error: null,

    hydrateFromCache: () => {
        const cachedData = loadCachedData();
        if (!cachedData) return;

        set((state) => ({
            ...state,
            stocks: cachedData.stocks || state.stocks,
            etfs: cachedData.etfs || state.etfs,
            alerts: cachedData.alerts || state.alerts,
            portfolio:
                cachedData.portfolio && cachedData.portfolio.totalValue > 0
                    ? cachedData.portfolio
                    : state.portfolio,
            lastSyncTime: cachedData.lastSyncTime || state.lastSyncTime,
        }));
    },

    fetchAlerts: async () => {
        try {
            set({ isLoading: true, error: null });
            const apiAlerts = await api.getAlerts();
            const alerts = apiAlerts.map(convertAlert);
            set((state) => ({ ...state, alerts, isLoading: false }));

            // Cache alerts to localStorage (don't save portfolio here to avoid race conditions)
            if (typeof window !== 'undefined' && getAccessMode() === 'legacy') {
                try {
                    const cached = localStorage.getItem('terminal-cached-data');
                    const existing = cached ? JSON.parse(cached) : {};
                    localStorage.setItem(
                        'terminal-cached-data',
                        JSON.stringify({
                            ...existing,
                            alerts: alerts,
                        }),
                    );
                } catch (e) {
                    console.error('[ALPHA EDGE] Failed to cache alerts:', e);
                }
            }
        } catch (error) {
            set({ isLoading: false });
        }
    },

    fetchActiveAlerts: async () => {
        try {
            const [activeAlerts] = await Promise.all([api.getActiveAlerts(), useETFManagement.getState().refresh()]);
            // Ensure we always set an array, never null
            set({ activeAlerts: Array.isArray(activeAlerts) ? activeAlerts : [], activeAlertsReady: Array.isArray(activeAlerts) });
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to fetch active alerts:', error);
            // On error, set empty array instead of leaving it null
            set({ activeAlerts: [], activeAlertsReady: false });
        }
    },

    fetchPortfolio: async () => {
        try {
            set({ isLoading: true, error: null });
            const portfolioData = await api.getPortfolio();

            const portfolioState = {
                totalValue: portfolioData.total_value,
                cashOnHand: portfolioData.cash_on_hand,
                exposure: portfolioData.exposure,
                profitLoss: portfolioData.profit_loss,
                profitLossPercent: portfolioData.profit_loss_percent,
            };

            set((state) => ({
                ...state,
                portfolio: portfolioState,
                isLoading: false,
            }));

            // Cache to localStorage
            if (typeof window !== 'undefined' && getAccessMode() === 'legacy') {
                try {
                    const currentState = get();
                    localStorage.setItem(
                        'terminal-cached-data',
                        JSON.stringify({
                            stocks: currentState.stocks,
                            etfs: currentState.etfs,
                            alerts: currentState.alerts,
                            portfolio: portfolioState,
                            lastSyncTime: currentState.lastSyncTime,
                        }),
                    );
                } catch (e) {
                    console.error('[ALPHA EDGE] Failed to cache portfolio:', e);
                }
            }
        } catch (error) {
            console.error('[ALPHA EDGE] fetchPortfolio: Error:', error);
            set({ isLoading: false, error: error instanceof Error ? error.message : 'Failed to fetch portfolio' });
        }
    },

    fetchHoldings: async () => {
        try {
            set({ isLoading: true, error: null });
            const [statementData, analysisData] = await Promise.all([
                api.getLatestStatement(),
                api.getAllAnalysis().catch(() => []), // Gracefully handle if analysis endpoint fails
            ]);

            const totalValue = statementData.statement.total_value_aud;

            // Cash-equivalent ETFs are excluded from equity holdings and counted as cash.
            // The backend already handles this, but we guard defensively here too.
            const CASH_EQUIVALENT_TICKERS = ['BSUB', 'AAA'];
            const cashEquivalentTickerKey = (ticker?: string | null) => {
                const key = (ticker || '').trim().toUpperCase();
                return key.includes(':') ? key.split(':').pop() || key : key;
            };
            const regularHoldings = statementData.holdings.filter(
                h => !CASH_EQUIVALENT_TICKERS.includes(cashEquivalentTickerKey(h.ticker))
            );
            const cashEquivalentValue = statementData.holdings
                .filter(h => CASH_EQUIVALENT_TICKERS.includes(cashEquivalentTickerKey(h.ticker)))
                .reduce((sum, h) => sum + (h.value_aud || 0), 0);

            // Create a map of analysis data by name (fallback to ticker).
            // If duplicate rows exist, keep the richer row so webhook-created
            // placeholders cannot hide an existing asset-class assignment.
            const analysisMap = new Map<string, StockAnalysisResponse>();
            const usedAnalysisNames = new Set<string>();
            const analysisScore = (analysis: StockAnalysisResponse) =>
                (analysis.primary_asset_class ? 1000 : 0) +
                (isNonAllocatingSecurityType(analysis.security_type) ? 500 : 0) +
                (normalizeSecurityType(analysis.security_type) === 'ETF' ? 250 : 0) +
                (analysis.council_run_id ? 100 : 0) +
                (analysis.council_quality || 0) +
                (analysis.council_value || 0) +
                (analysis.thesis ? 25 : 0);
            const setPreferredAnalysis = (key: string | undefined | null, analysis: StockAnalysisResponse) => {
                if (!key) return;
                const existing = analysisMap.get(key);
                if (!existing || analysisScore(analysis) >= analysisScore(existing)) {
                    analysisMap.set(key, existing ? {
                        ...analysis,
                        primary_asset_class: analysis.primary_asset_class || existing.primary_asset_class || null,
                        security_type: preferredSecurityType(
                            analysis.security_type,
                            existing.security_type,
                        ),
                    } : analysis);
                    return;
                }
                analysisMap.set(key, {
                    ...existing,
                    primary_asset_class: existing.primary_asset_class || analysis.primary_asset_class || null,
                    security_type: preferredSecurityType(
                        existing.security_type,
                        analysis.security_type,
                    ),
                });
            };
            if (analysisData && Array.isArray(analysisData)) {
                analysisData.forEach((analysis) => {
                    setPreferredAnalysis(analysis.name, analysis);
                    if (analysis.ticker) {
                        setPreferredAnalysis(analysis.ticker, analysis);
                        const rawTicker = analysis.ticker.includes(':')
                            ? analysis.ticker.split(':').pop()
                            : analysis.ticker;
                        if (rawTicker) {
                            setPreferredAnalysis(rawTicker, analysis);
                        }
                    }
                });
            }

            // Merge regular holdings with analysis data (cash equivalents excluded)
            const analysisForHolding = (holding: StatementHolding) => {
                const holdingFullTicker = holding.ticker && holding.exchange_prefix
                    ? `${holding.exchange_prefix}${holding.ticker}`
                    : holding.ticker || '';
                return (
                    analysisMap.get(holding.details) ||
                    (holdingFullTicker ? analysisMap.get(holdingFullTicker) : undefined) ||
                    (holding.ticker ? analysisMap.get(holding.ticker) : undefined) ||
                    undefined
                );
            };
            const heldStocks = regularHoldings.map((holding) => {
                const analysis = analysisForHolding(holding);
                if (analysis) {
                    usedAnalysisNames.add(analysis.name);
                }
                return convertHoldingToStock(holding, totalValue, analysis);
            });
            const allocatingHoldings = regularHoldings.filter(
                (holding) =>
                    !isNonAllocatingSecurityType(
                        analysisForHolding(holding)?.security_type,
                    ),
            );

            // Create watchlist entries from analysis data that doesn't match any holdings
            const watchlistStocks: Stock[] = [];
            if (analysisData && Array.isArray(analysisData)) {
                // Symbols already covered by held positions — never add a watchlist duplicate
                const heldSymbols = new Set(
                    heldStocks.map(s => s.symbol?.toUpperCase()).filter(Boolean)
                );

                // Track tickers already added to watchlist to prevent duplicates.
                // Sort so proper names (name != ticker) come before placeholders (name == ticker),
                // ensuring we keep the real entry when both exist for the same ticker.
                const usedWatchlistTickers = new Set<string>();
                const sortedAnalysis = [...analysisData].sort((a, b) => {
                    const aIsPlaceholder = a.ticker && a.name === a.ticker;
                    const bIsPlaceholder = b.ticker && b.name === b.ticker;
                    if (aIsPlaceholder && !bIsPlaceholder) return 1;
                    if (!aIsPlaceholder && bIsPlaceholder) return -1;
                    return 0;
                });

                sortedAnalysis.forEach((analysis) => {
                    // Skip if this analysis was already matched to a holding by name
                    if (usedAnalysisNames.has(analysis.name)) return;

                    // Only explicit watchlist rows or external holdings should be
                    // promoted into the live frontend stock list. Plain analysis
                    // coverage for a name you no longer hold should not masquerade
                    // as a live position/watchlist item.
                    if (!analysis.is_watchlist && !analysis.is_external) return;

                    // Skip duplicate tickers — prefer proper names over bare-ticker placeholders
                    const tickerKey = analysis.ticker?.toUpperCase() || '';
                    if (tickerKey && usedWatchlistTickers.has(tickerKey)) return;
                    if (tickerKey) usedWatchlistTickers.add(tickerKey);

                    // Skip if the ticker symbol is already a held position (name mismatch guard)
                    const tickerSymbolOnly = tickerKey.includes(':') ? tickerKey.split(':').pop()! : tickerKey;
                    if (tickerSymbolOnly && heldSymbols.has(tickerSymbolOnly)) return;

                    // Parse ticker to extract prefix and symbol (e.g., "NASDAQ:TSLA" -> prefix: "NASDAQ:", symbol: "TSLA")
                    const fullTicker = analysis.ticker || '';
                    let tickerPrefix = '';
                    let tickerSymbol = fullTicker;
                    if (fullTicker.includes(':')) {
                        const colonIndex = fullTicker.indexOf(':');
                        tickerPrefix = fullTicker.substring(0, colonIndex + 1); // Include the colon
                        tickerSymbol = fullTicker.substring(colonIndex + 1);
                    }

                    // Create a watchlist stock entry
                    watchlistStocks.push({
                        id: -analysis.id, // Negative ID to distinguish from holdings
                        analysisId: analysis.id,
                        symbol: tickerSymbol,
                        name: analysis.name,
                        templateId: null,
                        councilRunId: analysis.council_run_id || null,
                        councilRunLabel: analysis.council_run_label || null,
                        price: analysis.current_price || 0,
                        change: 0,
                        changePercent: 0,
                        changeValue: 0,
                        signal: 'BUY',
                        position: 0,
                        positionValue: 0,
                        bookValue: 0,
                        cashReserve: 0,
                        exposure: 0,
                        prefix: tickerPrefix,
                        grokQuality: analysis.grok_quality || 0,
                        grokValue: analysis.grok_value || 0,
                        geminiQuality: analysis.gemini_quality || 0,
                        geminiValue: analysis.gemini_value || 0,
                        gptQuality: analysis.gpt_quality || 0,
                        gptValue: analysis.gpt_value || 0,
                        deerFlowQuality: analysis.deer_flow_quality || 0,
                        deerFlowValue: analysis.deer_flow_value || 0,
                        perplexityQuality: analysis.perplexity_quality || 0,
                        perplexityValue: analysis.perplexity_value || 0,
                        claudeQuality: analysis.claude_quality || 0,
                        claudeValue: analysis.claude_value || 0,
                        councilQuality: analysis.council_quality || 0,
                        councilValue: analysis.council_value || 0,
                        grokPT: analysis.grok_pt || 0,
                        geminiPT: analysis.gemini_pt || 0,
                        gptPT: analysis.gpt_pt || 0,
                        deerFlowPT: analysis.deer_flow_pt || 0,
                        perplexityPT: analysis.perplexity_pt || 0,
                        claudePT: analysis.claude_pt || 0,
                        councilPT: analysis.council_pt || 0,
                        geminiWebuiOutput: analysis.gemini_webui_output || null,
                        geminiWebuiInputAt: analysis.gemini_webui_input_at || null,
                        perplexityWebuiOutput: analysis.perplexity_webui_output || null,
                        perplexityWebuiInputAt: analysis.perplexity_webui_input_at || null,
                        gptWebuiOutput: analysis.gpt_webui_output || null,
                        gptWebuiInputAt: analysis.gpt_webui_input_at || null,
                        claudeWebuiOutput: analysis.claude_webui_output || null,
                        claudeWebuiInputAt: analysis.claude_webui_input_at || null,
                        councilSourceOutput: analysis.council_source_output || null,
                        councilSourceInputAt: analysis.council_source_input_at || null,
                        tipRanksPT: analysis.tipranks_pt || 0,
                        analystPT: analysis.analyst_pt || 0,
                        upside24M: analysis.upside_24m || 0,
                        allocation: analysis.allocation || 0,
                        includeInSizing: analysis.include_in_sizing ?? true,
                        performance6MPct: analysis.performance_6m_pct ?? null,
                        performance12MPct: analysis.performance_12m_pct ?? null,
                        performanceAsOf: analysis.performance_as_of || null,
                        performanceSource: analysis.performance_source || null,
                        primaryAssetClass: analysis.primary_asset_class || null,
                        securityType: analysis.security_type || null,
                        riskProfile: analysis.risk_profile as 'RISK_ON' | 'RISK_OFF' | null | undefined,
                        thesis: analysis.thesis || null,
                        bearCasePT: analysis.bear_case_pt || 0,
                        baseCasePT: analysis.base_case_pt || 0,
                        bullCasePT: analysis.bull_case_pt || 0,
                        bearProbability: analysis.bear_probability || 0,
                        baseProbability: analysis.base_probability || 0,
                        bullProbability: analysis.bull_probability || 0,
                        catalysts: analysis.catalysts || null,
                        lastContributedAt: analysis.last_contributed_at ? new Date(analysis.last_contributed_at) : null,
                        isWatchlist: analysis.is_watchlist || false,
                        isExternal: analysis.is_external || false,
                    });
                });
            }

            // Combine held stocks and watchlist stocks
            const stocks = [...heldStocks, ...watchlistStocks];

            // Non-allocating records stay available for reconciliation but do not
            // participate in operating exposure or strategy P/L.
            const totalHoldingsValue = allocatingHoldings.reduce(
                (sum, h) => sum + (h.value_aud || 0),
                0,
            );
            const totalGainLoss = allocatingHoldings.reduce(
                (sum, h) => sum + (h.gain_loss_aud || 0),
                0,
            );
            const totalCost = allocatingHoldings.reduce(
                (sum, h) => sum + (h.cost_aud || 0),
                0,
            );

            const portfolioState = {
                totalValue: statementData.statement.total_value_aud,
                // Add cash-equivalent ETF value to cash (backend already does this, but guard for unmapped tickers)
                cashOnHand: statementData.statement.cash_aud + cashEquivalentValue,
                exposure:
                    (totalHoldingsValue /
                        statementData.statement.total_value_aud) *
                    100,
                profitLoss: totalGainLoss,
                profitLossPercent: statementData.statement.total_value_aud > 0
                    ? (totalGainLoss / statementData.statement.total_value_aud) * 100
                    : 0,
            };

            // Use actual import sync timestamp (latest successful sync), not client refresh time.
            let latestImportTime: Date | null = null;
            try {
                const syncHistory = await api.getSyncHistory();
                const latestSuccessful = syncHistory.find(
                    (s) =>
                        s.sync_status === 'success' &&
                        (
                            s.sync_type === 'sheet_import' ||
                            s.sync_type === 'statement_import' ||
                            s.sync_type === 'import'
                        )
                ) || syncHistory.find((s) => s.sync_status === 'success');

                if (latestSuccessful?.synced_at) {
                    const parsed = new Date(latestSuccessful.synced_at);
                    if (!Number.isNaN(parsed.getTime())) {
                        latestImportTime = parsed;
                    }
                }
            } catch {
                // Sync history is optional; keep the previous lastSyncTime.
            }

            set((state) => ({
                ...state,
                stocks,
                portfolio: portfolioState,
                lastSyncTime: latestImportTime ?? state.lastSyncTime ?? null,
                isLoading: false,
            }));

            // Cache to localStorage
            if (typeof window !== 'undefined' && getAccessMode() === 'legacy') {
                try {
                    const currentState = get();
                    localStorage.setItem(
                        'terminal-cached-data',
                        JSON.stringify({
                            stocks,
                            etfs: currentState.etfs,
                            alerts: currentState.alerts,
                            portfolio: portfolioState,
                            lastSyncTime: currentState.lastSyncTime,
                        }),
                    );
                } catch (e) {
                    console.error('[ALPHA EDGE] Failed to cache data:', e);
                }
            }
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to fetch holdings:', error);
            set({ isLoading: false, error: 'Failed to load holdings' });
        }
    },

    initialize: async () => {
        const state = get();
        await Promise.all([state.fetchAlerts(), state.fetchActiveAlerts(), state.fetchHoldings()]);
    },

    updateStock: (id, updates) =>
        set((state) => ({
            stocks: state.stocks.map((stock) =>
                stock.id === id ? { ...stock, ...updates } : stock,
            ),
        })),

    executeAlert: async (alertId, action) => {
        const state = get();
        const alert = state.alerts.find((a) => a.id === alertId);
        if (!alert) return;

        try {
            let decision: 'BUY' | 'SELL' | 'SELL_50' | 'ADD' | 'TRIM' | 'IGNORE';
            if (action === 'ignore') {
                decision = 'IGNORE';
            } else {
                decision =
                    alert.signal === 'BUY' ||
                    alert.signal === 'SELL' ||
                    alert.signal === 'SELL_50' ||
                    alert.signal === 'ADD' ||
                    alert.signal === 'TRIM'
                        ? alert.signal
                        : 'IGNORE';
            }

            await api.createDecision({
                alert_id: Number.parseInt(alertId),
                decision,
                notes: `Action taken via dashboard: ${action}`,
            });

            set((state) => ({
                alerts: state.alerts.filter((a) => a.id !== alertId),
            }));
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to execute alert:', error);
            set({ error: 'Failed to execute alert' });
        }
    },

    dismissAlert: async (alertId) => {
        try {
            // Call API to persist dismissal to database
            await api.dismissAlert(Number.parseInt(alertId));

            // Mark alert as dismissed in local state (keep for LAST column history)
            set((state) => ({
                alerts: state.alerts.map((a) =>
                    a.id === alertId ? { ...a, dismissed: true } : a
                ),
            }));

            // Save alerts to localStorage (don't save portfolio here to avoid race conditions)
            if (typeof window !== 'undefined' && getAccessMode() === 'legacy') {
                try {
                    const cached = localStorage.getItem('terminal-cached-data');
                    const existing = cached ? JSON.parse(cached) : {};
                    const currentState = get();
                    localStorage.setItem(
                        'terminal-cached-data',
                        JSON.stringify({
                            ...existing,
                            alerts: currentState.alerts,
                        }),
                    );
                } catch (e) {
                    console.error('[ALPHA EDGE] Failed to cache dismissed alert:', e);
                }
            }
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to dismiss alert:', error);
            // Still mark as dismissed locally even if API call fails
            set((state) => ({
                alerts: state.alerts.map((a) =>
                    a.id === alertId ? { ...a, dismissed: true } : a
                ),
            }));
        }
    },
}));
