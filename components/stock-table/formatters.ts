export const compactAudFormatter = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
    notation: 'compact',
});

export const audFormatter = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
});

export const formatPerformanceDate = (value: string | number | Date) =>
    new Date(value).toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'short',
    });

export const formatAnalysisPerformancePct = (value?: number | null) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '-';
    }
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(1)}%`;
};

export const analysisPerformanceToneClass = (value?: number | null) => {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(value) ||
        value === 0
    ) {
        return 'text-muted-foreground';
    }
    return value > 0 ? 'text-success' : 'text-destructive';
};

/** Returns true when performanceAsOf is absent or more than 5 days in the past. */
export const isStalePerformance = (asOf?: string | null): boolean => {
    if (!asOf) return true;
    const asOfMs = new Date(asOf).getTime();
    if (isNaN(asOfMs)) return true;
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    return Date.now() - asOfMs > fiveDaysMs;
};

/** Extra CSS classes applied to performance cells when data is stale (>5 days old). */
export const stalePerformanceClass = (asOf?: string | null): string =>
    isStalePerformance(asOf) ? 'opacity-40' : '';
