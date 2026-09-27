import type {
    CSSProperties,
    DragEventHandler,
    MouseEventHandler,
    ReactNode,
} from 'react';
import { assetClassColor } from '@/lib/asset-class-identity';
import { PositionRowIconPicker } from './position-row-icon-picker';
import appearanceStyles from './position-row-appearance.module.css';
import { usePositionRiskRow } from './position-risk-group';

const nameCellWidthStyle = (
    isPortfolioReviewMode: boolean,
    paddingLeft?: number | string,
): CSSProperties => ({
    paddingLeft,
    maxWidth: isPortfolioReviewMode ? '8rem' : '14rem',
    width: isPortfolioReviewMode ? '8rem' : '14rem',
});

type PositionAggregateRowEvents = {
    onMouseEnter?: MouseEventHandler<HTMLTableRowElement>;
    onMouseLeave?: MouseEventHandler<HTMLTableRowElement>;
    onClick?: MouseEventHandler<HTMLTableRowElement>;
    onDragStart?: DragEventHandler<HTMLTableRowElement>;
    onDragOver?: DragEventHandler<HTMLTableRowElement>;
    onDragLeave?: DragEventHandler<HTMLTableRowElement>;
    onDrop?: DragEventHandler<HTMLTableRowElement>;
    onDragEnd?: DragEventHandler<HTMLTableRowElement>;
};

export function PositionBucketAggregateRow({
    portfolioAssetClassRow,
    assetClassCode,
    className,
    isPortfolioReviewMode,
    depth,
    label,
    collapsed,
    showChildren,
    onMouseEnter,
    onMouseLeave,
    onNameClick,
    children,
}: PositionAggregateRowEvents & {
    portfolioAssetClassRow: boolean;
    assetClassCode?: string | null;
    className: string;
    isPortfolioReviewMode: boolean;
    depth: number;
    label: string;
    collapsed: boolean;
    showChildren: boolean;
    onNameClick: MouseEventHandler<HTMLTableCellElement>;
    children: ReactNode;
}) {
    const riskRow = usePositionRiskRow();
    return (
        <tr
            {...riskRow}
            data-portfolio-asset-class-row={
                portfolioAssetClassRow ? 'true' : undefined
            }
            data-asset-class-code={assetClassCode || undefined}
            className={className}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <td
                className="py-1 cursor-pointer hover:bg-muted/20 border-r border-border/30 align-middle"
                onClick={onNameClick}
                style={nameCellWidthStyle(
                    isPortfolioReviewMode,
                    `${depth === 0 ? 4 : 8}px`,
                )}
            >
                <div className="flex items-center gap-1">
                    <span
                        className={`font-mono font-semibold tracking-widest text-foreground ${
                            depth === 0 ? 'text-[11px]' : 'text-[10px]'
                        }`}
                    >
                        {label}
                    </span>
                    {showChildren ? (
                        <span className="text-[10px] text-muted-foreground">
                            {collapsed ? '▶' : '▼'}
                        </span>
                    ) : null}
                </div>
            </td>
            {children}
        </tr>
    );
}

export function PositionPendingReserveRow({
    isPortfolioReviewMode,
    title,
    children,
}: {
    isPortfolioReviewMode: boolean;
    title: string;
    children: ReactNode;
}) {
    return (
        <tr className="border-l-4 border-l-sky-500/70 border-b border-border/50 bg-background/20 text-foreground">
            <td
                className="h-[26px] border-r border-border/30 align-middle"
                style={nameCellWidthStyle(isPortfolioReviewMode, '4px')}
                title={title}
            >
                <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-sky-200">
                        Pending Reserve
                    </span>
                </div>
            </td>
            {children}
        </tr>
    );
}

export function PositionPortfolioAggregateRow({
    assetClassCode,
    className,
    style,
    isPortfolioReviewMode,
    label,
    open,
    onMouseEnter,
    onMouseLeave,
    onClick,
    onNameClick,
    onDragOver,
    onDragLeave,
    onDrop,
    children,
}: PositionAggregateRowEvents & {
    assetClassCode: string;
    className: string;
    style?: CSSProperties;
    isPortfolioReviewMode: boolean;
    label: string;
    open: boolean;
    onNameClick: MouseEventHandler<HTMLTableCellElement>;
    children: ReactNode;
}) {
    return (
        <tr
            data-portfolio-asset-class-row="true"
            data-asset-class-code={assetClassCode}
            className={className}
            style={style}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <td
                className="py-[1px] cursor-pointer hover:bg-muted/20 border-r border-border/30 align-middle"
                onClick={onNameClick}
                style={nameCellWidthStyle(isPortfolioReviewMode, '8px')}
            >
                <span className="text-foreground font-bold text-xs">
                    {open ? '▼' : '▶'} {label}
                </span>
            </td>
            {children}
        </tr>
    );
}

export function PositionCashComponentRow({
    label,
    isPortfolioReviewMode,
    children,
}: {
    label: string;
    isPortfolioReviewMode: boolean;
    children: ReactNode;
}) {
    return (
        <tr className="border-b border-border/35 bg-background/10">
            <td
                className="py-[1px] border-r border-border/30 align-middle"
                style={nameCellWidthStyle(isPortfolioReviewMode, '24px')}
            >
                <span className="text-[11px] text-muted-foreground">
                    {label}
                </span>
            </td>
            {children}
        </tr>
    );
}

export function PositionGroupAggregateRow({
    assetClassCode,
    appearanceCode,
    className,
    style,
    isPortfolioReviewMode,
    depth,
    label,
    open,
    showSupplement,
    supplementLabel,
    supplementTitle,
    onMouseEnter,
    onMouseLeave,
    onClick,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onNameClick,
    children,
}: PositionAggregateRowEvents & {
    assetClassCode?: string | null;
    appearanceCode?: string | null;
    className: string;
    style?: CSSProperties;
    isPortfolioReviewMode: boolean;
    depth: number;
    label: string;
    open: boolean;
    showSupplement: boolean;
    supplementLabel: ReactNode;
    supplementTitle: string;
    onNameClick: MouseEventHandler<HTMLElement>;
    children: ReactNode;
}) {
    const riskRow = usePositionRiskRow();
    const appearanceStyle = appearanceCode ? {
        '--row-accent': assetClassColor(appearanceCode),
    } as CSSProperties : undefined;
    return (
        <tr
            {...riskRow}
            data-position-class={appearanceCode || undefined}
            data-portfolio-asset-class-row={assetClassCode ? 'true' : undefined}
            data-asset-class-code={assetClassCode || undefined}
            draggable
            className={`${className}${appearanceCode ? ` ${appearanceStyles.row}` : ''}`}
            style={{ ...style, ...appearanceStyle }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
        >
            <td
                className="py-[1px] cursor-pointer hover:bg-muted/20 border-r border-border/30 align-middle"
                onClick={onNameClick}
                style={nameCellWidthStyle(
                    isPortfolioReviewMode,
                    depth > 0 ? `${depth * 16}px` : '4px',
                )}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className={`shrink-0 text-foreground font-medium ${
                            depth > 0 ? 'text-[10px]' : 'text-xs'
                        }`}
                        draggable={false}
                    >
                        {!appearanceCode && <span>{open ? '▼' : '▶'}{' '}</span>}
                        <span>
                            {appearanceCode && <PositionRowIconPicker code={appearanceCode} label={label} expanded={open} onToggle={onNameClick} />}
                            <span data-position-class-label={appearanceCode || undefined}>{label}</span>
                        </span>
                    </span>
                    {showSupplement ? (
                        <span
                            className="min-w-0 truncate font-mono text-[10px] font-normal text-muted-foreground/70"
                            draggable={false}
                            title={supplementTitle}
                        >
                            {supplementLabel}
                        </span>
                    ) : null}
                </div>
            </td>
            {children}
        </tr>
    );
}

export function PositionUngroupedAggregateRow({
    portfolioAssetClassRow,
    assetClassCode,
    isPortfolioReviewMode,
    depth,
    onMouseEnter,
    onMouseLeave,
    onDragOver,
    onDragLeave,
    onDrop,
    children,
}: PositionAggregateRowEvents & {
    portfolioAssetClassRow: boolean;
    assetClassCode?: string | null;
    isPortfolioReviewMode: boolean;
    depth: number;
    children: ReactNode;
}) {
    const riskRow = usePositionRiskRow();
    return (
        <tr
            {...riskRow}
            data-portfolio-asset-class-row={
                portfolioAssetClassRow ? 'true' : undefined
            }
            data-asset-class-code={assetClassCode || undefined}
            className="bg-muted/5 border-b border-border/40"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <td
                className="py-1 border-r border-border/30"
                style={nameCellWidthStyle(
                    isPortfolioReviewMode,
                    depth > 0 ? `${depth * 16}px` : undefined,
                )}
            >
                <span className="text-muted-foreground text-[10px] font-semibold">
                    • UNGROUPED
                </span>
            </td>
            {children}
        </tr>
    );
}
