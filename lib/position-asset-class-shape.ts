import type { PortfolioMixRow } from './api';
import { normalizeAssetClassCode } from './asset-class';

export type PositionAssetClassShapeModel = {
    assetClassCode: string;
    currentPct: number;
    targetPct: number | null;
    driftPct: number | null;
};

export type PositionAssetClassShapeOrder = 'target' | 'current' | 'drift';

type ResolvePositionAssetClassShapeArgs = {
    assetClassCode?: string | null;
    currentRows?: PortfolioMixRow[] | null;
    approvedRows?: PortfolioMixRow[] | null;
    fallbackCurrentPct?: number | null;
};

const finiteOrNull = (value: unknown): number | null => {
    const resolved = Number(value);
    return Number.isFinite(resolved) ? resolved : null;
};

const findShapeRow = (
    rows: PortfolioMixRow[] | null | undefined,
    assetClassCode: string,
): PortfolioMixRow | null =>
    rows?.find(
        (row) => normalizeAssetClassCode(row.asset_class) === assetClassCode,
    ) || null;

export function resolvePositionAssetClassShape({
    assetClassCode,
    currentRows,
    approvedRows,
    fallbackCurrentPct,
}: ResolvePositionAssetClassShapeArgs): PositionAssetClassShapeModel | null {
    const normalizedCode = normalizeAssetClassCode(assetClassCode);
    if (normalizedCode === 'UNASSIGNED' || normalizedCode === 'CASH') {
        return null;
    }

    const currentRow = findShapeRow(currentRows, normalizedCode);
    const approvedRow = findShapeRow(approvedRows, normalizedCode);
    const currentPct = Math.max(
        0,
        finiteOrNull(currentRow?.weight_pct) ??
            finiteOrNull(fallbackCurrentPct) ??
            0,
    );
    const targetValue = finiteOrNull(approvedRow?.weight_pct);
    const targetPct = targetValue === null ? null : Math.max(0, targetValue);

    return {
        assetClassCode: normalizedCode,
        currentPct,
        targetPct,
        driftPct: targetPct === null ? null : currentPct - targetPct,
    };
}

export function calculatePositionShapeScaleMax({
    currentRows,
    approvedRows,
    assetClassCodes,
}: {
    currentRows?: PortfolioMixRow[] | null;
    approvedRows?: PortfolioMixRow[] | null;
    assetClassCodes?: Array<string | null | undefined> | null;
}): number {
    const visibleCodes = new Set(
        (assetClassCodes || [])
            .map((code) => normalizeAssetClassCode(code))
            .filter((code) => code !== 'UNASSIGNED' && code !== 'CASH'),
    );
    const includeRow = (row: PortfolioMixRow) => {
        const code = normalizeAssetClassCode(row.asset_class);
        if (code === 'UNASSIGNED' || code === 'CASH') return false;
        return visibleCodes.size === 0 || visibleCodes.has(code);
    };
    const values = [...(currentRows || []), ...(approvedRows || [])]
        .filter(includeRow)
        .map((row) => finiteOrNull(row.weight_pct) ?? 0);
    const largest = Math.max(0, ...values);

    return Math.max(5, Math.ceil(largest / 5) * 5);
}

export function comparePositionAssetClassShapes(
    a: PositionAssetClassShapeModel | null,
    b: PositionAssetClassShapeModel | null,
    order: PositionAssetClassShapeOrder,
    direction: 'asc' | 'desc',
): number {
    const valueFor = (model: PositionAssetClassShapeModel | null) => {
        if (!model) return null;
        if (order === 'target') return model.targetPct;
        if (order === 'current') return model.currentPct;
        return model.driftPct === null ? null : Math.abs(model.driftPct);
    };
    const aValue = valueFor(a);
    const bValue = valueFor(b);
    const aMissing = aValue === null;
    const bMissing = bValue === null;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (aMissing || bMissing) return 0;

    const multiplier = direction === 'desc' ? 1 : -1;
    return (Number(bValue) - Number(aValue)) * multiplier;
}
