import React from 'react';
import {
    LEGACY_POSITION_COLUMN_WIDTHS_STORAGE_KEY, POSITION_COLUMN_WIDTHS_STORAGE_KEY,
    type PositionGridColumn, type PositionGridColumnKey,
} from './columns';
import { ResizableGrid } from './resizable-grid';

export type PositionGridHeaderControls = {
    resizeHandle: React.ReactNode;
    resetColumnWidths: () => void;
};

type PositionGridProps = {
    columns: PositionGridColumn[];
    widthScope: string;
    containerClassName?: string;
    tableClassName: string;
    renderHeaderCell: (column: PositionGridColumn, controls: PositionGridHeaderControls) => React.ReactNode;
    children: React.ReactNode;
};

const columnNames: Record<PositionGridColumnKey, string> = {
    name: 'Name', classPercent: 'Class percentage', modelWeight: 'Ideal weight', asset: 'Asset class',
    cdf: 'Trend', atr: 'Action', dca: 'DCA', price: 'Price', bookValue: 'Book value',
    mktValue: 'Value', targetAdjustment: 'Required reduction', targetMovePct: 'Guide percentage',
    reduction: 'Recorded reduction', remaining: 'Remaining', expected: 'Expected',
    imported: 'Statement', variance: 'Difference', reduce: 'Cash', exposurePercent: 'Exposure percentage',
    qty: 'Quantity', plDollar: 'Profit and loss', plPercent: 'Profit and loss percentage',
    portfolioPercent: 'Portfolio percentage', currentReduction: 'Recorded percentage',
};

export function PositionGrid({
    columns, widthScope, containerClassName = '', tableClassName, renderHeaderCell, children,
}: PositionGridProps) {
    return (
        <ResizableGrid
            columns={columns}
            widthScope={widthScope}
            storageKey={POSITION_COLUMN_WIDTHS_STORAGE_KEY}
            legacyStorageKey={LEGACY_POSITION_COLUMN_WIDTHS_STORAGE_KEY}
            columnNames={columnNames}
            containerClassName={`position-grid-scroll ${containerClassName}`}
            tableClassName={tableClassName}
            renderHeader={(visibleColumns, controls) => (
                <tr className="text-foreground border-b border-border">
                    {visibleColumns.map(column => renderHeaderCell(column, {
                        resizeHandle: controls.resizeHandle(column.key),
                        resetColumnWidths: controls.resetColumnWidths,
                    }))}
                </tr>
            )}
        >
            {children}
        </ResizableGrid>
    );
}
