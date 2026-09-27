'use client';

import { useRef, useState } from 'react';
import { Check, ExternalLink, RotateCcw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { getAccessMode } from '@/lib/access-mode';
import {
    announcementKey, announcementProviders, suggestedAnnouncementProvider,
    type AnnouncementSubscription, type AnnouncementProvider,
} from '@/lib/announcement-subscriptions';
import styles from './announcement-subscriptions.module.css';

export function AnnouncementSubscriptions({ items, loading, error, refresh }: {
    items: AnnouncementSubscription[]; loading: boolean; error: string; refresh: () => Promise<void>;
}) {
    const [search, setSearch] = useState('');
    const [view, setView] = useState<'pending' | 'all'>('pending');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [providers, setProviders] = useState<Record<string, AnnouncementProvider | ''>>({});
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [saveError, setSaveError] = useState('');
    const readOnly = getAccessMode() === 'demo';
    const providerFor = (row: AnnouncementSubscription) => providers[announcementKey(row)] ?? suggestedAnnouncementProvider(row);
    const canConfirm = (row: AnnouncementSubscription) => Boolean(row.ticker && row.exchange_prefix && providerFor(row) && !row.configured);
    const visible = items.filter(row => (view === 'all' || !row.configured)
        && `${row.name} ${row.exchange_prefix}${row.ticker}`.toLowerCase().includes(search.toLowerCase()));
    const eligible = visible.filter(canConfirm);
    const chosen = eligible.filter(row => selected.has(announcementKey(row)));
    const batch = eligible.slice(0, 100);
    const allSelected = batch.length > 0 && batch.every(row => selected.has(announcementKey(row)));
    const pending = items.filter(row => !row.configured).length;
    const save = async (rows: AnnouncementSubscription[], configured: boolean) => {
        if (savingRef.current || readOnly || !rows.length) return;
        savingRef.current = true; setSaving(true); setSaveError('');
        try {
            await api.updateAnnouncementSubscriptions(rows.map(row => ({
                kind: row.kind, id: row.id, ticker: row.ticker, exchange_prefix: row.exchange_prefix,
                provider: (configured ? providerFor(row) : row.provider) as AnnouncementProvider, configured,
            })));
            setSelected(new Set()); setProviders({});
        } catch (failure) {
            setSaveError(failure instanceof Error ? failure.message : 'Announcement setup could not be saved.');
        } finally {
            // A failed response can follow a successful write. Always reread the ledger.
            await refresh(); savingRef.current = false; setSaving(false);
        }
    };
    return <section className={styles.panel} aria-label="Announcement alerts">
                <div className={styles.toolbar}>
                    <div className={styles.tabs} aria-label="Announcement setup filter">
                        <button type="button" aria-pressed={view === 'pending'} onClick={() => { setView('pending'); setSelected(new Set()); }}>Needs setup <span>{pending}</span></button>
                        <button type="button" aria-pressed={view === 'all'} onClick={() => { setView('all'); setSelected(new Set()); }}>All</button>
                    </div>
                    <label className={styles.search}><Search size={15} /><input type="search" aria-label="Find announcement security" placeholder="Find a security" value={search} onChange={event => { setSearch(event.target.value); setSelected(new Set()); }} /></label>
                </div>
                {(saveError || error) && <p className={styles.error} role="alert">{saveError || error} {error && <button type="button" onClick={() => void refresh()}>Retry</button>}</p>}
                <div className={styles.list}>
                    {loading ? <p className={styles.empty}>Loading announcement setup...</p> : <>
                        {visible.length > 0 && <div className={styles.columnHead}>
                            <input type="checkbox" aria-label="Select visible unconfigured securities" checked={allSelected}
                                disabled={saving || readOnly || !eligible.length || Boolean(error)}
                                title="Select up to 100 visible securities"
                                onChange={() => setSelected(allSelected ? new Set() : new Set(batch.map(announcementKey)))} />
                            <span>Security</span><span>Provider</span><span />
                        </div>}
                        {visible.map(row => {
                            const key = announcementKey(row), provider = providerFor(row);
                            return <div className={styles.row} key={key}>
                                <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(key)} disabled={saving || readOnly || !canConfirm(row) || Boolean(error) || (selected.size >= 100 && !selected.has(key))}
                                    onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(key); else next.delete(key); return next; })} />
                                <div className={styles.security}><strong>{row.name}</strong><span>{row.exchange_prefix}{row.ticker || 'Ticker missing'}
                                    {!row.exchange_prefix && row.ticker && ' · Exchange missing'}
                                    {row.needs_recheck && <em>Recheck listing</em>}
                                    {row.configured && <em className={styles.confirmed} title={`Confirmed by user ${row.confirmed_at ? new Date(row.confirmed_at).toLocaleString() : ''}. Delivery not verified.`}>Configured</em>}
                                </span></div>
                                <select aria-label={`Announcement provider for ${row.name}`} value={provider} disabled={saving || row.configured || readOnly}
                                    onChange={event => setProviders(previous => ({ ...previous, [key]: event.target.value as AnnouncementProvider | '' }))}>
                                    <option value="">Choose provider</option><option value="HOTCOPPER">HotCopper</option><option value="SEEKING_ALPHA">Seeking Alpha</option>
                                </select>
                                <div className={styles.actions}>
                                    {provider && <a className={styles.icon} href={announcementProviders[provider].url} target="_blank" rel="noopener noreferrer"
                                        aria-label={`Open ${announcementProviders[provider].label} for ${row.name}`} title={`Open ${announcementProviders[provider].label}`}><ExternalLink size={15} /></a>}
                                    {row.configured ? <button type="button" className={styles.icon} disabled={saving || readOnly || Boolean(error)} onClick={() => void save([row], false)} aria-label={`Reset announcement setup for ${row.name}`} title="Mark unconfirmed"><RotateCcw size={15} /></button>
                                        : <button type="button" className={`${styles.icon} ${styles.confirm}`} disabled={saving || readOnly || !canConfirm(row) || Boolean(error)} onClick={() => void save([row], true)} aria-label={`Mark configured for ${row.name}`} title={canConfirm(row) ? 'Mark configured' : 'Set the ticker, exchange and provider first'}><Check size={17} /></button>}
                                </div>
                            </div>;
                        })}
                        {!visible.length && !error && <p className={styles.empty}>{search ? 'No matching securities.' : !items.length ? 'No securities to configure.' : pending ? 'No securities in this view.' : 'All announcement subscriptions confirmed.'}</p>}
                    </>}
                </div>
                <footer className={styles.footer}>
                    <span>{readOnly ? 'Read-only preview' : chosen.length ? `${chosen.length} selected` : `${items.length - pending} / ${items.length} configured`}</span>
                    <button type="button" className={styles.primary} disabled={!chosen.length || chosen.length > 100 || saving || readOnly || Boolean(error)} onClick={() => void save(chosen, true)}>
                        <Check size={15} />{saving ? 'Saving...' : 'Mark configured'}
                    </button>
                    {chosen.length > 100 && <span>Confirm up to 100 at a time.</span>}
                </footer>
    </section>;
}
