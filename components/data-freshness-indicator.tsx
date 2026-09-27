'use client';

import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Clock3, RefreshCw, TriangleAlert } from 'lucide-react';
import { DATASET_LABELS, dataFreshnessIssues, type Dataset } from '@/lib/data-freshness';
import { useDataFreshness } from '@/lib/use-data-freshness';
import styles from './data-freshness-indicator.module.css';

type RefreshAction = { label: string; run: () => Promise<unknown> | void; disabled?: boolean };
type DataIssue = {
    id: string;
    title: string;
    detail: string;
    action: { label: string; run: () => void; active?: boolean };
    primaryAction?: RefreshAction;
    resolved?: boolean;
    content?: ReactNode;
};
function dateLabel(value?: string) {
    if (!value) return 'Not available';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-AU', { timeZone: 'UTC' }) : 'Not available';
}
export function DataFreshnessIndicator({ datasets, actions = {}, issues = [] }: {
    datasets: Dataset[];
    actions?: Partial<Record<Dataset, RefreshAction>>;
    issues?: DataIssue[];
}) {
    const { data, error, checking, refresh } = useDataFreshness();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const providerIssues = dataFreshnessIssues(data);
    const unresolvedIssues = issues.filter(issue => !issue.resolved);
    const issueCount = providerIssues.length + unresolvedIssues.length;
    const label = error ? 'Data unavailable' : issueCount ? `Issues ${issueCount}` : !data ? 'Checking data' : 'Data';
    const tone = error ? 'warning' : providerIssues[0]?.status.tone || (unresolvedIssues.length ? 'warning' : 'neutral');
    const Icon = tone === 'warning' || tone === 'error' ? TriangleAlert : Clock3;
    const run = async (dataset: string, action: RefreshAction) => {
        setBusy(dataset); setActionError(null);
        try { await action.run(); } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Refresh failed'); }
        finally { setBusy(null); await refresh(); }
    };
    return <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
            <button type="button" className={styles.trigger} data-tone={tone} aria-label={`${label}. Open data issues`} title={`${label}. Open data issues`}>
                <Icon size={14} aria-hidden="true" /><span>{label}</span>
            </button>
        </Popover.Trigger>
        <Popover.Portal>
            <Popover.Content className={styles.panel} sideOffset={8} collisionPadding={12} aria-label="Data issues">
                <header className={styles.header}><h2>Data issues</h2><button type="button" disabled={checking} onClick={() => void refresh()} aria-label="Recheck data" title="Recheck data"><RefreshCw size={16} aria-hidden="true" /></button></header>
                {error && <p className={styles.warning} role="status">{error}.{data ? ' Last known issues shown.' : ''}</p>}
                {actionError && <p className={styles.warning} role="alert">{actionError}</p>}
                {busy && busy in DATASET_LABELS && <p className={styles.details} role="status">Refreshing {DATASET_LABELS[busy as Dataset].toLowerCase()}...</p>}
                {issues.map(issue => <section key={issue.id} className={styles.row} data-relevant="true">
                    <div className={styles.rowHeading}><h3>{issue.title}</h3><span data-tone={issue.resolved ? 'neutral' : 'warning'}>{issue.detail}</span></div>
                    <div className={styles.actions}>
                    {issue.primaryAction && <button type="button" className={`${styles.action} ${styles.primaryAction}`} disabled={Boolean(busy) || issue.primaryAction.disabled} onClick={() => void run(issue.id, issue.primaryAction!)}>
                        {issue.primaryAction.label}
                    </button>}
                    {!issue.resolved &&
                    <button type="button" className={styles.action} aria-pressed={issue.action.active} onClick={() => { issue.action.run(); setOpen(false); }}>
                        {issue.action.label}
                    </button>}
                    </div>
                    {issue.content}
                </section>)}
                {providerIssues.map(({ dataset, name, row, status }) => {
                    const action = actions[dataset];
                    return <section key={dataset} className={styles.row} data-relevant={datasets.includes(dataset)}>
                        <div className={styles.rowHeading}><h3>{name}</h3><span data-tone={status.tone}>{status.label}</span></div>
                        <div className={styles.details}><span>{row?.update_mode === 'EVENT_INGESTION' ? 'Latest evidence' : 'Data through'} {dateLabel(row?.data_fresh_through)}</span>
                            {row && row.records_expected > 0 && <span className={styles.coverage}>Coverage {row.records_updated} / {row.records_expected}</span>}
                        </div>
                        {row?.last_error && <details className={styles.diagnostic}>
                            <summary>Details</summary>
                            <p className={styles.warning}>{row.last_error}</p>
                        </details>}
                        {action && <button type="button" className={styles.action} disabled={Boolean(busy) || action.disabled || row?.status === 'RUNNING'} onClick={() => void run(dataset, action)}><RefreshCw size={13} aria-hidden="true" />{busy === dataset ? 'Updating...' : action.label}</button>}
                    </section>;
                })}
                {!issueCount && !issues.length && !error && !busy && <p className={styles.empty} role="status">{data ? 'No data issues reported.' : 'Checking data...'}</p>}
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>;
}
