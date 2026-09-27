'use client';

import { useMemo, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { AssetClass, DecisionResponse } from '@/lib/api';
import { useSecurityActions } from '@/lib/use-security-actions';
import {
    actionInstruction,
    actionStatusDetail,
    actionStatusLabel,
    actionStatusTone,
    decisionHistoryRecords,
} from '@/lib/action-presentation';
import { ActionEvidence } from '@/components/alerts/action-detail-dialog';
import actionStyles from '@/components/alerts/action-detail.module.css';
import { actionTypeLabel, securityActionLabel } from './action-labels';
import { HistoryDate, HistoryPagination, HistorySubject } from './history-controls';
import { useHistoryPagination } from './hooks/use-history-pagination';
import styles from './history-workspace.module.css';
import {
    HISTORY_PANEL_CLASS,
    HISTORY_TABLE_CLASS,
    HISTORY_TABLE_SCROLL_CLASS,
} from './history';

export function DecisionHistoryRecords({
    decisions,
    query,
    setQuery,
    heading,
    assetClasses,
}: {
    decisions: DecisionResponse[];
    query: string;
    setQuery: Dispatch<SetStateAction<string>>;
    heading?: ReactNode;
    assetClasses?: AssetClass[];
}) {
    const { actions, error, loading, refresh } = useSecurityActions({
        includeHistory: true,
    });
    const records = useMemo(
        () => decisionHistoryRecords(decisions, actions),
        [decisions, actions],
    );
    const filtered = records.filter((row) =>
        row.ticker.replace(/_/g, ' ').toUpperCase().includes(query.trim().replace(/_/g, ' ').toUpperCase()),
    );
    const pagination = useHistoryPagination(filtered, query);
    return (
        <section className={`${HISTORY_PANEL_CLASS} ${styles.ledger}`} aria-label="Decision history">
            <div className={styles.header}>
                {heading || <h2 className="terminal-workspace-title">Decision history</h2>}
                <div className={styles.controls}>
                    <div className={styles.search}>
                        <Search aria-hidden="true" />
                        <input
                            aria-label="Search decision history"
                            placeholder="Search ticker or class"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </div>
                    <HistoryPagination {...pagination} />
                </div>
            </div>
            {error && (
                <p role="alert" className={actionStyles.error}>
                    {error}{' '}
                    <button
                        className={actionStyles.button}
                        onClick={() => void refresh()}
                    >
                        Retry status
                    </button>
                </p>
            )}
            {loading && (
                <p role="status" className="p-4 text-muted-foreground">
                    Loading execution history...
                </p>
            )}
            {!loading && filtered.length === 0 && (
                <p className="p-4 text-muted-foreground">
                    {query
                        ? 'No records match that ticker.'
                        : 'No decisions recorded yet.'}
                </p>
            )}
            {filtered.length > 0 && (
                <div className={HISTORY_TABLE_SCROLL_CLASS} ref={pagination.scrollRef}>
                    <table className={HISTORY_TABLE_CLASS}>
                        <thead>
                            <tr>
                                {[
                                    'Date',
                                    'Subject',
                                    'Instruction',
                                    'Response',
                                    'Verification',
                                    'Details',
                                ].map((label) => (
                                    <th key={label}>
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {pagination.records.map((row) => (
                                <tr
                                    key={row.key}
                                    className="terminal-workspace-row"
                                    data-testid={`decision-record-${row.key}`}
                                >
                                    <td>
                                        <HistoryDate value={row.date} />
                                    </td>
                                    <td>
                                        <HistorySubject ticker={row.ticker} assetClasses={assetClasses} />
                                    </td>
                                    <td>
                                        {securityActionLabel(row.alertType)}
                                    </td>
                                    <td>
                                        {row.decision
                                            ? actionTypeLabel(
                                                  row.decision.decision,
                                              )
                                            : row.action?.status ===
                                                'OVERRIDDEN'
                                              ? 'Position retained'
                                              : row.action && ['OPEN', 'BLOCKED'].includes(row.action.status)
                                                ? 'Not recorded'
                                              : row.action && (row.action.execution_reported_at ||
                                                    ['AWAITING_STATEMENT', 'VARIANCE'].includes(row.action.status))
                                                ? 'Execution recorded'
                                                : 'System closure'}
                                    </td>
                                    <td>
                                        {row.action ? (
                                            <span
                                                className={actionStyles.status}
                                                data-tone={actionStatusTone(
                                                    row.action,
                                                )}
                                            >
                                                {actionStatusLabel(row.action)}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">
                                                Not recorded
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        {row.action ? (
                                            <details className={styles.record}>
                                                <summary>
                                                    <ChevronRight aria-hidden="true" /> View record
                                                </summary>
                                                <div className={styles.recordBody}>
                                                    <p>
                                                        {actionInstruction(
                                                            row.action,
                                                        )}
                                                    </p>
                                                    <p className="mt-2">
                                                        {actionStatusDetail(
                                                            row.action,
                                                        )}
                                                    </p>
                                                    {row.decision?.notes && (
                                                        <p className="mt-2 whitespace-pre-wrap">
                                                            {row.decision.notes}
                                                        </p>
                                                    )}
                                                    <ActionEvidence
                                                        action={row.action}
                                                    />
                                                </div>
                                            </details>
                                        ) : (
                                            row.decision?.notes || '-'
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
