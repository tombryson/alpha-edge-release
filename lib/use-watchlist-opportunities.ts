'use client';

import { useSyncExternalStore } from 'react';
import { api } from './api';
import { ACTIONS_CHANGED } from './action-presentation';
import { subscribePoll } from './polling';
import type { WatchlistAssessment } from './watchlist-opportunities';

type State = { data: WatchlistAssessment | null; error: string; loading: boolean };
const initial: State = { data: null, error: '', loading: true };
let state = initial;
let generation = 0;
let stop: (() => void) | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
const publish = (next: State) => { state = next; listeners.forEach(listener => listener()); };

export function refreshWatchlist() {
    if (pending) return pending;
    const request = ++generation;
    pending = (async () => {
        try {
            const data = await api.getWatchlistOpportunities();
            if (!Array.isArray(data.items) || !data.as_of) throw new Error('Invalid assessment');
            if (request === generation) publish({ data, error: '', loading: false });
        } catch {
            if (request === generation) publish({ data: null, error: 'Watchlist assessment unavailable', loading: false });
        } finally {
            pending = undefined;
            if (request !== generation && listeners.size) void refreshWatchlist();
        }
    })();
    return pending;
}
const changed = () => {
    generation++;
    publish(initial);
    void refreshWatchlist();
};
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
        stop = subscribePoll(refreshWatchlist, 60_000);
        window.addEventListener(ACTIONS_CHANGED, changed);
    }
    return () => {
        listeners.delete(listener);
        if (!listeners.size) {
            stop?.(); stop = undefined; generation++; state = initial;
            window.removeEventListener(ACTIONS_CHANGED, changed);
        }
    };
};

export function useWatchlistOpportunities() {
    return useSyncExternalStore(subscribe, () => state, () => initial);
}
