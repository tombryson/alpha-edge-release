'use client';

import { useMemo, useState } from 'react';
import type { PortfolioMixRow } from '@/lib/api';
import {
    buildPortfolioGroupDialModel,
    type PortfolioGroupDialSlice,
} from '@/lib/portfolio-group-dial';
import { PORTFOLIO_COMPACT_OTHER_COLOR } from '@/lib/portfolio-composition-colors';

type RingSegment = {
    slice: PortfolioGroupDialSlice;
    startAngle: number;
    endAngle: number;
};

type LegendItem = PortfolioGroupDialSlice & {
    memberKeys: string[];
};

const CENTER = 160;
const OTHER_KEY = '__OTHER__';

function polarToCartesian(radius: number, angleInDegrees: number) {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
    return {
        x: CENTER + radius * Math.cos(angleInRadians),
        y: CENTER + radius * Math.sin(angleInRadians),
    };
}

function describeRingSegment(
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    rawEndAngle: number,
) {
    const endAngle = Math.min(rawEndAngle, startAngle + 359.999);
    const outerStart = polarToCartesian(outerRadius, endAngle);
    const outerEnd = polarToCartesian(outerRadius, startAngle);
    const innerStart = polarToCartesian(innerRadius, startAngle);
    const innerEnd = polarToCartesian(innerRadius, endAngle);
    const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerStart.x} ${innerStart.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
        'Z',
    ].join(' ');
}

function buildSegments(
    slices: PortfolioGroupDialSlice[],
    value: 'targetPct' | 'currentPct',
): RingSegment[] {
    let angle = 0;
    return slices.flatMap((slice) => {
        const size = Math.max(0, slice[value]) * 3.6;
        if (size <= 0) return [];
        const startAngle = angle;
        angle += size;
        return [{ slice, startAngle, endAngle: angle }];
    });
}

function buildLegendItems(slices: PortfolioGroupDialSlice[]): LegendItem[] {
    const namedSlices = slices.filter(
        (slice) => slice.label.trim().toLowerCase() !== 'other',
    );
    const featuredSlices = namedSlices.slice(0, 6);
    const remainingSlices = [
        ...namedSlices.slice(6),
        ...slices.filter(
            (slice) => slice.label.trim().toLowerCase() === 'other',
        ),
    ];
    const featured = featuredSlices.map((slice) => ({
        ...slice,
        memberKeys: [slice.key],
    }));
    if (!remainingSlices.length) return featured;

    const currentPct = remainingSlices.reduce(
        (sum, slice) => sum + slice.currentPct,
        0,
    );
    const targetPct = remainingSlices.reduce(
        (sum, slice) => sum + slice.targetPct,
        0,
    );
    return [
        ...featured,
        {
            key: OTHER_KEY,
            label: 'Other',
            color: PORTFOLIO_COMPACT_OTHER_COLOR,
            assetClassCodes: remainingSlices.flatMap(
                (slice) => slice.assetClassCodes,
            ),
            memberKeys: remainingSlices.map((slice) => slice.key),
            currentPct,
            targetPct,
            driftPct: currentPct - targetPct,
        },
    ];
}

function formatPct(value: number) {
    return `${value.toFixed(1)}%`;
}

function formatDrift(value: number) {
    if (Math.abs(value) < 0.05) return '0.0';
    return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
}

export function PortfolioGroupDial({
    currentRows,
    approvedRows,
    showLegend = true,
    driftThresholdPct = 1,
    compareHoldings = true,
}: {
    currentRows: PortfolioMixRow[];
    approvedRows: PortfolioMixRow[];
    showLegend?: boolean;
    driftThresholdPct?: number;
    compareHoldings?: boolean;
}) {
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const model = useMemo(
        () => buildPortfolioGroupDialModel({ currentRows, approvedRows }),
        [approvedRows, currentRows],
    );
    const legendItems = useMemo(
        () => buildLegendItems(model.slices),
        [model.slices],
    );
    const targetSegments = buildSegments(model.slices, 'targetPct');
    const currentSegments = buildSegments(model.slices, 'currentPct');
    const activeItem =
        legendItems.find((item) => item.key === hoveredKey) ||
        model.slices.find((slice) => slice.key === hoveredKey) ||
        model.slices.find((slice) => slice.targetPct > 0) ||
        model.slices.find((slice) => slice.currentPct > 0) ||
        null;
    const activeVariance = activeItem?.driftPct || 0;
    const activeVarianceColor = !model.hasTarget
        ? 'var(--muted-foreground)'
        : activeVariance > 0.05
          ? 'var(--signal-buy)'
          : activeVariance < -0.05
            ? 'var(--signal-sell)'
            : 'var(--muted-foreground)';
    const hoveredMembers =
        legendItems.find((item) => item.key === hoveredKey)?.memberKeys ||
        (hoveredKey ? [hoveredKey] : []);
    const radii = showLegend
        ? {
              targetOuter: 156,
              targetInner: compareHoldings ? 130 : 100,
              currentOuter: 124,
              currentInner: 100,
              hole: 94,
          }
        : {
              targetOuter: 142,
              targetInner: compareHoldings ? 118 : 90,
              currentOuter: 112,
              currentInner: 90,
              hole: 84,
          };

    const renderSegment = (
        segment: RingSegment,
        ring: 'target' | 'current',
    ) => {
        const active = hoveredMembers.includes(segment.slice.key);
        const muted = hoveredKey !== null && !active;
        const outerRadius =
            ring === 'target' ? radii.targetOuter : radii.currentOuter;
        const innerRadius =
            ring === 'target' ? radii.targetInner : radii.currentInner;
        return (
            <path
                key={`${ring}-${segment.slice.key}`}
                d={describeRingSegment(
                    outerRadius + (active ? 2 : 0),
                    innerRadius,
                    segment.startAngle,
                    segment.endAngle,
                )}
                fill={segment.slice.color}
                opacity={muted ? 0.3 : ring === 'target' ? 1 : 0.65}
                stroke="var(--background)"
                strokeWidth={3}
                className="cursor-default"
                data-ring={ring}
                data-asset-class={segment.slice.key}
                onMouseEnter={() => setHoveredKey(segment.slice.key)}
                onMouseLeave={() => setHoveredKey(null)}
            />
        );
    };

    return (
        <div
            className={
                showLegend
                    ? 'grid min-h-0 grid-cols-[minmax(0,140px)_minmax(100px,1fr)] items-center gap-[8px] pt-[4px]'
                    : 'min-h-0'
            }
        >
            <div
                className={
                    showLegend
                        ? 'relative aspect-square w-full max-w-[140px]'
                        : 'relative mx-auto aspect-square w-full max-w-[14.5rem]'
                }
            >
                <svg
                    className="h-full w-full overflow-visible"
                    viewBox="0 0 320 320"
                    role="img"
                    aria-label={compareHoldings ? 'Approved asset-class targets compared with current holdings' : 'Portfolio summary'}
                    style={{
                        transform:
                            'matrix3d(1, 0, 0, 0, 0, 1.04, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)',
                        marginTop: '3px',
                    }}
                >
                    <circle
                        cx={CENTER}
                        cy={CENTER}
                        r={(radii.targetOuter + radii.targetInner) / 2}
                        fill="none"
                        stroke="rgba(255,255,255,0.055)"
                        strokeWidth={radii.targetOuter - radii.targetInner}
                    />
                    {compareHoldings && <circle
                        cx={CENTER}
                        cy={CENTER}
                        r={(radii.currentOuter + radii.currentInner) / 2}
                        fill="none"
                        stroke="rgba(255,255,255,0.04)"
                        strokeWidth={radii.currentOuter - radii.currentInner}
                    />}
                    {model.hasTarget &&
                        targetSegments.map((segment) =>
                            renderSegment(segment, 'target'),
                        )}
                    {compareHoldings && model.hasCurrent &&
                        currentSegments.map((segment) =>
                            renderSegment(segment, 'current'),
                        )}
                    <circle
                        cx={CENTER}
                        cy={CENTER}
                        r={radii.hole}
                        fill="var(--card)"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth={1}
                    />
                    <text
                        x={CENTER}
                        y={CENTER - 20}
                        textAnchor="middle"
                        className={
                            showLegend
                                ? 'sleeve-pie-title fill-foreground text-[18px] font-normal uppercase'
                                : 'fill-foreground font-mono text-[13px] uppercase'
                        }
                    >
                        {activeItem
                            ? activeItem.label.slice(0, 18)
                            : 'No allocation'}
                    </text>
                    <text
                        x={CENTER}
                        y={CENTER + 8}
                        textAnchor="middle"
                        className={
                            showLegend
                                ? 'fill-foreground text-[32px] font-semibold'
                                : 'fill-foreground text-[25px] font-semibold'
                        }
                    >
                        {activeItem ? formatPct(model.hasTarget ? activeItem.targetPct : activeItem.currentPct) : '0.0%'}
                    </text>
                    {compareHoldings && <text
                        x={CENTER}
                        y={CENTER + 32}
                        textAnchor="middle"
                        className={
                            showLegend
                                ? 'sleeve-pie-value fill-muted-foreground text-[20px] font-mono'
                                : 'fill-muted-foreground font-mono text-[17px]'
                        }
                    >
                        {model.hasCurrent && activeItem ? (
                            <tspan style={{ fill: activeVarianceColor }}>
                                {model.hasTarget
                                    ? `${formatDrift(activeVariance)}%`
                                    : '—'}
                            </tspan>
                        ) : (
                            'current mix unavailable'
                        )}
                    </text>}
                </svg>
            </div>

            {showLegend && (
                <div className="grid min-w-0 content-start gap-[6px] pt-[6px]">
                    {legendItems.map((item) => {
                        const outsideThreshold =
                            Math.abs(item.driftPct) > driftThresholdPct;
                        const driftClass = !model.hasTarget
                            ? 'text-muted-foreground/45'
                            : !outsideThreshold
                              ? 'text-muted-foreground'
                              : item.driftPct > 0
                                ? 'text-warning'
                                : 'text-info';
                        return (
                            <button
                                type="button"
                                key={item.key}
                                className={`grid min-w-0 grid-cols-[8px_minmax(0,1fr)_36px] items-center gap-x-[4px] text-left text-[10.5px] leading-[14px] ${
                                    hoveredKey === item.key
                                        ? 'text-foreground'
                                        : 'text-foreground/90'
                                }`}
                                onMouseEnter={() => setHoveredKey(item.key)}
                                onMouseLeave={() => setHoveredKey(null)}
                                onFocus={() => setHoveredKey(item.key)}
                                onBlur={() => setHoveredKey(null)}
                            >
                                <span
                                    className="h-[8px] w-[8px] rounded-[1px]"
                                    style={{ backgroundColor: item.color }}
                                />
                                <span
                                    className="truncate font-medium"
                                    title={item.label}
                                >
                                    {item.label}
                                </span>
                                <span className="text-right font-mono text-foreground/90">
                                    {model.hasTarget || model.hasCurrent
                                        ? formatPct(model.hasTarget ? item.targetPct : item.currentPct)
                                        : '—'}
                                </span>
                                {compareHoldings && <span className="col-start-2 col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-[4px] font-mono text-[8px] leading-[10px] text-muted-foreground/75">
                                    <span>
                                        Held{' '}
                                        {model.hasCurrent
                                            ? formatPct(item.currentPct)
                                            : '—'}
                                    </span>
                                    <span className={driftClass}>
                                        {model.hasTarget && model.hasCurrent
                                            ? `${formatDrift(item.driftPct)}pp`
                                            : '—'}
                                    </span>
                                </span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
