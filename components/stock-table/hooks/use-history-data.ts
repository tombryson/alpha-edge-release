'use client';

import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { api } from '@/lib/api';
import { ACTIONS_CHANGED, DECISION_HISTORY_REQUESTED } from '@/lib/action-presentation';
import {
    type DecisionResponse,
    type PortfolioPerformancePoint,
    type AssetClassPerformancePoint,
    type SecurityPerformancePoint,
    type PerformanceEvent,
    type PortfolioHistoryEntry,
} from '@/lib/api';
import { normalizeActionType } from '@/components/stock-table/action-labels';
import { formatPerformanceDate } from '@/components/stock-table/formatters';
import { HISTORY_PERFORMANCE_RANGES } from '@/components/stock-table/history';
import {
    buildPerformanceEventLegendItems,
    type PerformanceChartEvent,
} from '@/components/stock-table/performance-events';
import type { Stock } from '@/lib/store';
import type { HistoryMode, HistoryPerformanceRange } from '@/components/stock-table/types';
import {
    buildPortfolioShapeConfirmations,
    type PortfolioShapeConfirmation,
} from '@/lib/portfolio-history-markers';
import { buildPortfolioHistoryDemo, portfolioHistoryDemoAllowed } from '@/lib/portfolio-history-demo';

// ─── Public types ────────────────────────────────────────────────────────────

export interface HistoryDataResult {
    // UI state
    historyMode: HistoryMode;
    setHistoryMode: Dispatch<SetStateAction<HistoryMode>>;
    historyPerformanceExpanded: boolean;
    setHistoryPerformanceExpanded: Dispatch<SetStateAction<boolean>>;
    historyPerformanceRange: HistoryPerformanceRange;
    setHistoryPerformanceRange: Dispatch<SetStateAction<HistoryPerformanceRange>>;
    historyDemoAvailable: boolean;
    historyDemo: boolean;
    setHistoryDemo: Dispatch<SetStateAction<boolean>>;
    historySelectedTicker: string;
    setHistorySelectedTicker: Dispatch<SetStateAction<string>>;
    historySelectedStockName: string;
    setHistorySelectedStockName: Dispatch<SetStateAction<string>>;
    historyStockShowValue: boolean;
    setHistoryStockShowValue: Dispatch<SetStateAction<boolean>>;
    historySecurityLoading: boolean;
    historySecurityError: string | null;
    decisionHistoryTickerQuery: string;
    setDecisionHistoryTickerQuery: Dispatch<SetStateAction<string>>;
    signalHistoryTickerQuery: string;
    setSignalHistoryTickerQuery: Dispatch<SetStateAction<string>>;

    // Raw fetched data
    decisions: DecisionResponse[];
    allSignals: { ticker: string; type: string; source: string; created_at: string }[];
    portfolioPerformance: PortfolioPerformancePoint[];
    assetClassPerformance: AssetClassPerformancePoint[];
    securityPerformance: SecurityPerformancePoint[];
    performanceEvents: PerformanceEvent[];

    // Derived / filtered data
    filteredDecisions: DecisionResponse[];
    filteredSignals: { ticker: string; type: string; source: string; created_at: string }[];
    latestPortfolioPerformance: PortfolioPerformancePoint | null;
    historyPerformanceRangeStartMs: number | null;
    filteredPortfolioPerformance: PortfolioPerformancePoint[];
    filteredAssetClassPerformance: AssetClassPerformancePoint[];
    portfolioPerformanceChartData: {
        date: string;
        observedAt: string;
        total: number;
        invested: number;
        cash: number;
        sleeveCash: number;
    }[];
    historyPerformanceEvents: PerformanceChartEvent[];
    portfolioShapeConfirmations: PortfolioShapeConfirmation[];
    assetClassPerformanceShape: {
        keys: string[];
        classCodes: Record<string, string>;
        data: Record<string, unknown>[];
    };
    historyPortfolioSummary: {
        first: PortfolioPerformancePoint | null;
        last: PortfolioPerformancePoint | null;
        change: number;
        changePct: number;
        cashPct: number;
    };
    historyAssetClassLatestRows: AssetClassPerformancePoint[];
    filteredSecurityPerformance: SecurityPerformancePoint[];
    selectedSecurityLatest: SecurityPerformancePoint | null;
    selectedSecurityFirst: SecurityPerformancePoint | null;
    selectedSecurityValueChange: number;
    selectedSecurityValueChangePct: number;
    selectedSecurityPriceChange: number;
    selectedSecurityPriceChangePct: number;
    selectedSecurityEvents: PerformanceChartEvent[];
    historyPerformanceEventLegendItems: ReturnType<typeof buildPerformanceEventLegendItems>;
    historyStockOptions: Stock[];
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Manages all state, fetch effects, and derived memos for the HISTORY tab.
 *
 * @param activeTab   - Current active tab; fetch effects fire when this is 'HISTORY'.
 * @param positionStocks - Non-watchlist, non-external stocks (for the stock picker).
 */
export function useHistoryData(
    activeTab: string,
    positionStocks: Stock[],
): HistoryDataResult {
    // ── Raw data state ────────────────────────────────────────────────────────
    const [decisions, setDecisions] = useState<DecisionResponse[]>([]);
    const [allSignals, setAllSignals] = useState<
        { ticker: string; type: string; source: string; created_at: string }[]
    >([]);
    const [livePortfolioPerformance, setPortfolioPerformance] = useState<
        PortfolioPerformancePoint[]
    >([]);
    const [liveAssetClassPerformance, setAssetClassPerformance] = useState<
        AssetClassPerformancePoint[]
    >([]);
    const [securityPerformance, setSecurityPerformance] = useState<
        SecurityPerformancePoint[]
    >([]);
    const [livePerformanceEvents, setPerformanceEvents] = useState<PerformanceEvent[]>([]);
    const [livePortfolioHistoryEntries, setPortfolioHistoryEntries] = useState<
        PortfolioHistoryEntry[]
    >([]);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [decisionHistoryTickerQuery, setDecisionHistoryTickerQuery] = useState('');
    const [signalHistoryTickerQuery, setSignalHistoryTickerQuery] = useState('');
    const [historyMode, setHistoryMode] = useState<HistoryMode>('signals');
    const [historyPreferencesReady, setHistoryPreferencesReady] = useState(false);
    const [historyPerformanceExpanded, setHistoryPerformanceExpanded] = useState(true);
    const [liveHistoryRange, setLiveHistoryRange] =
        useState<HistoryPerformanceRange>('3M');
    const [demoRange, setDemoRange] = useState<HistoryPerformanceRange>('ALL');
    const [historyDemoAvailable, setHistoryDemoAvailable] = useState(false);
    const [historyDemo, setHistoryDemo] = useState(false);
    const demoActive = historyDemoAvailable && historyDemo && historyMode === 'performance' && activeTab === 'HISTORY';
    const demo = useMemo(() => demoActive ? buildPortfolioHistoryDemo() : null, [demoActive]);
    const portfolioPerformance = demo?.portfolio ?? livePortfolioPerformance;
    const assetClassPerformance = demo?.assetClasses ?? liveAssetClassPerformance;
    const performanceEvents = useMemo(() => demo ? [] : livePerformanceEvents, [demo, livePerformanceEvents]);
    const portfolioHistoryEntries = demo?.entries ?? livePortfolioHistoryEntries;
    const historyPerformanceRange = demo ? demoRange : liveHistoryRange;
    const setHistoryPerformanceRange = demo ? setDemoRange : setLiveHistoryRange;
    const [historySelectedTicker, setHistorySelectedTicker] = useState('');
    const [historySelectedStockName, setHistorySelectedStockName] = useState('');
    const [historyStockShowValue, setHistoryStockShowValue] = useState(false);
    const [historySecurityLoading, setHistorySecurityLoading] = useState(false);
    const [historySecurityError, setHistorySecurityError] = useState<string | null>(null);

    useEffect(() => { setHistoryDemoAvailable(portfolioHistoryDemoAllowed(window.location.hostname)); }, []);

    // ── Persist / restore UI state to localStorage ────────────────────────────
    useEffect(() => {
        const saved = localStorage.getItem('terminal-history-mode');
        if (saved === 'signals' || saved === 'performance' || saved === 'stock') {
            setHistoryMode(saved);
        }
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem('terminal-history-performance-expanded');
        if (saved === 'true' || saved === 'false') {
            setHistoryPerformanceExpanded(saved === 'true');
        }
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem('terminal-history-performance-range');
        if (saved === '1M' || saved === '3M' || saved === '6M' || saved === 'ALL') {
            setLiveHistoryRange(saved as HistoryPerformanceRange);
        }
        setHistoryPreferencesReady(true);
    }, []);

    // ── Persist UI state to localStorage on change ────────────────────────────
    useEffect(() => {
        if (!historyPreferencesReady) return;
        localStorage.setItem('terminal-history-mode', historyMode);
    }, [historyMode, historyPreferencesReady]);

    useEffect(() => {
        if (!historyPreferencesReady) return;
        localStorage.setItem(
            'terminal-history-performance-expanded',
            String(historyPerformanceExpanded),
        );
    }, [historyPerformanceExpanded, historyPreferencesReady]);

    useEffect(() => {
        if (!historyPreferencesReady) return;
        localStorage.setItem('terminal-history-performance-range', liveHistoryRange);
    }, [liveHistoryRange, historyPreferencesReady]);

    // ── Fetch all history data when HISTORY tab is active ─────────────────────
    useEffect(() => {
        if (activeTab !== 'HISTORY') return;

        let generation = 0;
        const loadHistoryData = async () => {
            const request = ++generation;
            try {
                const [
                    decisionsData,
                    alertsData,
                    activeAlertsData,
                    portfolioPerformanceData,
                    assetClassPerformanceData,
                    performanceEventsData,
                    portfolioHistoryData,
                ] = await Promise.all([
                    api.getDecisions(2000),
                    api.getAlerts(true),
                    api.getActiveAlerts(),
                    api.getPortfolioPerformance(),
                    api.getAssetClassPerformance(),
                    api.getPerformanceEvents(2000),
                    api.getPortfolioHistory(250).catch((error) => {
                        console.warn(
                            '[ALPHA EDGE] Failed to load portfolio shape confirmations:',
                            error,
                        );
                        return { entries: [] };
                    }),
                ]);
                if (request !== generation) return;
                setDecisions(decisionsData || []);
                setPortfolioPerformance(portfolioPerformanceData || []);
                setAssetClassPerformance(assetClassPerformanceData || []);
                setPerformanceEvents(performanceEventsData || []);
                setPortfolioHistoryEntries(portfolioHistoryData.entries || []);

                // Merge trading signals and connection signals into one timeline.
                const tradingSignals = (
                    Array.isArray(alertsData) ? alertsData : []
                ).map((a) => ({
                    ticker: a.ticker,
                    type: normalizeActionType(a.alert_type),
                    source: 'webhook',
                    created_at: a.created_at,
                }));
                const connectionSignals = (
                    Array.isArray(activeAlertsData) ? activeAlertsData : []
                ).map((a) => ({
                    ticker: a.ticker,
                    type: 'CONNECT',
                    source: a.script,
                    created_at: a.created_at,
                }));
                const merged = [...tradingSignals, ...connectionSignals].sort(
                    (a, b) =>
                        new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime(),
                );
                setAllSignals(merged);
            } catch (error) {
                if (request !== generation) return;
                console.error('[ALPHA EDGE] Failed to load history data:', error);
                setDecisions([]);
                setAllSignals([]);
                setPortfolioPerformance([]);
                setAssetClassPerformance([]);
                setPerformanceEvents([]);
                setPortfolioHistoryEntries([]);
            }
        };

        void loadHistoryData();
        const reload = () => { void loadHistoryData(); };
        window.addEventListener(ACTIONS_CHANGED, reload);
        window.addEventListener(DECISION_HISTORY_REQUESTED, reload);
        return () => {
            generation++;
            window.removeEventListener(ACTIONS_CHANGED, reload);
            window.removeEventListener(DECISION_HISTORY_REQUESTED, reload);
        };
    }, [activeTab]);

    // ── Auto-select first stock when entering stock mode ──────────────────────
    const historyStockOptions = useMemo(
        () =>
            [...positionStocks]
                .filter((stock) => stock.symbol)
                .sort((a, b) => {
                    const valueDelta = (b.positionValue || 0) - (a.positionValue || 0);
                    if (Math.abs(valueDelta) > 0.01) return valueDelta;
                    return String(a.symbol).localeCompare(String(b.symbol));
                }),
        [positionStocks],
    );

    useEffect(() => {
        if (
            activeTab !== 'HISTORY' ||
            historyMode !== 'stock' ||
            historySelectedTicker ||
            historyStockOptions.length === 0
        ) {
            return;
        }
        const firstStock = historyStockOptions[0];
        setHistorySelectedTicker(firstStock.symbol || '');
        setHistorySelectedStockName(firstStock.name || firstStock.symbol || '');
    }, [activeTab, historyMode, historySelectedTicker, historyStockOptions]);

    // ── Fetch security performance when selected ticker changes ───────────────
    useEffect(() => {
        if (
            activeTab !== 'HISTORY' ||
            historyMode !== 'stock' ||
            !historySelectedTicker
        ) {
            return;
        }

        let cancelled = false;
        const loadSecurityPerformance = async () => {
            setHistorySecurityLoading(true);
            setHistorySecurityError(null);
            try {
                const points = await api.getSecurityPerformance(historySelectedTicker);
                if (!cancelled) {
                    setSecurityPerformance(points || []);
                }
            } catch (error) {
                console.error('[ALPHA EDGE] Failed to load stock performance:', error);
                if (!cancelled) {
                    setSecurityPerformance([]);
                    setHistorySecurityError('Stock history unavailable');
                }
            } finally {
                if (!cancelled) {
                    setHistorySecurityLoading(false);
                }
            }
        };

        loadSecurityPerformance();
        return () => {
            cancelled = true;
        };
    }, [activeTab, historyMode, historySelectedTicker]);

    // ── Derived / filtered data ───────────────────────────────────────────────

    const filteredDecisions = useMemo(() => {
        const query = decisionHistoryTickerQuery.trim().toLowerCase();
        if (!query) return decisions;
        return decisions.filter((decision) =>
            String(decision.ticker || '').toLowerCase().includes(query),
        );
    }, [decisions, decisionHistoryTickerQuery]);

    const filteredSignals = useMemo(() => {
        const query = signalHistoryTickerQuery.trim().replace(/_/g, ' ').toLowerCase();
        if (!query) return allSignals;
        return allSignals.filter((signal) =>
            String(signal.ticker || '').replace(/_/g, ' ').toLowerCase().includes(query),
        );
    }, [allSignals, signalHistoryTickerQuery]);

    const latestPortfolioPerformance =
        portfolioPerformance[portfolioPerformance.length - 1] || null;

    const historyPerformanceRangeStartMs = useMemo(() => {
        const latestPoint = portfolioPerformance[portfolioPerformance.length - 1];
        if (!latestPoint) return null;
        const selectedRange = HISTORY_PERFORMANCE_RANGES.find(
            (range) => range.key === historyPerformanceRange,
        );
        if (!selectedRange?.days) return null;
        const latestMs = new Date(latestPoint.observed_at).getTime();
        return latestMs - selectedRange.days * 24 * 60 * 60 * 1000;
    }, [historyPerformanceRange, portfolioPerformance]);

    const filteredPortfolioPerformance = useMemo(
        () =>
            portfolioPerformance.filter((point) => {
                if (!historyPerformanceRangeStartMs) return true;
                return (
                    new Date(point.observed_at).getTime() >=
                    historyPerformanceRangeStartMs
                );
            }),
        [historyPerformanceRangeStartMs, portfolioPerformance],
    );

    const filteredAssetClassPerformance = useMemo(
        () =>
            assetClassPerformance.filter((point) => {
                if (!historyPerformanceRangeStartMs) return true;
                return (
                    new Date(point.observed_at).getTime() >=
                    historyPerformanceRangeStartMs
                );
            }),
        [assetClassPerformance, historyPerformanceRangeStartMs],
    );

    const portfolioPerformanceChartData = useMemo(
        () =>
            filteredPortfolioPerformance.map((point) => ({
                date: formatPerformanceDate(point.observed_at),
                observedAt: point.observed_at,
                total: point.total_value_aud,
                invested: point.invested_value_aud,
                cash: point.statement_cash_aud,
                sleeveCash: point.sleeve_cash_aud,
            })),
        [filteredPortfolioPerformance],
    );

    const historyPerformanceEvents = useMemo(() => {
        const latestPoint = portfolioPerformance[portfolioPerformance.length - 1];
        const latestMs = latestPoint
            ? new Date(latestPoint.observed_at).getTime()
            : Date.now();
        const minimumMs = historyPerformanceRangeStartMs ?? Number.NEGATIVE_INFINITY;
        const eventMap = new Map<string, PerformanceChartEvent>();

        const rawEvents = performanceEvents
            .map((event) => ({
                ...event,
                timeMs: new Date(event.occurred_at).getTime(),
            }))
            .filter(
                (event) =>
                    Number.isFinite(event.timeMs) &&
                    event.timeMs >= minimumMs &&
                    event.timeMs <= latestMs,
            )
            .sort((a, b) => b.timeMs - a.timeMs);

        for (const event of rawEvents) {
            const date = formatPerformanceDate(event.occurred_at);
            const existing = eventMap.get(date);
            if (existing) {
                existing.count += 1;
                existing.events.push(event);
                continue;
            }
            if (eventMap.size >= 12) continue;
            eventMap.set(date, {
                ...event,
                date,
                count: 1,
                events: [event],
            });
        }

        return Array.from(eventMap.values()).reverse();
    }, [historyPerformanceRangeStartMs, performanceEvents, portfolioPerformance]);

    const portfolioShapeConfirmations = useMemo(
        () =>
            buildPortfolioShapeConfirmations(
                portfolioHistoryEntries,
                historyPerformanceRangeStartMs,
            ),
        [historyPerformanceRangeStartMs, portfolioHistoryEntries],
    );

    const assetClassPerformanceShape = useMemo(() => {
        if (filteredAssetClassPerformance.length === 0) {
            return { keys: [] as string[], classCodes: {} as Record<string, string>, data: [] as Record<string, unknown>[] };
        }

        const latestDate =
            filteredAssetClassPerformance[filteredAssetClassPerformance.length - 1]
                ?.observed_at;
        const latestRows = filteredAssetClassPerformance
            .filter((row) => row.observed_at === latestDate)
            .sort((a, b) => b.total_value_aud - a.total_value_aud);
        const keys = latestRows.slice(0, 6).map((row) => row.display_name || row.asset_class);
        const keySet = new Set(keys);
        const byDate = new Map<string, Record<string, unknown>>();

        filteredAssetClassPerformance.forEach((row) => {
            const dateKey = row.observed_at;
            const item =
                byDate.get(dateKey) ||
                ({
                    date: formatPerformanceDate(row.observed_at),
                    observedAt: row.observed_at,
                    timeMs: new Date(row.observed_at).getTime(),
                } as Record<string, unknown>);
            const key = row.display_name || row.asset_class;
            if (keySet.has(key)) {
                item[key] = row.portfolio_weight_pct;
            } else {
                item.Other = Number(item.Other || 0) + row.portfolio_weight_pct;
            }
            byDate.set(dateKey, item);
        });

        const allKeys = keys.length < latestRows.length ? [...keys, 'Other'] : keys;
        return {
            keys: allKeys,
            classCodes: Object.fromEntries([
                ...latestRows.map(row => [row.display_name || row.asset_class, row.asset_class]),
                ['Other', 'OTHER'],
            ]),
            data: Array.from(byDate.values()).sort(
                (left, right) => Number(left.timeMs) - Number(right.timeMs),
            ),
        };
    }, [filteredAssetClassPerformance]);

    const historyPortfolioSummary = useMemo(() => {
        const first = filteredPortfolioPerformance[0] || null;
        const last =
            filteredPortfolioPerformance[filteredPortfolioPerformance.length - 1] || null;
        const change = first && last ? last.total_value_aud - first.total_value_aud : 0;
        const changePct =
            first && first.total_value_aud
                ? (change / first.total_value_aud) * 100
                : 0;
        const cashPct =
            last && last.total_value_aud
                ? ((last.statement_cash_aud + last.sleeve_cash_aud) /
                      last.total_value_aud) *
                  100
                : 0;
        return { first, last, change, changePct, cashPct };
    }, [filteredPortfolioPerformance]);

    const historyAssetClassLatestRows = useMemo(() => {
        if (filteredAssetClassPerformance.length === 0) return [];
        const latestDate =
            filteredAssetClassPerformance[filteredAssetClassPerformance.length - 1]
                ?.observed_at;
        return filteredAssetClassPerformance
            .filter((row) => row.observed_at === latestDate)
            .sort((a, b) => b.total_value_aud - a.total_value_aud);
    }, [filteredAssetClassPerformance]);

    const filteredSecurityPerformance = useMemo(
        () =>
            securityPerformance.filter((point) => {
                if (!historyPerformanceRangeStartMs) return true;
                return (
                    new Date(point.observed_at).getTime() >=
                    historyPerformanceRangeStartMs
                );
            }),
        [historyPerformanceRangeStartMs, securityPerformance],
    );

    const selectedSecurityLatest =
        filteredSecurityPerformance[filteredSecurityPerformance.length - 1] || null;
    const selectedSecurityFirst = filteredSecurityPerformance[0] || null;
    const selectedSecurityValueChange =
        selectedSecurityLatest && selectedSecurityFirst
            ? selectedSecurityLatest.market_value_aud -
              selectedSecurityFirst.market_value_aud
            : 0;
    const selectedSecurityValueChangePct =
        selectedSecurityFirst?.market_value_aud
            ? (selectedSecurityValueChange / selectedSecurityFirst.market_value_aud) *
              100
            : 0;
    const selectedSecurityPriceChange =
        selectedSecurityLatest && selectedSecurityFirst
            ? selectedSecurityLatest.price - selectedSecurityFirst.price
            : 0;
    const selectedSecurityPriceChangePct =
        selectedSecurityFirst?.price
            ? (selectedSecurityPriceChange / selectedSecurityFirst.price) * 100
            : 0;

    const selectedSecurityEvents = useMemo(() => {
        const selectedTicker = historySelectedTicker.trim().toUpperCase();
        if (!selectedTicker) return [];
        const decisionById = new Map(
            decisions.map((decision) => [String(decision.id), decision]),
        );
        const latestPoint = portfolioPerformance[portfolioPerformance.length - 1];
        const latestMs = latestPoint
            ? new Date(latestPoint.observed_at).getTime()
            : Date.now();
        const minimumMs = historyPerformanceRangeStartMs ?? Number.NEGATIVE_INFINITY;
        const eventMap = new Map<string, PerformanceChartEvent>();
        const selectedEvents = performanceEvents
            .map((event) => ({
                ...event,
                timeMs: new Date(event.occurred_at).getTime(),
            }))
            .filter(
                (event) =>
                    String(event.ticker || '').toUpperCase() === selectedTicker &&
                    Number.isFinite(event.timeMs) &&
                    event.timeMs >= minimumMs &&
                    event.timeMs <= latestMs,
            );

        const signalTypeByDate = new Map<string, string>();
        selectedEvents.forEach((event) => {
            if (event.event_type !== 'signal_received') return;
            const action = normalizeActionType(
                String(event.title || '').replace(/\s+signal$/i, ''),
            );
            if (!action) return;
            signalTypeByDate.set(formatPerformanceDate(event.occurred_at), action);
        });

        const rawEvents = selectedEvents
            .map((event) => {
                const eventId = String(event.id || '');
                const decisionId = eventId.startsWith('decision:')
                    ? eventId.slice('decision:'.length)
                    : '';
                const decision = decisionId ? decisionById.get(decisionId) : undefined;
                const isIgnoredDecision =
                    event.event_type === 'decision_recorded' &&
                    String(event.title || '').trim().toUpperCase() === 'IGNORE DECISION';
                const date = formatPerformanceDate(event.occurred_at);
                const alertType = normalizeActionType(
                    decision?.alert_type ||
                        (typeof event.metadata?.alert_type === 'string'
                            ? event.metadata.alert_type
                            : '') ||
                        (isIgnoredDecision ? signalTypeByDate.get(date) : ''),
                );
                const enrichedTitle =
                    isIgnoredDecision && alertType ? 'Ignored decision' : event.title;
                return {
                    ...event,
                    title: enrichedTitle,
                    metadata: {
                        ...(event.metadata || {}),
                        ...(alertType ? { alert_type: alertType } : {}),
                        ...(decision ? { decision: decision.decision } : {}),
                    },
                };
            })
            .sort((a, b) => b.timeMs - a.timeMs);

        for (const event of rawEvents) {
            const date = formatPerformanceDate(event.occurred_at);
            const existing = eventMap.get(date);
            if (existing) {
                existing.count += 1;
                existing.events.push(event);
                continue;
            }
            if (eventMap.size >= 18) continue;
            eventMap.set(date, {
                ...event,
                date: formatPerformanceDate(event.occurred_at),
                count: 1,
                events: [event],
            });
        }

        return Array.from(eventMap.values()).reverse();
    }, [
        historyPerformanceRangeStartMs,
        historySelectedTicker,
        decisions,
        performanceEvents,
        portfolioPerformance,
    ]);

    const historyPerformanceEventLegendItems = useMemo(
        () => buildPerformanceEventLegendItems(historyPerformanceEvents),
        [historyPerformanceEvents],
    );

    return {
        // UI state
        historyMode,
        setHistoryMode,
        historyPerformanceExpanded,
        setHistoryPerformanceExpanded,
        historyPerformanceRange,
        setHistoryPerformanceRange,
        historyDemoAvailable,
        historyDemo: demoActive,
        setHistoryDemo,
        historySelectedTicker,
        setHistorySelectedTicker,
        historySelectedStockName,
        setHistorySelectedStockName,
        historyStockShowValue,
        setHistoryStockShowValue,
        historySecurityLoading,
        historySecurityError,
        decisionHistoryTickerQuery,
        setDecisionHistoryTickerQuery,
        signalHistoryTickerQuery,
        setSignalHistoryTickerQuery,

        // Raw data
        decisions,
        allSignals,
        portfolioPerformance,
        assetClassPerformance,
        securityPerformance,
        performanceEvents,

        // Derived
        filteredDecisions,
        filteredSignals,
        latestPortfolioPerformance,
        historyPerformanceRangeStartMs,
        filteredPortfolioPerformance,
        filteredAssetClassPerformance,
        portfolioPerformanceChartData,
        historyPerformanceEvents,
        portfolioShapeConfirmations,
        assetClassPerformanceShape,
        historyPortfolioSummary,
        historyAssetClassLatestRows,
        filteredSecurityPerformance,
        selectedSecurityLatest,
        selectedSecurityFirst,
        selectedSecurityValueChange,
        selectedSecurityValueChangePct,
        selectedSecurityPriceChange,
        selectedSecurityPriceChangePct,
        selectedSecurityEvents,
        historyPerformanceEventLegendItems,
        historyStockOptions,
    };
}
