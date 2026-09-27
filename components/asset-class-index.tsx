'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { api, type AssetClass, type AssetClassConfig } from '@/lib/api';
import { subscribePoll } from '@/lib/polling';
import { buildAssetClassIndex, CLASSIFICATION_GROUPS, filterAssetClassIndex, type ClassRiskBucket } from '@/lib/asset-class-index';
import { getPortfolioAssetClassColor } from '@/components/stock-table/portfolio-visual-data';
import styles from './asset-class-index.module.css';

export function AssetClassIndex() {
    const [classes, setClasses] = useState<AssetClass[]>([]);
    const [policies, setPolicies] = useState<AssetClassConfig[]>([]);
    const [query, setQuery] = useState('');
    const [bucket, setBucket] = useState<ClassRiskBucket | 'all'>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const stop = subscribePoll(async () => {
            setLoading(true);
            try {
                const [registry, config] = await Promise.all([api.getAssetClasses(), api.getAssetClassConfig()]);
                if (!cancelled) {
                    setClasses(registry); setPolicies(config); setError('');
                }
            } catch {
                if (!cancelled) setError('Could not refresh asset classes. Previously loaded classifications are shown, if available.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 60_000);
        return () => { cancelled = true; stop(); };
    }, [retry]);

    const rows = useMemo(() => buildAssetClassIndex(classes, policies), [classes, policies]);
    const visible = useMemo(() => filterAssetClassIndex(rows, query, bucket), [rows, query, bucket]);

    return <section className={styles.root} aria-label="Asset-class index" data-testid="asset-class-index">
        <div className={styles.toolbar}>
            <label className={styles.search}>
                <Search size={15} aria-hidden="true" />
                <input type="search" aria-label="Search asset classes" placeholder="Find an asset class" value={query} onChange={event => setQuery(event.target.value)} />
                {query && <button type="button" aria-label="Clear asset-class search" title="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}
            </label>
            <span className={styles.count} aria-live="polite">{visible.length} / {rows.length}</span>
            <button type="button" className={styles.refresh} aria-label="Refresh asset-class index" title="Refresh classifications" disabled={loading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} aria-hidden="true" /></button>
        </div>
        <div className={styles.filters} role="group" aria-label="Classification filter">
            <button type="button" aria-pressed={bucket === 'all'} onClick={() => setBucket('all')}>All</button>
            {CLASSIFICATION_GROUPS.map(group => <button key={group.id} type="button" aria-pressed={bucket === group.id} onClick={() => setBucket(group.id)}>{group.label}</button>)}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.scrollArea} aria-busy={loading}>
            {loading && !rows.length ? <p className={styles.empty}>Loading asset classes...</p> : !visible.length ? <p className={styles.empty}>No matching asset classes.</p> : CLASSIFICATION_GROUPS.map(group => {
                const members = visible.filter(row => row.bucket === group.id);
                if (!members.length) return null;
                return <section className={styles.section} key={group.id} aria-labelledby={`class-index-${group.id}`}>
                    <header className={styles.groupHeading}>
                        <h2 id={`class-index-${group.id}`}>{group.label}<span>{members.length}</span></h2>
                        <p>{group.description}</p>
                    </header>
                    <div className={styles.columnHead} aria-hidden="true"><span>Asset class</span><span>Parent</span><span>Q3 rationale</span></div>
                    <ul className={styles.list}>
                        {members.map(row => <li key={row.code} className={styles.row} data-class-code={row.code}>
                            <div className={styles.identity}>
                                <i style={{ backgroundColor: getPortfolioAssetClassColor(row.code) }} aria-hidden="true" />
                                <div><strong title={`${row.name} (${row.code})`}>{row.name}</strong>{row.kind !== 'Asset class' && <small>{row.kind}</small>}</div>
                            </div>
                            <span className={styles.parent} title={row.parent || undefined}>{row.parent || '-'}</span>
                            <p className={styles.reason} title={row.reason}>{row.reason}</p>
                        </li>)}
                    </ul>
                </section>;
            })}
        </div>
    </section>;
}
