'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { type PortfolioInvestmentBrief } from './portfolio-investment-brief';

export function usePortfolioInvestmentBrief(open: boolean) {
    const [brief, setBrief] = useState<PortfolioInvestmentBrief>({});
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const current = useRef(brief);
    const saved = useRef('{}');
    const pending = useRef<Promise<boolean> | null>(null);
    const initialized = useRef(false);
    useEffect(() => {
        if (!open || pending.current || (initialized.current && JSON.stringify(current.current) !== saved.current)) return;
        let active = true;
        setReady(false);
        api.getPortfolioInvestmentBrief().then(value => {
            if (!active) return;
            current.current = value;
            saved.current = JSON.stringify(value);
            initialized.current = true;
            setBrief(value);
            setReady(true);
            setError('');
        }).catch(err => { if (active) setError(err.message); });
        return () => { active = false; };
    }, [open, reload]);

    const flush = useCallback(async function persist(): Promise<boolean> {
        if (!initialized.current) return false;
        if (pending.current) return await pending.current ? persist() : false;
        const value = current.current;
        if (JSON.stringify(value) === saved.current) return true;
        setSaving(true);
        const operation = api.savePortfolioInvestmentBrief(value).then(() => {
            saved.current = JSON.stringify(value); setError(''); return true;
        }).catch(err => { setError(err.message); return false; });
        pending.current = operation;
        const ok = await operation;
        pending.current = null;
        setSaving(false);
        return ok ? persist() : false;
    }, []);

    useEffect(() => {
        if (!ready) return;
        const timer = setTimeout(() => { void flush(); }, 600);
        return () => clearTimeout(timer);
    }, [brief, ready, flush]);

    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (JSON.stringify(current.current) === saved.current) return;
            event.preventDefault(); event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    return { brief, ready, saving, error, flush, dirty: JSON.stringify(brief) !== saved.current,
        edit: (patch: Partial<PortfolioInvestmentBrief>) => { current.current = { ...current.current, ...patch }; setBrief(current.current); },
        retry: () => ready ? void flush() : setReload(value => value + 1),
    };
}
