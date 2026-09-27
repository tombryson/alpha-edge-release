'use client';

import { useSyncExternalStore } from 'react';
import { api, API_UNAUTHORIZED_EVENT } from './api';
import { createFreshnessResource } from './data-freshness';

const resource = createFreshnessResource(() => api.getDataFreshness());
let subscribers = 0;
function subscribe(listener: () => void) {
    const unsubscribe = resource.subscribe(listener);
    if (++subscribers === 1) window.addEventListener(API_UNAUTHORIZED_EVENT, resource.reset);
    return () => {
        unsubscribe();
        if (--subscribers === 0) window.removeEventListener(API_UNAUTHORIZED_EVENT, resource.reset);
    };
}
export function useDataFreshness() {
    return { ...useSyncExternalStore(subscribe, resource.getSnapshot, resource.getServerSnapshot), refresh: resource.refresh };
}
