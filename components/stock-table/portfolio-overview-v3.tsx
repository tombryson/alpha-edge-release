'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { useSecurityActions } from '@/lib/use-security-actions';
import { openAlertAction } from '@/lib/action-presentation';
import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    History,
    ArrowLeftRight,
} from 'lucide-react';
import type { PortfolioOverlaySummaryResponse } from '@/lib/api';
import type { Stock } from '@/lib/store';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import { getPortfolioAssetClassColor } from '@/lib/portfolio-composition-colors';
import {
    derivePortfolioImplementationState,
    comparePortfolioReferenceOrder,
    estimatePortfolioRebalanceTurnover,
    type PortfolioDifferenceState,
} from '@/lib/portfolio-overview-model';
import styles from './portfolio-overview-v3.module.css';
import { PortfolioRadialChart } from './portfolio-radial-chart';
import { PortfolioShapeComparison } from './portfolio-shape-comparison';
import { AssetClassColourControl } from '@/components/asset-class-colour-dialog';
import { usePortfolioCycle } from '@/lib/use-portfolio-cycle';
import { CycleReturn, PortfolioCycleSummary } from './portfolio-cycle-summary';

const TOLERANCE_PP = 0.5;
const MINIMUM_VISIBLE_DIFFERENCE_PP = 0.3;
const OVER = '#d8a444';
const UNDER = '#58a6ff';
const INLINE = '#47b86b';
const CONSTRAINED = '#a77ae8';
const MUTED = '#697381';
const CRISIS = '#e05252';

const ASSET_CLASS_SHORT_LABELS: Record<string, string> = {
    ENERGYPRODUCERS: 'ENERGY',
    GOLDMINERS: 'GOLD',
    PHARMABIOTECH: 'PHRM',
    SILVERMINERS: 'SLV',
    REE: 'RE',
    RAREEARTHS: 'RE',
    RAREEARTHSCRITICALMINERALS: 'RE',
    HEALTHCARESERVICES: 'HC',
    BASEMETALS: 'BASE',
    BASEMETALSMINERS: 'BASE',
    CASH: 'CASH',
    COPPERMINERS: 'CU',
    STAPLES: 'STPL',
    INSURANCE: 'INS',
    SEMICONDUCTORS: 'SEMI',
    TECHNOLOGY: 'TECH',
};

type ViewMode = 'shape' | 'cumulative' | 'deviation' | 'radial';
type DifferenceState = PortfolioDifferenceState | 'stale';

export interface PortfolioOverviewRow {
    code: string;
    assetClassCode: string;
    name: string;
    value: number;
    current: number;
    target: number | null;
    delta: number | null;
    absDelta: number;
    status: PortfolioDifferenceState;
    governedByQ1: boolean;
    stocks: Stock[];
}

interface ImplementationState {
    key: 'above' | 'available' | 'constrained' | 'suspended' | 'inline' | 'unassessed' | 'none' | 'stale';
    label: string;
    color: string;
    deployablePp: number;
}

interface PortfolioOverviewV3Props {
    rows: PortfolioOverviewRow[];
    totalValue: number;
    currentAvailable?: boolean;
    asOf?: string | null;
    approvedAt?: string | null;
    approvedId?: number | null;
    overlaySummary: PortfolioOverlaySummaryResponse | null;
    overlayRowsByCode: Map<string, PortfolioOverlaySummaryResponse['asset_classes'][number]>;
    securityPositions: Record<string, 'BUY' | 'SELL'>;
    onOpenTimeline: () => void;
    timeline?: ReactNode;
    onCloseTimeline: () => void;
}

function formatValue(value: number): string {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
    return `$${Math.round(value).toLocaleString('en-AU')}`;
}

function formatDate(value?: string | null): string {
    if (!value) return 'No date';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'No date';
    return parsed.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatPp(value: number | null): string {
    if (value === null) return '—';
    if (Math.abs(value) < 0.05) return '0.0pp';
    return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}pp`;
}

function isDataStale(asOf?: string | null): boolean {
    if (!asOf) return false;
    const timestamp = new Date(asOf).getTime();
    if (!Number.isFinite(timestamp)) return false;
    return Date.now() - timestamp > 7 * 24 * 60 * 60 * 1000;
}

function stateColor(state: DifferenceState): string {
    if (state === 'over') return OVER;
    if (state === 'under') return UNDER;
    return MUTED;
}

function implementationColor(key: ImplementationState['key']): string {
    if (key === 'above') return OVER;
    if (key === 'available') return UNDER;
    if (key === 'constrained') return CONSTRAINED;
    if (key === 'suspended') return CRISIS;
    return MUTED;
}

function shortAssetClassLabel(row: PortfolioOverviewRow): string {
    const code = normalizeAssetClassCode(row.code);
    if (ASSET_CLASS_SHORT_LABELS[code]) return ASSET_CLASS_SHORT_LABELS[code];
    return code.slice(0, 5) || row.name.slice(0, 5).toUpperCase();
}

function SummaryRail({
    collapsed,
    onToggle,
    totalValue,
    rows,
    approvedAt,
    approvedId,
    turnover,
    riskMode,
    availableHeadroom,
    stale,
    historicalComparison,
    currentAvailable,
}: {
    collapsed: boolean;
    onToggle: () => void;
    totalValue: number;
    rows: PortfolioOverviewRow[];
    approvedAt?: string | null;
    approvedId?: number | null;
    turnover: number;
    riskMode: string;
    availableHeadroom: number;
    stale: boolean;
    historicalComparison?: boolean;
    currentAvailable: boolean;
}) {
    const over = rows.filter((row) => row.status === 'over');
    const under = rows.filter((row) => row.status === 'under');
    const inline = rows.filter((row) => row.status === 'inline');
    const rowsWithTarget = rows.filter((row) => row.target !== null);
    const outsideTolerance = rowsWithTarget.filter((row) => row.absDelta >= TOLERANCE_PP).length;
    const approvedTopFour = [...rowsWithTarget]
        .sort((a, b) => (b.target ?? 0) - (a.target ?? 0))
        .slice(0, 4)
        .reduce((sum, row) => sum + (row.target ?? 0), 0);
    const hasApprovedTarget = rowsWithTarget.length > 0 && Boolean(approvedAt);
    const canEstimateTurnover = hasApprovedTarget && !stale && rows.every(row => row.target !== null);
    const largest = (stale ? [] : rows)
        .filter((row) => row.delta !== null && row.absDelta >= MINIMUM_VISIBLE_DIFFERENCE_PP)
        .sort((a, b) => b.absDelta - a.absDelta)
        .slice(0, 3);
    const status = riskMode === 'Q4_CRISIS'
        ? { color: CRISIS, title: 'Q4 · New deployment suspended', copy: 'Reduction and exit actions remain active.' }
        : riskMode === 'Q3_THROTTLE'
            ? { color: CONSTRAINED, title: 'Q3 · Implementation constrained', copy: 'Approved shape is unchanged; current capacity is reduced.' }
            : availableHeadroom > 0
                ? { color: INLINE, title: 'Capacity available', copy: `${formatValue(availableHeadroom)} of portfolio-level headroom.` }
                : { color: MUTED, title: 'No portfolio headroom', copy: 'Position actions remain authoritative.' };

    return (
        <aside className={`${styles.rail} ${collapsed ? styles.railCollapsed : ''}`}>
            <button className={styles.railToggle} type="button" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? 'Show portfolio summary' : 'Hide portfolio summary'}>
                <span className={styles.mobileRailTitle}>Portfolio summary</span>
                {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
            {!collapsed && (
                <div className={styles.railContent}>
                    <section>
                        <div className={styles.eyebrow}>{historicalComparison ? 'Current portfolio value' : 'Portfolio value'}</div>
                        <div className={styles.portfolioValue}>{currentAvailable ? formatValue(totalValue) : 'Unavailable'}</div>
                        <div className={styles.portfolioMeta}>
                            {rows.length} asset classes
                        </div>
                    </section>

                    <div className={styles.railDivider} />

                    <section>
                        <div className={styles.metricLine}>
                            <span className={styles.sectionLabel}>Est. turnover</span>
                            <span className={styles.metricValue}>{canEstimateTurnover ? `${turnover.toFixed(1)}%` : '—'}</span>
                        </div>
                        <div className={styles.subMetric}>{hasApprovedTarget && !stale && !canEstimateTurnover ? 'Not calculated for holdings outside the approved shape.' : 'Minimum two-sided movement implied by the approved shape.'}</div>
                    </section>

                    <div className={styles.railDivider} />

                    <section>
                        <div className={styles.sectionLabel}>Target difference</div>
                        <div className={styles.breakdown}>
                            <div className={styles.breakdownLine}><span>Above target</span><span className={styles.breakdownCount} style={{ color: OVER }}>{stale || !hasApprovedTarget ? '—' : over.length}</span></div>
                            <div className={styles.breakdownLine}><span>Below target</span><span className={styles.breakdownCount} style={{ color: UNDER }}>{stale || !hasApprovedTarget ? '—' : under.length}</span></div>
                            <div className={styles.breakdownLine}><span>Within tolerance</span><span className={styles.breakdownCount} style={{ color: INLINE }}>{stale || !hasApprovedTarget ? '—' : inline.length}</span></div>
                        </div>
                    </section>

                    {largest.length > 0 && (
                        <>
                            <div className={styles.railDivider} />
                            <section>
                                <div className={styles.sectionLabel}>Largest differences</div>
                                <div className={styles.differenceList}>
                                    {largest.map((row) => (
                                        <div className={styles.differenceLine} key={row.code}>
                                            <span className={styles.differenceName}>{row.name}</span>
                                            <span className={styles.differenceValue} style={{ color: stateColor(row.status) }}>{formatPp(row.delta)}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </>
                    )}

                    <div className={styles.railDivider} />

                    <section>
                        <div className={styles.targetHeading}>Approved target</div>
                        <div className={`${styles.targetVersion} ${!hasApprovedTarget ? styles.targetVersionMissing : ''}`}>
                            {hasApprovedTarget
                                ? `Approved${approvedId ? ` v${approvedId}` : ''} · ${formatDate(approvedAt)}`
                                : 'None approved'}
                        </div>
                        <div className={styles.targetMeta}>
                            {!hasApprovedTarget
                                ? 'No approved shape · no target difference is calculated'
                                : stale
                                    ? 'Target difference withheld until current holdings are refreshed'
                                    : <>
                                        {outsideTolerance} of {rowsWithTarget.length} classes outside ±{TOLERANCE_PP.toFixed(1)}pp<br />
                                        Top 4 approved at {approvedTopFour.toFixed(1)}%
                                    </>}
                        </div>
                    </section>

                    <div className={styles.implementationStatus} style={{ color: status.color }}>
                        <div className={styles.statusLabel}>{status.title}</div>
                        <div className={styles.statusCopy}>{status.copy}</div>
                    </div>
                </div>
            )}
        </aside>
    );
}

function ShapeRibbon({ rows, target = false, secondary = false }: { rows: PortfolioOverviewRow[]; target?: boolean; secondary?: boolean }) {
    const values = rows.map((row) => target ? (row.target ?? 0) : row.current);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return null;
    return (
        <div className={`${styles.ribbon} ${secondary ? styles.secondaryRibbon : ''}`} role="img" aria-label={target ? 'Approved portfolio shape' : 'Current holdings allocation'}>
            {rows.map((row, index) => {
                const value = values[index];
                if (value <= 0) return null;
                const width = value;
                const color = getPortfolioAssetClassColor(row.assetClassCode, index);
                return (
                    <div
                        className={styles.ribbonSegment}
                        key={row.code}
                        title={`${row.name}: ${value.toFixed(1)}%`}
                        style={{
                            width: `${width}%`,
                            background: secondary
                                ? `color-mix(in srgb, ${color} 65%, var(--background))`
                                : color,
                        }}
                    >
                        {width >= 3.2 && <span className={styles.ribbonShort}>{shortAssetClassLabel(row)}</span>}
                        {width >= 4 && <span className={styles.ribbonPct}>{value.toFixed(1)}%</span>}
                    </div>
                );
            })}
        </div>
    );
}

function VisualBar({
    row,
    color,
    mode,
    scaleMax,
    deviationScale,
    cumulativeBefore,
    cumulativeAfter,
    compareHoldings,
    implementation,
    currentAvailable,
    cumulativeCurrent,
    stale,
}: {
    row: PortfolioOverviewRow;
    color: string;
    mode: ViewMode;
    scaleMax: number;
    deviationScale: number;
    cumulativeBefore: number;
    cumulativeAfter: number;
    compareHoldings: boolean;
    implementation: ImplementationState;
    currentAvailable: boolean;
    cumulativeCurrent: number;
    stale: boolean;
}) {
    if (mode === 'cumulative') {
        return (
            <div className={styles.visualCell}>
                <div className={styles.track} />
                <div className={styles.cumulativeFill} style={{ width: `${Math.min(100, cumulativeBefore)}%` }} />
                <div className={styles.cumulativeClass} style={{ left: `${Math.min(100, cumulativeBefore)}%`, width: `${Math.max(0, Math.min(100, cumulativeAfter) - cumulativeBefore)}%`, background: color }} />
                {compareHoldings && currentAvailable && <div className={styles.targetMarker} style={{ left: `${Math.min(100, cumulativeCurrent)}%` }} title={`Held cumulative: ${cumulativeCurrent.toFixed(1)}%`} />}
            </div>
        );
    }

    if (mode === 'deviation') {
        if (row.delta === null || stale) return <div className={styles.visualCell}><div className={styles.zeroLine} /></div>;
        const width = Math.min(50, (Math.abs(row.delta) / deviationScale) * 50);
        const permittedWidth = Math.min(width, (implementation.deployablePp / deviationScale) * 50);
        const toleranceWidth = Math.min(50, (TOLERANCE_PP / deviationScale) * 50);
        const isPositive = row.delta > 0;
        const fillColor = isPositive ? OVER : UNDER;
        return (
            <div className={styles.visualCell}>
                <div className={styles.toleranceBand} style={{ left: `${50 - toleranceWidth}%`, width: `${toleranceWidth * 2}%` }} />
                <div className={styles.zeroLine} />
                {isPositive ? (
                    <div className={styles.deviationFill} style={{ left: '50%', width: `${width}%`, background: fillColor }} />
                ) : (
                    <>
                        {permittedWidth > 0 && <div className={styles.deviationFill} style={{ left: `${50 - permittedWidth}%`, width: `${permittedWidth}%`, background: UNDER }} />}
                        {width > permittedWidth && (
                            <div className={styles.deviationGhost} style={{ left: `${50 - width}%`, width: `${width - permittedWidth}%`, color: implementation.color }} />
                        )}
                    </>
                )}
            </div>
        );
    }

    const currentWidth = Math.min(100, (row.current / scaleMax) * 100);
    const targetWidth = row.target === null ? null : Math.min(100, (row.target / scaleMax) * 100);
    const gapLeft = targetWidth === null ? 0 : Math.min(currentWidth, targetWidth);
    const gapWidth = targetWidth === null ? 0 : Math.abs(currentWidth - targetWidth);
    return (
        <div className={styles.visualCell}>
            <div className={styles.shapeFill} style={{ width: `${targetWidth ?? 0}%`, background: color }} />
            {compareHoldings && currentAvailable && targetWidth !== null && gapWidth > 0.4 && (
                <div className={styles.shapeGap} style={{ left: `${gapLeft}%`, width: `${gapWidth}%`, color: implementation.color }} />
            )}
            {compareHoldings && currentAvailable && <div className={styles.targetMarker} style={{ left: `${currentWidth}%` }} title={`Held: ${row.current.toFixed(1)}%`} />}
        </div>
    );
}

export function PortfolioOverviewV3({
    rows,
    totalValue,
    currentAvailable = true,
    asOf,
    approvedAt,
    approvedId,
    overlaySummary,
    overlayRowsByCode,
    securityPositions,
    onOpenTimeline,
    timeline,
    onCloseTimeline,
}: PortfolioOverviewV3Props) {
    const { actions: policyActions } = useSecurityActions();
    const classReviews = new Map(policyActions.filter(action => action.alert_type === 'WEIGHT_CLASS_REVIEW' && action.status === 'OPEN').map(action => [normalizeAssetClassCode(action.asset_class_code), action]));
    const [view, setView] = useState<ViewMode>('shape');
    const [compareHoldings, setCompareHoldings] = useState(false);
    const [compareHistory, setCompareHistory] = useState(false);
    const cycle = usePortfolioCycle(!timeline && !compareHistory ? approvedId ?? undefined : undefined, approvedAt ?? undefined);
    const cycleByClass = new Map(cycle.data?.classes.map(row => [normalizeAssetClassCode(row.asset_class), row]));
    const [railCollapsed, setRailCollapsed] = useState(false);
    const mobile = useMobileLayout();
    const [mobileSummaryCollapsed, setMobileSummaryCollapsed] = useState(true);
    const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
    const [exceptionsOpen, setExceptionsOpen] = useState(false);
    const stale = !currentAvailable || isDataStale(asOf);
    const hasTarget = rows.some((row) => row.target !== null);
    const showHoldings = hasTarget && compareHoldings;
    const riskMode = overlaySummary?.portfolio_risk?.mode ?? 'NORMAL';

    const prepared = useMemo(() => {
        const ordered = [...rows].sort((a, b) => view === 'deviation' ? b.absDelta - a.absDelta || a.code.localeCompare(b.code) : comparePortfolioReferenceOrder(a, b, hasTarget));
        let cumulative = 0;
        let cumulativeCurrent = 0;
        return ordered.map((row, index) => {
            const before = cumulative;
            cumulative += row.target ?? 0;
            cumulativeCurrent += row.current;
            const overlayRow = overlayRowsByCode.get(normalizeAssetClassCode(row.code));
            const state = derivePortfolioImplementationState({
                differenceState: row.status,
                differencePp: row.delta,
                riskMode,
                stale,
                isReserve: normalizeAssetClassCode(row.code) === 'CASH',
                actualInvestedPct: overlayRow?.actual_invested_pct ?? row.current,
                allowedInvestedPct: overlayRow?.allowed_invested_pct,
            });
            return {
                ...row,
                color: getPortfolioAssetClassColor(row.assetClassCode, index),
                cumulativeBefore: before,
                cumulativeAfter: cumulative,
                cumulativeCurrent,
                implementation: {
                    ...state,
                    color: implementationColor(state.key),
                },
            };
        });
    }, [rows, view, overlayRowsByCode, riskMode, stale, hasTarget]);

    const scaleMax = Math.max(36, Math.ceil(Math.max(0, ...rows.map((row) => Math.max(row.current, row.target ?? 0))) / 4) * 4);
    const deviationScale = Math.max(6, Math.ceil(Math.max(0, ...rows.map((row) => row.absDelta))));
    const targetSourceTotal = rows.reduce((sum, row) => sum + (row.target ?? 0), 0);
    const turnover = estimatePortfolioRebalanceTurnover(
        rows.map((row) => ({ currentPct: row.current, targetPct: row.target })),
    );
    const referenceRows = useMemo(() => [...rows].sort((a, b) => comparePortfolioReferenceOrder(a, b, hasTarget)), [rows, hasTarget]);
    const exceptions = prepared.filter((row) =>
        row.absDelta > TOLERANCE_PP || ['constrained', 'suspended', 'unassessed', 'stale'].includes(row.implementation.key),
    );
    const toggleExpanded = (code: string) => {
        setExpandedClasses((current) => {
            const next = new Set(current);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    };
    const closeHistory = () => {
        setCompareHistory(false);
        if (view === 'deviation' && !compareHoldings) setView('shape');
    };

    return (
        <div className={`${styles.shell} terminal-workspace terminal-workspace-controls`} data-testid="portfolio-overview">
            {!timeline && <SummaryRail
                collapsed={mobile ? mobileSummaryCollapsed : railCollapsed}
                onToggle={() => mobile ? setMobileSummaryCollapsed((value) => !value) : setRailCollapsed((value) => !value)}
                totalValue={totalValue}
                rows={rows}
                approvedAt={approvedAt}
                approvedId={approvedId}
                turnover={turnover}
                riskMode={riskMode}
                availableHeadroom={overlaySummary?.available_headroom_value ?? 0}
                stale={stale}
                historicalComparison={compareHistory}
                currentAvailable={currentAvailable}
            />}

            <section className={styles.main}>
                <div className={styles.toolbar}>
                    <div className={styles.toolbarIdentity}>
                        <span className={styles.toolbarTitle}>Portfolio shape</span>
                    </div>
                    <div className={styles.toolbarActions}>
                        <div className={styles.viewControls} role="group" aria-label="Portfolio shape view">
                            {(['shape', 'cumulative', 'deviation', 'radial'] as const).map((mode) => (
                                <button
                                    type="button"
                                    key={mode}
                                    aria-pressed={!timeline && view === mode}
                                    className={`${styles.viewButton} ${!timeline && view === mode ? styles.viewButtonActive : ''}`}
                                    onClick={() => {
                                        setView(mode);
                                        if (mode === 'deviation' && !compareHistory) setCompareHoldings(true);
                                        onCloseTimeline();
                                    }}
                                >
                                    {mode === 'shape' ? 'Shape' : mode === 'cumulative' ? 'Cumulative' : mode === 'radial' ? 'Radial' : 'Difference'}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            className={`${styles.targetButton} ${!timeline && !compareHistory && showHoldings ? styles.viewButtonActive : ''}`}
                            disabled={!hasTarget}
                            aria-pressed={!timeline && !compareHistory && showHoldings}
                            onClick={() => {
                                if (timeline || compareHistory) {
                                    onCloseTimeline();
                                    setCompareHistory(false);
                                    setCompareHoldings(true);
                                } else {
                                    setCompareHoldings((value) => !value);
                                    if (showHoldings && view === 'deviation') setView('shape');
                                }
                            }}
                        >
                            Compare
                        </button>
                        <button type="button" className={`${styles.timelineButton} ${!timeline && compareHistory ? styles.viewButtonActive : ''}`} aria-pressed={!timeline && compareHistory} onClick={() => {
                            if (!timeline && compareHistory) closeHistory();
                            else setCompareHistory(true);
                            onCloseTimeline();
                        }}>
                            <ArrowLeftRight size={15} />
                            History
                        </button>
                        <button type="button" className={`${styles.timelineButton} ${timeline ? styles.viewButtonActive : ''}`} aria-pressed={Boolean(timeline)} onClick={timeline ? onCloseTimeline : onOpenTimeline} title={timeline ? 'Return to portfolio view' : 'Open portfolio history'}>
                            <History size={13} />
                            Timeline
                        </button>
                    </div>
                </div>

                {timeline ? <div className={styles.timelineContent}>{timeline}</div> : <>
                {!compareHistory && approvedId && <PortfolioCycleSummary {...cycle} />}
                {!compareHistory && view !== 'radial' && <div className={styles.ribbons}>
                    {hasTarget && <>
                        <div className={styles.ribbonLabel}>Approved</div>
                        <ShapeRibbon rows={referenceRows} target />
                    </>}
                    {showHoldings && <>
                        <div className={styles.ribbonLabel}>Current holdings</div>
                        {currentAvailable && <ShapeRibbon rows={referenceRows} secondary />}
                    </>}
                    {(!hasTarget || (showHoldings && stale) || Math.abs(targetSourceTotal - 100) > 0.5) && <div className={styles.ribbonCaption}>
                        <span className={hasTarget ? styles.ribbonTargetNote : styles.ribbonTargetMissing}>
                            {!hasTarget
                                ? 'No approved portfolio target'
                                : showHoldings && stale
                                    ? currentAvailable ? 'Holdings out of date' : 'Holdings unavailable'
                                    : `${targetSourceTotal.toFixed(1)}% approved · incomplete allocation`}
                        </span>
                    </div>}
                </div>}

                <div className={styles.tableScroll} data-portfolio-scroll>
                    {compareHistory ? (
                        <PortfolioShapeComparison view={view} refreshKey={`${approvedId ?? ''}:${approvedAt ?? ''}`} presentation={Object.fromEntries(rows.map((row, index) => [normalizeAssetClassCode(row.code), { name: row.name, color: getPortfolioAssetClassColor(row.code, index) }]))} onBack={closeHistory} />
                    ) : prepared.length === 0 ? (
                        <div className={styles.empty}>No portfolio data loaded.</div>
                    ) : view === 'radial' ? (
                        hasTarget ? <PortfolioRadialChart
                            rows={prepared.map(row => ({ ...row, current: stale ? null : row.current }))}
                            showTarget
                            compareHoldings={showHoldings}
                            stale={stale}
                            approvedLabel={`Approved${approvedId ? ` v${approvedId}` : ''} · ${formatDate(approvedAt)}`}
                        /> : <div className={styles.empty}>No approved portfolio target.</div>
                    ) : (
                        <div className={`${styles.table} ${!showHoldings ? styles.approvedOnly : ''}`}>
                            <div className={styles.tableHeader}>
                                <div className={styles.columnHeader}>Asset class</div>
                                <div className={styles.axis}>
                                    <span className={styles.columnHeader}>{view === 'shape' ? showHoldings ? 'Approved / held marker' : 'Approved weight' : view === 'cumulative' ? 'Cumulative weight' : 'Target difference'}</span>
                                    <div className={styles.axisScale}>
                                        <span>{view === 'deviation' ? `−${deviationScale}pp` : '0%'}</span>
                                        <span>{view === 'deviation' ? '0' : view === 'cumulative' ? '50%' : `${scaleMax / 2}%`}</span>
                                        <span>{view === 'deviation' ? `+${deviationScale}pp` : view === 'cumulative' ? '100%' : `${scaleMax}%`}</span>
                                    </div>
                                </div>
                                <div className={styles.columnHeader} style={{ textAlign: 'right' }}>Approved</div>
                                <div className={styles.columnHeader} style={{ textAlign: 'right' }} title="Cycle adjusted-price return, not allocation change or personal P/L">Return %</div>
                                <div className={styles.columnHeader} style={{ textAlign: 'right' }}>Cum.</div>
                                <div className={styles.columnHeader} style={{ textAlign: 'right' }}>Per $1K</div>
                                {showHoldings && <>
                                    <div className={styles.columnHeader} style={{ textAlign: 'right' }}>Held</div>
                                    <div className={styles.columnHeader} style={{ textAlign: 'right' }}>Diff.</div>
                                    <div className={styles.columnHeader}>State</div>
                                </>}
                            </div>

                            {prepared.map((row) => {
                                const expanded = expandedClasses.has(row.code);
                                const canExpand = row.stocks.length > 0;
                                const differenceColor = stateColor(stale ? 'stale' : row.status);
                                const differenceIsNeutral = !stale && row.status === 'inline';
                                const stateIsNeutral = row.implementation.key === 'inline';
                                return (
                                    <div key={row.code}>
                                        <div className={styles.row} data-asset-class={row.code} onClick={() => canExpand && toggleExpanded(row.code)}>
                                            <div className={styles.nameCell}>
                                                <span className={styles.caret}>{canExpand ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}</span>
                                                <div className={styles.nameStack}>
                                                    <div className={styles.titleLine}>
                                                        <AssetClassColourControl
                                                            assetClass={{ code: row.assetClassCode, display_name: row.name }}
                                                            variant="swatch"
                                                            className={styles.swatch}
                                                        />
                                                        <div className={styles.className}>{row.name}</div>
                                                        {classReviews.has(normalizeAssetClassCode(row.assetClassCode)) && <button type="button" className="inline-flex shrink-0 cursor-pointer items-center text-[var(--caution)]" aria-label={`Review ${row.name} allocation`} title="Review class allocation"
                                                            onClick={event => { event.stopPropagation(); const review=classReviews.get(normalizeAssetClassCode(row.assetClassCode))!; openAlertAction({ id: review.id, ticker: review.ticker }); }}>!</button>}
                                                    </div>
                                                    <div className={styles.classValue}>{currentAvailable ? formatValue(row.value) : 'Holdings unavailable'}{hasTarget && row.target === null && ' · Outside approved shape'}</div>
                                                </div>
                                            </div>
                                            <VisualBar
                                                row={row}
                                                color={row.color}
                                                mode={view}
                                                scaleMax={scaleMax}
                                                deviationScale={deviationScale}
                                                cumulativeBefore={row.cumulativeBefore}
                                                cumulativeAfter={row.cumulativeAfter}
                                                compareHoldings={showHoldings}
                                                implementation={row.implementation}
                                                currentAvailable={!stale}
                                                cumulativeCurrent={row.cumulativeCurrent}
                                                stale={stale}
                                            />
                                            <div data-mobile-label="Approved" className={`${styles.numberCell} ${styles.numberStrong}`}>{row.target === null ? '—' : `${row.target.toFixed(1)}%`}</div>
                                            <div data-mobile-label="Return %" className={styles.numberCell}><CycleReturn row={cycleByClass.get(normalizeAssetClassCode(row.code))} unavailable={cycle.error || cycle.data?.reason || (cycle.loading ? 'Loading cycle returns' : undefined)} /></div>
                                            <div data-mobile-label="Approved cumulative" className={styles.numberCell}>{hasTarget ? `${row.cumulativeAfter.toFixed(1)}%` : '—'}</div>
                                            <div data-mobile-label="Approved per $1K" className={styles.numberCell}>{row.target === null ? '—' : `$${Math.round(row.target * 10)}`}</div>
                                            {showHoldings && <>
                                                <div data-mobile-label="Held" className={styles.numberCell}>{stale ? '—' : `${row.current.toFixed(1)}%`}</div>
                                                <div data-mobile-label="Difference" className={styles.numberCell}>
                                                    <span className={`${styles.differenceBadge} ${differenceIsNeutral ? styles.differenceBadgeNeutral : ''}`} style={{ color: differenceColor }}>{stale ? '—' : formatPp(row.delta)}</span>
                                                </div>
                                                <div className={`${styles.state} ${stateIsNeutral ? styles.stateNeutral : ''}`} style={{ color: row.implementation.color }} title={row.implementation.label}>{row.implementation.label}</div>
                                            </>}
                                        </div>

                                        {expanded && row.stocks.length > 0 && (
                                            <div className={styles.expanded}>
                                                {[...row.stocks]
                                                    .sort((a, b) => (b.positionValue ?? 0) - (a.positionValue ?? 0))
                                                    .map((stock) => (
                                                        <div className={styles.holdingRow} key={stock.id}>
                                                            <div className={styles.holdingName}>
                                                                <span className={styles.holdingTicker}>{stock.symbol}</span>
                                                                <span> · {stock.name}</span>
                                                                {stock.securityType?.toUpperCase() === 'ETF' && <span className={styles.etfTag}>ETF</span>}
                                                            </div>
                                                            <div className={styles.holdingTicker} style={{ color: securityPositions[stock.id] === 'SELL' ? CRISIS : securityPositions[stock.id] === 'BUY' ? INLINE : MUTED }}>
                                                                {securityPositions[stock.id] ?? '—'}
                                                            </div>
                                                            <div className={styles.holdingValue}>{formatValue(stock.positionValue ?? 0)}</div>
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {!compareHistory && hasTarget && (
                    <div className={styles.exceptions}>
                        <button className={styles.exceptionsButton} type="button" onClick={() => setExceptionsOpen((value) => !value)}>
                            <span>
                                <span className={styles.exceptionsTitle}>Portfolio attention · {exceptions.length}</span>
                                <span className={styles.exceptionsCopy}>Read-only evidence from target differences and implementation controls</span>
                            </span>
                            {exceptionsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {exceptionsOpen && (
                            <div className={styles.exceptionList}>
                                {exceptions.length === 0 ? (
                                    <div className={styles.empty} style={{ minHeight: 42 }}>No material portfolio differences.</div>
                                ) : exceptions.map((row) => (
                                    <div className={styles.exceptionRow} key={row.code}>
                                        <span className={styles.className}>{row.name}</span>
                                        <span className={styles.exceptionMeta} style={{ color: stateColor(row.status) }}>{formatPp(row.delta)}</span>
                                        <span className={styles.exceptionReason}>{row.implementation.label}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                </>}
            </section>
        </div>
    );
}
