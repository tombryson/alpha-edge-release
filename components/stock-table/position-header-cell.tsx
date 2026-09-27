import React from 'react';
import { WeightPolicyControl } from '@/components/weight-policy-control';
import { RotateCcw } from 'lucide-react';
import type {
    PositionGridColumn,
    PositionGridColumnKey,
    PositionVisibleColumns,
} from '@/components/stock-table/columns';
import type {
    SortColumn,
    SortDirection,
} from '@/components/stock-table/types';

export type PositionColumnMenuItem = {
    key: string;
    label: string;
    visibleKey?: keyof PositionVisibleColumns;
    fixed?: boolean;
};

type PositionHeaderCellProps = {
    column: PositionGridColumn;
    resizeHandle: React.ReactNode;
    resetColumnWidths: () => void;
    sortColumn: SortColumn;
    sortDirection: SortDirection;
    draggedPositionColumnKey: PositionGridColumnKey | null;
    setDraggedPositionColumnKey: React.Dispatch<
        React.SetStateAction<PositionGridColumnKey | null>
    >;
    movePositionColumn: (
        sourceKey: PositionGridColumnKey,
        targetKey: PositionGridColumnKey,
    ) => void;
    columnMenuRef: React.RefObject<HTMLDivElement | null>;
    columnMenuPanelRef: React.RefObject<HTMLDivElement | null>;
    showColumnMenu: boolean;
    setShowColumnMenu: React.Dispatch<React.SetStateAction<boolean>>;
    columnMenuPosition: { top: number; left: number };
    setColumnMenuPosition: React.Dispatch<
        React.SetStateAction<{ top: number; left: number }>
    >;
    positionColumnMenuItems: PositionColumnMenuItem[];
    positionColumnVisible: (column: keyof PositionVisibleColumns) => boolean;
    toggleColumn: (column: keyof PositionVisibleColumns) => void;
    handleSort: (column: SortColumn) => void;
    isPortfolioReviewMode: boolean;
    adjustmentEditable?: boolean;
};

export function PositionHeaderCell(props: PositionHeaderCellProps) {
    const header = renderHeaderContent(props);
    return React.cloneElement(header, {
        'data-column-key': props.column.key,
        children: <>{header.props.children}{props.resizeHandle}</>,
    });
}

function renderHeaderContent({
    column,
    sortColumn,
    sortDirection,
    draggedPositionColumnKey,
    setDraggedPositionColumnKey,
    movePositionColumn,
    columnMenuRef,
    columnMenuPanelRef,
    showColumnMenu,
    setShowColumnMenu,
    columnMenuPosition,
    setColumnMenuPosition,
    positionColumnMenuItems,
    positionColumnVisible,
    toggleColumn,
    handleSort,
    isPortfolioReviewMode,
    adjustmentEditable = false,
    resetColumnWidths,
}: PositionHeaderCellProps) {
    const sortableLabel = (
        label: string,
        sortKey?: SortColumn,
        extra?: React.ReactNode,
    ) => (
        <>
            {extra}
            <span>{label}</span>
            {sortKey && sortColumn === sortKey
                ? sortDirection === 'desc'
                    ? ' ↓'
                    : ' ↑'
                : null}
        </>
    );
    const dragProps =
        column.key !== 'name'
            ? {
                  draggable: true,
                  onDragStart: (
                      event: React.DragEvent<HTMLTableCellElement>,
                  ) => {
                      setDraggedPositionColumnKey(column.key);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('positionColumnKey', column.key);
                  },
                  onDragOver: (
                      event: React.DragEvent<HTMLTableCellElement>,
                  ) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                  },
                  onDrop: (event: React.DragEvent<HTMLTableCellElement>) => {
                      event.preventDefault();
                      const sourceKey =
                          (event.dataTransfer.getData(
                              'positionColumnKey',
                          ) as PositionGridColumnKey) ||
                          draggedPositionColumnKey;
                      if (sourceKey) {
                          movePositionColumn(sourceKey, column.key);
                      }
                      setDraggedPositionColumnKey(null);
                  },
                  onDragEnd: () => setDraggedPositionColumnKey(null),
              }
            : {};
    const dragClass = column.key !== 'name' ? ' cursor-move' : '';

    if (column.key === 'name') {
        return (
            <th
                key={column.key}
                className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
            >
                <div className="flex items-center justify-center gap-2">
                    <div
                        ref={columnMenuRef}
                        className="relative inline-flex items-center"
                    >
                        <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                                event.stopPropagation();
                                if (showColumnMenu) {
                                    setShowColumnMenu(false);
                                    return;
                                }
                                const rect =
                                    event.currentTarget.getBoundingClientRect();
                                setColumnMenuPosition({
                                    top: rect.bottom + 4,
                                    left: rect.left,
                                });
                                setShowColumnMenu(true);
                            }}
                            title="Choose visible columns"
                        >
                            ≡
                        </button>
                        {showColumnMenu && (
                            <div
                                ref={columnMenuPanelRef}
                                className="fixed z-[120] min-w-[10rem] rounded border border-border bg-background p-2 text-left shadow-xl"
                                style={{
                                    top: columnMenuPosition.top,
                                    left: columnMenuPosition.left,
                                }}
                            >
                                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                                    Columns
                                </div>
                                <div className="space-y-1">
                                    {positionColumnMenuItems.map((item) => {
                                        const fixed = item.fixed;
                                        const checked = item.visibleKey
                                            ? positionColumnVisible(item.visibleKey)
                                            : true;
                                        return (
                                            <label
                                                key={item.key}
                                                className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11px] ${
                                                    fixed
                                                        ? 'text-muted-foreground'
                                                        : 'cursor-pointer hover:bg-muted/30'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={fixed}
                                                    onChange={() => {
                                                        if (item.visibleKey) {
                                                            toggleColumn(
                                                                item.visibleKey,
                                                            );
                                                        }
                                                    }}
                                                    className={
                                                        fixed
                                                            ? 'cursor-default opacity-60'
                                                            : 'cursor-pointer'
                                                    }
                                                />
                                                <span>{item.label}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                                <button type="button" className="position-column-reset"
                                    onClick={event => {
                                        event.stopPropagation();
                                        resetColumnWidths();
                                        setShowColumnMenu(false);
                                    }}>
                                    <RotateCcw size={14} aria-hidden="true" />
                                    Reset column widths
                                </button>
                            </div>
                        )}
                    </div>
                    <span
                        className="cursor-pointer hover:text-primary"
                        onClick={() => handleSort('NAME')}
                    >
                        NAME{' '}
                        {sortColumn === 'NAME' &&
                            (sortDirection === 'desc' ? '↓' : '↑')}
                    </span>
                </div>
            </th>
        );
    }

    const baseClass = `text-center pb-2 px-1 font-medium tracking-wide border-r border-border/30 hover:text-primary${dragClass}`;
    switch (column.key) {
        case 'modelWeight':
            return <th key={column.key} {...dragProps} className={baseClass}
                onClick={() => handleSort('MODEL_WEIGHT')}
                title="Model-derived allocation across current holdings, after ETF allocation.">
                <span className="inline-flex items-center gap-0.5">{sortableLabel('Ideal wt', 'MODEL_WEIGHT')}<WeightPolicyControl /></span>
            </th>;
        case 'classPercent':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={`review-header-cell ${baseClass}`}
                    onClick={() => handleSort('CLASS_PERCENT')}
                >
                    {sortableLabel('CLASS %', 'CLASS_PERCENT')}
                </th>
            );
        case 'asset':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('ASSET_CLASS')}
                >
                    {sortableLabel('ASSET', 'ASSET_CLASS')}
                </th>
            );
        case 'cdf':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('CDF')}
                >
                    {sortableLabel('TREND', 'CDF')}
                </th>
            );
        case 'atr':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('ATR')}
                >
                    {sortableLabel('ACTION', 'ATR')}
                </th>
            );
        case 'dca':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('DCA')}
                >
                    {sortableLabel('DCA', 'DCA')}
                </th>
            );
        case 'price':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('PRICE')}
                >
                    {sortableLabel('PRICE', 'PRICE')}
                </th>
            );
        case 'bookValue':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('BOOK_VALUE')}
                >
                    {sortableLabel('BOOK VALUE', 'BOOK_VALUE')}
                </th>
            );
        case 'mktValue':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('VALUE')}
                >
                    {sortableLabel(isPortfolioReviewMode ? 'Held' : 'VALUE', 'VALUE')}
                </th>
            );
        case 'targetAdjustment':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={`review-header-cell ${baseClass}`}
                    title="Required reduction at asset-class level; proportional guide for individual stocks"
                >
                    Required / guide
                </th>
            );
        case 'targetMovePct':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={`review-header-cell ${baseClass}`}
                    title="Target adjustment as a percentage of this row value"
                >
                    Guide %
                </th>
            );
        case 'reduction':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={`review-reduce-header ${baseClass}`}
                    title={adjustmentEditable ? 'Record the reduction you executed; placeholder amounts are suggestions only' : 'Recorded execution, not broker verification'}
                >
                    {adjustmentEditable ? 'Record reduction' : 'Recorded'}
                </th>
            );
        case 'remaining':
            return <th key={column.key} {...dragProps} className={baseClass}
                title="Remaining reduction requirement at asset-class level">Remaining</th>;
        case 'expected':
        case 'imported':
        case 'variance':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={`${baseClass} review-header-cell ${
                        column.key === 'variance'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                    }`}
                >
                    {column.key === 'expected' ? 'Expected' : column.key === 'imported' ? 'Statement' : 'Difference'}
                </th>
            );
        case 'reduce':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('CASH')}
                >
                    {sortableLabel('CASH', 'CASH')}
                </th>
            );
        case 'exposurePercent':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('EXPOSURE_PERCENT')}
                    title="Market-exposed value divided by total sleeve capital"
                >
                    {sortableLabel(
                        isPortfolioReviewMode ? 'EXPOSURE %' : 'EXP%',
                        'EXPOSURE_PERCENT',
                    )}
                </th>
            );
        case 'qty':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('QTY')}
                >
                    {sortableLabel('QTY', 'QTY')}
                </th>
            );
        case 'plDollar':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('PL_DOLLAR')}
                >
                    {sortableLabel('P/L$', 'PL_DOLLAR')}
                </th>
            );
        case 'plPercent':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={baseClass}
                    onClick={() => handleSort('PL_PERCENT')}
                >
                    {sortableLabel('P/L%', 'PL_PERCENT')}
                </th>
            );
        case 'portfolioPercent':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={`review-header-cell ${baseClass} text-white hover:text-sky-100`}
                    onClick={() => handleSort('PORTFOLIO_PERCENT')}
                >
                    {sortableLabel('PORTFOLIO %', 'PORTFOLIO_PERCENT')}
                </th>
            );
        case 'currentReduction':
            return (
                <th
                    key={column.key}
                    {...dragProps}
                    className={`review-header-cell ${baseClass}`}
                    title="Current adjustment as a percentage of this row value"
                >
                    Recorded %
                </th>
            );
        default:
            return <th key={column.key} {...dragProps} className={baseClass} />;
    }
}
