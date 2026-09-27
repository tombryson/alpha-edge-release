'use client';

import { useSyncExternalStore } from 'react';
import { api, type WeightPolicyResponse } from './api';
import { subscribePoll } from './polling';
import { ACTIONS_CHANGED } from './action-presentation';

type State = { data: WeightPolicyResponse | null; error: string; saving: boolean };
const initial: State = { data: null, error: '', saving: false };
let state = initial;
let generation = 0;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();
const publish = (next: State) => { state = next; listeners.forEach(listener => listener()); };
async function refresh() {
    if (state.saving) return;
    const request = ++generation;
    try {
        const data = await api.getWeightPolicy();
        if (!Array.isArray(data.targets) || typeof data.enabled !== 'boolean') throw new Error('Invalid weight policy');
        if (request === generation) publish({ ...state, data, error: '' });
    } catch { if (request === generation) publish({ ...state, error: 'Weight management unavailable. Retry shortly.' }); }
}
const changed = () => { void refresh(); };
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
        stop = subscribePoll(refresh, 30_000);
        window.addEventListener(ACTIONS_CHANGED, changed);
    }
    return () => {
        listeners.delete(listener);
        if (!listeners.size) { stop?.(); stop = undefined; generation++; state = initial; window.removeEventListener(ACTIONS_CHANGED, changed); }
    };
};

export function useWeightPolicy() {
    return useSyncExternalStore(subscribe, () => state, () => initial);
}

export async function setWeightManagement(enabled: boolean) {
    if (!state.data || state.saving || state.error) return;
    generation++;
    publish({ ...state, saving: true, error: '' });
    try {
        const data = await api.updateWeightPolicy(enabled, state.data.epoch);
        publish({ data, saving: false, error: '' });
        window.dispatchEvent(new Event(ACTIONS_CHANGED));
    } catch (error) {
        publish({ ...state, saving: false, error: error instanceof Error ? error.message : 'Could not update weight management' });
    }
}
