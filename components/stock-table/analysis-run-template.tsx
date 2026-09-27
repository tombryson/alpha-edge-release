'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, RotateCcw } from 'lucide-react';
import { getCouncilTemplateForAssetClass } from '@/lib/api';
import { getAnalysisExchangeCode } from '@/lib/analysis-workbench';
import { ENRICHMENT_TEMPLATES } from '@/lib/enrichment-templates';
import { extractCopyPastePrompt } from '@/lib/prompt-yaml';
import { fillWebUIResearchPrompt } from '@/lib/research-prompts';
import type { Stock } from '@/lib/store';
import styles from './analysis-run-template.module.css';

const templates = ENRICHMENT_TEMPLATES.filter(template => template.kind === 'copy_paste_prompt');

export function AnalysisRunTemplate({ stock, onBack }: { stock: Stock; onBack: () => void }) {
    const [templateId, setTemplateId] = useState(() =>
        getCouncilTemplateForAssetClass(stock.primaryAssetClass) || stock.templateId || '');
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copyError, setCopyError] = useState('');
    const [copied, setCopied] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const textRef = useRef<HTMLTextAreaElement>(null);
    const selected = templates.find(template => template.templateIds.includes(templateId));
    const name = stock.name.trim();
    const exchange = getAnalysisExchangeCode(stock);
    const ticker = stock.symbol.split(':').pop()?.trim().toUpperCase() || '';
    const missing = [!name && 'company name', !ticker && 'ticker', !exchange && 'exchange'].filter(Boolean);

    useEffect(() => {
        setPrompt(''); setError(''); setCopyError(''); setCopied(false);
        if (!selected) { setLoading(false); return; }
        const abort = new AbortController();
        setLoading(true);
        fetch(selected.path, { signal: abort.signal }).then(async response => {
            if (!response.ok) throw new Error('Could not load this template.');
            const extracted = extractCopyPastePrompt(await response.text());
            if (!extracted) throw new Error('This template is missing its prompt.');
            if (!abort.signal.aborted) setPrompt(fillWebUIResearchPrompt(extracted, {
                name: name || '[COMPANY_NAME]', ticker: ticker || '[TICKER]', exchange: exchange || '[EXCHANGE_CODE]',
            }));
        }).catch(reason => {
            if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load this template.');
        }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
        return () => abort.abort();
    }, [selected, name, ticker, exchange, attempt]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true); setCopyError('');
        } catch {
            textRef.current?.focus(); textRef.current?.select();
            setCopyError('Clipboard unavailable. The prompt is selected for manual copying.');
        }
    };

    return <>
        <div className={`analysis-run-body ${styles.body}`}>
            <div className={styles.toolbar}>
                <select aria-label="Research template" value={selected ? templateId : ''}
                    onChange={event => setTemplateId(event.target.value)}>
                    {!selected && <option value="">Choose a template</option>}
                    {templates.map(template => <option key={template.id} value={template.templateIds[0]}>
                        {template.label.replace(/ Prompt$/, '')}
                    </option>)}
                </select>
                <span className={styles.identity}>{exchange ? `${exchange}:` : ''}{ticker || 'Ticker missing'}</span>
            </div>
            {missing.length > 0 && <p className={styles.warning} role="alert">Set {missing.join(' and ')} for this security before copying.</p>}
            {error && <div className={styles.error} role="alert">{error}
                <button type="button" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={13} aria-hidden="true" />Retry</button>
            </div>}
            {copyError && <p className={styles.warning} role="alert">{copyError}</p>}
            {loading && <span className={styles.status} role="status">Loading template...</span>}
            <textarea ref={textRef} className={styles.prompt} aria-label="Investment analysis prompt" readOnly value={prompt}
                aria-busy={loading} spellCheck={false} placeholder={selected ? '' : 'Choose a research template.'} />
        </div>
        <div className={styles.actions}>
            <button type="button" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />Back to run</button>
            <button type="button" className={styles.copy} onClick={copy}
                disabled={!prompt || loading || missing.length > 0 || Boolean(error)}>
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy prompt'}
            </button>
        </div>
    </>;
}
