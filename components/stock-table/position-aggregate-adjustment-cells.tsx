import type { CSSProperties, ReactNode } from 'react';
import type { Stock } from '@/lib/store';
import type { PositionGridColumnKey } from './columns';

type ReconciliationColumn = 'expected' | 'imported' | 'variance';

type BuildPositionAggregateAdjustmentCellsArgs<TCheck> = {
    plannedCutValue: number;
    requiredCutValue: number;
    marketValue: number;
    cashReserve: number;
    showStats: boolean;
    shouldRenderStats: boolean;
    cutLabel?: string;
    targetReductionPct?: number | null;
    enforceReductionTarget: boolean;
    reviewImportVarianceActive: boolean;
    reconciliationCheck: TCheck | null | undefined;
    editableCashAssetClassCode?: string | null;
    editingCashAssetClass: string | null;
    statsFadeClass: string;
    statsFadeStyle?: CSSProperties;
    toggleCashEdit: (assetClassCode: string, cashReserve: number) => void;
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

function PositionAggregateCashCell({
    shouldRenderStats,
    showStats,
    cashReserve,
    editableCashAssetClassCode,
    editingCashAssetClass,
    statsFadeClass,
    statsFadeStyle,
    toggleCashEdit,
}: Pick<
    BuildPositionAggregateAdjustmentCellsArgs<unknown>,
    | 'shouldRenderStats'
    | 'showStats'
    | 'cashReserve'
    | 'editableCashAssetClassCode'
    | 'editingCashAssetClass'
    | 'statsFadeClass'
    | 'statsFadeStyle'
    | 'toggleCashEdit'
>) {
    const editorOpen = editingCashAssetClass === editableCashAssetClassCode;
    return (
        <td className="h-[26px] text-center px-1 align-middle font-mono text-[10px] border-r border-border/30">
            {shouldRenderStats ? (
                editableCashAssetClassCode && showStats ? (
                    <button
                        onClick={() =>
                            toggleCashEdit(
                                editableCashAssetClassCode,
                                cashReserve,
                            )
                        }
                        className={`w-full rounded-[2px] px-2 py-1 text-center font-mono font-light ${
                            editorOpen
                                ? 'border border-primary/60 bg-primary/[0.08] text-foreground'
                                : cashReserve > 0
                                  ? 'text-foreground hover:text-primary'
                                  : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        ${Math.round(cashReserve).toLocaleString()}
                    </button>
                ) : (
                    <span
                        className={`text-foreground ${statsFadeClass}`}
                        style={statsFadeStyle}
                    >
                        ${Math.round(cashReserve).toLocaleString()}
                    </span>
                )
            ) : null}
        </td>
    );
}

export function buildPositionAggregateAdjustmentCells<TCheck>({
    plannedCutValue,
    requiredCutValue,
    marketValue,
    cashReserve,
    showStats,
    shouldRenderStats,
    cutLabel,
    targetReductionPct,
    enforceReductionTarget,
    reviewImportVarianceActive,
    reconciliationCheck,
    editableCashAssetClassCode,
    editingCashAssetClass,
    statsFadeClass,
    statsFadeStyle,
    toggleCashEdit,
    renderReviewTargetPercentCell,
    renderTargetMovePctCell,
    renderReviewCutCell,
    renderReviewReconciliationCell,
    renderReviewProgressCell,
}: BuildPositionAggregateAdjustmentCellsArgs<TCheck>): Partial<
    Record<PositionGridColumnKey, ReactNode>
> {
    return {
        remaining: <td className="text-center border-r border-border/30 tabular-nums"
            title="Remaining asset-class requirement; recorded amounts are not yet broker verification">
            {showStats && requiredCutValue > 0 ? `$${Math.round(Math.max(0, requiredCutValue - plannedCutValue)).toLocaleString()}` : ''}
        </td>,
        targetAdjustment: renderReviewTargetPercentCell(
            requiredCutValue,
            marketValue,
            showStats,
            cutLabel,
            targetReductionPct,
        ),
        targetMovePct: renderTargetMovePctCell(
            requiredCutValue,
            marketValue,
            showStats,
        ),
        reduction: renderReviewCutCell(
            plannedCutValue,
            showStats,
            requiredCutValue,
            undefined,
            cutLabel,
            enforceReductionTarget,
        ),
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
            <PositionAggregateCashCell
                shouldRenderStats={shouldRenderStats}
                showStats={showStats}
                cashReserve={cashReserve}
                editableCashAssetClassCode={editableCashAssetClassCode}
                editingCashAssetClass={editingCashAssetClass}
                statsFadeClass={statsFadeClass}
                statsFadeStyle={statsFadeStyle}
                toggleCashEdit={toggleCashEdit}
            />
        ),
        currentReduction: renderReviewProgressCell(
            plannedCutValue,
            marketValue,
            showStats,
            requiredCutValue,
            enforceReductionTarget,
        ),
    };
}
