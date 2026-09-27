type Connection = { ticker: string; script: string };
type CommoditySource = {
    tactical?: { asset_class_code?: string | null };
    stages: { key: string; source: { numerator?: string | null } }[];
};

export const canonicalAlertScript = (script: string) => {
    const value = script.trim().toLowerCase();
    if (value === 'atr_oscillator') return 'tms';
    if (value === 'etf_cdf') return 'etf_tms';
    if (value === 'regime_equities') return 'q4d';
    if (value === 'regime_commodities') return 'ctf';
    if (value === 'regime_position_sizing') return 'q3d';
    return value;
};

export const normalizeConnectionTicker = (ticker: string) => ticker
    .split('/')
    .map(part => part.trim().toUpperCase()
        .replace(/^ASX_DLY:/, 'ASX:')
        .replace(/^BATS:/, 'AMEX:'))
    .join('/');

export function connectionTickersMatch(left: string, right: string): boolean {
    const a = normalizeConnectionTicker(left);
    const b = normalizeConnectionTicker(right);
    if (!a || !b) return false;
    // Ratios must match both sources; a denominator is never a security connection.
    if (a.includes('/') || b.includes('/')) return a === b;
    if (a.includes(':') && b.includes(':')) return a === b;
    return a.split(':').pop() === b.split(':').pop();
}

export function outperformBenchmarksFromThemes(themes: readonly CommoditySource[]): Map<string, string> {
    const benchmarks = new Map<string, string>();
    for (const theme of themes) {
        const assetClass = theme.tactical?.asset_class_code?.trim().toUpperCase();
        if (!assetClass) continue;
        const equity = theme.stages.find(stage => stage.key === 'EQUITY_RELATIVE');
        // Keep configured classes with missing sources distinguishable from non-commodity classes.
        benchmarks.set(assetClass, equity?.source.numerator?.trim().toUpperCase() || '');
    }
    return benchmarks;
}

export function monitoringCoverage({
    ticker, securityType, connections, connectionsReady, managementMode, managementReady,
    outperformBenchmark,
}: {
    ticker: string;
    securityType?: string | null;
    connections: readonly Connection[];
    connectionsReady: boolean;
    managementMode: 'etf_tms' | 'tms';
    managementReady: boolean;
    /** null: not required; undefined: configuration unavailable; empty: source missing. */
    outperformBenchmark?: string | null;
}): { state: 'full' | 'partial' | 'none' | 'unavailable'; title: string } {
    const unavailable = (title: string) => ({ state: 'unavailable' as const, title });
    if (!ticker.trim()) return unavailable('No ticker');
    if (!connectionsReady) return unavailable('Connection data unavailable');
    const isETF = securityType?.trim().toUpperCase() === 'ETF';
    if (isETF && !managementReady) return unavailable('Management mode unavailable');
    if (!isETF && outperformBenchmark === undefined) return unavailable('Monitoring requirements unavailable');
    if (!isETF && outperformBenchmark === '') return unavailable('Outperform benchmark not configured');

    const required = isETF && managementMode === 'etf_tms'
        ? [{ label: 'ETF TMS', ticker, script: 'etf_tms' }]
        : [{ label: 'CDF', ticker, script: 'cdf' }, { label: 'TMS', ticker, script: 'tms' }];
    // ETFs remain funds under either management profile; Alerts only assigns stock Outperform feeds.
    if (!isETF && outperformBenchmark) {
        required.push({ label: 'Outperform', ticker: `${ticker}/${outperformBenchmark}`, script: 'cdf' });
    }
    const missing = required.filter(requirement => !connections.some(connection =>
        canonicalAlertScript(connection.script) === requirement.script &&
        connectionTickersMatch(connection.ticker, requirement.ticker),
    ));
    if (!missing.length) return {
        state: 'full', title: `Full monitoring (${required.map(item => item.label).join(' + ')})`,
    };
    if (required.length === 1) return { state: 'none', title: 'No ETF TMS connection' };
    return {
        state: missing.length === required.length ? 'none' : 'partial',
        title: `${missing.length === required.length ? 'No connections' : 'Partial monitoring'} - missing ${missing.map(item => item.label).join(' + ')}`,
    };
}
