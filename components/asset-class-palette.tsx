"use client";

import { useEffect } from 'react';
import { hasApiAccess } from '@/lib/api';
import { classColourStyle } from '@/lib/asset-class-colour-settings';
import { CLASS_COLOUR_CHANGE_EVENT, useClassColours } from '@/lib/asset-class-colour-store';

export function AssetClassPalette() {
    const overrides = useClassColours(state => state.overrides);
    const refresh = useClassColours(state => state.refresh);
    useEffect(() => {
        const load = () => { if (hasApiAccess() && document.visibilityState !== 'hidden') void refresh(); };
        const storage = (event: StorageEvent) => { if (event.key === CLASS_COLOUR_CHANGE_EVENT) load(); };
        load();
        window.addEventListener('focus', load);
        window.addEventListener('storage', storage);
        document.addEventListener('visibilitychange', load);
        return () => {
            window.removeEventListener('focus', load);
            window.removeEventListener('storage', storage);
            document.removeEventListener('visibilitychange', load);
        };
    }, [refresh]);
    return <style data-asset-class-palette>{classColourStyle(overrides)}</style>;
}
