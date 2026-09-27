type Refresh = () => unknown | Promise<unknown>;
type Entry = { listeners: Set<number>; refresh: Refresh; running: boolean; due: number };

// Component subscriptions keep their existing cadence; one clock owns recurring
// reads. Identical store callbacks share a subscription, not another timer.
export function createPollingCoordinator() {
    const entries = new Map<Refresh, Entry>();
    const intervals = new Map<number, number>();
    let nextID = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const visible = () => typeof document === 'undefined' || !document.hidden;
    const cadence = (entry: Entry) => Math.min(...[...entry.listeners].map(id => intervals.get(id)!));
    const nextBoundary = (intervalMs: number) => (Math.floor(Date.now() / intervalMs) + 1) * intervalMs;
    const run = (entry: Entry) => {
        if (entry.running || !entry.listeners.size) return;
        entry.running = true;
        entry.due = nextBoundary(cadence(entry));
        void Promise.resolve().then(() => entry.listeners.size ? entry.refresh() : undefined).catch(error => {
            console.error('[ALPHA EDGE] Background refresh failed:', error);
        }).finally(() => { entry.running = false; });
    };
    const tick = () => {
        if (!visible()) return;
        for (const entry of entries.values()) if (Date.now() >= entry.due) run(entry);
    };
    const wake = () => {
        if (!visible()) {
            clearInterval(timer); timer = undefined;
            return;
        }
        if (!timer && entries.size) timer = setInterval(tick, 1000);
        tick();
    };
    return {
        subscribe(refresh: Refresh, intervalMs: number, { immediate = true }: { immediate?: boolean } = {}) {
            if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error('Polling cadence must be at least one second');
            const id = ++nextID;
            intervals.set(id, intervalMs);
            let entry = entries.get(refresh);
            if (!entry) {
                entry = { refresh, listeners: new Set(), running: false, due: immediate ? 0 : nextBoundary(intervalMs) };
                entries.set(refresh, entry);
            }
            entry.listeners.add(id);
            entry.due = Math.min(entry.due, nextBoundary(intervalMs));
            if (intervals.size === 1 && typeof window !== 'undefined') {
                window.addEventListener('focus', wake);
                document.addEventListener('visibilitychange', wake);
            }
            wake();
            return () => {
                if (!intervals.has(id)) return;
                entry.listeners.delete(id);
                intervals.delete(id);
                if (!entry.listeners.size) entries.delete(refresh);
                if (!entries.size) {
                    clearInterval(timer); timer = undefined;
                    if (typeof window !== 'undefined') {
                        window.removeEventListener('focus', wake);
                        document.removeEventListener('visibilitychange', wake);
                    }
                }
            };
        },
    };
}

const coordinator = createPollingCoordinator();
export const subscribePoll = coordinator.subscribe;
