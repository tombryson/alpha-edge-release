'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, ChartNoAxesCombined, ChevronLeft, ChevronRight, LayoutGrid, Rows3, Search, Type, X, ZoomIn } from 'lucide-react';
import { ResponsiveContainer, Treemap } from 'recharts';
import { assetClassColor } from '@/lib/asset-class-identity';
import { buildPositionsCapitalMap, capitalMapAxisTicks, capitalMapMatches, capitalMapPerformanceLevel, capitalMapShare, POSITIONS_MAP_COLOUR_KEY, POSITIONS_MAP_LAYOUT_KEY, type CapitalMapHolding, type PositionsMapLayout } from '@/lib/positions-capital-map';
import { openSecurityDetails } from '@/lib/security-navigation';
import styles from './positions-capital-map.module.css';

const moneyFormat = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const money = (value: number) => Number.isFinite(value) ? moneyFormat.format(value) : 'Unavailable';
const percent = (value: number | null) => value === null ? 'Unavailable' : value > 0 && value < 0.1 ? '<0.1%' : `${value.toFixed(1)}%`;
const performanceLabel = (value: number | null) => value === null ? 'P/L unavailable' : `P/L ${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const holdingColours = (holding: CapitalMapHolding): CSSProperties => {
    const level = capitalMapPerformanceLevel(holding.profitLossPercent) ?? 0;
    return {
        '--class-colour': assetClassColor(holding.classCode),
        '--performance-hue': level < 0 ? 0 : 135,
        '--performance-strength': Math.abs(level),
        '--performance-fill': level === 0 ? 'var(--background)' : undefined,
        '--map-ink': level === 0 ? 'var(--foreground)' : undefined,
    } as CSSProperties;
};

type TileProps = {
    x?: number; y?: number; width?: number; height?: number;
    depth?: number; holding?: CapitalMapHolding; code?: string;
    activeId: number | null;
    query: string;
    portfolioValue: number;
    performanceColours: boolean;
    onInspect: (holding: CapitalMapHolding) => void;
    onOpen: (holding: CapitalMapHolding) => void;
};

function CapitalTile({ x = 0, y = 0, width = 0, height = 0, holding, code, depth,
    activeId, query, portfolioValue, performanceColours, onInspect, onOpen }: TileProps) {
    const id = useId();
    if (!holding) return depth === 1 ? <rect x={x} y={y} width={width} height={height}
        fill={performanceColours ? 'var(--panel-bg-alt)' : assetClassColor(code)} fillOpacity={performanceColours ? 1 : 0.35} pointerEvents="none" /> : null;
    const large = width >= 180 && height >= 175;
    const medium = width >= 110 && height >= 84;
    const narrow = !medium && width >= 64 && height >= 90;
    const labelled = width >= 40 && height >= 26;
    const pct = percent(capitalMapShare(holding.value, portfolioValue));
    const fullLabel = `${holding.name}, ${holding.ticker || 'No ticker'}, ${holding.className}, ${money(holding.value)}, ${pct} of portfolio, ${performanceLabel(holding.profitLossPercent)}`;
    return <g role="button" tabIndex={0} aria-label={fullLabel}
        aria-describedby={id} data-map-holding={holding.id} data-value={holding.value}
        data-active={holding.id === activeId} data-dimmed={Boolean(query.trim()) && !capitalMapMatches(holding, query)}
        className={styles.tile} style={holdingColours(holding)}
        onMouseEnter={() => onInspect(holding)} onFocus={() => onInspect(holding)}
        onClick={() => onOpen(holding)}
        onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(holding); }
        }}>
        <title id={id}>{fullLabel}</title>
        <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, height - 2)} className={styles.tileSurface} />
        {labelled && <foreignObject x={x + 3} y={y + 3} width={Math.max(0, width - 6)} height={Math.max(0, height - 6)} pointerEvents="none">
            <div className={styles.tileContent} data-size={large ? 'large' : medium ? 'medium' : narrow ? 'narrow' : 'small'}>
                {large ? <>
                    <span className={styles.tileClass}>{holding.className}</span>
                    <span className={styles.tileName}>{holding.name}</span>
                    <span className={styles.tileTicker}>{holding.ticker}{holding.isETF ? ' · ETF' : ''}</span>
                    <div className={styles.tileAmounts}><strong>{pct}</strong><span>{money(holding.value)}</span></div>
                </> : <>
                    <span className={styles.tileShortTicker}>{holding.ticker.split(':').pop() || holding.name}</span>
                    {medium && <span className={styles.tileCompactName}>{holding.name}</span>}
                    {(medium || narrow) && <strong>{pct}</strong>}
                    {((medium && height >= 105) || narrow) && <span className={styles.tileMoney}>{money(holding.value)}</span>}
                </>}
            </div>
        </foreignObject>}
    </g>;
}

export function PositionsCapitalMap({ holdings, portfolioValue, loading, error, onSelect }: {
    holdings: CapitalMapHolding[];
    portfolioValue: number;
    loading: boolean;
    error: string | null;
    onSelect: (id: number) => void;
}) {
    const model = useMemo(() => buildPositionsCapitalMap(holdings), [holdings]);
    const [focusedCode, setFocusedCode] = useState<string | null>(null);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [query, setQuery] = useState('');
    const [layout, setLayout] = useState<PositionsMapLayout>('2d');
    const [performanceColours, setPerformanceColours] = useState(false);
    const [linearScale, setLinearScale] = useState(1);
    const [clipLabels, setClipLabels] = useState(true);
    const linearScrollRef = useRef<HTMLDivElement>(null);
    const scaleAnchor = useRef<number | null>(null);
    const changeScale = (next: number) => {
        if (linearScrollRef.current) scaleAnchor.current = linearScrollRef.current.scrollTop / linearScale;
        setLinearScale(Math.min(2, Math.max(1, next)));
    };
    useLayoutEffect(() => {
        if (scaleAnchor.current !== null && linearScrollRef.current) {
            linearScrollRef.current.scrollTop = scaleAnchor.current * linearScale;
            scaleAnchor.current = null;
        }
    }, [linearScale]);
    useEffect(() => {
        try {
            if (localStorage.getItem(POSITIONS_MAP_LAYOUT_KEY) === '1d') setLayout('1d');
            if (localStorage.getItem(POSITIONS_MAP_COLOUR_KEY) === 'performance') setPerformanceColours(true);
        } catch { /* A blocked preference must not prevent using the map. */ }
    }, []);
    const changeLayout = (next: PositionsMapLayout) => {
        setLayout(next);
        try { localStorage.setItem(POSITIONS_MAP_LAYOUT_KEY, next); } catch { /* Retain the choice for this session. */ }
    };
    const togglePerformanceColours = () => {
        const next = !performanceColours;
        setPerformanceColours(next);
        try { localStorage.setItem(POSITIONS_MAP_COLOUR_KEY, next ? 'performance' : 'class'); } catch { /* Retain the choice for this session. */ }
    };
    const searchRef = useRef<HTMLInputElement>(null);
    const focused = model.classes.find(group => group.code === focusedCode);
    const groups = focused ? [focused] : model.classes;
    const visible = focused ? focused.children : model.holdings;
    const matches = visible.filter(holding => capitalMapMatches(holding, query));
    const active = matches.find(holding => holding.id === activeId) || matches[0];
    const profitLossPercent = active?.profitLossPercent ?? null;
    const matchIndex = active ? matches.indexOf(active) : -1;
    useEffect(() => {
        if (linearScrollRef.current) linearScrollRef.current.scrollTop = 0;
    }, [focusedCode, layout]);
    // Search brings a small/off-screen row into view without moving the page or sidebars.
    useEffect(() => {
        const scroller = linearScrollRef.current;
        if (layout !== '1d' || !query.trim() || !active || !scroller) return;
        const row = scroller.querySelector<HTMLElement>(`[data-map-holding="${active.id}"]`);
        if (!row) return;
        const containerBounds = scroller.getBoundingClientRect();
        const rowBounds = row.getBoundingClientRect();
        if (rowBounds.height > containerBounds.height) scroller.scrollTop += rowBounds.top - containerBounds.top + (rowBounds.height - containerBounds.height) / 2;
        else if (rowBounds.top < containerBounds.top) scroller.scrollTop += rowBounds.top - containerBounds.top;
        else if (rowBounds.bottom > containerBounds.bottom) scroller.scrollTop += rowBounds.bottom - containerBounds.bottom;
    }, [active?.id, layout, query, linearScale]);
    const data = useMemo(() => (focused ? [focused] : model.classes).map(group => ({
        name: group.name, code: group.code,
        children: group.children.map(holding => ({ name: String(holding.id), value: holding.value, holding })),
    })), [focused, model.classes]);
    const open = (holding: CapitalMapHolding) => {
        setActiveId(holding.id);
        onSelect(holding.id);
        if (holding.ticker) openSecurityDetails({ ticker: holding.ticker, name: holding.name });
    };
    const focusClass = (code: string | null) => { setFocusedCode(code); setActiveId(null); setQuery(''); };
    const stepMatch = (step: number) => {
        if (matches.length) setActiveId(matches[(Math.max(0, matchIndex) + step + matches.length) % matches.length].id);
    };
    const visibleValue = focused?.value ?? model.total;
    const axisTicks = capitalMapAxisTicks(visibleValue, portfolioValue);

    return <section className={styles.map} aria-label="Positions capital map" data-testid="positions-capital-map" data-layout={layout} data-colour={performanceColours ? 'performance' : 'class'}>
        <header className={styles.header}>
            <div className={styles.heading}>
                {focused && <button type="button" className={styles.iconButton} aria-label="Show all asset classes" title="Show all asset classes" onClick={() => focusClass(null)}><ArrowLeft /></button>}
                <div><h2>{focused?.name || 'Capital map'}</h2><span>{visible.length} holdings · {money(visibleValue)} invested · {percent(capitalMapShare(visibleValue, portfolioValue))} of portfolio</span></div>
            </div>
            <div className={styles.searchTools}>
                <div className={styles.layoutControls} role="group" aria-label="Capital map layout">
                    {([{ value: '2d', label: '2D capital map', Icon: LayoutGrid }, { value: '1d', label: '1D capital map', Icon: Rows3 }] as const).map(({ value, label, Icon }) => (
                        <button type="button" key={value} title={label} aria-label={label} aria-pressed={layout === value} onClick={() => changeLayout(value)}>
                            <Icon aria-hidden="true" /><span>{value.toUpperCase()}</span>
                        </button>
                    ))}
                </div>
                <button type="button" className={`${styles.iconButton} ${styles.labelToggle}`}
                    aria-label="Colour by P/L" aria-pressed={performanceColours}
                    title={performanceColours ? 'Restore asset-class colours' : 'Colour by holding P/L: red -50%, neutral 0%, green +50%'}
                    onClick={togglePerformanceColours}><ChartNoAxesCombined aria-hidden="true" /></button>
                {layout === '1d' && <label className={styles.scaleControl} title="Scale capital-weighted rows">
                    <ZoomIn aria-hidden="true" />
                    <input type="range" min={1} max={2} step={0.1} value={linearScale}
                        aria-label="1D map scale" aria-valuetext={`${linearScale} times`}
                        onChange={event => changeScale(Number(event.target.value))} />
                    <span aria-hidden="true">{linearScale}x</span>
                </label>}
                {layout === '1d' && <button type="button" className={`${styles.iconButton} ${styles.labelToggle}`}
                    aria-label="Clip row labels" aria-pressed={clipLabels}
                    title={clipLabels ? 'Hide labels that do not fit' : 'Show clipped labels in thin rows'}
                    onClick={() => setClipLabels(current => !current)}><Type aria-hidden="true" /></button>}
                <label className={styles.search}><Search aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Find a holding" placeholder="Find a holding" value={query}
                    onChange={event => { setQuery(event.target.value); setActiveId(null); }}
                    onKeyDown={event => {
                        if (event.key === 'Escape') setQuery('');
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); stepMatch(event.key === 'ArrowDown' ? 1 : -1); }
                        if (event.key === 'Enter' && active) open(active);
                    }} />
                    {query && <button type="button" aria-label="Clear holding search" title="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X /></button>}
                </label>
                {query && <div className={styles.searchMatches}>
                    <span role="status">{matchIndex + 1} / {matches.length}</span>
                    <button type="button" className={styles.iconButton} aria-label="Previous matching holding" title="Previous match" disabled={matches.length < 2} onClick={() => stepMatch(-1)}><ChevronLeft /></button>
                    <button type="button" className={styles.iconButton} aria-label="Next matching holding" title="Next match" disabled={matches.length < 2} onClick={() => stepMatch(1)}><ChevronRight /></button>
                </div>}
            </div>
        </header>
        {error && <p className={styles.notice} role="alert">{error}.{model.holdings.length ? ' Last loaded values shown.' : ''}</p>}
        <div className={`${styles.chart} ${layout === '1d' ? styles.linearChart : ''}`} data-testid="positions-capital-map-chart" ref={linearScrollRef}>
            {model.holdings.length ? layout === '1d' ? <div className={`${styles.linearRows} ${axisTicks.length ? styles.withAxis : ''}`} aria-label="Capital-weighted position rows" data-clip-labels={clipLabels} style={{ '--capital-scale': linearScale } as CSSProperties}>
                {axisTicks.length > 0 && <div className={styles.linearAxis} role="img" aria-label="Cumulative share of total portfolio" title="Cumulative % of total portfolio">
                    {axisTicks.map(tick => <span key={tick.percentage} className={styles.axisTick}
                        data-percentage={tick.percentage}
                        data-edge={tick.offset === 0 ? 'start' : tick.offset >= 1 ? 'end' : undefined}
                        style={{ top: `${tick.offset * 100}%` }}>
                        <span>{tick.percentage.toLocaleString('en-AU', { maximumFractionDigits: 10 })}%</span>
                    </span>)}
                </div>}
                {visible.map(holding => <button type="button" key={holding.id}
                    className={styles.linearRow} style={{ ...holdingColours(holding), '--capital-share': holding.value / visibleValue } as CSSProperties}
                    data-map-holding={holding.id} data-value={holding.value} data-active={holding.id === active?.id}
                    data-dimmed={Boolean(query.trim()) && !capitalMapMatches(holding, query)}
                    aria-label={`${holding.name}, ${holding.ticker || 'No ticker'}, ${holding.className}, ${money(holding.value)}, ${percent(capitalMapShare(holding.value, portfolioValue))} of portfolio, ${performanceLabel(holding.profitLossPercent)}`}
                    title={`${holding.name} · ${holding.ticker || 'No ticker'} · ${holding.className} · ${money(holding.value)} · ${percent(capitalMapShare(holding.value, portfolioValue))} · ${performanceLabel(holding.profitLossPercent)}`}
                    onMouseEnter={() => { if (capitalMapMatches(holding, query)) setActiveId(holding.id); }}
                    onFocus={() => { if (capitalMapMatches(holding, query)) setActiveId(holding.id); }} onClick={() => open(holding)}>
                    <span className={styles.linearIdentity}><span className={styles.linearName}>{holding.name}</span><span className={styles.linearTicker}>{holding.ticker}{holding.isETF ? ' · ETF' : ''}</span></span>
                    <span className={styles.linearValue}>{money(holding.value)}</span>
                    <strong className={styles.linearShare}>{percent(capitalMapShare(holding.value, portfolioValue))}</strong>
                </button>)}
            </div> : <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <Treemap data={data} dataKey="value" nameKey="name" type="flat" aspectRatio={1.4}
                    isAnimationActive={false} isUpdateAnimationActive={false}
                    content={<CapitalTile activeId={active?.id ?? null} query={query} portfolioValue={portfolioValue} performanceColours={performanceColours}
                        onInspect={holding => { if (capitalMapMatches(holding, query)) setActiveId(holding.id); }} onOpen={open} />} />
            </ResponsiveContainer> : <div className={styles.empty} role="status">{loading ? 'Loading holdings...' : 'No positive-value holdings to display.'}</div>}
        </div>
        <div className={styles.inspector} aria-label="Holding allocation details">
            {active ? <>
                <div className={styles.selectedName}>
                    <button type="button" disabled={!active.ticker} onClick={() => open(active)} aria-label={`Open ${active.name} details`}>
                        <span>{active.name}</span>{active.ticker && <ArrowUpRight aria-hidden="true" />}
                    </button>
                    <div><span>{active.ticker || 'No ticker'}{active.isETF ? ' · ETF' : ''}</span>
                        <button type="button" aria-label={`Focus ${active.className} from holding`} onClick={() => focusClass(active.classCode)}><i style={{ background: assetClassColor(active.classCode) }} aria-hidden="true" />{active.className}<ZoomIn aria-hidden="true" /></button>
                    </div>
                </div>
                <dl className={styles.amounts}>
                    <div><dt>Held</dt><dd>{money(active.value)}</dd></div>
                    <div><dt>Portfolio</dt><dd>{percent(capitalMapShare(active.value, portfolioValue))}</dd></div>
                    <div><dt>Asset class</dt><dd>{percent(capitalMapShare(active.value, groups.find(group => group.code === active.classCode)?.value || 0))}</dd></div>
                    <div><dt>P/L %</dt><dd className={profitLossPercent === null || profitLossPercent === 0 ? styles.neutral : profitLossPercent > 0 ? styles.positive : styles.negative} title="Broker-reported holding P/L">
                        {profitLossPercent === null ? '—' : `${profitLossPercent > 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%`}
                    </dd></div>
                    <div><dt>Trend</dt><dd className={`${styles.trendValue} ${active.trend === 'BUY' ? styles.positive : active.trend === 'SELL' ? styles.negative : styles.neutral}`}>
                        {active.trend === 'BUY' ? <><ArrowUp aria-hidden="true" />Buy</> : active.trend === 'SELL' ? <><ArrowDown aria-hidden="true" />Sell</> : '—'}
                    </dd></div>
                </dl>
            </> : <p className={styles.noMatch}>{query ? 'No matching holdings in this view.' : 'No holding selected.'}</p>}
        </div>
        {model.unplotted.length > 0 && <Popover.Root><Popover.Trigger asChild>
            <button type="button" className={styles.unplottedTrigger}>{model.unplotted.length} without positive value</button>
        </Popover.Trigger><Popover.Portal><Popover.Content className={styles.unplotted} align="start" side="top" collisionPadding={12} sideOffset={8} aria-label="Holdings without positive value">
            <h3>Not plotted</h3>
            {model.unplotted.map(holding => <button type="button" key={holding.id} disabled={!holding.ticker} onClick={() => open(holding)}><span>{holding.name}</span><strong>{money(holding.value)}</strong></button>)}
        </Popover.Content></Popover.Portal></Popover.Root>}
    </section>;
}
