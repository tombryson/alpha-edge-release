'use client';

import { useRef, useState } from 'react';
import { DataFreshnessIndicator } from '@/components/data-freshness-indicator';
import { api, type ExchangeAssignmentTarget, type ExchangeAssignmentResult } from '@/lib/api';
import freshnessStyles from '@/components/data-freshness-indicator.module.css';
import { useStore } from '@/lib/store';
import * as Popover from '@radix-ui/react-popover';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Archive,
    Check,
    ChevronDown,
    CircleAlert,
    Eye,
    Focus,
    LayoutTemplate,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    X,
} from 'lucide-react';

type AnalysisToolbarProps = {
    groupMode: 'none' | 'sector';
    watchlistHighlightEnabled: boolean;
    etfsHidden: boolean;
    showNonAllocatingInstruments: boolean;
    scoreAlignment: 'left' | 'center' | 'right';
    search: string;
    focusedAssetClassLabel?: string;
    listingReviewCount: number;
    missingExchangeCount: number;
    missingExchangeTargets: ExchangeAssignmentTarget[];
    missingExchangeOnly: boolean;
    missingResearchCount: number;
    missingResearchOnly: boolean;
    onToggleMissingResearch: () => void;
    onToggleMissingExchange: () => void;
    refreshingPrices: boolean;
    onSetGroupMode: (mode: 'none' | 'sector') => void;
    onToggleWatchlistHighlight: () => void;
    onToggleEtfs: () => void;
    onToggleNonAllocatingInstruments: () => void;
    onSetScoreAlignment: (alignment: 'left' | 'center' | 'right') => void;
    onSearchChange: (value: string) => void;
    onClearAssetClassFocus: () => void;
    onOpenListingReviews: () => void;
    onOpenTemplateLibrary: () => void;
    onRefreshPrices: () => void;
    onAddToWatchlist: () => void;
};

const menuContentClass =
    'z-[180] w-[250px] rounded-[4px] border border-border/80 bg-popover p-[10px] text-popover-foreground shadow-[0_10px_28px_rgba(0,0,0,0.55)] outline-none';

const toolbarButtonClass =
    'inline-flex h-[28px] shrink-0 items-center justify-center gap-[6px] rounded-[3px] border border-border/60 px-[10px] text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:border-border hover:bg-muted/15 hover:text-foreground';

export function AnalysisToolbar({
    groupMode,
    watchlistHighlightEnabled,
    etfsHidden,
    showNonAllocatingInstruments,
    scoreAlignment,
    search,
    focusedAssetClassLabel,
    listingReviewCount,
    missingExchangeCount,
    missingExchangeTargets,
    missingExchangeOnly,
    missingResearchCount,
    missingResearchOnly,
    onToggleMissingResearch,
    onToggleMissingExchange,
    refreshingPrices,
    onSetGroupMode,
    onToggleWatchlistHighlight,
    onToggleEtfs,
    onToggleNonAllocatingInstruments,
    onSetScoreAlignment,
    onSearchChange,
    onClearAssetClassFocus,
    onOpenListingReviews,
    onOpenTemplateLibrary,
    onRefreshPrices,
    onAddToWatchlist,
}: AnalysisToolbarProps) {
    const [viewMenuOpen, setViewMenuOpen] = useState(false);
    const assigningRef = useRef(false);
    const [assigning, setAssigning] = useState(false);
    const [assignmentProgress, setAssignmentProgress] = useState('');
    const [assignmentResults, setAssignmentResults] = useState<ExchangeAssignmentResult[] | null>(null);
    const autoAssign = async () => {
        if (assigningRef.current) return;
        assigningRef.current = true;
        setAssigning(true);
        setAssignmentResults(null);
        const targets = [...missingExchangeTargets];
        const results: ExchangeAssignmentResult[] = [];
        try {
            for (let i = 0; i < targets.length; i += 5) {
                setAssignmentProgress(`Checking ${i + 1}-${Math.min(i + 5, targets.length)} of ${targets.length}`);
                const response = await api.autoAssignExchanges(targets.slice(i, i + 5));
                results.push(...response.results);
                setAssignmentResults([...results]);
                await useStore.getState().fetchHoldings();
            }
        } finally {
            setAssignmentProgress('');
            setAssigning(false);
            assigningRef.current = false;
            // Also reload after an interrupted request: it may already have saved a match.
            await useStore.getState().fetchHoldings();
            await useStore.getState().fetchActiveAlerts();
        }
    };
    const assignedCount = assignmentResults?.filter(result => result.status === 'assigned').length || 0;
    const reviewCount = assignmentResults?.filter(result => result.status === 'review').length || 0;
    const skippedCount = assignmentResults?.filter(result => result.status === 'skipped').length || 0;

    const visibilityRows = [
        {
            label: 'Highlight watchlist',
            checked: watchlistHighlightEnabled,
            onToggle: onToggleWatchlistHighlight,
            icon: Eye,
        },
        {
            label: 'Show ETFs',
            checked: !etfsHidden,
            onToggle: onToggleEtfs,
            icon: Eye,
        },
        {
            label: 'Show excluded instruments',
            checked: showNonAllocatingInstruments,
            onToggle: onToggleNonAllocatingInstruments,
            icon: Archive,
        },
    ];

    return (
        <div className="analysis-context-toolbar flex h-[42px] flex-shrink-0 items-center gap-[8px] border-b border-border/70 bg-muted/[0.025] px-[12px]">
            <div className="flex shrink-0 items-center gap-[8px]">
                <button
                    type="button"
                    onClick={onOpenTemplateLibrary}
                    className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[3px] border border-caution/35 bg-caution/8 text-caution outline-none transition-colors hover:border-caution/50 hover:bg-caution/14"
                    aria-label="Open template library"
                    title="Template library"
                >
                    <LayoutTemplate size={14} aria-hidden="true" />
                </button>

                <button
                    type="button"
                    onClick={onRefreshPrices}
                    disabled={refreshingPrices}
                    className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[3px] border border-info/35 bg-info/8 text-info outline-none transition-colors hover:border-info/50 hover:bg-info/14 disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label={refreshingPrices ? 'Refreshing prices' : 'Refresh prices'}
                    title={refreshingPrices ? 'Refreshing prices' : 'Refresh prices'}
                >
                    <RefreshCw
                        size={14}
                        aria-hidden="true"
                        className={refreshingPrices ? 'animate-spin' : ''}
                    />
                </button>

                {listingReviewCount > 0 && (
                    <button
                        type="button"
                        onClick={onOpenListingReviews}
                        className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[3px] border border-caution/35 bg-caution/8 text-caution outline-none transition-colors hover:bg-caution/14"
                        aria-label={`Open ${listingReviewCount} listing review${listingReviewCount === 1 ? '' : 's'}`}
                        title={`${listingReviewCount} listing review${listingReviewCount === 1 ? '' : 's'}`}
                    >
                        <CircleAlert size={14} aria-hidden="true" />
                    </button>
                )}

                <button
                    type="button"
                    onClick={onAddToWatchlist}
                    className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[3px] border border-primary/35 bg-primary/12 text-primary outline-none transition-colors hover:bg-primary/18"
                    aria-label="Add to watchlist"
                    title="Add to watchlist"
                >
                    <Plus size={15} aria-hidden="true" />
                </button>

            </div>

            <DataFreshnessIndicator datasets={['ANALYSIS_PRICE_HISTORY', 'ETF_MOMENTUM', 'LISTING_VERIFICATION']} issues={[
                ...(missingResearchCount > 0 ? [{
                    id: 'missing-sizing-research', title: 'Incomplete sizing research',
                    detail: `${missingResearchCount} ${missingResearchCount === 1 ? 'security' : 'securities'}`,
                    action: { label: missingResearchOnly ? 'Show all securities' : 'Review research', run: onToggleMissingResearch, active: missingResearchOnly },
                    content: <p className={freshnessStyles.details}>Complete the missing research. Positions withholds stock Ideal wt for an affected held class until every held stock has a complete model result. Core ETF targets are unchanged.</p>,
                }] : []),
                ...(missingExchangeCount > 0 || assigning || assignmentResults ? [{
                id: 'missing-exchanges',
                title: 'Missing exchanges',
                detail: `${missingExchangeCount} ${missingExchangeCount === 1 ? 'security' : 'securities'}`,
                resolved: missingExchangeCount === 0,
                primaryAction: missingExchangeCount > 0 || assigning ? {
                    label: assigning ? 'Assigning...' : 'Auto-assign',
                    run: autoAssign,
                    disabled: assigning || missingExchangeTargets.length === 0,
                } : undefined,
                action: { label: missingExchangeOnly ? 'Show all securities' : 'Review securities', run: onToggleMissingExchange, active: missingExchangeOnly },
                content: <>
                    {(assigning || assignmentResults) && <p className={freshnessStyles.assignmentStatus} role="status">
                        {assigning ? assignmentProgress : `${assignedCount} assigned · ${reviewCount} need review${skippedCount ? ` · ${skippedCount} already assigned` : ''}`}
                    </p>}
                    {Boolean(assignmentResults?.length) && <details className={freshnessStyles.assignmentResults}>
                        <summary>Assignment results</summary>
                        <ul>{assignmentResults!.map(result => <li key={`${result.kind}:${result.id}`}>
                            <strong>{result.name || result.ticker || 'Security'}</strong>
                            <small>{result.status === 'assigned' ? `${result.exchange_prefix}${result.ticker} · ${result.source}` : result.reason}</small>
                        </li>)}</ul>
                    </details>}
                </>,
            }] : [])]} actions={{
                ANALYSIS_PRICE_HISTORY: { label: 'Refresh history', run: async () => {
                    const result = await api.refreshAnalysisPerformance();
                    await useStore.getState().fetchHoldings();
                    if (result.errors.length) throw new Error(result.errors[0]);
                } },
                LISTING_VERIFICATION: { label: 'Refresh prices and listing checks', run: onRefreshPrices, disabled: refreshingPrices },
            }} />
            <div className="ml-auto flex min-w-0 items-center gap-[8px]">
            <div
                className="inline-flex h-[28px] shrink-0 overflow-hidden rounded-[3px] border border-border/65 bg-background/35"
                role="group"
                aria-label="Analysis layout"
            >
                <button
                    type="button"
                    onClick={() => onSetGroupMode('none')}
                    className={`min-w-[48px] px-[10px] text-[10px] font-mono font-semibold uppercase tracking-[0.06em] transition-colors ${
                        groupMode === 'none'
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-muted/15 hover:text-foreground'
                    }`}
                    aria-pressed={groupMode === 'none'}
                >
                    Flat
                </button>
                <button
                    type="button"
                    onClick={() => onSetGroupMode('sector')}
                    className={`min-w-[56px] border-l border-border/60 px-[10px] text-[10px] font-mono font-semibold uppercase tracking-[0.06em] transition-colors ${
                        groupMode === 'sector'
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-muted/15 hover:text-foreground'
                    }`}
                    aria-pressed={groupMode === 'sector'}
                >
                    Sector
                </button>
            </div>

            <Popover.Root open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        className={`${toolbarButtonClass} ${
                            viewMenuOpen ? 'border-border bg-muted/15 text-foreground' : ''
                        }`}
                        aria-label="Analysis view options"
                    >
                        <SlidersHorizontal size={13} aria-hidden="true" />
                        <span className="analysis-toolbar-view-label">View</span>
                        <ChevronDown size={11} aria-hidden="true" />
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        align="start"
                        side="bottom"
                        sideOffset={7}
                        collisionPadding={10}
                        onOpenAutoFocus={(event) => event.preventDefault()}
                        className={menuContentClass}
                    >
                        <div className="px-[4px] pb-[4px] font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/75">
                            Visible rows
                        </div>
                        <div className="space-y-px">
                            {visibilityRows.map(({ label, checked, onToggle, icon: Icon }) => (
                                <button
                                    key={label}
                                    type="button"
                                    onClick={onToggle}
                                    className="grid h-[32px] w-full grid-cols-[20px_1fr_18px] items-center rounded-[3px] px-[6px] text-left text-muted-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                                    aria-pressed={checked}
                                >
                                    <Icon size={12} aria-hidden="true" />
                                    <span className="font-mono text-[11px]">{label}</span>
                                    {checked && <Check size={11} aria-hidden="true" />}
                                </button>
                            ))}
                        </div>

                        <section className="mt-[8px] border-t border-border/45 pt-[8px]">
                            <div className="px-[4px] pb-[6px] font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/75">
                                Score alignment
                            </div>
                            <div className="grid grid-cols-3 overflow-hidden rounded-[3px] border border-border/55">
                                {([
                                    ['left', AlignLeft, 'Left'],
                                    ['center', AlignCenter, 'Centre'],
                                    ['right', AlignRight, 'Right'],
                                ] as const).map(([alignment, Icon, label]) => (
                                    <button
                                        key={alignment}
                                        type="button"
                                        onClick={() => onSetScoreAlignment(alignment)}
                                        className={`inline-flex h-[32px] items-center justify-center gap-[6px] border-r border-border/50 text-[10px] last:border-r-0 ${
                                            scoreAlignment === alignment
                                                ? 'bg-foreground text-background'
                                                : 'text-muted-foreground hover:bg-muted/15 hover:text-foreground'
                                        }`}
                                        aria-pressed={scoreAlignment === alignment}
                                        title={`Align scores ${label.toLowerCase()}`}
                                    >
                                        <Icon size={12} aria-hidden="true" />
                                        <span>{label}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>

            {focusedAssetClassLabel && (
                <button
                    type="button"
                    onClick={onClearAssetClassFocus}
                    data-testid="analysis-clear-asset-class-focus"
                    className="analysis-toolbar-focus inline-flex h-[28px] shrink-0 items-center gap-[6px] rounded-[3px] border border-primary/35 bg-primary/8 px-[10px] text-[10px] font-mono font-semibold uppercase tracking-[0.06em] text-primary transition-colors hover:bg-primary/12"
                    title={`Show all asset classes; currently focused on ${focusedAssetClassLabel}`}
                >
                    <Focus size={12} aria-hidden="true" />
                    <span className="analysis-toolbar-focus-label max-w-[120px] truncate">{focusedAssetClassLabel}</span>
                    <X size={11} aria-hidden="true" />
                </button>
            )}

            <div className="analysis-toolbar-search relative min-w-[150px] max-w-[280px] flex-[0_1_280px]">
                <label htmlFor="analysis-security-search" className="sr-only">
                    Find a security in Analysis
                </label>
                <Search
                    size={13}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-foreground/80"
                />
                <input
                    id="analysis-security-search"
                    type="search"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search ticker or company"
                    className="h-[28px] w-full rounded-[3px] border border-border/65 bg-background/35 pl-[32px] pr-[8px] text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-primary/55"
                />
            </div>
            </div>
        </div>
    );
}
