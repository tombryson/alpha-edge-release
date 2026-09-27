'use client';

import { useState, useEffect, useMemo } from 'react';
import { subscribePoll } from '@/lib/polling';
import {
    apiFetch,
    postSizingAllocations,
    type ClassBudget,
    type PortfolioOverlaySummaryResponse,
    type SizingResult,
    type SizingStockInput,
} from '@/lib/api';
import type { Stock } from '@/lib/store';
import { isSizingUniverseStock } from '@/lib/positions-model-weight';

// OverlayAssetClassRow is the array element type from the overlay summary.
type OverlayAssetClassRow = PortfolioOverlaySummaryResponse['asset_classes'][number];
const EMPTY_ALLOCATIONS = new Map<number, SizingResult>();

export interface SizingAllocationsResult {
    backendAllocations: Map<number, SizingResult>;
    routerScoresApplied: boolean;
    classBudgetsApplied: boolean;
    classBudgetsRequired: boolean;
}

/**
 * Fetches backend-computed sizing allocations (Go sizing engine + announcement-router
 * scores) whenever the research/holdings universe or portfolio value changes.
 *
 * When rawOverlayRows are provided the hook sends each full class target to the
 * backend. The backend owns the Core ETF deduction and returns the capital
 * available for direct-stock sizing:
 *   class_target        = portfolio_value × class.target_weight_pct
 *   direct_stock_target = max(0, class_target - max(effective_ETF_target, held_ETFs))
 * These are research targets only. They must never be interpreted as current
 * deployable cash: the action queue owns that calculation from class cash and
 * current direct-stock shortfall.
 *
 * Falls back gracefully — on any fetch failure backendAllocations stays empty
 * and the caller should fall back to its own frontend formula.
 */
export function useSizingAllocations(
    sortedStocks: Stock[],
    totalPortfolioValue: number,
    rawOverlayRows?: OverlayAssetClassRow[],
    universe: 'analysis' | 'holdings' = 'analysis',
): SizingAllocationsResult {
    const [backendAllocations, setBackendAllocations] = useState<
        Map<number, SizingResult>
    >(new Map());
    const [routerScoresApplied, setRouterScoresApplied] = useState(false);
    const [classBudgetsApplied, setClassBudgetsApplied] = useState(false);
    const [etfBudgetRevision, setETFBudgetRevision] = useState(0);
    const [responseKey, setResponseKey] = useState('');
    const classBudgetsRequired = Boolean(
        rawOverlayRows?.some((row) => (row.target_weight_pct ?? 0) > 0),
    );

    useEffect(() => {
        const refresh = () => setETFBudgetRevision((revision) => revision + 1);
        window.addEventListener('etfAllocationPolicyChanged', refresh);
        const stopPolling = subscribePoll(refresh, 30_000, { immediate: false });
        return () => {
            window.removeEventListener('etfAllocationPolicyChanged', refresh);
            stopPolling();
        };
    }, []);

    // Stable key derived only from the fields the sizing engine actually uses.
    const sizingInputKey = useMemo(() => {
        const stocksKey = sortedStocks
            .filter(stock => isSizingUniverseStock(stock, universe))
            .map(
                (s) =>
                    `${s.id}:${s.prefix || ''}${s.symbol || ''}:${s.geminiQuality ?? 0},${s.geminiValue ?? 0},` +
                    `${s.gptQuality ?? 0},${s.gptValue ?? 0},` +
                    `${s.perplexityQuality ?? 0},${s.perplexityValue ?? 0},` +
                    `${s.claudeQuality ?? 0},${s.claudeValue ?? 0},` +
                    `${s.councilQuality ?? 0},${s.councilValue ?? 0},` +
                    `${s.includeInSizing !== false ? 1 : 0},` +
                    `${s.primaryAssetClass ?? ''},${s.price ?? 0},${s.performance6MPct ?? ''},` +
                    `${s.geminiPT ?? 0},${s.perplexityPT ?? 0},${s.gptPT ?? 0},${s.claudePT ?? 0},` +
                    `${s.deerFlowPT ?? 0},${s.councilPT ?? 0},${s.tipRanksPT ?? 0},${s.analystPT ?? 0}`,
            )
            .sort()
            .join('|');
        // A previously returned allocation must not survive a portfolio-shape change.
        const budgetKey = (rawOverlayRows ?? [])
            .map((row) => `${row.asset_class}:${row.target_weight_pct ?? 0}`)
            .join('|');
        return `${universe}::${stocksKey}::budgets=${budgetKey}::etf=${etfBudgetRevision}::total=${totalPortfolioValue}`;
    }, [sortedStocks, rawOverlayRows, etfBudgetRevision, universe, totalPortfolioValue]);

    useEffect(() => {
        const stocksForSizing = sortedStocks.filter(stock => isSizingUniverseStock(stock, universe));
        if (
            stocksForSizing.length === 0 ||
            totalPortfolioValue <= 0
        ) {
            setBackendAllocations(new Map());
            setRouterScoresApplied(false);
            setClassBudgetsApplied(false);
            return;
        }

        let cancelled = false;

        // Do not show the previous response while a material sizing input is
        // being recalculated. The local fallback uses the current row values.
        setBackendAllocations(new Map());
        setRouterScoresApplied(false);
        setClassBudgetsApplied(false);

        const run = async () => {
            // Fetch announcement-router scores via the Next.js proxy so the
            // council API token is never exposed to the browser.
            let routerScores: Record<string, number> = {};
            try {
                const routerRes = await apiFetch(
                    '/api/council/announcement-router/signals',
                    { cache: 'no-store' },
                );
                if (routerRes.ok) {
                    routerScores = await routerRes.json();
                }
            } catch {
                // Router scores are optional — proceed without them.
            }

            if (cancelled) return;

            const inputs: SizingStockInput[] = stocksForSizing.map(
                (s) => ({
                    id: s.id,
                    ticker: s.prefix ? `${s.prefix}${s.symbol}` : s.symbol,
                    asset_class: s.primaryAssetClass ?? undefined,
                    gemini_quality: s.geminiQuality ?? 0,
                    gemini_value: s.geminiValue ?? 0,
                    gpt_quality: s.gptQuality ?? 0,
                    gpt_value: s.gptValue ?? 0,
                    perplexity_quality: s.perplexityQuality ?? 0,
                    perplexity_value: s.perplexityValue ?? 0,
                    claude_quality: s.claudeQuality ?? 0,
                    claude_value: s.claudeValue ?? 0,
                    council_quality: s.councilQuality ?? 0,
                    council_value: s.councilValue ?? 0,
                    grok_pt: s.grokPT ?? 0,
                    gemini_pt: s.geminiPT ?? 0,
                    gpt_pt: s.gptPT ?? 0,
                    deer_flow_pt: s.deerFlowPT ?? 0,
                    perplexity_pt: s.perplexityPT ?? 0,
                    claude_pt: s.claudePT ?? 0,
                    council_pt: s.councilPT ?? 0,
                    tipranks_pt: s.tipRanksPT ?? 0,
                    analyst_pt: s.analystPT ?? 0,
                    current_price: s.price,
                    performance_6m_pct: s.performance6MPct ?? null,
                }),
            );

            // ── Desired direct-stock targets ───────────────────────────────────
            // This intentionally excludes portfolio-wide overlay headroom. A
            // target allocation shows the desired completed position; it is not
            // an instruction to deploy cash across every class.
            let classBudgets: ClassBudget[] | undefined;
            if (rawOverlayRows && rawOverlayRows.length > 0) {
                const budgets = rawOverlayRows
                    .filter((row) => (row.target_weight_pct ?? 0) > 0)
                    .map((row) => {
                        const classBudget =
                            totalPortfolioValue * ((row.target_weight_pct ?? 0) / 100);
                        return {
                            asset_class: row.asset_class,
                            class_budget: classBudget,
                        } satisfies ClassBudget;
                    });
                if (budgets.length > 0) classBudgets = budgets;
            }

            try {
                const resp = await postSizingAllocations(
                    inputs,
                    totalPortfolioValue,
                    routerScores,
                    classBudgets,
                );
                if (cancelled) return;
                const map = new Map<number, SizingResult>();
                for (const r of resp.results) {
                    map.set(r.id, r);
                }
                setBackendAllocations(map);
                setRouterScoresApplied(resp.router_scores_applied);
                setClassBudgetsApplied(resp.class_budgets_applied ?? false);
                setResponseKey(sizingInputKey);
            } catch {
                if (cancelled) return;
                // A stale target weight is worse than an empty one. The panel
                // falls back to its current, evidence-gated local calculation.
                setBackendAllocations(new Map());
                setRouterScoresApplied(false);
                setClassBudgetsApplied(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sizingInputKey, totalPortfolioValue]);

    return {
        backendAllocations: responseKey === sizingInputKey ? backendAllocations : EMPTY_ALLOCATIONS,
        routerScoresApplied: responseKey === sizingInputKey && routerScoresApplied,
        classBudgetsApplied: responseKey === sizingInputKey && classBudgetsApplied,
        classBudgetsRequired,
    };
}
