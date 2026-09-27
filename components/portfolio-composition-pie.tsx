'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    getPortfolioAssetClassColor,
    getPortfolioGroupColor,
    normalizePortfolioAssetClass,
    PORTFOLIO_COMPACT_OTHER_COLOR,
} from '@/lib/portfolio-composition-colors';

type PortfolioPieRow = {
    assetClass: string;
    displayName: string;
    parentGroup?: string;
    value: number;
};

type CompositionSlice = {
    key: string;
    label: string;
    value: number;
    pct: number;
    color: string;
    assetClassCode?: string | null;
    assetClassCodes: string[];
};


function compactMoney(value?: number | null): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '$0';
    return `$${Math.round(value).toLocaleString()}`;
}

function getRowParentGroup(row: PortfolioPieRow): string {
    return row.parentGroup?.trim() || row.displayName || row.assetClass || 'Misc';
}

function normalizeGroupKey(group: string): string {
    return group.trim() || 'Misc';
}

function buildPieSlices(rows: PortfolioPieRow[], flatten: boolean): CompositionSlice[] {
    if (!rows.length) return [];

    const totals = new Map<
        string,
        { value: number; color: string; assetClassCodes: Set<string> }
    >();
    rows.forEach((item, index) => {
        const assetClassCode = normalizePortfolioAssetClass(item.assetClass);
        const key = flatten
            ? assetClassCode
            : normalizeGroupKey(getRowParentGroup(item));
        const label = flatten ? item.displayName : key;
        const color = flatten
            ? getPortfolioAssetClassColor(item.assetClass, index)
            : getPortfolioGroupColor(key);
        const existing = totals.get(label);
        const assetClassCodes = existing?.assetClassCodes || new Set<string>();
        assetClassCodes.add(assetClassCode);
        totals.set(label, {
            value: (existing?.value || 0) + item.value,
            color: existing?.color || color,
            assetClassCodes,
        });
    });

    const total = Array.from(totals.values()).reduce(
        (sum, item) => sum + item.value,
        0,
    );
    if (total <= 0) return [];

    return Array.from(totals.entries())
        .map(([label, entry]) => {
            const assetClassCodes = Array.from(entry.assetClassCodes);
            return {
                key: label,
                label,
                value: entry.value,
                pct: (entry.value / total) * 100,
                color: entry.color,
                assetClassCode:
                    assetClassCodes.length === 1 ? assetClassCodes[0] : null,
                assetClassCodes,
            };
        })
        .sort((a, b) => b.value - a.value);
}

function buildGroupChildSlices(
    rows: PortfolioPieRow[],
    group: string,
): CompositionSlice[] {
    const children = rows
        .filter((item) => normalizeGroupKey(getRowParentGroup(item)) === group)
        .sort((a, b) => b.value - a.value);

    const total = children.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0) return [];

    return children.map((item, index) => ({
        key: normalizePortfolioAssetClass(item.assetClass),
        label: item.displayName,
        value: item.value,
        pct: (item.value / total) * 100,
        color: getPortfolioAssetClassColor(item.assetClass, index),
        assetClassCode: normalizePortfolioAssetClass(item.assetClass),
        assetClassCodes: [normalizePortfolioAssetClass(item.assetClass)],
    }));
}

function buildDrillableGroups(rows: PortfolioPieRow[]): Set<string> {
    const counts = new Map<string, number>();
    for (const item of rows) {
        const group = normalizeGroupKey(getRowParentGroup(item));
        counts.set(group, (counts.get(group) || 0) + 1);
    }
    return new Set(
        Array.from(counts.entries())
            .filter(([, count]) => count > 1)
            .map(([group]) => group),
    );
}

function polarToCartesian(
    center: number,
    radius: number,
    angleInDegrees: number,
) {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
    return {
        x: center + radius * Math.cos(angleInRadians),
        y: center + radius * Math.sin(angleInRadians),
    };
}

function describeDonutSlice(
    center: number,
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    endAngle: number,
) {
    const outerStart = polarToCartesian(center, outerRadius, endAngle);
    const outerEnd = polarToCartesian(center, outerRadius, startAngle);
    const innerStart = polarToCartesian(center, innerRadius, startAngle);
    const innerEnd = polarToCartesian(center, innerRadius, endAngle);
    const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerStart.x} ${innerStart.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
        'Z',
    ].join(' ');
}

export function PortfolioCompositionPie({
    rows,
    title,
    onAssetClassHover,
    activeAssetClassCodes = [],
    compact = false,
    showLegend = true,
}: {
    rows: PortfolioPieRow[];
    title: string;
    onAssetClassHover?: (assetClassCodes: string[]) => void;
    activeAssetClassCodes?: string[];
    compact?: boolean;
    showLegend?: boolean;
}) {
    const [flattenComposition, setFlattenComposition] = useState(true);
    const [drilledGroup, setDrilledGroup] = useState<string | null>(null);
    const [hoveredSliceKey, setHoveredSliceKey] = useState<string | null>(null);

    const drillableGroups = useMemo(() => buildDrillableGroups(rows), [rows]);
    const pieSlices = useMemo(() => {
        if (drilledGroup && !flattenComposition) {
            return buildGroupChildSlices(rows, drilledGroup);
        }
        return buildPieSlices(rows, flattenComposition);
    }, [drilledGroup, flattenComposition, rows]);

    useEffect(() => {
        if (flattenComposition && drilledGroup) {
            setDrilledGroup(null);
        }
    }, [flattenComposition, drilledGroup]);

    useEffect(() => {
        setHoveredSliceKey(null);
        onAssetClassHover?.([]);
    }, [flattenComposition, drilledGroup]);

    const totalPie = pieSlices.reduce((sum, slice) => sum + slice.value, 0);
    const normalizedActiveAssetClassCodes = useMemo(
        () => activeAssetClassCodes.map(normalizePortfolioAssetClass).filter(Boolean),
        [activeAssetClassCodes],
    );
    const externallyActiveSlice =
        normalizedActiveAssetClassCodes.length > 0
            ? pieSlices.find((slice) =>
                  slice.assetClassCodes.some((code) =>
                      normalizedActiveAssetClassCodes.includes(code),
                  ),
              ) || null
            : null;
    const activeSlice =
        pieSlices.find((slice) => slice.key === hoveredSliceKey) ||
        externallyActiveSlice ||
        pieSlices[0] ||
        null;
    const centerLabel = activeSlice?.label || title;
    const centerPct = activeSlice ? `${activeSlice.pct.toFixed(1)}%` : '0.0%';
    const centerValue = activeSlice ? compactMoney(activeSlice.value) : '$0';
    const canResetDrill = Boolean(drilledGroup && !flattenComposition);
    const compactLegendSlices = useMemo(() => {
        const namedSlices = pieSlices.filter(
            (slice) => slice.label.trim().toLowerCase() !== 'other',
        );
        const featuredSlices = namedSlices.slice(0, 6);
        const remainingSlices = [
            ...namedSlices.slice(6),
            ...pieSlices.filter(
                (slice) => slice.label.trim().toLowerCase() === 'other',
            ),
        ];
        if (!remainingSlices.length) return featuredSlices;

        const otherValue = remainingSlices.reduce(
            (sum, slice) => sum + slice.value,
            0,
        );
        return [
            ...featuredSlices,
            {
                key: 'other',
                label: 'Other',
                value: otherValue,
                pct: totalPie > 0 ? (otherValue / totalPie) * 100 : 0,
                color: PORTFOLIO_COMPACT_OTHER_COLOR,
                assetClassCode: null,
                assetClassCodes: remainingSlices.flatMap(
                    (slice) => slice.assetClassCodes,
                ),
            },
        ];
    }, [pieSlices, totalPie]);

    const handleSliceClick = (slice: CompositionSlice) => {
        if (flattenComposition) return;
        if (drilledGroup) {
            setDrilledGroup(null);
            return;
        }
        if (drillableGroups.has(slice.label)) {
            setDrilledGroup(slice.label);
        }
    };
    const handleSliceHover = (slice: CompositionSlice | null) => {
        setHoveredSliceKey(slice?.key || null);
        onAssetClassHover?.(slice?.assetClassCodes || []);
    };

    let currentAngle = 0;
    const center = 160;
    const outerRadius = 132;
    const innerRadius = 82;
    const compactOuterRadius = showLegend ? 156 : 142;
    const compactInnerRadius = showLegend ? 104 : 90;
    const activeOuterRadius = compact ? compactOuterRadius : outerRadius;
    const activeInnerRadius = compact ? compactInnerRadius : innerRadius;

    return (
        <div className={compact ? "flex h-full min-h-0 w-full flex-col" : "space-y-3"}>
            <div className={compact ? "sr-only" : "flex items-center justify-between gap-4"}>
                <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-foreground">
                        {title}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {canResetDrill && (
                        <button
                            type="button"
                            onClick={() => setDrilledGroup(null)}
                            className="rounded border border-border/45 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground hover:text-foreground"
                        >
                            Back
                        </button>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <input
                            className="h-3 w-3"
                            type="checkbox"
                            checked={flattenComposition}
                            onChange={(event) =>
                                setFlattenComposition(event.target.checked)
                            }
                        />
                        Flatten
                    </label>
                </div>
            </div>

            <div className={compact ? showLegend ? "grid min-h-0 grid-cols-[minmax(0,140px)_minmax(48px,1fr)] items-center gap-[8px] pt-[4px]" : "min-h-0" : "grid gap-4 xl:h-[330px] xl:grid-cols-[330px_minmax(0,1fr)] xl:items-stretch"}>
                <div className={compact ? showLegend ? "relative aspect-square w-full max-w-[140px]" : "relative mx-auto aspect-square w-full max-w-[14.5rem]" : "relative mx-auto h-[330px] w-[330px] max-w-full xl:self-center"}>
                    <svg
                        className="h-full w-full overflow-visible"
                        viewBox="0 0 320 320"
                        role="img"
                        aria-label={title}
                        style={
                            compact
                                ? {
                                      transform:
                                          'matrix3d(1, 0, 0, 0, 0, 1.04, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)',
                                      marginTop: '3px',
                                  }
                                : undefined
                        }
                    >
                        <circle
                            cx={center}
                            cy={center}
                            r={activeOuterRadius}
                            fill="none"
                            stroke="rgba(255,255,255,0.05)"
                            strokeWidth={2}
                        />
                        {pieSlices.map((slice) => {
                            const angle =
                                totalPie > 0
                                    ? (slice.value / totalPie) * 360
                                    : 0;
                            const startAngle = currentAngle;
                            const endAngle = startAngle + angle;
                            currentAngle = endAngle;
                            const active = hoveredSliceKey === slice.key;
                            const externallyActive =
                                !hoveredSliceKey &&
                                normalizedActiveAssetClassCodes.length > 0 &&
                                slice.assetClassCodes.some((code) =>
                                    normalizedActiveAssetClassCodes.includes(code),
                                );
                            const muted =
                                hoveredSliceKey !== null
                                    ? hoveredSliceKey !== slice.key
                                    : normalizedActiveAssetClassCodes.length > 0 &&
                                      !externallyActive;
                            const isInteractive =
                                !flattenComposition &&
                                (drilledGroup !== null ||
                                    drillableGroups.has(slice.label));

                            return (
                                <path
                                    key={slice.key}
                                    d={describeDonutSlice(
                                        center,
                                        active || externallyActive
                                            ? activeOuterRadius + 4
                                            : activeOuterRadius,
                                        activeInnerRadius,
                                        startAngle,
                                        endAngle,
                                    )}
                                    fill={slice.color}
                                    stroke="var(--background)"
                                    strokeWidth={3}
                                    className={`transition-all duration-150 ${
                                        muted ? 'opacity-35' : 'opacity-100'
                                    } ${isInteractive ? 'cursor-pointer' : 'cursor-default'}`}
                                    onMouseEnter={() => handleSliceHover(slice)}
                                    onMouseLeave={() => handleSliceHover(null)}
                                    onFocus={() => handleSliceHover(slice)}
                                    onBlur={() => handleSliceHover(null)}
                                    onClick={() => handleSliceClick(slice)}
                                    tabIndex={isInteractive ? 0 : -1}
                                />
                            );
                        })}
                        <circle
                            cx={center}
                            cy={center}
                            r={activeInnerRadius - 6}
                            fill="var(--card)"
                            stroke="rgba(255,255,255,0.08)"
                            strokeWidth={1}
                        />
                        <text
                            x={center}
                            y={center - 20}
                            textAnchor="middle"
                            className={
                                compact
                                    ? showLegend
                                        ? "sleeve-pie-title fill-foreground text-[18px] font-normal uppercase"
                                        : "fill-foreground text-[13px] font-mono uppercase"
                                    : "fill-muted-foreground text-[10px] font-mono uppercase"
                            }
                        >
                            {centerLabel.length > 18
                                ? `${centerLabel.slice(0, 18)}...`
                                : centerLabel}
                        </text>
                        <text
                            x={center}
                            y={center + 8}
                            textAnchor="middle"
                            className={
                                compact
                                    ? showLegend
                                        ? "fill-foreground text-[32px] font-semibold"
                                        : "fill-foreground text-[25px] font-semibold"
                                    : "fill-foreground text-[22px] font-semibold"
                            }
                        >
                            {centerPct}
                        </text>
                        <text
                            x={center}
                            y={center + 32}
                            textAnchor="middle"
                            className={
                                compact
                                    ? showLegend
                                        ? "sleeve-pie-value fill-muted-foreground text-[24px] font-mono"
                                        : "fill-muted-foreground text-[13px] font-mono"
                                    : "fill-muted-foreground text-[10px] font-mono"
                            }
                        >
                            {centerValue}
                        </text>
                    </svg>
                </div>

                {compact && showLegend && (
                    <div className="grid min-w-0 content-start gap-[6px] pt-[6px]">
                        {compactLegendSlices.map((slice) => (
                            <div
                                key={slice.key}
                                className="grid grid-cols-[8px_minmax(0,1fr)_32px] items-center gap-[4px] text-[10.5px] leading-[14px]"
                            >
                                <span
                                    className="h-[8px] w-[8px] rounded-[1px]"
                                    style={{ backgroundColor: slice.color }}
                                />
                                <span className="truncate font-medium text-foreground" title={slice.label}>
                                    {slice.label}
                                </span>
                                <span className="text-right font-mono text-foreground/90">
                                    {slice.pct.toFixed(1)}%
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {!compact && (
                <div className="grid max-h-[330px] min-h-0 gap-1.5 overflow-y-auto overscroll-contain pr-1 xl:h-full xl:content-start">
                    {pieSlices.map((slice) => {
                        const active = hoveredSliceKey === slice.key;
                        const externallyActive =
                            !hoveredSliceKey &&
                            normalizedActiveAssetClassCodes.length > 0 &&
                            slice.assetClassCodes.some((code) =>
                                normalizedActiveAssetClassCodes.includes(code),
                            );
                        const isInteractive =
                            !flattenComposition &&
                            (drilledGroup !== null ||
                                drillableGroups.has(slice.label));
                        return (
                            <button
                                key={slice.key}
                                type="button"
                                className={`grid grid-cols-[10px_minmax(0,1fr)_52px_76px] items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                                    active || externallyActive
                                        ? 'border-border/70 bg-background/45 text-foreground'
                                        : 'border-border/25 bg-background/15 text-muted-foreground hover:bg-background/30 hover:text-foreground'
                                } ${isInteractive ? 'cursor-pointer' : 'cursor-default'}`}
                                onMouseEnter={() => handleSliceHover(slice)}
                                onMouseLeave={() => handleSliceHover(null)}
                                onFocus={() => handleSliceHover(slice)}
                                onBlur={() => handleSliceHover(null)}
                                onClick={() => handleSliceClick(slice)}
                            >
                                <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: slice.color }}
                                />
                                <span className="truncate text-[11px] font-medium">
                                    {slice.label}
                                </span>
                                <span className="text-right text-[11px] font-mono text-foreground">
                                    {slice.pct.toFixed(1)}%
                                </span>
                                <span className="text-right text-[10px] font-mono">
                                    {compactMoney(slice.value)}
                                </span>
                            </button>
                        );
                    })}
                </div>
                )}
            </div>

            {compact && showLegend && (
                <div className="mt-[4px] grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[8px] border-t border-border/70 pt-[10px] pb-[2px] text-[11px]">
                    <span className="font-semibold text-foreground">Total portfolio</span>
                    <span className="font-mono font-semibold text-foreground">
                        {compactMoney(totalPie)}
                    </span>
                    <span className="font-mono text-muted-foreground">100%</span>
                </div>
            )}
        </div>
    );
}
