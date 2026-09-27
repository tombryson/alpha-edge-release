'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { investmentPlayChanges, investmentPlaySettings, type SavedInvestmentPlay } from './portfolio-investment-plays';

export function useInvestmentPlayLibrary(open: boolean) {
    const [plays, setPlays] = useState<SavedInvestmentPlay[]>([]);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [reload, setReload] = useState(0);
    const current = useRef<SavedInvestmentPlay[]>([]);
    const saved = useRef<Record<string, string>>({});
    const inFlight = useRef<Promise<boolean> | null>(null);
    const initialized = useRef(false);

    useEffect(() => {
        if (!open || inFlight.current || Object.keys(investmentPlayChanges(current.current, saved.current)).length) return;
        let active = true;
        setReady(false);
        setError('');
        api.getInvestmentPlays().then(rows => {
            if (!active) return;
            current.current = rows;
            saved.current = investmentPlaySettings(rows);
            initialized.current = true;
            setPlays(rows);
            setReady(true);
        }).catch(err => { if (active) setError(err.message); });
        return () => { active = false; };
    }, [open, reload]);

    const flush = useCallback(async function persist(): Promise<boolean> {
        if (!initialized.current) return false;
        if (inFlight.current) return await inFlight.current ? persist() : false;
        const updates = investmentPlayChanges(current.current, saved.current);
        if (!Object.keys(updates).length) { setError(''); return true; }
        setSaving(true);
        setError('');
        const operation = api.saveInvestmentPlays(updates).then(() => {
            saved.current = { ...saved.current, ...updates };
            return true;
        }).catch(err => { setError(err.message); return false; });
        inFlight.current = operation;
        const success = await operation;
        inFlight.current = null;
        setSaving(false);
        // Edits made while a save was pending must follow that save, never race it.
        return success ? persist() : false;
    }, []);

    useEffect(() => {
        if (!revision) return;
        const timer = setTimeout(() => { void flush(); }, 600);
        return () => clearTimeout(timer);
    }, [revision, flush]);

    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (!Object.keys(investmentPlayChanges(current.current, saved.current)).length) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    function update(rows: SavedInvestmentPlay[]) {
        current.current = rows;
        setPlays(rows);
        setRevision(value => value + 1);
    }

    function add() {
        const now = new Date().toISOString();
        const row: SavedInvestmentPlay = { id: crypto.randomUUID(), version: 1, title: '', thesis: '', created_at: now, updated_at: now };
        update([...current.current, row]);
        return row.id;
    }

    function edit(id: string, patch: { title?: string; thesis?: string }) {
        update(current.current.map(row => row.id === id ? { ...row, ...patch, updated_at: new Date().toISOString() } : row));
    }

    return { plays, ready, saving, error, add, edit, flush,
        dirty: Object.keys(investmentPlayChanges(plays, saved.current)).length > 0,
        remove: (id: string) => update(current.current.filter(row => row.id !== id)),
        retry: () => ready ? void flush() : setReload(value => value + 1),
    };
}
