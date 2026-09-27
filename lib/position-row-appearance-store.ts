'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import { emptyRowPreferences, parseRowPreferences, positionRowClassKey, POSITION_ROW_APPEARANCE_KEY, type PositionRowPreferences, type RowEmblem } from './position-row-appearance';

type AppearanceState = {
    preferences: PositionRowPreferences;
    ready: boolean;
    hydrate: () => void;
    receive: (value: string | null) => void;
    save: (preferences: PositionRowPreferences) => void;
    saveIcon: (code: string, emblem: RowEmblem) => void;
    saveIconColour: (code: string, useClassColour: boolean) => void;
};

export const usePositionRowAppearance = create<AppearanceState>((set, get) => ({
    preferences: emptyRowPreferences(),
    ready: false,
    hydrate: () => {
        if (get().ready || typeof window === 'undefined') return;
        try {
            set({ preferences: parseRowPreferences(localStorage.getItem(POSITION_ROW_APPEARANCE_KEY)), ready: true });
        } catch {
            set({ ready: true });
        }
    },
    receive: raw => set({ preferences: parseRowPreferences(raw), ready: true }),
    save: preferences => {
        const checked = parseRowPreferences(JSON.stringify(preferences));
        // Do not apply an unsaved view when browser storage is unavailable/full.
        localStorage.setItem(POSITION_ROW_APPEARANCE_KEY, JSON.stringify(checked));
        set({ preferences: checked, ready: true });
    },
    saveIcon: (code, emblem) => {
        const key = positionRowClassKey(code);
        if (!key) return;
        const preferences = get().preferences;
        const icons = { ...preferences.icons };
        if (emblem === 'none') delete icons[key];
        else icons[key] = emblem;
        get().save({ ...preferences, icons });
    },
    saveIconColour: (code, useClassColour) => {
        const key = positionRowClassKey(code);
        if (!key) return;
        const preferences = get().preferences;
        const classColourIcons = { ...preferences.classColourIcons };
        if (useClassColour) classColourIcons[key] = true;
        else delete classColourIcons[key];
        get().save({ ...preferences, classColourIcons });
    },
}));

export function usePositionRowAppearanceSync() {
    useEffect(() => {
        usePositionRowAppearance.getState().hydrate();
        const receive = (event: StorageEvent) => {
            if (event.storageArea === localStorage && (event.key === POSITION_ROW_APPEARANCE_KEY || event.key === null)) {
                usePositionRowAppearance.getState().receive(event.newValue);
            }
        };
        window.addEventListener('storage', receive);
        return () => window.removeEventListener('storage', receive);
    }, []);
}
