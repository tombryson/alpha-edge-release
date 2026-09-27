import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Stock } from '@/lib/store';
import type { SecurityActionResponse } from '@/lib/api';
import type { PositionGridColumnKey } from './columns';
import type { PositionModelWeight } from '@/lib/positions-model-weight';
import {
    PositionActionCell,
    PositionDcaCell,
    PositionTrendCell,
} from './position-signal-cells';
import { buildPositionStockAdjustmentCells } from './position-stock-adjustment-cells';
import {
    PositionStockAssetCell,
    PositionStockMoneyCell,
    PositionStockModelWeightCell,
    PositionStockPlDollarCell,
    PositionStockPlPercentCell,
    PositionStockPortfolioPercentCell,
    PositionStockPriceCell,
    PositionStockQuantityCell,
} from './position-stock-value-cells';

type ReconciliationColumn = 'expected' | 'imported' | 'variance';

type CreatePositionStockCellRendererArgs<TCheck> = {
    usesPortfolioAdjustmentModel: boolean;
    isPortfolioReviewMode: boolean;
    positionStockStatsVisible: boolean;
    reviewImportVarianceActive: boolean;
    portfolioTotalValue: number;
    securityPositions: Record<string, 'BUY' | 'SELL'>;
    securityActions: SecurityActionResponse[];
    onOpenSecurityActions: (action: SecurityActionResponse) => void;
    contributionOverrides: Record<number, Date>;
    setContributionOverrides: Dispatch<SetStateAction<Record<number, Date>>>;
    fetchHoldings: () => Promise<void>;
    logContribution: (analysisId: number) => Promise<unknown>;
    contributeByName: (
        name: string,
        ticker: string,
    ) => Promise<{ id: number }>;
    getPortfolioPlannedCutForStock: (stock: Stock) => number;
    getReviewPlannedCutForStock: (stock: Stock) => number;
    getPortfolioSuggestedCutForStock: (stock: Stock) => number;
    getReviewTargetCutForStock: (stock: Stock) => number;
    getReviewPortfolioPct: (value: number) => number;
    getStockReconciliationCheck: (stock: Stock) => TCheck | null;
    getClassPercentForStock: (stock: Stock) => number | null | undefined;
    modelWeights: ReadonlyMap<number, PositionModelWeight>;
    getStockAssetDisplay: (stock: Stock) => string;
    renderPositionOrderedCells: (
        cells: Partial<Record<PositionGridColumnKey, ReactNode>>,
    ) => ReactNode;
    renderClassPercentCell: (
        value: number | null | undefined,
        showStats: boolean,
        toneClass?: string,
    ) => ReactNode;
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

export function createRenderPositionStockCells<TCheck>({
    usesPortfolioAdjustmentModel,
    isPortfolioReviewMode,
    positionStockStatsVisible,
    reviewImportVarianceActive,
    portfolioTotalValue,
    securityPositions,
    securityActions,
    onOpenSecurityActions,
    contributionOverrides,
    setContributionOverrides,
    fetchHoldings,
    logContribution,
    contributeByName,
    getPortfolioPlannedCutForStock,
    getReviewPlannedCutForStock,
    getPortfolioSuggestedCutForStock,
    getReviewTargetCutForStock,
    getReviewPortfolioPct,
    getStockReconciliationCheck,
    getClassPercentForStock,
    modelWeights,
    getStockAssetDisplay,
    renderPositionOrderedCells,
    renderClassPercentCell,
    renderReviewTargetPercentCell,
    renderTargetMovePctCell,
    renderReviewCutCell,
    renderReviewReconciliationCell,
    renderReviewProgressCell,
}: CreatePositionStockCellRendererArgs<TCheck>) {
    return function renderPositionStockCells(stock: Stock) {
        const plannedCut = usesPortfolioAdjustmentModel
            ? getPortfolioPlannedCutForStock(stock)
            : isPortfolioReviewMode
              ? getReviewPlannedCutForStock(stock)
              : 0;
        const suggestedCut = usesPortfolioAdjustmentModel
            ? getPortfolioSuggestedCutForStock(stock)
            : getReviewTargetCutForStock(stock);
        const changeValue = stock.changeValue || 0;
        const changePercent = stock.changePercent || 0;
        const positionState = stock.symbol
            ? securityPositions[stock.id]
            : null;
        const directSecurityAction = stock.symbol
            ? securityActions.find(
                  (action) =>
                      action.is_primary &&
                      action.scope === 'SECURITY' &&
                      action.ticker.toUpperCase() === stock.symbol!.toUpperCase(),
              ) ?? null
            : null;
        const classAction = stock.symbol
            ? securityActions.find(
                  (action) =>
                      action.is_primary &&
                      action.scope === 'ASSET_CLASS' &&
                      (action.affected_tickers || []).some(
                          (ticker) =>
                              ticker.toUpperCase() === stock.symbol!.toUpperCase(),
                      ),
              ) ?? null
            : null;
        // A direct security instruction is more specific than the shared
        // asset-class context. The latter remains available from any affected
        // row without creating duplicate queue records.
        const securityAction = directSecurityAction ?? classAction;
        const analysisId = stock.analysisId;
        const rawContributionDate = analysisId
            ? contributionOverrides[analysisId] ??
              stock.lastContributedAt ??
              null
            : null;
        const lastContributionDate = rawContributionDate
            ? new Date(rawContributionDate)
            : null;
        const dcaDaysSince =
            lastContributionDate && !isNaN(lastContributionDate.getTime())
                ? Math.floor(
                      (Date.now() - lastContributionDate.getTime()) /
                          (1000 * 60 * 60 * 24),
                  )
                : null;
        const handleDcaClick = async () => {
            try {
                if (analysisId) {
                    await logContribution(analysisId);
                    setContributionOverrides((prev) => ({
                        ...prev,
                        [analysisId]: new Date(),
                    }));
                } else {
                    const ticker = (stock.prefix || '') + (stock.symbol || '');
                    const result = await contributeByName(stock.name, ticker);
                    setContributionOverrides((prev) => ({
                        ...prev,
                        [result.id]: new Date(),
                    }));
                    await fetchHoldings();
                }
            } catch (error) {
                console.error('[DCA] Failed to log contribution', error);
            }
        };
        const dcaTitle = analysisId
            ? lastContributionDate
                ? `Last contributed ${dcaDaysSince}d ago - click to log today`
                : 'No contribution recorded - click to log today'
            : 'Click to start DCA tracking for this stock';
        const stockDisplayValue = Math.max(
            0,
            (stock.positionValue || 0) - plannedCut,
        );
        const stockPortfolioPercent = isPortfolioReviewMode
            ? getReviewPortfolioPct(stockDisplayValue)
            : portfolioTotalValue > 0
              ? (stockDisplayValue / portfolioTotalValue) * 100
              : 0;
        const stockReconciliationCheck = getStockReconciliationCheck(stock);
        const modelWeight = modelWeights.get(stock.id);
        const classPercent = getClassPercentForStock(stock);

        return renderPositionOrderedCells({
            modelWeight: <PositionStockModelWeightCell showStats={positionStockStatsVisible} weight={modelWeight} actualPercent={classPercent} />,
            classPercent: renderClassPercentCell(
                classPercent,
                positionStockStatsVisible,
            ),
            asset: (
                <PositionStockAssetCell
                    showStats={positionStockStatsVisible}
                    value={getStockAssetDisplay(stock)}
                />
            ),
            cdf: (
                <PositionTrendCell
                    showStats={positionStockStatsVisible}
                    positionState={positionState}
                />
            ),
            atr: (
                <PositionActionCell
                    showStats={positionStockStatsVisible}
                    action={securityAction}
                    onOpen={() => {
                        if (securityAction?.ticker) {
                            onOpenSecurityActions(securityAction);
                        }
                    }}
                />
            ),
            dca: (
                <PositionDcaCell
                    showStats={positionStockStatsVisible}
                    isWatchlist={stock.isWatchlist}
                    daysSince={dcaDaysSince}
                    title={dcaTitle}
                    onLogContribution={handleDcaClick}
                />
            ),
            price: (
                <PositionStockPriceCell
                    showStats={positionStockStatsVisible}
                    value={stock.price || 0}
                />
            ),
            bookValue: (
                <PositionStockMoneyCell
                    showStats={positionStockStatsVisible}
                    value={stock.bookValue || 0}
                />
            ),
            mktValue: (
                <PositionStockMoneyCell
                    showStats={positionStockStatsVisible}
                    value={stock.positionValue || 0}
                    padded
                />
            ),
            ...buildPositionStockAdjustmentCells({
                stock,
                plannedCut,
                suggestedCut,
                showStats: positionStockStatsVisible,
                isPortfolioReviewMode,
                reviewImportVarianceActive,
                reconciliationCheck: stockReconciliationCheck,
                renderReviewTargetPercentCell,
                renderTargetMovePctCell,
                renderReviewCutCell,
                renderReviewReconciliationCell,
                renderReviewProgressCell,
            }),
            qty: (
                <PositionStockQuantityCell
                    showStats={positionStockStatsVisible}
                    value={stock.position || 0}
                />
            ),
            plDollar: (
                <PositionStockPlDollarCell
                    showStats={positionStockStatsVisible}
                    value={changeValue}
                />
            ),
            plPercent: (
                <PositionStockPlPercentCell
                    showStats={positionStockStatsVisible}
                    value={changePercent}
                />
            ),
            portfolioPercent: (
                <PositionStockPortfolioPercentCell
                    showStats={positionStockStatsVisible}
                    portfolioPercent={stockPortfolioPercent}
                />
            ),
            currentReduction: renderReviewProgressCell(
                plannedCut,
                stock.positionValue || 0,
                positionStockStatsVisible,
                0,
                true,
                stock,
            ),
        });
    };
}
