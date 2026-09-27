import type { CSSProperties, DragEventHandler, MouseEventHandler, ReactNode } from 'react';
import type { Stock } from '@/lib/store';
import type { CommodityThemeStatus } from '@/lib/api';
import { PositionStockNameCell } from './position-stock-name-cell';
import { usePositionRiskRow } from './position-risk-group';

type PositionStockRowProps = {
    stock: Stock;
    hierarchyDepth: number;
    isPortfolioReviewMode: boolean;
    isPositionsTab: boolean;
    className: string;
    style?: CSSProperties;
    canOpenDetails: boolean;
    showStats: boolean;
    breakoutDaysLeft: number | null;
    breakoutExpiryDate: Date | null;
    isCoreETF: boolean;
    coreETFRatioLabel: string | null;
    outperformStatus?: CommodityThemeStatus;
    isNonAllocating: boolean;
    nonAllocatingUpdating: boolean;
    onClick: MouseEventHandler<HTMLTableRowElement>;
    onDragStart: DragEventHandler<HTMLTableRowElement>;
    onOpenDetails: () => void;
    onToggleNonAllocating: MouseEventHandler<HTMLButtonElement>;
    children: ReactNode;
};

export function PositionStockRow({
    stock,
    hierarchyDepth,
    isPortfolioReviewMode,
    isPositionsTab,
    className,
    style,
    canOpenDetails,
    showStats,
    breakoutDaysLeft,
    breakoutExpiryDate,
    isCoreETF,
    coreETFRatioLabel,
    outperformStatus,
    isNonAllocating,
    nonAllocatingUpdating,
    onClick,
    onDragStart,
    onOpenDetails,
    onToggleNonAllocating,
    children,
}: PositionStockRowProps) {
    const riskRow = usePositionRiskRow();
    const isOutperforming = outperformStatus === 'CONFIRMED'
        && !isCoreETF && stock.securityType?.toUpperCase() !== 'ETF';
    return (
        <tr
            {...riskRow}
            data-stock-id={stock.id}
            className={`positions-stock-row group h-[26px] border-b border-border/[0.85] transition-[background-color,border-color,box-shadow] ${
                isPortfolioReviewMode || isPositionsTab ? 'cursor-pointer' : ''
            }${isCoreETF ? ' is-core-etf' : ''}${isOutperforming ? ' is-outperforming' : ''}${className}`}
            style={riskRow['data-risk-group'] ? {
                ...style,
                opacity: 1,
                '--position-row-opacity': style?.opacity ?? 1,
            } as CSSProperties : style}
            onClick={onClick}
            onDoubleClick={event => {
                if (!canOpenDetails || (event.target as HTMLElement).closest('button, a, input, select, [role="button"]')) return;
                event.stopPropagation();
                onOpenDetails();
            }}
            tabIndex={canOpenDetails ? 0 : undefined}
            onKeyDown={event => {
                if (canOpenDetails && event.target === event.currentTarget && event.key === 'Enter') {
                    event.preventDefault();
                    onOpenDetails();
                }
            }}
            draggable
            onDragStart={onDragStart}
        >
            <PositionStockNameCell
                stock={stock}
                hierarchyDepth={hierarchyDepth}
                isPortfolioReviewMode={isPortfolioReviewMode}
                canOpenDetails={canOpenDetails}
                showStats={showStats}
                breakoutDaysLeft={breakoutDaysLeft}
                breakoutExpiryDate={breakoutExpiryDate}
                isCoreETF={isCoreETF}
                coreETFRatioLabel={coreETFRatioLabel}
                outperformStatus={outperformStatus}
                isNonAllocating={isNonAllocating}
                nonAllocatingUpdating={nonAllocatingUpdating}
                onToggleNonAllocating={onToggleNonAllocating}
            />
            {children}
        </tr>
    );
}
