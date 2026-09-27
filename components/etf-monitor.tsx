'use client';

import { useStore } from '@/lib/store';
import { managementTicker, useETFManagement } from '@/lib/etf-management-store';
import { useContextPanelStore } from '@/lib/context-panel-store';
import { allocationFill, etfTarget, findByTicker, tickerLeaf } from '@/lib/context-panel-model';
import { AlertStatusIndicator } from './alert-status-indicator';
import { usePanelData } from './context-panel/panel-data';
import { CoreETFControl } from './context-panel/core-etf-control';
import { money } from './context-panel/allocation-visuals';
import { ETFAllocationSummary } from './context-panel/etf-allocation-summary';
import { ETFAllocationCard } from './context-panel/etf-allocation-card';
import panelStyles from './context-panel/panel.module.css';
import styles from './etf-monitor.module.css';

// Sidebar views share the allocation ledger and never establish separate targets.
export function ETFMonitor() {
    const { ledger, loading, errors } = usePanelData();
    const connections = useStore(state => state.activeAlerts);
    const { modes, ready: modesReady } = useETFManagement();
    const view = useContextPanelStore(state => state.allocationView);
    if (loading && !ledger) return <p className={panelStyles.empty}>Loading ETF allocations...</p>;
    if (!ledger) return <p className={panelStyles.empty}>ETF allocations unavailable.</p>;

    const rows = ledger.rows.filter(row => row.is_core || row.actual_value > 0);
    const target = ledger.summary.has_approved_shape && Number.isFinite(ledger.summary.effective_target_value) ? Math.max(0, ledger.summary.effective_target_value) : null;
    const actual = ledger.summary.actual_etf_value;
    const capitalSpan = rows.reduce((sum, row) => sum + Math.max(row.actual_value, etfTarget(row) || 0, 1), 0);

    return <div className={styles.monitor}>
        {errors.ledger && <p role="alert" className={`${panelStyles.notice} ${panelStyles.error}`}>ETF data could not be refreshed. Last loaded values shown.</p>}
        <ETFAllocationSummary actual={actual} target={target} />
        {!rows.length && <p className={panelStyles.empty}>No Core selections or ETF holdings.</p>}
        <div className={view === 'map' ? styles.capitalMap : view === 'ring' ? styles.ringCards : styles.cards} aria-label={view === 'map' ? 'ETF capital map' : view === 'ring' ? 'ETF ring allocations' : 'ETF line allocations'}>
            {rows.map(row => {
                const rowTarget = etfTarget(row);
                const fill = allocationFill(row.actual_value, rowTarget);
                const mode = modes[managementTicker(row.ticker)] || 'etf_tms';
                const connected = modesReady && findByTicker((connections || []).filter(alert => (mode === 'tms' ? ['tms', 'atr_oscillator'] : ['etf_tms', 'etf_cdf']).includes(alert.script)), row.ticker, alert => alert.ticker);
                const hasCDF = mode !== 'tms' || findByTicker((connections || []).filter(alert => alert.script === 'cdf'), row.ticker, alert => alert.ticker);
                const signal = connected && hasCDF && ['BUY', 'SELL'].includes(row.tactical_status) ? row.tactical_status : null;
                if (view !== 'map') return <ETFAllocationCard key={`${view}:${row.ticker}`} fund={row} target={rowTarget} signal={signal} view={view} />;
                const caption = `${row.display_name}: ${money(row.actual_value)} held / ${money(rowTarget)} target`;
                const trigger = <button type="button"
                    aria-label={`Configure Core ETF ${row.ticker}`} title={caption}
                    className={styles.mapBlock}
                    style={{ flexGrow: Math.max(row.actual_value, rowTarget || 0, 1) / capitalSpan }}
                    data-empty={row.actual_value <= 0} data-unknown={rowTarget === null} data-over={fill.excess > 0}
                    onClick={event => event.stopPropagation()}>
                    <span aria-hidden="true" className={styles.mapFill} style={{ width: `${fill.unknown ? 100 : fill.funded}%`, background: fill.unknown ? 'color-mix(in srgb, var(--foreground) 6%, transparent)' : undefined }} />
                    <span aria-hidden="true" className={`${styles.mapFill} ${styles.mapExcess}`} style={{ left: `${fill.funded}%`, width: `${fill.excess}%` }} />
                    <span className={styles.chipRow}>
                        <span className={styles.identity}>
                            <AlertStatusIndicator ticker={row.ticker} mode="position" securityType="ETF" />
                            <span className={styles.ticker} title={row.ticker}>{tickerLeaf(row.ticker)}</span>
                            <span className={styles.assetClass} title={row.asset_class_name}>{row.asset_class_name || 'Unassigned'}</span>
                        </span>
                        <span className={styles.values}>
                            <span>{money(row.actual_value)} / {money(rowTarget)}</span>
                        </span>
                    </span>
                </button>;
                return <CoreETFControl key={row.ticker} fund={row} trigger={trigger} />;
            })}
        </div>
    </div>;
}
