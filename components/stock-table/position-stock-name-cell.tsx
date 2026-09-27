import type { MouseEventHandler } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { AlertStatusIndicator } from '@/components/alert-status-indicator';
import { useStockTableContext } from '@/components/stock-table/stock-table-context';
import {
    COMMODITY_THEME_STATUS_BAR_SLOT_CLASS,
    CommodityThemeStatusBar,
} from '@/components/commodity-theme-path-indicator';
import type { Stock } from '@/lib/store';
import type { CommodityThemeStatus } from '@/lib/api';

type PositionStockNameCellProps = {
    stock: Stock;
    hierarchyDepth: number;
    isPortfolioReviewMode: boolean;
    canOpenDetails: boolean;
    showStats: boolean;
    breakoutDaysLeft: number | null;
    breakoutExpiryDate: Date | null;
    isCoreETF: boolean;
    coreETFRatioLabel: string | null;
    outperformStatus?: CommodityThemeStatus;
    isNonAllocating: boolean;
    nonAllocatingUpdating: boolean;
    onToggleNonAllocating: MouseEventHandler<HTMLButtonElement>;
};

export function PositionStockNameCell({
    stock,
    hierarchyDepth,
    isPortfolioReviewMode,
    canOpenDetails,
    showStats,
    breakoutDaysLeft,
    breakoutExpiryDate,
    isCoreETF,
    coreETFRatioLabel,
    outperformStatus,
    isNonAllocating,
    nonAllocatingUpdating,
    onToggleNonAllocating,
}: PositionStockNameCellProps) {
    const isETF = isCoreETF || String(stock.securityType || '').toUpperCase() === 'ETF';
    const { monitoringBenchmarks } = useStockTableContext();
    return (
        <td
            className="h-[26px] py-0 border-r border-border/30 align-middle"
            style={{
                paddingLeft:
                    hierarchyDepth > 0
                        ? `${hierarchyDepth * 16}px`
                        : undefined,
                maxWidth: isPortfolioReviewMode ? '8rem' : '14rem',
                width: isPortfolioReviewMode ? '8rem' : '14rem',
            }}
            title={canOpenDetails ? 'Double-click to open security details' : undefined}
        >
            <div className="flex h-[26px] items-center gap-2">
                <span
                    className="text-muted-foreground cursor-move"
                    title="Drag to move to group"
                >
                    ⋮⋮
                </span>
                {stock.symbol && stock.prefix + stock.symbol ? (
                    <AlertStatusIndicator
                        ticker={(stock.prefix || '') + stock.symbol}
                        mode="position"
                        securityType={isETF ? 'ETF' : stock.securityType}
                        outperformBenchmark={monitoringBenchmarks
                            ? monitoringBenchmarks.get(stock.primaryAssetClass?.trim().toUpperCase() || '') ?? null
                            : undefined}
                        className="mr-1"
                    />
                ) : (
                    <div
                        className="inline-flex items-center justify-center mr-1"
                        title="No ticker mapping — set ticker in Alerts tab"
                    >
                        <div
                            className="bg-muted/50"
                            style={{
                                width: 'calc(var(--spacing) * 2)',
                                height: 'calc(var(--spacing) * 6)',
                                borderRadius: '30%',
                            }}
                        />
                    </div>
                )}
                <div className="flex min-w-0 flex-1 items-center gap-1">
                    <span
                        className="min-w-0 max-w-full shrink truncate overflow-hidden text-foreground font-mono text-[11px] font-light tracking-wide"
                        title={stock.name}
                    >
                        {stock.name}
                    </span>
                    {isCoreETF && coreETFRatioLabel ? (
                        <span
                            className="positions-core-etf-chip"
                            title={`Core ETF · ${coreETFRatioLabel} of asset-class target`}
                        >
                            {coreETFRatioLabel}
                        </span>
                    ) : null}
                    {outperformStatus ? (
                        <span
                            className={`ml-2 ${COMMODITY_THEME_STATUS_BAR_SLOT_CLASS}`}
                            title={outperformStatus === 'CONFIRMED' ? 'Outperformance' : 'Underperformance'}
                            aria-label={outperformStatus === 'CONFIRMED' ? 'Outperformance' : 'Underperformance'}
                        >
                            <CommodityThemeStatusBar status={outperformStatus} />
                        </span>
                    ) : null}
                    {!isETF ? (
                        <button
                            type="button"
                            onClick={onToggleNonAllocating}
                            disabled={nonAllocatingUpdating}
                            className={`ml-auto grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[2px] text-muted-foreground transition-[opacity,color,background-color] duration-100 hover:bg-muted/25 hover:text-foreground disabled:opacity-40 ${
                                isNonAllocating
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                            }`}
                            aria-label={
                                isNonAllocating
                                    ? 'Return instrument to strategy'
                                    : 'Exclude instrument from strategy'
                            }
                            title={
                                isNonAllocating
                                    ? 'Return to strategy'
                                    : 'Exclude from strategy'
                            }
                        >
                            {isNonAllocating ? (
                                <RotateCcw size={11} aria-hidden="true" />
                            ) : (
                                <Archive size={11} aria-hidden="true" />
                            )}
                        </button>
                    ) : null}
                </div>
                {showStats &&
                breakoutDaysLeft !== null &&
                breakoutExpiryDate !== null ? (
                    <span
                        className={`ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded ${
                            breakoutDaysLeft <= 7
                                ? 'text-destructive animate-pulse'
                                : breakoutDaysLeft <= 14
                                  ? 'text-caution'
                                  : 'text-primary'
                        } bg-black/50 border border-current`}
                        title={`Breakout expires ${breakoutExpiryDate.toLocaleDateString()}`}
                    >
                        ⚡ {breakoutDaysLeft}d
                    </span>
                ) : null}
            </div>
        </td>
    );
}
