import type { AnalysisMetricSecurity } from './analysis-metrics';

export type AnalysisWorkbenchSecurity = AnalysisMetricSecurity & {
    name?: string | null;
    symbol?: string | null;
    prefix?: string | null;
    primaryAssetClass?: string | null;
};

export const getAnalysisExchangeCode = (stock: Pick<AnalysisWorkbenchSecurity, 'prefix'>) =>
    String(stock.prefix || '').replace(':', '').trim();

export const matchesAnalysisSearch = (
    stock: AnalysisWorkbenchSecurity,
    query: string,
) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [
        stock.name,
        stock.symbol,
        stock.prefix,
        stock.primaryAssetClass,
    ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
};

export const getAnalysisGroupPerformance = (
    stocks: ReadonlyArray<{
        performance6MPct?: number | null;
        performanceAsOf?: string | null;
    }>,
) => {
    let sum = 0;
    let coveredCount = 0;
    let undatedCount = 0;
    let oldestAsOf: string | null = null;
    let oldestTime = Infinity;

    for (const stock of stocks) {
        const value = stock.performance6MPct;
        if (value == null || !Number.isFinite(value)) continue;
        sum += value;
        coveredCount += 1;
        const time = stock.performanceAsOf ? Date.parse(stock.performanceAsOf) : NaN;
        if (!Number.isFinite(time)) undatedCount += 1;
        else if (time < oldestTime) {
            oldestTime = time;
            oldestAsOf = stock.performanceAsOf!;
        }
    }

    return {
        averagePct: coveredCount > 0 ? sum / coveredCount : null,
        coveredCount,
        totalCount: stocks.length,
        oldestAsOf,
        undatedCount,
    };
};
