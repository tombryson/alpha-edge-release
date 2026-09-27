import { create } from 'zustand';
import { api } from './api';
import { assetClassColourKey } from './asset-class-identity';
import { classColourOverrides, normaliseClassColour, type AssetClassColourOverrides } from './asset-class-colour-settings';

export const CLASS_COLOUR_CHANGE_EVENT = 'alpha-edge-class-colours-changed';

export const useClassColours = create<{
    overrides: AssetClassColourOverrides;
    ready: boolean;
    refreshing: boolean;
    saving: boolean;
    error: string;
    refresh: () => Promise<void>;
    save: (code: string, value: string) => Promise<void>;
}>((set, get) => {
    let generation = 0;
    return {
        overrides: {}, ready: false, refreshing: false, saving: false, error: '',
        refresh: async () => {
            if (get().saving || get().refreshing) return;
            const request = ++generation;
            set({ refreshing: true });
            try {
                const settings = await api.getClassColourSettings();
                if (generation === request) set({ overrides: classColourOverrides(settings), ready: true, error: '' });
            } catch (error) {
                if (generation === request) set({ error: error instanceof Error ? error.message : 'Saved colours are unavailable.' });
            } finally {
                if (generation === request) set({ refreshing: false });
            }
        },
        save: async (code, value) => {
            if (!get().ready || get().saving) throw new Error('Please wait for the saved colours to load.');
            const colour = value === '' ? '' : normaliseClassColour(value);
            if (colour === null) throw new Error('Enter a six-digit hex colour, such as #d4a72c.');
            ++generation;
            set({ saving: true, refreshing: false });
            try {
                const saved = await api.saveClassColour(code, colour);
                if (saved !== '' && !normaliseClassColour(saved)) throw new Error('The server returned an invalid colour. Reload before retrying.');
                set(state => {
                    const overrides = { ...state.overrides };
                    const key = assetClassColourKey(code);
                    if (saved === '') delete overrides[key];
                    else overrides[key] = normaliseClassColour(saved)!;
                    return { overrides, error: '' };
                });
                // Only a change notification is local; the backend remains authoritative.
                try { localStorage.setItem(CLASS_COLOUR_CHANGE_EVENT, `${Date.now()}-${Math.random()}`); } catch { /* Storage may be disabled. */ }
            } finally {
                set({ saving: false });
            }
        },
    };
});
