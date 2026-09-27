'use client';

import { useEffect, useState } from 'react';
import { api, type PortfolioCyclePerformance, type PortfolioMixSnapshotResponse } from './api';
import { subscribePoll } from './polling';

export function usePortfolioCycle(snapshotId?: number, refreshKey?: string) {
    const [state, setState] = useState<{ id?: number; data: PortfolioCyclePerformance | null; error: string; loading: boolean }>({ data: null, error: '', loading: false });
    useEffect(() => {
        if (!snapshotId) return;
        let alive = true;
        setState({ id: snapshotId, data: null, error: '', loading: true });
        const stop = subscribePoll(async () => {
            try {
                const data = await api.getPortfolioCyclePerformance(snapshotId);
                if (alive) setState({ id: snapshotId, data, error: '', loading: false });
            } catch (error) {
                if (alive) setState({ id: snapshotId, data: null, error: error instanceof Error ? error.message : 'Cycle performance unavailable', loading: false });
            }
        }, 60_000);
        return () => { alive = false; stop(); };
    }, [snapshotId, refreshKey]);
    return state.id === snapshotId ? state : { data: null, error: '', loading: Boolean(snapshotId) };
}

export function portfolioApprovalLock(mix: PortfolioMixSnapshotResponse | null | undefined): string | null {
    const policy = mix?.approval_policy;
    if (!policy || policy.can_approve) return null;
    if (!policy.next_allowed_at) return 'Approval date unavailable. Reload the portfolio before approving.';
    return `Next shape approval: ${new Date(policy.next_allowed_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Four-month minimum.`;
}
