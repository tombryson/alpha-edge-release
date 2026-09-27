import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { restorePanelView, restoreAllocationView, type ContextPanelView, type AllocationView } from './context-panel-model';

type PanelState = {
    view: ContextPanelView;
    allocationView: AllocationView;
    assetClass: string;
    security: string;
    shape: string;
    setView: (view: ContextPanelView) => void;
    setAllocationView: (view: AllocationView) => void;
    selectClass: (code: string) => void;
    selectSecurity: (ticker: string) => void;
    selectShape: (id: string) => void;
};

export const useContextPanelStore = create<PanelState>()(persist((set) => ({
    view: 'etf', allocationView: 'line', assetClass: '', security: '', shape: 'current',
    setView: view => set({ view }),
    setAllocationView: allocationView => set({ allocationView }),
    selectClass: assetClass => set({ assetClass }),
    selectSecurity: security => set({ security }),
    selectShape: shape => set({ shape }),
}), {
    name: 'alpha-edge:context-panel',
    skipHydration: true,
    partialize: ({ view, allocationView, assetClass, security, shape }) => ({ view, allocationView, assetClass, security, shape }),
    merge: (persisted, current) => {
        const saved = (persisted || {}) as Partial<PanelState>;
        return { ...current, view: restorePanelView(saved.view), allocationView: restoreAllocationView(saved.allocationView),
            assetClass: typeof saved.assetClass === 'string' ? saved.assetClass : '',
            security: typeof saved.security === 'string' ? saved.security : '',
            shape: typeof saved.shape === 'string' ? saved.shape : 'current' };
    },
}));
