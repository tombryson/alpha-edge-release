import React from 'react';
import type { Stock } from '@/lib/store';
import type {
    PositionGridColumn,
    PositionGridColumnKey,
} from './columns';
import { buildPositionAggregateAdjustmentCells } from './position-aggregate-adjustment-cells';
import {
    PositionAggregateAssetCell,
    PositionAggregateExposurePercentCell,
    PositionAggregateMoneyCell,
    PositionAggregatePlDollarCell,
    PositionAggregatePlPercentCell,
    PositionAggregatePortfolioPercentCell,
} from './position-aggregate-value-cells';

type ReconciliationColumn = 'expected' | 'imported' | 'variance';

export type PositionAggregateStats = {
    marketValue: number;
    bookValue: number;
    cashReserve: number;
    plDollar: number;
};

export type PositionAggregateCellOptions<TCheck> = {
    classPercent?: number | null;
    plannedCutValue?: number;
    requiredCutValue?: number;
    cutLabel?: string;
    portfolioPercent?: number | null;
    portfolioTargetPercent?: number | null;
    showStats: boolean;
    subtle?: boolean;
    editableCashAssetClassCode?: string | null;
    emphasizePortfolioPercent?: boolean;
    alwaysShowPortfolioPercent?: boolean;
    portfolioAssetClassCode?: string | null;
    assetLabel?: React.ReactNode;
    targetReductionPct?: number | null;
    enforceReductionTarget?: boolean;
    reconciliationCheck?: TCheck | null;
};

type CreatePositionAggregateCellRendererArgs<TCheck> = {
    positionGridColumns: PositionGridColumn[];
    isPortfolioReviewMode: boolean;
    isPortfolioRebalanceMode: boolean;
    getReviewPortfolioPct: (value: number) => number;
    positionStatsPeekMode: boolean;
    positionStatsPeekFadeStyle: (
        showStats: boolean,
    ) => React.CSSProperties | undefined;
    isPortfolioAssetClassFocused: (
        assetClassCode?: string | null,
    ) => boolean;
    reviewImportVarianceActive: boolean;
    editingCashAssetClass: string | null;
    toggleCashEdit: (assetClassCode: string, cashReserve: number) => void;
    renderClassPercentCell: (
        value: number | null | undefined,
        showStats: boolean,
        toneClass?: string,
    ) => React.ReactNode;
    renderReviewTargetPercentCell: (
        targetCutValue: number,
        currentValue: number,
        showStats: boolean,
        cutLabel?: string,
        targetPctOverride?: number | null,
    ) => React.ReactNode;
    renderTargetMovePctCell: (
        targetMoveValue: number,
        currentValue: number,
        showStats: boolean,
    ) => React.ReactNode;
    renderReviewCutCell: (
        plannedCutValue: number,
        showStats: boolean,
        requiredCutValue?: number,
        stock?: Stock,
        cutLabel?: string,
        enforceTarget?: boolean,
    ) => React.ReactNode;
    renderReviewReconciliationCell: (
        column: ReconciliationColumn,
        check: TCheck | null | undefined,
        showStats: boolean,
    ) => React.ReactNode;
    renderReviewProgressCell: (
        plannedCutValue: number,
        currentValue: number,
        showStats: boolean,
        requiredCutValue?: number,
        enforceTarget?: boolean,
        stock?: Stock,
    ) => React.ReactNode;
};

const renderPositionBlankCell = () => (
    <td className="h-[26px] border-r border-border/30" />
);

export function createRenderPositionAggregateCells<TCheck>({
    positionGridColumns,
    isPortfolioReviewMode,
    isPortfolioRebalanceMode,
    getReviewPortfolioPct,
    positionStatsPeekMode,
    positionStatsPeekFadeStyle,
    isPortfolioAssetClassFocused,
    reviewImportVarianceActive,
    editingCashAssetClass,
    toggleCashEdit,
    renderClassPercentCell,
    renderReviewTargetPercentCell,
    renderTargetMovePctCell,
    renderReviewCutCell,
    renderReviewReconciliationCell,
    renderReviewProgressCell,
}: CreatePositionAggregateCellRendererArgs<TCheck>) {
    const renderPositionOrderedCells = (
        cells: Partial<Record<PositionGridColumnKey, React.ReactNode>>,
    ) =>
        positionGridColumns
            .filter((column) => column.key !== 'name')
            .map((column) => (
                <React.Fragment key={column.key}>
                    {cells[column.key] ?? renderPositionBlankCell()}
                </React.Fragment>
            ));

    return function renderPositionAggregateCells(
        stats: PositionAggregateStats,
        options: PositionAggregateCellOptions<TCheck>,
    ) {
        const {
            classPercent = null,
            plannedCutValue = 0,
            requiredCutValue = 0,
            cutLabel,
            portfolioPercent = null,
            portfolioTargetPercent = null,
            showStats,
            subtle = false,
            editableCashAssetClassCode = null,
            emphasizePortfolioPercent = false,
            alwaysShowPortfolioPercent = false,
            portfolioAssetClassCode = null,
            assetLabel = null,
            targetReductionPct = null,
            enforceReductionTarget = true,
            reconciliationCheck = null,
        } = options;
        const plPct =
            stats.bookValue > 0 ? (stats.plDollar / stats.bookValue) * 100 : 0;
        const plPos = stats.plDollar >= 0;
        const draftMarketValue =
            (isPortfolioReviewMode || isPortfolioRebalanceMode) &&
            plannedCutValue > 0
                ? Math.max(0, stats.marketValue - plannedCutValue)
                : stats.marketValue;
        const totalCapital = draftMarketValue + stats.cashReserve;
        const exposurePercent =
            totalCapital > 0 ? (draftMarketValue / totalCapital) * 100 : null;
        const displayPortfolioPercent =
            isPortfolioReviewMode && portfolioPercent != null
                ? getReviewPortfolioPct(
                      Math.max(0, stats.marketValue - plannedCutValue),
                  )
                : portfolioPercent;
        const shouldRenderStats = showStats || positionStatsPeekMode;
        const statsFadeClass = positionStatsPeekMode
            ? 'transition-opacity'
            : '';
        const statsFadeStyle = positionStatsPeekFadeStyle(showStats);
        const hasDisplayPortfolioPercent =
            shouldRenderStats &&
            displayPortfolioPercent != null &&
            Number.isFinite(displayPortfolioPercent);
        const hasPersistentPortfolioPercent =
            alwaysShowPortfolioPercent &&
            displayPortfolioPercent != null &&
            Number.isFinite(displayPortfolioPercent);
        const shouldShowPortfolioPercent =
            hasDisplayPortfolioPercent || hasPersistentPortfolioPercent;
        const portfolioFillPct = hasDisplayPortfolioPercent
            ? Math.min(100, Math.max(0, Number(displayPortfolioPercent)))
            : 0;
        const portfolioTargetMarkerPct =
            portfolioTargetPercent != null &&
            Number.isFinite(portfolioTargetPercent)
                ? Math.min(100, Math.max(0, Number(portfolioTargetPercent)))
                : null;
        const toneClass =
            subtle && !positionStatsPeekMode
                ? 'text-muted-foreground'
                : 'text-foreground';
        const portfolioPercentTextClass = isPortfolioRebalanceMode
            ? 'relative z-10 font-semibold text-white'
            : emphasizePortfolioPercent && isPortfolioReviewMode
              ? 'relative z-10 font-semibold text-sky-100'
              : hasPersistentPortfolioPercent
                ? 'relative z-10 text-muted-foreground/70'
                : `relative z-10 ${toneClass} ${statsFadeClass}`;
        const portfolioPercentFocused =
            isPortfolioRebalanceMode &&
            isPortfolioAssetClassFocused(portfolioAssetClassCode);
        const portfolioPercentTextStyle =
            hasPersistentPortfolioPercent ||
            isPortfolioRebalanceMode ||
            (emphasizePortfolioPercent && isPortfolioReviewMode)
                ? undefined
                : statsFadeStyle;

        return renderPositionOrderedCells({
            classPercent: renderClassPercentCell(
                classPercent,
                showStats,
                toneClass,
            ),
            asset: (
                <PositionAggregateAssetCell
                    showStats={shouldRenderStats}
                    assetLabel={assetLabel}
                    fallbackLabel={portfolioAssetClassCode}
                />
            ),
            cdf: <td className="border-r border-border/30" />,
            atr: <td className="border-r border-border/30" />,
            dca: (
                <td
                    className="border-r border-border/30"
                    style={{
                        width: '28px',
                        minWidth: '28px',
                        maxWidth: '28px',
                    }}
                />
            ),
            price: <td className="border-r border-border/30" />,
            bookValue: (
                <PositionAggregateMoneyCell
                    showStats={shouldRenderStats}
                    value={stats.bookValue}
                    toneClass={toneClass}
                    statsFadeClass={statsFadeClass}
                    statsFadeStyle={statsFadeStyle}
                />
            ),
            mktValue: (
                <PositionAggregateMoneyCell
                    showStats={shouldRenderStats}
                    value={stats.marketValue}
                    toneClass={toneClass}
                    statsFadeClass={statsFadeClass}
                    statsFadeStyle={statsFadeStyle}
                    padded
                />
            ),
            ...buildPositionAggregateAdjustmentCells({
                plannedCutValue,
                requiredCutValue,
                marketValue: stats.marketValue,
                cashReserve: stats.cashReserve,
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
            }),
            exposurePercent: (
                <PositionAggregateExposurePercentCell
                    showStats={shouldRenderStats}
                    exposurePercent={exposurePercent}
                    toneClass={toneClass}
                    statsFadeClass={statsFadeClass}
                    statsFadeStyle={statsFadeStyle}
                    reviewMode={isPortfolioReviewMode}
                />
            ),
            qty: <td className="border-r border-border/30" />,
            plDollar: (
                <PositionAggregatePlDollarCell
                    showStats={shouldRenderStats}
                    value={stats.plDollar}
                    positive={plPos}
                    statsFadeClass={statsFadeClass}
                    statsFadeStyle={statsFadeStyle}
                />
            ),
            plPercent: (
                <PositionAggregatePlPercentCell
                    showStats={shouldRenderStats}
                    value={plPct}
                    positive={plPos}
                    statsFadeClass={statsFadeClass}
                    statsFadeStyle={statsFadeStyle}
                />
            ),
            portfolioPercent: (
                <PositionAggregatePortfolioPercentCell
                    shouldShowPortfolioPercent={shouldShowPortfolioPercent}
                    displayPortfolioPercent={displayPortfolioPercent}
                    hasDisplayPortfolioPercent={hasDisplayPortfolioPercent}
                    fillPct={portfolioFillPct}
                    statsFadeStyle={statsFadeStyle}
                    textClass={portfolioPercentTextClass}
                    textStyle={portfolioPercentTextStyle}
                    emphasize={emphasizePortfolioPercent}
                    reviewMode={isPortfolioReviewMode}
                    focused={portfolioPercentFocused}
                    targetMarkerPct={portfolioTargetMarkerPct}
                />
            ),
        });
    };
}
