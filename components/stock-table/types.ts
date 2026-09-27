import type { PortfolioOverlaySummaryResponse } from '@/lib/api';

export type SortColumn =
    | 'QTY'
    | 'VALUE'
    | 'QUALITY'
    | 'VALUE_SCORE'
    | 'GEMINI'
    | 'PERPLEXITY'
    | 'GPT'
    | 'CLAUDE'
    | 'COUNCIL'
    | 'TOTAL'
    | 'UPSIDE'
    | 'BOOK_VALUE'
    | 'PL_PERCENT'
    | 'PL_DOLLAR'
    | 'PORTFOLIO_PERCENT'
    | 'CLASS_PERCENT'
    | 'MODEL_WEIGHT'
    | 'EXPOSURE_PERCENT'
    | 'ASSET_CLASS'
    | 'NAME'
    | 'PRICE'
    | 'PERFORMANCE_6M'
    | 'PERFORMANCE_12M'
    | 'SUGGESTED_ALLOCATION'
    | 'CASH'
    | 'ATR'
    | 'DCA'
    | 'CDF'
    | null;

export type SortDirection = 'asc' | 'desc' | null;

export type TabType =
    | 'POSITIONS'
    | 'PORTFOLIO'
    | 'SYSTEM'
    | 'MARKETS'
    | 'ANALYSIS'
    | 'HISTORY'
    | 'ALERTS'
    | 'ETF'
    | 'NEWS'
    | 'HELP';

export type PortfolioMode = 'workflow' | 'shape';
export type PortfolioVisualMode = 'bar' | 'pie';
export type PortfolioFocusMode = 'hover' | 'select';

export type PortfolioTargetBarEditor = {
    assetClass: string;
    value: string;
} | null;

export type PortfolioTargetBarDrag = {
    leftAssetClass: string;
    rightAssetClass: string;
    startX: number;
    barWidth: number;
    leftStartPct: number;
    rightStartPct: number;
};

export type StockGroupAssignments = Record<string, string>;

export type PositionBucketKey =
    | 'q1'
    | 'full_q1'
    | 'partial_q1'
    | 'q1_exempt'
    | 'cash_reserve';

export type PositionsMode = 'normal' | 'review';
export type PositionAssetClassRowMode = 'metrics' | 'shape';
export type PositionAssetClassOrder =
    | 'saved'
    | 'target'
    | 'current'
    | 'drift';
export type PositionAssetClassOrderDirection = 'asc' | 'desc';
export type HistoryMode = 'signals' | 'performance' | 'stock';
export type HistoryPerformanceRange = '1M' | '3M' | '6M' | 'ALL';
export type AdjustmentSource = 'signal' | 'portfolio_target';

export type ReviewFocus =
    | {
          type: 'bucket';
          key: string;
          bucket: PositionBucketKey;
          label: string;
      }
    | { type: 'group'; key: string; groupId: string; label: string }
    | { type: 'stock'; key: string; stockId: number; label: string };

export type OverlayAssetClassRow =
    PortfolioOverlaySummaryResponse['asset_classes'][number];

export type ReviewSelectionPlan = {
    label: string;
    level: string;
    executionMode?: 'sleeve_target' | 'stock_choice';
    currentValue: number;
    targetValue: number;
    moveValue: number;
    suggestedMoveValue?: number;
    requiredMoveValue?: number;
    plannedMoveValue?: number;
    remainingMoveValue?: number;
    currentPortfolioPct: number;
    targetPortfolioPct: number;
    currentClassPct: number | null;
    targetClassPct: number | null;
    note: string;
};

export type ReviewCashMovementRecord = {
    completedAt: string;
    expectedReserveIncrease: number;
    baselineReserveValue: number;
    expectedReserveValue: number;
    recordedReductionValue: number;
    requiredReductionValue: number;
    q1ExposureAfterPct: number;
    fullQ1ExposureAfterPct: number;
    q1DefensiveExposureAfterPct: number;
    q1ExemptExposureAfterPct: number;
    importAt: string | null;
    activeEventId?: number | null;
};

export type ReviewRecoveryContext = {
    eventId?: number | null;
    createdAt: string;
    reserveShortfall: number;
    previousRequiredReduction: number;
    previousRecordedReduction: number;
    expectedReserveValue: number;
    importedReserveValue: number;
    restoredCutTotal: number;
    restoredCutCount: number;
};
