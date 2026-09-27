import {
    getPortfolioAssetClassColor,
    normalizePortfolioAssetClass,
} from './portfolio-composition-colors';
import { comparePortfolioReferenceOrder } from './portfolio-overview-model';

export type PortfolioGroupDialMixRow = {
    asset_class: string;
    display_name?: string;
    display_order?: number;
    weight_pct: number;
};

export type PortfolioGroupDialSlice = {
    key: string;
    label: string;
    color: string;
    assetClassCodes: string[];
    currentPct: number;
    targetPct: number;
    driftPct: number;
};

export type PortfolioGroupDialModel = {
    slices: PortfolioGroupDialSlice[];
    hasCurrent: boolean;
    hasTarget: boolean;
    currentSourceTotalPct: number;
    targetSourceTotalPct: number;
};

type MutableSlice = {
    key: string;
    assetClass: string;
    label: string;
    displayOrder: number;
    sourceIndex: number;
    currentPct: number;
    targetPct: number;
};

function safeWeight(value: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function collectRows(
    destination: Map<string, MutableSlice>,
    rows: PortfolioGroupDialMixRow[],
    value: 'currentPct' | 'targetPct',
) {
    rows.forEach((row, sourceIndex) => {
        const weight = safeWeight(row.weight_pct);
        if (weight <= 0) return;

        const key = normalizePortfolioAssetClass(row.asset_class);
        const existing = destination.get(key);
        const displayOrder = Number.isFinite(Number(row.display_order))
            ? Number(row.display_order)
            : Number.MAX_SAFE_INTEGER;
        const label = String(
            row.display_name || row.asset_class || key,
        ).trim();

        if (existing) {
            existing[value] += weight;
            if (!existing.label && label) existing.label = label;
            existing.displayOrder = Math.min(
                existing.displayOrder,
                displayOrder,
            );
            return;
        }

        destination.set(key, {
            key,
            assetClass: row.asset_class,
            label: label || row.asset_class,
            displayOrder,
            sourceIndex,
            currentPct: value === 'currentPct' ? weight : 0,
            targetPct: value === 'targetPct' ? weight : 0,
        });
    });
}

export function buildPortfolioGroupDialModel({
    currentRows = [],
    approvedRows = [],
}: {
    currentRows?: PortfolioGroupDialMixRow[] | null;
    approvedRows?: PortfolioGroupDialMixRow[] | null;
}): PortfolioGroupDialModel {
    const rowsByAssetClass = new Map<string, MutableSlice>();
    collectRows(rowsByAssetClass, approvedRows || [], 'targetPct');
    collectRows(rowsByAssetClass, currentRows || [], 'currentPct');

    const hasApproved = (approvedRows || []).some(row => safeWeight(row.weight_pct) > 0);
    const orderedRows = Array.from(rowsByAssetClass.values()).sort((a, b) => comparePortfolioReferenceOrder(
        { code: a.key, current: a.currentPct, target: a.targetPct },
        { code: b.key, current: b.currentPct, target: b.targetPct },
        hasApproved,
    ));

    const slices = orderedRows.map((row) => ({
        key: row.key,
        label: row.label,
        color: getPortfolioAssetClassColor(row.assetClass, row.sourceIndex),
        assetClassCodes: [row.key],
        currentPct: row.currentPct,
        targetPct: row.targetPct,
        driftPct: row.currentPct - row.targetPct,
    }));
    const currentSourceTotalPct = slices.reduce(
        (sum, slice) => sum + slice.currentPct,
        0,
    );
    const targetSourceTotalPct = slices.reduce(
        (sum, slice) => sum + slice.targetPct,
        0,
    );

    return {
        slices,
        hasCurrent: currentSourceTotalPct > 0,
        hasTarget: targetSourceTotalPct > 0,
        currentSourceTotalPct,
        targetSourceTotalPct,
    };
}
