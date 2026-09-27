'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Archive, ArrowLeft, Download, FileCheck2, Play, RefreshCw, Search, Upload } from 'lucide-react';
import { api, SourceResearchAPIError } from '@/lib/api';
import { ENRICHMENT_TEMPLATES } from '@/lib/enrichment-templates';
import { subscribePoll } from '@/lib/polling';
import type { Stock } from '@/lib/store';
import { researchActive, researchStatusLabel, sourcePacketAttachment,
    type SourceResearchCatalogue, type SourceResearchJob, type SourceResearchRequest } from '@/lib/source-research';
import styles from './research-library.module.css';
import { ResearchAttachment } from './research-attachment';

type Props = {
    stock: Stock;
    templateId: string;
    expectedTemplate: string;
    attachmentFile?: File | null;
    onAttachSources?: (file: File | null) => void;
    method: 'manual' | 'automatic';
    onMethodChange: (method: 'manual' | 'automatic') => void;
    visible: boolean;
    savedOpen: boolean;
    onSavedOpenChange: (open: boolean) => void;
    instructions: ReactNode;
    renderFooter: (primaryAction?: ReactNode) => ReactNode;
};
const dateLabel = (value: string) => new Date(value).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const label = (id: string) => ENRICHMENT_TEMPLATES.find(t => t.kind === 'retrieval_brief' && t.templateIds.includes(id))?.label.replace(/ Brief$/, '') || id;

export function SourceResearchPanel({ stock, templateId, expectedTemplate, attachmentFile, onAttachSources, method, onMethodChange, visible, savedOpen, onSavedOpenChange, instructions, renderFooter }: Props) {
    const [catalogue, setCatalogue] = useState<SourceResearchCatalogue | null>(null);
    const [jobs, setJobs] = useState<SourceResearchJob[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [selectedId, setSelectedId] = useState('');
    const [detail, setDetail] = useState<SourceResearchJob | null>(null);
    const [error, setError] = useState('');
    const [readError, setReadError] = useState('');
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<SourceResearchRequest | null>(null);
    const requestRef = useRef<SourceResearchRequest | null>(null);
    const [reload, setReload] = useState(0);
    const [recoveryId, setRecoveryId] = useState('');
    const [attached, setAttached] = useState<{ id: string; file: File } | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const methodId = useId();
    const savedId = useId();
    const storageKey = `alpha-edge:source-request:${stock.analysisId}`;
    const selected = jobs.find(job => job.id === selectedId);
    const active = jobs.find(researchActive);
    const template = catalogue?.templates.find(t => t.id === templateId);

    useEffect(() => {
        try {
            const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
            if (saved?.analysis_id === stock.analysisId && typeof saved?.request_id === 'string') {
                requestRef.current = saved; setPending(saved);
            }
        } catch { /* Submission itself fails closed if storage cannot retain its ID. */ }
    }, [storageKey, stock.analysisId]);

    useEffect(() => {
        if (!visible) return;
        const abort = new AbortController();
        let config: SourceResearchCatalogue | null = null;
        const poll = async () => {
            try {
                if (!config) config = await api.getSourceResearchTemplates(abort.signal);
                if (abort.signal.aborted) return;
                setCatalogue(config);
                const saved = stock.analysisId ? await api.getSourceResearchJobs(stock.analysisId, abort.signal) : [];
                if (abort.signal.aborted) return;
                setJobs(saved); setLoaded(true); setReadError('');
                const recovered = saved.find(job => job.request_id === requestRef.current?.request_id);
                if (recovered) {
                    sessionStorage.removeItem(storageKey); requestRef.current = null; setPending(null);
                    setSelectedId(recovered.id);
                } else setSelectedId(id => id || saved[0]?.id || '');
            } catch (err) {
                if (!abort.signal.aborted) setReadError(err instanceof Error ? err.message : 'Could not load research.');
            }
        };
        const unsubscribe = subscribePoll(poll, 15000);
        return () => { abort.abort(); unsubscribe(); };
    }, [stock.analysisId, storageKey, reload, visible]);

    useEffect(() => {
        if (!visible || !savedOpen) return;
        setDetail(null); setRecoveryId('');
        if (!selectedId) return;
        const abort = new AbortController();
        setDetailLoading(true);
        api.getSourceResearchJob(selectedId, abort.signal).then(job => {
            if (!abort.signal.aborted) setDetail(job);
        }).catch(err => { if (!abort.signal.aborted) setError(err.message); })
            .finally(() => { if (!abort.signal.aborted) setDetailLoading(false); });
        return () => abort.abort();
    }, [selectedId, selected?.status, selected?.updated_at, reload, savedOpen, visible]);

    const submit = async () => {
        if (busy || !stock.analysisId || !template || !catalogue) return;
        setBusy(true); setError('');
        try {
            const input = requestRef.current || { analysis_id: stock.analysisId, template_id: template.id,
                template_version: template.version, accepted_cost_usd: catalogue.estimated_cost_usd, request_id: crypto.randomUUID(), expected_ticker: currentTicker };
            // Keep this before the network call so a reload cannot lose an uncertain submission.
            sessionStorage.setItem(storageKey, JSON.stringify(input));
            requestRef.current = input; setPending(input);
            const job = await api.createSourceResearchJob(input);
            setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]);
            setSelectedId(job.id); setDetail(job);
            onSavedOpenChange(true);
            sessionStorage.removeItem(storageKey); requestRef.current = null; setPending(null);
            setReload(value => value + 1);
        } catch (err) {
            if (err instanceof SourceResearchAPIError && err.status >= 400 && err.status < 500) {
                sessionStorage.removeItem(storageKey); requestRef.current = null; setPending(null);
                setReload(value => value + 1);
            }
            setError(err instanceof Error ? err.message : 'Submission unavailable.');
        } finally { setBusy(false); }
    };

    const recover = async () => {
        if (!detail || busy) return;
        setBusy(true); setError('');
        try { await api.recoverSourceResearchJob(detail.id, recoveryId.trim()); setReload(value => value + 1); }
        catch (err) { setError(err instanceof Error ? err.message : 'Recovery unavailable.'); }
        finally { setBusy(false); }
    };

    const attachment = (job: SourceResearchJob) => new File([sourcePacketAttachment(job)], `source-research-${job.ticker.replace(/[^a-z0-9]/gi, '-')}-${job.id.slice(0, 8)}.json`, { type: 'application/json' });
    const download = () => {
        if (!detail?.packet) return;
        const file = attachment(detail);
        const url = URL.createObjectURL(file);
        const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const currentTicker = stock.prefix ? `${stock.prefix.replace(/:$/, '')}:${stock.symbol.split(':').pop()}`.toUpperCase() : stock.symbol.toUpperCase();
    const canAttach = detail?.status === 'succeeded' && Boolean(detail.packet) && detail.template_id === expectedTemplate && detail.ticker.toUpperCase() === currentTicker;
    const isAttached = Boolean(detail && attached?.id === detail.id && attached?.file === attachmentFile);

    const retrieveAction = <button type="button" className={`${styles.button} ${styles.retrieveButton}`} onClick={submit}
        disabled={busy || !loaded || !catalogue?.configured || !template || !stock.analysisId || Boolean(active) || Boolean(readError)}>
        {pending ? <RefreshCw size={15} /> : <Play size={15} />}
        {busy ? 'Submitting...' : pending ? 'Check submission' : 'Retrieve sources'}
    </button>;
    const attachAction = onAttachSources && detail?.packet && <button type="button" className={`${styles.button} ${styles.retrieveButton}`} disabled={!canAttach || isAttached} onClick={() => {
        const file = attachment(detail);
        onAttachSources(file); setAttached({ id: detail.id, file });
    }}><FileCheck2 size={15} />{isAttached ? 'Attached to Council' : attachmentFile ? 'Replace Council attachment' : 'Attach to Council'}</button>;

    return <section className={styles.panel} aria-label="Source retrieval">
        <div className={styles.sourceToolbar}>
            {savedOpen ? <button type="button" className={styles.quietButton} onClick={() => onSavedOpenChange(false)}>
                <ArrowLeft size={15} aria-hidden="true" />Source options
            </button> : <div className={styles.sourceMethods} role="radiogroup" aria-label="Source method">
                <label><input type="radio" name={methodId} value="automatic" checked={method === 'automatic'} onChange={() => onMethodChange('automatic')} />
                    <span><Search size={15} aria-hidden="true" />Retrieve automatically</span></label>
                <label><input type="radio" name={methodId} value="manual" checked={method === 'manual'} onChange={() => onMethodChange('manual')} />
                    <span><Upload size={15} aria-hidden="true" />Attach your own</span></label>
            </div>}
            {jobs.length > 0 && <button type="button" className={styles.button} aria-expanded={savedOpen} aria-controls={savedId}
                onClick={() => onSavedOpenChange(!savedOpen)}>
                <Archive size={15} aria-hidden="true" />Saved research <span className={styles.count}>{jobs.length}</span>
            </button>}
        </div>
        {onAttachSources && <div className={styles.panel} hidden={savedOpen || method !== 'manual'}>
            <ResearchAttachment ticker={currentTicker} attachment={attachmentFile} onChange={onAttachSources} renderFooter={renderFooter} />
        </div>}
        <div className={styles.panel} hidden={savedOpen || method !== 'automatic'}>
        <div className={styles.body} data-research-scroll>
        {!stock.analysisId && <p className={styles.error}>Save this security in Analysis before retrieving sources.</p>}
        {catalogue && !catalogue.configured && <p className={styles.error}>Parallel is not configured on the backend. Web UI prompts remain available.</p>}
        {!templateId && <p className={styles.muted}>No mapped template. Choose one before retrieving sources.</p>}
        {pending && <p className={styles.muted} role="status">Unconfirmed request: {pending.expected_ticker}, {label(pending.template_id)}. Check submission reuses this request.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {readError && <div role="alert"><p className={styles.error}>{readError}</p><button type="button" className={styles.button} onClick={() => setReload(v => v + 1)}><RefreshCw size={14} />Reload research</button></div>}
        {active && <button type="button" className={styles.quietButton} onClick={() => { setSelectedId(active.id); onSavedOpenChange(true); }}>
            {researchStatusLabel[active.status]}<span className={styles.meta}>View run</span>
        </button>}
        {instructions}
        </div>
        {renderFooter(retrieveAction)}
        </div>
        {savedOpen && <section className={styles.panel} id={savedId} aria-label="Saved source research">
            <div className={styles.body} data-research-scroll>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {readError && <p className={styles.error} role="alert">{readError}</p>}
            <div className={styles.jobs}>
                {jobs.map(job => <button key={job.id} type="button" className={styles.job} data-status={job.status}
                        aria-pressed={selectedId === job.id} onClick={() => { setSelectedId(job.id); setError(''); }}>
                        <time dateTime={job.created_at}>{dateLabel(job.created_at)}</time>
                        <span>{label(job.template_id)}</span><span className={styles.jobStatus}>{researchStatusLabel[job.status]}</span>
                    </button>)}
        </div>
        {detailLoading && <p className={styles.muted} role="status">Loading research...</p>}
        {detail && <section className={styles.packet} aria-label="Selected research run">
            {detail.error && <p className={styles.error} role="status">{detail.error}</p>}
            {detail.status === 'review' && detail.provider_result !== undefined && <button type="button" className={styles.button} onClick={() => {
                const blob = new Blob([JSON.stringify(detail.provider_result, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob); const link = document.createElement('a');
                link.href = url; link.download = `research-review-${detail.id}.json`; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}><Download size={15} />Download result for review</button>}
            {detail.status === 'uncertain' && <>
                <p className={styles.meta}>Request {detail.id}</p>
                <div className={styles.recover}><input aria-label="Parallel run ID" placeholder="Parallel run ID" value={recoveryId} onChange={e => setRecoveryId(e.target.value)} />
                    <button type="button" className={styles.button} disabled={!recoveryId.trim() || busy} onClick={recover}>Recover run</button></div>
            </>}
            {detail.packet && <>
                <div className={styles.packetHeader}>
                    <div><strong>{detail.packet.source_count} sources</strong><div className={styles.meta}>Retrieved {detail.packet.retrieval_date}</div></div>
                    <div className={styles.actions}>
                        <button type="button" className={styles.iconButton} aria-label="Download source packet" title="Download source packet" onClick={download}><Download size={17} /></button>
                    </div>
                </div>
                {onAttachSources && !canAttach && <p className={styles.error}>This packet does not match the current security mapping and Council template.</p>}
                {isAttached && <p className={styles.muted} role="status">Source packet attached. Council has not been started.</p>}
                <div className={styles.meta}>{detail.processor} / template {detail.template_version.slice(0, 8)}</div>
                {detail.packet.known_gaps.length > 0 && <details className={styles.source}><summary>Evidence gaps ({detail.packet.known_gaps.length})</summary>
                    <ul className={styles.gaps}>{detail.packet.known_gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
                {detail.packet.sources.map((source, i) => <details key={`${i}:${source.url}`} className={styles.source}>
                    <summary>{source.title}</summary><p className={styles.meta}>{source.named_source} / {source.date}</p>
                    {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer">Open source</a>}
                    <ul>{source.factual_summary.map((fact, n) => <li key={n}>{fact}</li>)}</ul><p className={styles.muted}>{source.relevance}</p>
                </details>)}
                {detail.packet.rejected_sources.length > 0 && <details className={styles.source}><summary>Rejected sources ({detail.packet.rejected_sources.length})</summary>
                    <ul>{detail.packet.rejected_sources.map((source, i) => <li key={i}>{source.title}: {source.reason}</li>)}</ul></details>}
            </>}
            {!detail.packet && detail.status !== 'uncertain' && <p className={styles.muted} role="status">{researchStatusLabel[detail.status]}</p>}
        </section>}
        </div>
        {renderFooter(isAttached ? undefined : attachAction)}
        </section>}
    </section>;
}
