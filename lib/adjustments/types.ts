export type AdjustmentSourceType =
    | 'Q3_SIGNAL'
    | 'Q4_SIGNAL'
    | 'PORTFOLIO_TARGET'
    | 'MANUAL';

export type AdjustmentDirection = 'increase' | 'decrease' | 'hold';

export type AdjustmentEventStatus =
    | 'DRAFT'
    | 'ACTIONING'
    | 'AWAITING_STATEMENT'
    | 'VARIANCE'
    | 'COMPLETE';

export type AdjustmentStage =
    | 'review_target'
    | 'action_positions'
    | 'confirm_statement'
    | 'complete';

export type AdjustmentActionType = 'BUY' | 'SELL' | 'HOLD';

export type AdjustmentValueRow = {
    key: string;
    label?: string;
    currentValue: number;
    targetValue: number;
    recordedMoveValue?: number;
};

export type AdjustmentRowMove = {
    currentValue: number;
    targetValue: number;
    deltaValue: number;
    direction: AdjustmentDirection;
    requiredActionValue: number;
};

export type AdjustmentMovementRow<T extends AdjustmentValueRow> = {
    row: T;
    move: AdjustmentRowMove;
    requiredActionValue: number;
    recordedActionValue: number;
};

export type AdjustmentMovementPlan<T extends AdjustmentValueRow> = {
    decreaseRows: AdjustmentMovementRow<T>[];
    increaseRows: AdjustmentMovementRow<T>[];
    totalRequiredDecrease: number;
    totalRecordedDecrease: number;
    totalRequiredIncrease: number;
    totalRecordedIncrease: number;
    remainingDecrease: number;
    remainingIncrease: number;
    tolerance: number;
    overRecordedDecrease: boolean;
    readyToConfirmDecrease: boolean;
};

export type AdjustmentHolding = {
    id: number;
    assetClass: string;
    currentValue: number;
};

export type AdjustmentHoldingAction = {
    holdingId: number;
    assetClass: string;
    actionType: AdjustmentActionType;
    plannedValue: number;
    expectedAfterValue: number;
};

export type AdjustmentImportCheck = {
    key: string;
    label?: string;
    expectedValue: number;
    importedValue: number;
    varianceValue: number;
    status: 'MATCHED' | 'VARIANCE';
};

export type AdjustmentImportValidation = {
    passed: boolean;
    checkedRows: number;
    varianceRows: number;
    totalAbsVariancePct: number;
    totalAbsVarianceValue: number;
    tolerancePct: number;
    toleranceValue: number;
};
