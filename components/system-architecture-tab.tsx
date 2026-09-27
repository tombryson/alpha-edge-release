'use client';
import { subscribePoll } from '@/lib/polling';

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import {
    ArrowUpRight,
    ChevronDown,
    ChevronRight,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck,
    X,
} from 'lucide-react';
import {
    api,
    type CommodityTheme,
    type CommodityThemeStatus,
    type PortfolioMixCurrentResponse,
    type PortfolioOverlaySummaryResponse,
    type SecurityPosition,
} from '@/lib/api';
import { useStore } from '@/lib/store';
import { isNonAllocatingSecurityType } from '@/lib/security-types';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import { getPortfolioAssetClassColor } from '@/components/stock-table/portfolio-visual-data';
import { useStockTableContext } from '@/components/stock-table/stock-table-context';
import styles from './system-architecture-tab.module.css';
import { DataFreshnessIndicator } from './data-freshness-indicator';
import { DATASET_LABELS, type Dataset } from '@/lib/data-freshness';
import { AssetClassIndex } from './asset-class-index';

type LoadState = {
    overlay: PortfolioOverlaySummaryResponse | null;
    mix: PortfolioMixCurrentResponse | null;
    themes: CommodityTheme[];
    positions: SecurityPosition[];
};
const sources = [
    'Portfolio risk',
    'Current allocation',
    'Market signals',
    'Position signals',
];
type Tone = 'positive' | 'negative' | 'warning' | 'neutral';

function tickerKey(value?: string | null): string {
    const raw = String(value || '')
        .trim()
        .toUpperCase();
    return (raw.split(':').pop() || raw).replace(/[^A-Z0-9._-]/g, '');
}
function formatPct(value?: number | null): string {
    return Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : '-';
}
function formatMoney(value?: number | null): string {
    return Number.isFinite(value)
        ? new Intl.NumberFormat('en-AU', {
              style: 'currency',
              currency: 'AUD',
              maximumFractionDigits: 0,
          }).format(Number(value))
        : '-';
}
function stageFor(theme: CommodityTheme, key: string) {
    return theme.stages.find(
        (stage) => stage.scope === 'THEME' && stage.key === key,
    );
}
function Signal({
    label,
    tone = 'neutral',
    title,
}: {
    label: string;
    tone?: Tone;
    title?: string;
}) {
    return (
        <span className={styles.signal} data-tone={tone} title={title}>
            <i aria-hidden="true" />
            {label}
        </span>
    );
}
function marketSignal(status?: CommodityThemeStatus): {
    label: string;
    tone: Tone;
} {
    switch (status) {
        case 'CONFIRMED':
            return { label: 'Bull', tone: 'positive' };
        case 'BLOCKED':
            return { label: 'Bear', tone: 'negative' };
        case 'PARTIAL':
            return { label: 'Partial', tone: 'warning' };
        case 'WAITING':
            return { label: 'Waiting', tone: 'warning' };
        default:
            return { label: 'No signal', tone: 'neutral' };
    }
}
function outperformSignal(status?: CommodityThemeStatus): {
    label: string;
    tone: Tone;
} {
    const state = marketSignal(status);
    if (status === 'CONFIRMED') return { ...state, label: 'Outperform' };
    if (status === 'BLOCKED') return { ...state, label: 'Underperform' };
    return state;
}
function classLabel(value?: string | null): string {
    return String(value || 'Unassigned')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function SectionHeading({
    step,
    title,
    detail,
    action,
    onOpen,
    expanded,
    onToggle,
    contentId,
}: {
    step: string;
    title: string;
    detail?: ReactNode;
    action: string;
    onOpen: () => void;
    expanded: boolean;
    onToggle: () => void;
    contentId: string;
}) {
    return (
        <div className={styles.sectionHeading}>
            <h2>
                <span className={styles.stepNumber}>{step}</span>
                <span>{title}</span>
            </h2>
            <button
                type="button"
                className={styles.iconButton}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
                title={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={onToggle}
            >
                {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </button>
            <span className={styles.sectionDetail}>{detail}</span>
            <button
                type="button"
                className={styles.iconButton}
                aria-label={action}
                title={action}
                onClick={onOpen}
            >
                <ArrowUpRight size={16} />
            </button>
        </div>
    );
}

export function SystemArchitectureTab() {
    const [view, setView] = useState<'flow' | 'classes'>('flow');
    const allStocks = useStore((state) => state.stocks);
    const { navigateToTab } = useStockTableContext();
    const [data, setData] = useState<LoadState>({
        overlay: null,
        mix: null,
        themes: [],
        positions: [],
    });
    const [loading, setLoading] = useState(true);
    const [failedSources, setFailedSources] = useState<string[]>([]);
    const [query, setQuery] = useState('');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
    const pendingSectionJump = useRef<string | null>(null);
    const mounted = useRef(false);
    const inFlight = useRef(false);
    const scrollArea = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setLoading(true);
        const results = await Promise.allSettled([
            api.getPortfolioOverlaySummary(),
            api.getCurrentPortfolioMix(),
            api.getCommodityThemes({ includeSecurities: true }),
            api.getSecurityPositions(),
        ]);
        inFlight.current = false;
        if (!mounted.current) return;
        const [overlay, mix, themes, positions] = results;
        setData((current) => ({
            overlay:
                overlay.status === 'fulfilled'
                    ? overlay.value
                    : current.overlay,
            mix: mix.status === 'fulfilled' ? mix.value : current.mix,
            themes:
                themes.status === 'fulfilled'
                    ? themes.value.themes || []
                    : current.themes,
            positions:
                positions.status === 'fulfilled'
                    ? positions.value || []
                    : current.positions,
        }));
        setFailedSources(
            results.flatMap((result, index) =>
                result.status === 'rejected' ? [sources[index]] : [],
            ),
        );
        setLoading(false);
    }, []);

    useEffect(() => {
        mounted.current = true;
        const stopPolling = subscribePoll(load, 30_000);
        return () => {
            mounted.current = false;
            stopPolling();
        };
    }, [load]);

    const q4Active =
        String(data.overlay?.portfolio_risk?.mode || '').toUpperCase() ===
            'Q4_CRISIS' || Boolean(data.overlay?.q4_crisis?.active);
    const q3Active =
        String(data.overlay?.portfolio_risk?.mode || '').toUpperCase() ===
        'Q3_THROTTLE';
    const q3Limit =
        data.overlay?.portfolio_risk?.inputs?.q3?.effective_target_pct ??
        data.overlay?.effective_equity_pct ??
        data.overlay?.portfolio_risk?.target_pct;
    const mixRows = useMemo(
        () =>
            (data.mix?.rows || [])
                .filter((row) => row.weight_pct > 0 || row.value > 0)
                .sort((a, b) => b.weight_pct - a.weight_pct),
        [data.mix],
    );

    const positionGroups = useMemo(() => {
        const states = new Map(
            data.positions.map((position) => [
                tickerKey(position.ticker),
                position,
            ]),
        );
        const evidence = new Map<
            string,
            { status?: CommodityThemeStatus; market: string }
        >();
        for (const theme of data.themes) {
            for (const security of theme.eligible_securities || []) {
                evidence.set(tickerKey(security.ticker), {
                    status: security.stage_states?.SECURITY_OUTPERFORM,
                    market: theme.display_name,
                });
            }
        }
        const positions = allStocks
            .filter(
                (stock) =>
                    !isNonAllocatingSecurityType(stock.securityType) &&
                    (stock.position > 0 || stock.positionValue > 0),
            )
            .map((stock) => ({
                stock,
                position: states.get(tickerKey(stock.symbol)),
                theme: evidence.get(tickerKey(stock.symbol)),
            }));
        const labels = new Map(
            (data.mix?.rows || []).map((row) => [
                normalizeAssetClassCode(row.asset_class),
                row.display_name,
            ]),
        );
        const groups = new Map<
            string,
            {
                code: string;
                label: string;
                value: number;
                positions: typeof positions;
            }
        >();
        for (const item of positions) {
            const code = normalizeAssetClassCode(item.stock.primaryAssetClass);
            const group = groups.get(code) || {
                code,
                label:
                    labels.get(code) ||
                    classLabel(item.stock.primaryAssetClass),
                value: 0,
                positions: [],
            };
            group.value += item.stock.positionValue || 0;
            group.positions.push(item);
            groups.set(code, group);
        }
        return [...groups.values()]
            .sort((a, b) => b.value - a.value)
            .map((group) => ({
                ...group,
                positions: group.positions.sort((a, b) =>
                    a.stock.name.localeCompare(b.stock.name),
                ),
            }));
    }, [allStocks, data.positions, data.themes, data.mix]);

    const heldCount = positionGroups.reduce(
        (sum, group) => sum + group.positions.length,
        0,
    );
    const search = query.trim().toLowerCase();
    const visibleGroups = positionGroups
        .map((group) => {
            const positions = group.positions.filter(
                ({ stock }) =>
                    !search ||
                    `${stock.name} ${stock.symbol} ${group.label}`
                        .toLowerCase()
                        .includes(search),
            );
            return {
                ...group,
                positions,
                value: positions.reduce(
                    (sum, item) => sum + (item.stock.positionValue || 0),
                    0,
                ),
            };
        })
        .filter((group) => group.positions.length > 0);
    const visibleCount = visibleGroups.reduce(
        (sum, group) => sum + group.positions.length,
        0,
    );
    useLayoutEffect(() => {
        const id = pendingSectionJump.current;
        if (!id) return;
        const section = scrollArea.current?.querySelector<HTMLElement>(
            `#system-${id}`,
        );
        section?.scrollIntoView({ block: 'start', behavior: 'instant' });
        section?.focus({ preventScroll: true });
        pendingSectionJump.current = null;
    }, [collapsedSections]);
    const jumpTo = (id: string) => {
        pendingSectionJump.current = id;
        setCollapsedSections((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
        });
    };
    const toggleSection = (id: string) =>
        setCollapsedSections((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const toggleGroup = (code: string) =>
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    const empty = (source: string, text: string) => (
        <p className={styles.empty}>
            {loading
                ? 'Loading...'
                : failedSources.includes(source)
                  ? `${source} unavailable`
                  : text}
        </p>
    );

    return (
        <div
            data-testid="system-architecture-tab"
            className={`terminal-workspace ${styles.root}`}
        >
            <header className={styles.header}>
                <div className={styles.headerIdentity}>
                    <h1>System</h1>
                    <div className={styles.viewOptions} role="group" aria-label="System view">
                        <button type="button" aria-pressed={view === 'flow'} onClick={() => setView('flow')}>Decision flow</button>
                        <button type="button" aria-pressed={view === 'classes'} onClick={() => setView('classes')}>Asset classes</button>
                    </div>
                </div>
                {view === 'flow' && <div className={styles.headerTools}>
                <DataFreshnessIndicator datasets={Object.keys(DATASET_LABELS) as Dataset[]} />
                <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Refresh architecture state"
                    title="Refresh architecture state"
                    disabled={loading}
                    onClick={() => void load()}
                >
                    <RefreshCw
                        size={16}
                        className={loading ? styles.spinning : undefined}
                    />
                </button>
                </div>}
            </header>
            {view === 'classes' ? <AssetClassIndex /> : <>
            <nav aria-label="System sections" className={styles.navigation}>
                <ol>
                    {[
                        ['risk', 'Risk'],
                        ['portfolio', 'Allocation'],
                        ['gates', 'Markets'],
                        ['positions', 'Positions'],
                    ].map(([id, title], index) => (
                        <li key={id}>
                            {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
                            <button type="button" aria-label={title} onClick={() => jumpTo(id)}>
                                <span className={styles.navStep} aria-hidden="true">
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                                {title}
                            </button>
                        </li>
                    ))}
                </ol>
            </nav>
            {failedSources.length > 0 && (
                <div role="status" className={styles.error}>
                    Could not refresh: {failedSources.join(', ')}. Previous
                    values are retained where available.
                </div>
            )}
            <div
                className={styles.scrollArea}
                ref={scrollArea}
                data-testid="system-scroll-area"
            >
                <section
                    id="system-risk"
                    tabIndex={-1}
                    data-testid="system-layer-risk"
                    className={styles.section}
                    data-collapsed={collapsedSections.has('risk')}
                >
                    <SectionHeading
                        step="01"
                        title="Portfolio risk"
                        expanded={!collapsedSections.has('risk')}
                        onToggle={() => toggleSection('risk')}
                        contentId="system-risk-content"
                        detail={
                            !data.overlay
                                ? 'Unavailable'
                                : q4Active
                                  ? 'Q4 governs'
                                  : q3Active
                                    ? 'Q3 governs'
                                    : 'Normal'
                        }
                        action="Open risk in Positions"
                        onOpen={() => navigateToTab('POSITIONS')}
                    />
                    <div id="system-risk-content" hidden={collapsedSections.has('risk')}>
                        <div className={styles.riskGrid}>
                            <button
                                type="button"
                                onClick={() => navigateToTab('POSITIONS')}
                                className={styles.riskControl}
                            >
                                <ShieldAlert
                                    size={20}
                                    className={styles.riskIcon}
                                />
                                <span className={styles.riskIdentity}>
                                    <strong>Q3</strong>
                                    <span>Equity exposure</span>
                                </span>
                                <span className={styles.riskState}>
                                    <Signal
                                        label={
                                            !data.overlay
                                                ? 'Unavailable'
                                                : q3Active
                                                  ? 'Throttle'
                                                  : 'Normal'
                                        }
                                        tone={
                                            data.overlay && q3Active
                                                ? 'warning'
                                                : 'neutral'
                                        }
                                    />
                                    <span>
                                        {data.overlay
                                            ? `Equity limit ${formatPct(q3Limit)}`
                                            : loading
                                              ? 'Loading risk state'
                                              : 'No risk state received'}
                                    </span>
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => navigateToTab('POSITIONS')}
                                className={styles.riskControl}
                            >
                                <ShieldCheck
                                    size={20}
                                    className={styles.riskIcon}
                                />
                                <span className={styles.riskIdentity}>
                                    <strong>Q4</strong>
                                    <span>Crisis overlay</span>
                                </span>
                                <span className={styles.riskState}>
                                    <Signal
                                        label={
                                            !data.overlay
                                                ? 'Unavailable'
                                                : q4Active
                                                  ? 'Crisis'
                                                  : 'Clear'
                                        }
                                        tone={
                                            data.overlay && q4Active
                                                ? 'negative'
                                                : 'neutral'
                                        }
                                    />
                                    <span>
                                        {!data.overlay
                                            ? loading
                                                ? 'Loading risk state'
                                                : 'No risk state received'
                                            : q4Active
                                              ? data.overlay.q4_crisis?.reason ||
                                                'Emergency overlay'
                                              : 'No active override'}
                                    </span>
                                </span>
                            </button>
                        </div>
                    </div>
                </section>
                <section
                    id="system-portfolio"
                    tabIndex={-1}
                    data-testid="system-layer-portfolio"
                    className={styles.section}
                    data-collapsed={collapsedSections.has('portfolio')}
                >
                    <SectionHeading
                        step="02"
                        title="Current allocation"
                        expanded={!collapsedSections.has('portfolio')}
                        onToggle={() => toggleSection('portfolio')}
                        contentId="system-portfolio-content"
                        detail={
                            data.mix
                                ? formatMoney(data.mix.total_value)
                                : undefined
                        }
                        action="Open Portfolio"
                        onOpen={() => navigateToTab('PORTFOLIO')}
                    />
                    <div id="system-portfolio-content" hidden={collapsedSections.has('portfolio')}>
                        {mixRows.length ? (
                            <>
                                <button
                                    type="button"
                                    className={styles.allocationBar}
                                    aria-label="Open current allocation in Portfolio"
                                    onClick={() => navigateToTab('PORTFOLIO')}
                                >
                                    {mixRows.map((row) => (
                                        <span
                                            key={row.asset_class}
                                            style={{
                                                width: `${row.weight_pct}%`,
                                                backgroundColor:
                                                    getPortfolioAssetClassColor(
                                                        row.asset_class,
                                                    ),
                                            }}
                                            title={`${row.display_name}: ${formatPct(row.weight_pct)}`}
                                        />
                                    ))}
                                </button>
                                <div className={styles.allocations}>
                                    {mixRows.map((row) => (
                                        <button
                                            key={row.asset_class}
                                            type="button"
                                            className={styles.allocationRow}
                                            onClick={() =>
                                                navigateToTab('PORTFOLIO')
                                            }
                                        >
                                            <i
                                                className={styles.swatch}
                                                style={{
                                                    backgroundColor:
                                                        getPortfolioAssetClassColor(
                                                            row.asset_class,
                                                        ),
                                                }}
                                                aria-hidden="true"
                                            />
                                            <span title={row.display_name}>
                                                {row.display_name}
                                            </span>
                                            <strong>
                                                {formatPct(row.weight_pct)}
                                            </strong>
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            empty('Current allocation', 'No current portfolio mix')
                        )}
                    </div>
                </section>
                <section
                    id="system-gates"
                    tabIndex={-1}
                    data-testid="system-layer-gates"
                    className={styles.section}
                    data-collapsed={collapsedSections.has('gates')}
                >
                    <SectionHeading
                        step="03"
                        title="Market signals"
                        expanded={!collapsedSections.has('gates')}
                        onToggle={() => toggleSection('gates')}
                        contentId="system-gates-content"
                        detail={`${data.themes.length} markets`}
                        action="Open Markets"
                        onOpen={() => navigateToTab('MARKETS')}
                    />
                    <div id="system-gates-content" hidden={collapsedSections.has('gates')}>
                        {data.themes.length ? (
                            <table
                                className={`${styles.table} ${styles.marketTable}`}
                                aria-label="Market signals"
                            >
                                <colgroup>
                                    <col />
                                    <col className={styles.marketSignalColumn} />
                                    <col className={styles.marketSignalColumn} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th scope="col">Market</th>
                                        <th scope="col">Commodity</th>
                                        <th scope="col">Equity</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.themes.map((theme) => {
                                        const commodity = stageFor(
                                            theme,
                                            'COMMODITY',
                                        );
                                        const equity = stageFor(
                                            theme,
                                            'EQUITY_RELATIVE',
                                        );
                                        const pair =
                                            equity?.source?.label || equity?.label;
                                        return (
                                            <tr
                                                key={theme.code}
                                                onClick={() =>
                                                    navigateToTab('MARKETS', {
                                                        marketCode: theme.code,
                                                    })
                                                }
                                            >
                                                <td>
                                                    <button
                                                        type="button"
                                                        className={
                                                            styles.identityButton
                                                        }
                                                        title={pair || undefined}
                                                    >
                                                        <i
                                                            className={
                                                                styles.swatch
                                                            }
                                                            style={{
                                                                backgroundColor:
                                                                    getPortfolioAssetClassColor(
                                                                        theme
                                                                            .equity_sleeve
                                                                            ?.asset_class_code ||
                                                                            theme
                                                                                .tactical
                                                                                ?.asset_class_code ||
                                                                            theme.code,
                                                                    ),
                                                            }}
                                                            aria-hidden="true"
                                                        />
                                                        <span>
                                                            <strong>
                                                                {theme.display_name}
                                                            </strong>
                                                        </span>
                                                    </button>
                                                </td>
                                                <td>
                                                    <Signal
                                                        {...marketSignal(
                                                            commodity?.status,
                                                        )}
                                                        title={commodity?.label}
                                                    />
                                                </td>
                                                <td>
                                                    <Signal
                                                        {...marketSignal(
                                                            equity?.status,
                                                        )}
                                                        title={equity?.label}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            empty('Market signals', 'No configured markets')
                        )}
                    </div>
                </section>
                <section
                    id="system-positions"
                    tabIndex={-1}
                    data-testid="system-layer-positions"
                    className={styles.section}
                    data-collapsed={collapsedSections.has('positions')}
                >
                    <SectionHeading
                        step="04"
                        title="Position signals"
                        expanded={!collapsedSections.has('positions')}
                        onToggle={() => toggleSection('positions')}
                        contentId="system-positions-content"
                        detail={`${heldCount} held`}
                        action="Open Positions"
                        onOpen={() => navigateToTab('POSITIONS')}
                    />
                    <div id="system-positions-content" hidden={collapsedSections.has('positions')}>
                        <div className={styles.positionTools}>
                            <div className={styles.search}>
                                <Search size={15} aria-hidden="true" />
                                <input
                                    aria-label="Search held positions"
                                    placeholder="Find a security or class..."
                                    value={query}
                                    onChange={(event) =>
                                        setQuery(event.target.value)
                                    }
                                />
                                {query && (
                                    <button
                                        type="button"
                                        className={styles.iconButton}
                                        aria-label="Clear search"
                                        onClick={() => setQuery('')}
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            {search && (
                                <span className={styles.sectionDetail}>
                                    {visibleCount} of {heldCount}
                                </span>
                            )}
                        </div>
                        {visibleGroups.length ? (
                            <table
                                className={`${styles.table} ${styles.positionTable}`}
                                aria-label="Held position signals"
                            >
                                <colgroup>
                                    <col />
                                    <col className={styles.valueColumn} />
                                    <col className={styles.trendColumn} />
                                    <col className={styles.relativeColumn} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th scope="col">Security</th>
                                        <th
                                            scope="col"
                                            className={styles.valueCell}
                                        >
                                            Held
                                        </th>
                                        <th scope="col">Trend</th>
                                        <th scope="col">Outperform</th>
                                    </tr>
                                </thead>
                                {visibleGroups.map((group) => {
                                    const isCollapsed =
                                        !search && collapsed.has(group.code);
                                    return (
                                        <tbody key={group.code}>
                                            <tr className={styles.groupRow}>
                                                <th scope="rowgroup" colSpan={4}>
                                                    <button
                                                        type="button"
                                                        aria-expanded={!isCollapsed}
                                                        onClick={() =>
                                                            toggleGroup(group.code)
                                                        }
                                                        disabled={Boolean(search)}
                                                        className={
                                                            styles.groupButton
                                                        }
                                                    >
                                                        {isCollapsed ? (
                                                            <ChevronRight
                                                                size={15}
                                                            />
                                                        ) : (
                                                            <ChevronDown
                                                                size={15}
                                                            />
                                                        )}
                                                        <i
                                                            className={
                                                                styles.swatch
                                                            }
                                                            style={{
                                                                backgroundColor:
                                                                    getPortfolioAssetClassColor(
                                                                        group.code,
                                                                    ),
                                                            }}
                                                            aria-hidden="true"
                                                        />
                                                        <span>{group.label}</span>
                                                        <small>
                                                            {group.positions.length}
                                                        </small>
                                                        <strong>
                                                            {formatMoney(
                                                                group.value,
                                                            )}
                                                        </strong>
                                                    </button>
                                                </th>
                                            </tr>
                                            {!isCollapsed &&
                                                group.positions.map(
                                                    ({
                                                        stock,
                                                        position,
                                                        theme,
                                                    }) => (
                                                        <tr
                                                            key={stock.id}
                                                            onClick={() =>
                                                                navigateToTab(
                                                                    'POSITIONS',
                                                                )
                                                            }
                                                        >
                                                            <td>
                                                                <button
                                                                    type="button"
                                                                    className={
                                                                        styles.identityButton
                                                                    }
                                                                    title={stock.symbol || 'Ticker missing'}
                                                                >
                                                                    <span>
                                                                        <strong>
                                                                            {stock.name ||
                                                                                stock.symbol ||
                                                                                'Unmapped security'}
                                                                        </strong>
                                                                        <span className={styles.mobileValue}>
                                                                            {formatMoney(stock.positionValue)}
                                                                        </span>
                                                                    </span>
                                                                </button>
                                                            </td>
                                                            <td
                                                                className={
                                                                    styles.valueCell
                                                                }
                                                            >
                                                                {formatMoney(
                                                                    stock.positionValue,
                                                                )}
                                                            </td>
                                                            <td>
                                                                <Signal
                                                                    label={
                                                                        position?.position_state ===
                                                                        'BUY'
                                                                            ? 'Buy'
                                                                            : position?.position_state ===
                                                                                'SELL'
                                                                              ? 'Sell'
                                                                              : 'No signal'
                                                                    }
                                                                    tone={
                                                                        position?.position_state ===
                                                                        'BUY'
                                                                            ? 'positive'
                                                                            : position?.position_state ===
                                                                                'SELL'
                                                                              ? 'negative'
                                                                              : 'neutral'
                                                                    }
                                                                />
                                                            </td>
                                                            <td>
                                                                {theme ? (
                                                                    <Signal
                                                                        {...outperformSignal(
                                                                            theme.status,
                                                                        )}
                                                                        title={
                                                                            theme.market
                                                                        }
                                                                    />
                                                                ) : (
                                                                    <span
                                                                        className={
                                                                            styles.notApplicable
                                                                        }
                                                                        title="No Outperform evidence assigned"
                                                                    >
                                                                        -
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ),
                                                )}
                                        </tbody>
                                    );
                                })}
                            </table>
                        ) : (
                            empty(
                                'Position signals',
                                search
                                    ? 'No matching held securities'
                                    : 'No current positions',
                            )
                        )}
                    </div>
                </section>
            </div>
            </>}
        </div>
    );
}
