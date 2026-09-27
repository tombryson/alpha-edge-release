import type { ReactNode } from 'react';
import type { Stock } from '@/lib/store';
import type { PositionGridColumnKey } from './columns';

type ReconciliationColumn = 'expected' | 'imported' | 'variance';

type BuildPositionStockAdjustmentCellsArgs<TCheck> = {
    stock: Stock;
    plannedCut: number;
    suggestedCut: number;
    showStats: boolean;
    isPortfolioReviewMode: boolean;
    reviewImportVarianceActive: boolean;
    reconciliationCheck: TCheck | null | undefined;
    renderReviewTargetPercentCell: (
        targetCutValue: number,
        currentValue: number,
        showStats: boolean,
        cutLabel?: string,
        targetPctOverride?: number | null,
    ) => ReactNode;
    renderTargetMovePctCell: (
        targetMoveValue: number,
        currentValue: number,
        showStats: boolean,
    ) => ReactNode;
    renderReviewCutCell: (
        plannedCutValue: number,
        showStats: boolean,
        requiredCutValue?: number,
        stock?: Stock,
        cutLabel?: string,
        enforceTarget?: boolean,
    ) => ReactNode;
    renderReviewReconciliationCell: (
        column: ReconciliationColumn,
        check: TCheck | null | undefined,
        showStats: boolean,
    ) => ReactNode;
    renderReviewProgressCell: (
        plannedCutValue: number,
        currentValue: number,
        showStats: boolean,
        requiredCutValue?: number,
        enforceTarget?: boolean,
        stock?: Stock,
    ) => ReactNode;
};

export function buildPositionStockAdjustmentCells<TCheck>({
    stock,
    plannedCut,
    suggestedCut,
    showStats,
    isPortfolioReviewMode,
    reviewImportVarianceActive,
    reconciliationCheck,
    renderReviewTargetPercentCell,
    renderTargetMovePctCell,
    renderReviewCutCell,
    renderReviewReconciliationCell,
    renderReviewProgressCell,
}: BuildPositionStockAdjustmentCellsArgs<TCheck>): Partial<
    Record<PositionGridColumnKey, ReactNode>
> {
    return {
        remaining: <td className="border-r border-border/30" title="The remaining requirement is tracked at asset-class level, not per stock." />,
        targetAdjustment: renderReviewTargetPercentCell(
            suggestedCut,
            stock.positionValue || 0,
            showStats,
            undefined,
        ),
        targetMovePct: renderTargetMovePctCell(
            suggestedCut,
            stock.positionValue || 0,
            showStats,
        ),
        reduction: renderReviewCutCell(plannedCut, showStats, 0, stock),
        expected: reviewImportVarianceActive
            ? renderReviewReconciliationCell(
                  'expected',
                  reconciliationCheck,
                  showStats,
              )
            : null,
        imported: reviewImportVarianceActive
            ? renderReviewReconciliationCell(
                  'imported',
                  reconciliationCheck,
                  showStats,
              )
            : null,
        variance: reviewImportVarianceActive
            ? renderReviewReconciliationCell(
                  'variance',
                  reconciliationCheck,
                  showStats,
              )
            : null,
        reduce: (
            <td className="text-center px-1 border-r border-border/30 h-[26px] align-middle">
                {showStats ? (
                    isPortfolioReviewMode && plannedCut > 0 ? (
                        <span className="font-mono text-[10px] text-primary">
                            +${Math.round(plannedCut).toLocaleString()}
                        </span>
                    ) : (
                        <div className="h-[28px]" />
                    )
                ) : null}
            </td>
        ),
        exposurePercent: (
            <td className="h-[26px] text-center font-mono font-light text-[10px] border-r border-border/30 align-middle">
                {null}
            </td>
        ),
        currentReduction: renderReviewProgressCell(
            plannedCut,
            stock.positionValue || 0,
            showStats,
            0,
            true,
            stock,
        ),
    };
}
