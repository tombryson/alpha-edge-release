'use client';

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
    buildPortfolioRadialModel,
    radialPoint,
    radialSegments,
    radialOutline,
    radialSelectedIndex,
    spaceRadialLabels,
    wrapRadialLabel,
    type PortfolioRadialDatum,
} from '@/lib/portfolio-radial';
import styles from './portfolio-radial-chart.module.css';

function percent(value: number | null) {
    return value === null ? 'Unavailable' : `${value.toFixed(1)}%`;
}

export function PortfolioRadialChart({ rows: input, showTarget, stale, approvedLabel, comparison, compareHoldings = true }: {
    rows: PortfolioRadialDatum[];
    showTarget: boolean;
    stale: boolean;
    approvedLabel?: string;
    compareHoldings?: boolean;
    comparison?: { fromLabel: string; toLabel: string; peaks: Record<string, number>; incompleteCodes: string[] };
}) {
    const [majorClassesOnly, setMajorClassesOnly] = useState(false);
    const model = useMemo(() => buildPortfolioRadialModel(input, majorClassesOnly ? 2 : null, comparison?.peaks, comparison?.incompleteCodes), [input, majorClassesOnly, comparison?.peaks, comparison?.incompleteCodes]);
    const { rows, scaleMax, ticks } = model;
    const container = useRef<HTMLDivElement>(null);
    const measureLabel = useRef<(text: string) => number>(text => text.length * 7);
    const [width, setWidth] = useState(0);
    const [availableHeight, setAvailableHeight] = useState(600);
    const [selectedCode, setSelectedCode] = useState<string | null>(null);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const id = useId().replace(/:/g, '');

    useEffect(() => {
        const element = container.current;
        if (!element) return;
        const context = document.createElement('canvas').getContext('2d');
        if (context) {
            context.font = `400 13px ${getComputedStyle(element).fontFamily}`;
            measureLabel.current = text => context.measureText(text).width;
        }
        const scrollArea = element.closest<HTMLElement>('[data-portfolio-scroll]') ?? element.parentElement?.parentElement;
        const observer = new ResizeObserver(() => {
            setWidth(Math.floor(element.getBoundingClientRect().width));
            if (scrollArea) setAvailableHeight(scrollArea.clientHeight);
        });
        observer.observe(element);
        if (scrollArea) observer.observe(scrollArea);
        return () => observer.disconnect();
    }, [stale]);

    const plotWidth = Math.min(width, 1100);
    const labelWidth = Math.max(70, Math.min(150, plotWidth * 0.22));
    const labelContent = rows.map((row, index) => {
        const direction = radialPoint(index, rows.length, 1, 0, 0);
        const side = Math.abs(direction.x) < 0.001 ? 0 : direction.x > 0 ? 1 : -1;
        const lines = wrapRadialLabel(row.name, labelWidth, measureLabel.current);
        return { index, side, lines, height: lines.length * 16, width: Math.max(0, ...lines.map(measureLabel.current)) };
    });
    const leftLabels = labelContent.filter(label => label.side < 0);
    const rightLabels = labelContent.filter(label => label.side > 0);
    const leftSpace = Math.max(0, ...leftLabels.map(label => label.width)) + 24;
    const rightSpace = Math.max(0, ...rightLabels.map(label => label.width)) + 24;
    const labelStackHeight = Math.max(...[leftLabels, rightLabels].map(side =>
        side.reduce((sum, label) => sum + label.height + 6, 0) + 24,
    ));
    const endLabelHeight = Math.max(16, ...labelContent.filter(label => label.side === 0).map(label => label.height));
    const height = Math.max(340, Math.min(580, availableHeight - 150), labelStackHeight);
    const radius = Math.max(1, Math.min((height - endLabelHeight * 2 - 64) / 2, (plotWidth - leftSpace - rightSpace) / 2));
    const tickStride = Math.max(1, Math.ceil(28 / (radius / ticks.length)));
    const labelledTicks = ticks.filter((_, index) => (ticks.length - 1 - index) % tickStride === 0);
    const cx = leftSpace + (plotWidth - leftSpace - rightSpace) / 2;
    const cy = height / 2;
    const targetVisible = showTarget;
    const approvedFirst = targetVisible && !comparison;
    const secondaryVisible = targetVisible && (!approvedFirst || compareHoldings);
    const primaryWeight = (row: PortfolioRadialDatum) => (approvedFirst ? row.target : row.current) ?? 0;
    const largestIndex = rows.reduce((best, row, index) => primaryWeight(row) > primaryWeight(rows[best]) ? index : best, 0);
    const selectedIndex = rows.findIndex(row => row.code === selectedCode);
    const pinnedIndex = selectedIndex < 0 ? largestIndex : selectedIndex;
    const activeIndex = hoverIndex !== null && rows[hoverIndex] ? hoverIndex : pinnedIndex;
    const active = rows[activeIndex];
    const difference = active && active.current !== null && active.target !== null
        ? active.current - active.target : null;
    const point = (index: number, value: number) => radialPoint(index, rows.length, radius * value / scaleMax, cx, cy);
    const currentPoints = rows.map((row, index) => row.current === null ? null : point(index, row.current));
    const targetPoints = rows.map((row, index) => row.target === null ? null : point(index, row.target));
    const primaryPoints = approvedFirst ? targetPoints : currentPoints;
    const secondaryPoints = approvedFirst ? currentPoints : targetPoints;
    const primarySegments = radialSegments(rows.map(row => approvedFirst ? row.target : row.current));
    const labels = labelContent.map(label => {
        const end = radialPoint(label.index, rows.length, radius + 24, cx, cy);
        return { ...label, x: label.side === 0 ? end.x : cx + label.side * (radius + 16), y: end.y };
    });
    for (const side of [-1, 1]) {
        for (const spaced of spaceRadialLabels(labels.filter(label => label.side === side), 12, height - 12)) {
            labels[spaced.index].y = spaced.y;
        }
    }

    function pointerIndex(event: PointerEvent<SVGSVGElement>) {
        const bounds = event.currentTarget.getBoundingClientRect();
        return radialSelectedIndex(
            (event.clientX - bounds.left) * plotWidth / bounds.width - cx,
            (event.clientY - bounds.top) * height / bounds.height - cy,
            rows.length,
        );
    }

    return (
        <section className={styles.root} aria-label={comparison ? 'Radial approved shape comparison' : 'Radial portfolio shape'}>
            <div className={styles.legend}>
                {approvedFirst ? <>
                    <span><i className={styles.heldKey} />{approvedLabel || 'Approved'}{!model.completeTarget && ' (partial)'}</span>
                    {secondaryVisible && <span><i className={styles.targetKey} />Held</span>}
                </> : <>
                    <span><i className={styles.heldKey} />{comparison?.toLabel || 'Held'}</span>
                    {targetVisible && <span><i className={styles.targetKey} />{comparison?.fromLabel || approvedLabel || 'Approved'}{!model.completeTarget && ' (partial)'}</span>}
                </>}
                <label className={styles.filter} title={comparison ? 'Above 2% in any loaded approved shape. Axes stay fixed while stepping through dates.' : 'Held or approved allocation above 2%. Unavailable holdings remain visible.'}>
                    <input type="checkbox" checked={majorClassesOnly} disabled={stale} onChange={event => { setMajorClassesOnly(event.target.checked); setHoverIndex(null); }} />
                    <span>&gt;2% classes</span>
                </label>
            </div>
            <div className={styles.chartMeta}>
                <span>Share of portfolio (%)</span>
                {majorClassesOnly && !stale && <span role="status">{rows.length} of {model.totalClasses} classes{secondaryVisible && <> · {model.heldCoverage === null ? 'Coverage unavailable' : `${model.heldCoverage.toFixed(1)}% ${comparison ? 'of To shape' : 'of portfolio held'}`}</>}</span>}
            </div>
            {stale && secondaryVisible && <div className={styles.unavailable} role="status">Current holdings unavailable or out of date. Saved approved weights remain visible.</div>}
            {(
                <div ref={container} className={styles.plot}>
                    {rows.length === 0 && <div className={styles.unavailable} role="status">{comparison ? 'No asset classes above 2% in the loaded approvals.' : 'No asset classes above 2% in the held or approved shape.'}</div>}
                    {width > 0 && rows.length > 0 && (
                        <svg
                            width={plotWidth}
                            height={height}
                            viewBox={`0 0 ${plotWidth} ${height}`}
                            role="img"
                            aria-labelledby={`${id}-title ${id}-description`}
                            onPointerMove={event => {
                                if (event.pointerType === 'mouse') setHoverIndex(pointerIndex(event));
                            }}
                            onPointerLeave={() => setHoverIndex(null)}
                            onPointerUp={event => {
                                const index = pointerIndex(event);
                                if (index !== null) setSelectedCode(rows[index].code);
                            }}
                        >
                            <title id={`${id}-title`}>Portfolio weights by asset class</title>
                            <desc id={`${id}-description`}>Linear radius, zero to {scaleMax} percent of the whole portfolio. {comparison ? 'Shaded colours are the later approved allocations; the dashed outline is the earlier approved shape.' : approvedFirst ? `Shaded colours are approved allocations.${secondaryVisible ? ' The dashed outline is current holdings.' : ''}` : 'Shaded colours are held allocations.'}{majorClassesOnly ? ` Filtered to classes above two percent in ${comparison ? 'the loaded approved archive' : 'held or approved weights'}; unavailable allocations remain visible. Weights are not renormalized.` : ''} Exact values for displayed classes are available in the selector below.</desc>
                            {ticks.map(tick => <circle key={tick} cx={cx} cy={cy} r={radius * tick / scaleMax} className={styles.grid} />)}
                            {rows.map((row, index) => {
                                const end = radialPoint(index, rows.length, radius, cx, cy);
                                return <line key={row.code} x1={cx} y1={cy} x2={end.x} y2={end.y} className={styles.axis} />;
                            })}
                            {targetVisible && !approvedFirst && model.completeTarget && rows.length >= 3 && (
                                <polygon points={targetPoints.map(p => `${p!.x},${p!.y}`).join(' ')} className={styles.targetFill} />
                            )}
                            {rows.length >= 3 && primarySegments.map(({ from, to }) => {
                                const a = primaryPoints[from]!;
                                const b = primaryPoints[to]!;
                                return (
                                    <polygon key={from} points={`${cx},${cy} ${a.x},${a.y} ${b.x},${b.y}`} fill={rows[from].color} className={styles.heldFill} />
                                );
                            })}
                            <path d={radialOutline(primaryPoints)} className={styles.heldLine} />
                            {secondaryVisible && <path d={radialOutline(secondaryPoints)} className={styles.targetLine} />}
                            {labelledTicks.map(tick => {
                                const label = radialPoint(Math.floor(rows.length / 8) + 0.5, rows.length, radius * tick / scaleMax, cx, cy);
                                return <text key={tick} x={label.x} y={label.y - 6} textAnchor="middle" className={styles.tick}>{tick}%</text>;
                            })}
                            {rows.map((row, index) => {
                                const p = primaryPoints[index];
                                const t = secondaryPoints[index];
                                const label = labels[index];
                                const textAnchor = label.side === 0 ? 'middle' : label.side > 0 ? 'start' : 'end';
                                const end = radialPoint(index, rows.length, radius + 4, cx, cy);
                                return (
                                    <g
                                        key={row.code}
                                        onPointerMove={event => {
                                            event.stopPropagation();
                                            if (event.pointerType === 'mouse') setHoverIndex(index);
                                        }}
                                        onPointerUp={event => {
                                            event.stopPropagation();
                                            setSelectedCode(row.code);
                                        }}
                                    >
                                        {p && <circle cx={p.x} cy={p.y} r={activeIndex === index ? 3 : 1.8} fill={row.color} className={styles.heldDot} />}
                                        {secondaryVisible && t && activeIndex === index && <circle cx={t.x} cy={t.y} r={3.5} className={styles.targetDot} />}
                                        {activeIndex === index && <line x1={cx} y1={cy} x2={end.x} y2={end.y} className={styles.activeAxis} />}
                                        {label.side !== 0 && <path d={`M ${end.x} ${end.y} L ${label.x - label.side * 8} ${label.y}`} className={styles.axis} />}
                                        <text x={label.x} y={label.y - (label.lines.length - 1) * 8} textAnchor={textAnchor} dominantBaseline="middle" aria-label={row.name} className={styles.label}>
                                            {label.lines.map((line, i) => <tspan x={label.x} dy={i === 0 ? 0 : 16} key={i}>{line}</tspan>)}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                    )}
                </div>
            )}
            {active && (
                <div className={styles.inspector}>
                    <label className={styles.classSelect}>
                        <span>Asset class</span>
                        <select aria-label="Radial asset class" value={rows[pinnedIndex].code} onChange={event => { setSelectedCode(event.target.value); setHoverIndex(null); }}>
                            {rows.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
                        </select>
                    </label>
                    <div className={styles.readout} aria-live={hoverIndex === null ? 'polite' : 'off'}>
                        <span className={styles.selectedName}><i style={{ background: active.color }} />{active.name}</span>
                        <div className={styles.values}>
                            {comparison && targetVisible && <span>From<strong>{percent(active.target)}</strong></span>}
                            {approvedFirst && <span>Approved<strong>{active.target === null ? 'Not set' : percent(active.target)}</strong></span>}
                            {(!approvedFirst || secondaryVisible) && <span>{comparison ? 'To' : 'Held'}<strong>{stale ? 'Unavailable' : percent(active.current)}</strong></span>}
                            {secondaryVisible && <>
                                <span>{comparison ? 'Change' : 'Difference'}<strong>{difference === null ? 'Unavailable' : `${Math.abs(difference) < 0.05 ? '' : difference > 0 ? '+' : '-'}${Math.abs(difference).toFixed(1)}pp`}</strong></span>
                            </>}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
