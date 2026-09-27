import { normalizeAssetClassCode } from '@/lib/asset-class';
import type {
    AdjustmentDirection,
    AdjustmentHolding,
    AdjustmentMovementPlan,
    AdjustmentRowMove,
    AdjustmentValueRow,
    AdjustmentImportValidation,
} from '@/lib/adjustments/types';

export function getAdjustmentDirection(
    deltaValue: number,
    threshold = 0,
): AdjustmentDirection {
    if (deltaValue > threshold) return 'increase';
    if (deltaValue < -threshold) return 'decrease';
    return 'hold';
}

export function getAdjustmentRowMove(
    row: AdjustmentValueRow,
    threshold = 0,
): AdjustmentRowMove {
    const currentValue = Math.max(0, row.currentValue || 0);
    const targetValue = Math.max(0, row.targetValue || 0);
    const deltaValue = targetValue - currentValue;
    const direction = getAdjustmentDirection(deltaValue, threshold);

    return {
        currentValue,
        targetValue,
        deltaValue,
        direction,
        requiredActionValue:
            direction === 'hold' ? 0 : Math.abs(deltaValue),
    };
}

export function getAdjustmentTolerance(
    requiredActionValue: number,
    options: { minimum?: number; ratio?: number } = {},
): number {
    const minimum = options.minimum ?? 250;
    const ratio = options.ratio ?? 0.05;
    return requiredActionValue > 0
        ? Math.max(minimum, requiredActionValue * ratio)
        : 0;
}

export function buildAdjustmentMovementPlan<T extends AdjustmentValueRow>(
    rows: T[],
    options: {
        threshold?: number;
        toleranceMinimum?: number;
        toleranceRatio?: number;
    } = {},
): AdjustmentMovementPlan<T> {
    const threshold = options.threshold ?? 0;
    const decreaseRows = [];
    const increaseRows = [];

    for (const row of rows) {
        const move = getAdjustmentRowMove(row, threshold);
        const recordedActionValue = Math.max(0, row.recordedMoveValue || 0);
        if (move.direction === 'decrease') {
            decreaseRows.push({
                row,
                move,
                requiredActionValue: move.requiredActionValue,
                recordedActionValue,
            });
        } else if (move.direction === 'increase') {
            increaseRows.push({
                row,
                move,
                requiredActionValue: move.requiredActionValue,
                recordedActionValue,
            });
        }
    }

    const totalRequiredDecrease = decreaseRows.reduce(
        (sum, item) => sum + item.requiredActionValue,
        0,
    );
    const totalRecordedDecrease = decreaseRows.reduce(
        (sum, item) => sum + item.recordedActionValue,
        0,
    );
    const totalRequiredIncrease = increaseRows.reduce(
        (sum, item) => sum + item.requiredActionValue,
        0,
    );
    const totalRecordedIncrease = increaseRows.reduce(
        (sum, item) => sum + item.recordedActionValue,
        0,
    );
    const tolerance = getAdjustmentTolerance(totalRequiredDecrease, {
        minimum: options.toleranceMinimum,
        ratio: options.toleranceRatio,
    });
    const remainingDecrease = Math.max(
        0,
        totalRequiredDecrease - totalRecordedDecrease,
    );
    const remainingIncrease = Math.max(
        0,
        totalRequiredIncrease - totalRecordedIncrease,
    );
    const overRecordedDecrease =
        totalRecordedDecrease > totalRequiredDecrease + tolerance;

    return {
        decreaseRows,
        increaseRows,
        totalRequiredDecrease,
        totalRecordedDecrease,
        totalRequiredIncrease,
        totalRecordedIncrease,
        remainingDecrease,
        remainingIncrease,
        tolerance,
        overRecordedDecrease,
        readyToConfirmDecrease:
            totalRequiredDecrease <= 0 ||
            (remainingDecrease <= tolerance && !overRecordedDecrease),
    };
}

export function getPlannedAdjustmentForHolding(
    holding: AdjustmentHolding,
    inputs: Record<number, string>,
): number {
    const parsed = Number.parseFloat(inputs[holding.id] || '');
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(parsed, holding.currentValue || 0);
}

export function getPlannedAdjustmentForHoldings(
    holdings: AdjustmentHolding[],
    inputs: Record<number, string>,
): number {
    return holdings.reduce(
        (sum, holding) => sum + getPlannedAdjustmentForHolding(holding, inputs),
        0,
    );
}

export function aggregateHoldingAdjustmentsByAssetClass(
    holdings: AdjustmentHolding[],
    inputs: Record<number, string>,
): Record<string, number> {
    return holdings.reduce<Record<string, number>>((acc, holding) => {
        const plannedValue = getPlannedAdjustmentForHolding(holding, inputs);
        if (plannedValue <= 0) return acc;
        const key = normalizeAssetClassCode(holding.assetClass);
        acc[key] = (acc[key] || 0) + plannedValue;
        return acc;
    }, {});
}

export function getAssetClassesWithHoldingInputs(
    holdings: AdjustmentHolding[],
    inputs: Record<number, string>,
): Set<string> {
    const byId = new Map(holdings.map((holding) => [holding.id, holding]));
    const classes = new Set<string>();

    for (const [holdingId, raw] of Object.entries(inputs)) {
        if (raw === '') continue;
        const parsed = Number.parseFloat(raw || '');
        if (!Number.isFinite(parsed) || parsed < 0) continue;
        const holding = byId.get(Number(holdingId));
        if (holding) classes.add(normalizeAssetClassCode(holding.assetClass));
    }

    return classes;
}

export function getSuggestedAdjustmentForHolding(
    holding: AdjustmentHolding,
    holdings: AdjustmentHolding[],
    requiredByAssetClass: Record<string, number>,
): number {
    const assetClass = normalizeAssetClassCode(holding.assetClass);
    const requiredForClass = requiredByAssetClass[assetClass] || 0;
    if (requiredForClass <= 0) return 0;

    const classHoldings = holdings.filter(
        (item) => normalizeAssetClassCode(item.assetClass) === assetClass,
    );
    const classValue = classHoldings.reduce(
        (sum, item) => sum + (item.currentValue || 0),
        0,
    );
    if (classValue <= 0) return 0;

    return Math.min(
        holding.currentValue || 0,
        requiredForClass * ((holding.currentValue || 0) / classValue),
    );
}

export function getRemainingSuggestedAdjustmentForHolding(
    holding: AdjustmentHolding,
    holdings: AdjustmentHolding[],
    requiredByAssetClass: Record<string, number>,
    inputs: Record<number, string>,
): number {
    const baseTarget = getSuggestedAdjustmentForHolding(
        holding,
        holdings,
        requiredByAssetClass,
    );
    if (baseTarget <= 0) return 0;
    if (getPlannedAdjustmentForHolding(holding, inputs) > 0) return baseTarget;

    const assetClass = normalizeAssetClassCode(holding.assetClass);
    const requiredForClass = requiredByAssetClass[assetClass] || 0;
    const classHoldings = holdings.filter(
        (item) => normalizeAssetClassCode(item.assetClass) === assetClass,
    );
    const plannedForClass = getPlannedAdjustmentForHoldings(
        classHoldings,
        inputs,
    );
    if (plannedForClass <= 0) return baseTarget;

    const remainingRequired = Math.max(0, requiredForClass - plannedForClass);
    if (remainingRequired <= 0) return 0;

    const remainingHoldings = classHoldings.filter(
        (item) => getPlannedAdjustmentForHolding(item, inputs) <= 0,
    );
    const remainingCapacity = remainingHoldings.reduce(
        (sum, item) => sum + (item.currentValue || 0),
        0,
    );
    if (remainingCapacity <= 0) return 0;
    if (remainingRequired > remainingCapacity) return baseTarget;

    return Math.min(
        holding.currentValue || 0,
        remainingRequired * ((holding.currentValue || 0) / remainingCapacity),
    );
}

export function validateAdjustmentImport(
    rows: Array<{ currentWeightPct: number; targetWeightPct: number }>,
    totalValue: number,
    options: { tolerancePct?: number; toleranceValue?: number } = {},
): AdjustmentImportValidation {
    const tolerancePct = options.tolerancePct ?? 0.5;
    const toleranceValue =
        options.toleranceValue ?? Math.max(250, totalValue * 0.005);

    let totalAbsVariancePct = 0;
    let totalAbsVarianceValue = 0;
    let varianceRows = 0;

    rows.forEach((row) => {
        const variancePct = Math.abs(
            (row.targetWeightPct || 0) - (row.currentWeightPct || 0),
        );
        const varianceValue = (variancePct / 100) * totalValue;
        totalAbsVariancePct += variancePct;
        totalAbsVarianceValue += varianceValue;
        if (variancePct > tolerancePct && varianceValue > toleranceValue) {
            varianceRows += 1;
        }
    });

    return {
        passed: rows.length > 0 && varianceRows === 0,
        checkedRows: rows.length,
        varianceRows,
        totalAbsVariancePct,
        totalAbsVarianceValue,
        tolerancePct,
        toleranceValue,
    };
}
