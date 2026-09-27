'use client';

import { useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Play, Plus, Trash2, X, RotateCw } from 'lucide-react';
import { prepareInvestmentPlays, type PortfolioInvestmentPlay } from '@/lib/portfolio-investment-plays';
import { useInvestmentPlayLibrary } from '@/lib/use-investment-play-library';
import { usePortfolioInvestmentBrief } from '@/lib/use-portfolio-investment-brief';
import { prepareInvestmentBrief, RISK_TOLERANCE_OPTIONS, TIME_HORIZON_OPTIONS, type PortfolioInvestmentBrief } from '@/lib/portfolio-investment-brief';
import styles from './portfolio-analysis-dialog.module.css';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStart: (plays: PortfolioInvestmentPlay[], brief: PortfolioInvestmentBrief) => Promise<boolean>;
    error: string | null;
}

export function PortfolioAnalysisDialog({ open, onOpenChange, onStart, error }: Props) {
    const library = useInvestmentPlayLibrary(open);
    const investmentBrief = usePortfolioInvestmentBrief(open);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState('');
    const submittingRef = useRef(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (submittingRef.current) return;
        setValidationError('');
        let prepared: PortfolioInvestmentPlay[];
        try {
            prepared = prepareInvestmentPlays(library.plays.filter(play => selected.has(play.id)));
            prepareInvestmentBrief(investmentBrief.brief);
        } catch (err) {
            setValidationError((err as Error).message);
            return;
        }
        submittingRef.current = true;
        setSubmitting(true);
        try {
            if (!await library.flush()) return;
            if (!await investmentBrief.flush()) return;
            if (await onStart(prepared, prepareInvestmentBrief(investmentBrief.brief))) onOpenChange(false);
        } catch (err) {
            setValidationError(err instanceof Error ? err.message : 'Unable to start portfolio analysis.');
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }

    return <Dialog.Root open={open} onOpenChange={(next) => {
        if (!submittingRef.current) {
            if (!next) { void library.flush(); void investmentBrief.flush(); }
            onOpenChange(next);
        }
    }}>
        <Dialog.Portal>
            <Dialog.Overlay className={styles.overlay} />
            <Dialog.Content className={styles.dialog}>
                <header className={styles.header}>
                    <Dialog.Title className={styles.title}>Portfolio analysis</Dialog.Title>
                    <Dialog.Close className={styles.iconButton} disabled={submitting} aria-label="Close" title="Close">
                        <X size={18} />
                    </Dialog.Close>
                </header>
                <form onSubmit={submit} className={styles.form}>
                    <div className={styles.body}>
                        <fieldset disabled={submitting || !investmentBrief.ready} className={styles.briefFields}>
                            <div className={styles.briefGrid}>
                                <label>Risk tolerance<select aria-label="Risk tolerance" value={investmentBrief.brief.risk_tolerance || ''}
                                    title="Willingness to accept investment losses; not a guaranteed loss limit."
                                    onChange={event => investmentBrief.edit({ risk_tolerance: event.target.value as PortfolioInvestmentBrief['risk_tolerance'] || undefined })}>
                                    <option value="">Not specified</option>
                                    {RISK_TOLERANCE_OPTIONS.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
                                </select></label>
                                <label>Time horizon<select aria-label="Time horizon" value={investmentBrief.brief.time_horizon || (investmentBrief.brief.horizon_months !== undefined ? 'saved_months' : '')}
                                    onChange={event => investmentBrief.edit({ time_horizon: event.target.value as PortfolioInvestmentBrief['time_horizon'] || undefined, horizon_months: undefined })}>
                                    <option value="">Not specified</option>
                                    {investmentBrief.brief.horizon_months !== undefined && <option value="saved_months" disabled>{investmentBrief.brief.horizon_months} months (saved)</option>}
                                    {TIME_HORIZON_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
                                </select></label>
                            </div>
                        </fieldset>
                        <div className={styles.libraryStatus} role="status" aria-label="Investment brief storage">{investmentBrief.error ? 'Brief not saved' : investmentBrief.saving ? 'Saving brief...' : investmentBrief.dirty ? 'Unsaved changes' : investmentBrief.ready ? 'Brief saved' : 'Loading brief...'}</div>
                        <details className={styles.brief}>
                            <summary>Investment brief <span>{investmentBrief.brief.portfolio_scope === 'whole_portfolio' ? 'Whole portfolio' : investmentBrief.brief.portfolio_scope === 'thematic_sleeve' ? 'Thematic sleeve' : 'Not specified'}</span></summary>
                            <fieldset disabled={submitting || !investmentBrief.ready} className={styles.briefFields}>
                                <label>Portfolio scope<select aria-label="Portfolio scope" value={investmentBrief.brief.portfolio_scope || ''} onChange={event => investmentBrief.edit({ portfolio_scope: event.target.value as PortfolioInvestmentBrief['portfolio_scope'] || undefined })}>
                                    <option value="">Not specified</option><option value="whole_portfolio">Whole investment portfolio</option><option value="thematic_sleeve">Resources / thematic sleeve</option>
                                </select></label>
                                <label>Investment objective<textarea aria-label="Investment objective" rows={2} value={investmentBrief.brief.investment_objective || ''} onChange={event => investmentBrief.edit({ investment_objective: event.target.value })} /></label>
                                <label>Base currency<input value={investmentBrief.brief.base_currency || ''} maxLength={3} onChange={event => investmentBrief.edit({ base_currency: event.target.value.toUpperCase() })} /></label>
                                <details><summary>Risk and implementation</summary><div className={styles.briefFields}>
                                    <label>Benchmark<input value={investmentBrief.brief.benchmark || ''} onChange={event => investmentBrief.edit({ benchmark: event.target.value })} /></label>
                                    <div className={styles.briefGrid}>
                                        <label>Drawdown tolerance (%)<input type="number" min={0} max={100} value={investmentBrief.brief.max_drawdown_pct ?? ''} onChange={event => investmentBrief.edit({ max_drawdown_pct: event.target.value ? Number(event.target.value) : undefined })} /></label>
                                        <label>Minimum liquidity (%)<input type="number" min={0} max={100} value={investmentBrief.brief.liquidity_min_pct ?? ''} onChange={event => investmentBrief.edit({ liquidity_min_pct: event.target.value ? Number(event.target.value) : undefined })} /></label>
                                    </div>
                                    <label>Tax and trading-cost policy<textarea aria-label="Tax and trading-cost policy" rows={2} value={investmentBrief.brief.tax_cost_policy || ''} onChange={event => investmentBrief.edit({ tax_cost_policy: event.target.value })} /></label>
                                    <label>Currency-hedging policy<input value={investmentBrief.brief.currency_hedge_policy || ''} onChange={event => investmentBrief.edit({ currency_hedge_policy: event.target.value })} /></label>
                                    <label>Investment restrictions<textarea aria-label="Investment restrictions" rows={2} value={investmentBrief.brief.investment_restrictions || ''} onChange={event => investmentBrief.edit({ investment_restrictions: event.target.value })} /></label>
                                </div></details>
                            </fieldset>
                        </details>
                        {investmentBrief.error && <div className={styles.error} role="alert">{investmentBrief.error}<button type="button" className={styles.iconButton} aria-label="Retry brief storage" title="Retry brief storage" onClick={investmentBrief.retry}><RotateCw size={16} /></button></div>}
                        <div className={styles.sectionHeading}>
                            <h3>Investment plays</h3><span>Optional</span>
                        </div>
                        <Dialog.Description className={styles.description}>Saved plays</Dialog.Description>
                        <div className={styles.libraryStatus} role="status" aria-label="Investment plays storage">
                            {!library.ready && !library.error ? 'Loading...' : library.saving ? 'Saving...' : library.dirty ? 'Unsaved changes' : library.ready ? 'Saved' : ''}
                        </div>
                        {library.ready && library.plays.map((play, index) => <fieldset className={styles.play} key={play.id} disabled={submitting}>
                            <legend><label className={styles.include}>
                                <input type="checkbox" checked={selected.has(play.id)} aria-label={`Include play ${index + 1}`}
                                    onChange={(event) => {
                                        setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(play.id); else next.delete(play.id); return next; });
                                        setValidationError('');
                                    }} />Include in this analysis
                            </label></legend>
                            <div className={styles.playHeading}>
                                <label>Title
                                    <input aria-label={`Play ${index + 1} title`} value={play.title}
                                        onChange={(event) => { library.edit(play.id, { title: event.target.value }); setValidationError(''); }} />
                                </label>
                                <button type="button" className={styles.iconButton} title={`Delete saved play ${index + 1}`} aria-label={`Delete saved play ${index + 1}`}
                                    onClick={() => { library.remove(play.id); setValidationError(''); }}><Trash2 size={16} /></button>
                            </div>
                            <label>Thesis
                                <textarea rows={3} aria-label={`Play ${index + 1} thesis`} value={play.thesis}
                                    onChange={(event) => { library.edit(play.id, { thesis: event.target.value }); setValidationError(''); }} />
                            </label>
                        </fieldset>)}
                        <button type="button" className={styles.addButton} disabled={submitting || !library.ready}
                            onClick={() => { const id = library.add(); setSelected(previous => new Set([...previous, id])); setValidationError(''); }}><Plus size={16} />Add play</button>
                        {library.error && <div className={styles.error} role="alert">{library.error}
                            <button type="button" className={styles.iconButton} title="Retry plays storage" aria-label="Retry plays storage" disabled={library.saving} onClick={library.retry}><RotateCw size={16} /></button>
                        </div>}
                        {(validationError || error) && <p role="alert" className={styles.error}>{validationError || error}</p>}
                    </div>
                    <footer className={styles.footer}>
                        <Dialog.Close asChild><button type="button" className={styles.button} disabled={submitting}>Cancel</button></Dialog.Close>
                        <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={submitting || !library.ready || !investmentBrief.ready}>
                            {submitting ? <Loader2 size={16} className={styles.spinner} /> : <Play size={16} />}
                            {submitting ? 'Starting analysis...' : 'Start analysis'}
                        </button>
                    </footer>
                </form>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}
