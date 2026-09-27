import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
    Check,
    ChevronDown,
    ChevronUp,
    Layers3,
    LayoutGrid,
    SlidersHorizontal,
    SquareMinus,
    SquarePlus,
    Table2,
} from 'lucide-react';
import type { PositionsPresentation } from '@/lib/positions-capital-map';
import { usePositionRowAppearanceSync } from '@/lib/position-row-appearance-store';
import styles from './positions-toolbar.module.css';
import type {
    PositionAssetClassOrder,
    PositionAssetClassOrderDirection,
    PortfolioFocusMode,
    PositionsMode,
    TabType,
} from './types';

type PositionsToolbarProps = {
    activeTab: TabType;
    isPortfolioRebalanceMode: boolean;
    positionsMode: PositionsMode;
    positionsPresentation: PositionsPresentation;
    onSetPositionsPresentation: (view: PositionsPresentation) => void;
    hasAdjustmentCallToAction: boolean;
    adjustmentCallToActionCount: number;
    groupingEnabled: boolean;
    showGroupManager: boolean;
    showPositionVisibilityControls: boolean;
    positionStatsPeekEnabled: boolean;
    positionStatsPeekMode: boolean;
    fixedQ1StatsVisible: boolean;
    fixedGroupStatsVisible: boolean;
    fixedStockStatsVisible: boolean;
    positionAssetClassOrder: PositionAssetClassOrder;
    positionAssetClassOrderDirection: PositionAssetClassOrderDirection;
    portfolioFocusMode: PortfolioFocusMode;
    showPortfolioBucketRows: boolean;
    showPositionBucketRows: boolean;
    positionTableGroupingEnabled: boolean;
    portfolioPureSort: boolean;
    positionGroupsAllCollapsed: boolean;
    showNonAllocatingInstruments: boolean;
    onSetPositionsMode: (mode: PositionsMode) => void;
    onToggleGrouping: () => void;
    onToggleGroupManager: () => void;
    onTogglePeekMode: () => void;
    onToggleQ1Stats: () => void;
    onToggleGroupStats: () => void;
    onToggleStockStats: () => void;
    onSetPositionAssetClassOrder: (order: PositionAssetClassOrder) => void;
    onTogglePortfolioFocusMode: () => void;
    onTogglePortfolioBucketRows: () => void;
    onTogglePositionBucketRows: () => void;
    onTogglePortfolioPureSort: () => void;
    onToggleAllPositionGroupsCollapsed: () => void;
    onToggleNonAllocatingInstruments: () => void;
};

export function PositionsToolbar({
    activeTab,
    isPortfolioRebalanceMode,
    positionsMode,
    positionsPresentation,
    onSetPositionsPresentation,
    hasAdjustmentCallToAction,
    adjustmentCallToActionCount,
    groupingEnabled,
    showGroupManager,
    showPositionVisibilityControls,
    positionStatsPeekEnabled,
    positionStatsPeekMode,
    fixedQ1StatsVisible,
    fixedGroupStatsVisible,
    fixedStockStatsVisible,
    positionAssetClassOrder,
    positionAssetClassOrderDirection,
    portfolioFocusMode,
    showPortfolioBucketRows,
    showPositionBucketRows,
    positionTableGroupingEnabled,
    portfolioPureSort,
    positionGroupsAllCollapsed,
    showNonAllocatingInstruments,
    onSetPositionsMode,
    onToggleGroupManager,
    onTogglePeekMode,
    onToggleQ1Stats,
    onToggleGroupStats,
    onToggleStockStats,
    onSetPositionAssetClassOrder,
    onTogglePortfolioFocusMode,
    onTogglePortfolioBucketRows,
    onTogglePositionBucketRows,
    onTogglePortfolioPureSort,
    onToggleAllPositionGroupsCollapsed,
    onToggleNonAllocatingInstruments,
}: PositionsToolbarProps) {
    const [viewMenuOpen, setViewMenuOpen] = useState(false);
    usePositionRowAppearanceSync();
    const inactiveButtonClass =
        'text-muted-foreground hover:bg-muted/20 hover:text-foreground';
    const activeButtonClass = 'bg-muted/10 text-foreground';
    const assetClassOrderOptions: Array<{
        value: PositionAssetClassOrder;
        label: string;
    }> = [
        { value: 'saved', label: 'Saved order' },
        { value: 'target', label: 'Target %' },
        { value: 'current', label: 'Current %' },
        { value: 'drift', label: 'Absolute drift' },
    ];

    return (
        <div className="flex min-w-0 items-center justify-end gap-2">
            {activeTab === 'POSITIONS' && (
                <div className="relative inline-flex w-[8.75rem] flex-shrink-0 items-center rounded bg-muted/10">
                    <button
                        onClick={() => onSetPositionsMode('normal')}
                        className={`flex-1 rounded-l px-2.5 py-1 text-[11px] font-mono tracking-wide transition-colors ${
                            positionsMode === 'normal'
                                ? 'bg-foreground text-background'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
                        }`}
                    >
                        NORMAL
                    </button>
                    <button
                        onClick={() => {
                            if (!hasAdjustmentCallToAction) return;
                            onSetPositionsMode('review');
                        }}
                        data-testid="positions-actions-tab"
                        disabled={!hasAdjustmentCallToAction}
                        className={`relative flex-1 rounded-r px-2.5 py-1 text-[11px] font-mono tracking-wide transition-colors ${
                            positionsMode === 'review'
                                ? 'bg-foreground text-background'
                                : hasAdjustmentCallToAction
                                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
                                  : 'cursor-not-allowed text-muted-foreground/35'
                        }`}
                        title={
                            hasAdjustmentCallToAction
                                ? `${adjustmentCallToActionCount} active action${
                                      adjustmentCallToActionCount === 1
                                          ? ''
                                          : 's'
                                  }`
                                : 'No active actions'
                        }
                        aria-disabled={!hasAdjustmentCallToAction}
                    >
                        ACTIONS
                        {hasAdjustmentCallToAction && (
                            <span
                                className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-destructive bg-destructive px-1 text-[11px] font-bold leading-none text-background"
                                aria-label={`${adjustmentCallToActionCount} active action${
                                    adjustmentCallToActionCount === 1
                                        ? ''
                                        : 's'
                                }`}
                            >
                                !
                            </span>
                        )}
                    </button>
                </div>
            )}

            {activeTab === 'POSITIONS' && positionsMode === 'normal' && (
                <div className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border/60 p-0.5" role="group" aria-label="Positions display">
                    {([{ value: 'table', label: 'Table view', Icon: Table2 }, { value: 'simple', label: 'Simple view', Icon: LayoutGrid }] as const).map(({ value, label, Icon }) => (
                        <button key={value} type="button" title={label} aria-label={label} aria-pressed={positionsPresentation === value}
                            onClick={() => onSetPositionsPresentation(value)}
                            className={`inline-flex h-7 w-8 items-center justify-center rounded-sm ${positionsPresentation === value ? activeButtonClass : inactiveButtonClass}`}>
                            <Icon size={17} aria-hidden="true" />
                        </button>
                    ))}
                </div>
            )}

            {showPositionVisibilityControls && !(activeTab === 'POSITIONS' && positionsMode === 'normal' && positionsPresentation === 'simple') && (
                <>
                <Popover.Root open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            data-testid="positions-view-menu-trigger"
                            className={`${styles.toolbarButton} ${
                                viewMenuOpen
                                    ? activeButtonClass
                                    : inactiveButtonClass
                            }`}
                            aria-label="Position view options"
                            title="Position view options"
                        >
                            <SlidersHorizontal
                                className="h-[16.5px] w-[16.5px]"
                                aria-hidden="true"
                            />
                        </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content
                            align="end"
                            side="bottom"
                            sideOffset={7}
                            collisionPadding={10}
                            className={styles.menu}
                            aria-label="Position view options"
                            data-testid="positions-view-menu"
                        >
                            {activeTab === 'POSITIONS' &&
                                positionsMode === 'normal' &&
                                groupingEnabled && (
                                    <>
                                        <section className={styles.section}>
                                            <h3 className={styles.heading}>
                                                Asset-class order
                                            </h3>
                                            <div className={styles.orderList}>
                                                {assetClassOrderOptions.map(
                                                    (option) => {
                                                        const active =
                                                            positionAssetClassOrder ===
                                                            option.value;
                                                        return (
                                                            <button
                                                                key={option.value}
                                                                type="button"
                                                                data-testid={`positions-order-${option.value}`}
                                                                onClick={() =>
                                                                    onSetPositionAssetClassOrder(
                                                                        option.value,
                                                                    )
                                                                }
                                                                className={styles.orderOption}
                                                                aria-pressed={active}
                                                                title={
                                                                    active &&
                                                                    option.value !==
                                                                        'saved'
                                                                        ? 'Select again to reverse direction'
                                                                        : undefined
                                                                }
                                                            >
                                                                <span className="grid place-items-center">
                                                                    {active && (
                                                                        <Check
                                                                            size={16}
                                                                            aria-hidden="true"
                                                                        />
                                                                    )}
                                                                </span>
                                                                <span>
                                                                    {option.label}
                                                                </span>
                                                                <span className="grid place-items-center text-muted-foreground">
                                                                    {active &&
                                                                    option.value !==
                                                                        'saved' ? (
                                                                        positionAssetClassOrderDirection ===
                                                                        'desc' ? (
                                                                            <ChevronDown
                                                                                size={16}
                                                                                aria-label="Descending"
                                                                            />
                                                                        ) : (
                                                                            <ChevronUp
                                                                                size={16}
                                                                                aria-label="Ascending"
                                                                            />
                                                                        )
                                                                    ) : null}
                                                                </span>
                                                            </button>
                                                        );
                                                    },
                                                )}
                                            </div>
                                        </section>
                                    </>
                                )}

                            {activeTab === 'POSITIONS' &&
                                positionsMode === 'normal' && (
                                    <section className={styles.section}>
                                        <h3 className={styles.heading}>
                                            Row behavior
                                        </h3>
                                        <div className={styles.segments} role="group" aria-label="Row behavior">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!positionStatsPeekEnabled) {
                                                        onTogglePeekMode();
                                                    }
                                                }}
                                                aria-pressed={positionStatsPeekEnabled}
                                            >
                                                Peek
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (positionStatsPeekEnabled) {
                                                        onTogglePeekMode();
                                                    }
                                                }}
                                                aria-pressed={!positionStatsPeekEnabled}
                                            >
                                                Fixed
                                            </button>
                                        </div>
                                    </section>
                                )}

                            <section className={styles.section}>
                                <h3 className={styles.heading}>
                                    Visible rows
                                </h3>
                                <label className={styles.checkRow}>
                                    <span>Q1 summary</span>
                                    <input
                                        type="checkbox"
                                        checked={fixedQ1StatsVisible}
                                        onChange={onToggleQ1Stats}
                                    />
                                </label>
                                {!positionStatsPeekMode && (
                                    <>
                                        <label className={styles.checkRow}>
                                            <span>
                                                Group values
                                            </span>
                                            <input
                                                type="checkbox"
                                                checked={fixedGroupStatsVisible}
                                                onChange={onToggleGroupStats}
                                            />
                                        </label>
                                        <label className={styles.checkRow}>
                                            <span>
                                                Stock values
                                            </span>
                                            <input
                                                type="checkbox"
                                                checked={fixedStockStatsVisible}
                                                onChange={onToggleStockStats}
                                            />
                                        </label>
                                    </>
                                )}
                                {activeTab === 'POSITIONS' &&
                                    positionsMode === 'normal' && (
                                        <label className={styles.checkRow}>
                                            <span>
                                                Excluded instruments
                                            </span>
                                            <input
                                                type="checkbox"
                                                checked={showNonAllocatingInstruments}
                                                onChange={onToggleNonAllocatingInstruments}
                                            />
                                        </label>
                                    )}
                                {isPortfolioRebalanceMode && (
                                    <label className={styles.checkRow}>
                                        <span>Q1 sections</span>
                                        <input
                                            type="checkbox"
                                            checked={showPortfolioBucketRows}
                                            onChange={onTogglePortfolioBucketRows}
                                        />
                                    </label>
                                )}
                                {!isPortfolioRebalanceMode &&
                                    positionTableGroupingEnabled && (
                                        <label className={styles.checkRow}>
                                            <span>
                                                Q1 sections
                                            </span>
                                            <input
                                                type="checkbox"
                                                checked={showPositionBucketRows}
                                                onChange={onTogglePositionBucketRows}
                                            />
                                        </label>
                                    )}
                            </section>

                            {isPortfolioRebalanceMode && (
                                <section className={styles.section}>
                                    <button
                                        type="button"
                                        onClick={onTogglePortfolioFocusMode}
                                        className={styles.command}
                                    >
                                        <span>Color focus</span>
                                        <span>
                                            {portfolioFocusMode === 'hover'
                                                ? 'Hover'
                                                : 'Click'}
                                        </span>
                                    </button>
                                    {!showPortfolioBucketRows && (
                                        <button
                                            type="button"
                                            onClick={onTogglePortfolioPureSort}
                                            className={styles.command}
                                        >
                                            <span>Portfolio order</span>
                                            <span>
                                                {portfolioPureSort
                                                    ? 'Pure'
                                                    : 'Q1'}
                                            </span>
                                        </button>
                                    )}
                                </section>
                            )}

                            {activeTab === 'POSITIONS' &&
                                positionsMode === 'normal' && (
                                <section className={styles.section}>
                                    <Popover.Close asChild>
                                        <button
                                            type="button"
                                            onClick={onToggleGroupManager}
                                            className={`${styles.command} ${styles.groupCommand}`}
                                            aria-pressed={showGroupManager}
                                        >
                                            <Layers3
                                                size={16}
                                                aria-hidden="true"
                                            />
                                            Groups
                                        </button>
                                    </Popover.Close>
                                </section>
                            )}
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
                <button
                    type="button"
                    data-testid="positions-groups-collapse-toggle"
                    onClick={onToggleAllPositionGroupsCollapsed}
                    className={`${styles.toolbarButton} ${inactiveButtonClass}`}
                    aria-label={
                        positionGroupsAllCollapsed
                            ? 'Expand all groups'
                            : 'Collapse all groups'
                    }
                    title={
                        positionGroupsAllCollapsed
                            ? 'Expand all groups'
                            : 'Collapse all groups'
                    }
                >
                    {positionGroupsAllCollapsed ? (
                        <SquarePlus
                            className="h-[16.5px] w-[16.5px]"
                            aria-hidden="true"
                        />
                    ) : (
                        <SquareMinus
                            className="h-[16.5px] w-[16.5px]"
                            aria-hidden="true"
                        />
                    )}
                </button>
                </>
            )}
        </div>
    );
}
