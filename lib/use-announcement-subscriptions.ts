'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import type { AnnouncementSubscription } from './announcement-subscriptions';

export function useAnnouncementSubscriptions() {
    const [items, setItems] = useState<AnnouncementSubscription[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const generation = useRef(0);
    const stocks = useStore(state => state.stocks);
    const refresh = useCallback(async () => {
        const request = ++generation.current;
        try {
            const data = await api.getAnnouncementSubscriptions();
            if (request === generation.current) { setItems(data.items); setError(''); }
        } catch {
            if (request === generation.current) setError('Announcement setup could not be loaded.');
        } finally {
            if (request === generation.current) setLoading(false);
        }
    }, []);
    // Reuse the holdings refresh lifecycle; no additional provider/polling timer.
    useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh, stocks]);
    return { items, error, loading, refresh };
}
