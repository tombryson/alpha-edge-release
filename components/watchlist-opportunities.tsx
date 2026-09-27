'use client';

import { useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Info, RefreshCw, Search, TrendingUp, X } from 'lucide-react';
import { useWatchlistOpportunities, refreshWatchlist } from '@/lib/use-watchlist-opportunities';
import { openWatchlistEntry, watchlistStatus, type WatchlistOpportunity } from '@/lib/watchlist-opportunities';
import { assetClassColor } from '@/lib/asset-class-identity';
import { openAlertAction } from '@/lib/action-presentation';
import { requestTerminalTab } from '@/lib/terminal-route';
import * as Popover from '@radix-ui/react-popover';
import styles from './watchlist-opportunities.module.css';

const money = (value: number) => value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const pct = (value: number) => `${value.toFixed(1)}%`;

function Signals({ item }: { item: WatchlistOpportunity }) {
    return <span className={styles.signals}>
        {item.signal === 'BREAKOUT' ? <span className={styles.positive} title={`Breakout${item.signal_at ? ` · ${item.signal_at}` : ''}`}><ArrowUpRight size={13} />Breakout</span>
            : <span>{item.signal === 'BUY' ? 'Buy trend' : item.signal === 'SELL' ? 'Sell trend' : 'No trend'}</span>}
        {item.outperform === 'BUY' && <span className={styles.leader} title={`Outperforming ${item.benchmark || 'configured benchmark'}`}><TrendingUp size={13} /><span>Outperform</span></span>}
    </span>;
}

export function WatchlistOpportunities({ compact = false }: { compact?: boolean }) {
    const { data, loading, error } = useWatchlistOpportunities();
    const [search, setSearch] = useState('');
    const [readyOnly, setReadyOnly] = useState(false);
    const [page, setPage] = useState(0);
    const items = (data?.items || []).filter(item => (!readyOnly || item.state === 'READY') &&
        `${item.name} ${item.ticker} ${item.class_name}`.toLowerCase().includes(search.toLowerCase()));
    const size = compact ? 20 : 100;
    const lastPage = Math.max(0, Math.ceil(items.length / size) - 1);
    const currentPage = Math.min(page, lastPage);
    return <section className={`${styles.list} ${compact ? styles.compact : ''}`} aria-label="Watchlist opportunities">
        {!compact && <div className={styles.toolbar}>
            <label className={styles.search}><Search size={14} /><input aria-label="Find watchlist security" placeholder="Find a security" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
            <button type="button" className={styles.filter} aria-pressed={readyOnly} onClick={() => { setReadyOnly(!readyOnly); setPage(0); }}>Ready <span>{data?.items.filter(item => item.state === 'READY').length || 0}</span></button>
            <button type="button" className={styles.icon} title="Refresh opportunities" aria-label="Refresh opportunities" onClick={() => void refreshWatchlist()}><RefreshCw size={14} /></button>
        </div>}
        {loading ? <p className={styles.empty}>Checking watchlist...</p> : error ? <div className={styles.empty} role="status">{error}<button className={styles.icon} title="Retry assessment" aria-label="Retry assessment" onClick={() => void refreshWatchlist()}><RefreshCw size={14} /></button></div>
            : !items.length ? <p className={styles.empty}>{readyOnly ? 'No entries ready to review' : 'No watchlist securities'}</p> : <>
                {!compact && <div className={styles.columns} aria-hidden="true"><span>Security</span><span>Signal</span><span>Entry</span></div>}
                {items.slice(currentPage * size, (currentPage + 1) * size).map(item => <button key={item.id} type="button" className={styles.row} onClick={() => openWatchlistEntry(item.ticker)} aria-label={`Review ${item.name}: ${watchlistStatus(item.state)}`}>
                    <span className={styles.identity}><i style={{ background: assetClassColor(item.asset_class) }} /><span><strong>{item.name}</strong><small>{item.ticker} · {item.class_name || 'Unassigned'}</small></span></span>
                    <Signals item={item} />
                    <span className={`${styles.status} ${item.state === 'READY' ? styles.positive : ''}`} title={item.reason}>
                        {item.state === 'READY' ? <><strong>{money(item.entry)}</strong><small>Ready to review</small></> : watchlistStatus(item.state)}<ChevronRight size={12} />
                    </span>
                </button>)}
                {lastPage > 0 && <div className={styles.paging}><span>{currentPage * size + 1}-{Math.min((currentPage + 1) * size, items.length)} / {items.length}</span><button className={styles.icon} disabled={!currentPage} aria-label="Previous opportunities" onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></button><button className={styles.icon} disabled={currentPage === lastPage} aria-label="Next opportunities" onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></button></div>}
            </>}
    </section>;
}

export function WatchlistEntryPanel({ ticker, onClose }: { ticker: string; onClose?: () => void }) {
    const { data, error, loading } = useWatchlistOpportunities();
    const item = data?.items.find(item => item.ticker.toUpperCase() === ticker.toUpperCase());
    const openResearch = () => {
        requestTerminalTab('ANALYSIS');
        window.dispatchEvent(new CustomEvent('analysisSecurityRequested', { detail: { ticker, name: item?.name } }));
    };
    return <aside className={styles.panel} aria-label="Watchlist entry review">
        {onClose && <header className={styles.panelHeader}><span>Entry review</span><button className={styles.icon} aria-label="Close entry review" onClick={onClose}><X size={15} /></button></header>}
        {!item || error ? <div className={styles.empty} role="status">{loading ? 'Checking entry...' : error || 'No longer on the unheld watchlist'}<button className={styles.icon} aria-label="Refresh entry review" onClick={() => void refreshWatchlist()}><RefreshCw size={14} /></button></div> : <div className={styles.panelBody}>
            <section className={styles.security}>
                <h3>{item.name}</h3><div className={styles.muted}>{item.ticker} · {item.class_name}</div>
                <Signals item={item} />
            </section>
            <section className={styles.entry}>
                <div className={styles.entryLabel}>
                    {watchlistStatus(item.state)}
                    <Popover.Root>
                        <Popover.Trigger asChild>
                            <button className={styles.icon} aria-label="About this entry estimate" title="About this entry estimate"><Info size={14} /></button>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content side="left" sideOffset={6} collisionPadding={12} className={styles.explanation}>
                                Alternative estimate, not reserved cash or an order. Other candidates use the same pool.
                                Verify the current price against the entry rule before trading; recording an action rechecks permission and funding.
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                </div>
                {item.state === 'READY' ? <strong className={styles.entryAmount}>{money(item.entry)}</strong> : <p>{item.reason}</p>}
            </section>
            {item.class_limit > 0 && <dl className={styles.metrics}>
                <div><dt>Class exposure</dt><dd>{pct(item.class_now)}{item.entry > 0 && <> → <strong>{pct(item.class_after)}</strong></>}</dd></div>
                <div><dt>Class limit</dt><dd>{pct(item.class_limit)}</dd></div>
                <div><dt>Class cash</dt><dd>{money(item.class_cash)}</dd></div>
                <div><dt>Prospective Ideal wt</dt><dd>{item.ideal_pct === null ? '-' : pct(item.ideal_pct)}</dd></div>
            </dl>}
            {item.peers.length > 0 && <details className={styles.peers}><summary>Peer Ideal wt</summary><table><thead><tr><th>Security</th><th>Before</th><th>With entry</th></tr></thead><tbody>{item.peers.map(peer => <tr key={peer.ticker}><td>{peer.ticker}</td><td>{pct(peer.before)}</td><td>{pct(peer.after)}</td></tr>)}</tbody></table></details>}
            <footer className={styles.panelActions}>
                {item.action_id ? <button className={styles.primary} onClick={() => openAlertAction({ id: item.action_id!, ticker: item.ticker })}>Review action</button> : null}
                <button className={styles.textButton} onClick={openResearch}>Research</button>
                <a className={styles.icon} href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(item.ticker)}`} target="_blank" rel="noopener noreferrer" title="Open TradingView chart" aria-label="Open TradingView chart"><ArrowUpRight size={15} aria-hidden="true" /></a>
            </footer>
        </div>}
    </aside>;
}
