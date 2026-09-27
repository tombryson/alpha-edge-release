'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    createChart,
    createSeriesMarkers,
    LineSeries,
    type IChartApi,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type LineData,
    type SeriesMarker,
    type Time,
} from 'lightweight-charts';
import type { PerformanceEvent, SecurityPerformancePoint } from '@/lib/api';
import { alertTypeLabel, canonicalAlertType } from '@/lib/alert-format';
import styles from './stock-table/history-workspace.module.css';

export type SecurityChartEvent = PerformanceEvent & {
    date: string;
    count: number;
    events: PerformanceEvent[];
};

interface SecurityPerformanceChartProps {
    points: SecurityPerformancePoint[];
    events: SecurityChartEvent[];
    showValue: boolean;
}

const audFormatter = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
});

const chartDate = (value: string) => String(value).slice(0, 10);
const chartTimeKey = (value: Time | string | null | undefined) => {
    if (value == null) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (typeof value === 'number') return String(value);
    if (
        typeof value === 'object' &&
        'year' in value &&
        'month' in value &&
        'day' in value
    ) {
        const month = String(value.month).padStart(2, '0');
        const day = String(value.day).padStart(2, '0');
        return `${value.year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
};

const metadataValue = (
    metadata: PerformanceEvent['metadata'] | undefined,
    key: string,
) => {
    const value = metadata?.[key];
    return typeof value === 'string' ? value.trim() : '';
};

const actionLabelFromValue = (value: string) => {
    return canonicalAlertType(value);
};

const actionDisplayLabel = (value: string) => alertTypeLabel(actionLabelFromValue(value));

const signalBaseActionLabel = (
    event?: Pick<PerformanceEvent, 'title' | 'metadata'>,
    fallbackAction?: string,
) => {
    return actionDisplayLabel(
        metadataValue(event?.metadata, 'alert_type') || fallbackAction || '',
    );
};

const signalStrength = (
    event?: Pick<PerformanceEvent, 'metadata'>,
) => metadataValue(event?.metadata, 'strength').toLowerCase();

const signalStrengthLabel = (
    event?: Pick<PerformanceEvent, 'metadata'>,
) => {
    const strength = signalStrength(event);
    if (!strength) return '';
    return strength.charAt(0).toUpperCase() + strength.slice(1);
};

const signalWindowLabel = (
    event?: Pick<PerformanceEvent, 'metadata'>,
) =>
    metadataValue(event?.metadata, 'timeframe')
        .toUpperCase()
        .replace(/\s+/g, '');

const ignoredDecisionInfo = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title' | 'metadata'>,
) => {
    if (event?.event_type !== 'decision_recorded') return null;
    const decision = metadataValue(event.metadata, 'decision').toUpperCase();
    const metadataAlertType = metadataValue(event.metadata, 'alert_type');
    const titleAlertType = String(event.title || '').match(/^(.+?)\s+ignored$/i)?.[1] || '';
    const alertType = signalBaseActionLabel(event, metadataAlertType || titleAlertType);
    if (decision === 'IGNORE' && alertType) {
        return { signal: alertType, outcome: 'Ignored' };
    }
    return null;
};

const eventActionLabel = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title' | 'metadata'>,
) => {
    if (
        event?.event_type !== 'signal_received' &&
        event?.event_type !== 'decision_recorded' &&
            event?.event_type !== 'signal_expired'
    ) {
        return '';
    }
    const ignoredInfo = ignoredDecisionInfo(event);
    if (ignoredInfo) return ignoredInfo.signal;
    const baseAction = String(event.title || '')
        .replace(/\s+(signal|decision|expired)$/i, '')
        .trim()
        .toUpperCase();
    return signalBaseActionLabel(event, baseAction);
};

const eventLabel = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title' | 'metadata'>,
) => {
    const action = eventActionLabel(event);
    if (event?.event_type === 'signal_expired' && action) return `${action} Expired`;
    if (action) return action;
    if (event?.event_type === 'q3_target_changed') return 'Q3';
    if (event?.event_type === 'q4_state_changed') return 'Q4';
    if (event?.event_type === 'statement_imported') return 'Statement';
    return (
        event?.title ||
        String(event?.event_type || 'event')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase())
    );
};

const eventTitle = (event?: Pick<PerformanceEvent, 'event_type' | 'title'>) =>
    event?.title ||
    String(event?.event_type || 'event')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

const eventDimension = (event?: Pick<PerformanceEvent, 'event_type'>) => {
    if (event?.event_type === 'signal_received') return 'Signal';
    if (event?.event_type === 'decision_recorded') return 'Decision';
    if (event?.event_type === 'signal_expired') return 'Expired';
    return 'Event';
};

const signalTone = (label: string) => {
    const normalized = canonicalAlertType(label);
    if (
        normalized === 'ADD' ||
        normalized === 'BUY' ||
        normalized === 'BREAKOUT'
    ) {
        return 'positive';
    }
    if (
        normalized === 'TRIM' ||
        normalized === 'SELL' ||
        normalized === 'SELL_50' ||
        normalized === 'SELL_DOWN'
    ) {
        return 'negative';
    }
    return 'neutral';
};

const eventColor = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title' | 'metadata'>,
) => {
    if (event?.event_type === 'signal_expired') return '#787676';
    const label = eventLabel(event);
    if (ignoredDecisionInfo(event)) return '#7a9cc6';
    const tone = signalTone(label);
    const strength = signalStrength(event);
    if (tone === 'positive') {
        return strength === 'weak' ? 'rgba(47,125,255,0.62)' : '#2f7dff';
    }
    if (tone === 'negative') {
        return strength === 'weak' ? 'rgba(217,70,239,0.62)' : '#d946ef';
    }
    if (label === 'Q4') return '#ef4444';
    if (label === 'Q3') return '#f59e0b';
    if (label === 'Statement') return '#787676';
    return '#7a9cc6';
};

const eventMarkerSize = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title' | 'metadata'>,
) => {
    if (event?.event_type === 'signal_expired') return 0.9;
    if (ignoredDecisionInfo(event)) return 0.95;
    const strength = signalStrength(event);
    if (strength === 'strong') return 1.45;
    if (strength === 'weak') return 0.95;
    return 1.2;
};

const eventShape = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title' | 'metadata'>,
) => {
    if (event?.event_type === 'signal_expired') return 'circle' as const;
    if (ignoredDecisionInfo(event)) return 'circle' as const;
    const tone = signalTone(eventLabel(event));
    if (tone === 'positive') return 'arrowUp' as const;
    if (tone === 'negative') return 'arrowDown' as const;
    return 'circle' as const;
};

const markerOffsetDirection = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title' | 'metadata'>,
) => {
    if (event?.event_type === 'signal_expired') return 0;
    if (ignoredDecisionInfo(event)) return 0;
    const tone = signalTone(eventLabel(event));
    if (tone === 'positive') return -1;
    if (tone === 'negative') return 1;
    return 0;
};

const markerPricePosition = (
    event?: Pick<PerformanceEvent, 'event_type' | 'title'>,
) => {
    const direction = markerOffsetDirection(event);
    if (direction < 0) return 'atPriceBottom' as const;
    if (direction > 0) return 'atPriceTop' as const;
    return 'atPriceMiddle' as const;
};

const primaryMarkerEvent = (group: SecurityChartEvent) => {
    const sourceEvents = group.events.length > 0 ? group.events : [group];
    return (
        sourceEvents.find((event) => event.event_type === 'signal_received') ||
        sourceEvents.find((event) => event.event_type !== 'decision_recorded') ||
        sourceEvents[0]
    );
};

const eventDisplayRows = (group: SecurityChartEvent) => {
    const rows = new Map<
        string,
        {
            id: string;
            color: string;
            dimension: string;
            label: string;
            title: string;
            showTitle: boolean;
            count: number;
        }
    >();
    const sourceEvents = group.events.length > 0 ? group.events : [group];
    const explicitSignals = new Set(
        sourceEvents
            .filter((event) => event.event_type === 'signal_received')
            .map((event) => eventActionLabel(event))
            .filter(Boolean),
    );
    const addRow = (row: {
        id: string;
        color: string;
        dimension: string;
        label: string;
        title: string;
        showTitle: boolean;
    }) => {
        const key = `${row.dimension}|${row.label}|${row.showTitle ? row.title : ''}`;
        const existing = rows.get(key);
        if (existing) {
            existing.count += 1;
            return;
        }
        rows.set(key, { ...row, count: 1 });
    };

    sourceEvents.forEach((event) => {
        const ignoredInfo = ignoredDecisionInfo(event);
        if (ignoredInfo) {
            if (!explicitSignals.has(ignoredInfo.signal)) {
                addRow({
                    id: `${event.id}:signal`,
                    color:
                        signalTone(ignoredInfo.signal) === 'negative'
                            ? '#d946ef'
                            : '#2f7dff',
                    dimension: 'Signal',
                    label: ignoredInfo.signal,
                    title: '',
                    showTitle: false,
                });
            }
            const strength = signalStrengthLabel(event);
            if (strength) {
                addRow({
                    id: `${event.id}:strength`,
                    color: eventColor(event),
                    dimension: 'Strength',
                    label: strength,
                    title: '',
                    showTitle: false,
                });
            }
            const windowLabel = signalWindowLabel(event);
            if (windowLabel) {
                addRow({
                    id: `${event.id}:window`,
                    color: '#787676',
                    dimension: 'Window',
                    label: windowLabel,
                    title: '',
                    showTitle: false,
                });
            }
            addRow({
                id: `${event.id}:outcome`,
                color: '#7a9cc6',
                dimension: 'Outcome',
                label: ignoredInfo.outcome,
                title: '',
                showTitle: false,
            });
            return;
        }

        const dimension = eventDimension(event);
        const label = eventLabel(event);
        const title = eventTitle(event);
        const showTitle =
            event.event_type !== 'signal_received' &&
            event.event_type !== 'decision_recorded';
        addRow({
            id: event.id,
            color: eventColor(event),
            dimension,
            label,
            title,
            showTitle,
        });
        if (
            event.event_type === 'signal_received' ||
            event.event_type === 'decision_recorded' ||
            event.event_type === 'signal_expired'
        ) {
            const strength = signalStrengthLabel(event);
            if (strength) {
                addRow({
                    id: `${event.id}:strength`,
                    color: eventColor(event),
                    dimension: 'Strength',
                    label: strength,
                    title: '',
                    showTitle: false,
                });
            }
            const windowLabel = signalWindowLabel(event);
            if (windowLabel) {
                addRow({
                    id: `${event.id}:window`,
                    color: '#787676',
                    dimension: 'Window',
                    label: windowLabel,
                    title: '',
                    showTitle: false,
                });
            }
        }
    });
    return Array.from(rows.values());
};

export function SecurityPerformanceChart({
    points,
    events,
    showValue,
}: SecurityPerformanceChartProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const priceSeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
    const valueSeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
    const markerApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const eventGroupsByDateRef = useRef<Map<string, SecurityChartEvent>>(new Map());
    const [focusedDate, setFocusedDate] = useState<string | null>(null);
    const [hoveredEvent, setHoveredEvent] = useState<{
        date: string;
        x: number;
        y: number;
    } | null>(null);

    const priceData = useMemo<LineData<Time>[]>(
        () =>
            points.map((point) => ({
                time: chartDate(point.observed_at) as Time,
                value: point.price,
            })),
        [points],
    );

    const valueData = useMemo<LineData<Time>[]>(
        () =>
            points.map((point) => ({
                time: chartDate(point.observed_at) as Time,
                value: point.market_value_aud,
            })),
        [points],
    );

    const eventGroupsByDate = useMemo(() => {
        const groups = new Map<string, SecurityChartEvent>();
        events.forEach((event) => {
            groups.set(chartDate(event.occurred_at), event);
        });
        return groups;
    }, [events]);

    useEffect(() => {
        eventGroupsByDateRef.current = eventGroupsByDate;
    }, [eventGroupsByDate]);

    const markers = useMemo<SeriesMarker<Time>[]>(
        () => {
            const prices = priceData.map((point) => point.value);
            const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
            const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
            const markerOffset = Math.max((maxPrice - minPrice) * 0.025, 0.01);
            const priceByDate = new Map(
                priceData.map((point) => [String(point.time), point.value]),
            );

            return events
                .map((group) => {
                    const markerEvent = primaryMarkerEvent(group);
                    const label = eventLabel(markerEvent);
                    const date = chartDate(group.occurred_at);
                    const price = priceByDate.get(date);
                    if (price == null) return null;
                    const direction = markerOffsetDirection(markerEvent);
                    return {
                        id: group.id,
                        time: date as Time,
                        position: markerPricePosition(markerEvent),
                        price: price + direction * markerOffset,
                        shape: eventShape(markerEvent),
                        color: eventColor(markerEvent),
                        text: label,
                        size: eventMarkerSize(markerEvent),
                    } satisfies SeriesMarker<Time>;
                })
                .filter(Boolean) as SeriesMarker<Time>[];
        },
        [events, priceData],
    );

    const focusedEventGroup =
        (focusedDate && eventGroupsByDate.get(focusedDate)) ||
        (events.length > 0 ? events[events.length - 1] : null);
    const hoveredEventGroup =
        hoveredEvent && eventGroupsByDate.get(hoveredEvent.date);
    const hoveredEventRows = hoveredEventGroup
        ? eventDisplayRows(hoveredEventGroup)
        : [];
    const focusedEventRows = focusedEventGroup
        ? eventDisplayRows(focusedEventGroup)
        : [];

    useEffect(() => {
        if (!containerRef.current || chartRef.current) return;

        const chart = createChart(containerRef.current, {
            autoSize: true,
            layout: {
                background: { color: '#0f1117' },
                textColor: '#a7a9b0',
            },
            grid: {
                vertLines: { color: 'rgba(120,118,118,0.12)' },
                horzLines: { color: 'rgba(120,118,118,0.16)' },
            },
            crosshair: {
                mode: 1,
                vertLine: {
                    color: 'rgba(244,185,66,0.35)',
                    style: 2,
                    labelBackgroundColor: '#20242c',
                },
                horzLine: {
                    color: 'rgba(244,185,66,0.28)',
                    style: 2,
                    labelBackgroundColor: '#20242c',
                },
            },
            rightPriceScale: {
                borderColor: 'rgba(120,118,118,0.25)',
                scaleMargins: { top: 0.08, bottom: 0.12 },
            },
            leftPriceScale: {
                visible: false,
                borderColor: 'rgba(120,118,118,0.25)',
                scaleMargins: { top: 0.12, bottom: 0.16 },
            },
            timeScale: {
                borderColor: 'rgba(120,118,118,0.25)',
                timeVisible: false,
                secondsVisible: false,
            },
            handleScroll: true,
            handleScale: true,
        });

        const priceSeries = chart.addSeries(LineSeries, {
            color: '#f4b942',
            lineWidth: 2,
            priceLineVisible: true,
            lastValueVisible: true,
        });
        const valueSeries = chart.addSeries(LineSeries, {
            color: '#5bc0be',
            lineWidth: 1,
            priceScaleId: 'left',
            priceLineVisible: false,
            lastValueVisible: false,
            visible: showValue,
        });

        // Canvas charts need resolved RGB colours, including themes expressed in OKLCH.
        const context = document.createElement('canvas').getContext('2d');
        const applyTheme = () => {
            if (!containerRef.current || !context) return;
            const css = getComputedStyle(containerRef.current);
            const rgb = (value: string, opacity = 1) => {
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = value;
                context.fillRect(0, 0, 1, 1);
                const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
                return `rgba(${r}, ${g}, ${b}, ${a / 255 * opacity})`;
            };
            const background = rgb(css.backgroundColor);
            const foreground = rgb(css.color);
            const rule = rgb(css.getPropertyValue('--workspace-rule') || css.getPropertyValue('--border'));
            const grid = rgb(css.getPropertyValue('--workspace-rule') || css.getPropertyValue('--border'), 0.45);
            const total = rgb(css.getPropertyValue('--info'));
            const price = rgb(css.getPropertyValue('--warning'));
            chart.applyOptions({
                layout: { background: { color: background }, textColor: foreground, fontSize: 12, fontFamily: 'system-ui, sans-serif' },
                grid: { vertLines: { color: grid }, horzLines: { color: grid } },
                crosshair: {
                    vertLine: { color: foreground, labelBackgroundColor: background },
                    horzLine: { color: foreground, labelBackgroundColor: background },
                },
                rightPriceScale: { borderColor: rule },
                leftPriceScale: { borderColor: rule },
                timeScale: { borderColor: rule },
            });
            priceSeries.applyOptions({ color: price });
            valueSeries.applyOptions({ color: total });
        };
        applyTheme();
        const themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

        chart.subscribeCrosshairMove((param) => {
            if (!param.time) {
                setHoveredEvent(null);
                return;
            }
            const date = chartTimeKey(param.time);
            setFocusedDate(date);
            const eventGroup = eventGroupsByDateRef.current.get(date);
            if (eventGroup && param.point) {
                setHoveredEvent({
                    date,
                    x: param.point.x,
                    y: param.point.y,
                });
            } else {
                setHoveredEvent(null);
            }
        });

        chartRef.current = chart;
        priceSeriesRef.current = priceSeries;
        valueSeriesRef.current = valueSeries;
        markerApiRef.current = createSeriesMarkers(priceSeries, [], {
            autoScale: true,
            zOrder: 'top',
        });

        return () => {
            themeObserver.disconnect();
            markerApiRef.current?.detach();
            chart.remove();
            chartRef.current = null;
            priceSeriesRef.current = null;
            valueSeriesRef.current = null;
            markerApiRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!priceSeriesRef.current || !valueSeriesRef.current || !chartRef.current) {
            return;
        }
        priceSeriesRef.current.setData(priceData);
        valueSeriesRef.current.setData(valueData);
        valueSeriesRef.current.applyOptions({
            visible: showValue,
            priceLineVisible: false,
            lastValueVisible: showValue,
        });
        chartRef.current.priceScale('left').applyOptions({ visible: showValue });
        markerApiRef.current?.setMarkers(markers);
        chartRef.current.timeScale().fitContent();
    }, [markers, priceData, showValue, valueData]);

    return (
        <div className={styles.stockChart}>
            <div ref={containerRef} className={`${styles.stockCanvas} min-h-0 flex-1`} data-testid="history-stock-canvas" />
            {hoveredEvent && hoveredEventGroup && (
                <div
                    className={`${styles.tooltip} pointer-events-none absolute z-20`}
                    style={{
                        left: hoveredEvent.x,
                        top: Math.max(8, hoveredEvent.y - 92),
                        transform:
                            hoveredEvent.x > 260
                                ? 'translateX(-100%)'
                                : 'translateX(12px)',
                    }}
                >
                    <div className={styles.secondary}>
                        {chartDate(hoveredEventGroup.occurred_at)}
                    </div>
                    {hoveredEventRows.map((event) => (
                        <div key={event.id} className="flex items-center gap-2">
                            <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: event.color }}
                            />
                            <span className="text-muted-foreground">
                                {event.dimension}:
                            </span>
                            <span className="font-semibold text-foreground">
                                {event.label}
                                {event.count > 1 && (
                                    <span className="ml-1 text-muted-foreground">
                                        x{event.count}
                                    </span>
                                )}
                            </span>
                            {event.showTitle && (
                                <span className="truncate text-muted-foreground">
                                    {event.title}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {focusedEventGroup && (
                <div className={styles.stockChartFooter}>
                    <div className={styles.legend}>
                        <span className={styles.secondary}>
                            {chartDate(focusedEventGroup.occurred_at)}
                        </span>
                        {focusedEventRows.map((event) => (
                            <span key={event.id} className="inline-flex items-center gap-1">
                                <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: event.color }}
                                />
                                <span className="text-muted-foreground">
                                    {event.dimension}:
                                </span>
                                <span className="font-semibold text-foreground">
                                    {event.label}
                                    {event.count > 1 && (
                                        <span className="ml-1 text-muted-foreground">
                                            x{event.count}
                                        </span>
                                    )}
                                </span>
                                {event.showTitle && (
                                    <span className="text-muted-foreground">
                                        {event.title}
                                    </span>
                                )}
                            </span>
                        ))}
                    </div>
                    {showValue && focusedEventGroup.value_aud != null && (
                        <div className="mt-1 text-muted-foreground">
                            Event value {audFormatter.format(focusedEventGroup.value_aud)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
