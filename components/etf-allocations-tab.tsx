'use client';
import { subscribePoll } from '@/lib/polling';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronRight, List, Plus, Settings2 } from 'lucide-react';
import {
    api,
    type ETFAllocationLedgerResponse,
    type ETFAllocationLedgerRow,
    type ETFMomentumWorkspaceResponse,
    type AssetClass,
} from '@/lib/api';
import { formatAssetClassName, getAssignableAssetClasses } from '@/lib/asset-classes';
import { formatCoreRatio } from '@/lib/etf-core-ratio';
import styles from './etf-allocations-tab.module.css';
import { DataFreshnessIndicator } from './data-freshness-indicator';

function formatMoney(value?: number | null): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '$0';
    return `$${Math.round(value).toLocaleString()}`;
}

function formatSignedMoney(value?: number | null): string {
    const amount = value ?? 0;
    return `${amount >= 0 ? '+' : '-'}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

function formatPct(value?: number | null, digits = 2): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '0.00%';
    return `${value.toFixed(digits)}%`;
}

function formatSignedPct(value?: number | null, digits = 1): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function formatMetric(value?: number | null, digits = 2): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return value.toFixed(digits);
}

function formatDate(value?: string | null): string {
    if (!value) return 'Not loaded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not loaded';
    return date.toLocaleDateString('en-AU');
}

function momentumCadenceLabel(value?: string): string {
    switch (value) {
        case 'DAILY':
            return 'Daily';
        case 'WEEKLY':
            return '5 sessions';
        case 'MONTHLY':
            return 'Monthly';
        case 'MANUAL':
            return 'Manual';
        default:
            return '80 sessions';
    }
}

function momentumStateClass(status: string): string {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'INCOMPLETE' || normalized === 'STALE') return 'text-caution';
    if (normalized === 'ERROR' || normalized === 'BLOCKED') return 'text-destructive';
    return 'text-muted-foreground';
}

function allocationPolicy(row: ETFAllocationLedgerRow): string {
    if (row.is_core) return `Core ${formatCoreRatio(row.core_ratio_pct)}`;
    if (row.actual_value > 0) return 'Holding';
    return 'Watchlist';
}

function gateState(row: ETFAllocationLedgerRow): 'BUY' | 'SELL' | '' {
    const state = String(row.tactical_status || row.status || '').toUpperCase();
    if (state === 'BUY' || state === 'SELL') return state;
    return '';
}

function targetVariance(delta?: number | null, hasTarget = true): string {
    if (!hasTarget) return 'No target';
    const amount = delta ?? 0;
    if (Math.abs(amount) < 0.5) return 'Aligned';
    return amount > 0
        ? `Below ${formatMoney(amount)}`
        : `Above ${formatMoney(Math.abs(amount))}`;
}

export function ETFAllocationsTab() {
    const [ledger, setLedger] = useState<ETFAllocationLedgerResponse | null>(null);
    const [momentum, setMomentum] = useState<ETFMomentumWorkspaceResponse | null>(null);
    const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [momentumError, setMomentumError] = useState<string | null>(null);
    const [workspaceView, setWorkspaceView] = useState<'allocations' | 'ranking'>('allocations');
    const [allocationFilter, setAllocationFilter] = useState<'all' | 'review'>('all');
    const [expandedAssetClasses, setExpandedAssetClasses] = useState<Set<string>>(new Set());
    const [savingTicker, setSavingTicker] = useState<string | null>(null);
    const [customClassTicker, setCustomClassTicker] = useState<string | null>(null);
    const [customClassName, setCustomClassName] = useState('');
    const [customClassQuartile, setCustomClassQuartile] = useState('Q1_EXEMPT');
    const [creatingCustomClass, setCreatingCustomClass] = useState(false);
    const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

    const refreshAssetClasses = async () => {
        const classes = await api.getAssetClasses();
        const assignable = getAssignableAssetClasses(classes);
        setAssetClasses(assignable);
        return assignable;
    };

    useEffect(() => {
        let cancelled = false;

        const loadLedger = async () => {
            try {
                setError(null);
                const data = await api.getETFAllocationLedger();
                if (!cancelled) setLedger(data || null);
            } catch (loadError) {
                console.error('[ETF] Failed to load allocation ledger:', loadError);
                if (!cancelled) {
                    setError(
                        loadError instanceof Error
                            ? loadError.message
                            : 'Failed to load ETF allocations',
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        const loadMomentum = async () => {
            try {
                setMomentumError(null);
                const data = await api.getETFMomentumWorkspace();
                if (!cancelled) setMomentum(data || null);
            } catch (loadError) {
                console.error('[ETF] Failed to load momentum ranking:', loadError);
                if (!cancelled) {
                    setMomentumError(
                        loadError instanceof Error
                            ? loadError.message
                            : 'Failed to load momentum ranking',
                    );
                }
            }
        };

        const stopLedger = subscribePoll(loadLedger, 30000);
        const stopMomentum = subscribePoll(loadMomentum, 30000);
        refreshAssetClasses()
            .then((classes) => {
                if (!cancelled) {
                    setAssetClasses(classes);
                }
            })
            .catch((assetClassError) => {
                console.error('[ETF] Failed to load asset classes:', assetClassError);
            });
        return () => {
            cancelled = true;
            stopLedger();
            stopMomentum();
        };
    }, []);

    const updateAssetClass = async (row: ETFAllocationLedgerRow, assetClass: string) => {
        try {
            setSavingTicker(row.ticker);
            setError(null);
            await api.updateETFAssetClassMapping(row.ticker, {
                asset_class: assetClass,
                display_name: row.display_name,
                active: Boolean(assetClass),
            });
            setLedger(await api.getETFAllocationLedger());
        } catch (updateError) {
            console.error('[ETF] Failed to update asset class mapping:', updateError);
            setError(
                updateError instanceof Error
                    ? updateError.message
                    : 'Failed to update ETF asset class',
            );
        } finally {
            setSavingTicker(null);
        }
    };

    const createAndAssignCustomClass = async (row: ETFAllocationLedgerRow) => {
        const displayName = customClassName.trim();
        if (!displayName) return;
        try {
            setCreatingCustomClass(true);
            setSavingTicker(row.ticker);
            setError(null);
            const created = await api.createCustomAssetClass({
                display_name: displayName,
                quartile: customClassQuartile,
                instrument_scope: 'FUND',
            });
            await refreshAssetClasses();
            await api.updateETFAssetClassMapping(row.ticker, {
                asset_class: created.code,
                display_name: row.display_name,
                active: true,
            });
            setLedger(await api.getETFAllocationLedger());
            setCustomClassTicker(null);
            setCustomClassName('');
            setCustomClassQuartile('Q1_EXEMPT');
        } catch (createError) {
            console.error('[ETF] Failed to create custom asset class:', createError);
            setError(
                createError instanceof Error
                    ? createError.message
                    : 'Failed to create custom asset class',
            );
        } finally {
            setCreatingCustomClass(false);
            setSavingTicker(null);
        }
    };

    const rows = useMemo(() => {
        return [...(ledger?.rows || [])].sort((a, b) => {
            if (a.is_core !== b.is_core) return a.is_core ? -1 : 1;
            if (Math.abs(b.momentum_weight_pct - a.momentum_weight_pct) > 0.0001) {
                return b.momentum_weight_pct - a.momentum_weight_pct;
            }
            return a.ticker.localeCompare(b.ticker);
        });
    }, [ledger]);

    const allocationGroups = useMemo(() => {
        const summaries = new Map(
            (ledger?.classes || []).map((item) => [item.asset_class, item]),
        );
        const grouped = new Map<string, ETFAllocationLedgerRow[]>();
        rows.forEach((row) => {
            const key = row.asset_class || 'UNASSIGNED';
            grouped.set(key, [...(grouped.get(key) || []), row]);
        });
        return [...grouped.entries()]
            .map(([assetClass, groupRows]) => ({
                assetClass,
                assetClassName:
                    summaries.get(assetClass)?.asset_class_name ||
                    groupRows[0]?.asset_class_name ||
                    (assetClass === 'UNASSIGNED' ? 'Unassigned' : assetClass),
                summary: summaries.get(assetClass),
                rows: [...groupRows].sort((a, b) => {
                    if (a.is_core !== b.is_core) return a.is_core ? -1 : 1;
                    if (Math.abs(b.momentum_weight_pct - a.momentum_weight_pct) > 0.0001) {
                        return b.momentum_weight_pct - a.momentum_weight_pct;
                    }
                    return a.ticker.localeCompare(b.ticker);
                }),
            }))
            .sort((a, b) => {
                if (a.assetClass === 'UNASSIGNED') return 1;
                if (b.assetClass === 'UNASSIGNED') return -1;
                const targetDelta = (b.summary?.class_target_value || 0) - (a.summary?.class_target_value || 0);
                if (Math.abs(targetDelta) > 0.01) return targetDelta;
                return a.assetClassName.localeCompare(b.assetClassName);
            });
    }, [ledger?.classes, rows]);

    const momentumRun = momentum?.latest_run;
    const publishedMomentumRun = momentum?.published_run;
    const momentumAutomation = momentum?.automation;
    const momentumRows = useMemo(
        () => [...(momentum?.latest_run?.rows || [])].sort((a, b) => {
            if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
            if (a.rank !== undefined) return -1;
            if (b.rank !== undefined) return 1;
            return a.ticker.localeCompare(b.ticker);
        }),
        [momentum?.latest_run?.rows],
    );
    const portfolioValue = ledger?.summary.portfolio_value || 0;
    const effectiveExposurePct = portfolioValue > 0
        ? ((ledger?.summary.effective_target_value || 0) / portfolioValue) * 100
        : 0;
    const actualExposurePct = ledger?.summary.actual_exposure_pct || 0;
    const suggestedExposurePct = ledger?.summary.suggested_exposure_pct || 0;
    const exposureScale = Math.max(suggestedExposurePct, effectiveExposurePct, actualExposurePct, 1);
    const exposureVariancePct = actualExposurePct - effectiveExposurePct;
    const liveSource = ledger?.policy.momentum_source === 'INTERNAL_PUBLISHED'
        ? 'Internal published'
        : 'TradingView compatibility';
    const targetClassGroups = allocationGroups.filter((group) => (group.summary?.class_target_value || 0) > 0);
    const configuredCoreCount = targetClassGroups.filter((group) => Boolean(
        group.summary?.core_ticker || group.rows.some((row) => row.is_core),
    )).length;
    const blockedCoreCount = allocationGroups.filter((group) => {
        const coreRow = group.rows.find((row) => row.is_core);
        return Boolean(coreRow && gateState(coreRow) === 'SELL');
    }).length;
    const unassignedCount = rows.filter((row) => !row.asset_class || row.asset_class === 'UNASSIGNED').length;
    const reviewAllocationGroups = allocationGroups.filter((group) => {
        const coreRow = group.rows.find((row) => row.is_core);
        const hasApprovedTarget = (group.summary?.class_target_value || 0) > 0;
        const hasCore = Boolean(group.summary?.core_ticker || coreRow);
        return group.assetClass === 'UNASSIGNED' || (hasApprovedTarget && !hasCore) || (coreRow ? gateState(coreRow) === 'SELL' : false);
    });
    const visibleAllocationGroups = allocationFilter === 'review'
        ? reviewAllocationGroups
        : allocationGroups;

    const toggleAssetClass = (assetClass: string) => {
        setExpandedAssetClasses((current) => {
            const next = new Set(current);
            if (next.has(assetClass)) next.delete(assetClass);
            else next.add(assetClass);
            return next;
        });
    };

    if (loading) {
        return (
            <div className="panel-border p-6 text-sm text-muted-foreground">
                Loading ETF allocations...
            </div>
        );
    }

    return (
        <div className={`${styles.workspace} terminal-workspace-controls`}>
            <div className={styles.workspaceInner}>
                {error && (
                    <div className="panel-border border-destructive/35 px-3 py-2 text-xs text-destructive">
                        {error}
                    </div>
                )}

                {/* Momentum parity remains a backend/UAT research tool, not a production allocation surface.
                <section className="border border-border/55 bg-card/60">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/45 bg-muted/20 px-3 py-2.5">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <Database className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                <h2 className="text-[14px] font-bold tracking-wide text-foreground">
                                    Momentum parity
                                </h2>
                                <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                                    PINE_PARITY_V1 · 15 ETFs
                                </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Cached raw closes only. Shadow runs never alter live ETF targets.
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => void refreshMomentumPrices()}
                                disabled={momentumOperation !== null}
                                className="inline-flex h-7 items-center gap-1.5 border border-border/55 bg-background/70 px-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <RefreshCw
                                    className={`h-3 w-3 ${momentumOperation === 'refresh' ? 'animate-spin' : ''}`}
                                    aria-hidden="true"
                                />
                                Refresh history
                            </button>
                            <button
                                type="button"
                                onClick={() => void runMomentumParity()}
                                disabled={momentumOperation !== null}
                                className="inline-flex h-7 items-center gap-1.5 border border-primary/40 bg-primary/10 px-2 text-[10px] font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary/18 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Play className="h-3 w-3" aria-hidden="true" />
                                {referenceDate ? 'Compare reference' : 'Run parity'}
                            </button>
                        </div>
                    </div>

                    {momentumError && (
                        <div className="border-b border-destructive/30 px-3 py-2 text-[11px] text-destructive">
                            {momentumError}
                        </div>
                    )}

                    <div className="grid border-b border-border/45 md:grid-cols-3">
                        <div className="border-b border-border/35 px-3 py-2 md:border-b-0 md:border-r">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Internal run
                            </div>
                            <div className={`mt-0.5 font-mono text-[13px] font-bold ${momentumStatusClass(momentum?.latest_run?.status)}`}>
                                {momentum?.latest_run
                                    ? `${momentum.latest_run.status} · ${momentum.latest_run.ready_members}/${momentum.latest_run.expected_members}`
                                    : 'Not run'}
                            </div>
                        </div>
                        <div className="border-b border-border/35 px-3 py-2 md:border-b-0 md:border-r">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                TradingView reference
                            </div>
                            <div className={`mt-0.5 font-mono text-[13px] font-bold ${momentumStatusClass(momentum?.latest_tradingview_reference?.comparison_status)}`}>
                                {momentum?.latest_tradingview_reference
                                    ? `${momentum.latest_tradingview_reference.allocation_count} rows · ${referenceDate}`
                                    : 'Not captured'}
                            </div>
                        </div>
                        <div className="px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Comparison
                            </div>
                            <div className={`mt-0.5 text-[13px] font-bold ${momentumStatusClass(momentum?.latest_tradingview_reference?.comparison_status)}`}>
                                {momentum?.latest_tradingview_reference?.comparison_status || 'Waiting for reference'}
                            </div>
                        </div>
                    </div>

                    {momentum?.latest_tradingview_reference?.comparison_summary && (
                        <div className="border-b border-border/35 px-3 py-1.5 text-[10px] text-muted-foreground">
                            {momentum.latest_tradingview_reference.comparison_summary}
                        </div>
                    )}

                    {momentumComparisonRows.length > 0 ? (
                        <div className="overflow-x-auto">
                            <div className="min-w-[790px]">
                                <div className="grid grid-cols-[64px_1fr_62px_62px_76px_76px_76px_76px_82px] border-b border-border/40 bg-background/35 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                                    <span>ETF</span>
                                    <span>Status</span>
                                    <span className="text-right">Int rank</span>
                                    <span className="text-right">TV rank</span>
                                    <span className="text-right">Int 80d</span>
                                    <span className="text-right">TV 80d</span>
                                    <span className="text-right">Int wt</span>
                                    <span className="text-right">TV wt</span>
                                    <span className="text-right">Wt delta</span>
                                </div>
                                {momentumComparisonRows.map((row) => (
                                    <div
                                        key={row.ticker}
                                        className="grid grid-cols-[64px_1fr_62px_62px_76px_76px_76px_76px_82px] border-b border-border/25 px-3 py-1.5 text-[11px] last:border-b-0"
                                    >
                                        <span className="font-mono font-bold text-foreground">{row.ticker}</span>
                                        <span className={`font-medium ${momentumStatusClass(row.comparison_status)}`}>
                                            {row.comparison_status.replaceAll('_', ' ')}
                                        </span>
                                        <span className="text-right font-mono text-muted-foreground">
                                            {row.internal_rank ?? '—'}
                                        </span>
                                        <span className="text-right font-mono text-foreground">{row.rank}</span>
                                        <span className="text-right font-mono text-muted-foreground">
                                            {row.internal_return_80_pct === undefined
                                                ? '—'
                                                : formatSignedPct(row.internal_return_80_pct)}
                                        </span>
                                        <span className="text-right font-mono text-foreground">
                                            {formatSignedPct(row.return_80_pct)}
                                        </span>
                                        <span className="text-right font-mono text-muted-foreground">
                                            {row.internal_allocation_pct === undefined
                                                ? '—'
                                                : formatPct(row.internal_allocation_pct)}
                                        </span>
                                        <span className="text-right font-mono text-foreground">
                                            {formatPct(row.allocation_pct)}
                                        </span>
                                        <span className={`text-right font-mono ${momentumStatusClass(row.comparison_status)}`}>
                                            {formatSignedPct(row.allocation_delta_pct)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : momentumRunRows.length > 0 ? (
                        <div className="overflow-x-auto">
                            <div className="min-w-[560px]">
                                <div className="grid grid-cols-[72px_1fr_76px_86px_86px_1fr] border-b border-border/40 bg-background/35 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                                    <span>ETF</span>
                                    <span>State</span>
                                    <span className="text-right">Rank</span>
                                    <span className="text-right">80 bar</span>
                                    <span className="text-right">Weight</span>
                                    <span>Diagnostic</span>
                                </div>
                                {momentumRunRows.map((row) => (
                                    <div
                                        key={row.ticker}
                                        className="grid grid-cols-[72px_1fr_76px_86px_86px_1fr] border-b border-border/25 px-3 py-1.5 text-[11px] last:border-b-0"
                                    >
                                        <span className="font-mono font-bold text-foreground">{row.ticker}</span>
                                        <span className={`font-medium ${momentumStatusClass(row.status)}`}>
                                            {row.status.replaceAll('_', ' ')}
                                        </span>
                                        <span className="text-right font-mono text-muted-foreground">{row.rank ?? '—'}</span>
                                        <span className="text-right font-mono text-muted-foreground">
                                            {row.return_80_pct === undefined ? '—' : formatSignedPct(row.return_80_pct)}
                                        </span>
                                        <span className="text-right font-mono text-foreground">
                                            {row.final_weight_pct === undefined ? '—' : formatPct(row.final_weight_pct)}
                                        </span>
                                        <span className="truncate pl-3 text-[10px] text-muted-foreground" title={row.diagnostic}>
                                            {row.diagnostic || row.tradingview_symbol}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="px-3 py-3 text-[11px] text-muted-foreground">
                            Refresh the cached two-year history, then run a shadow calculation. A TradingView rebalance payload will appear here automatically when it reaches the existing webhook.
                        </div>
                    )}
                </section>
                */}

                <section className={styles.surface}>
                    <header className={styles.header}>
                        <div className={styles.headerIdentity}>
                            <h2>{workspaceView === 'allocations' ? 'ETF allocations' : 'ETF momentum ranking'}</h2>
                            <p>
                                {workspaceView === 'allocations'
                                    ? `${rows.length} funds · ${liveSource} · updated ${formatDate(ledger?.as_of)}`
                                    : `${momentumRows.length} funds · calculated ${formatDate(momentumRun?.created_at)}`}
                            </p>
                        </div>
                        <div className={styles.headerTools}>
                            <DataFreshnessIndicator datasets={['ETF_MOMENTUM']} actions={{ ETF_MOMENTUM: { label: 'Refresh price history', run: async () => {
                                const result = await api.refreshETFMomentumPriceHistory();
                                setMomentum(await api.getETFMomentumWorkspace());
                                if (result.errors.length) throw new Error(result.errors[0]);
                            } } }} />
                            <div className={styles.sourceState}>
                                <span>Live weights</span>
                                <strong>{liveSource}</strong>
                                <time>{formatDate(publishedMomentumRun?.published_at || publishedMomentumRun?.data_fresh_through)}</time>
                            </div>
                            {workspaceView === 'allocations' && (
                                <div className={styles.allocationFilters} role="group" aria-label="ETF allocation filters">
                                    <button type="button" aria-pressed={allocationFilter === 'all'} onClick={() => setAllocationFilter('all')}>
                                        All <span>{allocationGroups.length}</span>
                                    </button>
                                    <button type="button" aria-pressed={allocationFilter === 'review'} onClick={() => setAllocationFilter('review')}>
                                        Review <span>{reviewAllocationGroups.length}</span>
                                    </button>
                                </div>
                            )}
                            <div className={styles.viewSwitch} role="group" aria-label="ETF view">
                                <button type="button" aria-pressed={workspaceView === 'allocations'} onClick={() => setWorkspaceView('allocations')}>
                                    <List aria-hidden="true" /> Allocation
                                </button>
                                <button type="button" aria-pressed={workspaceView === 'ranking'} onClick={() => setWorkspaceView('ranking')}>
                                    <BarChart3 aria-hidden="true" /> Momentum
                                </button>
                            </div>
                        </div>
                    </header>

                    {workspaceView === 'allocations' ? (
                        <>
                            <div className={styles.implementationOverview}>
                                <div className={styles.implementationPrimary}>
                                    <span className={styles.eyebrow}>Held / ETF target</span>
                                    <div className={styles.implementationNumbers}>
                                        <strong>{formatPct(actualExposurePct, 1)}</strong>
                                        <span>/</span>
                                        <strong>{formatPct(effectiveExposurePct, 1)}</strong>
                                    </div>
                                    <div className={styles.implementationMoney}>
                                        {formatMoney(ledger?.summary.actual_etf_value)} / {formatMoney(ledger?.summary.effective_target_value)}
                                    </div>
                                    <div className={styles.scaleTrack}>
                                        <span className={styles.actualFill} style={{ width: `${Math.min(100, (actualExposurePct / exposureScale) * 100)}%` }} />
                                        <span className={styles.effectiveMarker} style={{ left: `${Math.min(100, (effectiveExposurePct / exposureScale) * 100)}%` }} />
                                        <span className={styles.suggestedMarker} style={{ left: `${Math.min(100, (suggestedExposurePct / exposureScale) * 100)}%` }} />
                                    </div>
                                    <small className={styles.implementationGap}>
                                        {Math.abs(exposureVariancePct) < 0.05
                                            ? 'At current ETF target'
                                            : `${exposureVariancePct > 0 ? 'Above' : 'Below'} current target by ${formatMoney(Math.abs((ledger?.summary.actual_etf_value || 0) - (ledger?.summary.effective_target_value || 0)))}`}
                                    </small>
                                </div>

                                <div className={styles.implementationFacts}>
                                    <div>
                                        <span>Planning reference</span>
                                        <strong>{formatPct(suggestedExposurePct, 0)}</strong>
                                        <small>Suggested mix</small>
                                    </div>
                                    <div>
                                        <span>Core setup</span>
                                        <strong>{configuredCoreCount} / {targetClassGroups.length}</strong>
                                        <small>Classes configured</small>
                                    </div>
                                    <div className={blockedCoreCount > 0 ? styles.factWarning : ''}>
                                        <span>Trend blocks</span>
                                        <strong>{blockedCoreCount}</strong>
                                        <small>Additions blocked</small>
                                    </div>
                                    <div className={unassignedCount > 0 ? styles.factWarning : ''}>
                                        <span>Unassigned</span>
                                        <strong>{unassignedCount}</strong>
                                        <small>Funds</small>
                                    </div>
                                </div>

                            </div>

                            <div className={styles.allocationLedger}>
                                <div className={`${styles.allocationGrid} ${styles.columnHeader}`}>
                                    <span>Asset class / ETF</span>
                                    <span>Core policy</span>
                                    <span className={styles.numeric}>Held / target</span>
                                    <span className={styles.numeric}>Position</span>
                                    <span className={styles.centered}>Trend</span>
                                    <span />
                                </div>

                                {visibleAllocationGroups.length > 0 ? visibleAllocationGroups.map((group) => {
                                    const coreRow = group.rows.find((row) => row.is_core);
                                    const classGate = coreRow ? gateState(coreRow) : '';
                                    const hasApprovedTarget = (group.summary?.class_target_value || 0) > 0;
                                    const hasCore = Boolean(group.summary?.core_ticker || coreRow);
                                    const hasETFTarget = (group.summary?.effective_target_value || 0) > 0;
                                    const isClassExpanded = expandedAssetClasses.has(group.assetClass);
                                    const classState = group.assetClass === 'UNASSIGNED'
                                        ? 'Map funds'
                                        : hasApprovedTarget && !hasCore
                                            ? 'Core required'
                                            : classGate === 'SELL'
                                                ? 'Blocked'
                                                : targetVariance(group.summary?.target_delta_value, hasETFTarget);
                                    return (
                                    <section key={group.assetClass} className={styles.assetClassSection}>
                                        <div className={`${styles.allocationGrid} ${styles.classRow} ${classState === 'Core required' || classState === 'Map funds' ? styles.classNeedsSetup : classState === 'Blocked' ? styles.classBlocked : ''}`}>
                                            <button type="button" className={styles.classToggle} onClick={() => toggleAssetClass(group.assetClass)} aria-expanded={isClassExpanded}>
                                                <ChevronRight className={isClassExpanded ? styles.chevronExpanded : ''} aria-hidden="true" />
                                                <span className={styles.classIdentity}>
                                                    <strong>{group.assetClassName}</strong>
                                                    <small>{group.rows.length} fund{group.rows.length === 1 ? '' : 's'} · class target {hasApprovedTarget ? formatMoney(group.summary?.class_target_value) : 'not approved'}</small>
                                                </span>
                                            </button>
                                            <span data-mobile-label="Core policy" className={`${styles.classPolicy} ${hasCore ? styles.corePolicy : ''}`}>
                                                {hasCore
                                                    ? `${group.summary?.core_ticker || coreRow?.ticker} · ${formatCoreRatio(group.summary?.core_ratio_pct || coreRow?.core_ratio_pct || 0)}`
                                                    : hasApprovedTarget
                                                        ? 'Required'
                                                        : '—'}
                                            </span>
                                            <span data-mobile-label="Held / target" className={`${styles.numeric} ${styles.classAllocation}`}>
                                                {formatMoney(group.summary?.actual_etf_value || 0)} / {hasETFTarget ? formatMoney(group.summary?.effective_target_value) : '—'}
                                            </span>
                                            <span data-mobile-label="Position" className={`${styles.numeric} ${styles.classState} ${classState === 'Blocked' ? styles.stateBlocked : classState === 'Core required' || classState === 'Map funds' ? styles.stateReview : ''}`}>
                                                {classState}
                                            </span>
                                            <span data-mobile-label="Trend" className={`${styles.gate} ${classGate === 'BUY' ? styles.gateBuy : classGate === 'SELL' ? styles.gateSell : ''}`}>{classGate || ''}</span>
                                            <span />
                                        </div>

                                        {isClassExpanded && group.rows.map((row) => {
                                            const gate = gateState(row);
                                            const hasTarget = row.effective_target_value > 0 || row.is_core;
                                            const isExpanded = expandedTicker === row.ticker;
                                            return (
                                                <div key={row.ticker} className={styles.rowGroup}>
                                                    <div className={`${styles.allocationGrid} ${styles.fundRow} ${gate === 'SELL' ? styles.sellRow : ''}`}>
                                                        <div className={styles.fundIdentity}>
                                                            <strong>{row.ticker}</strong>
                                                            <span title={row.display_name}>{row.display_name || row.ticker}</span>
                                                        </div>
                                                        <span data-mobile-label="Core policy" className={`${styles.policy} ${row.is_core ? styles.corePolicy : ''}`}>{allocationPolicy(row)}</span>
                                                        <span data-mobile-label="Held / target" className={`${styles.numeric} ${styles.allocationPair}`}>{formatMoney(row.actual_value)} / {hasTarget ? formatMoney(row.effective_target_value) : '—'}</span>
                                                        <span data-mobile-label="Position" className={`${styles.numeric} ${styles.variance}`}>{targetVariance(row.target_delta_value, hasTarget)}</span>
                                                        <span data-mobile-label="Trend" className={`${styles.gate} ${gate === 'BUY' ? styles.gateBuy : gate === 'SELL' ? styles.gateSell : ''}`}>{gate || ''}</span>
                                                        <button type="button" onClick={() => setExpandedTicker(isExpanded ? null : row.ticker)} className={`${styles.editButton} ${isExpanded ? styles.editButtonActive : ''}`} title={`Configure ${row.ticker}`} aria-label={`Configure ${row.ticker}`} aria-expanded={isExpanded}>
                                                            <Settings2 aria-hidden="true" />
                                                        </button>
                                                    </div>

                                                    {isExpanded && (
                                                        <div className={styles.configuration}>
                                                            <div className={styles.configurationControls}>
                                                                <label>
                                                                    <span>Asset class</span>
                                                                    <select value={row.asset_class === 'UNASSIGNED' ? '' : row.asset_class} disabled={savingTicker === row.ticker} onChange={(event) => void updateAssetClass(row, event.target.value)}>
                                                                        <option value="">Unassigned</option>
                                                                        {assetClasses.map((assetClass) => (
                                                                            <option key={assetClass.code} value={assetClass.code}>
                                                                                {formatAssetClassName(assetClass)}{String(assetClass.class_type || '').toUpperCase() === 'CUSTOM' ? ' · Custom' : ''}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </label>
                                                                <button type="button" onClick={() => { setCustomClassTicker(customClassTicker === row.ticker ? null : row.ticker); setCustomClassName(''); }}>
                                                                    <Plus aria-hidden="true" /> New class
                                                                </button>
                                                            </div>

                                                            {row.is_core && (
                                                                <div className={styles.targetAttribution}>
                                                                    <div><span>Core base</span><strong>{formatMoney(row.core_target_value)}</strong></div>
                                                                    <div><span>Momentum</span><strong>{formatSignedMoney(row.momentum_adjustment_value)}</strong></div>
                                                                    <div><span>Recommended</span><strong>{formatMoney(row.recommended_target_value)}</strong></div>
                                                                    <div><span>Effective</span><strong>{formatMoney(row.effective_target_value)}</strong></div>
                                                                </div>
                                                            )}

                                                            {customClassTicker === row.ticker && (
                                                                <div className={styles.customClassControls}>
                                                                    <label><span>Class name</span><input value={customClassName} onChange={(event) => setCustomClassName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createAndAssignCustomClass(row); }} /></label>
                                                                    <label><span>Risk class</span><select value={customClassQuartile} onChange={(event) => setCustomClassQuartile(event.target.value)}><option value="Q1">Q1</option><option value="Q1_DEFENSIVE">Q1-Defensive</option><option value="Q1_EXEMPT">Q1-Exempt</option><option value="NON_MARKET">Non-market</option></select></label>
                                                                    <button type="button" disabled={!customClassName.trim() || creatingCustomClass} onClick={() => void createAndAssignCustomClass(row)}>Create</button>
                                                                    <button type="button" onClick={() => setCustomClassTicker(null)}>Cancel</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </section>
                                    );
                                }) : (
                                    <div className={styles.emptyState}>No ETF classes currently require review.</div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div>
                            <details className={styles.provenance}>
                            <summary><ChevronRight aria-hidden="true" /> Calculation details · prices through {formatDate(momentumRun?.data_fresh_through)}</summary>
                            <div className={styles.evidenceStrip}>
                                <div><span>Calculation</span><b>{momentumRun ? `Run #${momentumRun.id}` : 'Not available'}</b><small>{momentumRun?.algorithm_version || 'Model unavailable'}</small></div>
                                <div><span>Prices through</span><b>{formatDate(momentumRun?.data_fresh_through)}</b><small>{momentumRun?.provider || 'Provider unavailable'}</small></div>
                                <div><span>Published</span><b>{publishedMomentumRun ? `Run #${publishedMomentumRun.id}` : 'None'}</b><small>{momentumCadenceLabel(momentumAutomation?.publish_cadence)}</small></div>
                                <div><span>Coverage</span><b>{momentumRun ? `${momentumRun.ready_members}/${momentumRun.expected_members}` : '—'}</b><small>{momentumAutomation?.trading_sessions_required ? `${momentumAutomation.trading_sessions_elapsed}/${momentumAutomation.trading_sessions_required} sessions` : 'No cadence'}</small></div>
                            </div>
                            </details>

                            {momentumAutomation?.last_error && <div className={styles.warning}>Daily evidence warning · {momentumAutomation.last_error}</div>}
                            {ledger?.policy.momentum_source !== 'INTERNAL_PUBLISHED' && momentumRun && <div className={styles.notice}>Latest internal evidence is shown below. Live allocations still use TradingView compatibility weights.</div>}
                            {momentumError && <div className={styles.error}>{momentumError}</div>}

                            {momentumRows.length > 0 ? (
                                <div className={styles.rankingLedger}>
                                    <div className={`${styles.rankingGrid} ${styles.columnHeader}`}>
                                        <span>Rank</span><span>ETF / fund</span><span className={styles.numeric}>80D return</span><span className={styles.numeric}>12M momentum</span><span className={styles.numeric}>12M volatility</span><span className={styles.numeric}>Score</span><span className={styles.numeric}>Model weight</span>
                                    </div>
                                    {momentumRows.map((row) => {
                                        const normalizedStatus = String(row.status || '').toUpperCase();
                                        const showStatus = normalizedStatus !== 'READY' && normalizedStatus !== 'SELECTED';
                                        const fundName = row.display_name && row.display_name !== row.ticker
                                            ? row.display_name : rows.find(fund => fund.ticker === row.ticker)?.display_name || '';
                                        return (
                                            <div key={row.ticker} className={`${styles.rankingGrid} ${styles.rankingRow}`} title={row.diagnostic || undefined}>
                                                <span className={styles.rank}>{row.rank ?? '—'}</span>
                                                <div className={styles.fundIdentity}>
                                                    <strong title={row.ticker}>{row.ticker}</strong>
                                                    <span title={fundName || undefined}>{fundName}</span>
                                                    {showStatus && <em className={momentumStateClass(row.status)}>{row.status.replaceAll('_', ' ')}</em>}
                                                </div>
                                                <span data-mobile-label="80D return" className={styles.numeric}>{formatSignedPct(row.return_80_pct)}</span>
                                                <span data-mobile-label="12M momentum" className={styles.numeric}>{formatSignedPct(row.momentum_240_pct)}</span>
                                                <span data-mobile-label="12M volatility" className={styles.numeric}>{formatMetric(row.volatility_240, 3)}</span>
                                                <span data-mobile-label="Score" className={styles.numeric}>{formatMetric(row.score)}</span>
                                                <span data-mobile-label="Model weight" className={`${styles.numeric} ${styles.modelWeight}`}>{row.final_weight_pct === undefined ? '—' : formatPct(row.final_weight_pct, 1)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : <div className={styles.emptyState}>No completed internal momentum run is available yet.</div>}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
