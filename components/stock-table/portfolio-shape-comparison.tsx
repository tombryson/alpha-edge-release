'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api, type PortfolioHistoryEntry } from '@/lib/api';
import {
    approvedShapeArchive, compareApprovedShapes, shapeHistorySelection,
    type ApprovedShape, type PortfolioAnalyticView,
} from '@/lib/portfolio-shape-comparison';
import { PortfolioRadialChart } from './portfolio-radial-chart';
import { useStockTableContext } from './stock-table-context';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import { getPortfolioTargetDisplayName, mapCurrentAssetClassToPortfolioTarget } from '@/lib/portfolio-target-taxonomy';
import styles from './portfolio-shape-comparison.module.css';

function shapeLabel(shape: ApprovedShape) {
    const date = new Date(shape.at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${shape.version === null ? 'Approved' : `v${shape.version}`} · ${date}`;
}

function percent(value: number | null) {
    return value === null ? 'Unavailable' : `${value.toFixed(1)}%`;
}

function change(value: number | null) {
    return value === null ? 'Unavailable' : `${Math.abs(value) < 0.05 ? '' : value > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}pp`;
}

function WeightBars({ earlier, later, color, scale }: { earlier: number | null; later: number | null; color?: string; scale: number }) {
    return <div className={styles.weightBars} aria-hidden="true">
        <div className={styles.barTrack}>{earlier !== null && <i className={styles.earlierBar} style={{ width: `${earlier / scale * 100}%` }} />}</div>
        <div className={styles.barTrack}>{later !== null && <i className={styles.laterBar} style={{ width: `${later / scale * 100}%`, background: color }} />}</div>
    </div>;
}

export function PortfolioShapeComparison({ view, refreshKey, presentation, onBack }: { view: PortfolioAnalyticView; refreshKey: string; presentation: Record<string, { name: string; color: string }>; onBack: () => void }) {
    const { assetClasses } = useStockTableContext();
    const [entries, setEntries] = useState<PortfolioHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [nextBeforeId, setNextBeforeId] = useState<number | undefined>();
    const [limitedHistory, setLimitedHistory] = useState(false);
    const [fromId, setFromId] = useState('');
    const [toId, setToId] = useState('');
    const [reload, setReload] = useState(0);
    const request = useRef(0);

    async function load(beforeId?: number) {
        const sequence = ++request.current;
        setLoading(true);
        setError(null);
        try {
            const response = await api.getPortfolioShapeHistory(beforeId);
            if (sequence !== request.current) return;
            if (!Array.isArray(response.entries)) throw new Error('Invalid approved shape history response');
            setEntries(previous => [...new Map([...previous, ...response.entries].map(entry => [entry.id, entry])).values()]);
            setLimitedHistory(response.kind !== 'shape');
            setNextBeforeId(response.kind === 'shape' ? response.next_before_id : undefined);
        } catch (failure) {
            if (sequence === request.current) setError(failure instanceof Error ? failure.message : 'Failed to load approved shapes');
        } finally {
            if (sequence === request.current) setLoading(false);
        }
    }

    useEffect(() => {
        void load();
        return () => { request.current++; };
    }, [refreshKey, reload]);

    const archive = useMemo(() => {
        // Resolve only established taxonomy aliases, never its unknown-to-broad-equity fallback.
        const legacy = entries.flatMap(entry => entry.rows.flatMap(row => {
            const code = mapCurrentAssetClassToPortfolioTarget(row.asset_class);
            if (code === 'BROAD_EQUITY' && normalizeAssetClassCode(row.asset_class) !== 'BROADEQUITY') return [];
            return [{ code, asset_class_code: row.asset_class, display_name: getPortfolioTargetDisplayName(code), allow_target_weight: true }];
        }));
        return approvedShapeArchive(entries, [...legacy, ...assetClasses]);
    }, [entries, assetClasses]);
    const selection = shapeHistorySelection(archive, fromId, toId);
    const { from, to, fromIndex, toIndex } = selection;
    const comparison = useMemo(() => from && to ? compareApprovedShapes(archive, from, to, presentation) : null, [archive, from, to, presentation]);
    const [scaleOrder, setScaleOrder] = useState<'class' | 'change'>('class');
    const rows = comparison ? [...comparison.rows].sort((a, b) => view === 'deviation' && scaleOrder === 'change'
        ? Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0) || a.code.localeCompare(b.code) : a.code.localeCompare(b.code)) : [];

    function chooseFrom(index: number) {
        setFromId(archive[index].id);
        setToId(to.id);
    }
    function chooseTo(index: number) {
        setFromId(from.id);
        setToId(archive[index].id);
    }

    return <section className={styles.root} aria-label="Approved shape history comparison">
        <div className={styles.heading}>
            <div className={styles.headingIdentity}>
                <button type="button" className={styles.backButton} aria-label="Back to portfolio" onClick={onBack}>
                    <ArrowLeft size={16} aria-hidden="true" />Back
                </button>
                <span>Approved shapes <small>{archive.length} loaded</small></span>
            </div>
            <button type="button" className={styles.iconButton} title="Refresh approved shape history" aria-label="Refresh approved shape history" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /></button>
        </div>
        {error && <div role="alert" className={styles.error}>{error}{entries.length > 0 && ' · Previously loaded approvals remain visible.'}</div>}
        {limitedHistory && <div role="status" className={styles.notice}>Recent records only. Deploy the updated backend to browse the full approval archive.</div>}
        {loading && <div role="status" className={styles.notice}>Loading approved shapes…</div>}
        {comparison && from && to ? <>
            <div className={styles.controls}>
                <div className={styles.dateControl}>
                    <label htmlFor="shape-compare-from">From</label>
                    <div className={styles.dateInput}>
                        <button type="button" className={styles.iconButton} aria-label="Previous From shape" title="Previous From shape" disabled={fromIndex <= 0 || loading} onClick={() => chooseFrom(fromIndex - 1)}><ChevronLeft size={16} /></button>
                        <select id="shape-compare-from" value={from.id} onChange={event => chooseFrom(archive.findIndex(shape => shape.id === event.target.value))}>
                            {archive.slice(0, toIndex).map(shape => <option value={shape.id} key={shape.id}>{shapeLabel(shape)}</option>)}
                        </select>
                        <button type="button" className={styles.iconButton} aria-label="Next From shape" title="Next From shape" disabled={fromIndex >= toIndex - 1 || loading} onClick={() => chooseFrom(fromIndex + 1)}><ChevronRight size={16} /></button>
                    </div>
                </div>
                <div className={styles.dateControl}>
                    <label htmlFor="shape-compare-to">To</label>
                    <div className={styles.dateInput}>
                        <button type="button" className={styles.iconButton} aria-label="Previous To shape" title="Previous To shape" disabled={toIndex <= fromIndex + 1 || loading} onClick={() => chooseTo(toIndex - 1)}><ChevronLeft size={16} /></button>
                        <select id="shape-compare-to" value={to.id} onChange={event => chooseTo(archive.findIndex(shape => shape.id === event.target.value))}>
                            {archive.slice(fromIndex + 1).map(shape => <option value={shape.id} key={shape.id}>{shapeLabel(shape)}</option>)}
                        </select>
                        <button type="button" className={styles.iconButton} aria-label="Next To shape" title="Next To shape" disabled={toIndex >= archive.length - 1 || loading} onClick={() => chooseTo(toIndex + 1)}><ChevronRight size={16} /></button>
                    </div>
                </div>
            </div>
            <div className={styles.summary}>
                <span>From {percent(from.total)} · To {percent(to.total)}</span>
                <span>{rows.length} asset classes · Read-only</span>
            </div>
            {(!from.complete || !to.complete) && <div className={styles.notice}>Incomplete shape. Unrecorded classes remain unavailable; percentages are not rescaled.</div>}
            {view === 'radial' ? <div className={styles.radial}><PortfolioRadialChart
                rows={comparison.rows} showTarget stale={false}
                comparison={{ fromLabel: `From ${shapeLabel(from)}`, toLabel: `To ${shapeLabel(to)}`, peaks: comparison.peaks, incompleteCodes: comparison.incompleteCodes }}
            /></div> : <>
                <div className={styles.legend}>
                    <span><i className={styles.earlierKey} />From {shapeLabel(from)}</span>
                    <span><i className={styles.laterKey} />To {shapeLabel(to)}</span>
                    {view === 'deviation' && <label className={styles.sortControl}>Order <select aria-label="Order historical changes" value={scaleOrder} onChange={event => setScaleOrder(event.target.value as 'class' | 'change')}><option value="class">Asset class</option><option value="change">Largest change</option></select></label>}
                </div>
                {view === 'cumulative' && comparison.concentration.length === 0 ? <div className={styles.empty}>Concentration comparison needs two complete shapes totaling 100%.</div> :
                    <table className={styles.table}>
                        <thead><tr>
                            <th scope="col">{view === 'cumulative' ? 'Concentration' : 'Asset class'}</th>
                            <th scope="col" className={styles.chartColumn}><div className={styles.axis}>
                                <span>{view === 'deviation' ? `−${comparison.scale}pp` : '0%'}</span>
                                <span>{view === 'deviation' ? '0' : view === 'cumulative' ? '50%' : `${comparison.scale / 2}%`}</span>
                                <span>{view === 'deviation' ? `+${comparison.scale}pp` : view === 'cumulative' ? '100%' : `${comparison.scale}%`}</span>
                            </div></th>
                            <th scope="col">From</th><th scope="col">To</th><th scope="col">Change</th>
                        </tr></thead>
                        <tbody>{view === 'cumulative' ? comparison.concentration.map(row => <tr key={row.rank}>
                            <th scope="row"><span className={styles.subject}>Top {row.rank} {row.rank === 1 ? 'class' : 'classes'}</span>
                                <small>From: {row.earlierName || 'No further classes'}<br />To: {row.laterName || 'No further classes'}</small>
                            </th>
                            <td className={styles.chartColumn}><WeightBars earlier={row.earlier} later={row.later} scale={100} /></td>
                            <td>{percent(row.earlier)}</td><td>{percent(row.later)}</td><td>{change(row.later - row.earlier)}</td>
                        </tr>) : rows.map(row => <tr key={row.code}>
                            <th scope="row"><span className={styles.subject}><i style={{ background: row.color }} />{row.name}</span></th>
                            <td className={styles.chartColumn}>{view === 'shape' ? <WeightBars earlier={row.target} later={row.current} scale={comparison.scale} color={row.color} /> :
                                <div className={styles.changeTrack} aria-hidden="true">
                                    <i className={styles.zeroLine} />
                                    {row.difference !== null && <i className={styles.changeBar} style={{
                                        left: `${row.difference < 0 ? 50 + row.difference / comparison.scale * 50 : 50}%`,
                                        width: `${Math.abs(row.difference) / comparison.scale * 50}%`, background: row.color,
                                    }} />}
                                </div>}
                            </td>
                            <td>{percent(row.target)}</td><td>{percent(row.current)}</td><td>{change(row.difference)}</td>
                        </tr>)}</tbody>
                    </table>}
            </>}
        </> : !loading && !error && <div className={styles.empty}>{archive.length === 0 ? 'No approved shapes are available.' : 'Two approved shapes are needed for a historical comparison.'}</div>}
        {nextBeforeId !== undefined && <div className={styles.archiveFooter}><button type="button" disabled={loading} onClick={() => {
            if (from && to) { setFromId(from.id); setToId(to.id); }
            void load(nextBeforeId);
        }}>Load earlier approvals</button></div>}
    </section>;
}
