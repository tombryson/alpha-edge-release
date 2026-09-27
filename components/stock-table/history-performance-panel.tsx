import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type {
    AssetClassPerformancePoint,
    PortfolioPerformancePoint,
} from '@/lib/api';
import { groupPortfolioShapeConfirmations, type PortfolioShapeConfirmation } from '@/lib/portfolio-history-markers';
import { Maximize2, Minimize2, TrendingUp } from 'lucide-react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    audFormatter,
    compactAudFormatter,
    formatPerformanceDate,
} from './formatters';
import {
    HISTORY_METRIC_TILE_CLASS,
    HISTORY_PANEL_CLASS,
} from './history';
import { HistoryRangeControl } from './history-controls';
import styles from './history-workspace.module.css';
import { renderHistoryChartTooltip } from './history-chart-tooltip';
import { HistoryShapeMarker } from './history-shape-marker';
import { getPortfolioAssetClassColor } from '@/lib/portfolio-composition-colors';
import {
    performanceEventColor,
    performanceEventDash,
    type PerformanceChartEvent,
} from './performance-events';
import type { HistoryPerformanceRange } from './types';

type PortfolioPerformanceChartPoint = {
    date: string;
    observedAt: string;
    total: number;
    invested: number;
    cash: number;
    sleeveCash: number;
};

type AssetClassPerformanceShape = {
    keys: string[];
    classCodes: Record<string, string>;
    data: Record<string, unknown>[];
};

type HistoryPortfolioSummary = {
    first: PortfolioPerformancePoint | null;
    last: PortfolioPerformancePoint | null;
    change: number;
    changePct: number;
    cashPct: number;
};

type HistoryPerformancePanelProps = {
    historyDemoAvailable: boolean;
    historyDemo: boolean;
    setHistoryDemo: Dispatch<SetStateAction<boolean>>;
    historyPerformanceExpanded: boolean;
    setHistoryPerformanceExpanded: Dispatch<SetStateAction<boolean>>;
    historyPerformanceRange: HistoryPerformanceRange;
    setHistoryPerformanceRange: Dispatch<
        SetStateAction<HistoryPerformanceRange>
    >;
    portfolioPerformanceChartData: PortfolioPerformanceChartPoint[];
    historyPerformanceEvents: PerformanceChartEvent[];
    portfolioShapeConfirmations: PortfolioShapeConfirmation[];
    historyPortfolioSummary: HistoryPortfolioSummary;
    historyAssetClassLatestRows: AssetClassPerformancePoint[];
    latestPortfolioPerformance: PortfolioPerformancePoint | null;
    historyPerformanceEventLegendItems: Array<{
        label: string;
        color: string;
        dash: string;
    }>;
    assetClassPerformanceShape: AssetClassPerformanceShape;
};

export function HistoryPerformancePanel({
    historyDemoAvailable,
    historyDemo,
    setHistoryDemo,
    historyPerformanceExpanded,
    setHistoryPerformanceExpanded,
    historyPerformanceRange,
    setHistoryPerformanceRange,
    portfolioPerformanceChartData,
    historyPerformanceEvents,
    portfolioShapeConfirmations,
    historyPortfolioSummary,
    historyAssetClassLatestRows,
    latestPortfolioPerformance,
    historyPerformanceEventLegendItems,
    assetClassPerformanceShape,
}: HistoryPerformancePanelProps) {
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [shapeChartWidth, setShapeChartWidth] = useState(0);
    const shapeDomain = useMemo<[number, number]>(() => {
        const times = [...assetClassPerformanceShape.data.map(row => Number(row.timeMs)),
            ...portfolioShapeConfirmations.map(item => item.timeMs)].filter(Number.isFinite);
        return times.length ? [Math.min(...times), Math.max(...times)] : [0, 1];
    }, [assetClassPerformanceShape.data, portfolioShapeConfirmations]);
    const confirmationGroups = useMemo(() => groupPortfolioShapeConfirmations(
        portfolioShapeConfirmations, shapeDomain, shapeChartWidth - 46,
    ), [portfolioShapeConfirmations, shapeDomain, shapeChartWidth]);
    const shapePreviewOpen = portfolioShapeConfirmations.some(item => item.id === previewId);
    return (
        <section
            className={HISTORY_PANEL_CLASS}
        >
            <div className={styles.header}>
                <div className={styles.title}>
                    <TrendingUp className="h-5 w-5 text-info" />
                    <h2 className="terminal-workspace-title">
                        {historyDemo ? 'Demo performance' : 'Performance'}
                    </h2>
                </div>
                <div className={styles.controls}>
                    {historyDemoAvailable && (
                        <label className={styles.demo}>
                            <input type="checkbox" checked={historyDemo} onChange={(event) => setHistoryDemo(event.target.checked)} className="h-3.5 w-3.5 accent-current" />
                            Demo history
                        </label>
                    )}
                    <HistoryRangeControl value={historyPerformanceRange} onChange={setHistoryPerformanceRange} />
                    <button
                        type="button"
                        onClick={() =>
                            setHistoryPerformanceExpanded(
                                (expanded) => !expanded,
                            )
                        }
                        className={`${styles.button} ${styles.iconButton}`}
                        title={historyPerformanceExpanded ? 'Compact charts' : 'Expand charts'}
                        aria-label={historyPerformanceExpanded ? 'Compact charts' : 'Expand charts'}
                        aria-pressed={historyPerformanceExpanded}
                    >
                        {historyPerformanceExpanded ? (
                            <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                            <Maximize2 className="h-3.5 w-3.5" />
                        )}
                    </button>
                </div>
            </div>
            {historyDemo && (
                <div role="status" className={styles.notice}>
                    Simulated approvals and holdings · September 2025 to September 2026
                </div>
            )}
            <div className={styles.metrics}>
                <div className={HISTORY_METRIC_TILE_CLASS}>
                    <div className="tabular-nums text-[11px] tracking-normal text-muted-foreground">
                        Start
                    </div>
                    <div className="mt-1 tabular-nums text-sm font-semibold text-foreground">
                        {historyPortfolioSummary.first
                            ? audFormatter.format(
                                  historyPortfolioSummary.first.total_value_aud,
                              )
                            : '-'}
                    </div>
                </div>
                <div className={HISTORY_METRIC_TILE_CLASS}>
                    <div className="tabular-nums text-[11px] tracking-normal text-muted-foreground">
                        End
                    </div>
                    <div className="mt-1 tabular-nums text-sm font-semibold text-foreground">
                        {historyPortfolioSummary.last
                            ? audFormatter.format(
                                  historyPortfolioSummary.last.total_value_aud,
                              )
                            : '-'}
                    </div>
                </div>
                <div className={HISTORY_METRIC_TILE_CLASS}>
                    <div className="tabular-nums text-[11px] tracking-normal text-muted-foreground">
                        Value change
                    </div>
                    <div
                        className={`mt-1 tabular-nums text-sm font-semibold ${
                            historyPortfolioSummary.change >= 0
                                ? 'text-positive'
                                : 'text-destructive'
                        }`}
                    >
                        {audFormatter.format(historyPortfolioSummary.change)} (
                        {historyPortfolioSummary.changePct.toFixed(1)}%)
                    </div>
                </div>
                <div className={HISTORY_METRIC_TILE_CLASS}>
                    <div className="tabular-nums text-[11px] tracking-normal text-muted-foreground">
                        Cash
                    </div>
                    <div className="mt-1 tabular-nums text-sm font-semibold text-foreground">
                        {historyPortfolioSummary.cashPct.toFixed(1)}%
                    </div>
                </div>
                <div className={HISTORY_METRIC_TILE_CLASS}>
                    <div className="tabular-nums text-[11px] tracking-normal text-muted-foreground">
                        Largest class
                    </div>
                    <div className="tabular-nums text-foreground">
                        {historyAssetClassLatestRows[0]
                            ? `${
                                  historyAssetClassLatestRows[0].display_name ||
                                  historyAssetClassLatestRows[0].asset_class
                              } ${historyAssetClassLatestRows[0].portfolio_weight_pct.toFixed(1)}%`
                            : '-'}
                    </div>
                </div>
            </div>
            {portfolioPerformanceChartData.length === 0 ? (
                <div className={styles.empty}>
                    No performance snapshots recorded yet
                </div>
            ) : (
                <div
                    className={styles.charts}
                    data-expanded={historyPerformanceExpanded}
                >
                    <div
                        className={styles.chart}
                        data-testid="history-value-chart"
                    >
                        <div className={styles.chartHeader}>
                            <div>
                                <h3>{historyDemo ? 'Demo portfolio value' : 'Portfolio value'}</h3>
                                <strong>
                                    {latestPortfolioPerformance
                                        ? audFormatter.format(
                                              latestPortfolioPerformance.total_value_aud,
                                          )
                                        : '-'}
                                </strong>
                            </div>
                            <div className={styles.legend} aria-label="Value chart series">
                                <span><i style={{ borderColor: 'var(--info)' }} />Total</span>
                                <span><i style={{ borderColor: 'var(--warning)' }} />Invested</span>
                            </div>
                        </div>
                        <div
                            className={styles.chartPlot}
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                    data={portfolioPerformanceChartData}
                                    margin={{
                                        top: 6,
                                        right: 8,
                                        left: 0,
                                        bottom: 0,
                                    }}
                                >
                                    <CartesianGrid
                                        stroke="var(--workspace-rule)"
                                        strokeOpacity={0.45}
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                                        tickLine={false}
                                        axisLine={{
                                            stroke: 'var(--workspace-rule)',
                                        }}
                                    />
                                    <YAxis
                                        width={58}
                                        tickFormatter={(value) =>
                                            compactAudFormatter.format(Number(value))
                                        }
                                        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip
                                        content={renderHistoryChartTooltip(
                                            historyPerformanceEvents,
                                            (_name, value) =>
                                                audFormatter.format(Number(value)),
                                        )}
                                    />
                                    {historyPerformanceEvents.map((event) => (
                                        <ReferenceLine
                                            key={`${event.date}-${event.id}`}
                                            x={event.date}
                                            stroke={performanceEventColor(event)}
                                            strokeDasharray={performanceEventDash(
                                                event,
                                            )}
                                            strokeOpacity={0.45}
                                        />
                                    ))}
                                    <Line
                                        type="monotone"
                                        dataKey="total"
                                        name="Total"
                                        stroke="var(--info)"
                                        strokeWidth={2}
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="invested"
                                        name="Invested"
                                        stroke="var(--warning)"
                                        strokeWidth={1.5}
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <details className={styles.events}>
                            <summary>{portfolioPerformanceChartData.length} snapshots{historyPerformanceEvents.length > 0 ? ` · ${historyPerformanceEvents.length} events` : ''}</summary>
                            <div className={styles.legend}>{historyPerformanceEventLegendItems.map(item => <span key={item.label}>
                                <i style={{ borderColor: item.color, borderTopStyle: item.dash === '1 0' ? 'solid' : 'dashed' }} />{item.label}
                            </span>)}</div>
                        </details>
                    </div>
                    <div
                        className={styles.chart}
                        data-testid="history-weights-chart"
                    >
                        <div className={styles.chartHeader}>
                            <div>
                                <h3>
                                    Asset class weights
                                </h3>
                            </div>
                            <div className={styles.count}>
                                {portfolioShapeConfirmations.length > 0 && (
                                    <>
                                        <span className="h-3 border-l border-dashed border-foreground/60" />
                                        <span>
                                            {portfolioShapeConfirmations.length}{' '}
                                            {historyDemo ? 'demo shape' : 'approved shape'}
                                            {portfolioShapeConfirmations.length === 1
                                                ? ''
                                                : 's'}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                        <div
                            className={styles.chartPlot}
                        >
                            <ResponsiveContainer width="100%" height="100%" onResize={width => setShapeChartWidth(width)}>
                                <AreaChart
                                    data={assetClassPerformanceShape.data}
                                    margin={{
                                        top: 6,
                                        right: 8,
                                        left: 0,
                                        bottom: 10,
                                    }}
                                >
                                    <CartesianGrid
                                        stroke="var(--workspace-rule)"
                                        strokeOpacity={0.45}
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="timeMs"
                                        type="number"
                                        scale="time"
                                        domain={shapeDomain}
                                        tickFormatter={(value) =>
                                            formatPerformanceDate(Number(value))
                                        }
                                        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                                        tickLine={false}
                                        height={34}
                                        axisLine={{
                                            stroke: 'var(--workspace-rule)',
                                        }}
                                    />
                                    <YAxis
                                        width={38}
                                        domain={historyDemo ? [0, 100] : undefined}
                                        ticks={historyDemo ? [0, 25, 50, 75, 100] : undefined}
                                        tickFormatter={(value) =>
                                            `${Number(value).toFixed(0)}%`
                                        }
                                        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip
                                        active={shapePreviewOpen ? false : undefined}
                                        labelFormatter={(value) =>
                                            formatPerformanceDate(Number(value))
                                        }
                                        formatter={(value) =>
                                            `${Number(value).toFixed(1)}%`
                                        }
                                        content={renderHistoryChartTooltip([], (_name, value) => `${Number(value).toFixed(1)}%`, value => formatPerformanceDate(Number(value)))}
                                    />
                                    {assetClassPerformanceShape.keys.map(
                                        (key) => (
                                            <Area
                                                key={key}
                                                type="monotone"
                                                dataKey={key}
                                                stackId="asset-class"
                                                stroke={getPortfolioAssetClassColor(
                                                    assetClassPerformanceShape.classCodes[key] || key,
                                                )}
                                                fill={getPortfolioAssetClassColor(
                                                    assetClassPerformanceShape.classCodes[key] || key,
                                                )}
                                                fillOpacity={0.42}
                                                dot={false}
                                                isAnimationActive={false}
                                            />
                                        ),
                                    )}
                                    {confirmationGroups.map(
                                        (confirmations) => {
                                            const confirmation = confirmations[confirmations.length - 1];
                                            return (
                                            <ReferenceLine
                                                key={confirmation.id}
                                                x={confirmation.timeMs}
                                                ifOverflow="extendDomain"
                                                shape={(props) => (
                                                    <HistoryShapeMarker
                                                        {...props}
                                                        confirmation={confirmation}
                                                        confirmations={confirmations}
                                                        plotRight={shapeChartWidth - 8}
                                                        open={previewId === confirmation.id}
                                                        onOpenChange={(open) => setPreviewId(current => open ? confirmation.id : current === confirmation.id ? null : current)}
                                                    />
                                                )}
                                            />
                                            );
                                        },
                                    )}
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
