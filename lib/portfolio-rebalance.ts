import type {
    PortfolioMixRow,
    PortfolioRebalancePlan,
    PortfolioRebalancePlanRow,
} from '@/lib/api';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import {
    buildAdjustmentMovementPlan,
    getAdjustmentRowMove,
    validateAdjustmentImport,
    type AdjustmentValueRow,
} from '@/lib/adjustments';

export type PortfolioRebalanceRowMove = {
    currentValue: number;
    targetValue: number;
    moveValue: number;
};

export type PortfolioRebalanceMoveSummary = {
    rowsSorted: PortfolioRebalancePlanRow[];
    targetTotal: number;
    targetTotalValid: boolean;
    grossMove: number;
    netMove: number;
    targetMoveBalanced: boolean;
    transitionCompleted: boolean;
    baselineApproved: boolean;
};

export type PortfolioRebalanceImportValidation = {
    passed: boolean;
    checkedRows: number;
    varianceRows: number;
    totalAbsVariancePct: number;
    totalAbsVarianceValue: number;
    tolerancePct: number;
    toleranceValue: number;
};

export type PortfolioCashMovementRow = {
    row: PortfolioRebalancePlanRow;
    moveValue: number;
    requiredCashValue: number;
    recordedCashValue: number;
};

export type PortfolioCashMovementPlan = {
    reduceRows: PortfolioCashMovementRow[];
    pendingAddRows: PortfolioCashMovementRow[];
    totalRequiredCash: number;
    totalRecordedCash: number;
    totalPendingAdd: number;
    remainingCash: number;
    tolerance: number;
    overRecorded: boolean;
    readyToConfirm: boolean;
};

export function sortPortfolioRebalanceRows(
    rows: PortfolioRebalancePlanRow[],
): PortfolioRebalancePlanRow[] {
    return [...rows].sort(
        (a, b) =>
            (a.display_order || 9999) - (b.display_order || 9999) ||
            a.display_name.localeCompare(b.display_name),
    );
}

export function getPortfolioRebalanceRowMove(
    row: PortfolioRebalancePlanRow,
    totalValue: number,
): PortfolioRebalanceRowMove {
    const move = getAdjustmentRowMove({
        key: normalizeAssetClassCode(row.asset_class),
        currentValue: ((row.current_weight_pct || 0) / 100) * totalValue,
        targetValue: ((row.target_weight_pct || 0) / 100) * totalValue,
    });
    return {
        currentValue: move.currentValue,
        targetValue: move.targetValue,
        moveValue: move.deltaValue,
    };
}

export function buildLivePortfolioRebalanceRows(
    targetRows: PortfolioRebalancePlanRow[],
    currentRows: PortfolioMixRow[] = [],
): PortfolioRebalancePlanRow[] {
    const currentByClass = new Map<
        string,
        {
            displayName: string;
            displayOrder: number;
            governedByQ1: boolean;
            weightPct: number;
        }
    >();

    currentRows.forEach((row) => {
        const key = normalizeAssetClassCode(row.asset_class);
        const existing = currentByClass.get(key);
        currentByClass.set(key, {
            displayName: existing?.displayName || row.display_name || row.asset_class,
            displayOrder: existing?.displayOrder || row.display_order || 9999,
            governedByQ1: Boolean(existing?.governedByQ1 || row.governed_by_q1),
            weightPct: (existing?.weightPct || 0) + (row.weight_pct || 0),
        });
    });

    const seen = new Set<string>();
    const rows = targetRows.map((row) => {
        const key = normalizeAssetClassCode(row.asset_class);
        seen.add(key);
        const current = currentByClass.get(key);
        const currentWeightPct = current?.weightPct || 0;
        return {
            ...row,
            display_name: row.display_name || current?.displayName || row.asset_class,
            current_weight_pct: currentWeightPct,
            delta_weight_pct: (row.target_weight_pct || 0) - currentWeightPct,
        };
    });

    currentByClass.forEach((current, key) => {
        if (seen.has(key)) return;
        rows.push({
            asset_class: key,
            display_name: current.displayName || key,
            display_order: current.displayOrder || 9999,
            governed_by_q1: current.governedByQ1,
            current_weight_pct: current.weightPct,
            target_weight_pct: 0,
            delta_weight_pct: -current.weightPct,
            note: 'Current holding is not included in the locked target.',
        });
    });

    return sortPortfolioRebalanceRows(rows);
}

export function summarizePortfolioRebalanceRows(
    rows: PortfolioRebalancePlanRow[],
    totalValue: number,
    plan?: PortfolioRebalancePlan | null,
): PortfolioRebalanceMoveSummary {
    const rowsSorted = sortPortfolioRebalanceRows(rows);
    const targetTotal = rowsSorted.reduce(
        (sum, row) => sum + (row.target_weight_pct || 0),
        0,
    );
    const targetTotalValid = Math.abs(targetTotal - 100) <= 0.1;
    const moveValues = rowsSorted.map((row) =>
        getPortfolioRebalanceRowMove(row, totalValue),
    );
    const grossMove = moveValues.reduce(
        (sum, move) => sum + Math.abs(move.moveValue),
        0,
    );
    const netMove = moveValues.reduce((sum, move) => sum + move.moveValue, 0);
    const transitionCompleted =
        plan?.status === 'COMPLETED' || plan?.status === 'APPROVED';

    return {
        rowsSorted,
        targetTotal,
        targetTotalValid,
        grossMove,
        netMove,
        targetMoveBalanced:
            Boolean(plan) &&
            targetTotalValid &&
            Math.abs(netMove) <= Math.max(50, totalValue * 0.001),
        transitionCompleted,
        baselineApproved: plan?.status === 'APPROVED',
    };
}

export function validatePortfolioRebalanceImport(
    liveRows: PortfolioRebalancePlanRow[],
    totalValue: number,
    options: { tolerancePct?: number; toleranceValue?: number } = {},
): PortfolioRebalanceImportValidation {
    return validateAdjustmentImport(
        liveRows.map((row) => ({
            currentWeightPct: row.current_weight_pct || 0,
            targetWeightPct: row.target_weight_pct || 0,
        })),
        totalValue,
        options,
    );
}

export function buildPortfolioCashMovementPlan(
    rows: PortfolioRebalancePlanRow[],
    totalValue: number,
): PortfolioCashMovementPlan {
    const threshold = Math.max(50, totalValue * 0.0005);
    const adjustmentRows = rows.map(
        (row): AdjustmentValueRow & { row: PortfolioRebalancePlanRow } => ({
            key: normalizeAssetClassCode(row.asset_class),
            label: row.display_name || row.asset_class,
            currentValue: ((row.current_weight_pct || 0) / 100) * totalValue,
            targetValue: ((row.target_weight_pct || 0) / 100) * totalValue,
            recordedMoveValue: row.recorded_move_value || 0,
            row,
        }),
    );
    const plan = buildAdjustmentMovementPlan(adjustmentRows, {
        threshold,
        toleranceMinimum: 250,
        toleranceRatio: 0.05,
    });
    const reduceRows: PortfolioCashMovementRow[] = plan.decreaseRows.map(
        (item) => ({
            row: item.row.row,
            moveValue: item.move.deltaValue,
            requiredCashValue: item.requiredActionValue,
            recordedCashValue: item.recordedActionValue,
        }),
    );
    const pendingAddRows: PortfolioCashMovementRow[] = plan.increaseRows.map(
        (item) => ({
            row: item.row.row,
            moveValue: item.move.deltaValue,
            requiredCashValue: item.requiredActionValue,
            recordedCashValue: item.recordedActionValue,
        }),
    );

    return {
        reduceRows,
        pendingAddRows,
        totalRequiredCash: plan.totalRequiredDecrease,
        totalRecordedCash: plan.totalRecordedDecrease,
        totalPendingAdd: plan.totalRequiredIncrease,
        remainingCash: plan.remainingDecrease,
        tolerance: plan.tolerance,
        overRecorded: plan.overRecordedDecrease,
        readyToConfirm: plan.readyToConfirmDecrease,
    };
}

export function formatPortfolioRebalanceDisplayName(
    row: PortfolioRebalancePlanRow,
): string {
    const key = normalizeAssetClassCode(row.asset_class);
    const raw = String(row.display_name || row.asset_class || '').trim();
    if (key === 'CASH') return 'Cash/Reserve';
    if (key === 'BONDS') return 'Bonds';
    if (!raw) return row.asset_class;

    const compact = raw.replace(/[_-]+/g, ' ');
    const isBackendStyle =
        compact === compact.toUpperCase() && /[A-Z]/.test(compact);
    if (!isBackendStyle) return raw;

    return compact
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
