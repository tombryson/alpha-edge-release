'use client';

import type { ReactNode } from 'react';
import { ChevronUp, ExternalLink, FilePenLine, Plus } from 'lucide-react';
import type { Stock } from '@/lib/store';
import { getAnalysisPriceTargetSources } from '@/lib/analysis-metrics';
import styles from './analysis-row-research.module.css';

type ModelKey = 'gemini' | 'gpt' | 'perplexity' | 'claude';
type ModelRun = {
    definition: { key: ModelKey; label: string };
    quality: number;
    value: number;
    priceTarget: number;
    inputAt: string | null;
    sourceText: string | null;
    complete: boolean;
};

const missing = '\u2014';
const money = (value?: number | null) => value && Number.isFinite(value) && value > 0
    ? `$${value.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`
    : missing;
const score = (value?: number | null) => value && Number.isFinite(value) && value > 0 ? value.toFixed(1) : missing;

function ResearchDate({ value }: { value?: string | null }) {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return <span className={styles.missingDate}>{missing}</span>;
    const stale = Date.now() - parsed.getTime() > 90 * 86_400_000;
    return <time dateTime={value!} className={stale ? styles.stale : undefined}
        title={`${parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}${stale ? ' · More than 90 days old' : ''}`}>
        {parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}
    </time>;
}

export function AnalysisRowResearch({ stock, models, completed, completion, panelWidth, averageTarget,
    upside, upsideColor, suggestedWeight, councilControls, onClose, onEditModel,
}: {
    stock: Stock;
    models: ModelRun[];
    completed: number;
    completion: string;
    panelWidth: number;
    averageTarget: number;
    upside: number | null;
    upsideColor: string;
    suggestedWeight: string;
    councilControls: ReactNode;
    onClose: () => void;
    onEditModel: (key: ModelKey, trigger: HTMLButtonElement) => void;
}) {
    const sources = getAnalysisPriceTargetSources(stock);
    const supplementarySources = sources.filter(source => ['TradingView', 'TipRanks', 'DeerFlow'].includes(source.label));
    const targetExplanation = sources.length
        ? `Equal average of ${sources.length} available price targets:\n${sources.map(source => `${source.label}: ${money(source.value)}`).join('\n')}`
        : 'No price targets available';

    return <section id={`analysis-research-${stock.id}`} aria-labelledby={`analysis-research-title-${stock.id}`}
        className={`analysis-expanded-panel ${styles.panel}`}
        style={{ width: panelWidth > 0 ? panelWidth - 1 : '100%' }}
        onKeyDown={event => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        }}>
        <header className={styles.header}>
            <div className={styles.identity}>
                <h3 id={`analysis-research-title-${stock.id}`}>{stock.name}</h3>
                <span>{completed}/{models.length} models{completion ? ` · ${completion}` : ''}</span>
            </div>
            <div className={styles.summary}>
                <span className={styles.average} tabIndex={0} title={targetExplanation} aria-label={`Average price target ${money(averageTarget)}. ${targetExplanation}`}>
                    <span>Average target</span><strong>{money(averageTarget)}</strong>
                </span>
                <span><span>Upside</span><strong style={{ color: upside == null ? undefined : upsideColor }}>
                    {upside == null ? missing : `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`}
                </strong></span>
            </div>
            <button type="button" className={`${styles.iconButton} ${styles.close}`} onClick={onClose}
                aria-label={`Collapse research for ${stock.name}`} title="Collapse research">
                <ChevronUp size={16} aria-hidden="true" />
            </button>
        </header>

        <div role="table" aria-label={`Research comparison for ${stock.name}`} className={styles.comparison}>
            <div role="row" className={`${styles.row} ${styles.columns}`}>
                <span role="columnheader">Model</span>
                <span role="columnheader">Quality</span>
                <span role="columnheader">Value</span>
                <span role="columnheader">Target</span>
                <span role="columnheader" className={styles.dateColumn}>Updated</span>
                <span role="columnheader" className={styles.actionHeading}><span className="sr-only">Output</span></span>
            </div>
            {models.map(run => {
                const hasData = Boolean(run.quality || run.value || run.priceTarget || run.sourceText);
                const action = `${hasData ? 'Edit' : 'Add'} ${run.definition.label} output for ${stock.name}`;
                return <div role="row" className={`${styles.row} ${styles.editableRow}`} key={run.definition.key}
                    onClick={event => {
                        const trigger = event.currentTarget.querySelector<HTMLButtonElement>('button');
                        if (trigger && !trigger.contains(event.target as Node)) {
                            onEditModel(run.definition.key, trigger);
                        }
                    }}>
                    <span role="cell" className={styles.model}>
                        <span>{run.definition.label}</span>
                        {hasData && !run.complete && <span className={styles.partial}>Partial</span>}
                        <span className={styles.mobileDate}><ResearchDate value={run.inputAt} /></span>
                    </span>
                    <span role="cell" className={styles.number}>{score(run.quality)}</span>
                    <span role="cell" className={styles.number}>{score(run.value)}</span>
                    <span role="cell" className={styles.number}>{money(run.priceTarget)}</span>
                    <span role="cell" className={styles.dateColumn}><ResearchDate value={run.inputAt} /></span>
                    <span role="cell" className={styles.actionCell}>
                        <button type="button" className={`${styles.iconButton}${hasData ? '' : ` ${styles.addOutput}`}`} title={action} aria-label={action}
                            aria-haspopup="dialog" onClick={event => onEditModel(run.definition.key, event.currentTarget)}>
                            {hasData ? <FilePenLine size={15} aria-hidden="true" /> : <Plus size={17} strokeWidth={2.75} aria-hidden="true" />}
                        </button>
                    </span>
                </div>;
            })}
            {supplementarySources.map(source => <div role="row" className={`${styles.row} ${styles.supplementary}`} key={source.label}>
                <span role="cell" className={styles.model}>{source.label}</span>
                <span role="cell">{missing}</span><span role="cell">{missing}</span>
                <span role="cell" className={styles.number}>{money(source.value)}</span>
                <span role="cell" className={styles.dateColumn}>{missing}</span><span role="cell" />
            </div>)}
            <div role="row" className={`${styles.row} ${styles.council}`}>
                <span role="cell" className={styles.model}>
                    <span>Council</span>
                    <span className={styles.mobileDate}><ResearchDate value={stock.councilSourceInputAt} /></span>
                </span>
                <span role="cell" className={styles.number}>{score(stock.councilQuality)}</span>
                <span role="cell" className={styles.number}>{score(stock.councilValue)}</span>
                <span role="cell" className={styles.number}>{money(stock.councilPT)}</span>
                <span role="cell" className={styles.dateColumn}><ResearchDate value={stock.councilSourceInputAt} /></span>
                <span role="cell" className={styles.actionCell}>{stock.councilRunId && <a
                    className={styles.iconButton} href={`https://llm-council-analysis.fly.dev/gantt-lab?run_id=${encodeURIComponent(stock.councilRunId)}`}
                    target="_blank" rel="noopener noreferrer" title="Open Council run in Intelligence" aria-label="Open Council run in Intelligence">
                    <ExternalLink size={14} aria-hidden="true" />
                </a>}</span>
            </div>
        </div>
        <footer className={styles.footer}>
            <span title="Live advisory share of the asset-class stock budget. Not an approved position target.">
                Suggested weight <strong>{suggestedWeight}</strong>
            </span>
            {councilControls}
        </footer>
    </section>;
}
