import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { UsePortfolioOverlayResult } from '@/components/stock-table/hooks/use-portfolio-overlay';
import type { UsePortfolioRebalanceResult } from '@/components/stock-table/hooks/use-portfolio-rebalance';
import type { UsePortfolioMemoResult } from '@/components/stock-table/hooks/use-portfolio-memo';
import type { UsePortfolioReviewResult } from '@/components/stock-table/hooks/use-portfolio-review';
import type { useStockGroups } from '@/components/stock-table/hooks/use-stock-groups';
import type { SizingAllocationsResult } from '@/components/stock-table/hooks/use-sizing-allocations';
import type { CouncilRunnerState } from '@/components/stock-table/hooks/use-council-runner';
import type { HistoryDataResult } from '@/components/stock-table/hooks/use-history-data';
import type { Stock, Portfolio } from '@/lib/store';
import type { AssetClass, AssetClassConfig } from '@/lib/api';
import type {
    TabType,
    PositionsMode,
    PortfolioMode,
    AdjustmentSource,
    PortfolioFocusMode,
    SortColumn,
    SortDirection,
} from '@/components/stock-table/types';

// ── Context shape ─────────────────────────────────────────────────────────────

export interface StockTableContextValue {
    // ── Hook domains ──────────────────────────────────────────────────────────
    /** All overlay/reconciliation state + derived values from usePortfolioOverlay */
    overlay: UsePortfolioOverlayResult;
    /** All rebalance state + callbacks from usePortfolioRebalance */
    rebalance: UsePortfolioRebalanceResult;
    /** Portfolio memo state + callbacks from usePortfolioMemo (runPortfolioMemo takes overlaySummary) */
    memo: UsePortfolioMemoResult;
    /** Review workflow state + effects from usePortfolioReview */
    review: UsePortfolioReviewResult;
    /** Stock groups state + callbacks from useStockGroups */
    stockGroups: ReturnType<typeof useStockGroups>;
    /** Backend sizing allocations from useSizingAllocations */
    sizing: SizingAllocationsResult;
    /** Council runner state + callbacks from useCouncilRunner */
    council: CouncilRunnerState;
    /** History tab state + derived data from useHistoryData */
    history: HistoryDataResult;

    // ── Convenience wrapper ───────────────────────────────────────────────────
    /**
     * Opens portfolio analysis setup, including optional investment plays.
     * The dialog submits through memo.runPortfolioMemo with the current overlay.
     */
    runPortfolioMemo: () => void;

    // ── Store values ──────────────────────────────────────────────────────────
    stocks: Stock[];
    portfolio: Portfolio;
    lastSyncTime: Date | null;

    // ── Key component state ───────────────────────────────────────────────────
    activeTab: TabType;
    setActiveTab: Dispatch<SetStateAction<TabType>>;
    positionsMode: PositionsMode;
    setPositionsMode: Dispatch<SetStateAction<PositionsMode>>;
    portfolioMode: PortfolioMode;
    setPortfolioMode: Dispatch<SetStateAction<PortfolioMode>>;
    activeAdjustmentSource: AdjustmentSource;
    setActiveAdjustmentSource: Dispatch<SetStateAction<AdjustmentSource>>;
    assetClasses: AssetClass[];
    setAssetClasses: Dispatch<SetStateAction<AssetClass[]>>;
    /** Raw asset-class config settings — used to build assetClassConfigMap in consumers. */
    assetClassConfig: AssetClassConfig[];
    /** Configured stock Outperform benchmarks; null when the source configuration is unavailable. */
    monitoringBenchmarks: Map<string, string> | null;
    /** Portfolio focus interaction mode (hover vs. select). */
    portfolioFocusMode: PortfolioFocusMode;
    setPortfolioFocusMode: Dispatch<SetStateAction<PortfolioFocusMode>>;
    /** Codes of currently-hovered asset-class cells in the portfolio panel. */
    hoveredPortfolioAssetClassCodes: string[];
    setHoveredPortfolioAssetClassCodes: Dispatch<SetStateAction<string[]>>;
    /** Code of the actively-selected asset class in focus/select mode. */
    selectedPortfolioAssetClassCode: string | null;
    setSelectedPortfolioAssetClassCode: Dispatch<SetStateAction<string | null>>;
    /** Navigate to a main tab, handling portfolio-mode side-effects. */
    handleMainTabClick: (tab: TabType) => void;
    /** Navigate programmatically while preserving browser back/forward history. */
    navigateToTab: (tab: TabType, options?: { marketCode?: string; helpSection?: string }) => void;
    /** Analysis table display mode. */
    analysisGroupMode: 'none' | 'sector';
    setAnalysisGroupMode: Dispatch<SetStateAction<'none' | 'sector'>>;
    /** Temporarily emphasizes watchlist rows in Analysis. */
    watchlistHighlightEnabled: boolean;
    setWatchlistHighlightEnabled: Dispatch<SetStateAction<boolean>>;
    /** Temporarily hides ETF rows from the Analysis table. */
    analysisEtfsHidden: boolean;
    setAnalysisEtfsHidden: Dispatch<SetStateAction<boolean>>;
    /** Reveals records deliberately excluded from strategy workflows. */
    showNonAllocatingInstruments: boolean;
    setShowNonAllocatingInstruments: Dispatch<SetStateAction<boolean>>;
    nonAllocatingUpdating: Record<number, boolean>;
    nonAllocatingErrors: Record<number, string>;
    toggleNonAllocatingInstrument: (stock: Stock) => void;
    /** Horizontal alignment for score values in the Analysis grid. */
    analysisScoreAlignment: 'left' | 'center' | 'right';
    setAnalysisScoreAlignment: Dispatch<SetStateAction<'left' | 'center' | 'right'>>;
    /** Keeps ticker rails visible in Analysis until toggled off. */
    analysisTickerPinned: boolean;
    setAnalysisTickerPinned: Dispatch<SetStateAction<boolean>>;
    /** Analysis free-text security search. */
    analysisSearch: string;
    setAnalysisSearch: Dispatch<SetStateAction<string>>;
    /** Limits Analysis to securities without an assigned exchange. */
    analysisMissingExchangeOnly: boolean;
    analysisMissingResearchOnly: boolean;
    /** Temporarily limits the sector hierarchy to one asset-class sleeve. */
    focusedAnalysisAssetClass: { key: string; label: string } | null;
    setFocusedAnalysisAssetClass: Dispatch<
        SetStateAction<{ key: string; label: string } | null>
    >;

    // ── Shared panel callbacks ────────────────────────────────────────────────
    /**
     * Ensures stock groups exist for all active portfolio target rows.
     * Creates any missing named groups, persists to backend.
     * Returns number of groups added.
     */
    ensurePortfolioTargetGroups: () => number;
    /**
     * Removes pending portfolio-target groups that have no assigned stocks.
     * Returns number of groups removed.
     */
    removePendingPortfolioTargetGroups: () => number;
    /**
     * Returns the recorded action value for a given asset class, honouring
     * stock-level reduction inputs first, then cash-move inputs, then the
     * adjustment plan's recorded_value.
     */
    getPortfolioRecordedActionForAssetClass: (assetClassCode?: string | null) => number;

    // ── Derived ───────────────────────────────────────────────────────────────
    sortedStocks: Stock[];
    positionStocks: Stock[];
    nonAllocatingStocks: Stock[];

    // ── Sort state (shared between positions and analysis headers) ────────────
    sortColumn: SortColumn | null;
    sortDirection: SortDirection;
    handleSort: (column: SortColumn) => void;

    // ── Security positions (used in analysis panel) ───────────────────────────
    securityPositions: Record<string, 'BUY' | 'SELL'>;
}

// ── Context + hook ────────────────────────────────────────────────────────────

const StockTableContext = createContext<StockTableContextValue | null>(null);

export function useStockTableContext(): StockTableContextValue {
    const ctx = useContext(StockTableContext);
    if (ctx === null) {
        throw new Error(
            'useStockTableContext must be called inside a StockTable component tree',
        );
    }
    return ctx;
}

export { StockTableContext };
