import { create } from 'zustand';
import type { SizingResult } from './api';

// Share the existing Analysis calculation, not a second sizing implementation.
export const usePanelResearch = create<{
    results: Map<number, SizingResult>;
    anchored: boolean;
    publish: (results: Map<number, SizingResult>, anchored: boolean) => void;
}>(set => ({ results: new Map(), anchored: false, publish: (results, anchored) => set({ results, anchored }) }));
