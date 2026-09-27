'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, FileText, X } from 'lucide-react';
import { ENRICHMENT_TEMPLATES } from '@/lib/enrichment-templates';
import { extractCopyPastePrompt, extractFencedTextBlock } from '@/lib/prompt-yaml';
import { fillResearchPrompt, fillWebUIResearchPrompt, sourceOnlyInstructions } from '@/lib/research-prompts';
import { getCouncilTemplateForAssetClass } from '@/lib/api';
import type { Stock } from '@/lib/store';
import { SourceResearchPanel } from './source-research-panel';
import styles from './research-library.module.css';

type WorkspaceProps = {
    initialTemplateId?: string;
    stock?: Stock;
    attachment?: File | null;
    onAttachSources?: (file: File | null) => void;
    renderHeader?: (templateSelector: ReactNode) => ReactNode;
    renderFooter?: (instructionsControl: ReactNode, primaryAction?: ReactNode) => ReactNode;
};

type Props = WorkspaceProps & { open: boolean; onClose: () => void };

const templates = ENRICHMENT_TEMPLATES.filter(t => t.kind === 'retrieval_brief');

export function EnrichmentTemplateModal({ open, onClose, ...workspace }: Props) {
    const { stock } = workspace;
    const exchange = (stock?.prefix || stock?.symbol?.split(':').slice(0, -1).join(':') || '').replace(/:$/, '').toUpperCase();
    const ticker = stock ? `${exchange ? `${exchange}:` : ''}${stock.symbol.split(':').pop()}` : '';

    return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
        <Dialog.Portal>
            <Dialog.Overlay className={styles.overlay} />
            <Dialog.Content className={styles.dialog} onOpenAutoFocus={event => {
                event.preventDefault(); document.getElementById('research-template-select')?.focus();
            }}>
                <header className={styles.header}>
                    <div>
                        <Dialog.Title className={styles.title}>{stock?.name || 'Research templates'}</Dialog.Title>
                        <Dialog.Description className={styles.subtitle}>
                            {stock ? ticker || 'Exchange and ticker missing' : 'Source research and Web UI prompts'}
                        </Dialog.Description>
                    </div>
                    <Dialog.Close className={styles.iconButton} aria-label="Close research templates" title="Close"><X size={18} /></Dialog.Close>
                </header>
                <ResearchTemplateWorkspace {...workspace} />
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}

export function ResearchTemplateWorkspace({ initialTemplateId, stock, attachment, onAttachSources, renderHeader, renderFooter }: WorkspaceProps) {
    const [kind, setKind] = useState<'retrieval_brief' | 'copy_paste_prompt'>(stock ? 'retrieval_brief' : 'copy_paste_prompt');
    const [templateId, setTemplateId] = useState('');
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [showInstructions, setShowInstructions] = useState(false);
    const [query, setQuery] = useState('');
    const [sourceMethod, setSourceMethod] = useState<'manual' | 'automatic'>('automatic');
    const [savedOpen, setSavedOpen] = useState(false);
    const expectedTemplate = stock
        ? getCouncilTemplateForAssetClass(stock.primaryAssetClass) || stock.templateId || '' : '';
    const exchange = (stock?.prefix || stock?.symbol?.split(':').slice(0, -1).join(':') || '').replace(/:$/, '').toUpperCase();
    const ticker = stock ? `${exchange ? `${exchange}:` : ''}${stock.symbol.split(':').pop()}` : '';
    const identity = useMemo(() => stock ? { name: stock.name, ticker, exchange } : undefined, [stock?.name, ticker, exchange]);

    useEffect(() => {
        const initial = ENRICHMENT_TEMPLATES.find(t => t.id === initialTemplateId || t.templateIds.includes(initialTemplateId || ''));
        const preferred = initial?.templateIds[0] || expectedTemplate;
        setTemplateId(templates.some(t => t.templateIds[0] === preferred) ? preferred : stock ? '' : templates[0].templateIds[0]);
        setKind(stock ? 'retrieval_brief' : 'copy_paste_prompt');
        setShowInstructions(false); setQuery('');
        setSourceMethod('automatic');
        setSavedOpen(false);
    }, [stock?.id, initialTemplateId, expectedTemplate]);

    const selected = ENRICHMENT_TEMPLATES.find(t => t.kind === kind && t.templateIds.includes(templateId));
    const visible = templates.filter(t => t.templateIds.includes(templateId) || `${t.label} ${t.family}`.toLowerCase().includes(query.toLowerCase()));

    useEffect(() => {
        setCopied(false); setPrompt(''); setError('');
        if (!selected) { setLoading(false); return; }
        const abort = new AbortController();
        setLoading(true);
        fetch(selected.path, { signal: abort.signal }).then(async response => {
            if (!response.ok) throw new Error('Could not load these instructions.');
            const text = await response.text();
            const extracted = kind === 'retrieval_brief' ? extractFencedTextBlock(text) : extractCopyPastePrompt(text);
            if (!extracted) throw new Error('This template is missing its instructions.');
            if (!abort.signal.aborted) setPrompt(kind === 'retrieval_brief'
                ? fillResearchPrompt(sourceOnlyInstructions(extracted, selected.templateIds[0]), identity)
                : fillWebUIResearchPrompt(extracted, identity));
        }).catch(err => { if (!abort.signal.aborted) setError(err.message); })
            .finally(() => { if (!abort.signal.aborted) setLoading(false); });
        return () => abort.abort();
    }, [selected?.id, selected?.path, kind, identity]);

    const copy = async () => {
        try { await navigator.clipboard.writeText(prompt); setCopied(true); }
        catch { setError('Clipboard unavailable. Select the prompt text to copy it.'); }
    };

    const templateSelector = <div className={styles.selector}>
            <label htmlFor="research-template-select">Template</label>
            <input aria-label="Find research template" placeholder="Find template" value={query} onChange={event => setQuery(event.target.value)} />
            <select id="research-template-select" value={templateId} onChange={event => setTemplateId(event.target.value)}>
                {!templateId && <option value="">Choose a template</option>}
                {visible.map(t => <option key={t.id} value={t.templateIds[0]}>{t.label.replace(/ Brief$/, '')}</option>)}
            </select>
    </div>;
    const compactTemplateSelector = <select className={styles.compactTemplate} aria-label="Template"
        title={`Research template: ${templates.find(t => t.templateIds.includes(templateId))?.label.replace(/ Brief$/, '') || 'Not selected'}`} value={templateId}
        onChange={event => setTemplateId(event.target.value)}>
        {!templateId && <option value="">Choose a template</option>}
        {templates.map(t => <option key={t.id} value={t.templateIds[0]}>{t.label.replace(/ Brief$/, '')}</option>)}
    </select>;

    const copyButton = <button className={styles.button} type="button" onClick={copy} disabled={!prompt || loading || Boolean(stock && !exchange)}>
        {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy prompt'}
    </button>;
    const promptContent = <>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {loading ? <p className={styles.muted} role="status">Loading instructions...</p>
            : <pre className={styles.prompt}>{prompt || 'Choose a research template.'}</pre>}
    </>;
    const instructionControl = <button className={styles.instructionButton} type="button" aria-expanded={showInstructions}
            onClick={() => setShowInstructions(value => !value)}>
            <FileText size={14} aria-hidden="true" />Retrieval instructions
        </button>;
    const retrievalInstructions = showInstructions ? <>
        <div className={styles.promptActions}>{copyButton}</div>
        {promptContent}
    </> : null;
    const promptTools = <>
        <div className={styles.promptToolbar}>
            <span className={styles.promptLabel}>
                <FileText size={15} />{kind === 'copy_paste_prompt' ? 'Investment analysis prompt' : 'Retrieval instructions'}
            </span>
            {!renderFooter && copyButton}
        </div>
        {promptContent}
    </>;

    const showTemplate = kind === 'copy_paste_prompt' || (sourceMethod === 'automatic' && !savedOpen);
    const showInstructionControl = stock && kind === 'retrieval_brief' && sourceMethod === 'automatic' && !savedOpen;

    return <>
        {renderHeader?.(showTemplate ? compactTemplateSelector : null)}
        <div className={styles.workspace} data-research-workspace>
        <div className={styles.modes} role="group" aria-label="Research mode">
            <button type="button" aria-pressed={kind === 'retrieval_brief'} onClick={() => setKind('retrieval_brief')}>Source research</button>
            <button type="button" aria-pressed={kind === 'copy_paste_prompt'} onClick={() => setKind('copy_paste_prompt')}>Web UI prompts</button>
        </div>
        {!renderHeader && (!stock || showTemplate) && templateSelector}
            {stock && <div className={styles.panel} hidden={kind !== 'retrieval_brief'}>
                <SourceResearchPanel key={stock.id} stock={stock} templateId={templateId} expectedTemplate={expectedTemplate}
                    attachmentFile={attachment} onAttachSources={onAttachSources} method={sourceMethod} onMethodChange={setSourceMethod}
                    visible={kind === 'retrieval_brief'} savedOpen={savedOpen} onSavedOpenChange={setSavedOpen}
                    instructions={retrievalInstructions}
                    renderFooter={action => renderFooter
                        ? renderFooter(showInstructionControl ? instructionControl : null, action)
                        : <footer className={styles.footer}>{showInstructionControl && instructionControl}{action}</footer>} />
            </div>}
            {(kind === 'copy_paste_prompt' || !stock) && <div className={styles.panel}>
                <div className={styles.body} data-research-scroll>{promptTools}</div>
                {renderFooter?.(null, copyButton)}
            </div>}
        </div>
    </>;
}
