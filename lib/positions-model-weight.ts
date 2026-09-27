import { normalizeAssetClassCode } from './asset-class';
import { hasAnalysisSizingEvidence, type AnalysisMetricSecurity } from './analysis-metrics';
import { isNonAllocatingSecurityType, normalizeSecurityType } from './security-types';

export type ModelWeightStock = AnalysisMetricSecurity & {
    id: number;
    name?: string;
    symbol?: string | null;
    prefix?: string | null;
    primaryAssetClass?: string | null;
    position?: number;
    positionValue?: number;
    isWatchlist?: boolean;
    isExternal?: boolean;
    includeInSizing?: boolean;
};

export const isModelWeightHolding = (stock: ModelWeightStock) =>
    !stock.isWatchlist && !stock.isExternal &&
    !isNonAllocatingSecurityType(stock.securityType) &&
    (Number(stock.position || 0) !== 0 || Number(stock.positionValue || 0) !== 0);

export function isSizingUniverseStock(stock: ModelWeightStock, universe: 'analysis' | 'holdings') {
    if (normalizeSecurityType(stock.securityType) === 'ETF' || isNonAllocatingSecurityType(stock.securityType)) return false;
    return universe === 'holdings' ? isModelWeightHolding(stock) : stock.includeInSizing !== false;
}

export const hasMissingSizingResearch = (stock: ModelWeightStock) =>
    (isSizingUniverseStock(stock, 'analysis') || isSizingUniverseStock(stock, 'holdings')) &&
    !hasAnalysisSizingEvidence(stock);

type Allocation = { allocation_pct: number; eligible_for_target_weight?: boolean; base_rating: number };
type Ledger = {
    classes: Array<{ asset_class: string; class_target_value: number; stock_capacity_value: number }>;
    rows: Array<{ ticker: string; asset_class: string; effective_target_value: number; is_core: boolean }>;
};

export type PositionWeightTone = 'neutral' | 'aligned' | 'under' | 'overstretch';
export type PositionModelWeight = {
    percent: number | null; dollar: number | null; reason: string; stretchRatio?: 1.25 | 1.5;
};

export function positionWeightTone(actualPercent: number | null | undefined, weight?: PositionModelWeight): PositionWeightTone {
    if (!weight?.stretchRatio || actualPercent == null || !Number.isFinite(actualPercent) || actualPercent < 0 ||
        weight.percent == null || !Number.isFinite(weight.percent) || weight.percent <= 0) return 'neutral';

    // This is the visible class-mix comparison, not the backend dollar-based trade limit.
    if (actualPercent.toFixed(1) === weight.percent.toFixed(1)) return 'aligned';
    if (actualPercent / weight.percent + 1e-9 >= weight.stretchRatio) return 'overstretch';
    return actualPercent < weight.percent ? 'under' : 'neutral';
}

// Reuse the engine's within-stock percentage. The ledger supplies the remaining
// stock budget, so the displayed percentage has the same whole-class basis as ETFs.
export function buildPositionModelWeights(
    stocks: ModelWeightStock[],
    allocations: ReadonlyMap<number, Allocation>,
    ledger: Ledger | null | undefined,
    anchored: boolean,
): Map<number, PositionModelWeight> {
    const classes = new Map((ledger?.classes || []).map(row => [normalizeAssetClassCode(row.asset_class), row]));
    const holdings = stocks.filter(isModelWeightHolding);
    const incompleteClasses = new Set(holdings.filter(stock =>
        normalizeSecurityType(stock.securityType) !== 'ETF' && !hasAnalysisSizingEvidence(stock),
    ).map(stock => normalizeAssetClassCode(stock.primaryAssetClass)));
    const weights = new Map<number, PositionModelWeight>();
    for (const stock of holdings) {
        const assetClass = normalizeAssetClassCode(stock.primaryAssetClass);
        const budget = classes.get(assetClass);
        let percent: number | null = null;
        let reason = 'No approved asset-class budget.';
        if (budget && Number.isFinite(budget.class_target_value) && budget.class_target_value > 0) {
            if (normalizeSecurityType(stock.securityType) === 'ETF') {
                const ticker = `${stock.prefix || ''}${stock.symbol || ''}`.trim().toUpperCase();
                const rows = (ledger?.rows || []).filter(row => normalizeAssetClassCode(row.asset_class) === assetClass);
                const exact = rows.find(row => row.ticker.toUpperCase() === ticker);
                // Permit a symbol-only identity only when it cannot match another exchange.
                const matches = rows.filter(row => row.ticker.toUpperCase().split(':').pop() === ticker.split(':').pop());
                const row = exact || (!ticker.includes(':') && matches.length === 1 ? matches[0] : undefined);
                if (row) {
                    percent = row.effective_target_value / budget.class_target_value * 100;
                    reason = row.is_core ? 'Effective Core ETF allocation within the asset class. Advisory only.' : 'ETF allocation within the asset class. Advisory only.';
                } else reason = 'ETF allocation unavailable.';
            } else if (incompleteClasses.has(assetClass)) {
                reason = 'Incomplete class research. Review Analysis data issues.';
            } else {
                const allocation = allocations.get(stock.id);
                if (anchored && allocation && (allocation.eligible_for_target_weight ?? allocation.base_rating > 0)) {
                    percent = allocation.allocation_pct * Math.max(0, budget.stock_capacity_value) / budget.class_target_value;
                    reason = 'Modelled share of the class across current holdings, after ETF allocation. Advisory only.';
                } else reason = 'Model allocation unavailable.';
            }
        }
        const validPercent = percent != null && Number.isFinite(percent) ? percent : null;
        const dollar = validPercent != null && budget ? validPercent / 100 * budget.class_target_value : null;
        weights.set(stock.id, { percent: validPercent, dollar, reason });
    }
    return weights;
}

export function comparePositionModelWeights(a: PositionModelWeight | undefined, b: PositionModelWeight | undefined, direction: 'asc' | 'desc') {
    if (a?.percent == null) return b?.percent == null ? 0 : 1;
    if (b?.percent == null) return -1;
    return (a.percent - b.percent) * (direction === 'asc' ? 1 : -1);
}
