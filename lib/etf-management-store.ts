import { create } from 'zustand';
import { api, type ETFManagementMode, type ETFManagementProfile } from './api';

export const managementTicker = (ticker: string) => ticker.split(':').pop()?.trim().toUpperCase() || '';

export const useETFManagement = create<{
    modes: Record<string, ETFManagementMode>;
    ready: boolean;
    error: string;
    refresh: () => Promise<void>;
    accept: (profile: ETFManagementProfile) => void;
}>((set) => {
    let generation = 0;
    return {
        modes: {}, ready: false, error: '',
        accept: profile => { ++generation; set(state => ({ modes: { ...state.modes, [managementTicker(profile.ticker)]: profile.mode }, ready: true, error: '' })); },
        refresh: async () => {
            const request = ++generation;
            try {
                const profiles = await api.getETFManagementProfiles();
                if (generation !== request) return;
                set({ modes: Object.fromEntries(profiles.map(profile => [managementTicker(profile.ticker), profile.mode])), ready: true, error: '' });
            } catch (error) {
                if (generation === request) set({ ready: false, error: error instanceof Error ? error.message : 'Management modes unavailable' });
            }
        },
    };
});
