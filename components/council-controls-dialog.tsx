'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, ArrowLeft, BrainCircuit, Check, ChevronRight, ExternalLink, FileSearch, FileText, History, Paperclip, Play, Trash2, X } from 'lucide-react';
import type { Stock } from '@/lib/store';
import { ENRICHMENT_TEMPLATES } from '@/lib/enrichment-templates';
import { ResearchTemplateWorkspace } from './enrichment-template-modal';
import styles from './council-controls.module.css';

type Props = {
    stock: Stock;
    hasAnalysis: boolean;
    ticker: { ticker: string; exchange: string; hasPrefix: boolean };
    template: string;
    inputDate: string;
    runId: string;
    runLabel: string;
    error?: string;
    attachment: File | null;
    runsOpen: boolean;
    runsLoading: boolean;
    busy: boolean;
    runs: { id: string; label: string }[];
    onClose: () => void;
    onReturnFocus: () => void;
    onFieldUpdate: (id: number, field: keyof Stock, value: number | string | null) => void;
    onAttach: (file: File | null) => void;
    onRun: () => void;
    onLoadLatest: () => void;
    onClear: () => void;
    onToggleRuns: () => void;
    onLoadRun: (id: string) => void;
    onOpenLab: () => void;
};

export function CouncilControlsDialog({ stock, hasAnalysis, ticker, template, inputDate, runId, runLabel,
    error, attachment, runsOpen, runsLoading, busy, runs, onClose, onReturnFocus, onFieldUpdate,
    onAttach, onRun, onLoadLatest, onClear, onToggleRuns, onLoadRun, onOpenLab }: Props) {
    const [confirming, setConfirming] = useState(false);
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const [outputOpen, setOutputOpen] = useState(false);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const sourceButtonRef = useRef<HTMLButtonElement>(null);
    const runButtonRef = useRef<HTMLButtonElement>(null);
    const researchRef = useRef<HTMLDivElement>(null);
    const templateLabel = ENRICHMENT_TEMPLATES.find(item => item.kind === 'retrieval_brief' && item.templateIds.includes(template))?.label.replace(/ Brief$/, '') || template;
    const updateNumber = (field: 'councilQuality' | 'councilValue' | 'councilPT', value: string) => {
        const number = parseFloat(value) || 0;
        if (number !== (stock[field] || 0)) onFieldUpdate(stock.id, field, number);
    };
    const backToCouncil = () => {
        setSourcesOpen(false);
        requestAnimationFrame(() => sourceButtonRef.current?.focus());
    };
    useEffect(() => {
        if (sourcesOpen) researchRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    }, [sourcesOpen]);

    const renderHeader = (templateControl?: ReactNode) => <header className={styles.header}>
        <div className={styles.headingGroup}>
            {sourcesOpen ? <button type="button" className={styles.iconButton} onClick={backToCouncil}
                aria-label="Back to Council" title="Back to Council"><ArrowLeft size={19} aria-hidden="true" /></button>
                : <span className={styles.headerIcon}><BrainCircuit size={22} aria-hidden="true" /></span>}
            <div>
                <Dialog.Title ref={titleRef} tabIndex={-1} className={styles.title}>
                    {sourcesOpen ? 'Source research' : confirming ? hasAnalysis ? 'Confirm Council rerun' : 'Confirm Council run' : 'Council analysis'}
                </Dialog.Title>
                <div className={styles.identity}>
                    <Dialog.Description className={styles.securityIdentity}>
                        <span>{stock.name}</span><span className={styles.ticker}>{ticker.ticker || 'Ticker missing'}</span>
                    </Dialog.Description>
                    {sourcesOpen ? templateControl : <span className={styles.template} title={`Research template: ${templateLabel}`}>{templateLabel}</span>}
                </div>
            </div>
        </div>
        <Dialog.Close className={styles.iconButton} aria-label={`Close Council controls for ${stock.name}`} title="Close">
            <X size={18} aria-hidden="true" />
        </Dialog.Close>
    </header>;

    const renderFooter = (instructionsControl?: ReactNode, primaryAction?: ReactNode) => <footer className={styles.footer}>
        {sourcesOpen ? <>
            <div className={styles.sourceFooterDetails}>
                <span className={styles.sourceStatus} data-attached={Boolean(attachment)}>
                    {attachment ? <Check size={15} aria-hidden="true" /> : <Paperclip size={15} aria-hidden="true" />}
                    {attachment ? 'Sources attached' : 'No sources attached'}
                </span>
                {instructionsControl}
            </div>
            {primaryAction || <button type="button" className={styles.button} onClick={backToCouncil}>Done</button>}
        </> : confirming ? <>
            <button type="button" className={styles.button} onClick={() => {
                setConfirming(false); requestAnimationFrame(() => runButtonRef.current?.focus());
            }}>Cancel</button>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!ticker.hasPrefix || busy} onClick={onRun}>
                <Play size={14} aria-hidden="true" />Confirm and run
            </button>
        </> : <>
            <Dialog.Close className={styles.button}>Close</Dialog.Close>
            <button ref={runButtonRef} type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => {
                setConfirming(true); titleRef.current?.focus();
            }}><Play size={14} aria-hidden="true" />{hasAnalysis ? 'Rerun Council' : 'Run Council'}</button>
        </>}
    </footer>;

    return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
        <Dialog.Portal>
            <Dialog.Overlay className={styles.overlay} data-council-backdrop />
            <Dialog.Content id={`council-controls-${stock.id}`} className={styles.dialog} data-view={sourcesOpen ? 'research' : 'council'}
                aria-label={`Council controls for ${stock.name}`} aria-labelledby={undefined}
                onPointerDownOutside={event => {
                    // The second click on a table trigger must not dismiss its newly opened dialog.
                    if (event.detail.originalEvent.detail > 1) event.preventDefault();
                }}
                onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}
                onEscapeKeyDown={event => {
                    if (sourcesOpen) { event.preventDefault(); backToCouncil(); }
                }}
                onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
                {sourcesOpen ? <div ref={researchRef} className={styles.researchView}>
                    <ResearchTemplateWorkspace stock={stock} attachment={attachment} onAttachSources={onAttach}
                        renderHeader={renderHeader} renderFooter={renderFooter} />
                </div> : <>
                    {renderHeader()}
                    <div className={styles.body}>
                    {confirming ? <section className={styles.confirmation} aria-label="Run confirmation">
                        <dl className={styles.facts}>
                            <dt>Security</dt><dd>{stock.name}</dd>
                            <dt>Ticker</dt><dd>{ticker.ticker || 'Missing'}</dd>
                            <dt>Exchange</dt><dd>{ticker.exchange || 'Missing'}</dd>
                            <dt>Template</dt><dd title={template}>{templateLabel}</dd>
                        </dl>
                        <p className={styles.attachment}>
                            <Paperclip size={15} aria-hidden="true" />
                            <span>{attachment ? `Document: ${attachment.name}` : 'No sources attached'}</span>
                        </p>
                        {!ticker.hasPrefix && <p className={styles.error} role="alert">Add an exchange prefix before starting this run.</p>}
                    </section> : <>
                        <section className={styles.sourceSection} aria-label="Source preparation">
                            <button ref={sourceButtonRef} type="button" className={styles.sourceEntry}
                                aria-label="Source research" title={attachment ? `Attached: ${attachment.name}` : undefined}
                                onClick={() => setSourcesOpen(true)}>
                                <FileSearch size={20} aria-hidden="true" />
                                <span className={styles.sourceEntryText}>
                                    <span className={styles.sourceEntryTitle}>Source research</span>
                                    <span className={styles.sourceStatus} data-attached={Boolean(attachment)}>
                                        {attachment && <Check size={14} aria-hidden="true" />}
                                        {attachment ? attachment.name : 'No sources attached'}
                                    </span>
                                </span>
                                <ChevronRight size={17} aria-hidden="true" />
                            </button>
                        </section>
                        <section className={styles.section} aria-label="Saved Council result">
                            <div className={styles.sectionHeader}>
                                <div className={styles.resultHeading}>
                                    <h3>Saved result</h3>
                                    <button type="button" className={`${styles.iconButton} ${styles.outputAction}`}
                                        aria-label="Model output" title="Model output" aria-expanded={outputOpen}
                                        aria-controls={`council-model-output-${stock.id}`} onClick={() => setOutputOpen(value => !value)}>
                                        <FileText size={17} aria-hidden="true" />
                                    </button>
                                </div>
                                <div className={styles.resultActions}>
                                    <button type="button" className={`${styles.iconButton} ${styles.loadAction}`} aria-label="Load latest" title="Load latest" onClick={onLoadLatest} disabled={busy}>
                                        <ArrowDownToLine size={17} aria-hidden="true" />
                                    </button>
                                    <button type="button" className={`${styles.iconButton} ${styles.historyAction}`} aria-label="Saved runs" title="Saved runs" onClick={onToggleRuns} disabled={busy || runsLoading}
                                        aria-expanded={runsOpen} aria-controls="council-saved-runs">
                                        <History size={17} aria-hidden="true" />
                                    </button>
                                    {hasAnalysis && <button type="button" className={`${styles.iconButton} ${styles.clear}`} aria-label="Clear result" title="Clear result" onClick={onClear} disabled={busy}>
                                        <Trash2 size={16} aria-hidden="true" />
                                    </button>}
                                </div>
                            </div>
                            {hasAnalysis ? <div className={styles.scores}>
                                {([['Quality', 'councilQuality'], ['Value', 'councilValue'], ['Price target', 'councilPT']] as const).map(([label, field]) =>
                                    <label key={field}>{label}<input type="number" disabled={busy} step={field === 'councilPT' ? '0.001' : '0.1'}
                                        key={`${stock.id}-${field}-${stock[field]}`} defaultValue={stock[field] ?? ''}
                                        onBlur={event => updateNumber(field, event.target.value)}
                                        onFocus={event => event.target.select()} placeholder="Not set" /></label>)}
                            </div> : <p className={styles.muted}>No saved Council result.</p>}
                            {runId && <div className={styles.runReference}>
                                <span title={runId}>{runLabel || runId}</span>
                                <a href={`https://llm-council-analysis.fly.dev/gantt-lab?run_id=${encodeURIComponent(runId)}`}
                                    target="_blank" rel="noopener noreferrer" className={styles.quietButton}>
                                    <ExternalLink size={14} aria-hidden="true" />Lab
                                </a>
                            </div>}
                            <section className={styles.output} id={`council-model-output-${stock.id}`} aria-label="Model output" hidden={!outputOpen}>
                                <div className={styles.dateRow}>
                                    <label>Input date<input type="date" value={inputDate} disabled={busy}
                                        onChange={event => onFieldUpdate(stock.id, 'councilSourceInputAt', event.target.value || null)} /></label>
                                    <button type="button" className={styles.button} disabled={busy}
                                        onClick={() => onFieldUpdate(stock.id, 'councilSourceInputAt', new Date().toISOString().slice(0, 10))}>Today</button>
                                </div>
                                <label className={styles.outputLabel}>Source text
                                    <textarea key={`${stock.id}-${stock.councilSourceOutput || ''}`} defaultValue={stock.councilSourceOutput || ''} disabled={busy}
                                        rows={5} placeholder="Paste the model output here" onBlur={event => {
                                            const value = event.target.value.trim() || null;
                                            if (value !== (stock.councilSourceOutput || null)) onFieldUpdate(stock.id, 'councilSourceOutput', value);
                                        }} />
                                </label>
                            </section>
                            {runsOpen && <div className={styles.savedRuns} id="council-saved-runs">
                                <div className={styles.sectionHeader}><h4>Saved runs</h4>
                                    <button type="button" className={styles.quietButton} onClick={onOpenLab}>
                                        <ExternalLink size={14} aria-hidden="true" />Lab
                                    </button>
                                </div>
                                {runsLoading ? <p className={styles.muted} role="status">Loading runs...</p> : runs.length ?
                                    runs.map(run => <button type="button" className={styles.run} key={run.id || run.label} disabled={busy}
                                        aria-pressed={run.id === runId} title={run.id} onClick={() => onLoadRun(run.id)}>{run.label}</button>)
                                    : <p className={styles.muted}>No saved runs yet.</p>}
                            </div>}
                        </section>
                    </>}
                    {busy && <p className={styles.muted} role="status">Loading saved analysis...</p>}
                    {error && <p className={styles.error} role="alert">{error}</p>}
                    </div>
                    {renderFooter()}
                </>}
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}
