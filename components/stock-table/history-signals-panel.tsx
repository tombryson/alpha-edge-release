import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AssetClass, DecisionResponse } from '@/lib/api';
import { DECISION_HISTORY_REQUESTED } from '@/lib/action-presentation';
import { Search } from 'lucide-react';
import { DecisionHistoryRecords } from './history-decision-records';
import { actionTypeLabel, historySignalBadgeClass, normalizeActionType } from './action-labels';
import { HISTORY_PANEL_CLASS, HISTORY_TABLE_CLASS, HISTORY_TABLE_SCROLL_CLASS } from './history';
import { HistoryDate, HistoryPagination, HistorySubject } from './history-controls';
import { useHistoryPagination } from './hooks/use-history-pagination';
import styles from './history-workspace.module.css';

type SignalHistoryRow = { ticker: string; type: string; source: string; created_at: string };
type HistorySignalsPanelProps = {
    decisions: DecisionResponse[];
    filteredDecisions: DecisionResponse[];
    decisionHistoryTickerQuery: string;
    setDecisionHistoryTickerQuery: Dispatch<SetStateAction<string>>;
    allSignals: SignalHistoryRow[];
    filteredSignals: SignalHistoryRow[];
    signalHistoryTickerQuery: string;
    setSignalHistoryTickerQuery: Dispatch<SetStateAction<string>>;
    assetClasses: AssetClass[];
};

export function HistorySignalsPanel({ decisions, decisionHistoryTickerQuery,
    setDecisionHistoryTickerQuery, allSignals, filteredSignals, signalHistoryTickerQuery,
    setSignalHistoryTickerQuery, assetClasses }: HistorySignalsPanelProps) {
    const [view, setView] = useState<'decisions' | 'signals'>('decisions');
    const pagination = useHistoryPagination(filteredSignals, signalHistoryTickerQuery);
    useEffect(() => {
        const openDecisions = () => setView('decisions');
        window.addEventListener(DECISION_HISTORY_REQUESTED, openDecisions);
        return () => window.removeEventListener(DECISION_HISTORY_REQUESTED, openDecisions);
    }, []);
    const tabs = <div className={styles.segments} role="group" aria-label="History records">
        <button type="button" aria-pressed={view === 'decisions'} onClick={() => setView('decisions')}>Decisions</button>
        <button type="button" aria-pressed={view === 'signals'} onClick={() => setView('signals')}>Signals</button>
    </div>;
    if (view === 'decisions') return <DecisionHistoryRecords decisions={decisions}
        query={decisionHistoryTickerQuery} setQuery={setDecisionHistoryTickerQuery}
        heading={tabs} assetClasses={assetClasses} />;

    return <section className={`${HISTORY_PANEL_CLASS} ${styles.ledger}`} aria-label="Signal history">
        <div className={styles.header}>
            {tabs}
            <div className={styles.controls}>
                <div className={styles.search}>
                    <Search aria-hidden="true" />
                    <input aria-label="Search signal history" placeholder="Search ticker or class"
                        value={signalHistoryTickerQuery} onChange={event => setSignalHistoryTickerQuery(event.target.value)} />
                </div>
                <HistoryPagination {...pagination} />
            </div>
        </div>
        {allSignals.length === 0 ? <p className={styles.empty}>No signals received yet.</p>
            : filteredSignals.length === 0 ? <p className={styles.empty}>No signals match that ticker or class.</p>
            : <div className={HISTORY_TABLE_SCROLL_CLASS} ref={pagination.scrollRef}>
                <table className={HISTORY_TABLE_CLASS}>
                    <thead><tr><th>Received</th><th>Subject</th><th>Signal</th><th>Source</th></tr></thead>
                    <tbody>{pagination.records.map((signal, index) => <tr key={`${pagination.start + index}-${signal.ticker}-${signal.created_at}`}>
                        <td><HistoryDate value={signal.created_at} /></td>
                        <td><HistorySubject ticker={signal.ticker} assetClasses={assetClasses} /></td>
                        <td><span className={`${styles.badge} ${historySignalBadgeClass(normalizeActionType(signal.type))}`}>{actionTypeLabel(normalizeActionType(signal.type))}</span></td>
                        <td className={styles.secondary}>{signal.source}</td>
                    </tr>)}</tbody>
                </table>
            </div>}
    </section>;
}
