'use client';
import { subscribePoll } from '@/lib/polling';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type ETFAllocationLedgerResponse, type PortfolioMixCurrentResponse, type PortfolioMixSnapshotResponse } from '@/lib/api';
import { useContextPanelStore } from '@/lib/context-panel-store';

type PanelData = {
    ledger: ETFAllocationLedgerResponse | null;
    current: PortfolioMixCurrentResponse | null;
    approved: PortfolioMixSnapshotResponse | null;
};
type DataState = PanelData & {
    errors: Partial<Record<keyof PanelData, string>>;
    loading: boolean;
    revision: number;
    refresh: () => Promise<void>;
    acceptLedger: (ledger: ETFAllocationLedgerResponse) => void;
};
const Context = createContext<DataState | null>(null);
const empty: PanelData = { ledger: null, current: null, approved: null };

export function PanelDataProvider({ children }: { children: ReactNode }) {
    const [data, setData] = useState<PanelData>(empty);
    const [errors, setErrors] = useState<DataState['errors']>({});
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);
    const generation = useRef(0);
    const mounted = useRef(false);
    const refresh = useCallback(async () => {
        const request = ++generation.current;
        const loaders = {
            ledger: api.getETFAllocationLedger,
            current: api.getCurrentPortfolioMix,
            approved: api.getApprovedPortfolioMix,
        };
        const results = await Promise.all(Object.entries(loaders).map(async ([key, loader]) => {
            try { return { key: key as keyof PanelData, value: await loader(), error: undefined }; }
            catch (error) { return { key: key as keyof PanelData, value: undefined, error: error instanceof Error ? error.message : 'Data unavailable' }; }
        }));
        if (!mounted.current || request !== generation.current) return;
        const failures: DataState['errors'] = {};
        const patch: Partial<PanelData> = {};
        for (const result of results) {
            if (result.error) failures[result.key] = result.error;
            else Object.assign(patch, { [result.key]: result.value });
        }
        setData(previous => ({ ...previous, ...patch }));
        setErrors(failures);
        setLoading(false);
        setRevision(value => value + 1);
    }, []);
    const acceptLedger = useCallback((ledger: ETFAllocationLedgerResponse) => {
        ++generation.current;
        setData(previous => ({ ...previous, ledger }));
        setErrors(previous => ({ ...previous, ledger: undefined }));
        window.dispatchEvent(new CustomEvent('etfAllocationPolicyChanged'));
    }, []);

    useEffect(() => {
        mounted.current = true;
        void useContextPanelStore.persist.rehydrate();
        if (!localStorage.getItem('alpha-edge:context-panel')) {
            const legacy = localStorage.getItem('alpha-edge:etf-monitor-view');
            useContextPanelStore.getState().setAllocationView(legacy === 'map' ? 'map' : 'line');
        }
        const stopPolling = subscribePoll(refresh, 30000);
        const changed = () => { void refresh(); };
        window.addEventListener('etfAllocationPolicyChanged', changed);
        window.addEventListener('asset-class-cash-updated', changed);
        return () => {
            mounted.current = false;
            ++generation.current;
            stopPolling();
            window.removeEventListener('etfAllocationPolicyChanged', changed);
            window.removeEventListener('asset-class-cash-updated', changed);
        };
    }, [refresh]);

    return <Context.Provider value={{ ...data, errors, loading, revision, refresh, acceptLedger }}>{children}</Context.Provider>;
}

export function usePanelData() {
    const context = useContext(Context);
    if (!context) throw new Error('PanelDataProvider is required');
    return context;
}
