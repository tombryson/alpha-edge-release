'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, FileText, RotateCcw, X } from 'lucide-react';
import { api, type PortfolioHistoryEntry, type PortfolioMemoRun } from '@/lib/api';
import { approvedHistory, compareShapeRows } from '@/lib/context-panel-model';
import { useContextPanelStore } from '@/lib/context-panel-store';
import { getPortfolioAssetClassColor } from '@/lib/portfolio-composition-colors';
import { requestTerminalTab } from '@/lib/terminal-route';
import * as Dialog from '@radix-ui/react-dialog';
import { usePanelData } from './panel-data';
import { percent } from './allocation-visuals';
import styles from './panel.module.css';

export function ShapeView() {
    const { approved, current, errors, revision: dataRevision } = usePanelData();
    const selected = useContextPanelStore(state => state.shape);
    const selectShape = useContextPanelStore(state => state.selectShape);
    const selectClass = useContextPanelStore(state => state.selectClass);
    const [entries, setEntries] = useState<PortfolioHistoryEntry[]>([]);
    const [cursor, setCursor] = useState<number | undefined>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [memoOpen, setMemoOpen] = useState(false);
    const [memo, setMemo] = useState<PortfolioMemoRun | null>(null);
    const [memoError, setMemoError] = useState('');
    const [memoLoading, setMemoLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.getPortfolioShapeHistory().then(async result => {
            const missingId = selected.startsWith('shape:') ? Number(selected.slice(6)) : NaN;
            const older = Number.isSafeInteger(missingId) && !result.entries.some(row => row.id === selected)
                ? await api.getPortfolioShapeHistory(missingId + 1) : null;
            if (cancelled) return;
            setEntries(previous => approvedHistory([...new Map([...previous, ...(result.entries || []), ...(older?.entries || [])].map(entry => [entry.id, entry])).values()])); setCursor(result.next_before_id); setError('');
        }).catch(() => { if (!cancelled) setError('Approved shape history unavailable.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [approved?.snapshot?.id, revision, dataRevision, selected]);
    const loadMore = useCallback(async () => {
        if (!cursor || loading) return;
        setLoading(true);
        try {
            const result = await api.getPortfolioShapeHistory(cursor);
            setEntries(previous => approvedHistory([...new Map([...previous, ...(result.entries || [])].map(entry => [entry.id, entry])).values()]));
            setCursor(result.next_before_id); setError('');
        } catch { setError('Older shapes could not be loaded.'); }
        finally { setLoading(false); }
    }, [cursor, loading]);
    const entry = selected === 'current' ? entries.find(row => row.snapshot_id === approved?.snapshot?.id) : entries.find(row => row.id === selected);
    const savedRows = selected === 'current' ? approved?.snapshot ? approved.rows : [] : entry?.rows || [];
    const rows = compareShapeRows(savedRows, errors.current ? [] : current?.rows || []);
    const total = savedRows.reduce((sum, row) => sum + row.weight_pct, 0);
    const memoJob = entry?.memo_job_id;
    useEffect(() => {
        let cancelled = false;
        setMemo(null); setMemoError('');
        if (!memoOpen || !memoJob) return;
        setMemoLoading(true);
        api.getPortfolioMemo(memoJob).then(response => {
            if (!cancelled) { setMemo(response.memo); if (!response.memo) setMemoError('No saved memo is available for this shape.'); }
        }).catch(() => { if (!cancelled) setMemoError('The saved memo could not be loaded.'); })
            .finally(() => { if (!cancelled) setMemoLoading(false); });
        return () => { cancelled = true; };
    }, [memoOpen, memoJob]);
    return <>
        <label className={styles.field}><span>Reference shape</span><select aria-label="Reference portfolio shape" value={selected} onChange={event => selectShape(event.target.value)}>
            <option value="current">Current approved shape</option>
            {selected !== 'current' && !entries.some(row => row.id === selected) && <option value={selected}>Saved reference - load history</option>}
            {entries.map(row => <option key={row.id} value={row.id}>v{row.snapshot_id} - {new Date(row.occurred_at).toLocaleDateString()}</option>)}
        </select></label>
        {error && <div className={styles.notice} role="alert">{error} <button className={styles.icon} type="button" aria-label="Retry shape history" title="Retry shape history" onClick={() => setRevision(value => value + 1)}><RotateCcw /></button></div>}
        {cursor && <button className={styles.command} type="button" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading...' : 'Load older shapes'}</button>}
        {errors.approved && selected === 'current' && <p role="alert" className={styles.notice}>The approved shape could not be refreshed.</p>}
        {errors.current && <p role="alert" className={styles.notice}>Current holdings comparison unavailable.</p>}
        {!savedRows.length ? <p className={styles.empty}>{loading ? 'Loading approved shapes...' : 'No saved allocation for this reference.'}</p> : <>
            <section className={styles.section}>
                <h3>{selected === 'current' ? 'Approved shape' : `Approved shape v${entry?.snapshot_id}`}</h3>
                <p className={styles.meta}>{entry?.occurred_at ? new Date(entry.occurred_at).toLocaleDateString() : approved?.snapshot?.approved_at ? new Date(approved.snapshot.approved_at).toLocaleDateString() : ''}</p>
                <span className={styles.meta}>Reference</span>
                <div className={styles.shapeBar} role="img" aria-label="Reference shape allocation">
                    {rows.filter(row => row.target > 0).map((row, index) => <span key={row.code} title={`${row.name}: ${percent(row.target)}`} style={{ width: `${row.target}%`, background: getPortfolioAssetClassColor(row.code, index) }} />)}
                </div>
                {!errors.current && <><span className={styles.meta}>Current holdings</span><div className={styles.shapeBar} role="img" aria-label="Current portfolio allocation">
                    {rows.filter(row => row.current > 0).map(row => <span key={row.code} title={`${row.name}: ${percent(row.current)}`} style={{ width: `${row.current}%`, background: getPortfolioAssetClassColor(row.code, rows.findIndex(item => item.code === row.code)) }} />)}
                </div></>}
                {Math.abs(total - 100) > .5 && <p className={styles.notice}>Saved weights total {percent(total)}. No rescaling applied.</p>}
                <table className={styles.table}>
                    <thead><tr><th>Asset class</th><th>Ref.</th><th>Now</th></tr></thead>
                    <tbody>{rows.map((row, index) => <tr key={row.code}>
                        <td><div className={styles.name}><i className={styles.swatch} style={{ background: getPortfolioAssetClassColor(row.code, index) }} /><button className={styles.nameButton} type="button" onClick={() => selectClass(row.code)} title={`Select ${row.name} for Asset class details`}>{row.name}</button></div></td>
                        <td>{percent(row.target)}</td><td>{errors.current ? '\u2014' : percent(row.current)}</td>
                    </tr>)}</tbody>
                </table>
                {entry?.memo?.executive_summary && <p>{entry.memo.executive_summary}</p>}
                {memoJob ? <button className={styles.command} type="button" onClick={() => setMemoOpen(true)}><FileText aria-hidden="true" />Read associated memo</button> : <p className={styles.meta}>{loading ? 'Checking memo linkage...' : 'No memo linked to this approval.'}</p>}
            </section>
        </>}
        <div className={styles.commands}><button type="button" className={styles.command} onClick={() => requestTerminalTab('PORTFOLIO')}><ArrowUpRight aria-hidden="true" />Portfolio history</button></div>
        <Dialog.Root open={memoOpen} onOpenChange={setMemoOpen}>
            <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[190] bg-black/50" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[191] max-h-[85dvh] w-[calc(100vw-32px)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-border bg-popover p-6 text-popover-foreground shadow-xl" aria-describedby={undefined}>
                <div className={styles.heading}><Dialog.Title className="text-lg font-medium">Portfolio memo</Dialog.Title><Dialog.Close className={styles.icon} aria-label="Close memo"><X /></Dialog.Close></div>
                {memoLoading ? <p>Loading saved memo...</p> : memoError ? <p role="alert">{memoError}</p> : memo && <>
                    <p className={styles.meta}>{memo.analysis_date}</p>
                    <p>{memo.executive_summary}</p>
                    <h3>Analyst assessment</h3><div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{memo.analyst_memo_markdown || 'No analyst assessment recorded.'}</div>
                    <h3>Chairman conclusion</h3><div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{memo.chairman_memo_markdown || 'No chairman conclusion recorded.'}</div>
                </>}
            </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    </>;
}
