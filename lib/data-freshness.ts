export const DATASET_LABELS = {
    ANALYSIS_PRICE_HISTORY: 'Analysis history',
    ETF_MOMENTUM: 'ETF momentum',
    COMMODITY_PRICE_HISTORY: 'Commodity history',
    REGIME_RETURNS: 'Regime returns',
    LISTING_VERIFICATION: 'Listing checks',
    NEWS_DAILY: 'Daily narrative',
    BROKER_STATEMENTS: 'Broker statements',
    TRADINGVIEW_SIGNALS: 'TradingView events',
} as const;
export type Dataset = keyof typeof DATASET_LABELS;
export type DataRefreshRun = {
    id: number; dataset: string; source: string; update_mode: string; cadence: string;
    trigger_source: string; status: string; last_attempt_at: string;
    finished_at?: string; last_success_at?: string; data_fresh_through?: string;
    coverage_complete: boolean; records_expected: number; records_updated: number;
    error_count: number; message?: string; last_error?: string; stale_after_days: number;
};
export type DataFreshnessResponse = {
    generated_at: string;
    scheduler: { enabled: boolean; daily_utc_hour: number; listing_enabled: boolean;
        listing_utc_hour: number; news_enabled: boolean; news_daily_utc_hour: number; poll_interval_minutes: number };
    datasets: DataRefreshRun[];
};
export type FreshnessState = { label: string; tone: 'neutral' | 'warning' | 'error'; priority: number };

export function datasetFreshness(run?: DataRefreshRun): FreshnessState {
    if (!run) return { label: 'Unavailable', tone: 'warning', priority: 4 };
    if (run.status === 'FAILED') return { label: 'Failed', tone: 'error', priority: 6 };
    if (run.status === 'STALE') return { label: 'Stale', tone: 'warning', priority: 5 };
    if (run.status === 'RUNNING') return { label: 'Updating', tone: 'neutral', priority: 2 };
    if (run.status === 'SKIPPED') return { label: 'Skipped', tone: 'neutral', priority: 1 };
    if (run.status === 'NEVER_RUN') return { label: run.update_mode === 'EVENT_INGESTION' ? 'No events' : 'Not loaded', tone: run.update_mode === 'EVENT_INGESTION' ? 'neutral' : 'warning', priority: run.update_mode === 'EVENT_INGESTION' ? 1 : 4 };
    if (run.status === 'PARTIAL' || !run.coverage_complete || run.error_count > 0 || run.records_updated < run.records_expected)
        return { label: 'Incomplete', tone: 'warning', priority: 4 };
    if (run.status !== 'COMPLETE') return { label: 'Unknown', tone: 'warning', priority: 4 };
    if (run.update_mode === 'EVENT_INGESTION') return { label: run.dataset === 'BROKER_STATEMENTS' ? 'Imported' : 'Received', tone: 'neutral', priority: 0 };
    if (!run.data_fresh_through) return { label: 'Date unavailable', tone: 'warning', priority: 4 };
    return { label: 'Current', tone: 'neutral', priority: 0 };
}

export type FreshnessSnapshot = { data: DataFreshnessResponse | null; error: string | null; checking: boolean };
export function dataFreshnessIssues(data: DataFreshnessResponse | null) {
    if (!data) return [];
    return (Object.keys(DATASET_LABELS) as Dataset[]).map(dataset => {
        const row = data.datasets.find(item => item.dataset === dataset);
        return { dataset, name: DATASET_LABELS[dataset], row, status: datasetFreshness(row) };
    }).filter(item => item.status.tone !== 'neutral')
        .sort((a, b) => b.status.priority - a.status.priority);
}

const EMPTY: FreshnessSnapshot = { data: null, error: null, checking: false };

// One read and one timer for all mounted consumers. Scheduling provider work is
// deliberately outside this resource; refreshing it only reads the ledger.
export function createFreshnessResource(fetchData: () => Promise<DataFreshnessResponse>, intervalMs = 60000) {
    let snapshot = EMPTY;
    let pending: Promise<void> | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let epoch = 0;
    let checkedAt = 0;
    const listeners = new Set<() => void>();
    const emit = (next: FreshnessSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
    const refresh = (): Promise<void> => {
        if (pending) return pending;
        const generation = epoch;
        emit({ ...snapshot, checking: true });
        const job = Promise.resolve().then(fetchData).then(data => {
            if (!data || !Array.isArray(data.datasets) || data.datasets.some(row => !row || typeof row.dataset !== 'string' || typeof row.status !== 'string') || !data.scheduler) throw new Error('Invalid freshness response');
            if (generation === epoch) emit({ data, error: null, checking: false });
        }).catch(() => {
            if (generation === epoch) emit({ ...snapshot, error: 'Freshness check unavailable', checking: false });
        }).finally(() => { if (pending === job) { pending = null; checkedAt = Date.now(); } });
        pending = job;
        return pending;
    };
    const wake = () => {
        if ((typeof document === 'undefined' || document.visibilityState !== 'hidden') && Date.now() - checkedAt >= intervalMs) void refresh();
    };
    return {
        getSnapshot: () => snapshot,
        getServerSnapshot: () => EMPTY,
        refresh,
        reset: () => { epoch++; pending = null; checkedAt = 0; emit(EMPTY); },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            if (listeners.size === 1) {
                wake();
                timer = setInterval(wake, intervalMs);
                if (typeof window !== 'undefined') {
                    window.addEventListener('focus', wake);
                    document.addEventListener('visibilitychange', wake);
                }
            }
            return () => {
                listeners.delete(listener);
                if (!listeners.size) {
                    clearInterval(timer);
                    if (typeof window !== 'undefined') {
                        window.removeEventListener('focus', wake);
                        document.removeEventListener('visibilitychange', wake);
                    }
                }
            };
        },
    };
}
