'use client';
import { subscribePoll } from '@/lib/polling';
import { DataFreshnessIndicator } from '@/components/data-freshness-indicator';
import detailStyles from './commodity-market-detail.module.css';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, ChevronLeft, LoaderCircle, Pencil, Plug, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import {
    api,
    type AssetClass,
    type CommodityTheme,
    type CommodityThemeConfigurationPayload,
    type CommodityThemeFund,
    type CommodityThemeSecurity,
    type CommodityThemeSource,
    type CommodityThemeStage,
    type CommodityThemeStatus,
} from '@/lib/api';
import {
    currentTerminalRouteState,
    pushTerminalRoute,
    readTerminalRoute,
    replaceTerminalRoute,
} from '@/lib/terminal-route';
import { useStockTableContext } from '@/components/stock-table/stock-table-context';
import { assetClassColor } from '@/lib/asset-class-identity';
import { mountTradingViewEmbed } from '@/lib/tradingview-embed';

type ThemeDetails = Record<string, CommodityTheme>;

type ThemeSetupStep = {
    label: string;
    detail: string;
    tone: string;
    opensAlerts: boolean;
};

type MarketConfigurationDraft = {
    code: string;
    displayName: string;
    marketGroup: string;
    strategicFloorAssetClassCode: string;
    tacticalAssetClassCode: string;
    commodityLabel: string;
    commoditySymbol: string;
    equityLabel: string;
    equityNumerator: string;
    equityDenominator: string;
    directExpression: {
        available: boolean;
        instrumentLabel: string;
        instrumentTicker: string;
        instrumentKind: string;
    };
};

const directVehicleKinds = ['SPOT', 'CFD', 'FUTURE', 'ETF', 'OTHER'];

const marketTextStrong = 'text-[color:var(--analysis-text-strong)]';
const marketTextMuted = 'text-[color:var(--analysis-ticker-text)]';
const marketTextFaint = 'text-[color:var(--analysis-ticker-text)] opacity-75';
const marketFormLabel = `text-[10px] font-semibold uppercase tracking-[0.1em] ${marketTextStrong}`;
const marketFormInput = `mt-[7px] h-[34px] w-full border border-border/60 bg-background/75 px-[10px] text-[12px] font-medium ${marketTextStrong} outline-none transition-colors placeholder:text-[color:var(--analysis-ticker-text)] placeholder:font-normal placeholder:opacity-40 focus:border-[color:var(--analysis-text-strong)]/70 focus:bg-background`;
const marketFormStaticValue = `mt-[7px] flex h-[34px] items-center border border-border/35 bg-muted/[0.045] px-[10px] text-[11px] font-medium ${marketTextStrong}`;
const marketFormSelect = `mt-[7px] h-[34px] w-full border border-border/60 bg-background/75 px-[10px] text-[11px] font-medium ${marketTextStrong} outline-none transition-colors focus:border-[color:var(--analysis-text-strong)]/70 focus:bg-background`;

const themeGroups: Array<{ label: string; codes: string[] }> = [
    { label: 'Precious metals', codes: ['GOLD', 'SILVER', 'PLATINUM'] },
    { label: 'Industrial materials', codes: ['COPPER', 'LITHIUM', 'STEEL', 'URANIUM'] },
    { label: 'Energy', codes: ['OIL_PRODUCERS', 'OIL_SERVICES', 'NATURAL_GAS'] },
];

function defaultMarketGroupFor(code: string): string {
    return themeGroups.find((group) => group.codes.includes(code))?.label || 'Other';
}

function sourceSymbol(source: CommodityThemeSource, security?: CommodityThemeSecurity): string | null {
    const resolve = (value?: string) => value === 'SECURITY' ? security?.ticker ?? null : value || null;
    const numerator = resolve(source.numerator);
    const denominator = resolve(source.denominator);
    if (numerator && denominator) return `${numerator}/${denominator}`;
    return resolve(source.symbol);
}

function sourcePairLabel(source?: CommodityThemeSource): string {
    const symbol = source ? sourceSymbol(source) : null;
    return String(symbol || '')
        .replace(/(^|\/)(?:[A-Z0-9_]+):/gi, '$1')
        .replace(/\//g, ' / ') || 'Source pending';
}

function formatDollar(value: number): string {
    if (!Number.isFinite(value) || value === 0) return '$0';
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value)}`;
}

function format60DayReturn(value?: number | null): string {
    if (!Number.isFinite(value)) return '—';
    const numeric = Number(value);
    return `${numeric > 0 ? '+' : ''}${numeric.toFixed(1)}%`;
}

function return60DayTone(value?: number | null): string {
    if (!Number.isFinite(value) || Number(value) === 0) return marketTextMuted;
    return Number(value) > 0
        ? 'text-[color:var(--signal-buy)]'
        : 'text-[color:var(--signal-sell)]';
}

function formatPerformanceAsOf(value?: string | null): string {
    if (!value) return 'Direct commodity price history has not been refreshed.';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Direct commodity price history is unavailable.';
    return `Direct commodity return over 60 calendar days, as of ${date.toLocaleDateString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric',
    })}.`;
}

function openChartUrl(symbol: string): string {
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function stageSecurityTotal(stage: CommodityThemeStage, theme?: CommodityTheme): number {
    const responseTotal = Number(stage.eligible_security_total);
    const includedSecurityTotal = theme?.eligible_securities?.filter((security) => security.include_in_sizing).length ?? 0;
    return Number.isFinite(responseTotal) && responseTotal > 0 ? responseTotal : includedSecurityTotal;
}

function stageDirection(stage: CommodityThemeStage): 'BULL' | 'BEAR' | null {
    if (stage.status === 'CONFIRMED') return 'BULL';
    if (stage.status === 'BLOCKED') return 'BEAR';
    return null;
}

function stageReadoutSegments(stage: CommodityThemeStage, theme?: CommodityTheme): Array<{ label: string; tone: string }> {
    if (stage.scope !== 'SECURITY') {
        const direction = stageDirection(stage);
        return direction
            ? [{ label: direction, tone: direction === 'BULL' ? 'text-[color:var(--signal-buy)]' : 'text-[color:var(--signal-sell)]' }]
            : [{ label: '—', tone: marketTextMuted }];
    }

    const total = stageSecurityTotal(stage, theme);
    const confirmed = Math.min(total || Number.POSITIVE_INFINITY, Math.max(0, Number(stage.eligible_security_count) || 0));
    const blocked = Math.min(total || Number.POSITIVE_INFINITY, Math.max(0, Number(stage.blocked_security_count) || 0));
    const positiveLabel = stage.key === 'SECURITY_OUTPERFORM' ? 'OUTPERFORM' : 'BULL';
    const negativeLabel = stage.key === 'SECURITY_OUTPERFORM' ? 'UNDERPERFORM' : 'BEAR';
    const countSuffix = (count: number) => total > 0 ? ` ${count}/${total}` : '';
    const segments: Array<{ label: string; tone: string }> = [];

    if (confirmed > 0) {
        segments.push({ label: `${positiveLabel}${countSuffix(confirmed)}`, tone: 'text-[color:var(--signal-buy)]' });
    }
    if (blocked > 0) {
        segments.push({ label: `${negativeLabel}${countSuffix(blocked)}`, tone: 'text-[color:var(--signal-sell)]' });
    }
    if (segments.length > 0) return segments;

    const direction = stageDirection(stage);
    if (direction) {
        return [{
            label: stage.key === 'SECURITY_OUTPERFORM'
                ? (direction === 'BULL' ? 'OUTPERFORM' : 'UNDERPERFORM')
                : direction,
            tone: direction === 'BULL' ? 'text-[color:var(--signal-buy)]' : 'text-[color:var(--signal-sell)]',
        }];
    }
    return [{ label: '—', tone: marketTextMuted }];
}

function StageReadout({
    stage,
    theme,
    blankWhenNoSignal = false,
}: {
    stage: CommodityThemeStage;
    theme?: CommodityTheme;
    blankWhenNoSignal?: boolean;
}) {
    const segments = stageReadoutSegments(stage, theme);
    const visibleSegments = blankWhenNoSignal && segments.length === 1 && segments[0]?.label === '—'
        ? []
        : segments;
    // A stage can report both a positive and a negative cohort (for example
    // Outperform 2/4 alongside Underperform 2/4). Stack those instead of
    // letting one line overflow into the neighbouring column.
    const stacked = visibleSegments.length > 1;
    return (
        <span className={`flex min-w-0 items-center justify-center whitespace-nowrap ${stacked ? 'flex-col gap-y-px' : ''}`}>
            {visibleSegments.map((segment, index) => (
                <span key={`${segment.label}-${index}`} className="text-[12px] font-medium leading-[1.25]">
                    {index > 0 && !stacked ? <span className={`${marketTextMuted} font-normal`}>· </span> : null}
                    <span className={segment.tone}>{segment.label}</span>
                </span>
            ))}
        </span>
    );
}

type StageSignal = 'BULL' | 'BEAR' | 'PENDING';

// Market | DIRECT COMMODITY: Trend, 60D, Vehicle | PRODUCER EQUITIES: Regime, Qualifying, Held | actions.
// Direct commodity and producer equities are separate sleeves, so they are laid out as two
// column groups rather than one four-stage path.
const marketGridColumns = 'grid-cols-[minmax(150px,1fr)_minmax(84px,0.55fr)_minmax(64px,0.4fr)_minmax(100px,0.65fr)_minmax(170px,1fr)_minmax(150px,0.95fr)_minmax(112px,0.7fr)_60px]';

function themeStageSignal(stage?: CommodityThemeStage): StageSignal {
    if (!stage) return 'PENDING';
    if (stage.status === 'CONFIRMED') return 'BULL';
    if (stage.status === 'BLOCKED') return 'BEAR';
    return 'PENDING';
}

function stripExchange(value?: string | null): string {
    return String(value || '').replace(/^[A-Z0-9_]+:/i, '');
}

// Colour is carried by a small mark; the label beside it stays in text ink.
function DirectionGlyph({ signal }: { signal: StageSignal }) {
    if (signal === 'PENDING') {
        return <span aria-hidden="true" className="h-px w-[8px] shrink-0 bg-[color:var(--analysis-ticker-text)] opacity-60" />;
    }
    return (
        <svg aria-hidden="true" viewBox="0 0 8 7" className="h-[7px] w-[8px] shrink-0">
            <path
                d={signal === 'BULL' ? 'M4 0 8 7H0Z' : 'M0 0h8L4 7Z'}
                fill={signal === 'BULL' ? 'var(--signal-buy)' : 'var(--signal-sell)'}
            />
        </svg>
    );
}

type CompanyStanding = 'QUALIFIES' | 'LAGGING' | 'DOWNTREND' | 'INCOMPLETE';

const standingOrder: CompanyStanding[] = ['QUALIFIES', 'LAGGING', 'DOWNTREND', 'INCOMPLETE'];

const standingLabel: Record<CompanyStanding, string> = {
    QUALIFIES: 'Qualifies',
    LAGGING: 'Lags basket',
    DOWNTREND: 'Downtrend',
    INCOMPLETE: 'Incomplete',
};

// One standing per company, from that company's own CDF trend and Outperform state.
// Counting trend and Outperform separately could pair evidence from different stocks.
function companyStanding(security: CommodityThemeSecurity): CompanyStanding {
    const trend = security.stage_states.SECURITY_TREND;
    const outperform = security.stage_states.SECURITY_OUTPERFORM;
    if (trend === 'BLOCKED') return 'DOWNTREND';
    if (trend !== 'CONFIRMED') return 'INCOMPLETE';
    if (outperform === 'CONFIRMED') return 'QUALIFIES';
    if (outperform === 'BLOCKED') return 'LAGGING';
    return 'INCOMPLETE';
}

function StandingMark({ standing }: { standing: CompanyStanding }) {
    const shape: CSSProperties = standing === 'QUALIFIES'
        ? { width: 8, height: 8, borderRadius: 2, background: 'var(--signal-buy)' }
        : standing === 'LAGGING'
            ? { width: 8, height: 8, borderRadius: 2, boxShadow: 'inset 0 0 0 1.5px var(--signal-buy)' }
            : standing === 'DOWNTREND'
                ? { width: 8, height: 3, borderRadius: 1, background: 'var(--signal-sell)' }
                : { width: 8, height: 8, borderRadius: 2, border: '1px dashed color-mix(in srgb, var(--analysis-ticker-text) 55%, transparent)' };
    return (
        <span aria-hidden="true" className="flex h-[8px] w-[8px] shrink-0 items-center justify-center">
            <span className="block" style={{ ...shape, boxSizing: 'border-box' }} />
        </span>
    );
}

const standingCountLabel: Record<CompanyStanding, [string, string]> = {
    QUALIFIES: ['qualifies', 'qualify'],
    LAGGING: ['lags basket', 'lag basket'],
    DOWNTREND: ['in downtrend', 'in downtrend'],
    INCOMPLETE: ['incomplete', 'incomplete'],
};

function themeCompanies(theme: CommodityTheme) {
    const all = (theme.eligible_securities ?? []).map((security) => ({ security, standing: companyStanding(security) }));
    const counted = all
        .filter(({ security }) => security.include_in_sizing)
        .sort((left, right) => standingOrder.indexOf(left.standing) - standingOrder.indexOf(right.standing));
    const incomplete = counted.filter(({ standing }) => standing === 'INCOMPLETE').length;
    return {
        all,
        counted,
        qualifying: counted.filter(({ standing }) => standing === 'QUALIFIES').length,
        // Companies with a readable standing. Missing evidence is not a failed test,
        // so it stays out of the denominator and is reported separately.
        evaluated: counted.length - incomplete,
        incomplete,
    };
}

function standingMixText(counted: Array<{ standing: CompanyStanding }>): string {
    return standingOrder
        .map((standing) => ({ standing, count: counted.filter((entry) => entry.standing === standing).length }))
        .filter((entry) => entry.count > 0)
        .map((entry) => `${entry.count} ${entry.count === 1 ? standingCountLabel[entry.standing][0] : standingCountLabel[entry.standing][1]}`)
        .join(' · ');
}

const standingFill: Record<CompanyStanding, string> = {
    QUALIFIES: 'var(--signal-buy)',
    LAGGING: 'color-mix(in srgb, var(--signal-buy) 38%, transparent)',
    DOWNTREND: 'var(--signal-sell)',
    INCOMPLETE: 'color-mix(in srgb, var(--analysis-ticker-text) 28%, transparent)',
};

const MAX_STANDING_MARKS = 10;

// One mark per company while they can be counted at a glance; beyond that a
// fixed-width proportion bar, so a large class never overflows or clips.
function StandingSummary({ counted, dimmed = false }: { counted: Array<{ security: CommodityThemeSecurity; standing: CompanyStanding }>; dimmed?: boolean }) {
    if (counted.length <= MAX_STANDING_MARKS) {
        return (
            <span data-market-standing-summary="marks" className={`inline-flex shrink-0 items-center gap-[4px] ${dimmed ? 'opacity-40' : ''}`}>
                {counted.map(({ security, standing }) => <StandingMark key={security.security_id} standing={standing} />)}
            </span>
        );
    }
    return (
        <span
            data-market-standing-summary="bar"
            aria-hidden="true"
            className={`inline-flex h-[6px] w-[88px] shrink-0 gap-px overflow-hidden rounded-[1.5px] ${dimmed ? 'opacity-40' : ''}`}
        >
            {standingOrder.map((standing) => {
                const count = counted.filter((entry) => entry.standing === standing).length;
                return count > 0
                    ? <span key={standing} className="h-full min-w-[2px]" style={{ flexGrow: count, flexBasis: 0, background: standingFill[standing] }} />
                    : null;
            })}
        </span>
    );
}

function qualifyingCountText(qualifying: number, evaluated: number): string | null {
    return evaluated > 0 ? `${qualifying} of ${evaluated}` : null;
}

function equityBasketLabel(theme: CommodityTheme): string {
    const equity = theme.stages.find((stage) => stage.key === 'EQUITY_RELATIVE');
    return stripExchange(equity?.source.numerator) || 'basket';
}

function MarketChart({
    stage,
    security,
    emptyLabel = 'No eligible company signal',
    title,
}: {
    stage: CommodityThemeStage;
    security?: CommodityThemeSecurity;
    emptyLabel?: string;
    title?: string;
}) {
    const subject = stage.scope === 'SECURITY' && security ? shortTicker(security.ticker) : null;
    const containerRef = useRef<HTMLDivElement>(null);
    const symbol = sourceSymbol(stage.source, security);
    const [visible, setVisible] = useState(false);
    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const container = containerRef.current;
        if (!symbol || !container) return;
        if (!('IntersectionObserver' in window)) {
            setVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;
                setVisible(true);
                observer.disconnect();
            },
            { rootMargin: '160px 0px' },
        );
        observer.observe(container);
        return () => observer.disconnect();
    }, [symbol]);

    useEffect(() => {
        const container = containerRef.current;
        if (!symbol || !visible || !container) return;
        const root = document.documentElement;
        let previousAppearance = '';
        let disposeWidget = () => {};
        const mount = () => {
            const theme = root.classList.contains('light') ? 'light' : 'dark';
            const context = document.createElement('canvas').getContext('2d');
            let chartBackground = theme === 'light' ? '#ffffff' : '#12151a';
            if (context) {
                context.fillStyle = getComputedStyle(container).backgroundColor;
                context.fillRect(0, 0, 1, 1);
                const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
                chartBackground = `rgb(${r}, ${g}, ${b})`;
            }
            const appearance = `${theme}:${chartBackground}`;
            if (appearance === previousAppearance) return;
            previousAppearance = appearance;
            disposeWidget();
            setStatus('loading');
            let disposed = false;
            let failed = false;
            let widgetObserver: MutationObserver | undefined;
            const fail = () => {
                if (disposed) return;
                failed = true;
                window.clearTimeout(timeout);
                widgetObserver?.disconnect();
                setStatus('error');
            };
            const timeout = window.setTimeout(fail, 20000);
            const removeEmbed = mountTradingViewEmbed(container, {
                autosize: true,
                symbol,
                interval: 'D',
                range: '12M',
                timezone: 'Etc/UTC',
                theme,
                backgroundColor: chartBackground,
                gridColor: theme === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.045)',
                style: '1',
                locale: 'en',
                hide_top_toolbar: true,
                hide_side_toolbar: true,
                hide_legend: true,
                hide_volume: true,
                save_image: false,
                allow_symbol_change: false,
                withdateranges: false,
                calendar: false,
                details: false,
                hotlist: false,
                studies: [],
                support_host: 'https://www.tradingview.com',
            }, {
                title: `${symbol} price chart by TradingView`,
                onError: fail,
                onLoad: () => {
                    if (disposed || failed) return;
                    // The outer document loading does not mean the provider mounted its chart.
                    const doc = container.querySelector('iframe')?.contentDocument;
                    if (!doc?.documentElement) return;
                    const checkWidget = () => {
                        if (disposed || failed) return;
                        const widget = doc.querySelector<HTMLIFrameElement>('.tradingview-widget-container iframe');
                        if (!widget || widget.contentDocument?.URL === 'about:blank') return;
                        window.clearTimeout(timeout);
                        widgetObserver?.disconnect();
                        setStatus('loaded');
                    };
                    widgetObserver?.disconnect();
                    widgetObserver = new MutationObserver(checkWidget);
                    widgetObserver.observe(doc.documentElement, { childList: true, subtree: true });
                    checkWidget();
                },
            });
            disposeWidget = () => {
                disposed = true;
                window.clearTimeout(timeout);
                widgetObserver?.disconnect();
                removeEmbed();
            };
        };
        mount();
        const themeObserver = new MutationObserver(mount);
        themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => { themeObserver.disconnect(); disposeWidget(); };
    }, [symbol, visible, attempt]);

    return (
        <article data-testid={`market-chart-${stage.key}`} className="min-w-0 border border-border/55 bg-[color:var(--surface-1)]">
            <header className="flex items-center justify-between gap-3 border-b border-border/45 px-3 py-2">
                <div className="min-w-0">
                    <p data-market-chart-title className={`truncate text-[11px] font-semibold uppercase tracking-[0.07em] ${marketTextStrong}`}>
                        {title ?? stage.label}{subject ? <span className={marketTextMuted}> · {subject}</span> : null}
                    </p>
                    <p className={`truncate font-mono text-[10px] ${marketTextFaint}`}>{symbol ?? 'No source'}</p>
                </div>
                {symbol ? (
                    <a
                        href={openChartUrl(symbol)}
                        target="_blank"
                        rel="noreferrer"
                        className={`shrink-0 ${marketTextFaint} transition-opacity hover:opacity-100`}
                        title="Open chart"
                        aria-label={`Open ${stage.label} in TradingView`}
                    >
                        <ArrowUpRight className="h-[13px] w-[13px]" aria-hidden="true" />
                    </a>
                ) : null}
            </header>
            {symbol ? (
                <div className="relative h-[250px] w-full">
                    <div ref={containerRef} className="h-full w-full bg-[color:var(--surface-1)]" />
                    {status !== 'loaded' && <div className={detailStyles.chartStatus} role="status">
                        <p>{status === 'error' ? 'TradingView could not be loaded.' : 'Loading chart...'}</p>
                        {status === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw aria-hidden="true" />Retry chart</button>}
                    </div>}
                </div>
            ) : (
                <div className={`flex h-[250px] items-center justify-center text-[11px] ${marketTextMuted}`}>{emptyLabel}</div>
            )}
        </article>
    );
}

function themeSecurityForStage(theme: CommodityTheme, stageKey: string): CommodityThemeSecurity | undefined {
    const securities = theme.eligible_securities ?? [];
    return securities.find((security) => security.include_in_sizing && security.stage_states[stageKey] === 'CONFIRMED')
        ?? securities.find((security) => security.include_in_sizing && security.stage_states[stageKey] === 'BLOCKED')
        ?? securities.find((security) => security.include_in_sizing);
}

function shortTicker(value?: string | null): string {
    return String(value || 'Ticker pending')
        .trim()
        .replace(/^ASX_DLY:/i, 'ASX:')
        .replace(/^[A-Z0-9_]+:/i, '');
}

function StockSignal({ status, label, node }: { status?: CommodityThemeStatus; label: string; node: 'trend' | 'outperform' }) {
    const signal: StageSignal = status === 'CONFIRMED' ? 'BULL' : status === 'BLOCKED' ? 'BEAR' : 'PENDING';
    return (
        <span data-market-stock-evidence-node={node} className="inline-flex items-center gap-[6px]">
            <DirectionGlyph signal={signal} />
            <span className={`text-[11.5px] ${marketTextMuted}`}>{label}</span>
        </span>
    );
}

// Company rows sit under the Producer equities columns: each company's Trend and
// Outperform evidence under Equity regime, and its resulting standing under Qualifying,
// directly beneath the market's standing marks.
function SecurityEvidence({ security, basket, regimeOpen }: { security: CommodityThemeSecurity; basket: string; regimeOpen: boolean }) {
    const standing = companyStanding(security);
    return (
        <div
            data-testid={`market-stock-evidence-row-${security.security_id}`}
            className="col-span-full grid h-[30px] grid-cols-subgrid items-center"
        >
            <span className="col-span-4 flex min-w-0 items-baseline gap-2.5 pl-[33px] pr-3">
                <span className={`w-[36px] shrink-0 font-mono text-[11px] ${marketTextStrong}`}>{shortTicker(security.ticker)}</span>
                <span className={`min-w-0 truncate text-[11.5px] ${marketTextMuted}`}>{security.name}</span>
            </span>
            <span className="flex min-w-0 items-center gap-4 border-l border-border/30 px-4">
                <StockSignal status={security.stage_states.SECURITY_TREND} label="Trend" node="trend" />
                <StockSignal status={security.stage_states.SECURITY_OUTPERFORM} label={`vs ${basket}`} node="outperform" />
            </span>
            <span
                className={`flex min-w-0 items-center gap-2 px-4 ${regimeOpen ? '' : 'opacity-55'}`}
                title={regimeOpen ? undefined : 'Entries are blocked while the equity regime is closed.'}
            >
                <StandingMark standing={standing} />
                <span className={`truncate text-[11.5px] ${standing === 'QUALIFIES' && regimeOpen ? marketTextStrong : marketTextMuted}`}>{standingLabel[standing]}</span>
            </span>
            <span className={`truncate px-4 text-right text-[10.5px] ${marketTextFaint}`}>
                {security.include_in_sizing ? '' : 'Out of universe'}
            </span>
            <span aria-hidden="true" />
        </div>
    );
}

function MarketMapStockEvidence({ theme }: { theme: CommodityTheme }) {
    const { all } = themeCompanies(theme);
    const basket = equityBasketLabel(theme);
    const evidenceId = `market-stock-evidence-${theme.code}`;
    const regimeOpen = themeStageSignal(theme.stages.find((stage) => stage.key === 'EQUITY_RELATIVE')) === 'BULL';
    const ordered = [...all].sort((left, right) => standingOrder.indexOf(left.standing) - standingOrder.indexOf(right.standing));
    return (
        <div
            id={evidenceId}
            data-testid={evidenceId}
            role="region"
            aria-label={`${theme.display_name} stock evidence`}
            className="col-span-full grid grid-cols-subgrid pb-2"
        >
            {ordered.length > 0 ? (
                ordered.map(({ security }) => <SecurityEvidence key={security.security_id} security={security} basket={basket} regimeOpen={regimeOpen} />)
            ) : (
                <p className={`col-span-full py-2 pl-[33px] text-[11px] ${marketTextMuted}`}>No eligible stocks are configured for this market.</p>
            )}
        </div>
    );
}

function fundAsChartSecurity(fund: CommodityThemeFund): CommodityThemeSecurity {
    return {
        security_id: fund.security_id,
        ticker: fund.ticker,
        name: fund.name,
        include_in_sizing: false,
        stage_states: { SECURITY_TREND: fund.trend_state },
        latest_events: {},
    };
}

function formatSignalDate(...values: Array<string | null | undefined>): string | null {
    const times = values
        .map((value) => (value ? new Date(value).getTime() : Number.NaN))
        .filter((time) => Number.isFinite(time));
    if (times.length === 0) return null;
    return new Date(Math.max(...times)).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DetailSignal({
    stageKey,
    label,
    meta,
    sub,
    subTone,
    updated,
    connected = true,
    children,
}: {
    stageKey: string;
    label: string;
    meta?: string | null;
    sub?: string | null;
    subTone?: string;
    updated: string | null;
    connected?: boolean;
    children: ReactNode;
}) {
    return (
        <div className={detailStyles.stage} data-market-detail-stage={stageKey}>
            <p className={detailStyles.stageLabel}>
                {label}
                {meta ? <span className={detailStyles.stageMeta}>{meta}</span> : null}
            </p>
            <div className={detailStyles.signalValue}>{children}</div>
            {sub ? <p className={`${detailStyles.signalSub} ${subTone ?? ''}`}>{sub}</p> : null}
            {connected ? (
                <p className={detailStyles.signalDate} data-market-detail-updated={stageKey}>
                    {updated ? `Updated ${updated}` : 'No event recorded'}
                </p>
            ) : null}
        </div>
    );
}

function signalWord(signal: StageSignal, open = 'Bull', closed = 'Bear'): string {
    if (signal === 'PENDING') return 'Not connected';
    return signal === 'BULL' ? open : closed;
}

function MarketDetail({ theme, onBack }: { theme: CommodityTheme; onBack: () => void }) {
    const stages = [...theme.stages].sort((left, right) => left.order - right.order);
    const physicalStage = stages.find((stage) => stage.key === 'COMMODITY');
    const equityStage = stages.find((stage) => stage.key === 'EQUITY_RELATIVE');
    const securityStages = stages.filter((stage) => stage.scope === 'SECURITY');
    const commoditySignal = themeStageSignal(physicalStage);
    const regimeSignal = themeStageSignal(equityStage);
    const regimeOpen = regimeSignal === 'BULL';
    const { counted, qualifying, evaluated } = themeCompanies(theme);
    const qualifyingText = qualifyingCountText(qualifying, evaluated);
    const standingMix = standingMixText(counted);
    const basket = equityBasketLabel(theme);
    const directEvidence = (theme.eligible_securities ?? []).filter((security) =>
        Object.values(security.stage_states).some((status) => status !== 'DISCONNECTED'),
    );
    // One selected company drives both company charts, so trend and Outperform are
    // always read for the same stock. Default to the strongest standing.
    const orderedEvidence = [...directEvidence].sort((left, right) =>
        standingOrder.indexOf(companyStanding(left)) - standingOrder.indexOf(companyStanding(right)));
    // Producer ETFs sit beside the companies for their own trend and chart. They have
    // no Outperform feed and never count towards company totals.
    const funds = theme.producer_funds ?? [];
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const selectedFund = funds.find((fund) => `fund:${fund.security_id}` === selectedKey);
    const selectedCompany = selectedFund
        ? undefined
        : orderedEvidence.find((security) => `company:${security.security_id}` === selectedKey)
            ?? orderedEvidence[0]
            ?? (funds.length === 0 ? themeSecurityForStage(theme, 'SECURITY_OUTPERFORM') : undefined);
    const chartFund = selectedFund ?? (selectedCompany ? undefined : funds[0]);
    const trendChartSecurity: CommodityThemeSecurity | undefined = chartFund ? fundAsChartSecurity(chartFund) : selectedCompany;
    const evidenceRowCount = directEvidence.length + funds.length;
    const sleeve = theme.equity_sleeve;
    const budgetApproved = Boolean(sleeve?.budget_approved);
    const vehicleReview = theme.reviews?.some((review) => review.key === 'DIRECT_VEHICLE_REVIEW');
    const vehicleApproved = theme.direct_expression?.status === 'APPROVED';
    // Signal only is the default for almost every market, so it is not restated;
    // the line appears only for an approved vehicle or a vehicle review.
    const vehicleText = vehicleApproved
        ? `Vehicle: ${stripExchange(theme.direct_expression.instrument_ticker) || theme.direct_expression.instrument_label || 'approved'}`
        : vehicleReview
            ? 'Direct vehicle review: target set without an approved vehicle'
            : null;
    const hasDirectAllocation = theme.strategic_floor.target_value > 0 || theme.strategic_floor.actual_value > 0;
    const heldShare = budgetApproved && sleeve.target_value > 0
        ? `${Math.round((sleeve.invested_value / sleeve.target_value) * 100)}% of budget`
        : null;

    return (
        <div className={`${detailStyles.detail} flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--panel-bg-alt)]`}>
            <header className={detailStyles.header}>
                <button
                    type="button"
                    onClick={onBack}
                    data-testid="market-detail-back"
                    className={detailStyles.back}
                    title="Back to market map"
                    aria-label="Back to market map"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <h2>{theme.display_name}</h2>
            </header>

            <div className={detailStyles.content}>
                <section className={detailStyles.signals} aria-label="Market signals">
                    <div className={detailStyles.physical}>
                        <h3>{theme.display_name}<span className={detailStyles.headingQualifier}> · direct commodity</span></h3>
                        {physicalStage ? (
                            <DetailSignal
                                stageKey="COMMODITY"
                                label={physicalStage.label}
                                meta={sourcePairLabel(physicalStage.source)}
                                sub={vehicleText}
                                subTone={vehicleReview && !vehicleApproved ? 'text-[color:var(--signal-warn)]' : undefined}
                                updated={formatSignalDate(physicalStage.last_event_at, physicalStage.last_confirmed_at)}
                                connected={commoditySignal !== 'PENDING'}
                            >
                                <DirectionGlyph signal={commoditySignal} />
                                <span className={commoditySignal === 'PENDING' ? marketTextMuted : undefined}>{signalWord(commoditySignal)}</span>
                                <span
                                    className={`${detailStyles.signalReturn} ${return60DayTone(physicalStage.return_60d_pct)}`}
                                    title={formatPerformanceAsOf(physicalStage.performance_as_of)}
                                >
                                    {format60DayReturn(physicalStage.return_60d_pct)} <span className={marketTextFaint}>60D</span>
                                </span>
                            </DetailSignal>
                        ) : <p className={marketTextMuted}>No source configured</p>}
                        {hasDirectAllocation ? (
                            <dl className={detailStyles.directAllocation}>
                                <div><dt>Held</dt><dd>{formatDollar(theme.strategic_floor.actual_value)}</dd></div>
                                <div><dt>Target</dt><dd>{formatDollar(theme.strategic_floor.target_value)}</dd></div>
                            </dl>
                        ) : null}
                    </div>
                    <div className={detailStyles.equities}>
                        <h3>{theme.display_name}<span className={detailStyles.headingQualifier}> · producer equities</span></h3>
                        <div className={detailStyles.equityStages}>
                            <DetailSignal
                                stageKey="EQUITY_RELATIVE"
                                label="Equity regime"
                                meta={sourcePairLabel(equityStage?.source)}
                                sub={regimeSignal === 'PENDING'
                                    ? null
                                    : regimeOpen
                                        ? 'New producer-equity entries follow normal CDF/TMS rules'
                                        : 'New entries, adds, breakouts and re-entries are blocked'}
                                updated={formatSignalDate(equityStage?.last_event_at, equityStage?.last_confirmed_at)}
                                connected={regimeSignal !== 'PENDING'}
                            >
                                <DirectionGlyph signal={regimeSignal} />
                                <span className={regimeSignal === 'PENDING' ? marketTextMuted : undefined}>{signalWord(regimeSignal, 'Open', 'Closed')}</span>
                            </DetailSignal>
                            <DetailSignal
                                stageKey="QUALIFYING"
                                label="Qualifying companies"
                                meta={`uptrend and outperforming ${basket}`}
                                sub={counted.length === 0 ? 'No eligible companies configured' : standingMix}
                                updated={formatSignalDate(...securityStages.flatMap((stage) => [stage.last_event_at, stage.last_confirmed_at]))}
                                connected={evaluated > 0}
                            >
                                {counted.length === 0 ? (
                                    <span className={marketTextMuted}>—</span>
                                ) : (
                                    <>
                                        {qualifyingText ? (
                                            <span className="shrink-0 tabular-nums">{qualifying} <span className={marketTextFaint}>of {evaluated}</span></span>
                                        ) : (
                                            <span className={`shrink-0 ${marketTextMuted}`}>No complete evidence</span>
                                        )}
                                        <StandingSummary counted={counted} dimmed={!regimeOpen} />
                                    </>
                                )}
                            </DetailSignal>
                        </div>
                    </div>
                </section>

                <dl className={detailStyles.capital} aria-label="Producer-equity sleeve">
                    <div>
                        <dt>Held producer equities</dt>
                        <dd>{budgetApproved ? formatDollar(sleeve.invested_value) : '—'}{heldShare ? <small>{heldShare}</small> : null}</dd>
                    </div>
                    <div>
                        <dt>Approved budget</dt>
                        <dd>{budgetApproved ? formatDollar(sleeve.target_value) : 'No mandate'}</dd>
                    </div>
                    <div>
                        <dt>Class cash held</dt>
                        <dd>{budgetApproved ? <>{formatDollar(sleeve.sleeve_cash_value)}<small>Stays within this class</small></> : '—'}</dd>
                    </div>
                </dl>

                <section className={detailStyles.evidence}>
                    <div className={detailStyles.companies}>
                        <div className={detailStyles.sectionHeading}>
                            <h3>Company evidence</h3>
                            <span>{directEvidence.length}{funds.length > 0 ? ` · ${funds.length} ${funds.length === 1 ? 'fund' : 'funds'}` : ''}</span>
                            {evidenceRowCount > 1 ? <span className={detailStyles.sectionHint}>Select a row to chart it</span> : null}
                        </div>
                        {evidenceRowCount > 0 ? (
                            <table className={detailStyles.evidenceTable}>
                                <thead><tr><th>Company</th><th>Trend</th><th>vs {basket}</th><th>Standing</th></tr></thead>
                                <tbody>{orderedEvidence.map((security) => {
                                    const selected = !chartFund && security.security_id === selectedCompany?.security_id;
                                    const standing = companyStanding(security);
                                    const trend = themeStageSignal({ status: security.stage_states.SECURITY_TREND ?? 'DISCONNECTED' } as CommodityThemeStage);
                                    const outperform = themeStageSignal({ status: security.stage_states.SECURITY_OUTPERFORM ?? 'DISCONNECTED' } as CommodityThemeStage);
                                    return (
                                        <tr
                                            key={security.security_id}
                                            data-testid={`market-detail-company-${security.security_id}`}
                                            aria-selected={selected}
                                            className={selected ? detailStyles.selectedRow : undefined}
                                            onClick={() => setSelectedKey(`company:${security.security_id}`)}
                                        >
                                            <td>
                                                <button
                                                    type="button"
                                                    className={detailStyles.companyButton}
                                                    aria-pressed={selected}
                                                    aria-label={`Chart ${security.name}`}
                                                    onClick={() => setSelectedKey(`company:${security.security_id}`)}
                                                >
                                                    <span className={detailStyles.companyName}>
                                                        <span title={security.name}>{security.name}</span>
                                                        <small>{shortTicker(security.ticker)}{security.include_in_sizing ? '' : ' · Out of universe'}</small>
                                                    </span>
                                                </button>
                                            </td>
                                            <td className={detailStyles.glyphCell} title={`Company trend: ${signalWord(trend)}`}>
                                                <DirectionGlyph signal={trend} />
                                            </td>
                                            <td className={detailStyles.glyphCell} title={`Against ${basket}: ${signalWord(outperform, 'Outperforming', 'Underperforming')}`}>
                                                <DirectionGlyph signal={outperform} />
                                            </td>
                                            <td>
                                                <span className={`${detailStyles.standing} ${regimeOpen ? '' : detailStyles.dimmed}`}>
                                                    <StandingMark standing={standing} />
                                                    {standingLabel[standing]}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {funds.length > 0 ? (
                                    <tr className={detailStyles.groupRow} aria-hidden="true"><td colSpan={4}>Funds</td></tr>
                                ) : null}
                                {funds.map((fund) => {
                                    const selected = chartFund?.security_id === fund.security_id;
                                    const trend = themeStageSignal({ status: fund.trend_state } as CommodityThemeStage);
                                    return (
                                        <tr
                                            key={`fund-${fund.security_id}`}
                                            data-testid={`market-detail-fund-${fund.security_id}`}
                                            aria-selected={selected}
                                            className={selected ? detailStyles.selectedRow : undefined}
                                            onClick={() => setSelectedKey(`fund:${fund.security_id}`)}
                                        >
                                            <td>
                                                <button
                                                    type="button"
                                                    className={detailStyles.companyButton}
                                                    aria-pressed={selected}
                                                    aria-label={`Chart ${fund.name}`}
                                                    onClick={() => setSelectedKey(`fund:${fund.security_id}`)}
                                                >
                                                    <span className={detailStyles.companyName}>
                                                        <span title={fund.name}>{fund.name}</span>
                                                        <small>{shortTicker(fund.ticker)} · ETF</small>
                                                    </span>
                                                </button>
                                            </td>
                                            <td className={detailStyles.glyphCell} title={`Fund trend: ${signalWord(trend)}`}>
                                                <DirectionGlyph signal={trend} />
                                            </td>
                                            <td className={detailStyles.glyphCell} title="Outperform applies to companies, not funds"><span className={marketTextFaint}>—</span></td>
                                            <td><span className={marketTextFaint}>—</span></td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                        ) : (
                            <p className={detailStyles.empty}>No company or fund signals received.</p>
                        )}
                    </div>

                    <div className={detailStyles.charts}>
                        {stages.map((stage) => (
                            <MarketChart
                                key={stage.key}
                                stage={stage}
                                security={stage.key === 'SECURITY_OUTPERFORM'
                                    ? (chartFund ? undefined : selectedCompany)
                                    : stage.scope === 'SECURITY' ? trendChartSecurity : undefined}
                                emptyLabel={stage.key === 'SECURITY_OUTPERFORM' && chartFund
                                    ? 'Outperform applies to companies, not funds'
                                    : undefined}
                                title={stage.key === 'SECURITY_TREND' && chartFund ? 'Fund trend' : undefined}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

function nextSetupStepForTheme(theme: CommodityTheme): ThemeSetupStep {
    const physical = theme.stages.find((stage) => stage.key === 'COMMODITY');
    const equity = theme.stages.find((stage) => stage.key === 'EQUITY_RELATIVE');
    const outperform = theme.stages.find((stage) => stage.key === 'SECURITY_OUTPERFORM');

    if (!physical) {
        return {
            label: 'Physical source pending',
            detail: 'This market does not have a configured direct commodity source yet.',
            tone: 'DISCONNECTED',
            opensAlerts: false,
        };
    }
    if (physical.status === 'DISCONNECTED') {
        return {
            label: 'Connect physical CDF',
            detail: 'Register and initialise the physical commodity CDF feed in Alerts.',
            tone: 'WAITING',
            opensAlerts: true,
        };
    }
    if (!equity) {
        return {
            label: 'Equity source pending',
            detail: 'This market does not have a configured equity-relative source yet.',
            tone: 'DISCONNECTED',
            opensAlerts: false,
        };
    }
    if (equity.status === 'DISCONNECTED') {
        return {
            label: 'Connect equity CDF',
            detail: 'Register and initialise the producer-equities versus commodity CDF feed in Alerts.',
            tone: 'WAITING',
            opensAlerts: true,
        };
    }

    const eligibleSecurities = (theme.eligible_securities ?? []).filter((security) => security.include_in_sizing);
    if (eligibleSecurities.length === 0 || !outperform) {
        return {
            label: 'No Outperform feed',
            detail: 'There is no eligible security in this market that requires an Outperform connection.',
            tone: 'DISCONNECTED',
            opensAlerts: false,
        };
    }
    const disconnectedOutperformCount = eligibleSecurities.filter(
        (security) => security.stage_states.SECURITY_OUTPERFORM === 'DISCONNECTED'
            || !security.stage_states.SECURITY_OUTPERFORM,
    ).length;
    if (disconnectedOutperformCount > 0 || outperform.status === 'DISCONNECTED') {
        const label = disconnectedOutperformCount > 1
            ? `Connect ${disconnectedOutperformCount} Outperform CDFs`
            : 'Connect Outperform CDF';
        return {
            label,
            detail: disconnectedOutperformCount > 0
                ? `Register and initialise the remaining ${disconnectedOutperformCount} eligible stock versus core-fund Outperform CDF feed${disconnectedOutperformCount === 1 ? '' : 's'} in Alerts.`
                : 'Register and initialise an eligible stock versus core-fund Outperform CDF feed in Alerts.',
            tone: 'WAITING',
            opensAlerts: true,
        };
    }
    return {
        label: 'Connections ready',
        detail: 'Physical, equity-relative, and available Outperform CDF feeds are initialized. Open Alerts to review them.',
        tone: 'CONFIRMED',
        opensAlerts: true,
    };
}

function stageForConfiguration(theme: CommodityTheme | null, key: string): CommodityThemeStage | undefined {
    return theme?.stages.find((stage) => stage.key === key);
}

function marketConfigurationDraftFor(theme: CommodityTheme | null): MarketConfigurationDraft {
    const commodity = stageForConfiguration(theme, 'COMMODITY')?.source;
    const equityRelative = stageForConfiguration(theme, 'EQUITY_RELATIVE')?.source;
    const directExpression = theme?.direct_expression;
    return {
        code: theme?.code || '',
        displayName: theme?.display_name || '',
        marketGroup: theme?.market_group || (theme ? defaultMarketGroupFor(theme.code) : ''),
        strategicFloorAssetClassCode: theme?.strategic_floor.asset_class_code || '',
        tacticalAssetClassCode: theme?.tactical.asset_class_code || '',
        commodityLabel: commodity?.label || '',
        commoditySymbol: commodity?.symbol || '',
        equityLabel: equityRelative?.label || '',
        equityNumerator: equityRelative?.numerator || '',
        equityDenominator: equityRelative?.denominator || '',
        directExpression: {
            available: directExpression?.status === 'APPROVED',
            instrumentLabel: directExpression?.instrument_label || '',
            instrumentTicker: directExpression?.instrument_ticker || '',
            instrumentKind: directExpression?.instrument_kind || 'OTHER',
        },
    };
}

function MarketConfigurationDialog({
    theme,
    assetClasses,
    onClose,
    onSaved,
    onRemoved,
}: {
    theme: CommodityTheme | null;
    assetClasses: AssetClass[];
    onClose: () => void;
    onSaved: (theme: CommodityTheme) => void;
    onRemoved: (code: string) => void;
}) {
    const isNew = theme === null;
    const [draft, setDraft] = useState<MarketConfigurationDraft>(() => marketConfigurationDraftFor(theme));
    const [saving, setSaving] = useState(false);
    const [removalArmed, setRemovalArmed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const selectableAssetClasses = assetClasses.filter((assetClass) => assetClass.active && assetClass.allow_target_weight);

    const update = (patch: Partial<MarketConfigurationDraft>) => {
        setDraft((current) => ({ ...current, ...patch }));
        setError(null);
        setRemovalArmed(false);
    };

    const updateDirectExpression = (patch: Partial<MarketConfigurationDraft['directExpression']>) => {
        setDraft((current) => ({
            ...current,
            directExpression: { ...current.directExpression, ...patch },
        }));
        setError(null);
        setRemovalArmed(false);
    };

    const configurationPayload = (): CommodityThemeConfigurationPayload => ({
        display_name: draft.displayName.trim(),
        market_group: draft.marketGroup.trim(),
        commodity: {
            label: draft.commodityLabel.trim(),
            symbol: draft.commoditySymbol.trim().toUpperCase(),
        },
        equity_relative: {
            label: draft.equityLabel.trim(),
            numerator: draft.equityNumerator.trim().toUpperCase(),
            denominator: draft.equityDenominator.trim().toUpperCase(),
        },
    });

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const payload = configurationPayload();
        if (!payload.display_name || !payload.commodity.label || !payload.commodity.symbol ||
            !payload.equity_relative.label || !payload.equity_relative.numerator || !payload.equity_relative.denominator) {
            setError('Name, source labels, and all TradingView symbols are required.');
            return;
        }
        if (isNew && (!draft.code.trim() || !draft.strategicFloorAssetClassCode || !draft.tacticalAssetClassCode)) {
            setError('A market code and the direct and producer asset classes are required.');
            return;
        }
        const directInstrumentLabel = draft.directExpression.instrumentLabel.trim();
        const directInstrumentTicker = draft.directExpression.instrumentTicker.trim();
        if (draft.directExpression.available && !directInstrumentLabel && !directInstrumentTicker) {
            setError('Enter the IG product or market identifier.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const configuredTheme = isNew
                ? await api.createCommodityTheme({
                    ...payload,
                    code: draft.code.trim().toUpperCase(),
                    strategic_floor_asset_class_code: draft.strategicFloorAssetClassCode,
                    tactical_asset_class_code: draft.tacticalAssetClassCode,
                })
                : await api.updateCommodityThemeConfiguration(theme.code, payload);
            const nextTheme = await api.updateCommodityThemeDirectExpression(configuredTheme.code, {
                status: draft.directExpression.available ? 'APPROVED' : 'SIGNAL_ONLY',
                instrument_label: directInstrumentLabel || undefined,
                instrument_ticker: directInstrumentTicker || undefined,
                instrument_kind: draft.directExpression.available ? draft.directExpression.instrumentKind : undefined,
            });
            onSaved(nextTheme);
            onClose();
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Could not save market configuration.');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!theme) return;
        if (!removalArmed) {
            setRemovalArmed(true);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await api.deleteCommodityTheme(theme.code);
            onRemoved(theme.code);
            onClose();
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Could not remove market.');
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-[20px]" onMouseDown={onClose}>
            <form
                data-testid="market-configuration-dialog"
                onSubmit={save}
                onMouseDown={(event) => event.stopPropagation()}
                className="flex max-h-[calc(100vh-48px)] w-full max-w-[920px] flex-col overflow-hidden rounded-[4px] border border-border/70 bg-[color:var(--panel-bg-alt)] shadow-2xl"
            >
                <header className="flex shrink-0 items-center gap-[12px] border-b border-border/55 px-[24px] py-[18px]">
                    <div className="min-w-0">
                        <h2 className={`text-[15px] font-semibold uppercase tracking-[0.09em] ${marketTextStrong}`}>
                            {isNew ? 'Add market pair' : `Edit ${theme.display_name}`}
                        </h2>
                        <p className={`mt-[5px] text-[11px] leading-[1.45] ${marketTextMuted}`}>
                            Source symbols drive the Markets readout and the matching connection rows in Alerts.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        title="Close market configuration"
                        aria-label="Close market configuration"
                        className={`ml-auto grid h-[32px] w-[32px] shrink-0 place-items-center rounded-[3px] border border-border/55 ${marketTextMuted} transition-colors hover:border-border hover:bg-muted/[0.1] hover:text-[color:var(--analysis-text-strong)]`}
                    >
                        <X className="h-[16px] w-[16px]" />
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
                    <div className="grid gap-x-[20px] gap-y-[16px] sm:grid-cols-2">
                        {isNew ? (
                            <label className={marketFormLabel}>
                                Market code
                                <input
                                    value={draft.code}
                                    onChange={(event) => update({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                                    placeholder="NATURAL_GAS"
                                    className={`${marketFormInput} font-mono`}
                                />
                            </label>
                        ) : (
                            <div className={marketFormLabel}>
                                Market code
                                <p className={`${marketFormStaticValue} font-mono`}>{draft.code}</p>
                            </div>
                        )}
                        <label className={marketFormLabel}>
                            Market name
                            <input
                                value={draft.displayName}
                                onChange={(event) => update({ displayName: event.target.value })}
                                placeholder="Natural gas producers"
                                className={marketFormInput}
                            />
                        </label>
                        <label className={marketFormLabel}>
                            Market group
                            <input
                                value={draft.marketGroup}
                                onChange={(event) => update({ marketGroup: event.target.value })}
                                placeholder="Energy"
                                className={marketFormInput}
                            />
                        </label>
                        {isNew ? (
                            <label className={marketFormLabel}>
                                Producer asset class
                                <select
                                    value={draft.tacticalAssetClassCode}
                                    onChange={(event) => update({ tacticalAssetClassCode: event.target.value })}
                                    className={`${marketFormSelect} font-mono`}
                                >
                                    <option value="">Choose asset class</option>
                                    {selectableAssetClasses.map((assetClass) => <option key={assetClass.code} value={assetClass.code}>{assetClass.display_name}</option>)}
                                </select>
                            </label>
                        ) : (
                            <div className={marketFormLabel}>
                                Producer asset class
                                <p className={`${marketFormStaticValue} font-mono`}>{draft.tacticalAssetClassCode}</p>
                            </div>
                        )}
                        {isNew ? (
                            <label className={marketFormLabel}>
                                Direct asset class
                                <select
                                    value={draft.strategicFloorAssetClassCode}
                                    onChange={(event) => update({ strategicFloorAssetClassCode: event.target.value })}
                                    className={`${marketFormSelect} font-mono`}
                                >
                                    <option value="">Choose asset class</option>
                                    {selectableAssetClasses.map((assetClass) => <option key={assetClass.code} value={assetClass.code}>{assetClass.display_name}</option>)}
                                </select>
                            </label>
                        ) : (
                            <div className={marketFormLabel}>
                                Direct asset class
                                <p className={`${marketFormStaticValue} font-mono`}>{draft.strategicFloorAssetClassCode}</p>
                            </div>
                        )}
                    </div>

                    <section className="mt-[22px] border-t border-border/45 pt-[18px]">
                        <h3 className={`text-[12px] font-semibold uppercase tracking-[0.1em] ${marketTextStrong}`}>Direct commodity CDF</h3>
                        <div className="mt-[12px] grid gap-[16px] sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                            <label className={marketFormLabel}>
                                Display label
                                <input
                                    value={draft.commodityLabel}
                                    onChange={(event) => update({ commodityLabel: event.target.value })}
                                    placeholder="Natural gas"
                                    className={marketFormInput}
                                />
                            </label>
                            <label className={marketFormLabel}>
                                TradingView symbol
                                <input
                                    value={draft.commoditySymbol}
                                    onChange={(event) => update({ commoditySymbol: event.target.value.toUpperCase() })}
                                    placeholder="NYMEX:NG1!"
                                    className={`${marketFormInput} font-mono`}
                                />
                            </label>
                        </div>
                    </section>

                    <section className="mt-[22px] border-t border-border/45 pt-[18px]">
                        <h3 className={`text-[12px] font-semibold uppercase tracking-[0.1em] ${marketTextStrong}`}>Producer equities / commodity CDF</h3>
                        <div className="mt-[12px] grid gap-[16px] sm:grid-cols-3">
                            <label className={marketFormLabel}>
                                Display label
                                <input
                                    value={draft.equityLabel}
                                    onChange={(event) => update({ equityLabel: event.target.value })}
                                    placeholder="FCG / natural gas"
                                    className={marketFormInput}
                                />
                            </label>
                            <label className={marketFormLabel}>
                                Equity numerator
                                <input
                                    value={draft.equityNumerator}
                                    onChange={(event) => update({ equityNumerator: event.target.value.toUpperCase() })}
                                    placeholder="AMEX:FCG"
                                    className={`${marketFormInput} font-mono`}
                                />
                            </label>
                            <label className={marketFormLabel}>
                                Commodity denominator
                                <input
                                    value={draft.equityDenominator}
                                    onChange={(event) => update({ equityDenominator: event.target.value.toUpperCase() })}
                                    placeholder="NYMEX:NG1!"
                                    className={`${marketFormInput} font-mono`}
                                />
                            </label>
                        </div>
                    </section>

                    <section data-testid="market-direct-expression" className="mt-[22px] border-t border-border/45 pt-[18px]">
                        <h3 className={`text-[12px] font-semibold uppercase tracking-[0.1em] ${marketTextStrong}`}>Direct execution</h3>
                        <p className={`mt-[6px] max-w-[700px] text-[11px] leading-[1.5] ${marketTextMuted}`}>
                            Record the IG-accessible vehicle for the separate direct commodity sleeve. This does not change the chart source or producer-equity path.
                        </p>
                        <label className={`mt-[14px] inline-flex items-center gap-[8px] text-[10px] font-semibold uppercase tracking-[0.1em] ${marketTextStrong}`}>
                            <input
                                type="checkbox"
                                checked={draft.directExpression.available}
                                onChange={(event) => updateDirectExpression({ available: event.target.checked })}
                                className="h-[14px] w-[14px] accent-[var(--signal-buy)]"
                            />
                            Available through IG
                        </label>
                        {draft.directExpression.available ? (
                            <div className="mt-[12px] grid gap-[16px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px]">
                                <label className={marketFormLabel}>
                                    IG product
                                    <input
                                        value={draft.directExpression.instrumentLabel}
                                        onChange={(event) => updateDirectExpression({ instrumentLabel: event.target.value })}
                                        placeholder="Gold"
                                        className={marketFormInput}
                                    />
                                </label>
                                <label className={marketFormLabel}>
                                    IG market / epic
                                    <input
                                        value={draft.directExpression.instrumentTicker}
                                        onChange={(event) => updateDirectExpression({ instrumentTicker: event.target.value })}
                                        placeholder="CS.D.CFDGOLD.CE"
                                        className={`${marketFormInput} font-mono`}
                                    />
                                </label>
                                <label className={marketFormLabel}>
                                    Type
                                    <select
                                        value={draft.directExpression.instrumentKind}
                                        onChange={(event) => updateDirectExpression({ instrumentKind: event.target.value })}
                                        className={`${marketFormSelect} font-mono`}
                                    >
                                        {directVehicleKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                                    </select>
                                </label>
                            </div>
                        ) : (
                            <p className={`mt-[12px] font-mono text-[9px] uppercase tracking-[0.1em] ${marketTextFaint}`}>Signal only</p>
                        )}
                    </section>

                    <p className={`mt-[18px] border-l-2 border-[color:var(--signal-warn)] px-[12px] text-[11px] leading-[1.55] ${marketTextMuted}`}>
                        Replacing a symbol keeps prior events as audit evidence, but it disconnects the new source until its CDF alert and current direction are recorded in Alerts. The stock Outperform column follows the equity numerator automatically.
                    </p>
                    {error ? <p className="mt-[14px] border border-[color:var(--signal-sell)]/45 bg-[color:var(--signal-sell)]/10 px-[12px] py-[9px] text-[11px] text-[color:var(--signal-sell)]">{error}</p> : null}
                </div>

                <footer className="flex shrink-0 items-center gap-[8px] border-t border-border/55 px-[24px] py-[14px]">
                    {!isNew ? (
                        <button
                            type="button"
                            onClick={() => void remove()}
                            disabled={saving}
                            className={`inline-flex h-[34px] items-center gap-[6px] rounded-[3px] border px-[12px] text-[10px] font-semibold uppercase tracking-[0.09em] transition-colors disabled:cursor-wait disabled:opacity-55 ${
                                removalArmed
                                    ? 'border-[color:var(--signal-sell)] bg-[color:var(--signal-sell)]/10 text-[color:var(--signal-sell)]'
                                    : `border-border/55 ${marketTextMuted} hover:border-[color:var(--signal-sell)] hover:text-[color:var(--signal-sell)]`
                            }`}
                        >
                            <Trash2 className="h-[14px] w-[14px]" /> {removalArmed ? 'Confirm remove' : 'Remove market'}
                        </button>
                    ) : null}
                    <button type="button" onClick={onClose} disabled={saving} className={`ml-auto h-[34px] rounded-[3px] border border-border/55 px-[14px] text-[10px] font-semibold uppercase tracking-[0.09em] ${marketTextMuted} transition-colors hover:border-border hover:bg-muted/[0.1] hover:text-[color:var(--analysis-text-strong)] disabled:opacity-55`}>
                        Cancel
                    </button>
                    <button type="submit" disabled={saving} className={`inline-flex h-[34px] items-center gap-[6px] rounded-[3px] border border-[color:var(--analysis-text-strong)]/50 px-[14px] text-[10px] font-semibold uppercase tracking-[0.09em] ${marketTextStrong} transition-colors hover:bg-muted/[0.12] disabled:cursor-wait disabled:opacity-55`}>
                        <Save className="h-[14px] w-[14px]" /> {saving ? 'Saving' : isNew ? 'Add market' : 'Save'}
                    </button>
                </footer>
            </form>
        </div>
    );
}

function ThemeRow({
    theme,
    onOpen,
    onOpenAlerts,
    onEdit,
}: {
    theme: CommodityTheme;
    onOpen: (code: string) => void;
    onOpenAlerts: () => void;
    onEdit: (theme: CommodityTheme) => void;
}) {
    const [evidenceExpanded, setEvidenceExpanded] = useState(false);
    const [editRailOpen, setEditRailOpen] = useState(false);
    const [rowHovered, setRowHovered] = useState(false);
    const stages = [...theme.stages].sort((left, right) => left.order - right.order);
    const commodityStage = stages.find((stage) => stage.key === 'COMMODITY');
    const equityStage = stages.find((stage) => stage.key === 'EQUITY_RELATIVE');
    const commoditySignal = themeStageSignal(commodityStage);
    const regimeSignal = themeStageSignal(equityStage);
    const regimeOpen = regimeSignal === 'BULL';
    const { counted, qualifying, evaluated, incomplete } = themeCompanies(theme);
    const qualifyingText = qualifyingCountText(qualifying, evaluated);
    const basket = equityBasketLabel(theme);
    const nextStep = nextSetupStepForTheme(theme);
    const needsSetup = nextStep.tone !== 'CONFIRMED';
    const vehicleReview = theme.reviews?.some((review) => review.key === 'DIRECT_VEHICLE_REVIEW');
    const vehicleApproved = theme.direct_expression?.status === 'APPROVED';
    const vehicleLabel = vehicleApproved
        ? stripExchange(theme.direct_expression.instrument_ticker) || theme.direct_expression.instrument_label || 'Approved'
        : vehicleReview ? 'Review vehicle' : '—';
    const sleeve = theme.equity_sleeve;
    const commoditySource = commodityStage ? sourcePairLabel(commodityStage.source) : 'Source pending';
    const regimePair = sourcePairLabel(equityStage?.source);
    const cellBase = 'flex min-w-0 items-center';
    return (
        <div
            data-testid={`market-row-${theme.code}`}
            onPointerEnter={() => setRowHovered(true)}
            onPointerLeave={() => setRowHovered(false)}
            className={`market-map-row relative grid min-w-[980px] w-full ${marketGridColumns} items-stretch border-b border-border/25`}
            style={{
                transition: 'none',
                ...(rowHovered ? { backgroundColor: 'var(--analysis-stock-row-hover-bg)' } : {}),
            }}
        >
            <button
                type="button"
                onClick={() => onOpen(theme.code)}
                data-testid={`market-theme-${theme.code}`}
                className="market-map-open col-span-7 grid min-w-0 grid-cols-subgrid items-stretch text-left"
            >
                <span className={`${cellBase} h-[44px] gap-[11px] pl-3 pr-3`}>
                    <span
                        data-market-identity-bar
                        aria-hidden="true"
                        className="h-[10px] w-[10px] shrink-0 rounded-[2px]"
                        style={{ background: assetClassColor(theme.equity_sleeve?.asset_class_code || theme.tactical.asset_class_code || theme.code) }}
                    />
                    <span
                        data-market-identity-content
                        className={`min-w-0 ${editRailOpen ? 'ml-[68px]' : 'ml-0'}`}
                        style={{ transition: 'margin-left 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
                    >
                        <span className={`block truncate text-[13px] font-medium ${marketTextStrong}`}>{theme.display_name}</span>
                    </span>
                    {stages.map((stage) => {
                        const readout = stageReadoutSegments(stage, theme).map((segment) => segment.label).join(' · ');
                        return <span key={stage.key} data-market-stage-label={stage.key} className="sr-only">{readout === '—' ? '' : readout}</span>;
                    })}
                </span>

                <span
                    data-market-cell="direct-trend"
                    title={`${commoditySource}: ${commoditySignal === 'PENDING' ? 'not connected' : commoditySignal === 'BULL' ? 'CDF Buy' : 'CDF Sell'}. Governs the direct commodity sleeve only.`}
                    data-mobile-label="Commodity"
                    className={`${cellBase} gap-[7px] px-3`}
                >
                    <DirectionGlyph signal={commoditySignal} />
                    <span className={`text-[12px] ${commoditySignal === 'PENDING' ? marketTextFaint : marketTextStrong}`}>
                        {commoditySignal === 'PENDING' ? 'Off' : commoditySignal === 'BULL' ? 'Bull' : 'Bear'}
                    </span>
                </span>
                <span
                    data-market-commodity-return
                    data-testid={`market-commodity-return-${theme.code}`}
                    title={formatPerformanceAsOf(commodityStage?.performance_as_of)}
                    data-mobile-label="60D"
                    className={`${cellBase} justify-end px-3 text-[12px] tabular-nums ${return60DayTone(commodityStage?.return_60d_pct)}`}
                >
                    {format60DayReturn(commodityStage?.return_60d_pct)}
                </span>
                <span
                    data-market-cell="vehicle"
                    data-mobile-label="Vehicle"
                    title={vehicleApproved
                        ? `Approved direct vehicle: ${vehicleLabel}`
                        : vehicleReview
                            ? 'Direct vehicle review: the direct sleeve has a target but no approved broker vehicle.'
                            : 'Signal only: no approved broker vehicle, so the commodity trend is context only.'}
                    className={`${cellBase} pl-5 pr-3 text-[11.5px] ${vehicleApproved ? marketTextStrong : vehicleReview ? 'text-[color:var(--signal-warn)]' : marketTextFaint}`}
                >
                    <span className="truncate">{vehicleLabel}</span>
                </span>

                <span
                    data-market-cell="regime"
                    data-market-regime={regimeSignal}
                    data-mobile-label="Equity regime"
                    title={regimeSignal === 'PENDING'
                        ? `${regimePair}: not connected.`
                        : regimeOpen
                            ? `${regimePair}: CDF Buy. New producer-equity entries are permitted under normal CDF/TMS rules.`
                            : `${regimePair}: CDF Sell. New producer-equity entries, adds, breakouts and re-entries are blocked.`}
                    className={`${cellBase} gap-[8px] border-l border-border/30 px-4`}
                >
                    <DirectionGlyph signal={regimeSignal} />
                    <span className={`text-[13px] font-medium ${regimeSignal === 'PENDING' ? marketTextFaint : marketTextStrong}`}>
                        {regimeSignal === 'PENDING' ? 'Off' : regimeOpen ? 'Open' : 'Closed'}
                    </span>
                    <span data-market-identity-pair className={`truncate text-[11px] ${marketTextFaint}`}>{regimePair}</span>
                </span>
                <span
                    data-market-cell="qualifying"
                    data-mobile-label="Qualifying"
                    title={counted.length === 0
                        ? 'No eligible companies are configured.'
                        : `${evaluated > 0 ? `${qualifying} of ${evaluated} companies with complete evidence are in a CDF uptrend and outperforming ${basket}.` : 'No company has complete trend and Outperform evidence yet.'}${incomplete > 0 ? ` ${incomplete} incomplete.` : ''} ${standingMixText(counted)}.${regimeOpen ? '' : ' Entries are blocked while the equity regime is closed.'}`}
                    className={`${cellBase} gap-3 px-4`}
                >
                    {counted.length === 0 ? (
                        <span className={`text-[11.5px] ${marketTextFaint}`}>No companies</span>
                    ) : (
                        <>
                            <span className={`w-[48px] shrink-0 text-[12px] tabular-nums ${regimeOpen && qualifyingText ? marketTextStrong : marketTextFaint}`}>
                                {qualifyingText ? <>{qualifying} <span className={marketTextFaint}>of {evaluated}</span></> : '—'}
                            </span>
                            <StandingSummary counted={counted} dimmed={!regimeOpen} />
                        </>
                    )}
                </span>
                <span
                    data-market-cell="held"
                    data-mobile-label="Held / budget"
                    title={sleeve?.budget_approved
                        ? `Invested ${formatDollar(sleeve.invested_value)} of an approved ${formatDollar(sleeve.target_value)} producer-equity budget${sleeve.sleeve_cash_value > 0 ? `; ${formatDollar(sleeve.sleeve_cash_value)} class cash held` : ''}.`
                        : 'No approved producer-equity budget.'}
                    className={`${cellBase} justify-end px-4 text-[12px] tabular-nums`}
                >
                    {sleeve?.budget_approved ? (
                        <>
                            <span className={marketTextStrong}>{formatDollar(sleeve.invested_value)}</span>
                            <span className={marketTextFaint}>&thinsp;/&thinsp;{formatDollar(sleeve.target_value)}</span>
                        </>
                    ) : (
                        <span className={marketTextFaint}>—</span>
                    )}
                </span>
            </button>
            <div
                data-market-edit-hover-zone
                className="absolute left-0 top-0 z-10 h-[44px] min-w-[2.35rem] w-[min(12%,4.85rem)]"
                onPointerEnter={() => setEditRailOpen(true)}
                onPointerLeave={() => setEditRailOpen(false)}
            >
                <button
                    type="button"
                    data-testid={`market-edit-${theme.code}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        onEdit(theme);
                    }}
                    onFocus={() => setEditRailOpen(true)}
                    onBlur={() => setEditRailOpen(false)}
                    title={`Edit ${theme.display_name} market configuration`}
                    aria-label={`Edit ${theme.display_name} market configuration`}
                    className={`absolute left-[14px] top-1/2 flex h-[24px] -translate-y-1/2 items-center gap-[6px] overflow-hidden border-0 bg-transparent px-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.08em] transition-[width,opacity,transform,color] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                        editRailOpen
                            ? 'w-[68px] translate-x-0 opacity-100'
                            : 'pointer-events-none w-0 -translate-x-2 px-0 opacity-0'
                    } ${marketTextMuted} hover:text-[color:var(--analysis-text-strong)] focus:pointer-events-auto focus:w-[68px] focus:translate-x-0 focus:opacity-100`}
                >
                    <Pencil className="h-[14px] w-[14px] shrink-0" />
                    <span className="shrink-0">Edit</span>
                </button>
            </div>
            <div className="market-map-actions flex h-[44px] min-w-0 items-center justify-end gap-0.5 pr-2">
                {needsSetup ? (
                    <button
                        type="button"
                        data-testid={`market-next-step-${theme.code}`}
                        onClick={nextStep.opensAlerts ? onOpenAlerts : () => onOpen(theme.code)}
                        title={`${nextStep.label}. ${nextStep.detail}`}
                        aria-label={`${theme.display_name}: ${nextStep.label}. ${nextStep.opensAlerts ? 'Open Alerts' : 'Open market details'}`}
                        className="market-map-next-step grid h-[28px] w-[28px] place-items-center rounded-[4px] text-[color:var(--signal-warn)] transition-colors duration-100 hover:bg-muted/[0.14]"
                    >
                        <Plug className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
                        <span className="sr-only">{nextStep.label}</span>
                    </button>
                ) : null}
                <button
                    type="button"
                    data-testid={`market-stock-evidence-toggle-${theme.code}`}
                    data-market-evidence-control
                    onClick={() => setEvidenceExpanded((current) => !current)}
                    aria-controls={`market-stock-evidence-${theme.code}`}
                    aria-expanded={evidenceExpanded}
                    aria-label={`${evidenceExpanded ? 'Hide' : 'Show'} ${theme.display_name} stock evidence`}
                    title={`${evidenceExpanded ? 'Hide' : 'Show'} company evidence`}
                    className="grid h-[28px] w-[28px] place-items-center rounded-[4px] text-[color:var(--analysis-ticker-text)] transition-colors duration-100 hover:bg-muted/[0.14] hover:text-[color:var(--analysis-text-strong)]"
                >
                    <ChevronDown
                        data-market-evidence-icon
                        strokeWidth={2.2}
                        className={`h-[16px] w-[16px] transition-transform ${evidenceExpanded ? 'rotate-180' : ''}`}
                    />
                </button>
            </div>
            {evidenceExpanded ? <MarketMapStockEvidence theme={theme} /> : null}
        </div>
    );
}

export function CommodityMarketMap() {
    const { navigateToTab } = useStockTableContext();
    const [themes, setThemes] = useState<CommodityTheme[]>([]);
    const [details, setDetails] = useState<ThemeDetails>({});
    const [selectedCode, setSelectedCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshingPriceHistory, setRefreshingPriceHistory] = useState(false);
    const [priceRefreshError, setPriceRefreshError] = useState<string | null>(null);
    const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
    const [configurationTarget, setConfigurationTarget] = useState<CommodityTheme | 'NEW' | null>(null);

    const loadThemes = useCallback(async () => {
        try {
            const response = await api.getCommodityThemes({ includeSecurities: true });
            setThemes(response.themes);
            setError(null);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Market data unavailable');
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshPriceHistory = useCallback(async () => {
        setRefreshingPriceHistory(true);
        setPriceRefreshError(null);
        try {
            const result = await api.refreshCommodityThemePriceHistory();
            if (result.errors.length > 0) {
                setPriceRefreshError(result.errors[0] || 'Some direct price sources could not be refreshed.');
            }
            await loadThemes();
        } catch (requestError) {
            setPriceRefreshError(requestError instanceof Error ? requestError.message : 'Failed to refresh direct prices.');
        } finally {
            setRefreshingPriceHistory(false);
        }
    }, [loadThemes]);

    useEffect(() => {
        return subscribePoll(loadThemes, 30_000);
    }, [loadThemes]);

    useEffect(() => {
        let cancelled = false;
        void api.getAssetClasses()
            .then((response) => {
                if (!cancelled) setAssetClasses(response);
            })
            .catch(() => {
                if (!cancelled) setAssetClasses([]);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const syncMarketRoute = () => {
            const route = readTerminalRoute();
            setSelectedCode(route?.tab === 'MARKETS' ? route.marketCode ?? null : null);
        };
        syncMarketRoute();
        window.addEventListener('popstate', syncMarketRoute);
        window.addEventListener('hashchange', syncMarketRoute);
        return () => {
            window.removeEventListener('popstate', syncMarketRoute);
            window.removeEventListener('hashchange', syncMarketRoute);
        };
    }, []);

    useEffect(() => {
        if (!selectedCode || details[selectedCode]) return;
        let cancelled = false;
        void api.getCommodityTheme(selectedCode)
            .then((theme) => {
                if (!cancelled) setDetails((current) => ({ ...current, [theme.code]: theme }));
            })
            .catch((requestError) => {
                if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Market detail unavailable');
            });
        return () => { cancelled = true; };
    }, [details, selectedCode]);

    const selectedTheme = selectedCode ? details[selectedCode] : null;
    const openRegimeCount = useMemo(() => themes.filter((theme) =>
        themeStageSignal(theme.stages.find((stage) => stage.key === 'EQUITY_RELATIVE')) === 'BULL',
    ).length, [themes]);
    const groupedThemes = useMemo(() => {
        const groups = new Map<string, { label: string; themes: CommodityTheme[] }>();
        themes.forEach((theme) => {
            const label = theme.market_group?.trim() || defaultMarketGroupFor(theme.code);
            const key = label.toLowerCase();
            const group = groups.get(key) || { label, themes: [] };
            group.themes.push(theme);
            groups.set(key, group);
        });
        const ordered = themeGroups
            .map((group) => groups.get(group.label.toLowerCase()))
            .filter((group): group is { label: string; themes: CommodityTheme[] } => Boolean(group));
        const knownLabels = new Set(ordered.map((group) => group.label.toLowerCase()));
        const remaining = [...groups.values()]
            .filter((group) => !knownLabels.has(group.label.toLowerCase()))
            .sort((left, right) => left.label.localeCompare(right.label));
        return [...ordered, ...remaining];
    }, [themes]);
    if (selectedCode && !selectedTheme) {
        return (
            <div className={`flex h-full items-center justify-center gap-2 text-[11px] ${marketTextMuted}`}>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading market evidence
            </div>
        );
    }
    if (selectedTheme) {
        return (
            <MarketDetail
                theme={selectedTheme}
                onBack={() => {
                    const routeState = currentTerminalRouteState();
                    if (routeState?.tab === 'MARKETS' && routeState.marketCode === selectedTheme.code) {
                        window.history.back();
                        return;
                    }
                    replaceTerminalRoute({ tab: 'MARKETS' });
                    setSelectedCode(null);
                }}
            />
        );
    }
    if (loading) {
        return <div className={`flex h-full items-center justify-center gap-2 text-[11px] ${marketTextMuted}`}><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading market map</div>;
    }
    if (error) {
        return <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--signal-sell)]">Market map unavailable: {error}</div>;
    }

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--panel-bg-alt)]">
            <header className="flex shrink-0 items-end justify-between border-b border-border/45 px-5 py-3.5 md:px-7">
                <div>
                    <h1 className={`text-[14px] font-semibold uppercase tracking-[0.075em] ${marketTextStrong}`}>Market Map</h1>
                    <p className={`mt-0.5 text-[10px] ${marketTextMuted}`}>Direct commodity trend beside the producer-equity regime and the companies that qualify within it</p>
                </div>
                <div className="flex items-center gap-[8px]">
                    <DataFreshnessIndicator datasets={['COMMODITY_PRICE_HISTORY']} actions={{ COMMODITY_PRICE_HISTORY: { label: 'Refresh commodity history', run: refreshPriceHistory, disabled: refreshingPriceHistory } }} />
                    <button
                        type="button"
                        data-testid="market-add"
                        onClick={() => setConfigurationTarget('NEW')}
                        aria-label="Add market pair"
                        title="Add market pair"
                        className={`grid h-[36px] w-[36px] place-items-center rounded-[4px] border border-border/45 bg-muted/[0.06] ${marketTextMuted} transition-colors duration-100 hover:border-border/80 hover:bg-muted/[0.14] hover:text-[color:var(--analysis-text-strong)]`}
                    >
                        <Plus className="h-[16px] w-[16px]" strokeWidth={2.3} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        data-testid="market-price-history-refresh"
                        onClick={() => void refreshPriceHistory()}
                        disabled={refreshingPriceHistory}
                        aria-label="Refresh direct commodity price history"
                        title={priceRefreshError || 'Refresh direct commodity price history'}
                        className={`grid h-[36px] w-[36px] place-items-center rounded-[4px] border border-border/45 bg-muted/[0.06] transition-colors duration-100 hover:border-border/80 hover:bg-muted/[0.14] disabled:cursor-wait disabled:opacity-60 ${
                            priceRefreshError ? 'text-[color:var(--signal-sell)]' : marketTextMuted
                        }`}
                    >
                        <RefreshCw className={`h-[16px] w-[16px] ${refreshingPriceHistory ? 'animate-spin' : ''}`} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                    <p className={`font-mono text-[11px] uppercase tracking-[0.06em] ${marketTextFaint}`}>
                        <span data-testid="market-open-regime-count">{openRegimeCount} of {themes.length} equity regimes open</span>
                    </p>
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4 md:px-7">
                <div className="market-map-list min-w-[980px]">
                    <div className="market-map-header">
                        <div className={`grid ${marketGridColumns} text-[10px] font-semibold uppercase tracking-[0.08em] ${marketTextFaint}`}>
                            <span />
                            <span className="col-span-3 mx-3 border-b border-border/40 pb-1.5 pt-1">Direct commodity</span>
                            <span className="col-span-3 border-l border-border/30 px-4 pt-1">
                                <span className="block border-b border-border/40 pb-1.5">Producer equities</span>
                            </span>
                            <span />
                        </div>
                        <div className={`grid ${marketGridColumns} border-b border-border/40 text-[10px] font-semibold uppercase tracking-[0.08em] ${marketTextMuted}`}>
                            <span className="px-3 py-2">Market</span>
                            <span className="px-3 py-2">Trend</span>
                            <span className="px-3 py-2 text-right">60D</span>
                            <span className="py-2 pl-5 pr-3">Vehicle</span>
                            <span className="border-l border-border/30 px-4 py-2">Equity regime</span>
                            <span className="px-4 py-2">Qualifying</span>
                            <span className="px-4 py-2 text-right">Held / budget</span>
                            <span aria-hidden="true" />
                        </div>
                    </div>
                    {groupedThemes.map((group) => (
                        <section key={group.label}>
                            <h2 className={`flex items-center gap-3 border-b border-border/25 px-3 pb-2 pt-5 text-[11px] font-medium ${marketTextMuted}`}>
                                <span>{group.label}</span>
                            </h2>
                            {group.themes.map((theme) => (
                                <ThemeRow
                                    key={theme.code}
                                    theme={theme}
                                    onOpen={(code) => {
                                        pushTerminalRoute({ tab: 'MARKETS', marketCode: code });
                                        setSelectedCode(code);
                                    }}
                                    onOpenAlerts={() => navigateToTab('ALERTS')}
                                    onEdit={(nextTheme) => setConfigurationTarget(nextTheme)}
                                />
                            ))}
                        </section>
                    ))}
                </div>
            </div>
            {configurationTarget ? (
                <MarketConfigurationDialog
                    theme={configurationTarget === 'NEW' ? null : configurationTarget}
                    assetClasses={assetClasses}
                    onClose={() => setConfigurationTarget(null)}
                    onSaved={(updatedTheme) => {
                        setThemes((current) => {
                            const exists = current.some((theme) => theme.code === updatedTheme.code);
                            return exists
                                ? current.map((theme) => theme.code === updatedTheme.code ? updatedTheme : theme)
                                : [...current, updatedTheme];
                        });
                        setDetails((current) => ({ ...current, [updatedTheme.code]: updatedTheme }));
                        window.dispatchEvent(new Event('alpha-edge:commodity-theme-configuration-changed'));
                    }}
                    onRemoved={(code) => {
                        setThemes((current) => current.filter((theme) => theme.code !== code));
                        setDetails((current) => {
                            const next = { ...current };
                            delete next[code];
                            return next;
                        });
                        window.dispatchEvent(new Event('alpha-edge:commodity-theme-configuration-changed'));
                    }}
                />
            ) : null}
        </div>
    );
}
