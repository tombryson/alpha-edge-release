'use client';
import { subscribePoll } from './polling';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SecurityActionResponse } from './api';
import { ACTIONS_CHANGED, openDecisionHistory } from './action-presentation';
import { toast } from 'sonner';

export function useSecurityActions({
    ticker,
    includeHistory = false,
}: { ticker?: string; includeHistory?: boolean } = {}) {
    const [actions, setActions] = useState<SecurityActionResponse[]>([]);
    // Completed rows leave the pending API before a cached raw alert necessarily refreshes.
    const [managedAlertIds, setManagedAlertIds] = useState<Set<string>>(() => new Set());
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const generation = useRef(0);
    const previous = useRef<SecurityActionResponse[]>([]);
    const refresh = useCallback(async () => {
        const request = ++generation.current;
        try {
            const rows = await api.getSecurityActions({
                ticker,
                includeHistory,
            });
            if (!Array.isArray(rows))
                throw new Error('Invalid execution response');
            if (request === generation.current) {
                if (!includeHistory) {
                    const closed = previous.current.filter(row => row.alert_type === 'WEIGHT_REDUCE' && row.status === 'OPEN' && !rows.some(next => next.id === row.id));
                    for (const row of closed) {
                        void api.getSecurityActions({ ticker: row.ticker, includeHistory: true }).then(history => {
                            const record = history.find(item => item.id === row.id);
                            if (record?.closed_reason) toast.info(`${row.ticker}: ${record.closed_reason}`, {
                                id: `weight-closed-${row.id}`,
                                action: { label: 'History', onClick: () => openDecisionHistory(row.ticker) },
                            });
                        }).catch(() => {});
                    }
                }
                previous.current = rows;
                setManagedAlertIds(previous => new Set([
                    ...previous,
                    ...rows.map(row => String(row.alert_id)),
                ]));
                setActions(rows);
                setError('');
            }
        } catch {
            if (request === generation.current)
                setError(
                    'Execution status could not be refreshed. Last loaded values are shown.',
                );
        } finally {
            if (request === generation.current) setLoading(false);
        }
    }, [ticker, includeHistory]);
    useEffect(() => {
        setActions([]);
        previous.current = [];
        setManagedAlertIds(new Set());
        setError('');
        setLoading(true);
        const stopPolling = subscribePoll(refresh, 30000);
        const changed = () => {
            void refresh();
        };
        window.addEventListener(ACTIONS_CHANGED, changed);
        return () => {
            generation.current++;
            stopPolling();
            window.removeEventListener(ACTIONS_CHANGED, changed);
        };
    }, [refresh]);
    return { actions, managedAlertIds, error, loading, refresh };
}
