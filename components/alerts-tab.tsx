'use client';
import { subscribePoll } from '@/lib/polling';

import { useStore } from '@/lib/store';
import { managementTicker, useETFManagement } from '@/lib/etf-management-store';
import { isNonAllocatingSecurityType } from '@/lib/security-types';
import { api, type CommodityTheme } from '@/lib/api';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { ArrowRight, Check, Mail, Pencil, Plus, Search, X } from 'lucide-react';
import { useAnnouncementSubscriptions } from '@/lib/use-announcement-subscriptions';
import { AnnouncementSubscriptions } from '@/components/announcement-subscriptions';
import styles from './alerts-tab.module.css';
import { canonicalAlertScript as canonicalScript, normalizeConnectionTicker, outperformBenchmarksFromThemes } from '@/lib/monitoring-coverage';

const alertSymbol = (ticker: string) => ticker.split(':').pop()?.toUpperCase() || '';

const alertTargetLabel = (ticker: string) => {
    const assetClass = ticker.match(/^(?:THEME|ASSET_CLASS):(.+)$/i)?.[1];
    if (!assetClass) return ticker || '—';
    return assetClass
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const getFullTicker = (ticker: string, prefix: string) => {
    const normalizedPrefix = prefix.trim() || 'ASX:';
    return normalizedPrefix.endsWith(':') ? `${normalizedPrefix}${ticker}` : `${normalizedPrefix}:${ticker}`;
};

const hasDirectionalThemeState = (status?: string) =>
    status === 'CONFIRMED' || status === 'BLOCKED';

type SortField = 'ticker' | 'name' | 'status';
type SortDirection = 'asc' | 'desc';
type FilterMode = 'all' | 'connected' | 'partial' | 'none';
type AlertScope = 'positions' | 'watchlist' | 'commodities' | 'system' | 'announcements';
type AlertSetupScript = 'cdf' | 'tms' | 'etf_tms';

const alertScriptMatches = (script: string, target: string) =>
    canonicalScript(script) === canonicalScript(target);

interface AlertSetupTarget {
    ticker: string;
    fullTicker: string;
    name: string;
    script: AlertSetupScript;
    existingPriceTarget?: number;
}

interface AlertRemoveTarget {
    fullTicker: string;
    name: string;
    script: AlertSetupScript;
    label: string;
}

interface CommodityFeedSetupTarget {
    theme: string;
    stage: 'COMMODITY' | 'EQUITY_RELATIVE' | 'SECURITY_OUTPERFORM';
    name: string;
    connectionTicker: string;
    securityTicker?: string;
}

function ConnectionControl({
    checked,
    label,
    onClick,
    disabled = false,
}: {
    checked: boolean;
    label: string;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            className={styles.connectionControl}
            role="checkbox"
            aria-label={label}
            aria-checked={checked}
            title={label}
            disabled={disabled}
            onClick={() => void onClick()}
        >
            <span className={`${styles.connectionBox} ${checked ? styles.connectionBoxChecked : ''}`}>
                {checked && <Check size={11} strokeWidth={2.6} aria-hidden="true" />}
            </span>
        </button>
    );
}

function ConnectionStatus({ status }: { status: 'connected' | 'partial' | 'none' }) {
    const label = status === 'connected' ? 'Connected' : status === 'partial' ? 'Partial' : 'Not connected';
    return (
        <span className={`${styles.connectionStatus} ${styles[`status_${status}`]}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {label}
        </span>
    );
}

function AlertSetupModal({
    target,
    onClose,
    onConfirm,
}: {
    target: AlertSetupTarget;
    onClose: () => void;
    onConfirm: (positionState?: 'BUY' | 'SELL', analystPriceTarget?: number) => Promise<void>;
}) {
    const [positionState, setPositionState] = useState<'BUY' | 'SELL'>('BUY');
    const [priceTarget, setPriceTarget] = useState(
        target.existingPriceTarget && target.existingPriceTarget > 0 ? String(target.existingPriceTarget) : ''
    );
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const scriptLabel = target.script === 'tms' ? 'TMS' : target.script === 'etf_tms' ? 'ETF TMS' : 'CDF';
    const needsInitialState = target.script !== 'tms';
    const stateLabel = target.script === 'etf_tms' ? 'CURRENT ETF STATE' : 'CURRENT CDF STATE';

    const handleConfirm = async () => {
        setIsSaving(true);
        setError('');
        try {
            const parsedTarget = priceTarget.trim() ? Number(priceTarget) : undefined;
            if (parsedTarget !== undefined && (!Number.isFinite(parsedTarget) || parsedTarget < 0)) {
                throw new Error('Price target must be a positive number');
            }
            await onConfirm(needsInitialState ? positionState : undefined, parsedTarget);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to initialise alert');
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.modalBackdrop} onClick={onClose}>
            <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>Initialise {scriptLabel}</div>
                    <div className={styles.modalSubtitle}>
                        {target.name} · {target.fullTicker}
                    </div>
                </div>

                <div className={styles.modalBody}>
                    {needsInitialState ? (
                        <div>
                            <div className={styles.fieldLabel}>{stateLabel}</div>
                            <div className={styles.stateSelector}>
                                {(['BUY', 'SELL'] as const).map((state) => (
                                    <button
                                        key={state}
                                        type="button"
                                        onClick={() => setPositionState(state)}
                                        className={`${styles.stateButton} ${positionState === state ? state === 'BUY' ? styles.stateBuy : styles.stateSell : ''}`}
                                    >
                                        {state}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className={styles.modalNotice}>
                            TMS setup only registers the alert as active. Trade actions come from ADD, TRIM, SELL and RE-ENTRY alerts.
                        </div>
                    )}

                    <div>
                        <label className={styles.fieldLabel}>
                            PRICE TARGET OPTIONAL
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={priceTarget}
                            onChange={(event) => setPriceTarget(event.target.value)}
                            placeholder="Leave blank if none"
                            className={styles.modalInput}
                        />
                    </div>

                    {error && <div className={styles.modalError}>{error}</div>}
                </div>

                <div className={styles.modalFooter}>
                    <button type="button" onClick={onClose} className={styles.modalSecondary}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSaving}
                        className={styles.modalAction}
                    >
                        {isSaving ? 'Saving...' : 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CommodityFeedSetupModal({
    target,
    onClose,
    onConfirm,
}: {
    target: CommodityFeedSetupTarget;
    onClose: () => void;
    onConfirm: (signal: 'BUY' | 'SELL') => Promise<void>;
}) {
    const [signal, setSignal] = useState<'BUY' | 'SELL' | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleConfirm = async () => {
        if (!signal) {
            setError('Select the current trend before registering this feed.');
            return;
        }
        setIsSaving(true);
        setError('');
        try {
            await onConfirm(signal);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to initialise commodity feed');
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.modalBackdrop} onClick={onClose}>
            <div data-testid="commodity-feed-setup-modal" className={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>Initialise CDF feed</div>
                    <div className={styles.modalSubtitle}>
                        {target.name} · {target.connectionTicker}
                    </div>
                </div>

                <div className={styles.modalBody}>
                    <div>
                        <div className={styles.fieldLabel}>CURRENT CDF STATE</div>
                        <div className={styles.stateSelector}>
                            {(['BUY', 'SELL'] as const).map((state) => (
                                <button
                                    key={state}
                                    type="button"
                                    onClick={() => setSignal(state)}
                                    className={`${styles.stateButton} ${signal === state ? state === 'BUY' ? styles.stateBuy : styles.stateSell : ''}`}
                                >
                                    {state}
                                </button>
                            ))}
                        </div>
                    </div>
                    {error && <div className={styles.modalError}>{error}</div>}
                </div>

                <div className={styles.modalFooter}>
                    <button type="button" onClick={onClose} className={styles.modalSecondary}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSaving}
                        className={styles.modalAction}
                    >
                        {isSaving ? 'Saving...' : 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function AlertRemoveModal({
    target,
    onClose,
    onConfirm,
}: {
    target: AlertRemoveTarget;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}) {
    const [isRemoving, setIsRemoving] = useState(false);
    const [error, setError] = useState('');

    const handleConfirm = async () => {
        setIsRemoving(true);
        setError('');
        try {
            await onConfirm();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove alert setup');
            setIsRemoving(false);
        }
    };

    return (
        <div className={styles.modalBackdrop} onClick={onClose}>
            <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>Remove {target.label}</div>
                    <div className={styles.modalSubtitle}>
                        {target.name} · {target.fullTicker}
                    </div>
                </div>

                <div className={styles.modalBody}>
                    <div className={styles.modalNotice}>This removes the saved connection from Alpha Edge. It does not delete the alert in TradingView.</div>
                    {error && <div className={styles.modalError}>{error}</div>}
                </div>

                <div className={styles.modalFooter}>
                    <button type="button" onClick={onClose} className={styles.modalSecondary}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isRemoving}
                        className={styles.modalDanger}
                    >
                        {isRemoving ? 'Removing...' : 'Remove'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function WatchlistAddModal({
    onClose,
    onConfirm,
}: {
    onClose: () => void;
    onConfirm: (payload: {
        name: string;
        fullTicker: string;
        initialiseCdf: boolean;
        cdfState: 'BUY' | 'SELL';
    }) => Promise<void>;
}) {
    const [name, setName] = useState('');
    const [ticker, setTicker] = useState('');
    const [initialiseCdf, setInitialiseCdf] = useState(true);
    const [cdfState, setCdfState] = useState<'BUY' | 'SELL'>('BUY');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleConfirm = async () => {
        setIsSaving(true);
        setError('');
        try {
            const cleanName = name.trim();
            const cleanTicker = ticker.trim().toUpperCase();
            if (!cleanName || !cleanTicker) throw new Error('Name and ticker are required');
            await onConfirm({
                name: cleanName,
                fullTicker: cleanTicker.includes(':') ? cleanTicker : `ASX:${cleanTicker}`,
                initialiseCdf,
                cdfState,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add watchlist entry');
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.modalBackdrop} onClick={onClose}>
            <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>Add watchlist entry</div>
                </div>

                <div className={styles.modalBody}>
                    <div>
                        <label className={styles.fieldLabel}>COMPANY</label>
                        <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className={styles.modalInput}
                        />
                    </div>
                    <div>
                        <label className={styles.fieldLabel}>TICKER</label>
                        <input
                            value={ticker}
                            onChange={(event) => setTicker(event.target.value.toUpperCase())}
                            placeholder="ASX:AEE"
                            className={styles.modalInput}
                        />
                    </div>
                    <label className={styles.checkboxRow}>
                        <input
                            type="checkbox"
                            checked={initialiseCdf}
                            onChange={(event) => setInitialiseCdf(event.target.checked)}
                            className={styles.formCheckbox}
                        />
                        <span>Initialise CDF</span>
                    </label>
                    {initialiseCdf && (
                        <div className={styles.stateSelector}>
                            {(['BUY', 'SELL'] as const).map((state) => (
                                <button
                                    key={state}
                                    type="button"
                                    onClick={() => setCdfState(state)}
                                    className={`${styles.stateButton} ${cdfState === state ? state === 'BUY' ? styles.stateBuy : styles.stateSell : ''}`}
                                >
                                    {state}
                                </button>
                            ))}
                        </div>
                    )}
                    {error && <div className={styles.modalError}>{error}</div>}
                </div>

                <div className={styles.modalFooter}>
                    <button type="button" onClick={onClose} className={styles.modalSecondary}>
                        Cancel
                    </button>
                    <button type="button" onClick={handleConfirm} disabled={isSaving} className={styles.modalAction}>
                        {isSaving ? 'Adding...' : 'Add'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AlertsTab() {
    const announcements = useAnnouncementSubscriptions();
    const announcementPending = announcements.items.filter(item => !item.configured).length;
    const announcementScopeRef = useRef<HTMLButtonElement>(null);
    const managementModes = useETFManagement(state => state.modes);
    const managementReady = useETFManagement(state => state.ready);
    const activeAlerts = useStore((state) => state.activeAlerts);
    const fetchActiveAlerts = useStore((state) => state.fetchActiveAlerts);
    const allStocks = useStore((state) => state.stocks);
    const stocks = useMemo(
        () =>
            allStocks.filter(
                (stock) => !isNonAllocatingSecurityType(stock.securityType),
            ),
        [allStocks],
    );
    const updateStock = useStore((state) => state.updateStock);
    const fetchHoldings = useStore((state) => state.fetchHoldings);

    const [activeScope, setActiveScope] = useState<AlertScope>('positions');
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const [searchTicker, setSearchTicker] = useState('');
    const [watchlistSearch, setWatchlistSearch] = useState('');
    const [commoditySearch, setCommoditySearch] = useState('');
    const [sortField, setSortField] = useState<SortField>('ticker');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [setupTarget, setSetupTarget] = useState<AlertSetupTarget | null>(null);
    const [commoditySetupTarget, setCommoditySetupTarget] = useState<CommodityFeedSetupTarget | null>(null);
    const [showAddWatchlist, setShowAddWatchlist] = useState(false);
    const [commodityThemes, setCommodityThemes] = useState<CommodityTheme[]>([]);

    // Inline ticker editing
    const [showTickerEdit, setShowTickerEdit] = useState<Record<number, boolean>>({});
    const [tickerInput, setTickerInput] = useState('');
    const [prefixInput, setPrefixInput] = useState('');

    const toggleTickerEdit = (stockId: number, currentSymbol: string, currentPrefix: string) => {
        const isOpen = showTickerEdit[stockId];
        // Force one-at-a-time: close all others before opening
        setShowTickerEdit(isOpen ? {} : { [stockId]: true });
        if (!isOpen) {
            setTickerInput(currentSymbol || '');
            setPrefixInput(currentPrefix || '');
        }
    };

    const handleTickerSave = async (stockId: number, stockName: string) => {
        if (!tickerInput.trim() || !prefixInput.trim()) return;
        try {
            const normalizedPrefix = (() => {
                const raw = prefixInput.trim().toUpperCase();
                return raw.endsWith(':') ? raw : `${raw}:`;
            })();
            await api.updateTickerMapping(stockName, tickerInput.trim().toUpperCase(), normalizedPrefix);
            setShowTickerEdit(prev => ({ ...prev, [stockId]: false }));
            await fetchHoldings();
        } catch (error) {
            console.error('[ALERTS TAB] Failed to update ticker mapping:', error);
        }
    };

    useEffect(() => {
        return subscribePoll(fetchActiveAlerts, 30000);
    }, [fetchActiveAlerts]);

    const fetchCommodityThemes = useCallback(async () => {
        try {
            const response = await api.getCommodityThemes({ includeSecurities: true });
            setCommodityThemes(response.themes || []);
        } catch {
            setCommodityThemes([]);
        }
    }, []);

    useEffect(() => {
        void fetchCommodityThemes();
        const refreshCommodityThemes = () => void fetchCommodityThemes();
        window.addEventListener('alpha-edge:commodity-theme-configuration-changed', refreshCommodityThemes);
        return () => window.removeEventListener('alpha-edge:commodity-theme-configuration-changed', refreshCommodityThemes);
    }, [fetchCommodityThemes]);

    const cdfConnections = useMemo(() => {
        const connections = new Map<string, (typeof activeAlerts)[number]>();
        activeAlerts.forEach((alert) => {
            if (alertScriptMatches(alert.script, 'cdf')) {
                connections.set(normalizeConnectionTicker(alert.ticker), alert);
            }
        });
        return connections;
    }, [activeAlerts]);

    const commodityCoreFundsByAssetClass = useMemo(
        () => outperformBenchmarksFromThemes(commodityThemes), [commodityThemes],
    );

    const commodityThemeCodesByAssetClass = useMemo(() => {
        const themeCodes = new Map<string, string>();
        commodityThemes.forEach((theme) => {
            const assetClass = theme.tactical?.asset_class_code?.trim().toUpperCase();
            if (assetClass) themeCodes.set(assetClass, theme.code);
        });
        return themeCodes;
    }, [commodityThemes]);

    const commodityOutperformStatesBySecurity = useMemo(() => {
        const states = new Map<string, string>();
        commodityThemes.forEach((theme) => {
            theme.eligible_securities?.forEach((security) => {
                states.set(
                    `${theme.code}:${normalizeConnectionTicker(security.ticker)}`,
                    security.stage_states.SECURITY_OUTPERFORM || 'DISCONNECTED',
                );
            });
        });
        return states;
    }, [commodityThemes]);

    // Helper: resolve connection status for a symbol against activeAlerts
    const resolveStatus = (symbol: string, isETF: boolean) => {
        const sym = symbol.toUpperCase();
        const match = (a: { ticker: string; script: string }, script: string) =>
            !a.ticker.includes('/') &&
            a.ticker.split(':').pop()?.toUpperCase() === sym &&
            alertScriptMatches(a.script, script);
        if (isETF) {
            const hasEtfTms = activeAlerts.some(a => match(a, 'etf_tms'));
            return { hasCDF: false, hasATR: hasEtfTms, status: hasEtfTms ? 'connected' : 'none' as const };
        }
        const hasCDF = activeAlerts.some(a => match(a, 'cdf'));
        const hasATR = activeAlerts.some(a => match(a, 'tms'));
        return { hasCDF, hasATR, status: (hasATR && hasCDF ? 'connected' : (hasCDF || hasATR ? 'partial' : 'none')) as 'connected' | 'partial' | 'none' };
    };

    // Connection monitor — HELD POSITIONS only (excludes analysis watchlist items)
    const stockConnections = useMemo(() => {
        if (!Array.isArray(stocks) || !Array.isArray(activeAlerts)) return [];
        return stocks
            .filter(stock => !stock.isWatchlist)
            .map(stock => {
                const isETF = (stock.securityType || '').toUpperCase() === 'ETF';
                const usesETFTMS = isETF && managementModes[managementTicker(stock.symbol || '')] !== 'tms';
                const { hasCDF, hasATR, status } = isETF && !managementReady ? { hasCDF: false, hasATR: false, status: 'none' as const } : resolveStatus(stock.symbol || '', usesETFTMS);
                const fullTicker = getFullTicker(stock.symbol || '', stock.prefix || '');
                const coreFund = !isETF && stock.primaryAssetClass
                    ? commodityCoreFundsByAssetClass.get(stock.primaryAssetClass.trim().toUpperCase())
                    : undefined;
                const outperformTheme = !isETF && stock.primaryAssetClass
                    ? commodityThemeCodesByAssetClass.get(stock.primaryAssetClass.trim().toUpperCase())
                    : undefined;
                const outperformTicker = coreFund && stock.symbol
                    ? `${fullTicker}/${coreFund}`
                    : undefined;
                const outperformAlert = outperformTicker
                    ? cdfConnections.get(normalizeConnectionTicker(outperformTicker))
                    : undefined;
                const outperformState = outperformTheme
                    ? commodityOutperformStatesBySecurity.get(`${outperformTheme}:${normalizeConnectionTicker(fullTicker)}`)
                    : undefined;
                return {
                    id: stock.id,
                    analysisId: stock.analysisId,
                    ticker: stock.symbol,
                    prefix: stock.prefix || '',
                    name: stock.name,
                    isETF,
                    usesETFTMS,
                    securityType: stock.securityType || null,
                    primaryAssetClass: stock.primaryAssetClass || null,
                    hasCDF,
                    hasATR,
                    hasOutperform: !!outperformAlert,
                    outperformTicker,
                    outperformAlert,
                    outperformTheme,
                    outperformInitialised: hasDirectionalThemeState(outperformState),
                    status,
                    analystPT: stock.analystPT,
                };
            });
    }, [stocks, activeAlerts, managementModes, managementReady, commodityCoreFundsByAssetClass, commodityThemeCodesByAssetClass, commodityOutperformStatesBySecurity, cdfConnections]);

    const commodityConnections = useMemo(() => {
        return commodityThemes.map((theme) => {
            const physical = theme.stages.find((stage) => stage.key === 'COMMODITY');
            const equities = theme.stages.find((stage) => stage.key === 'EQUITY_RELATIVE');
            const physicalTicker = physical?.source.symbol?.trim().toUpperCase() || '';
            const equityNumerator = equities?.source.numerator?.trim().toUpperCase() || '';
            const equityDenominator = equities?.source.denominator?.trim().toUpperCase() || '';

            const equitiesTicker = equityNumerator && equityDenominator ? `${equityNumerator}/${equityDenominator}` : '';
            const equitiesDisplayTicker = `${equityNumerator || 'Missing ticker'} / ${equityDenominator || 'Missing ticker'}`;
            const physicalAlert = physicalTicker
                ? cdfConnections.get(normalizeConnectionTicker(physicalTicker))
                : undefined;
            const equitiesAlert = equitiesTicker
                ? cdfConnections.get(normalizeConnectionTicker(equitiesTicker))
                : undefined;
            const configuredCount = Number(Boolean(physicalAlert)) + Number(Boolean(equitiesAlert));

            return {
                code: theme.code,
                name: theme.display_name,
                physicalLabel: physical?.source.label || 'Physical commodity',
                physicalTicker,
                physicalAlert,
                physicalInitialised: hasDirectionalThemeState(physical?.status),
                equitiesLabel: equities?.source.label || 'Equities trend',
                equitiesTicker,
                equitiesDisplayTicker,
                equitiesAlert,
                equitiesInitialised: hasDirectionalThemeState(equities?.status),
                status: configuredCount === 2 ? 'connected' : configuredCount === 1 ? 'partial' : 'none',
            };
        });
    }, [commodityThemes, cdfConnections]);

    // Watchlist deployment filter coverage. This is CDF-only; TMS belongs to active positions.
    const watchlistMonitoring = useMemo(() => {
        if (!Array.isArray(activeAlerts) || !Array.isArray(stocks) || stocks.length === 0) return [];

        const heldSymbols = new Set(
            stocks
                .filter(s => !s.isWatchlist && s.symbol)
                .map(s => s.symbol!.toUpperCase())
        );
        const results = new Map<string, { symbol: string; fullTicker: string; name: string; prefix: string; hasCDF: boolean; analystPT?: number; script: 'cdf' | 'etf_tms'; isETF?: boolean }>();

        stocks.filter(s => s.isWatchlist && s.symbol).forEach(stock => {
            const sym = stock.symbol!.toUpperCase();
            if (heldSymbols.has(sym)) return;

            const isETF = stock.securityType?.toUpperCase() === 'ETF';
            const script = isETF && managementModes[sym] !== 'tms' ? 'etf_tms' : 'cdf';

            const cdfAlert = activeAlerts.find(a =>
                !a.ticker.includes('/') &&
                alertSymbol(a.ticker) === sym &&
                alertScriptMatches(a.script, script)
            );
            results.set(sym, {
                symbol: sym,
                fullTicker: cdfAlert?.ticker || getFullTicker(stock.symbol || sym, stock.prefix || ''),
                script,
                isETF,
                name: stock.name,
                prefix: stock.prefix || '',
                hasCDF: !!cdfAlert,
                analystPT: stock.analystPT,
            });
        });

        // Orphaned CDF setups still matter: TradingView is running but the app cannot map the symbol to a current row.
        const allKnownSymbols = new Set(stocks.map(s => s.symbol?.toUpperCase()).filter(Boolean));
        for (const alert of activeAlerts) {
            if (!alertScriptMatches(alert.script, 'cdf') || alert.ticker.includes('/')) continue;
            const sym = alertSymbol(alert.ticker);
            if (!sym || allKnownSymbols.has(sym) || heldSymbols.has(sym) || results.has(sym)) continue;
            results.set(sym, {
                symbol: sym,
                fullTicker: alert.ticker,
                name: sym,
                script: 'cdf',
                prefix: alert.ticker.includes(':') ? alert.ticker.slice(0, alert.ticker.indexOf(':') + 1) : '',
                hasCDF: true,
            });
        }

        return Array.from(results.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
    }, [activeAlerts, stocks, managementModes]);

    const filteredWatchlistMonitoring = useMemo(() => {
        const q = watchlistSearch.trim().toLowerCase();
        return watchlistMonitoring.filter((item) => {
            const status = item.hasCDF ? 'connected' : 'none';
            if (filterMode !== 'all' && status !== filterMode) return false;
            if (!q) return true;
            return item.symbol.toLowerCase().includes(q) ||
                item.fullTicker.toLowerCase().includes(q) ||
                item.name.toLowerCase().includes(q);
        });
    }, [filterMode, watchlistMonitoring, watchlistSearch]);

    const staleTmsMonitoring = useMemo(() => {
        if (!Array.isArray(activeAlerts) || !Array.isArray(stocks)) return [];
        const heldSymbols = new Set(
            stocks
                .filter(s => !s.isWatchlist && s.symbol)
                .map(s => s.symbol!.toUpperCase())
        );
        const knownSymbols = new Set(stocks.map(s => s.symbol?.toUpperCase()).filter(Boolean));
        const stale = new Map<string, { symbol: string; fullTicker: string; reason: string }>();

        activeAlerts.forEach(alert => {
            if (!alertScriptMatches(alert.script, 'tms')) return;
            const sym = alertSymbol(alert.ticker);
            if (!sym || heldSymbols.has(sym)) return;
            stale.set(sym, {
                symbol: sym,
                fullTicker: alert.ticker,
                reason: knownSymbols.has(sym) ? 'watchlist row has TMS' : 'no active holding row',
            });
        });

        return Array.from(stale.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
    }, [activeAlerts, stocks]);

    // Portfolio detector registrations are expected running webhook setups.
    const regimeGroups = useMemo(() => {
        if (!Array.isArray(activeAlerts)) return { equities: [], commodities: [], sizing: [] };
        return {
            equities: activeAlerts.filter(a => alertScriptMatches(a.script, 'q4d')),
            commodities: activeAlerts.filter(a => alertScriptMatches(a.script, 'ctf')),
            sizing: activeAlerts.filter(a => alertScriptMatches(a.script, 'q3d')),
        };
    }, [activeAlerts]);

    const detectorRows = useMemo(() => ([
        { label: 'Q4', script: 'q4d', description: 'Crisis detector', items: regimeGroups.equities },
        { label: 'CTF', script: 'ctf', description: 'Commodity regime detector', items: regimeGroups.commodities },
        { label: 'Q3', script: 'q3d', description: 'Position sizing detector', items: regimeGroups.sizing },
    ]), [regimeGroups]);

    // ETF connections
    const etfConnections = useMemo(() => {
        if (!Array.isArray(activeAlerts)) return [];
        return activeAlerts.filter(a => a.script === 'etf_rebalancing');
    }, [activeAlerts]);

    const systemConnectionRows = useMemo(() => ([
        ...detectorRows.map((row) => ({
            ...row,
            status: row.items.length > 0 ? 'connected' as const : 'none' as const,
            removable: true,
        })),
        {
            label: 'ETF momentum',
            script: 'etf_rebalancing',
            description: 'Allocation feed',
            items: etfConnections,
            status: etfConnections.length > 0 ? 'connected' as const : 'none' as const,
            removable: false,
        },
    ]), [detectorRows, etfConnections]);

    // Filter and sort stocks
    const filteredStocks = useMemo(() => {
        if (!Array.isArray(stockConnections)) return [];
        let filtered = [...stockConnections];

        // Apply filter mode
        if (filterMode !== 'all') {
            filtered = filtered.filter(s => s.status === filterMode);
        }

        // Apply search
        if (searchTicker) {
            filtered = filtered.filter(s =>
                s.ticker.toLowerCase().includes(searchTicker.toLowerCase()) ||
                s.name.toLowerCase().includes(searchTicker.toLowerCase())
            );
        }

        // Sort
        filtered.sort((a, b) => {
            let comparison = 0;

            if (sortField === 'ticker') {
                comparison = a.ticker.localeCompare(b.ticker);
            } else if (sortField === 'name') {
                comparison = a.name.localeCompare(b.name);
            } else if (sortField === 'status') {
                const statusOrder = { connected: 0, partial: 1, none: 2 };
                comparison = statusOrder[a.status as keyof typeof statusOrder] - statusOrder[b.status as keyof typeof statusOrder];
            }

            return sortDirection === 'asc' ? comparison : -comparison;
        });

        return filtered;
    }, [stockConnections, filterMode, searchTicker, sortField, sortDirection]);

    const filteredCommodityConnections = useMemo(() => {
        const query = commoditySearch.trim().toLowerCase();
        return commodityConnections.filter((connection) => {
            if (filterMode !== 'all' && connection.status !== filterMode) return false;
            if (!query) return true;
            return connection.name.toLowerCase().includes(query) ||
                connection.physicalLabel.toLowerCase().includes(query) ||
                connection.physicalTicker.toLowerCase().includes(query) ||
                connection.equitiesLabel.toLowerCase().includes(query) ||
                connection.equitiesDisplayTicker.toLowerCase().includes(query);
        });
    }, [commodityConnections, commoditySearch, filterMode]);

    const filteredSystemConnections = useMemo(() => {
        if (filterMode === 'all') return systemConnectionRows;
        return systemConnectionRows.filter((row) => row.status === filterMode);
    }, [filterMode, systemConnectionRows]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const scopeMetrics = useMemo(() => {
        const statusCounts = (statuses: Array<'connected' | 'partial' | 'none'>) => ({
            total: statuses.length,
            connected: statuses.filter((status) => status === 'connected').length,
            partial: statuses.filter((status) => status === 'partial').length,
            none: statuses.filter((status) => status === 'none').length,
        });
        return {
            positions: statusCounts(stockConnections.map((stock) => stock.status as 'connected' | 'partial' | 'none')),
            watchlist: statusCounts(watchlistMonitoring.map((item) => item.hasCDF ? 'connected' : 'none')),
            commodities: statusCounts(commodityConnections.map((connection) => connection.status as 'connected' | 'partial' | 'none')),
            system: statusCounts(systemConnectionRows.map((row) => row.status)),
            announcements: statusCounts(announcements.items.map(item => item.configured ? 'connected' : 'none')),
        };
    }, [commodityConnections, stockConnections, systemConnectionRows, watchlistMonitoring, announcements.items]);

    const activeMetrics = scopeMetrics[activeScope];

    const openAlertSetup = (stock: typeof stockConnections[number], script: AlertSetupScript) => {
        setSetupTarget({
            ticker: stock.ticker,
            fullTicker: getFullTicker(stock.ticker, stock.prefix),
            name: stock.name,
            script,
            existingPriceTarget: stock.analystPT,
        });
    };

    const removeAlertSetup = async (fullTicker: string, script: string, id?: number) => {
        await api.removeActiveAlert({
            id,
            ticker: fullTicker,
            script,
        });
        await fetchActiveAlerts();
    };

    const toggleAlertSetup = async (
        stock: typeof stockConnections[number],
        script: AlertSetupScript,
        isConnected: boolean,
    ) => {
        if (!isConnected) {
            openAlertSetup(stock, script);
            return;
        }

        await removeAlertSetup(getFullTicker(stock.ticker, stock.prefix), script);
    };

    const toggleCommodityFeed = async (
        target: CommodityFeedSetupTarget,
        existingAlert?: (typeof activeAlerts)[number],
        initialised = false,
    ) => {
        if (existingAlert && initialised) {
            await removeAlertSetup(target.connectionTicker, 'cdf', existingAlert.id);
            return;
        }
        setCommoditySetupTarget(target);
    };

    const toggleETFWrapper = async (stock: typeof stockConnections[number]) => {
        const nextType = stock.isETF ? 'STOCK' : 'ETF';
        const fullTicker = getFullTicker(stock.ticker, stock.prefix);

        await api.setAnalysisSecurityType({
            analysis_id: stock.analysisId,
            name: stock.name,
            ticker: fullTicker,
            primary_asset_class: stock.primaryAssetClass || null,
            security_type: nextType,
        });
        updateStock(stock.id, { securityType: nextType });
        await fetchHoldings();
    };

    const toggleWatchlistCdf = async (item: typeof watchlistMonitoring[number]) => {
        if (item.isETF && !managementReady) return;
        if (!item.hasCDF) {
            setSetupTarget({
                ticker: item.symbol,
                fullTicker: item.fullTicker,
                name: item.name,
                script: item.script,
                existingPriceTarget: item.analystPT,
            });
            return;
        }

        await removeAlertSetup(item.fullTicker, item.script);
    };

    const handleAlertSetupConfirm = async (positionState?: 'BUY' | 'SELL', analystPriceTarget?: number) => {
        if (!setupTarget) return;
        await api.setupActiveAlert({
            ticker: setupTarget.fullTicker,
            script: setupTarget.script,
            position_state: positionState,
            analyst_price_target: analystPriceTarget,
            company_name: setupTarget.name,
        });
        setSetupTarget(null);
        await Promise.all([fetchActiveAlerts(), fetchHoldings()]);
    };

    const handleCommodityFeedSetupConfirm = async (signal: 'BUY' | 'SELL') => {
        if (!commoditySetupTarget) return;
        await api.initialiseCommodityThemeFeed({
            theme: commoditySetupTarget.theme,
            stage: commoditySetupTarget.stage,
            signal,
            ...(commoditySetupTarget.securityTicker ? { security: { ticker: commoditySetupTarget.securityTicker } } : {}),
        });
        setCommoditySetupTarget(null);
        await Promise.all([fetchActiveAlerts(), fetchCommodityThemes()]);
    };

    const handleWatchlistAddConfirm = async ({
        name,
        fullTicker,
        initialiseCdf,
        cdfState,
    }: {
        name: string;
        fullTicker: string;
        initialiseCdf: boolean;
        cdfState: 'BUY' | 'SELL';
    }) => {
        await api.upsertAnalysis({
            name,
            ticker: fullTicker,
            is_watchlist: true,
        });
        if (initialiseCdf) {
            await api.setupActiveAlert({
                ticker: fullTicker,
                script: 'cdf',
                position_state: cdfState,
                company_name: name,
            });
        }
        setShowAddWatchlist(false);
        await Promise.all([fetchActiveAlerts(), fetchHoldings()]);
    };

    return (
        <div className={styles.workspace}>
            {setupTarget && (
                <AlertSetupModal
                    target={setupTarget}
                    onClose={() => setSetupTarget(null)}
                    onConfirm={handleAlertSetupConfirm}
                />
            )}
            {commoditySetupTarget && (
                <CommodityFeedSetupModal
                    target={commoditySetupTarget}
                    onClose={() => setCommoditySetupTarget(null)}
                    onConfirm={handleCommodityFeedSetupConfirm}
                />
            )}
            {showAddWatchlist && (
                <WatchlistAddModal
                    onClose={() => setShowAddWatchlist(false)}
                    onConfirm={handleWatchlistAddConfirm}
                />
            )}

            <div className={styles.layout}>
            <main className={styles.mainColumn}>
            <div className={styles.monitorToolbar}>
                <div className={styles.monitorIdentity}>
                    <div>
                        <h2 className={styles.monitorTitle}>{activeScope === 'announcements' ? 'Announcement alerts' : 'Connections'}</h2>
                        <p className={styles.monitorSubtitle}>{activeScope === 'announcements' ? 'HotCopper / Seeking Alpha' : 'TradingView setup ledger'}</p>
                    </div>
                    <div className={styles.coverageValue}>
                        <span>{activeScope === 'announcements' && (announcements.loading || announcements.error) ? '-' : activeMetrics.connected}</span>
                        <span className={styles.coverageDivider}>/</span>
                        <span>{activeMetrics.total}</span>
                    </div>
                </div>
                {activeScope !== 'announcements' && <div className={styles.filterGroup} aria-label="Filter stock connections">
                    {([
                        ['all', 'All', activeMetrics.total],
                        ['connected', 'Connected', activeMetrics.connected],
                        ['partial', 'Partial', activeMetrics.partial],
                        ['none', 'Missing', activeMetrics.none],
                    ] as const).map(([mode, label, count]) => (
                        <button
                            key={mode}
                            type="button"
                            aria-pressed={filterMode === mode}
                            onClick={() => setFilterMode(mode)}
                            className={`${styles.filterButton} ${filterMode === mode ? styles.filterButtonActive : ''}`}
                        >
                            <span>{label}</span>
                            <span className={styles.filterCount}>{count}</span>
                        </button>
                    ))}
                </div>}
            </div>

            <nav className={styles.scopeNavigation} aria-label="Connection scope">
                {([
                    ['positions', 'Positions'],
                    ['watchlist', 'Watchlist'],
                    ['commodities', 'Commodities'],
                    ['system', 'System'],
                    ['announcements', 'Announcements'],
                ] as const).map(([scope, label]) => (
                    <button
                        key={scope}
                        ref={scope === 'announcements' ? announcementScopeRef : undefined}
                        type="button"
                        className={`${styles.scopeButton} ${activeScope === scope ? styles.scopeButtonActive : ''}`}
                        aria-current={activeScope === scope ? 'page' : undefined}
                        onClick={() => {
                            setActiveScope(scope);
                            setFilterMode('all');
                            if (scope === 'announcements') void announcements.refresh();
                        }}
                    >
                        <span>{label}</span>
                        <span className={`${styles.scopeCount} ${scope === 'announcements' && announcementPending > 0 ? styles.setupMissing : ''}`}
                            title={scope === 'announcements' ? 'Securities needing announcement setup' : undefined}>
                            {scope === 'announcements' ? announcements.error ? '!' : announcements.loading ? '-' : announcementPending : scopeMetrics[scope].total}
                        </span>
                    </button>
                ))}
            </nav>

            {activeScope !== 'announcements' && (announcementPending > 0 || announcements.error) && (
                <button type="button" className={styles.setupNotice} onClick={() => {
                    setActiveScope('announcements');
                    void announcements.refresh();
                    announcementScopeRef.current?.focus();
                }}>
                    <Mail size={16} aria-hidden="true" />
                    <span>{announcements.error ? 'Announcement setup unavailable' : `${announcementPending} ${announcementPending === 1 ? 'security needs' : 'securities need'} announcement alerts`}</span>
                    <span className={styles.setupProviders}>HotCopper / Seeking Alpha</span>
                    <ArrowRight size={15} aria-hidden="true" />
                </button>
            )}

            <div hidden={activeScope !== 'announcements'}>
                <AnnouncementSubscriptions items={announcements.items} loading={announcements.loading}
                    error={announcements.error} refresh={announcements.refresh} />
            </div>

            {/* Stocks Section */}
            {activeScope === 'positions' && (
            <section className={styles.ledgerSection}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionIdentity}>
                        <h3 className={styles.sectionTitle}>STOCK CONNECTIONS</h3>
                        <span className={styles.sectionCount}>{filteredStocks.length} of {stockConnections.length}</span>
                    </div>
                    <label className={styles.searchField}>
                        <Search size={13} aria-hidden="true" />
                        <input
                            type="search"
                            aria-label="Search stock connections"
                            placeholder="Search ticker or name"
                            value={searchTicker}
                            onChange={(e) => setSearchTicker(e.target.value)}
                        />
                        {searchTicker && (
                            <button type="button" aria-label="Clear stock search" onClick={() => setSearchTicker('')}>
                                <X size={12} aria-hidden="true" />
                            </button>
                        )}
                    </label>
                </div>

                <div className={styles.tableScroller}>
                    <table className={styles.connectionTable}>
                        <colgroup>
                            <col className={styles.securityColumn} />
                            <col className={styles.controlColumn} />
                            <col className={styles.controlColumn} />
                            <col className={styles.controlColumn} />
                            <col className={styles.outperformColumn} />
                            <col className={styles.statusColumn} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th className={styles.sortHeader} onClick={() => handleSort('name')}>
                                    SECURITY
                                    {sortField === 'name' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                                </th>
                                <th className={`${styles.centerHeader} ${styles.typeWrapper}`} title="Security wrapper type">ETF</th>
                                <th className={`${styles.centerHeader} ${styles.typeCdf}`} title="Capital Deployment Filter connection">CDF</th>
                                <th className={`${styles.centerHeader} ${styles.typeTms}`} title="Trade Management System connection">TMS</th>
                                <th className={`${styles.centerHeader} ${styles.typeOutperform}`} title="Security relative-performance connection">OUTPERFORM</th>
                                <th
                                    className={styles.sortHeader}
                                    onClick={() => handleSort('status')}
                                >
                                    CONNECTIONS
                                    {sortField === 'status' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredStocks.map((stock) => {
                                const hasTicker = Boolean(stock.ticker?.trim());
                                return (
                                    <tr key={stock.id} className={`${styles.dataRow} ${styles[`row_${stock.status}`]}`}>
                                        <td className={styles.securityCell} title={`${stock.name} · ${getFullTicker(stock.ticker, stock.prefix)}`}>
                                            <div className={styles.securityIdentity}>
                                                <span className={styles.securityName}>{stock.name}</span>
                                                <div className={styles.securityMeta}>
                                                    {showTickerEdit[stock.id] ? (
                                                        <div className={styles.tickerEditor}>
                                                            <input type="text" value={prefixInput} onChange={(e) => setPrefixInput(e.target.value)}
                                                                className={styles.prefixInput} placeholder="ASX:" />
                                                            <input type="text" value={tickerInput} onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                                                                className={styles.symbolInput} placeholder="BHP" autoFocus
                                                                onKeyDown={(e) => { if (e.key === 'Enter') handleTickerSave(stock.id, stock.name); if (e.key === 'Escape') setShowTickerEdit({}); }} />
                                                            <button type="button" aria-label="Save ticker" onClick={() => handleTickerSave(stock.id, stock.name)}><Check size={13} /></button>
                                                            <button type="button" aria-label="Cancel ticker edit" onClick={() => setShowTickerEdit({})}><X size={13} /></button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className={`${styles.tickerButton} ${!hasTicker ? styles.missingTicker : ''}`}
                                                                aria-label={`Edit ticker for ${stock.name}`}
                                                                title="Edit ticker mapping"
                                                                onClick={() => toggleTickerEdit(stock.id, stock.ticker || '', stock.prefix || '')}
                                                            >
                                                                <span>{hasTicker ? getFullTicker(stock.ticker, stock.prefix) : 'Missing ticker'}</span>
                                                                <Pencil size={10} aria-hidden="true" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className={`${styles.controlCell} ${styles.typeWrapper}`}>
                                            <ConnectionControl
                                                checked={stock.isETF}
                                                label={`${stock.isETF ? 'Mark as stock' : 'Mark as ETF'} without changing asset class`}
                                                onClick={() => toggleETFWrapper(stock)}
                                            />
                                        </td>
                                        <td className={`${styles.controlCell} ${styles.typeCdf}`}>
                                            {stock.isETF && !managementReady ? <span className={styles.unavailable}>...</span> : stock.usesETFTMS ? (
                                                <span className={styles.unavailable} title="ETF uses TMS">—</span>
                                            ) : (
                                                <ConnectionControl
                                                    checked={stock.hasCDF}
                                                    label={`${stock.hasCDF ? 'Remove' : 'Initialise'} CDF for ${stock.name}`}
                                                    onClick={() => toggleAlertSetup(stock, 'cdf', stock.hasCDF)}
                                                />
                                            )}
                                        </td>
                                        <td className={`${styles.controlCell} ${styles.typeTms}`}>
                                            <ConnectionControl
                                                checked={stock.hasATR}
                                                label={`${stock.hasATR ? 'Remove' : 'Initialise'} ${stock.usesETFTMS ? 'ETF TMS' : 'TMS'} for ${stock.name}`}
                                                onClick={() => { if (!stock.isETF || managementReady) void toggleAlertSetup(stock, stock.usesETFTMS ? 'etf_tms' : 'tms', stock.hasATR); }}
                                            />
                                        </td>
                                        <td className={`${styles.controlCell} ${styles.typeOutperform}`}>
                                            {stock.outperformTicker && stock.outperformTheme ? (
                                                <ConnectionControl
                                                    checked={stock.hasOutperform}
                                                    label={`${stock.name} Outperform CDF connection`}
                                                    onClick={() => toggleCommodityFeed({
                                                    theme: stock.outperformTheme!,
                                                    stage: 'SECURITY_OUTPERFORM',
                                                    name: `${stock.name} Outperform`,
                                                    connectionTicker: stock.outperformTicker!,
                                                    securityTicker: getFullTicker(stock.ticker, stock.prefix),
                                                    }, stock.outperformAlert, stock.outperformInitialised)}
                                                />
                                            ) : (
                                                <span className={styles.unavailable} title="No commodity-relative benchmark">—</span>
                                            )}
                                        </td>
                                        <td className={styles.statusCell}>
                                            <ConnectionStatus status={stock.status as 'connected' | 'partial' | 'none'} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {filteredStocks.length === 0 && (
                    <div className={styles.emptyState}>
                        No stocks match your filters
                    </div>
                )}
            </section>
            )}

            {activeScope === 'commodities' && (
            <section className={styles.ledgerSection} data-testid="alerts-commodity-connections">
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionIdentity}>
                        <h3 className={styles.sectionTitle}>COMMODITY CONNECTIONS</h3>
                        <span className={styles.sectionCount}>
                            {filteredCommodityConnections.length} of {commodityConnections.length}
                        </span>
                    </div>
                    <label className={styles.searchField}>
                        <Search size={14} aria-hidden="true" />
                        <input
                            type="search"
                            aria-label="Search commodity connections"
                            placeholder="Search market or source"
                            value={commoditySearch}
                            onChange={(event) => setCommoditySearch(event.target.value)}
                        />
                        {commoditySearch && (
                            <button type="button" aria-label="Clear commodity search" onClick={() => setCommoditySearch('')}>
                                <X size={13} aria-hidden="true" />
                            </button>
                        )}
                    </label>
                </div>

                {filteredCommodityConnections.length === 0 ? (
                    <div className={styles.emptyState}>
                        {commodityConnections.length === 0 ? 'No commodity markets configured' : 'No commodity connections match this view'}
                    </div>
                ) : (
                <div className={styles.tableScroller}>
                    <table className={`${styles.connectionTable} ${styles.commodityTable}`}>
                        <colgroup>
                            <col className={styles.marketColumn} />
                            <col />
                            <col />
                            <col className={styles.statusColumn} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th>MARKET</th>
                                <th className={styles.typePhysical}>PHYSICAL COMMODITY</th>
                                <th className={styles.typeEquity}>PRODUCER EQUITIES</th>
                                <th>CONNECTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCommodityConnections.map((connection) => {
                                return (
                                    <tr key={connection.code} className={`${styles.dataRow} ${styles[`row_${connection.status}`]}`}>
                                        <td className={styles.marketCell}>{connection.name}</td>
                                        <td className={`${styles.sourceConnectionCell} ${styles.typePhysical}`} title={`${connection.physicalLabel} · ${connection.physicalTicker || 'Missing ticker'}`}>
                                            <div className={styles.sourceConnectionLayout}>
                                                <ConnectionControl
                                                    checked={!!connection.physicalAlert}
                                                    label={connection.physicalTicker
                                                        ? `${connection.name} physical commodity CDF connection`
                                                        : `${connection.name} physical commodity ticker missing`}
                                                    disabled={!connection.physicalTicker}
                                                    onClick={() => toggleCommodityFeed({
                                                        theme: connection.code,
                                                        stage: 'COMMODITY',
                                                        name: `${connection.name} physical commodity`,
                                                        connectionTicker: connection.physicalTicker,
                                                    }, connection.physicalAlert, connection.physicalInitialised)}
                                                />
                                                <div className={styles.sourceCell}>
                                                    <span>{connection.physicalLabel}</span>
                                                    <code className={!connection.physicalTicker ? styles.missingTicker : undefined}>
                                                        {connection.physicalTicker || 'Missing ticker'}
                                                    </code>
                                                </div>
                                            </div>
                                        </td>
                                        <td className={`${styles.sourceConnectionCell} ${styles.typeEquity}`} title={`${connection.equitiesLabel} · ${connection.equitiesDisplayTicker}`}>
                                            <div className={styles.sourceConnectionLayout}>
                                                <ConnectionControl
                                                    checked={!!connection.equitiesAlert}
                                                    label={connection.equitiesTicker
                                                        ? `${connection.name} equity trend CDF connection`
                                                        : `${connection.name} producer equities ticker missing`}
                                                    disabled={!connection.equitiesTicker}
                                                    onClick={() => toggleCommodityFeed({
                                                        theme: connection.code,
                                                        stage: 'EQUITY_RELATIVE',
                                                        name: `${connection.name} equity regime`,
                                                        connectionTicker: connection.equitiesTicker,
                                                    }, connection.equitiesAlert, connection.equitiesInitialised)}
                                                />
                                                <div className={styles.sourceCell}>
                                                    <span>{connection.equitiesLabel}</span>
                                                    <code className={!connection.equitiesTicker ? styles.missingTicker : undefined}>
                                                        {connection.equitiesDisplayTicker}
                                                    </code>
                                                </div>
                                            </div>
                                        </td>
                                        <td className={styles.statusCell}>
                                            <ConnectionStatus status={connection.status as 'connected' | 'partial' | 'none'} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                )}
            </section>
            )}

            </main>

            {activeScope === 'watchlist' && (
            <aside className={styles.utilityRail}>
            <section className={styles.utilitySection}>
                <div className={styles.utilityHeader}>
                    <div className={styles.sectionIdentity}>
                        <h3 className={styles.sectionTitle}>WATCHLIST CONNECTIONS</h3>
                        <span className={styles.sectionCount}>{filteredWatchlistMonitoring.length} of {watchlistMonitoring.length}</span>
                    </div>
                    <div className={styles.sectionActions}>
                        <label className={styles.searchField}>
                            <Search size={14} aria-hidden="true" />
                            <input
                                type="search"
                                aria-label="Search watchlist connections"
                                value={watchlistSearch}
                                onChange={(event) => setWatchlistSearch(event.target.value)}
                                placeholder="Search watchlist"
                            />
                            {watchlistSearch && (
                                <button type="button" aria-label="Clear watchlist search" onClick={() => setWatchlistSearch('')}>
                                    <X size={13} aria-hidden="true" />
                                </button>
                            )}
                        </label>
                        <button
                            type="button"
                            onClick={() => setShowAddWatchlist(true)}
                            className={styles.iconTextButton}
                        >
                            <Plus size={14} aria-hidden="true" />
                            Add
                        </button>
                    </div>
                </div>
                <div className={styles.utilityBody}>
                    {filteredWatchlistMonitoring.length === 0 ? (
                        <div className={styles.compactEmpty}>
                            {watchlistMonitoring.length === 0 ? 'No watchlist securities' : 'No watchlist connections match this view'}
                        </div>
                    ) : (
                        <div className={styles.utilityTableScroller}>
                            <table className={styles.utilityTable}>
                                <colgroup>
                                    <col />
                                    <col className={styles.controlColumn} />
                                    <col className={styles.statusColumn} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th>SECURITY</th>
                                        <th className={`${styles.utilityControlHeader} ${styles.typeCdf}`} title="Capital Deployment Filter connection">CDF</th>
                                        <th>CONNECTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredWatchlistMonitoring.map(a => (
                                        <tr key={a.symbol} className={a.hasCDF ? styles.row_connected : styles.row_none}>
                                            <td className={styles.securityCell} title={`${a.name} · ${a.fullTicker}`}>
                                                <div className={styles.securityIdentity}>
                                                    <span className={styles.securityName}>{a.name}</span>
                                                    <span className={styles.utilityTicker}>{a.fullTicker}</span>
                                                </div>
                                            </td>
                                            <td className={`${styles.controlCell} ${styles.typeCdf}`}>
                                                <ConnectionControl
                                                    checked={a.hasCDF}
                                                    label={`${a.hasCDF ? 'Remove' : 'Initialise'} ${a.script === 'etf_tms' ? 'ETF TMS' : 'CDF'} for ${a.name}`}
                                                    onClick={() => toggleWatchlistCdf(a)}
                                                />
                                            </td>
                                            <td className={styles.statusCell}>
                                                <ConnectionStatus status={a.hasCDF ? 'connected' : 'none'} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {staleTmsMonitoring.length > 0 && (
                        <div className={styles.staleSection}>
                            <div className={styles.staleTitle}>
                                Stale TMS <span>{staleTmsMonitoring.length}</span>
                            </div>
                            <div className={styles.staleList}>
                                {staleTmsMonitoring.map(a => (
                                    <div key={a.symbol} className={styles.staleRow}>
                                        <span>{a.fullTicker}</span>
                                        <button
                                            type="button"
                                            onClick={() => void removeAlertSetup(a.fullTicker, 'tms')}
                                            title="Remove stale TMS setup"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </section>
            </aside>
            )}

            {activeScope === 'system' && (
            <aside className={styles.utilityRail}>
            <section className={styles.utilitySection}>
                <div className={styles.utilityHeader}>
                    <div className={styles.sectionIdentity}>
                        <h3 className={styles.sectionTitle}>SYSTEM CONNECTIONS</h3>
                        <span className={styles.sectionCount}>{filteredSystemConnections.length} of {systemConnectionRows.length}</span>
                    </div>
                </div>
                <div className={styles.detectorList}>
                    {filteredSystemConnections.length === 0 && (
                        <div className={styles.compactEmpty}>No system connections match this view</div>
                    )}
                    {filteredSystemConnections.map(({ label, script, description, items, status, removable }) => (
                        <div key={script} className={`${styles.detectorRow} ${styles[`row_${status}`]}`}>
                            <div className={styles.detectorSummary}>
                                <div>
                                    <div className={styles.detectorLabel}>{label}</div>
                                    <div className={styles.detectorDescription}>{description}</div>
                                </div>
                                <ConnectionStatus status={status} />
                            </div>

                            {items.length > 0 && (
                                <div className={styles.detectorConnections}>
                                    {items.map((alert) => (
                                        <div
                                            key={`${alert.script}-${alert.ticker}-${alert.id}`}
                                            className={styles.detectorConnection}
                                        >
                                            <div>
                                                <span className={styles.detectorConnectionDot} aria-hidden="true" />
                                                <span title={alertTargetLabel(alert.ticker)}>
                                                    {alertTargetLabel(alert.ticker)}
                                                </span>
                                            </div>
                                            {removable && (
                                                <button
                                                    type="button"
                                                    onClick={() => void removeAlertSetup(alert.ticker, script, alert.id)}
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </section>
            </aside>
            )}
            </div>
        </div>
    );
}
