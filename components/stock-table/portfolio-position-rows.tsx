import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Stock } from '@/lib/store';
import type { StockGroup } from '@/lib/api';
import type { PositionGridColumn } from './columns';
import {
    PositionCashComponentRow,
    PositionPortfolioAggregateRow,
} from './position-aggregate-row';

type PositionAggregateStats = {
    marketValue: number;
    bookValue: number;
    cashReserve: number;
    plDollar: number;
};

type PositionAggregateOptions = {
    classPercent?: number | null;
    plannedCutValue?: number;
    requiredCutValue?: number;
    portfolioPercent?: number | null;
    showStats: boolean;
    subtle?: boolean;
    portfolioAssetClassCode?: string | null;
    enforceReductionTarget?: boolean;
};

type PortfolioMixRowLike = {
    value?: number | null;
    weight_pct?: number | null;
} | null | undefined;

type PortfolioCashComponentLike = {
    key?: string | null;
    display_name?: string | null;
    value?: number | null;
    weight_pct?: number | null;
    display_order?: number | null;
};

type RenderPositionAggregateCells = (
    stats: PositionAggregateStats,
    options: PositionAggregateOptions,
) => ReactNode;

export function renderPortfolioCashAssetClassRows({
    isPortfolioRebalanceMode,
    portfolioCashBucketValue,
    portfolioMixCashRow,
    cashComponents,
    portfolioTotalValue,
    portfolioCollapsedGroupIds,
    portfolioClassTintStyle,
    isPortfolioReviewMode,
    positionQ1StatsVisible,
    rowClassName,
    renderPositionAggregateCells,
    hoverPortfolioAssetClass,
    clearHoveredPortfolioAssetClass,
    selectPortfolioAssetClass,
    togglePortfolioGroupCollapsed,
}: {
    isPortfolioRebalanceMode: boolean;
    portfolioCashBucketValue: number;
    portfolioMixCashRow: PortfolioMixRowLike;
    cashComponents?: PortfolioCashComponentLike[] | null;
    portfolioTotalValue: number;
    portfolioCollapsedGroupIds: Set<string>;
    portfolioClassTintStyle?: CSSProperties;
    isPortfolioReviewMode: boolean;
    positionQ1StatsVisible: boolean;
    rowClassName: string;
    renderPositionAggregateCells: RenderPositionAggregateCells;
    hoverPortfolioAssetClass: (assetClassCode: string) => void;
    clearHoveredPortfolioAssetClass: () => void;
    selectPortfolioAssetClass: (assetClassCode: string) => void;
    togglePortfolioGroupCollapsed: (groupId: string) => void;
}): ReactNode {
    if (!isPortfolioRebalanceMode) return null;
    if (portfolioCashBucketValue <= 0.01 && !portfolioMixCashRow) return null;

    const cashGroupId = '__portfolio_cash_reserve__';
    const cashGroupOpen = portfolioCollapsedGroupIds.has(cashGroupId);
    const portfolioPercent =
        portfolioMixCashRow?.weight_pct ??
        (portfolioTotalValue > 0
            ? (portfolioCashBucketValue / portfolioTotalValue) * 100
            : 0);
    const resolvedCashComponents =
        cashComponents && cashComponents.length > 0
            ? cashComponents
            : [
                  {
                      key: 'BROKER_CASH',
                      display_name: 'Broker Cash',
                      value: portfolioCashBucketValue,
                      weight_pct: portfolioPercent,
                      display_order: 1,
                  },
              ];
    const visibleCashComponents = resolvedCashComponents.filter(
        (component) => (component.value || 0) > 0.01,
    );

    const renderCashComponentRow = (
        component: (typeof visibleCashComponents)[number],
    ) => {
        const componentValue = component.value || 0;
        const componentPortfolioPct =
            component.weight_pct ??
            (portfolioTotalValue > 0
                ? (componentValue / portfolioTotalValue) * 100
                : 0);
        const componentClassPct =
            portfolioCashBucketValue > 0
                ? (componentValue / portfolioCashBucketValue) * 100
                : null;
        const label = String(component.display_name || component.key || 'Cash')
            .trim();

        return (
            <PositionCashComponentRow
                key={`portfolio-cash-component-${component.key || label}`}
                label={label}
                isPortfolioReviewMode={isPortfolioReviewMode}
            >
                {renderPositionAggregateCells(
                    {
                        marketValue: 0,
                        bookValue: 0,
                        cashReserve: componentValue,
                        plDollar: 0,
                    },
                    {
                        classPercent: componentClassPct,
                        portfolioPercent: componentPortfolioPct,
                        showStats: positionQ1StatsVisible,
                        subtle: true,
                        enforceReductionTarget: false,
                    },
                )}
            </PositionCashComponentRow>
        );
    };

    return (
        <Fragment key="portfolio-cash-rows">
            <PositionPortfolioAggregateRow
                key="portfolio-cash-asset-class"
                assetClassCode="CASH"
                className={rowClassName}
                style={portfolioClassTintStyle}
                isPortfolioReviewMode={isPortfolioReviewMode}
                label="Cash/Reserve"
                open={cashGroupOpen}
                onMouseEnter={() => hoverPortfolioAssetClass('CASH')}
                onMouseLeave={clearHoveredPortfolioAssetClass}
                onClick={() => selectPortfolioAssetClass('CASH')}
                onNameClick={(event) => {
                    event.stopPropagation();
                    selectPortfolioAssetClass('CASH');
                    togglePortfolioGroupCollapsed(cashGroupId);
                }}
            >
                {renderPositionAggregateCells(
                    {
                        marketValue: 0,
                        bookValue: 0,
                        cashReserve: portfolioCashBucketValue,
                        plDollar: 0,
                    },
                    {
                        classPercent: 100,
                        portfolioPercent,
                        showStats: positionQ1StatsVisible,
                        subtle: true,
                        portfolioAssetClassCode: 'CASH',
                        enforceReductionTarget: false,
                    },
                )}
            </PositionPortfolioAggregateRow>
            {cashGroupOpen
                ? visibleCashComponents.map((component) =>
                      renderCashComponentRow(component),
                  )
                : null}
        </Fragment>
    );
}

export function renderPortfolioUnassignedAssetClassRows({
    isPortfolioRebalanceMode,
    portfolioMixUnassignedRow,
    unassignedPortfolioStocks,
    portfolioTotalValue,
    portfolioCollapsedGroupIds,
    portfolioClassTintStyle,
    isPortfolioReviewMode,
    positionGroupStatsVisible,
    reviewSummaryRowsOnly,
    rowClassName,
    isPortfolioTargetAdjustmentMode,
    calculateStatsForStocks,
    getPortfolioPlannedCutForStocks,
    getPortfolioRequiredCutForAssetCodes,
    renderPositionAggregateCells,
    renderStockRow,
    hoverPortfolioAssetClass,
    clearHoveredPortfolioAssetClass,
    selectPortfolioAssetClass,
    togglePortfolioGroupCollapsed,
    assignStockToGroup,
}: {
    isPortfolioRebalanceMode: boolean;
    portfolioMixUnassignedRow: PortfolioMixRowLike;
    unassignedPortfolioStocks: Stock[];
    portfolioTotalValue: number;
    portfolioCollapsedGroupIds: Set<string>;
    portfolioClassTintStyle?: CSSProperties;
    isPortfolioReviewMode: boolean;
    positionGroupStatsVisible: boolean;
    reviewSummaryRowsOnly: boolean;
    rowClassName: string;
    isPortfolioTargetAdjustmentMode: boolean;
    calculateStatsForStocks: (stocks: Stock[]) => PositionAggregateStats;
    getPortfolioPlannedCutForStocks: (stocks: Stock[]) => number;
    getPortfolioRequiredCutForAssetCodes: (assetClassCodes: string[]) => number;
    renderPositionAggregateCells: RenderPositionAggregateCells;
    renderStockRow: (stock: Stock) => ReactNode;
    hoverPortfolioAssetClass: (assetClassCode: string) => void;
    clearHoveredPortfolioAssetClass: () => void;
    selectPortfolioAssetClass: (assetClassCode: string) => void;
    togglePortfolioGroupCollapsed: (groupId: string) => void;
    assignStockToGroup: (stockId: number, groupId: string | null) => void;
}): ReactNode {
    if (!isPortfolioRebalanceMode) return null;

    const unassignedValue =
        portfolioMixUnassignedRow?.value ??
        unassignedPortfolioStocks.reduce(
            (sum, stock) => sum + (stock.positionValue || 0),
            0,
        );
    if (unassignedValue <= 0.01 && !portfolioMixUnassignedRow) return null;

    const groupId = '__portfolio_unassigned__';
    const groupOpen = !portfolioCollapsedGroupIds.has(groupId);
    const portfolioPercent =
        portfolioMixUnassignedRow?.weight_pct ??
        (portfolioTotalValue > 0
            ? (unassignedValue / portfolioTotalValue) * 100
            : 0);
    const stats =
        unassignedPortfolioStocks.length > 0
            ? calculateStatsForStocks(unassignedPortfolioStocks)
            : {
                  marketValue: unassignedValue,
                  bookValue: 0,
                  cashReserve: 0,
                  plDollar: 0,
              };

    return (
        <Fragment key="portfolio-unassigned-rows">
            <PositionPortfolioAggregateRow
                key="portfolio-unassigned-asset-class"
                assetClassCode="UNASSIGNED"
                className={rowClassName}
                style={portfolioClassTintStyle}
                isPortfolioReviewMode={isPortfolioReviewMode}
                label="Unassigned"
                open={groupOpen}
                onMouseEnter={() => hoverPortfolioAssetClass('UNASSIGNED')}
                onMouseLeave={clearHoveredPortfolioAssetClass}
                onClick={() => selectPortfolioAssetClass('UNASSIGNED')}
                onDragOver={(event) => {
                    event.preventDefault();
                    event.currentTarget.classList.add('bg-primary/10');
                }}
                onDragLeave={(event) => {
                    event.currentTarget.classList.remove('bg-primary/10');
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    event.currentTarget.classList.remove('bg-primary/10');
                    const stockId = parseInt(event.dataTransfer.getData('stockId'));
                    if (stockId) {
                        assignStockToGroup(stockId, null);
                    }
                }}
                onNameClick={(event) => {
                    event.stopPropagation();
                    selectPortfolioAssetClass('UNASSIGNED');
                    togglePortfolioGroupCollapsed(groupId);
                }}
            >
                {renderPositionAggregateCells(stats, {
                    classPercent: 100,
                    plannedCutValue:
                        isPortfolioTargetAdjustmentMode || isPortfolioRebalanceMode
                            ? getPortfolioPlannedCutForStocks(
                                  unassignedPortfolioStocks,
                              )
                            : 0,
                    requiredCutValue:
                        isPortfolioTargetAdjustmentMode || isPortfolioRebalanceMode
                            ? getPortfolioRequiredCutForAssetCodes(['UNASSIGNED'])
                            : 0,
                    portfolioPercent,
                    showStats: positionGroupStatsVisible,
                    subtle: true,
                    portfolioAssetClassCode: 'UNASSIGNED',
                    enforceReductionTarget: false,
                })}
            </PositionPortfolioAggregateRow>
            {groupOpen && !reviewSummaryRowsOnly
                ? unassignedPortfolioStocks.map((stock) => renderStockRow(stock))
                : null}
        </Fragment>
    );
}

type PortfolioPureEntry =
    | { kind: 'group'; group: StockGroup }
    | { kind: 'unassigned' }
    | { kind: 'reduce' };

export function buildPortfolioPureSortedRows({
    topLevelGroups,
    includeUnassigned,
    includeCash,
    sortColumn,
    sortDirection,
    getEntryDisplayOrder,
    getEntryClassPercent,
    getEntryPortfolioPercent,
    renderGroupBranch,
    renderPortfolioCashAssetClassRows,
    renderPortfolioUnassignedAssetClassRows,
}: {
    topLevelGroups: StockGroup[];
    includeUnassigned: boolean;
    includeCash: boolean;
    sortColumn: string | null;
    sortDirection: 'asc' | 'desc' | null;
    getEntryDisplayOrder: (entry: PortfolioPureEntry) => number;
    getEntryClassPercent: (entry: PortfolioPureEntry) => number;
    getEntryPortfolioPercent: (entry: PortfolioPureEntry) => number;
    renderGroupBranch: (group: StockGroup, depth: number) => ReactNode[];
    renderPortfolioCashAssetClassRows: () => ReactNode;
    renderPortfolioUnassignedAssetClassRows: () => ReactNode;
}): ReactNode[] {
    const entries: PortfolioPureEntry[] = topLevelGroups.map((group) => ({
        kind: 'group',
        group,
    }));
    if (includeUnassigned) {
        entries.push({ kind: 'unassigned' });
    }
    if (includeCash) {
        entries.push({ kind: 'reduce' });
    }

    const getEntryName = (entry: PortfolioPureEntry) =>
        entry.kind === 'reduce'
            ? 'Cash/Reserve'
            : entry.kind === 'unassigned'
              ? 'Unassigned'
              : entry.group.name;

    const sortedEntries = [...entries].sort((a, b) => {
        if (
            sortDirection &&
            (sortColumn === 'CLASS_PERCENT' ||
                sortColumn === 'PORTFOLIO_PERCENT')
        ) {
            const multiplier = sortDirection === 'desc' ? 1 : -1;
            const aValue =
                sortColumn === 'CLASS_PERCENT'
                    ? getEntryClassPercent(a)
                    : getEntryPortfolioPercent(a);
            const bValue =
                sortColumn === 'CLASS_PERCENT'
                    ? getEntryClassPercent(b)
                    : getEntryPortfolioPercent(b);
            const diff = (bValue - aValue) * multiplier;
            if (Math.abs(diff) > 0.0001) return diff;
        }

        const orderDiff = getEntryDisplayOrder(a) - getEntryDisplayOrder(b);
        if (orderDiff !== 0) return orderDiff;
        return getEntryName(a).localeCompare(getEntryName(b));
    });

    return sortedEntries.flatMap((entry) =>
        entry.kind === 'reduce'
            ? [renderPortfolioCashAssetClassRows()]
            : entry.kind === 'unassigned'
              ? [renderPortfolioUnassignedAssetClassRows()]
              : renderGroupBranch(entry.group, 0),
    );
}

export function PortfolioHiddenBucketSpacerRow({
    rowKey,
    isPortfolioRebalanceMode,
    showPortfolioBucketRows,
    positionGridColumns,
}: {
    rowKey: string;
    isPortfolioRebalanceMode: boolean;
    showPortfolioBucketRows: boolean;
    positionGridColumns: PositionGridColumn[];
}) {
    if (!isPortfolioRebalanceMode || showPortfolioBucketRows) return null;

    return (
        <tr
            key={rowKey}
            aria-hidden="true"
            className="pointer-events-none border-b border-border/15"
        >
            {positionGridColumns.map((column) => (
                <td
                    key={`${rowKey}-${column.key}`}
                    className="h-[26px] border-r border-border/10 bg-transparent p-0"
                />
            ))}
        </tr>
    );
}
