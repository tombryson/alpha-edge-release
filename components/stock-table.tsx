'use client';
import actionStyles from './stock-table/actions-workspace.module.css';
import { subscribePoll } from '@/lib/polling';
import { getAccessMode } from '@/lib/access-mode';
import { comparePositionModelWeights, hasMissingSizingResearch, isModelWeightHolding, type PositionModelWeight } from '@/lib/positions-model-weight';
import { useWeightPolicy } from '@/lib/use-weight-policy';

import React from 'react';
import { PositionRiskGroup } from './stock-table/position-risk-group';
import dynamic from 'next/dynamic';
import { useStore, type Stock } from '@/lib/store';
import historyStyles from './stock-table/history-workspace.module.css';
import { outperformBenchmarksFromThemes } from '@/lib/monitoring-coverage';
import {
    isNonAllocatingSecurityType,
    requiresNonAllocatingConfirmation,
} from '@/lib/security-types';
import {
    api,
    apiFetch,
    getCouncilTemplateForAssetClass,
    type StockGroup,
    type StockGroupAssignment,
    type AssetClass,
    type DecisionResponse,
    type AlertResponse,
    type SecurityActionResponse,
    type CouncilReportPacket,
    type CouncilRunListEntry,
    type AssetClassConfig,
    type CashMovementSourceType,
    type PortfolioOverlaySummaryResponse,
    type PortfolioOverlayReconciliationResponse,
    type PortfolioMixCurrentResponse,
    type PortfolioMixSnapshotResponse,
    type PortfolioRebalancePlan,
    type PortfolioRebalancePlanRow,
    type AdjustmentPlan,
    type AdjustmentPlanRow,
    type PortfolioPerformancePoint,
    type AssetClassPerformancePoint,
    type SecurityPerformancePoint,
    type PerformanceEvent,
    type CommodityTheme,
    type CommodityThemeStatus,
    type ListingReview,
} from '@/lib/api';
import {
    actionTypeLabel,
    normalizeActionType,
} from '@/components/stock-table/action-labels';
import {
    defaultAnalysisVisibleColumns,
    defaultNormalPositionColumnOrder,
    defaultPortfolioVisibleColumns,
    defaultPositionVisibleColumns,
    type AnalysisGridColumn,
    type AnalysisGridColumnKey,
    type AnalysisVisibleColumns,
    type PositionGridColumn,
    type PositionGridColumnKey,
    type PositionVisibleColumns,
} from '@/components/stock-table/columns';
import {
    analysisPerformanceToneClass,
    formatAnalysisPerformancePct,
    formatPerformanceDate,
    isStalePerformance,
    stalePerformanceClass,
} from '@/components/stock-table/formatters';
import {
    PositionHeaderCell,
    type PositionColumnMenuItem,
} from '@/components/stock-table/position-header-cell';
import { PositionGrid, type PositionGridHeaderControls } from '@/components/stock-table/position-grid';
import { PositionGridStyles } from '@/components/stock-table/position-grid-styles';
import { HISTORY_PERFORMANCE_RANGES } from '@/components/stock-table/history';
// Dynamic imports — recharts and lightweight-charts only load when user opens HISTORY tab
const HistoryPerformancePanel = dynamic(
    () => import('@/components/stock-table/history-performance-panel').then(m => ({ default: m.HistoryPerformancePanel })),
    { ssr: false },
);
const HistorySignalsPanel = dynamic(
    () => import('@/components/stock-table/history-signals-panel').then(m => ({ default: m.HistorySignalsPanel })),
    { ssr: false },
);
const HistoryStockPanel = dynamic(
    () => import('@/components/stock-table/history-stock-panel').then(m => ({ default: m.HistoryStockPanel })),
    { ssr: false },
);
import {
    buildPerformanceEventLegendItems,
    type PerformanceChartEvent,
} from '@/components/stock-table/performance-events';
import {
    buildPortfolioPureSortedRows,
    PortfolioHiddenBucketSpacerRow,
    renderPortfolioCashAssetClassRows,
    renderPortfolioUnassignedAssetClassRows,
} from '@/components/stock-table/portfolio-position-rows';
import { createRenderPositionAggregateCells } from '@/components/stock-table/position-aggregate-cells';
import {
    PositionBucketAggregateRow,
    PositionGroupAggregateRow,
    PositionPendingReserveRow,
    PositionUngroupedAggregateRow,
} from '@/components/stock-table/position-aggregate-row';
import { PositionStockRow } from '@/components/stock-table/position-stock-row';
import { createRenderPositionStockCells } from '@/components/stock-table/position-stock-cells';
import { PositionsToolbar } from '@/components/stock-table/positions-toolbar';
import { POSITIONS_PRESENTATION_KEY, type PositionsPresentation } from '@/lib/positions-capital-map';
import { PositionAssetClassShapeCell } from '@/components/stock-table/position-asset-class-shape-cell';
import {
    PositionShapeFooter,
    type PositionShapeUnit,
} from '@/components/stock-table/position-shape-footer';
import {
    buildPortfolioPieRows,
    buildPortfolioVisualSegments,
    getPortfolioAssetClassColor,
    portfolioColorToSurfaceTint,
} from '@/components/stock-table/portfolio-visual-data';
import {
    compareAnalysisMetricStocks,
    calculateAnalysisTargetWeight,
    calculateAveragePriceTarget,
    calculateBaseRatingTotal,
} from '@/components/stock-table/ratings';
import { useSizingAllocations } from '@/components/stock-table/hooks/use-sizing-allocations';
import { usePanelData } from '@/components/context-panel/panel-data';
import { useContextPanelStore } from '@/lib/context-panel-store';
import { positionRowClassKey } from '@/lib/position-row-appearance';
import { openSecurityDetails, SECURITY_HISTORY_REQUESTED, type SecurityNavigationDetail } from '@/lib/security-navigation';
import { usePanelResearch } from '@/lib/context-panel-research';
import { findByTicker } from '@/lib/context-panel-model';
import { useCouncilRunner } from '@/components/stock-table/hooks/use-council-runner';
import { useHistoryData } from '@/components/stock-table/hooks/use-history-data';
import { useStockGroups } from '@/components/stock-table/hooks/use-stock-groups';
import { usePortfolioOverlay } from '@/components/stock-table/hooks/use-portfolio-overlay';
import {
    usePortfolioRebalance,
    buildPortfolioRebalanceRowsFromCurrent,
} from '@/components/stock-table/hooks/use-portfolio-rebalance';
import { usePortfolioMemo } from '@/components/stock-table/hooks/use-portfolio-memo';
import { PortfolioAnalysisDialog } from '@/components/portfolio-analysis-dialog';
import { usePortfolioReview } from '@/components/stock-table/hooks/use-portfolio-review';
import { StockTableContext } from '@/components/stock-table/stock-table-context';
import { PortfolioRebalancePanel } from '@/components/stock-table/portfolio-rebalance-panel';
import { PortfolioReviewPanel } from '@/components/stock-table/portfolio-review-panel';
import { PortfolioShapeView } from '@/components/stock-table/portfolio-shape-view';
import { AnalysisPanel } from '@/components/stock-table/analysis-panel';
import { AnalysisToolbar } from '@/components/stock-table/analysis-toolbar';
import { CommodityMarketMap } from '@/components/commodity-market-map';
import { SystemArchitectureTab } from '@/components/system-architecture-tab';
import { HelpTab } from '@/components/help-tab';
import {
    CommodityThemeDirectAndEquityGateIndicator,
    COMMODITY_THEME_OPEN_EVENT,
} from '@/components/commodity-theme-path-indicator';
import {
    normalizeTerminalRouteTab,
    pushTerminalRoute,
    readTerminalRoute,
    replaceTerminalRoute,
    TERMINAL_TAB_REQUEST_EVENT,
    terminalRouteHash,
    type TerminalTabRequestDetail,
} from '@/lib/terminal-route';
import type { SizingResult } from '@/lib/api';
import { formatCoreRatio } from '@/lib/etf-core-ratio';
import type {
    AdjustmentSource,
    HistoryMode,
    HistoryPerformanceRange,
    OverlayAssetClassRow,
    PortfolioFocusMode,
    PortfolioMode,
    PortfolioTargetBarDrag,
    PortfolioTargetBarEditor,
    PortfolioVisualMode,
    PositionBucketKey,
    PositionAssetClassOrder,
    PositionAssetClassOrderDirection,
    PositionAssetClassRowMode,
    PositionsMode,
    ReviewCashMovementRecord,
    ReviewFocus,
    ReviewRecoveryContext,
    ReviewSelectionPlan,
    SortColumn,
    SortDirection,
    StockGroupAssignments,
    TabType,
} from '@/components/stock-table/types';
import {
    calculatePositionShapeScaleMax,
    comparePositionAssetClassShapes,
    resolvePositionAssetClassShape,
} from '@/lib/position-asset-class-shape';
import {
    useState,
    useRef,
    useCallback,
    useMemo,
    useEffect,
    useLayoutEffect,
} from 'react';
import { AlertsTab } from '@/components/alerts-tab';
import { ETFAllocationsTab } from '@/components/etf-allocations-tab';
import { NewsTab } from '@/components/news-tab';
import { EnrichmentTemplateModal } from '@/components/enrichment-template-modal';
import { ListingReviewsModal } from '@/components/listing-reviews-modal';
import { NonAllocatingInstrumentDialog } from '@/components/non-allocating-instrument-dialog';
import { ACTIONS_CHANGED, DECISION_HISTORY_REQUESTED, openAlertAction } from '@/lib/action-presentation';
import { PortfolioAllocationVisualPanel } from '@/components/stock-table/portfolio-allocation-visual-panel';
import {
    AdjustmentInbox,
    AdjustmentMetric,
    AdjustmentStageRail,
    PositionAdjustmentActionCell,
    PositionAdjustmentProgressCell,
    PositionAdjustmentTargetCell,
} from '@/components/adjustments/position-adjustment-workflow';
import {
    buildPortfolioMemoSummary,
    loadPortfolioMemoState,
    savePortfolioMemoState,
    type PortfolioMemoState,
} from '@/lib/portfolio-memo';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import {
    aggregateHoldingAdjustmentsByAssetClass,
    getAdjustmentTolerance,
    getAssetClassesWithHoldingInputs,
    getPlannedAdjustmentForHolding,
    getPlannedAdjustmentForHoldings,
    getRemainingSuggestedAdjustmentForHolding,
    getSuggestedAdjustmentForHolding,
    type AdjustmentHolding,
} from '@/lib/adjustments';
import {
    buildLivePortfolioRebalanceRows,
    buildPortfolioCashMovementPlan,
    formatPortfolioRebalanceDisplayName,
    getPortfolioRebalanceRowMove,
    summarizePortfolioRebalanceRows,
    validatePortfolioRebalanceImport,
} from '@/lib/portfolio-rebalance';
import {
    buildPortfolioMemoTargetUniverse,
    getPortfolioTargetDisplayName,
    mapCurrentAssetClassToPortfolioTarget,
    mapOverlayAssetClassesForMemo,
    mapPortfolioTargetToCurrentAssetClass,
} from '@/lib/portfolio-target-taxonomy';
import {
    formatAssetClassName,
    getAnalysisAssetClasses,
    getAssignableAssetClasses,
} from '@/lib/asset-classes';
import { getAnalysisExchangeCode } from '@/lib/analysis-workbench';
import {
    canSelectWorkflowStage,
    portfolioRebalanceWorkflowStageOrder,
    resolveActiveWorkflowStage,
    reviewWorkflowStageOrder,
    type PortfolioRebalanceWorkflowStage,
    type ReviewWorkflowStage,
} from '@/lib/workflow-stages';

const POSITION_VISIBLE_COLUMNS_STORAGE_KEY = 'terminal-visible-columns-v2';
const POSITION_COLUMN_ORDER_STORAGE_KEY = 'terminal-position-column-order-v2';
const POSITION_ASSET_CLASS_ROW_MODE_STORAGE_KEY =
    'terminal-position-asset-class-row-mode-v1';
const POSITION_ASSET_CLASS_ORDER_STORAGE_KEY =
    'terminal-position-asset-class-order-v1';
const POSITION_SHAPE_UNIT_STORAGE_KEY = 'terminal-position-shape-unit-v1';

const analysisAlertOvalStyle = {
    width: 'calc(var(--spacing) * 2)',
    height: 'calc(var(--spacing) * 6)',
    borderRadius: '30%',
};

const canonicalActiveAlertScript = (script: string) => {
    const value = script.trim().toLowerCase();
    if (value === 'cdf') return 'cdf';
    if (value === 'atr_oscillator' || value === 'tms') return 'tms';
    if (value === 'etf_cdf' || value === 'etf_tms') return 'etf_tms';
    if (value === 'regime_equities' || value === 'q4d') return 'q4d';
    if (value === 'regime_commodities' || value === 'ctf') return 'ctf';
    if (value === 'regime_position_sizing' || value === 'q3d') return 'q3d';
    return value;
};

const activeAlertSymbol = (ticker?: string | null) =>
    String(ticker || '')
        .split(':')
        .pop()
        ?.toUpperCase() || '';

const ResearchPanel = dynamic(
    () =>
        import('@/components/research-panel').then(
            (module) => module.ResearchPanel,
        ),
    {
        ssr: false,
        loading: () => (
            <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                Loading research panel...
            </div>
        ),
    },
);

const PositionsCapitalMap = dynamic(
    () => import('@/components/stock-table/positions-capital-map').then(module => module.PositionsCapitalMap),
    { ssr: false, loading: () => <div className="p-4 text-sm text-muted-foreground" role="status">Loading capital map...</div> },
);

export function StockTable({
    positionShapeWidgetVisible = false,
    primaryNavigationInShell = false,
}: {
    positionShapeWidgetVisible?: boolean;
    primaryNavigationInShell?: boolean;
}) {
    const isDemo = getAccessMode() === 'demo';
    const positionVisibilityStorageKey = isDemo
        ? 'terminal-positions-visibility:demo'
        : 'terminal-positions-visibility';
    const positionAssetClassRowModeStorageKey = isDemo
        ? `${POSITION_ASSET_CLASS_ROW_MODE_STORAGE_KEY}:demo`
        : POSITION_ASSET_CLASS_ROW_MODE_STORAGE_KEY;
    const allStocks = useStore((state) => state.stocks);
    const stocks = useMemo(
        () =>
            allStocks.filter(
                (stock) => !isNonAllocatingSecurityType(stock.securityType),
            ),
        [allStocks],
    );
    const nonAllocatingStocks = useMemo(
        () =>
            allStocks.filter((stock) =>
                isNonAllocatingSecurityType(stock.securityType),
            ),
        [allStocks],
    );
    const portfolio = useStore((state) => state.portfolio);
    const positionsLoading = useStore((state) => state.isLoading);
    const positionsDataError = useStore((state) => state.error);
    const alerts = useStore((state) => state.alerts);
    const activeAlerts = useStore((state) => state.activeAlerts);
    const lastSyncTime = useStore((state) => state.lastSyncTime);
    const updateStock = useStore((state) => state.updateStock);
    const fetchHoldings = useStore((state) => state.fetchHoldings);
    const fetchActiveAlerts = useStore((state) => state.fetchActiveAlerts);

    // Ref to track latest stocks for debounced callbacks (avoids stale closure)
    const stocksRef = useRef(stocks);
    useEffect(() => {
        stocksRef.current = stocks;
    }, [stocks]);

    const [activeTab, setActiveTab] = useState<TabType>('POSITIONS');
    const [analysisGroupMode, setAnalysisGroupMode] =
        useState<'none' | 'sector'>('sector');
    const [watchlistHighlightEnabled, setWatchlistHighlightEnabled] =
        useState(false);
    const [analysisEtfsHidden, setAnalysisEtfsHidden] = useState(false);
    const [showNonAllocatingInstruments, setShowNonAllocatingInstruments] =
        useState(false);
    const [nonAllocatingUpdating, setNonAllocatingUpdating] = useState<
        Record<number, boolean>
    >({});
    const [nonAllocatingErrors, setNonAllocatingErrors] = useState<Record<number, string>>({});
    const [nonAllocatingConfirmStock, setNonAllocatingConfirmStock] =
        useState<Stock | null>(null);
    const [analysisScoreAlignment, setAnalysisScoreAlignment] =
        useState<'left' | 'center' | 'right'>('right');
    const [analysisTickerPinned, setAnalysisTickerPinned] = useState(false);
    const [analysisSearch, setAnalysisSearch] = useState('');
    const [analysisMissingExchangeOnly, setAnalysisMissingExchangeOnly] = useState(false);
    const [analysisMissingResearchOnly, setAnalysisMissingResearchOnly] = useState(false);
    const [focusedAnalysisAssetClass, setFocusedAnalysisAssetClass] = useState<{
        key: string;
        label: string;
    } | null>(null);
    const [analysisPreferencesReady, setAnalysisPreferencesReady] =
        useState(false);
    const [sortColumn, setSortColumn] = useState<SortColumn>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);
    const [contributionOverrides, setContributionOverrides] = useState<
        Record<number, Date>
    >({});
    const [cashInput, setCashInput] = useState('');
    const [editingCashAssetClass, setEditingCashAssetClass] = useState<
        string | null
    >(null);
    const [cashSourceType, setCashSourceType] =
        useState<CashMovementSourceType>('PORTFOLIO_CASH_TRANSFER');
    const [cashNote, setCashNote] = useState('');
    const [cashSaving, setCashSaving] = useState(false);
    const [cashIntentError, setCashIntentError] = useState<string | null>(null);
    // Council runner state + functions — see hooks/use-council-runner.ts
    // (wired after sortedStocks is declared below)
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const [columnMenuPosition, setColumnMenuPosition] = useState({
        top: 0,
        left: 0,
    });
    const columnMenuRef = useRef<HTMLDivElement | null>(null);
    const columnMenuPanelRef = useRef<HTMLDivElement | null>(null);
    const [visibleColumns, setVisibleColumns] = useState<PositionVisibleColumns>(
        defaultPositionVisibleColumns,
    );
    const [portfolioVisibleColumns, setPortfolioVisibleColumns] =
        useState<PositionVisibleColumns>(defaultPortfolioVisibleColumns);
    const [securityPositions, setSecurityPositions] = useState<
        Record<string, 'BUY' | 'SELL'>
    >({});
    const [securityActions, setSecurityActions] = useState<
        SecurityActionResponse[]
    >([]);
    const [outperformStates, setOutperformStates] = useState<
        Record<string, CommodityThemeStatus>
    >({});
    const [commodityThemes, setCommodityThemes] = useState<CommodityTheme[]>(
        [],
    );
    const [commodityThemesReady, setCommodityThemesReady] = useState(false);
    const monitoringBenchmarks = useMemo(() => commodityThemesReady
        ? outperformBenchmarksFromThemes(commodityThemes) : null,
    [commodityThemes, commodityThemesReady]);
    const { ledger: etfAllocationLedger } = usePanelData();
    // History state + data — managed by useHistoryData (wired after positionStocks is available)
    const [dropdownPosition, setDropdownPosition] = useState<
        Record<string, 'above' | 'below'>
    >({});
    const [showRiskDropdown, setShowRiskDropdown] = useState<
        Record<string, boolean>
    >({});
    const [showAddStockModal, setShowAddStockModal] = useState(false);
    const [newStockName, setNewStockName] = useState('');
    const [newStockTicker, setNewStockTicker] = useState('');
    const [addingStock, setAddingStock] = useState(false);
    const [addStockError, setAddStockError] = useState('');
    const [deleteConfirmStock, setDeleteConfirmStock] = useState<Stock | null>(
        null,
    );
    const [deletingStock, setDeletingStock] = useState(false);
    const [refreshingPrices, setRefreshingPrices] = useState(false);
    const [listingReviews, setListingReviews] = useState<ListingReview[]>([]);
    const [listingReviewsLoading, setListingReviewsLoading] = useState(false);
    const [listingReviewsError, setListingReviewsError] = useState<string | null>(null);
    const [showListingReviews, setShowListingReviews] = useState(false);
    const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
    const [effectiveEquityPct, setEffectiveEquityPct] = useState<number | null>(
        null,
    );
    const [assetClassConfig, setAssetClassConfig] = useState<
        AssetClassConfig[]
    >([]);
    const [assetClasses, setAssetClasses] = useState<AssetClass[]>(
        [],
    );
    const [showQ1Stats, setShowQ1Stats] = useState(true);
    const [showGroupStats, setShowGroupStats] = useState(true);
    const [showStockStats, setShowStockStats] = useState(true);
    const [positionAssetClassRowMode, setPositionAssetClassRowMode] =
        useState<PositionAssetClassRowMode | null>(null);
    const [positionAssetClassOrder, setPositionAssetClassOrder] =
        useState<PositionAssetClassOrder>('saved');
    const [positionAssetClassOrderDirection, setPositionAssetClassOrderDirection] =
        useState<PositionAssetClassOrderDirection>('desc');
    const [positionAssetClassOrderReady, setPositionAssetClassOrderReady] =
        useState(false);
    const [positionShapeUnit, setPositionShapeUnit] =
        useState<PositionShapeUnit>('pct');
    const [positionShapeUnitReady, setPositionShapeUnitReady] = useState(false);
    const [portfolioShowQ1Stats, setPortfolioShowQ1Stats] = useState(true);
    const [portfolioShowGroupStats, setPortfolioShowGroupStats] =
        useState(true);
    const [portfolioShowStockStats, setPortfolioShowStockStats] =
        useState(true);
    const [positionColumnOrder, setPositionColumnOrder] = useState<
        PositionGridColumnKey[]
    >([]);
    const [draggedPositionColumnKey, setDraggedPositionColumnKey] =
        useState<PositionGridColumnKey | null>(null);
    const [positionStatsPeekEnabled, setPositionStatsPeekEnabled] =
        useState(true);
    const [showPositionBucketRows, setShowPositionBucketRows] =
        useState(!isDemo);
    const [positionVisibilityReady, setPositionVisibilityReady] = useState(false);
    const [positionStatsPeekLayer, setPositionStatsPeekLayer] = useState<
        'bucket' | 'group' | null
    >(null);
    const [
        positionStatsTransitionSuppressed,
        setPositionStatsTransitionSuppressed,
    ] = useState(false);
    const [showPortfolioBucketRows, setShowPortfolioBucketRows] =
        useState(true);
    const [portfolioPureSort, setPortfolioPureSort] = useState(false);
    const [positionsMode, setPositionsMode] = useState<PositionsMode>('normal');
    const [positionsPresentation, setPositionsPresentation] = useState<PositionsPresentation>('table');
    useEffect(() => {
        try {
            if (localStorage.getItem(POSITIONS_PRESENTATION_KEY) === 'simple') setPositionsPresentation('simple');
        } catch { /* Storage is optional for a presentation preference. */ }
    }, []);
    const changePositionsPresentation = (view: PositionsPresentation) => {
        setPositionsPresentation(view);
        setPositionStatsPeekLayer(null);
        try { localStorage.setItem(POSITIONS_PRESENTATION_KEY, view); } catch { /* Keep the current session usable. */ }
    };
    const [activeAdjustmentSource, setActiveAdjustmentSource] =
        useState<AdjustmentSource>('signal');
    const [portfolioMode, setPortfolioMode] =
        useState<PortfolioMode>('shape');
    const [portfolioVisualMode, setPortfolioVisualMode] =
        useState<PortfolioVisualMode>('bar');
    const [portfolioBarFlatten, setPortfolioBarFlatten] = useState(true);
    const [portfolioBarEqualWidth, setPortfolioBarEqualWidth] = useState(false);
    const [portfolioFocusMode, setPortfolioFocusMode] =
        useState<PortfolioFocusMode>('hover');
    const [selectedPositionStockId, setSelectedPositionStockId] = useState<
        number | null
    >(null);
    const [hoveredPortfolioAssetClassCodes, setHoveredPortfolioAssetClassCodes] =
        useState<string[]>([]);
    const [selectedPortfolioAssetClassCode, setSelectedPortfolioAssetClassCode] =
        useState<string | null>(null);
    const positionsScrollViewportRef = useRef<HTMLDivElement | null>(null);
    const positionStatsPeekIntentTimerRef = useRef<number | null>(null);
    const positionStatsPeekLeaveTimerRef = useRef<number | null>(null);
    const reviewTablePanelRef = useRef<HTMLDivElement | null>(null);


    // ── Portfolio overlay (extracted hook) ───────────────────────────────────
    const overlayResult = usePortfolioOverlay(activeTab);
    const {
        overlaySummary, setOverlaySummary,
        overlayReconciliation,
        expandedRegimeSleeves, setExpandedRegimeSleeves,
        rawOverlayRows, overlayRowsByCode,
        immutableReviewSignalCutRatio,
        reviewGoverningSource,
        portfolioRisk, portfolioRiskMode,
        q4Crisis, q4CrisisActive, q4CrisisTargetPct,
        reviewAlertKind, isQ4DReviewSignal, reviewSignalCopy,
        reviewActiveEventStatus, reviewCashConfirmationStatus,
        reconciliationOverallStatus, reconciliationSourceStatus,
        reconciliationAssetClassStatus,
        sourceReconciliationByName, assetClassReconciliationByCode,
    } = overlayResult;

    // ── Portfolio rebalance (extracted hook) ──────────────────────────────────
    const rebalanceResult = usePortfolioRebalance({
        activeTab,
        portfolioMode,
        positionsMode,
        activeAdjustmentSource,
    });
    const {
        portfolioTargetBarEditor, setPortfolioTargetBarEditor,
        portfolioTargetBarLockedOrder, setPortfolioTargetBarLockedOrder,
        portfolioTargetBarDragRef,
        portfolioTargetDraftActive, setPortfolioTargetDraftActive,
        portfolioRebalanceControlsOpen, setPortfolioRebalanceControlsOpen,
        portfolioRebalancePanelRef,
        portfolioTargetAlignmentRef,
        portfolioTargetAlignment, setPortfolioTargetAlignment,
        portfolioMix, setPortfolioMix,
        approvedPortfolioMix, setApprovedPortfolioMix,
        portfolioRebalancePlan, setPortfolioRebalancePlan,
        portfolioAdjustmentPlan, setPortfolioAdjustmentPlan,
        portfolioRebalanceRows, setPortfolioRebalanceRows,
        portfolioRebalanceTitle, setPortfolioRebalanceTitle,
        portfolioRebalanceSaving, setPortfolioRebalanceSaving,
        portfolioRebalanceError, setPortfolioRebalanceError,
        portfolioAdjustmentDraftSavedAt, setPortfolioAdjustmentDraftSavedAt,
        portfolioSelectedStage, setPortfolioSelectedStage,
        portfolioCashMoveInputs, setPortfolioCashMoveInputs,
        portfolioReductionInputs, setPortfolioReductionInputs,
        portfolioCashMoveInputsRef,
        portfolioReductionInputsRef,
        portfolioAdjustmentDraftSavedAtRef,
        portfolioRebalancePlanIdRef,
        portfolioTargetDraftActiveRef,
        loadPortfolioRebalanceData,
        getDefaultPortfolioTargetTitle,
        formatPortfolioTargetDate,
    } = rebalanceResult;

    // ── Portfolio memo (extracted hook) ──────────────────────────────────────
    const memoResult = usePortfolioMemo({
        portfolioMixRows: portfolioMix?.rows,
        setPortfolioRebalancePlan,
        setPortfolioTargetDraftActive,
        setPortfolioSelectedStage,
        setPortfolioCashMoveInputs,
        setPortfolioReductionInputs,
        setPortfolioRebalanceTitle,
        setPortfolioRebalanceRows,
    });
    const {
        portfolioMemoState, setPortfolioMemoState,
        portfolioMemoError, setPortfolioMemoError,
        persistPortfolioMemoState,
        applyPortfolioMemoTargets,
        runPortfolioMemo: runPortfolioMemoBase,
    } = memoResult;
    const [portfolioAnalysisOpen, setPortfolioAnalysisOpen] = useState(false);
    const runPortfolioMemo = () => {
        if (!overlaySummary) return;
        setPortfolioMemoError(null);
        setPortfolioAnalysisOpen(true);
    };

    // ── Portfolio review (extracted hook) ────────────────────────────────────
    const reviewResult = usePortfolioReview({
        reviewActiveEventStatus,
        reviewCashConfirmationStatus,
    });
    const {
        reviewFocus, setReviewFocus,
        reviewCutInputs, setReviewCutInputs,
        reviewDraftSavedAt, setReviewDraftSavedAt,
        reviewStage1CompletedAt, setReviewStage1CompletedAt,
        reviewSelectedStage, setReviewSelectedStage,
        reviewStageConfirmationOpen, setReviewStageConfirmationOpen,
        reviewReopenConfirmOpen, setReviewReopenConfirmOpen,
        reviewCashMovementRecord, setReviewCashMovementRecord,
        reviewRecoveryContext, setReviewRecoveryContext,
        reviewStageSaving, setReviewStageSaving,
        reviewStageSaveError, setReviewStageSaveError,
    } = reviewResult;

    // Load saved column preferences from localStorage after mount
    useEffect(() => {
        const saved = localStorage.getItem(POSITION_VISIBLE_COLUMNS_STORAGE_KEY);
        if (saved) {
            try {
                setVisibleColumns((prev) => ({
                    ...prev,
                    ...JSON.parse(saved),
                }));
            } catch (e) {
                console.error(
                    '[ALPHA EDGE] Failed to parse saved column preferences:',
                    e,
                );
            }
        }
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem('terminal-portfolio-visible-columns');
        if (saved) {
            try {
                setPortfolioVisibleColumns((prev) => ({
                    ...prev,
                    ...JSON.parse(saved),
                }));
            } catch (e) {
                console.error(
                    '[ALPHA EDGE] Failed to parse saved portfolio column preferences:',
                    e,
                );
            }
        }
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem(positionVisibilityStorageKey);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setShowQ1Stats(parsed.showQ1Stats ?? true);
                setShowGroupStats(parsed.showGroupStats ?? false);
                setShowStockStats(parsed.showStockStats ?? true);
                setPortfolioShowQ1Stats(parsed.portfolioShowQ1Stats ?? true);
                setPortfolioShowGroupStats(
                    parsed.portfolioShowGroupStats ?? true,
                );
                setPortfolioShowStockStats(
                    parsed.portfolioShowStockStats ?? true,
                );
                setPositionStatsPeekEnabled(
                    parsed.positionStatsPeekEnabled ?? true,
                );
                setShowPositionBucketRows(
                    parsed.showPositionBucketRows ?? !isDemo,
                );
                setShowPortfolioBucketRows(
                    parsed.showPortfolioBucketRows ?? true,
                );
                setPortfolioPureSort(parsed.portfolioPureSort ?? false);
                setPortfolioBarFlatten(parsed.portfolioBarFlatten ?? true);
                setPortfolioBarEqualWidth(parsed.portfolioBarEqualWidth ?? false);
                if (
                    parsed.portfolioFocusMode === 'hover' ||
                    parsed.portfolioFocusMode === 'select'
                ) {
                    setPortfolioFocusMode(parsed.portfolioFocusMode);
                }
            } catch (e) {
                console.error(
                    '[ALPHA EDGE] Failed to parse saved positions visibility:',
                    e,
                );
            }
        }
        setPositionVisibilityReady(true);
    }, [isDemo, positionVisibilityStorageKey]);

    useEffect(() => {
        const saved = localStorage.getItem(POSITION_COLUMN_ORDER_STORAGE_KEY);
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                setPositionColumnOrder(
                    parsed.filter((key): key is PositionGridColumnKey =>
                        typeof key === 'string',
                    ),
                );
            }
        } catch (e) {
            console.error(
                '[ALPHA EDGE] Failed to parse saved position column order:',
                e,
            );
        }
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem('terminal-positions-mode');
        if (saved === 'normal' || saved === 'review') {
            setPositionsMode(saved);
        } else if (saved === 'regime') {
            setPositionsMode('review');
        }
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem(
            positionAssetClassRowModeStorageKey,
        );
        if (saved === 'metrics' || saved === 'shape') {
            setPositionAssetClassRowMode(saved);
        } else {
            setPositionAssetClassRowMode(isDemo ? 'metrics' : 'shape');
        }
    }, [isDemo, positionAssetClassRowModeStorageKey]);

    useEffect(() => {
        const saved = localStorage.getItem(POSITION_SHAPE_UNIT_STORAGE_KEY);
        if (saved === 'pct' || saved === 'cash') {
            setPositionShapeUnit(saved);
        }
        setPositionShapeUnitReady(true);
    }, []);

    useEffect(() => {
        try {
            const saved = JSON.parse(
                localStorage.getItem(POSITION_ASSET_CLASS_ORDER_STORAGE_KEY) ||
                    '{}',
            ) as {
                order?: PositionAssetClassOrder;
                direction?: PositionAssetClassOrderDirection;
            };
            if (
                saved.order === 'saved' ||
                saved.order === 'target' ||
                saved.order === 'current' ||
                saved.order === 'drift'
            ) {
                setPositionAssetClassOrder(saved.order);
            }
            if (saved.direction === 'asc' || saved.direction === 'desc') {
                setPositionAssetClassOrderDirection(saved.direction);
            }
        } catch {
            // Ignore stale local display preferences.
        } finally {
            setPositionAssetClassOrderReady(true);
        }
    }, []);

    useEffect(() => {
        if (!positionVisibilityReady) return;
        localStorage.setItem(
            positionVisibilityStorageKey,
            JSON.stringify({
                showQ1Stats,
                showGroupStats,
                showStockStats,
                portfolioShowQ1Stats,
                portfolioShowGroupStats,
                portfolioShowStockStats,
                positionStatsPeekEnabled,
                showPositionBucketRows,
                showPortfolioBucketRows,
                portfolioPureSort,
                portfolioBarFlatten,
                portfolioBarEqualWidth,
                portfolioFocusMode,
            }),
        );
    }, [
        positionVisibilityReady,
        positionVisibilityStorageKey,
        showQ1Stats,
        showGroupStats,
        showStockStats,
        portfolioShowQ1Stats,
        portfolioShowGroupStats,
        portfolioShowStockStats,
        positionStatsPeekEnabled,
        showPositionBucketRows,
        showPortfolioBucketRows,
        portfolioPureSort,
        portfolioBarFlatten,
        portfolioBarEqualWidth,
        portfolioFocusMode,
    ]);

    useEffect(() => {
        localStorage.setItem(
            POSITION_COLUMN_ORDER_STORAGE_KEY,
            JSON.stringify(positionColumnOrder),
        );
    }, [positionColumnOrder]);

    useEffect(() => {
        localStorage.setItem('terminal-positions-mode', positionsMode);
    }, [positionsMode]);

    useEffect(() => {
        if (positionAssetClassRowMode === null) return;
        localStorage.setItem(
            positionAssetClassRowModeStorageKey,
            positionAssetClassRowMode,
        );
    }, [positionAssetClassRowMode, positionAssetClassRowModeStorageKey]);

    useEffect(() => {
        if (!positionShapeUnitReady) return;
        localStorage.setItem(
            POSITION_SHAPE_UNIT_STORAGE_KEY,
            positionShapeUnit,
        );
    }, [positionShapeUnitReady, positionShapeUnit]);

    useEffect(() => {
        if (!positionAssetClassOrderReady) return;
        localStorage.setItem(
            POSITION_ASSET_CLASS_ORDER_STORAGE_KEY,
            JSON.stringify({
                order: positionAssetClassOrder,
                direction: positionAssetClassOrderDirection,
            }),
        );
    }, [
        positionAssetClassOrder,
        positionAssetClassOrderDirection,
        positionAssetClassOrderReady,
    ]);

    useEffect(() => {
        if (positionsMode !== 'review') return;
        setShowQ1Stats(true);
        setShowGroupStats(true);
        setShowStockStats(true);
        setCollapsedRegimeGroups(new Set());
    }, [positionsMode]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                showColumnMenu &&
                columnMenuRef.current &&
                !columnMenuRef.current.contains(event.target as Node) &&
                !columnMenuPanelRef.current?.contains(event.target as Node)
            ) {
                setShowColumnMenu(false);
            }
            if (
                target &&
                !target.closest('[data-inline-edit-root="true"]') &&
                editingCashAssetClass
            ) {
                setEditingCashAssetClass(null);
                setCashInput('');
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowColumnMenu(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [editingCashAssetClass, showColumnMenu]);

    const loadSecurityActions = useCallback(async () => {
        try {
            const nextActions = await api.getSecurityActions();
            setSecurityActions(Array.isArray(nextActions) ? nextActions : []);
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to load security actions:', error);
        }
    }, []);

    useEffect(() => {
        void loadSecurityActions();
    }, [alerts, loadSecurityActions]);

    useEffect(() => {
        const changed = () => { void loadSecurityActions(); };
        window.addEventListener(ACTIONS_CHANGED, changed);
        return () => window.removeEventListener(ACTIONS_CHANGED, changed);
    }, [loadSecurityActions]);

    useEffect(() => {
        let cancelled = false;
        let generation = 0;
        const loadOutperformStates = async () => {
            const request = ++generation;
            try {
                const response = await api.getCommodityThemes({ includeSecurities: true });
                if (!Array.isArray(response?.themes)) throw new Error('Commodity configuration unavailable');
                const themes = response.themes;
                const next: Record<string, CommodityThemeStatus> = {};
                for (const theme of themes) {
                    for (const security of theme.eligible_securities || []) {
                        const symbol = String(security.ticker || '')
                            .trim()
                            .toUpperCase()
                            .split(':')
                            .pop();
                        const status = security.stage_states?.SECURITY_OUTPERFORM;
                        if (symbol && status) next[symbol] = status;
                    }
                }
                if (!cancelled && request === generation) {
                    setOutperformStates(next);
                    setCommodityThemes(themes);
                    setCommodityThemesReady(true);
                }
            } catch (error) {
                if (!cancelled && request === generation) setCommodityThemesReady(false);
                console.error('[ALPHA EDGE] Failed to load Outperform states:', error);
            }
        };
        void loadOutperformStates();
        const configurationChanged = () => {
            setCommodityThemesReady(false);
            void loadOutperformStates();
        };
        window.addEventListener('alpha-edge:commodity-theme-configuration-changed', configurationChanged);
        return () => {
            cancelled = true;
            window.removeEventListener('alpha-edge:commodity-theme-configuration-changed', configurationChanged);
        };
    }, [alerts]);

    const commodityThemesByTacticalAssetClass = useMemo(
        () =>
            new Map(
                commodityThemes.map((theme) => [
                    normalizeAssetClassCode(theme.tactical.asset_class_code),
                    theme,
                ]),
            ),
        [commodityThemes],
    );
    const commodityThemesByStrategicAssetClass = useMemo(
        () =>
            new Map(
                commodityThemes.map((theme) => [
                    normalizeAssetClassCode(theme.strategic_floor.asset_class_code),
                    theme,
                ]),
            ),
        [commodityThemes],
    );

    // Resolve feed identities once, then key by row ID to keep listings distinct.
    useEffect(() => {
        const loadPositions = async () => {
            try {
                const positions = await api.getSecurityPositions();
                const positionsMap: Record<string, 'BUY' | 'SELL'> = {};
                if (positions && Array.isArray(positions)) {
                    stocks.forEach((stock) => {
                        const position = findByTicker(positions, `${stock.prefix || ''}${stock.symbol || ''}`, row => row.ticker);
                        if (position) positionsMap[stock.id] = position.position_state;
                    });
                }
                setSecurityPositions(positionsMap);
            } catch (error) {
                console.error(
                    '[ALPHA EDGE] Failed to load security positions:',
                    error,
                );
            }
        };
        loadPositions();
    }, [stocks]);

    useEffect(() => {
        const openResearch = (event: Event) => {
            const detail = (event as CustomEvent<{ ticker?: string; name?: string }>).detail;
            if (!detail?.ticker) return;
            setAnalysisSearch(detail.name || detail.ticker);
            setFocusedAnalysisAssetClass(null);
            setAnalysisEtfsHidden(false);
        };
        window.addEventListener('analysisSecurityRequested', openResearch);
        return () => window.removeEventListener('analysisSecurityRequested', openResearch);
    }, []);

    useEffect(() => {
        const loadAssetClassConfig = async () => {
            try {
                const [config, sleeves] = await Promise.all([
                    api.getAssetClassConfig(),
                    api.getAssetClasses(),
                ]);
                setAssetClassConfig(Array.isArray(config) ? config : []);
                setAssetClasses(Array.isArray(sleeves) ? sleeves : []);
            } catch (error) {
                console.error(
                    '[ALPHA EDGE] Failed to load asset class config:',
                    error,
                );
                setAssetClassConfig([]);
                setAssetClasses([]);
            }
        };
        loadAssetClassConfig();
    }, []);

    // Keep connection state fresh where ticker connection marks are visible.
    useEffect(() => {
        if (activeTab !== 'POSITIONS' && activeTab !== 'ANALYSIS') return;
        return subscribePoll(fetchActiveAlerts, 30000);
    }, [activeTab, fetchActiveAlerts]);

    // Fetch effective equity % from position sizing script for POSITIONS tab recommendation
    useEffect(() => {
        if (activeTab !== 'POSITIONS') return;
        const API_BASE_URL =
            process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';
        const load = async () => {
            try {
                const data = await apiFetch(`${API_BASE_URL}/regimes/status`).then(
                    (r) => r.json(),
                );
                const pct = data?.equity_sizing?.effective_pct;
                setEffectiveEquityPct(
                    typeof pct === 'number' && pct >= 0 ? pct : null,
                );
            } catch {}
        };
        return subscribePoll(load, 30000);
    }, [activeTab]);



    // ── Stock grouping (extracted hook) ──────────────────────────────────────
    const stockGroupsResult = useStockGroups({
        assetClasses,
        activeTab,
        portfolioMode,
        positionsMode,
        activeAdjustmentSource,
        stocks,
        setAssetClasses,
        setPositionStatsTransitionSuppressed,
    });
    const {
        groups, setGroups,
        stockGroupAssignments, setStockGroupAssignments,
        draggedGroupId, setDraggedGroupId,
        portfolioCollapsedGroupIds, setPortfolioCollapsedGroupIds,
        showGroupManager, setShowGroupManager,
        newGroupName, setNewGroupName,
        newCustomGroupQuartile, setNewCustomGroupQuartile,
        creatingCustomGroup, deletingCustomClassCode,
        groupManagerError, setGroupManagerError,
        editingGroupId, setEditingGroupId,
        editingGroupName, setEditingGroupName,
        groupNameSuggestionTarget, setGroupNameSuggestionTarget,
        groupingEnabled, setGroupingEnabled,
        collapsedRegimeGroups, setCollapsedRegimeGroups,
        flattenGroups, setFlattenGroups,
        drilldownGroupId, setDrilldownGroupId,
        canonicalGroupNameOptions, customGroupAssetClasses,
        getGroupNameSuggestions, canonicaliseGroupName,
        resolveGroupAssetClassCodeFromName, groupNameIdentity,
        saveGroupsToBackend, createGroup, createCustomGroup,
        deleteCustomAssetClass, renameGroup, deleteGroup,
        assignStockToGroup, toggleGroupCollapsed,
        togglePortfolioGroupCollapsed, toggleAllPositionGroupsCollapsed,
        reorderGroup, convertToTopLevel, nestGroupAsSubgroup,
        isDescendantOf, moveGroupToParent,
    } = stockGroupsResult;

    // Track when component has mounted to prevent hydration errors
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        if (positionStatsPeekIntentTimerRef.current !== null) {
            window.clearTimeout(positionStatsPeekIntentTimerRef.current);
            positionStatsPeekIntentTimerRef.current = null;
        }
        if (positionStatsPeekLeaveTimerRef.current !== null) {
            window.clearTimeout(positionStatsPeekLeaveTimerRef.current);
            positionStatsPeekLeaveTimerRef.current = null;
        }
        setPositionStatsPeekLayer(null);
    }, [activeTab, groupingEnabled, positionsMode]);

    useEffect(
        () => () => {
            if (positionStatsPeekIntentTimerRef.current !== null) {
                window.clearTimeout(positionStatsPeekIntentTimerRef.current);
            }
            if (positionStatsPeekLeaveTimerRef.current !== null) {
                window.clearTimeout(positionStatsPeekLeaveTimerRef.current);
            }
        },
        [],
    );

    useEffect(() => {
        if (!positionStatsTransitionSuppressed) return;
        const frame = window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                setPositionStatsTransitionSuppressed(false);
            });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [positionStatsTransitionSuppressed]);


    // Track when component has mounted to prevent hydration errors
    useEffect(() => {
        setMounted(true);
    }, []);

    const navigateToTab = useCallback(
        (
            tab: TabType,
            options: {
                marketCode?: string;
                helpSection?: string;
                resetPortfolioMode?: boolean;
                toggleIfAlreadyActive?: boolean;
            } = {},
        ) => {
            const wasAlreadyActive = activeTab === tab;
            if (options.resetPortfolioMode && tab === 'PORTFOLIO' && !wasAlreadyActive) {
                setPortfolioMode('shape');
            }

            if (
                tab === 'POSITIONS' ||
                tab === 'PORTFOLIO' ||
                tab === 'SYSTEM' ||
                tab === 'MARKETS' ||
                tab === 'ANALYSIS' ||
                tab === 'HELP'
            ) {
                setDrilldownGroupId(null);
            }

            if (tab === 'MARKETS' && options.marketCode) {
                pushTerminalRoute({ tab, marketCode: options.marketCode });
            } else if (tab === 'HELP' && options.helpSection) {
                pushTerminalRoute({ tab, helpSection: options.helpSection });
            } else {
                pushTerminalRoute({ tab });
            }

            setActiveTab(tab);
            window.dispatchEvent(
                new CustomEvent('tabChange', {
                    detail: {
                        tab,
                        toggleCenter: wasAlreadyActive && options.toggleIfAlreadyActive,
                    },
                }),
            );
        },
        [activeTab, setDrilldownGroupId],
    );

    const handleMainTabClick = useCallback(
        (tab: TabType) => {
            navigateToTab(tab, {
                resetPortfolioMode: true,
                toggleIfAlreadyActive: true,
            });
        },
        [navigateToTab],
    );

    useEffect(() => {
        const handleShellTabRequest = (
            event: CustomEvent<TerminalTabRequestDetail>,
        ) => {
            const tab = normalizeTerminalRouteTab(event.detail?.tab);
            if (!tab) return;
            event.preventDefault();
            handleMainTabClick(tab);
        };

        window.addEventListener(
            TERMINAL_TAB_REQUEST_EVENT,
            handleShellTabRequest as EventListener,
        );
        return () => {
            window.removeEventListener(
                TERMINAL_TAB_REQUEST_EVENT,
                handleShellTabRequest as EventListener,
            );
        };
    }, [handleMainTabClick]);

    useEffect(() => {
        const applyBrowserRoute = () => {
            const route = readTerminalRoute();
            if (!route) return;
            if (window.location.hash !== terminalRouteHash(route)) {
                replaceTerminalRoute(route);
            }
            setActiveTab(route.tab);
            if (
                route.tab === 'POSITIONS' ||
                route.tab === 'PORTFOLIO' ||
                route.tab === 'SYSTEM' ||
                route.tab === 'MARKETS' ||
                route.tab === 'ANALYSIS' ||
                route.tab === 'HELP'
            ) {
                setDrilldownGroupId(null);
            }
            window.dispatchEvent(
                new CustomEvent('tabChange', { detail: { tab: route.tab } }),
            );
        };

        if (readTerminalRoute()) {
            applyBrowserRoute();
        } else {
            const savedTab = normalizeTerminalRouteTab(
                window.localStorage.getItem('alpha-edge-active-tab'),
            );
            replaceTerminalRoute({ tab: savedTab || 'POSITIONS' });
            applyBrowserRoute();
        }

        window.addEventListener('popstate', applyBrowserRoute);
        window.addEventListener('hashchange', applyBrowserRoute);
        return () => {
            window.removeEventListener('popstate', applyBrowserRoute);
            window.removeEventListener('hashchange', applyBrowserRoute);
        };
    }, [setDrilldownGroupId]);

    useEffect(() => {
        const handleETFMonitorClick = () => navigateToTab('ETF');
        window.addEventListener('etfMonitorClick', handleETFMonitorClick);
        return () => window.removeEventListener('etfMonitorClick', handleETFMonitorClick);
    }, [navigateToTab]);

    useEffect(() => {
        const handleCommodityThemeOpen = (event: Event) => {
            const marketCode = (event as CustomEvent<{ code?: string }>).detail?.code;
            navigateToTab('MARKETS', { marketCode });
        };
        window.addEventListener(COMMODITY_THEME_OPEN_EVENT, handleCommodityThemeOpen);
        return () => window.removeEventListener(COMMODITY_THEME_OPEN_EVENT, handleCommodityThemeOpen);
    }, [navigateToTab]);

    useEffect(() => {
        const handlePortfolioReviewRequest = () => {
            setPositionsMode('review');
            navigateToTab('POSITIONS');
        };

        window.addEventListener('portfolioReviewRequested', handlePortfolioReviewRequest);
        window.addEventListener('portfolio-review-requested', handlePortfolioReviewRequest);

        return () => {
            window.removeEventListener('portfolioReviewRequested', handlePortfolioReviewRequest);
            window.removeEventListener('portfolio-review-requested', handlePortfolioReviewRequest);
        };
    }, [navigateToTab]);

    useEffect(() => {
        try {
            const saved = localStorage.getItem('terminal-analysis-workbench-v1');
            if (!saved) return;
            const parsed = JSON.parse(saved) as Partial<{
                groupMode: 'none' | 'sector';
                watchlistHighlightEnabled: boolean;
                etfsHidden: boolean;
                scoreAlignment: 'left' | 'center' | 'right';
                tickerPinned: boolean;
            }>;
            if (parsed.groupMode === 'none' || parsed.groupMode === 'sector') {
                setAnalysisGroupMode(parsed.groupMode);
            }
            if (typeof parsed.watchlistHighlightEnabled === 'boolean') {
                setWatchlistHighlightEnabled(parsed.watchlistHighlightEnabled);
            }
            if (typeof parsed.etfsHidden === 'boolean') {
                setAnalysisEtfsHidden(parsed.etfsHidden);
            }
            if (
                parsed.scoreAlignment === 'left' ||
                parsed.scoreAlignment === 'center' ||
                parsed.scoreAlignment === 'right'
            ) {
                setAnalysisScoreAlignment(parsed.scoreAlignment);
            }
            if (typeof parsed.tickerPinned === 'boolean') {
                setAnalysisTickerPinned(parsed.tickerPinned);
            }
        } catch {
            // Ignore stale local preferences and keep the default workbench state.
        } finally {
            setAnalysisPreferencesReady(true);
        }
    }, []);

    useEffect(() => {
        if (!analysisPreferencesReady) return;
        localStorage.setItem(
            'terminal-analysis-workbench-v1',
            JSON.stringify({
                groupMode: analysisGroupMode,
                watchlistHighlightEnabled,
                etfsHidden: analysisEtfsHidden,
                scoreAlignment: analysisScoreAlignment,
                tickerPinned: analysisTickerPinned,
            }),
        );
    }, [
        analysisGroupMode,
        analysisEtfsHidden,
        analysisPreferencesReady,
        analysisScoreAlignment,
        analysisTickerPinned,
        watchlistHighlightEnabled,
    ]);

    const weightPolicy = useWeightPolicy();
    const positionModelWeights = useMemo(() => {
        const targets = weightPolicy.data?.targets ?? [];
        return new Map(stocks.filter(isModelWeightHolding).map(stock => {
            const fullTicker = `${stock.prefix || ''}${stock.symbol || ''}`.toUpperCase();
            const target = targets.find(row => row.ticker.toUpperCase() === fullTicker);
            const incomplete = target?.role === 'STOCK' && target.research_missing > 0;
            const available = target?.available && !incomplete;
            const weight: PositionModelWeight = {
                percent: available ? target.percent : null,
                dollar: available ? target.ideal : null,
                stretchRatio: !weightPolicy.error && !weightPolicy.data?.error && target?.available && target.fresh && !target.research_missing
                    ? target.role === 'CORE_ETF' ? 1.25 : target.role === 'STOCK' ? 1.5 : undefined
                    : undefined,
                reason: weightPolicy.error || weightPolicy.data?.error || target?.reason || (incomplete ? 'Incomplete class research. Review Analysis data issues.' : !target ? 'Ideal weight unavailable' : target.fresh === false ? 'Stale valuation. Weight actions paused.' : weightPolicy.data?.enabled ? 'Weight management On. Purchases are limited to this amount.' : 'Advisory only. Weight management Off.'),
            };
            return [stock.id, weight];
        }));
    }, [stocks, weightPolicy]);
    const missingResearchStocks = stocks.filter(hasMissingSizingResearch);
    useEffect(() => {
        if (!missingResearchStocks.length) setAnalysisMissingResearchOnly(false);
    }, [missingResearchStocks.length]);

    const sortedStocks = useMemo(() => [...stocks].sort((a, b) => {
        if (!sortColumn || !sortDirection) return 0;

        const multiplier = sortDirection === 'desc' ? 1 : -1;
        if (sortColumn === 'MODEL_WEIGHT') return comparePositionModelWeights(
            positionModelWeights.get(a.id), positionModelWeights.get(b.id), sortDirection,
        );

        if (sortColumn === 'QTY') return (b.position - a.position) * multiplier;
        if (sortColumn === 'VALUE')
            return (b.positionValue - a.positionValue) * multiplier;
        if (sortColumn === 'BOOK_VALUE')
            return (b.bookValue - a.bookValue) * multiplier;
        if (sortColumn === 'PL_PERCENT')
            return (b.changePercent - a.changePercent) * multiplier;
        if (sortColumn === 'PL_DOLLAR')
            return (b.changeValue - a.changeValue) * multiplier;
        if (sortColumn === 'PORTFOLIO_PERCENT') {
            const aPercent =
                portfolio.totalValue > 0
                    ? (a.positionValue / portfolio.totalValue) * 100
                    : 0;
            const bPercent =
                portfolio.totalValue > 0
                    ? (b.positionValue / portfolio.totalValue) * 100
                    : 0;
            return (bPercent - aPercent) * multiplier;
        }
        if (sortColumn === 'CLASS_PERCENT') {
            const normalizeClass = (value?: string | null) => {
                const raw = String(value || '')
                    .trim()
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '');
                if (!raw) return 'UNASSIGNED';
                if (raw === 'PHARMACEUTICALS') return 'PHARMA';
                if (raw === 'RAREEARTHS') return 'REE';
                return raw;
            };
            const getParentValue = (stock: (typeof stocks)[0]) => {
                const heldStocks = stocks.filter(
                    (s) => !s.isWatchlist && !s.isExternal,
                );
                const groupId = stockGroupAssignments[stock.name];
                if (groupId) {
                    return heldStocks
                        .filter(
                            (s) => stockGroupAssignments[s.name] === groupId,
                        )
                        .reduce((sum, s) => sum + (s.positionValue || 0), 0);
                }
                const code = normalizeClass(stock.primaryAssetClass);
                return heldStocks
                    .filter((s) => normalizeClass(s.primaryAssetClass) === code)
                    .reduce((sum, s) => sum + (s.positionValue || 0), 0);
            };
            const aParent = getParentValue(a);
            const bParent = getParentValue(b);
            const aPercent =
                aParent > 0 ? (a.positionValue / aParent) * 100 : 0;
            const bPercent =
                bParent > 0 ? (b.positionValue / bParent) * 100 : 0;
            return (bPercent - aPercent) * multiplier;
        }
        if (sortColumn === 'EXPOSURE_PERCENT') {
            const aExp =
                a.positionValue > 0
                    ? (a.positionValue / a.positionValue) * 100
                    : 0;
            const bExp =
                b.positionValue > 0
                    ? (b.positionValue / b.positionValue) * 100
                    : 0;
            return (bExp - aExp) * multiplier;
        }
        if (sortColumn === 'QUALITY') {
            return compareAnalysisMetricStocks(a, b, 'QUALITY', sortDirection);
        }
        if (sortColumn === 'VALUE_SCORE') {
            return compareAnalysisMetricStocks(a, b, 'VALUE_SCORE', sortDirection);
        }
        if (sortColumn === 'GEMINI')
            return compareAnalysisMetricStocks(a, b, 'GEMINI', sortDirection);
        if (sortColumn === 'PERPLEXITY')
            return compareAnalysisMetricStocks(a, b, 'PERPLEXITY', sortDirection);
        if (sortColumn === 'GPT') {
            return compareAnalysisMetricStocks(a, b, 'GPT', sortDirection);
        }
        if (sortColumn === 'CLAUDE')
            return compareAnalysisMetricStocks(a, b, 'CLAUDE', sortDirection);
        if (sortColumn === 'COUNCIL')
            return compareAnalysisMetricStocks(a, b, 'COUNCIL', sortDirection);
        if (sortColumn === 'TOTAL') {
            return compareAnalysisMetricStocks(a, b, 'TOTAL', sortDirection);
        }
        if (sortColumn === 'NAME')
            return (a.name || '').localeCompare(b.name || '') * multiplier;
        if (sortColumn === 'PRICE')
            return compareAnalysisMetricStocks(a, b, 'PRICE', sortDirection);
        if (sortColumn === 'PERFORMANCE_6M') {
            return (
                ((b.performance6MPct ?? Number.NEGATIVE_INFINITY) -
                    (a.performance6MPct ?? Number.NEGATIVE_INFINITY)) *
                multiplier
            );
        }
        if (sortColumn === 'PERFORMANCE_12M') {
            return (
                ((b.performance12MPct ?? Number.NEGATIVE_INFINITY) -
                    (a.performance12MPct ?? Number.NEGATIVE_INFINITY)) *
                multiplier
            );
        }
        if (sortColumn === 'SUGGESTED_ALLOCATION') {
            const allocWeight = (s: typeof a) => {
                if (s.includeInSizing === false) return -1;
                return calculateAnalysisTargetWeight(s);
            };
            return (allocWeight(b) - allocWeight(a)) * multiplier;
        }
        if (sortColumn === 'CASH') return 0;
        if (sortColumn === 'DCA') {
            const aTime = a.lastContributedAt?.getTime() ?? 0;
            const bTime = b.lastContributedAt?.getTime() ?? 0;
            return (bTime - aTime) * multiplier;
        }
        if (sortColumn === 'ATR') {
            const getActionPriority = (stock: Stock) => {
                if (!stock.symbol) return 99;
                return (
                    securityActions.find(
                        (action) =>
                            action.is_primary &&
                            action.ticker.toUpperCase() ===
                                stock.symbol!.toUpperCase(),
                    )?.priority ?? 99
                );
            };
            return (getActionPriority(a) - getActionPriority(b)) * multiplier;
        }
        if (sortColumn === 'CDF') {
            const CDF_PRIORITY: Record<string, number> = { BUY: 0, SELL: 1 };
            const aState = securityPositions[a.id] ?? null;
            const bState = securityPositions[b.id] ?? null;
            const aNull = !aState;
            const bNull = !bState;
            if (aNull && bNull) return 0;
            if (aNull) return 1; // a has no state → always last
            if (bNull) return -1; // b has no state → always last
            return (CDF_PRIORITY[aState!] - CDF_PRIORITY[bState!]) * multiplier;
        }
        if (sortColumn === 'UPSIDE')
            return compareAnalysisMetricStocks(a, b, 'UPSIDE', sortDirection);
        if (sortColumn === 'ASSET_CLASS') {
            const normalizeForSort = (value?: string | null) =>
                String(value || '')
                    .trim()
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '') || '\uffff';
            const aPrimary = normalizeForSort(a.primaryAssetClass);
            const bPrimary = normalizeForSort(b.primaryAssetClass);
            return aPrimary.localeCompare(bPrimary) * multiplier;
        }
        return 0;
    }), [
        alerts,
        portfolio.totalValue,
        securityActions,
        securityPositions,
        sortColumn,
        sortDirection,
        positionModelWeights,
        stockGroupAssignments,
        stocks,
    ]);

    // Backend-computed allocations (sizing engine + router scores).
    // Keyed by stock id. Falls back to frontend calculation when missing.
    const sizingResult = useSizingAllocations(
        sortedStocks,
        portfolio.totalValue,
        rawOverlayRows,
    );
    const { backendAllocations, routerScoresApplied } = sizingResult;
    useEffect(() => {
        usePanelResearch.getState().publish(backendAllocations, sizingResult.classBudgetsApplied);
    }, [backendAllocations, sizingResult.classBudgetsApplied]);

    // Council runner: all state + async operations for LLM council analysis.
    const councilResult = useCouncilRunner(updateStock, sortedStocks);
    const {
        showGeminiDetails,
        showGptDetails,
        showPerplexityDetails,
        showClaudeDetails,
        showCouncilDetails,
        showTvPtEdit,
        setShowTvPtEdit,
        showResearchPanel,
        setShowResearchPanel,
        councilRunning,
        councilProgress,
        councilProgressStage,
        councilProgressPct,
        councilRunIds,
        councilRunPickerOpen,
        councilRunOptions,
        councilRunOptionsLoading,
        councilError,
        councilSupplementaryFiles,
        analysisNextCatalystByStockId,
        toggleGeminiDetails,
        toggleGptDetails,
        togglePerplexityDetails,
        toggleClaudeDetails,
        toggleCouncilDetails,
        setCouncilSupplementaryFileForKey,
        hasCouncilImportedAnalysis,
        hasCouncilCatalystContent,
        hasCouncilResearchPanelContent,
        toggleCouncilRunPicker,
        loadCouncilRunById,
        loadLatestCouncilRun,
        runCouncilForStock,
        clearCouncilImportedAnalysis,
        openCouncilRunsManager,
        buildCouncilRunOptionLabel,
        councilResolveTickerContext,
        councilParseTicker,
        councilStageLabel,
        councilStageDetail,
        councilDisplayProgressPct,
        sanitizeCouncilCatalystName,
        formatCouncilRunTimestamp,
        shortCouncilRunId,
    } = councilResult;

    const hideEmptyPositionGroups = activeTab === 'POSITIONS' && positionsMode === 'normal';
    // A zero valuation alone is not an exit: unpriced holdings can still have units.
    const positionStocks = sortedStocks.filter(
        (stock) => !stock.isWatchlist && !stock.isExternal &&
            (!hideEmptyPositionGroups || stock.position !== 0 || stock.positionValue !== 0),
    );
    const missingAnalysisExchangeStocks = (
        showNonAllocatingInstruments ? [...sortedStocks, ...nonAllocatingStocks] : sortedStocks
    ).filter(stock =>
        (!analysisEtfsHidden || String(stock.securityType || '').trim().toUpperCase() !== 'ETF') &&
        !getAnalysisExchangeCode(stock),
    );
    const missingAnalysisExchangeCount = missingAnalysisExchangeStocks.length;
    useEffect(() => {
        if (analysisMissingExchangeOnly && missingAnalysisExchangeCount === 0) {
            setAnalysisMissingExchangeOnly(false);
        }
    }, [analysisMissingExchangeOnly, missingAnalysisExchangeCount]);
    const coreETFRatioForStock = (stock: (typeof stocks)[0]) =>
        findByTicker((etfAllocationLedger?.rows || []).filter(row => row.is_core), `${stock.prefix || ''}${stock.symbol || ''}`, row => row.ticker)?.core_ratio_pct;
    const isCoreETFStock = (stock: (typeof stocks)[0]) =>
        coreETFRatioForStock(stock) !== undefined;
    const pinCoreETFsFirst = (
        rows: typeof positionStocks,
    ): typeof positionStocks =>
        [...rows].sort(
            (left, right) =>
                Number(isCoreETFStock(right)) - Number(isCoreETFStock(left)),
        );

    // History tab: all state, fetch effects, and derived memos.
    const historyResult = useHistoryData(activeTab, positionStocks);
    const {
        historyMode,
        setHistoryMode,
        historyPerformanceExpanded,
        setHistoryPerformanceExpanded,
        historyPerformanceRange,
        setHistoryPerformanceRange,
        historySelectedTicker,
        setHistorySelectedTicker,
        historySelectedStockName,
        setHistorySelectedStockName,
        historyStockShowValue,
        setHistoryStockShowValue,
        historySecurityLoading,
        historySecurityError,
        decisionHistoryTickerQuery,
        setDecisionHistoryTickerQuery,
        signalHistoryTickerQuery,
        setSignalHistoryTickerQuery,
        decisions,
        allSignals,
        portfolioPerformance,
        assetClassPerformance,
        securityPerformance,
        performanceEvents,
        filteredDecisions,
        filteredSignals,
        latestPortfolioPerformance,
        historyPerformanceRangeStartMs,
        filteredPortfolioPerformance,
        filteredAssetClassPerformance,
        portfolioPerformanceChartData,
        historyPerformanceEvents,
        portfolioShapeConfirmations,
        assetClassPerformanceShape,
        historyPortfolioSummary,
        historyAssetClassLatestRows,
        filteredSecurityPerformance,
        selectedSecurityLatest,
        selectedSecurityFirst,
        selectedSecurityValueChange,
        selectedSecurityValueChangePct,
        selectedSecurityPriceChange,
        selectedSecurityPriceChangePct,
        selectedSecurityEvents,
        historyPerformanceEventLegendItems,
        historyStockOptions,
    } = historyResult;

    useEffect(() => {
        const openDecisions = (event: Event) => {
            const detail = (event as CustomEvent<{ ticker?: string }>).detail;
            setDecisionHistoryTickerQuery(detail?.ticker || '');
            setHistoryMode('signals');
            navigateToTab('HISTORY');
        };
        window.addEventListener(DECISION_HISTORY_REQUESTED, openDecisions);
        return () => window.removeEventListener(DECISION_HISTORY_REQUESTED, openDecisions);
    }, [navigateToTab, setHistoryMode, setDecisionHistoryTickerQuery]);

    useEffect(() => {
        const openHistory = (event: Event) => {
            const detail = (event as CustomEvent<SecurityNavigationDetail>).detail;
            if (!detail?.ticker) return;
            setHistorySelectedTicker(detail.ticker);
            setHistorySelectedStockName(detail.name || detail.ticker);
            setHistoryMode('stock');
            navigateToTab('HISTORY');
        };
        window.addEventListener(SECURITY_HISTORY_REQUESTED, openHistory);
        return () => window.removeEventListener(SECURITY_HISTORY_REQUESTED, openHistory);
    }, [navigateToTab, setHistoryMode, setHistorySelectedTicker, setHistorySelectedStockName]);

    useEffect(() => {
        const status = String(
            overlaySummary?.active_event_status || '',
        ).toUpperCase();
        const expectedReserve = overlaySummary?.stage1_expected_reserve_value || 0;
        const importedReserve =
            overlaySummary?.portfolio_cash_bucket_value ?? portfolio.cashOnHand ?? 0;
        const reserveShortfall = Math.max(0, expectedReserve - importedReserve);
        const wasPreviouslyLocked =
            (overlaySummary?.stage1_recorded_reduction_value || 0) > 1;
        const hasRecoverySource =
            (overlayReconciliation?.source_checks || []).length > 0;

        if (
            status !== 'PARTIAL' ||
            reviewRecoveryContext ||
            reserveShortfall <= 1 ||
            !wasPreviouslyLocked ||
            !hasRecoverySource
        ) {
            return;
        }

        const stockById = new Map(positionStocks.map((stock) => [stock.id, stock]));
        const stockByName = new Map(
            positionStocks.map(
                (stock) => [stock.name.trim().toLowerCase(), stock] as const,
            ),
        );
        const cutInputs: Record<number, string> = {};
        let restoredCutTotal = 0;
        let restoredCutCount = 0;

        for (const source of overlayReconciliation?.source_checks || []) {
            const stock =
                (source.holding_id != null
                    ? stockById.get(Number(source.holding_id))
                    : null) ||
                stockByName.get(source.stock_name.trim().toLowerCase());
            if (!stock) continue;

            const expectedReduction = Math.max(0, source.expected_reduction || 0);
            const actualReduction = Math.max(0, source.actual_reduction || 0);
            const varianceOutstanding = Math.max(0, source.variance || 0);
            const outstandingCut = Math.min(
                stock.positionValue || 0,
                expectedReduction > 0
                    ? Math.max(
                          0,
                          expectedReduction - actualReduction,
                          Math.min(expectedReduction, varianceOutstanding),
                      )
                    : varianceOutstanding,
            );
            if (outstandingCut <= 1) continue;
            const roundedCut = Math.round(outstandingCut);
            cutInputs[stock.id] = String(roundedCut);
            restoredCutTotal += roundedCut;
            restoredCutCount += 1;
        }

        if (restoredCutTotal <= 1) return;

        const recoveryContext: ReviewRecoveryContext = {
            eventId: overlayReconciliation?.event_id ?? overlaySummary?.active_event_id,
            createdAt: new Date().toISOString(),
            reserveShortfall,
            previousRequiredReduction:
                overlaySummary?.stage1_required_reduction_value ||
                reserveShortfall,
            previousRecordedReduction:
                overlaySummary?.stage1_recorded_reduction_value || restoredCutTotal,
            expectedReserveValue: expectedReserve,
            importedReserveValue: importedReserve,
            restoredCutTotal,
            restoredCutCount,
        };
        const savedAt = new Date().toISOString();
        localStorage.setItem(
            'terminal-review-recovery',
            JSON.stringify(recoveryContext),
        );
        if (Object.keys(reviewCutInputs).length === 0) {
            localStorage.setItem(
                'terminal-review-draft',
                JSON.stringify({
                    cutInputs,
                    savedAt,
                    stage1CompletedAt: null,
                    cashMovementRecord: null,
                }),
            );
            setReviewCutInputs(cutInputs);
            setReviewDraftSavedAt(savedAt);
        }
        setReviewRecoveryContext(recoveryContext);
    }, [
        overlayReconciliation,
        overlaySummary,
        portfolio.cashOnHand,
        positionStocks,
        reviewCutInputs,
        reviewRecoveryContext,
    ]);

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            // Cycle through: desc → asc → null
            if (sortDirection === 'desc') {
                setSortDirection('asc');
            } else if (sortDirection === 'asc') {
                setSortColumn(null);
                setSortDirection(null);
            }
        } else {
            // New column, start with desc
            setSortColumn(column);
            setSortDirection('desc');
        }
    };

    const handlePositionAssetClassOrder = (
        order: PositionAssetClassOrder,
    ) => {
        if (order === 'saved') {
            setPositionAssetClassOrder('saved');
            setPositionAssetClassOrderDirection('desc');
            return;
        }
        if (positionAssetClassOrder === order) {
            setPositionAssetClassOrderDirection((direction) =>
                direction === 'desc' ? 'asc' : 'desc',
            );
            return;
        }
        setPositionAssetClassOrder(order);
        setPositionAssetClassOrderDirection('desc');
    };

    const toggleCashEdit = (assetClassCode: string, currentCash: number) => {
        if (editingCashAssetClass === assetClassCode) {
            handleCashCancel();
            return;
        }
        setEditingCashAssetClass(assetClassCode);
        setCashInput(Math.round(currentCash || 0).toString());
        setCashSourceType('PORTFOLIO_CASH_TRANSFER');
        setCashNote('');
        setCashIntentError(null);
    };

    const handleCashSave = async (assetClassCode: string) => {
        const cashValue = Math.round(parseFloat(cashInput) || 0);
        if (cashValue < 0) {
            setCashIntentError('Target sleeve cash cannot be negative.');
            return;
        }
        setCashSaving(true);
        setCashIntentError(null);
        try {
            const response = await api.createCashMovement({
                asset_class_code: assetClassCode,
                target_cash_reserve: cashValue,
                source_type: cashSourceType,
                note: cashNote.trim() || undefined,
            });
            const updated = response.asset_class_config;
            setAssetClassConfig((prev) =>
                prev.map((setting) =>
                    normalizeAssetClassCode(setting.key) ===
                    normalizeAssetClassCode(assetClassCode)
                        ? updated
                        : setting,
                ),
            );
            handleCashCancel();
            window.dispatchEvent(new CustomEvent('asset-class-cash-updated'));
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to update cash reserve:', error);
            setCashIntentError(
                error instanceof Error
                    ? error.message
                    : 'Failed to record cash movement.',
            );
        } finally {
            setCashSaving(false);
        }
    };

    const handleCashCancel = () => {
        setEditingCashAssetClass(null);
        setCashInput('');
        setCashSourceType('PORTFOLIO_CASH_TRANSFER');
        setCashNote('');
        setCashIntentError(null);
    };

    const toggleColumn = (column: keyof PositionVisibleColumns) => {
        const setColumns = isPortfolioRebalanceMode
            ? setPortfolioVisibleColumns
            : setVisibleColumns;
        const storageKey = isPortfolioRebalanceMode
            ? 'terminal-portfolio-visible-columns'
            : POSITION_VISIBLE_COLUMNS_STORAGE_KEY;
        setColumns((prev) => {
            const newColumns = { ...prev, [column]: !prev[column] };
            if (typeof window !== 'undefined') {
                localStorage.setItem(storageKey, JSON.stringify(newColumns));
            }
            return newColumns;
        });
    };

    const toggleRiskDropdown = (ticker: string, event: React.MouseEvent) => {
        const button = event.currentTarget as HTMLElement;
        const rect = button.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const position = spaceBelow < 200 ? 'above' : 'below';
        setDropdownPosition((prev) => ({
            ...prev,
            [`risk-${ticker}`]: position,
        }));
        setShowRiskDropdown((prev) => ({ ...prev, [ticker]: !prev[ticker] }));
    };

    const handleRiskProfileUpdate = async (
        stockId: number,
        analysisId: number | undefined,
        riskProfile: 'RISK_ON' | 'RISK_OFF' | null,
    ) => {
        updateStock(stockId, { riskProfile });
        setShowRiskDropdown({});
        if (!analysisId) {
            console.error('[ALPHA EDGE] Cannot update risk profile: no analysisId for stock', stockId);
            return;
        }
        try {
            await api.updateAnalysis(analysisId, { risk_profile: riskProfile });
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to update risk profile:', error);
        }
    };

    const loadListingReviews = useCallback(async () => {
        setListingReviewsLoading(true);
        setListingReviewsError(null);
        try {
            setListingReviews(await api.getListingReviews());
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to load listing reviews:', error);
            setListingReviewsError(
                error instanceof Error ? error.message : 'Failed to load listing reviews',
            );
        } finally {
            setListingReviewsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'ANALYSIS') {
            void loadListingReviews();
        }
    }, [activeTab, loadListingReviews]);

    const handleRefreshPrices = async () => {
        setRefreshingPrices(true);
        try {
            const result = await api.refreshWatchlistPrices();
            if (result.errors && result.errors.length > 0) {
                console.warn('[ALPHA EDGE] Some prices failed to update:', result.errors);
            }
            await Promise.all([fetchHoldings(), loadListingReviews()]);
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to refresh prices:', error);
        } finally {
            setRefreshingPrices(false);
        }
    };

    const handleAddWatchlistStock = async () => {
        const cleanName = newStockName.trim();
        const cleanTicker = newStockTicker.trim().toUpperCase();
        if (!cleanName || !cleanTicker) {
            setAddStockError('Name and ticker are required');
            return;
        }

        const fullTicker = cleanTicker.includes(':') ? cleanTicker : `ASX:${cleanTicker}`;
        setAddingStock(true);
        setAddStockError('');
        try {
            await api.upsertAnalysis({
                name: cleanName,
                ticker: fullTicker,
                is_watchlist: true,
            });
            setShowAddStockModal(false);
            setNewStockName('');
            setNewStockTicker('');
            await fetchHoldings();
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to add watchlist stock:', error);
            setAddStockError(error instanceof Error ? error.message : 'Failed to add watchlist stock');
        } finally {
            setAddingStock(false);
        }
    };

    const ungroupedStocks = pinCoreETFsFirst(
        positionStocks.filter((stock) => !stockGroupAssignments[stock.name]),
    );

    const assetClassConfigMap = new Map(
        assetClassConfig.map(
            (setting) =>
                [normalizeAssetClassCode(setting.key), setting] as const,
        ),
    );
    const assetClassMap = useMemo(
        () => {
            const map = new Map<string, AssetClass>();
            const add = (key: string | null | undefined, sleeve: AssetClass) => {
                const normalized = normalizeAssetClassCode(key);
                if (normalized && !map.has(normalized)) {
                    map.set(normalized, sleeve);
                }
            };

            assetClasses.forEach((sleeve) => add(sleeve.code, sleeve));
            assetClasses.forEach((sleeve) => add(sleeve.asset_class_code, sleeve));

            return map;
        },
        [assetClasses],
    );

    const getAssetClassSetting = (
        code?: string | null,
    ): AssetClassConfig | null => {
        const normalized = normalizeAssetClassCode(code);
        return assetClassConfigMap.get(normalized) || null;
    };

    const getPortfolioAssetClassParentGroup = (
        code?: string | null,
        fallbackLabel?: string | null,
    ): string => {
        const normalized = normalizeAssetClassCode(code);
        const matchingGroup = groups.find(
            (group) => getNamedGroupAssetClassCode(group) === normalized,
        );

        if (matchingGroup) {
            let topGroup = matchingGroup;
            let currentParentId = matchingGroup.parent_id || null;
            const visited = new Set<string>([matchingGroup.id]);

            while (currentParentId && !visited.has(currentParentId)) {
                const parent = groups.find((group) => group.id === currentParentId);
                if (!parent) break;
                topGroup = parent;
                visited.add(parent.id);
                currentParentId = parent.parent_id || null;
            }

            const topLabel = String(topGroup.name || '').trim();
            if (topLabel) return topLabel;
        }

        return String(fallbackLabel || normalized || 'Misc').trim();
    };

    const formatAssetClassLabel = (code?: string | null): string => {
        const normalized = normalizeAssetClassCode(code);
        if (!normalized || normalized === 'UNASSIGNED') return '—';
        const sleeve = assetClassMap.get(normalized);
        if (sleeve?.display_name) {
            return sleeve.display_name.toUpperCase();
        }
        const setting = getAssetClassSetting(normalized);
        if (setting?.display_name) {
            return setting.display_name.toUpperCase();
        }
        if (normalized === 'BASEMETALS') return 'BASE METALS';
        if (normalized === 'SEMICONDUCTORS') return 'SEMICONDUCTORS';
        return normalized;
    };

    const getAssetClassCashReserve = (code?: string | null): number => {
        const setting = getAssetClassSetting(code);
        return setting?.cash_reserve || 0;
    };

    const getStockAssetClassCode = (stock: (typeof stocks)[0]): string => {
        if (stock.primaryAssetClass)
            return normalizeAssetClassCode(stock.primaryAssetClass);
        if (
            String(stock.securityType || '')
                .trim()
                .toUpperCase() === 'ETF'
        ) {
            return 'ETF';
        }
        return 'UNASSIGNED';
    };
    const unassignedPortfolioStocks = ungroupedStocks.filter(
        (stock) => getStockAssetClassCode(stock) === 'UNASSIGNED',
    );

    const getBucketMetaForAssetClass = (
        assetClassCode?: string | null,
    ): {
        bucket: PositionBucketKey;
        label: string;
        parentBucket: PositionBucketKey | null;
    } => {
        const normalized = normalizeAssetClassCode(assetClassCode);
        if (normalized === 'CASH') {
            return {
                bucket: 'cash_reserve',
                label: 'Cash/Reserve',
                parentBucket: null,
            };
        }
        const setting = getAssetClassSetting(normalized);
        if (!setting) {
            return {
                bucket: 'q1_exempt',
                label: 'Q1-Exempt',
                parentBucket: null,
            };
        }
        if (!setting.overlay_eligible) {
            return {
                bucket: 'q1_exempt',
                label: 'Q1-Exempt',
                parentBucket: null,
            };
        }
        if (setting.q3_beneficiary) {
            return {
                bucket: 'partial_q1',
                label: 'Q1-Defensive',
                parentBucket: 'q1',
            };
        }
        return { bucket: 'full_q1', label: 'Q1', parentBucket: null };
    };

    const getGroupDirectStocks = (groupId: string) =>
        pinCoreETFsFirst(
            positionStocks.filter(
                (stock) => stockGroupAssignments[stock.name] === groupId,
            ),
        );

    const getGroupStocksRecursive = (
        groupId: string,
    ): typeof positionStocks => {
        const directStocks = getGroupDirectStocks(groupId);
        const childGroups = groups.filter((g) => g.parent_id === groupId);
        return childGroups.reduce<typeof positionStocks>(
            (acc, child) => {
                acc.push(...getGroupStocksRecursive(child.id));
                return acc;
            },
            [...directStocks],
        );
    };

    const calculateStatsForStocks = (stocksForStats: typeof positionStocks) => {
        const assetClassCodes = new Set(
            stocksForStats.map((stock) => getStockAssetClassCode(stock)),
        );

        return stocksForStats.reduce(
            (acc, stock) => ({
                marketValue: acc.marketValue + (stock.positionValue || 0),
                bookValue: acc.bookValue + (stock.bookValue || 0),
                cashReserve: acc.cashReserve,
                plDollar: acc.plDollar + (stock.changeValue || 0),
            }),
            {
                marketValue: 0,
                bookValue: 0,
                cashReserve: Array.from(assetClassCodes).reduce(
                    (sum, code) => sum + getAssetClassCashReserve(code),
                    0,
                ),
                plDollar: 0,
            },
        );
    };

    const getGroupAssetClassCode = (group: StockGroup): string => {
        const explicitCode = normalizeAssetClassCode(group.asset_class_code);
        if (explicitCode && explicitCode !== 'UNASSIGNED') {
            return explicitCode;
        }
        const legacyNameCode = normalizeAssetClassCode(group.name);
        if (
            legacyNameCode !== 'UNASSIGNED' &&
            assetClassMap.has(legacyNameCode)
        ) {
            return legacyNameCode;
        }
        const descendantStocks = getGroupStocksRecursive(group.id);
        const fromHeldStocks = descendantStocks.find(
            (stock) => getStockAssetClassCode(stock) !== 'UNASSIGNED',
        );
        return fromHeldStocks
            ? getStockAssetClassCode(fromHeldStocks)
            : explicitCode;
    };

    const getNamedGroupAssetClassCode = (group: StockGroup): string | null => {
        const explicitCode = normalizeAssetClassCode(group.asset_class_code);
        if (explicitCode && explicitCode !== 'UNASSIGNED') {
            return explicitCode;
        }
        const legacyNameCode = normalizeAssetClassCode(group.name);
        return legacyNameCode !== 'UNASSIGNED' &&
            assetClassMap.has(legacyNameCode)
            ? legacyNameCode
            : null;
    };

    const getPositionAppearanceClassCode = (group: StockGroup): string | null => {
        const mapped = getNamedGroupAssetClassCode(group);
        if (!mapped) return null;
        return positionRowClassKey(group.asset_class_code || assetClassMap.get(mapped)?.code) || null;
    };

    const getPortfolioAlignmentAssetClassCode = useCallback(
        (value?: string | null): string => {
            const code = normalizeAssetClassCode(value);
            if (!code || code === 'UNASSIGNED' || code === 'CASH') return code;
            const sleeve = assetClassMap.get(code);
            return normalizeAssetClassCode(sleeve?.code) || code;
        },
        [assetClassMap],
    );

    const getEditableAssetClassCodeForGroup = (
        group: StockGroup,
    ): string | null => {
        const explicitCode = normalizeAssetClassCode(group.asset_class_code);
        if (explicitCode && explicitCode !== 'UNASSIGNED') {
            return explicitCode;
        }
        const legacyNameCode = normalizeAssetClassCode(group.name);
        if (
            legacyNameCode !== 'UNASSIGNED' &&
            assetClassMap.has(legacyNameCode)
        ) {
            return legacyNameCode;
        }

        const descendantCodes = Array.from(
            new Set(
                getGroupStocksRecursive(group.id)
                    .map((stock) => getStockAssetClassCode(stock))
                    .filter((code) => code !== 'UNASSIGNED' && code !== 'CASH'),
            ),
        );

        return descendantCodes.length === 1 ? descendantCodes[0] : null;
    };

    const ensurePortfolioTargetGroups = (): number => {
        const targetRows =
            portfolioAdjustmentPlan?.rows?.map((row) => ({
                key: normalizeAssetClassCode(row.key),
                label: row.label,
                currentWeightPct: row.current_weight_pct || 0,
                targetWeightPct: row.target_weight_pct || 0,
            })) ||
            portfolioRowsSorted.map((row) => ({
                key: normalizeAssetClassCode(row.asset_class),
                label:
                    row.display_name ||
                    getAssetClassSetting(row.asset_class)?.display_name ||
                    row.asset_class,
                currentWeightPct: row.current_weight_pct || 0,
                targetWeightPct: row.target_weight_pct || 0,
            }));

        const existingNamedGroupCodes = new Set(
            groups
                .map((group) => getNamedGroupAssetClassCode(group))
                .filter(Boolean) as string[],
        );
        const rowsToAdd = targetRows.filter((row) => {
            if (!row.key || row.key === 'UNASSIGNED' || row.key === 'CASH') {
                return false;
            }
            if (existingNamedGroupCodes.has(row.key)) return false;
            return row.targetWeightPct > 0;
        });

        if (rowsToAdd.length === 0) return 0;

        const now = Date.now();
        const highestOrder = groups.reduce(
            (max, group) => Math.max(max, group.order || 0),
            groups.length,
        );
        const addedGroups = rowsToAdd.map((row, index): StockGroup => {
            const setting = getAssetClassSetting(row.key);
            const name =
                String(row.label || setting?.display_name || row.key).trim() ||
                row.key;
            const idSlug = row.key.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            return {
                id: `portfolio-target-${idSlug}-${now + index}`,
                name,
                asset_class_code: row.key,
                collapsed: true,
                order: highestOrder + index + 1,
                parent_id: null,
            };
        });

        const updatedGroups = [...groups, ...addedGroups];
        setGroups(updatedGroups);
        void saveGroupsToBackend(updatedGroups, stockGroupAssignments);
        return addedGroups.length;
    };

    const removePendingPortfolioTargetGroups = (): number => {
        const assignedGroupIds = new Set(Object.values(stockGroupAssignments));
        const parentGroupIds = new Set(
            groups.map((group) => group.parent_id).filter(Boolean) as string[],
        );
        const removableIds = new Set(
            groups
                .filter(
                    (group) =>
                        group.id.startsWith('portfolio-target-') &&
                        !assignedGroupIds.has(group.id) &&
                        !parentGroupIds.has(group.id),
                )
                .map((group) => group.id),
        );

        if (removableIds.size === 0) return 0;

        const updatedGroups = groups.filter(
            (group) => !removableIds.has(group.id),
        );
        setGroups(updatedGroups);
        void saveGroupsToBackend(updatedGroups, stockGroupAssignments);
        return removableIds.size;
    };

    const topLevelGroups = groups
        .filter((g) => !g.parent_id)
        .sort((a, b) => {
            const aCode = getGroupAssetClassCode(a);
            const bCode = getGroupAssetClassCode(b);
            const aSetting = getAssetClassSetting(aCode);
            const bSetting = getAssetClassSetting(bCode);
            const aOrder = aSetting?.display_order ?? a.order;
            const bOrder = bSetting?.display_order ?? b.order;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.order - b.order;
        });

    const bucketStocksMap = positionStocks.reduce<
        Record<PositionBucketKey, typeof positionStocks>
    >(
        (acc, stock) => {
            const bucket = getBucketMetaForAssetClass(
                getStockAssetClassCode(stock),
            ).bucket;
            acc[bucket].push(stock);
            return acc;
        },
        {
            q1: [],
            full_q1: [],
            partial_q1: [],
            q1_exempt: [],
            cash_reserve: [],
        },
    );

    const portfolioMixCashRow = portfolioMix?.rows?.find(
        (row) => normalizeAssetClassCode(row.asset_class) === 'CASH',
    );
    const portfolioMixUnassignedRow = portfolioMix?.rows?.find(
        (row) => normalizeAssetClassCode(row.asset_class) === 'UNASSIGNED',
    );
    const portfolioCashBucketValue =
        portfolioMixCashRow?.value ??
        overlaySummary?.portfolio_cash_bucket_value ??
        portfolio.cashOnHand ??
        0;

    const bucketStats = {
        q1: calculateStatsForStocks([
            ...bucketStocksMap.full_q1,
            ...bucketStocksMap.partial_q1,
        ]),
        full_q1: calculateStatsForStocks(bucketStocksMap.full_q1),
        partial_q1: calculateStatsForStocks(bucketStocksMap.partial_q1),
        q1_exempt: calculateStatsForStocks(bucketStocksMap.q1_exempt),
        cash_reserve: {
            marketValue: 0,
            bookValue: 0,
            cashReserve: portfolioCashBucketValue,
            plDollar: 0,
        },
    };
    const topLevelGroupsByBucket = topLevelGroups.reduce<
        Record<PositionBucketKey, StockGroup[]>
    >(
        (acc, group) => {
            const bucket = getBucketMetaForAssetClass(
                getGroupAssetClassCode(group),
            ).bucket;
            acc[bucket].push(group);
            return acc;
        },
        {
            q1: [],
            full_q1: [],
            partial_q1: [],
            q1_exempt: [],
            cash_reserve: [],
        },
    );

    const ungroupedStocksByBucket = ungroupedStocks.reduce<
        Record<PositionBucketKey, typeof positionStocks>
    >(
        (acc, stock) => {
            const bucket = getBucketMetaForAssetClass(
                getStockAssetClassCode(stock),
            ).bucket;
            acc[bucket].push(stock);
            return acc;
        },
        {
            q1: [],
            full_q1: [],
            partial_q1: [],
            q1_exempt: [],
            cash_reserve: [],
        },
    );

    // Helper function to calculate total value for a group including all descendants
    const calculateGroupTotal = (groupId: string): number => {
        // Get stocks directly in this group (exclude watchlist items)
        const directStocks = positionStocks.filter(
            (stock) => stockGroupAssignments[stock.name] === groupId,
        );
        const directTotal = directStocks.reduce(
            (sum, stock) => sum + stock.positionValue,
            0,
        );

        // Get all child groups and recursively calculate their totals
        const childGroups = groups.filter((g) => g.parent_id === groupId);
        const childrenTotal = childGroups.reduce(
            (sum, child) => sum + calculateGroupTotal(child.id),
            0,
        );

        return directTotal + childrenTotal;
    };

    // Helper function to calculate aggregate stats for a group including all descendants
    const calculateGroupStats = (
        groupId: string,
    ): {
        marketValue: number;
        bookValue: number;
        cashReserve: number;
        plDollar: number;
    } => calculateStatsForStocks(getGroupStocksRecursive(groupId));

    // Helper function to calculate total stock count for a group including all descendants
    const calculateGroupStockCount = (groupId: string): number => {
        // Get stocks directly in this group (exclude watchlist items)
        const directStocks = positionStocks.filter(
            (stock) => stockGroupAssignments[stock.name] === groupId,
        );
        const directCount = directStocks.length;

        // Get all child groups and recursively calculate their counts
        const childGroups = groups.filter((g) => g.parent_id === groupId);
        const childrenCount = childGroups.reduce(
            (sum, child) => sum + calculateGroupStockCount(child.id),
            0,
        );

        return directCount + childrenCount;
    };

    const calculateGroupMarketValue = (groupId: string): number =>
        calculateGroupStats(groupId).marketValue;

    const getBucketSummaryText = (_bucket: PositionBucketKey): string | null =>
        null;

    const getLeafGroupLabel = (group: StockGroup): string => {
        const childGroups = groups.filter((g) => g.parent_id === group.id);
        const count = calculateGroupStockCount(group.id);
        if (childGroups.length === 0 && count > 0) {
            return `${group.name} (${count})`;
        }
        return group.name;
    };

    const getStockAssetDisplay = (stock: (typeof stocks)[0]): string => {
        const code = getStockAssetClassCode(stock);
        if (!code || code === 'UNASSIGNED') return '—';
        return code;
    };

    const getImmediateParentMarketValueForStock = (
        stock: (typeof stocks)[0],
    ): number | null => {
        const groupId = stockGroupAssignments[stock.name];
        if (groupId) {
            return calculateGroupMarketValue(groupId);
        }
        const bucket = getBucketMetaForAssetClass(
            getStockAssetClassCode(stock),
        ).bucket;
        return bucketStats[bucket].marketValue || null;
    };

    const getClassPercentForStock = (
        stock: (typeof stocks)[0],
    ): number | null => {
        const parentMarketValue = getImmediateParentMarketValueForStock(stock);
        if (!parentMarketValue || parentMarketValue <= 0) return null;
        return (stock.positionValue / parentMarketValue) * 100;
    };

    const getClassPercentForGroup = (group: StockGroup): number | null => {
        const groupMarketValue = calculateGroupMarketValue(group.id);
        if (groupMarketValue <= 0) return null;
        if (group.parent_id) {
            const parentMarketValue = calculateGroupMarketValue(
                group.parent_id,
            );
            return parentMarketValue > 0
                ? (groupMarketValue / parentMarketValue) * 100
                : null;
        }
        const bucket = getBucketMetaForAssetClass(
            getGroupAssetClassCode(group),
        ).bucket;
        const bucketMarketValue = bucketStats[bucket].marketValue;
        return bucketMarketValue > 0
            ? (groupMarketValue / bucketMarketValue) * 100
            : null;
    };

    const getBucketClassPercent = (
        bucket: PositionBucketKey,
    ): number | null => {
        if (
            bucket === 'full_q1' ||
            bucket === 'partial_q1'
        ) {
            return bucketStats.q1.marketValue > 0
                ? (bucketStats[bucket].marketValue /
                      bucketStats.q1.marketValue) *
                      100
                : null;
        }
        return null;
    };

    const sortPositionGroupsForActiveColumn = (
        groupsToSort: StockGroup[],
    ): StockGroup[] => {
        const orderedGroups = [...groupsToSort];
        if (positionAssetClassOrder !== 'saved') {
            const getAssetClassShape = (group: StockGroup) => {
                const stats = calculateGroupStats(group.id);
                const currentPortfolioPct =
                    portfolio.totalValue > 0
                        ? (stats.marketValue / portfolio.totalValue) * 100
                        : 0;
                return resolvePositionAssetClassShape({
                    assetClassCode: getNamedGroupAssetClassCode(group),
                    currentRows: portfolioMix?.rows,
                    approvedRows: approvedPortfolioMix?.rows,
                    fallbackCurrentPct: currentPortfolioPct,
                });
            };

            return orderedGroups.sort((a, b) => {
                const diff = comparePositionAssetClassShapes(
                    getAssetClassShape(a),
                    getAssetClassShape(b),
                    positionAssetClassOrder,
                    positionAssetClassOrderDirection,
                );
                if (Math.abs(diff) > 0.0001) return diff;
                const orderDiff = (a.order || 0) - (b.order || 0);
                if (orderDiff !== 0) return orderDiff;
                return a.name.localeCompare(b.name);
            });
        }
        if (
            !sortDirection ||
            (sortColumn !== 'CLASS_PERCENT' &&
                sortColumn !== 'PORTFOLIO_PERCENT')
        ) {
            return orderedGroups;
        }

        const multiplier = sortDirection === 'desc' ? 1 : -1;
        const getSortValue = (group: StockGroup) => {
            if (sortColumn === 'CLASS_PERCENT') {
                return getClassPercentForGroup(group) ?? 0;
            }
            const stats = calculateGroupStats(group.id);
            return portfolio.totalValue > 0
                ? (stats.marketValue / portfolio.totalValue) * 100
                : 0;
        };

        return orderedGroups.sort((a, b) => {
            const diff = (getSortValue(b) - getSortValue(a)) * multiplier;
            if (Math.abs(diff) > 0.0001) return diff;
            const orderDiff = (a.order || 0) - (b.order || 0);
            if (orderDiff !== 0) return orderDiff;
            return a.name.localeCompare(b.name);
        });
    };

    const money = (value?: number | null): string =>
        `$${Math.round(value || 0).toLocaleString()}`;

    const signedMoney = (value?: number | null): string => {
        const rounded = Math.round(value || 0);
        if (rounded === 0) return '$0';
        const sign = rounded > 0 ? '+' : '-';
        return `${sign}$${Math.abs(rounded).toLocaleString()}`;
    };

    const pct1 = (value?: number | null): string =>
        `${(value || 0).toFixed(1)}%`;

    const pct0 = (value?: number | null): string =>
        `${Math.round(value || 0)}%`;

    const formatRegimeDateTime = (value?: string | null): string => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return new Intl.DateTimeFormat('en-AU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(date);
    };
    const formatPortfolioTargetTitle = (value?: string | null): string =>
        (value || 'Portfolio Target')
            .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}$/u, '')
            .trim() || 'Portfolio Target';
    const getOrdinalSuffix = (day: number): string => {
        if (day >= 11 && day <= 13) return 'th';
        switch (day % 10) {
            case 1:
                return 'st';
            case 2:
                return 'nd';
            case 3:
                return 'rd';
            default:
                return 'th';
        }
    };

    const getLeafGroupsForRegime = (group: StockGroup): StockGroup[] => {
        const children = groups.filter((g) => g.parent_id === group.id);
        if (children.length === 0) return [group];
        return children.flatMap((child) => getLeafGroupsForRegime(child));
    };

    const getGroupStatsForRegime = (group: StockGroup) =>
        calculateStatsForStocks(getGroupStocksRecursive(group.id));

    const getGroupSummaryLabelForRegime = (group: StockGroup): string => {
        const leaves = getLeafGroupsForRegime(group).filter(
            (leaf) => calculateGroupStockCount(leaf.id) > 0,
        );

        if (leaves.length === 0) {
            return formatAssetClassLabel(getGroupAssetClassCode(group));
        }

        if (leaves.length === 1 && leaves[0].id === group.id) {
            return formatAssetClassLabel(getGroupAssetClassCode(group));
        }

        return leaves.map((leaf) => leaf.name.toUpperCase()).join(' · ');
    };

    const getGroupAssetCodesForRegime = (group: StockGroup): string[] => {
        const codes = new Set(
            getGroupStocksRecursive(group.id)
                .map((stock) => getStockAssetClassCode(stock))
                .filter((code) => code !== 'UNASSIGNED' && code !== 'CASH'),
        );

        if (codes.size === 0) {
            const fallback = getEditableAssetClassCodeForGroup(group);
            if (fallback && fallback !== 'UNASSIGNED' && fallback !== 'CASH') {
                codes.add(fallback);
            }
        }

        return Array.from(codes);
    };

    const getGroupStage1InvestedValue = (group: StockGroup): number => {
        const assetCodes = getGroupAssetCodesForRegime(group);
        if (assetCodes.length === 0) return getGroupStatsForRegime(group).marketValue;

        const fallbackCurrent = getGroupStatsForRegime(group).marketValue;
        const total = assetCodes.reduce((sum, code) => {
            const row = overlayRowsByCode.get(code);
            if (!row) return sum;
            if (!isQ4DReviewSignal && row.overlay_eligible === false) {
                return sum + (row.actual_invested_value ?? row.invested_value ?? 0);
            }
            return (
                sum +
                (row.allowed_invested_value ??
                    row.actual_invested_value ??
                    row.invested_value ??
                    0)
            );
        }, 0);

        return total > 0 ? total : fallbackCurrent;
    };

    const getGroupStage1Percent = (group: StockGroup): number => {
        const totalPortfolioValue = portfolio.totalValue || 0;
        if (totalPortfolioValue <= 0) return 0;
        return (getGroupStage1InvestedValue(group) / totalPortfolioValue) * 100;
    };

    const getRegimeStage1Status = () => {
        const reducePct = overlaySummary?.required_de_risk_pct || 0;
        const headroomPct = overlaySummary?.available_headroom_pct || 0;
        if (reducePct > 0.05) {
            return {
                badge: 'Pending',
                badgeClass:
                    'border-warning/40 bg-warning/10 text-warning',
                note: `Reduce eligible book by ${pct1(reducePct)}`,
                value: money(overlaySummary?.required_de_risk_value || 0),
            };
        }
        if (headroomPct > 0.05) {
            return {
                badge: 'No Action',
                badgeClass: 'border-primary/40 bg-primary/10 text-success',
                note: 'No forced move',
                value: money(0),
            };
        }
        return {
            badge: 'No Action',
            badgeClass: 'border-primary/40 bg-primary/10 text-success',
            note: 'No forced move',
            value: money(0),
        };
    };

    const getRegimeStage2Status = () => {
        const status = String(overlaySummary?.active_event_status || '').toUpperCase();
        if (overlaySummary?.can_complete_stage2 || status === 'STAGE1_DONE') {
            return {
                badge: 'Ready',
                badgeClass:
                    'border-warning/40 bg-warning/10 text-warning',
            };
        }
        if (status === 'PENDING' || status === 'PARTIAL') {
            return {
                badge: 'Waiting',
                badgeClass:
                    'border-border/60 bg-background/40 text-muted-foreground',
            };
        }
        return {
            badge: 'Done',
            badgeClass: 'border-primary/40 bg-primary/10 text-success',
        };
    };

    const getRegimeStage3Status = () => {
        if (overlaySummary?.can_accept_baseline) {
            return {
                badge: 'Ready',
                badgeClass:
                    'border-warning/40 bg-warning/10 text-warning',
            };
        }
        if (overlaySummary?.last_applied_at) {
            return {
                badge: 'Baselined',
                badgeClass: 'border-primary/40 bg-primary/10 text-success',
            };
        }
        return {
            badge: 'Unset',
            badgeClass:
                'border-border/60 bg-background/40 text-muted-foreground',
        };
    };

    const getSleeveStage1Move = (group: StockGroup) => {
        const bucket = getBucketMetaForAssetClass(
            getGroupAssetClassCode(group),
        ).bucket;
        const currentValue = getGroupStatsForRegime(group).marketValue;
        const afterStage1Value = getGroupStage1InvestedValue(group);
        const delta = afterStage1Value - currentValue;

        if (Math.abs(delta) < 1) {
            return {
                title: 'No move',
                subtitle: 'Aligned',
                valueClass: 'text-foreground',
                subtitleClass: 'text-muted-foreground',
            };
        }

        if (delta < 0) {
            return {
                title: `Trim ${money(Math.abs(delta))}`,
                subtitle: 'Reduce',
                valueClass: 'text-warning',
                subtitleClass: 'text-warning/80',
            };
        }

        return {
            title: `Available ${money(delta)}`,
            subtitle: 'No action',
            valueClass: 'text-primary',
            subtitleClass: 'text-primary/80',
        };
    };

    // Helper function to get active BREAKOUT alert for a stock
    const getActiveBreakout = (stock: (typeof stocks)[0]) => {
        if (!stock.symbol) return null;
        const breakoutAlerts = alerts.filter(
            (alert) =>
                alert.symbol === stock.symbol &&
                alert.alert_type === 'BREAKOUT' &&
                alert.expiry_date &&
                new Date(alert.expiry_date) > new Date(),
        );
        if (breakoutAlerts.length === 0) return null;
        // Return the most recent active breakout
        return breakoutAlerts.sort(
            (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
        )[0];
    };

    // Helper function to calculate days remaining until expiry
    const getDaysRemaining = (expiryDate: Date) => {
        const now = new Date();
        const diffTime = expiryDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const isPositionAdjustmentMode =
        activeTab === 'POSITIONS' && positionsMode === 'review';
    const isPortfolioTargetAdjustmentMode =
        activeTab === 'POSITIONS' &&
        positionsMode === 'review' &&
        activeAdjustmentSource === 'portfolio_target' &&
        Boolean(portfolioRebalancePlan);
    const isSignalAdjustmentMode =
        isPositionAdjustmentMode && !isPortfolioTargetAdjustmentMode;
    const isPortfolioReviewMode =
        isPositionAdjustmentMode;
    const isPortfolioRebalanceMode =
        activeTab === 'PORTFOLIO' && portfolioMode === 'workflow';
    const usesPortfolioAdjustmentModel =
        isPortfolioTargetAdjustmentMode || isPortfolioRebalanceMode;
    const isPositionsTableTab =
        activeTab === 'POSITIONS' || isPortfolioRebalanceMode;
    const isSimplePositionsView = activeTab === 'POSITIONS' && positionsMode === 'normal' && positionsPresentation === 'simple';
    const positionsTableHasSidePanel =
        isPortfolioReviewMode || isPortfolioRebalanceMode;
    const showPositionShapeFooter =
        activeTab === 'POSITIONS' &&
        positionsMode === 'normal' &&
        positionShapeWidgetVisible;
    const positionTableGroupingEnabled =
        isPortfolioReviewMode || isPortfolioRebalanceMode || groupingEnabled;
    const showPositionVisibilityControls =
        isPortfolioRebalanceMode ||
        (groupingEnabled &&
            activeTab === 'POSITIONS' &&
            (positionsMode === 'normal' || positionsMode === 'review'));
    const positionStatsPeekMode =
        positionStatsPeekEnabled &&
        activeTab === 'POSITIONS' &&
        positionsMode === 'normal' &&
        positionTableGroupingEnabled;
    const positionStockRowsDimmed =
        positionStatsPeekMode && positionStatsPeekLayer !== null;
    const positionStockRowFadeStyle: React.CSSProperties | undefined =
        positionStatsPeekMode
            ? {
                  opacity: positionStockRowsDimmed ? 0.1 : 1,
                  transition: `background-color 100ms ease, border-color 100ms ease, box-shadow 100ms ease, opacity ${
                      positionStockRowsDimmed ? 200 : 175
                  }ms ease-out`,
              }
            : undefined;
    const visiblePositionGroups = hideEmptyPositionGroups
        ? groups.filter(group => getGroupStocksRecursive(group.id).length > 0)
        : groups;
    const visiblePositionGroupIds = new Set(visiblePositionGroups.map(group => group.id));
    const positionGroupsAllCollapsed = isPortfolioRebalanceMode
        ? groups.length > 0 &&
          groups.every((group) => portfolioCollapsedGroupIds.has(group.id))
        : visiblePositionGroups.length > 0 && visiblePositionGroups.every((group) => group.collapsed);
    const positionCollapsedParentStatsVisible =
        positionStatsPeekMode && positionGroupsAllCollapsed;
    const fixedQ1StatsVisible = isPortfolioRebalanceMode
        ? portfolioShowQ1Stats
        : showQ1Stats;
    const fixedGroupStatsVisible = isPortfolioRebalanceMode
        ? portfolioShowGroupStats
        : showGroupStats;
    const fixedStockStatsVisible = isPortfolioRebalanceMode
        ? portfolioShowStockStats
        : showStockStats;
    const positionStatsPeekFadeStyle = (
        visible: boolean,
    ): React.CSSProperties | undefined =>
        positionStatsPeekMode
            ? {
                  opacity: visible ? 1 : 0,
                  transition:
                      positionStatsTransitionSuppressed ||
                      positionCollapsedParentStatsVisible
                          ? 'none'
                          : `opacity ${visible ? 125 : 175}ms ease-out`,
              }
            : undefined;
    const positionQ1StatsVisible = positionStatsPeekMode
        ? fixedQ1StatsVisible &&
          (positionCollapsedParentStatsVisible ||
              positionStatsPeekLayer === 'bucket')
        : fixedQ1StatsVisible;
    const positionGroupStatsVisible = positionStatsPeekMode
        ? positionCollapsedParentStatsVisible || positionStatsPeekLayer === 'group'
        : fixedGroupStatsVisible;
    const enterPositionStatsPeekLayer = (layer: 'bucket' | 'group') => {
        if (!positionStatsPeekMode) return;
        if (positionStatsPeekLeaveTimerRef.current !== null) {
            window.clearTimeout(positionStatsPeekLeaveTimerRef.current);
            positionStatsPeekLeaveTimerRef.current = null;
        }
        if (positionStatsPeekIntentTimerRef.current !== null) {
            window.clearTimeout(positionStatsPeekIntentTimerRef.current);
        }
        positionStatsPeekIntentTimerRef.current = window.setTimeout(() => {
            setPositionStatsPeekLayer(layer);
            positionStatsPeekIntentTimerRef.current = null;
        }, 50);
    };
    const leavePositionStatsPeekLayer = () => {
        if (!positionStatsPeekMode) return;
        if (positionStatsPeekIntentTimerRef.current !== null) {
            window.clearTimeout(positionStatsPeekIntentTimerRef.current);
            positionStatsPeekIntentTimerRef.current = null;
        }
        if (positionStatsPeekLeaveTimerRef.current !== null) {
            window.clearTimeout(positionStatsPeekLeaveTimerRef.current);
        }
        positionStatsPeekLeaveTimerRef.current = window.setTimeout(() => {
            setPositionStatsPeekLayer(null);
            positionStatsPeekLeaveTimerRef.current = null;
        }, 75);
    };
    const portfolioHasTargetChanges = portfolioRebalanceRows.some(
        (row) =>
            Math.abs(
                (row.target_weight_pct || 0) - (row.current_weight_pct || 0),
            ) > 0.05,
    );
    const portfolioHasLockedTarget = Boolean(portfolioRebalancePlan);
    const portfolioHasDraftTarget =
        portfolioTargetDraftActive ||
        (!portfolioRebalancePlan && portfolioHasTargetChanges);
    const portfolioTargetActive = portfolioHasLockedTarget || portfolioHasDraftTarget;
    const portfolioWorkflowActive =
        portfolioHasTargetChanges || portfolioHasLockedTarget;
    const portfolioTotalValue = portfolioMix?.total_value || portfolio.totalValue || 0;
    const positionShapeScaleMax = useMemo(
        () =>
            calculatePositionShapeScaleMax({
                currentRows: portfolioMix?.rows,
                approvedRows: approvedPortfolioMix?.rows,
                assetClassCodes: groups.map((group) =>
                    getNamedGroupAssetClassCode(group),
                ),
            }),
        [approvedPortfolioMix?.rows, groups, portfolioMix?.rows],
    );

    // Compute aggregate active drift for the PORTFOLIO tab indicator
    const portfolioActiveDrift = useMemo(() => {
        if (!portfolioMix?.rows?.length || !approvedPortfolioMix?.rows?.length) return 0;
        const targetMap = new Map(approvedPortfolioMix.rows.map((r) => [r.asset_class, r.weight_pct]));
        return (
            portfolioMix.rows.reduce((sum, r) => {
                const tgt = targetMap.get(r.asset_class);
                return tgt !== undefined ? sum + Math.abs(r.weight_pct - tgt) : sum;
            }, 0) / 2
        );
    }, [portfolioMix?.rows, approvedPortfolioMix?.rows]);
    const portfolioRebalanceSummary = summarizePortfolioRebalanceRows(
        portfolioRebalanceRows,
        portfolioTotalValue,
        portfolioRebalancePlan,
    );
    const {
        rowsSorted: portfolioRowsSorted,
        targetTotal: portfolioTargetTotal,
        targetTotalValid: portfolioTargetTotalValid,
        grossMove: portfolioGrossMove,
        netMove: portfolioNetMove,
        targetMoveBalanced: portfolioTargetMoveBalanced,
        transitionCompleted: portfolioTransitionCompleted,
        baselineApproved: portfolioBaselineApproved,
    } = portfolioRebalanceSummary;
    const portfolioCurrentStage: PortfolioRebalanceWorkflowStage =
        portfolioBaselineApproved
            ? 'confirm_cash'
            : portfolioTransitionCompleted
              ? 'confirm_cash'
              : portfolioRebalancePlan
                ? 'reduce'
                : 'target';
    const activePortfolioStage = resolveActiveWorkflowStage(
        portfolioRebalanceWorkflowStageOrder,
        portfolioCurrentStage,
        portfolioSelectedStage,
        portfolioBaselineApproved ? 'confirm_cash' : undefined,
    );
    const canSelectPortfolioStage = (
        stage: PortfolioRebalanceWorkflowStage,
    ): boolean =>
        canSelectWorkflowStage(
            portfolioRebalanceWorkflowStageOrder,
            stage,
            activePortfolioStage,
            portfolioCurrentStage,
            portfolioBaselineApproved ? 'confirm_cash' : undefined,
        );
    const portfolioReductionEditable =
        isPortfolioTargetAdjustmentMode &&
        Boolean(portfolioRebalancePlan) &&
        activePortfolioStage === 'reduce' &&
        !portfolioTransitionCompleted;
    const portfolioHasReductionWorkflow =
        isPortfolioTargetAdjustmentMode &&
        Boolean(portfolioRebalancePlan) &&
        portfolioRowsSorted.some((row) => {
            const { moveValue } = getPortfolioRebalanceRowMove(
                row,
                portfolioTotalValue,
            );
            return moveValue < -Math.max(50, portfolioTotalValue * 0.0005);
        });
    const reviewFocusKey = reviewFocus?.key || 'bucket:q1';
    const overlayRequiredReduction = Number(
        overlaySummary?.required_de_risk_value || 0,
    );
    const reviewBaseRequiredReductionFromRows = rawOverlayRows.reduce((sum, row) => {
        const bucket = getBucketMetaForAssetClass(
            normalizeAssetClassCode(row.asset_class || row.display_name),
        ).bucket;
        if (
            bucket !== 'full_q1' &&
            bucket !== 'partial_q1' &&
            bucket !== 'q1_exempt'
        ) {
            return sum;
        }
        return sum + Math.max(0, row.delta_value || 0);
    }, 0);
    const reviewBaseRequiredReduction = Math.max(
        reviewBaseRequiredReductionFromRows,
        overlayRequiredReduction,
    );
    const reviewStatementReconciliationVariance =
        reconciliationOverallStatus === 'VARIANCE' ||
        reconciliationSourceStatus === 'VARIANCE' ||
        reconciliationAssetClassStatus === 'VARIANCE';
    const reviewReserveConfirmed =
        reviewCashConfirmationStatus === 'CONFIRMED' &&
        !reviewStatementReconciliationVariance;
    const reviewWorkflowOwnsReserveShortfall =
        reviewActiveEventStatus === 'PARTIAL' ||
        reviewCashConfirmationStatus === 'VARIANCE';
    const reviewRecoveryRequiredReduction =
        reviewWorkflowOwnsReserveShortfall &&
        reviewRecoveryContext &&
        reviewRecoveryContext.reserveShortfall > 1
            ? reviewRecoveryContext.reserveShortfall
            : 0;
    const reviewHasForcedReduction =
        reviewBaseRequiredReduction > 1 || reviewRecoveryRequiredReduction > 1;
    const reviewStatementStageLocked =
        !reviewReserveConfirmed &&
        (Boolean(reviewStage1CompletedAt) ||
            Boolean(overlaySummary?.active_event_stage1_applied_at) ||
            reviewActiveEventStatus === 'STAGE1_DONE' ||
            reviewActiveEventStatus === 'STAGE2_DONE' ||
            reviewActiveEventStatus === 'PARTIAL' ||
            reviewCashConfirmationStatus === 'VARIANCE' ||
            reviewStatementReconciliationVariance);
    const reviewReductionLocked = Boolean(
        reviewStatementStageLocked ||
            reviewStage1CompletedAt ||
            overlaySummary?.active_event_stage1_applied_at ||
            reviewActiveEventStatus === 'STAGE1_DONE' ||
            reviewActiveEventStatus === 'STAGE2_DONE',
    );
    const reviewHasReductionWorkflow =
        reviewHasForcedReduction ||
        reviewReductionLocked ||
        reviewStageConfirmationOpen;
    const positionHasReductionWorkflow =
        (isSignalAdjustmentMode && reviewHasReductionWorkflow) ||
        portfolioHasReductionWorkflow;
    const reviewReductionEditable =
        isSignalAdjustmentMode &&
        reviewHasForcedReduction &&
        !reviewStageConfirmationOpen &&
        !reviewStatementStageLocked &&
        !reviewReductionLocked;
    const positionAdjustmentEditable =
        reviewReductionEditable || portfolioReductionEditable;
    const actionStatementMode = isPositionAdjustmentMode && (usesPortfolioAdjustmentModel
        ? portfolioTransitionCompleted : reviewReductionLocked || reviewReserveConfirmed);
    const reviewSummaryRowsOnly =
        isSignalAdjustmentMode &&
        reviewStageConfirmationOpen;
    type ReviewReconciliationCheck = {
        before_value: number;
        expected_after_value: number;
        imported_value: number;
        variance: number;
        status: string;
    };
    const reviewImportVarianceActive =
        isSignalAdjustmentMode &&
        (String(overlaySummary?.cash_confirmation_status || '').toUpperCase() ===
            'VARIANCE' ||
            reconciliationOverallStatus === 'VARIANCE' ||
            reconciliationSourceStatus === 'VARIANCE' ||
            reconciliationAssetClassStatus === 'VARIANCE') &&
        Boolean(overlayReconciliation?.import_received);
    const isReconciliationVariance = (
        check?: ReviewReconciliationCheck | null,
    ) => String(check?.status || '').toUpperCase() === 'VARIANCE';
    const getStockReconciliationCheck = (
        stock: (typeof stocks)[0],
    ): ReviewReconciliationCheck | null =>
        reviewImportVarianceActive
            ? sourceReconciliationByName.get(stock.name.toLowerCase()) || null
            : null;
    const getAssetClassReconciliationCheck = (
        assetClassCode?: string | null,
    ): ReviewReconciliationCheck | null =>
        reviewImportVarianceActive
            ? assetClassReconciliationByCode.get(
                  normalizeAssetClassCode(assetClassCode),
              ) || null
            : null;
    const getBucketReconciliationCheck = (
        bucket: PositionBucketKey,
    ): ReviewReconciliationCheck | null => {
        if (!reviewImportVarianceActive) return null;
        const checks = (overlayReconciliation?.asset_class_checks || []).filter(
            (check) => {
                const checkBucket = getBucketMetaForAssetClass(
                    normalizeAssetClassCode(check.asset_class),
                ).bucket;
                if (bucket === 'q1') {
                    return checkBucket === 'full_q1' || checkBucket === 'partial_q1';
                }
                return checkBucket === bucket;
            },
        );
        if (checks.length === 0) return null;
        return checks.reduce<ReviewReconciliationCheck>(
            (acc, check) => ({
                before_value: acc.before_value + (check.before_value || 0),
                expected_after_value:
                    acc.expected_after_value + (check.expected_after_value || 0),
                imported_value: acc.imported_value + (check.imported_value || 0),
                variance: acc.variance + (check.variance || 0),
                status:
                    String(check.status || '').toUpperCase() === 'VARIANCE' ||
                    acc.status === 'VARIANCE'
                        ? 'VARIANCE'
                        : 'MATCHED',
            }),
            {
                before_value: 0,
                expected_after_value: 0,
                imported_value: 0,
                variance: 0,
                status: 'MATCHED',
            },
        );
    };
    const getReserveReconciliationCheck = (): ReviewReconciliationCheck | null => {
        if (!reviewImportVarianceActive || !overlayReconciliation?.cash) return null;
        return {
            before_value: overlayReconciliation.cash.baseline_reserve_value || 0,
            expected_after_value:
                overlayReconciliation.cash.expected_reserve_value || 0,
            imported_value: overlayReconciliation.cash.imported_reserve_value || 0,
            variance: overlayReconciliation.cash.reserve_variance || 0,
            status: overlayReconciliation.cash.status || 'VARIANCE',
        };
    };

    useLayoutEffect(() => {
        if (!isPortfolioRebalanceMode) {
            setPortfolioTargetAlignment({ offsets: {}, height: 0 });
            return;
        }

        let frame = 0;
        const measureAlignment = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                const targetPanel = portfolioTargetAlignmentRef.current;
                const tablePanel = reviewTablePanelRef.current;
                if (!targetPanel || !tablePanel) return;

                const targetRect = targetPanel.getBoundingClientRect();
                const tableRect = tablePanel.getBoundingClientRect();
                const rows = Array.from(
                    tablePanel.querySelectorAll<HTMLElement>(
                        '[data-portfolio-asset-class-row="true"]',
                    ),
	                );
	                const nextOffsets: Record<string, number> = {};
	                rows.forEach((row) => {
	                    const code = getPortfolioAlignmentAssetClassCode(
	                        row.dataset.assetClassCode,
	                    );
	                    if (!code || nextOffsets[code] != null) return;
	                    const rect = row.getBoundingClientRect();
	                    nextOffsets[code] = Math.round(rect.top - targetRect.top);
                });

                const nextHeight = Math.max(260, Math.round(tableRect.height));
                setPortfolioTargetAlignment((prev) => {
                    const prevKeys = Object.keys(prev.offsets);
                    const nextKeys = Object.keys(nextOffsets);
                    const sameOffsets =
                        prevKeys.length === nextKeys.length &&
                        nextKeys.every(
                            (key) => prev.offsets[key] === nextOffsets[key],
                        );
                    if (prev.height === nextHeight && sameOffsets) return prev;
                    return { offsets: nextOffsets, height: nextHeight };
                });
            });
        };

        measureAlignment();
        window.addEventListener('resize', measureAlignment);
        const tablePanel = reviewTablePanelRef.current;
        const sidePanel = portfolioRebalancePanelRef.current;
        tablePanel?.addEventListener('scroll', measureAlignment, {
            passive: true,
        });
        sidePanel?.addEventListener('scroll', measureAlignment, {
            passive: true,
        });

        const resizeObserver =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(measureAlignment);
        if (resizeObserver) {
            if (tablePanel) resizeObserver.observe(tablePanel);
            if (portfolioTargetAlignmentRef.current) {
                resizeObserver.observe(portfolioTargetAlignmentRef.current);
            }
        }

        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', measureAlignment);
            tablePanel?.removeEventListener('scroll', measureAlignment);
            sidePanel?.removeEventListener('scroll', measureAlignment);
            resizeObserver?.disconnect();
        };
    }, [
        activeTab,
        getPortfolioAlignmentAssetClassCode,
        isPortfolioRebalanceMode,
        portfolioMode,
        positionTableGroupingEnabled,
        groups,
        portfolioCollapsedGroupIds,
        portfolioRebalanceRows,
        portfolioPureSort,
        sortColumn,
        sortDirection,
        showGroupStats,
        showQ1Stats,
        portfolioShowGroupStats,
        portfolioShowQ1Stats,
        portfolioShowStockStats,
        showPortfolioBucketRows,
        showStockStats,
        visibleColumns.classPercent,
        visibleColumns.mktValue,
        visibleColumns.targetAdjustment,
        visibleColumns.targetAdjustmentPercent,
        visibleColumns.reduce,
        visibleColumns.exposurePercent,
        visibleColumns.portfolioPercent,
        visibleColumns.trend,
        visibleColumns.action,
        visibleColumns.dca,
        portfolioVisibleColumns.classPercent,
        portfolioVisibleColumns.mktValue,
        portfolioVisibleColumns.targetAdjustment,
        portfolioVisibleColumns.targetAdjustmentPercent,
        portfolioVisibleColumns.reduce,
        portfolioVisibleColumns.exposurePercent,
        portfolioVisibleColumns.portfolioPercent,
        portfolioVisibleColumns.trend,
        portfolioVisibleColumns.action,
        portfolioVisibleColumns.dca,
    ]);

    const activePositionVisibleColumns = isPortfolioRebalanceMode
        ? portfolioVisibleColumns
        : visibleColumns;
    const [actionVisibleColumns, setActionVisibleColumns] = useState<PositionVisibleColumns>({
        ...defaultPositionVisibleColumns,
        classPercent: false, portfolioPercent: false, reduce: false,
        targetAdjustmentPercent: false,
    });
    const positionColumnVisible = (column: keyof PositionVisibleColumns) => {
        if (column === 'modelWeight' && (activeTab !== 'POSITIONS' || positionsMode !== 'normal')) return false;
        if (isPositionAdjustmentMode && actionStatementMode) return column === 'mktValue';
        if (!isPortfolioReviewMode && column === 'exposurePercent') {
            return false;
        }
        if (!isPortfolioReviewMode) return activePositionVisibleColumns[column];
        return [
            'mktValue',
            'targetAdjustment',
            'targetAdjustmentPercent',
            'reduce',
            'exposurePercent',
            'portfolioPercent',
            'classPercent',
        ].includes(column) && actionVisibleColumns[column];
    };
    const positionStockStatsVisible = positionStatsPeekMode
        ? true
        : fixedStockStatsVisible;

    const reviewRowClass = (key: string) =>
        isPortfolioReviewMode && reviewFocusKey === key
            ? ' is-position-selected [&>td]:!bg-sky-500/[0.055] [&>td]:border-y [&>td]:border-y-sky-500/45 [&>td:first-child]:border-l [&>td:first-child]:border-l-sky-500/55 [&>td:last-child]:border-r [&>td:last-child]:border-r-sky-500/55'
            : '';
    const positionStockRowClass = (stockId: number) =>
        activeTab === 'POSITIONS' &&
        positionsMode === 'normal' &&
        selectedPositionStockId === stockId
            ? ' is-position-selected [&>td]:!bg-sky-500/[0.055] [&>td]:border-y [&>td]:border-y-sky-500/45 [&>td:first-child]:border-l [&>td:first-child]:border-l-sky-500/55 [&>td:last-child]:border-r [&>td:last-child]:border-r-sky-500/55'
            : '';
    const hoverPortfolioAssetClasses = (
        assetClassCodes?: Array<string | null | undefined> | null,
    ) => {
        if (activeTab !== 'PORTFOLIO' || !assetClassCodes?.length) {
            return;
        }
        const normalizedCodes = Array.from(
            new Set(
                assetClassCodes
                    .filter(Boolean)
                    .map((code) => normalizeAssetClassCode(String(code)))
                    .filter(Boolean),
            ),
        );
        setHoveredPortfolioAssetClassCodes(normalizedCodes);
    };
    const hoverPortfolioAssetClass = (assetClassCode?: string | null) => {
        hoverPortfolioAssetClasses(assetClassCode ? [assetClassCode] : null);
    };
    const clearHoveredPortfolioAssetClass = () => {
        if (activeTab !== 'PORTFOLIO') return;
        setHoveredPortfolioAssetClassCodes([]);
    };
    const selectPortfolioAssetClass = (assetClassCode?: string | null) => {
        if (assetClassCode) useContextPanelStore.getState().selectClass(normalizeAssetClassCode(assetClassCode));
        if (
            !isPortfolioRebalanceMode ||
            portfolioFocusMode !== 'select' ||
            !assetClassCode
        ) {
            return;
        }
        const normalizedCode = normalizeAssetClassCode(assetClassCode);
        setSelectedPortfolioAssetClassCode((current) =>
            current === normalizedCode ? null : normalizedCode,
        );
    };
    const isPortfolioAssetClassFocused = (assetClassCode?: string | null) => {
        if (!isPortfolioRebalanceMode || !assetClassCode) return false;
        const normalizedCode = normalizeAssetClassCode(assetClassCode);
        if (hoveredPortfolioAssetClassCodes.includes(normalizedCode)) {
            return true;
        }
        return (
            portfolioFocusMode === 'select' &&
            selectedPortfolioAssetClassCode === normalizedCode
        );
    };
    const portfolioAssetClassSelectRowClass = (
        assetClassCode?: string | null,
    ) =>
        isPortfolioRebalanceMode &&
        portfolioFocusMode === 'select' &&
        assetClassCode &&
        selectedPortfolioAssetClassCode === normalizeAssetClassCode(assetClassCode)
            ? ' [&>td]:!bg-sky-500/[0.055] [&>td]:border-y [&>td]:border-y-sky-500/45 [&>td:first-child]:border-l [&>td:first-child]:border-l-sky-500/55 [&>td:last-child]:border-r [&>td:last-child]:border-r-sky-500/55'
            : '';
    const portfolioAssetClassSelectPanelClass = (
        assetClassCode?: string | null,
    ) =>
        isPortfolioRebalanceMode &&
        portfolioFocusMode === 'select' &&
        assetClassCode &&
        selectedPortfolioAssetClassCode === normalizeAssetClassCode(assetClassCode)
            ? '!border-sky-500/55 !bg-sky-500/[0.07] ring-1 ring-sky-500/35'
            : '';

    const getAdjustmentHoldingForStock = (stock: Stock): AdjustmentHolding => ({
        id: stock.id,
        assetClass: getStockAssetClassCode(stock),
        currentValue: stock.positionValue || 0,
    });
    const positionAdjustmentHoldings = positionStocks.map(
        getAdjustmentHoldingForStock,
    );
    const reviewRequiredReductionByAssetClass = rawOverlayRows.reduce<
        Record<string, number>
    >((acc, row) => {
        const key = normalizeAssetClassCode(row.asset_class || row.display_name);
        const required = Math.max(0, row.delta_value || 0);
        if (required > 0) acc[key] = required;
        return acc;
    }, {});

    const getReviewPlannedCutForStock = (stock: Stock): number => {
        return getPlannedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            reviewCutInputs,
        );
    };

    const getReviewSuggestedCutForStock = (stock: Stock): number => {
        return getSuggestedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            positionAdjustmentHoldings,
            reviewRequiredReductionByAssetClass,
        );
    };

    const getReviewTargetCutForStock = (stock: Stock): number => {
        return getReviewSuggestedCutForStock(stock);
    };

    const getReviewRemainingSuggestedCutForStock = (stock: Stock): number => {
        return getRemainingSuggestedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            positionAdjustmentHoldings,
            reviewRequiredReductionByAssetClass,
            reviewCutInputs,
        );
    };

    const getReviewPlannedCutForStocks = (
        stocksForPlan: typeof positionStocks,
    ): number =>
        getPlannedAdjustmentForHoldings(
            stocksForPlan.map(getAdjustmentHoldingForStock),
            reviewCutInputs,
        );

    const getReviewPlannedCutForAssetCodes = (assetCodes: string[]): number => {
        const codes = new Set(assetCodes.map((code) => normalizeAssetClassCode(code)));
        return getReviewPlannedCutForStocks(
            positionStocks.filter((stock) =>
                codes.has(getStockAssetClassCode(stock)),
            ),
        );
    };

    const getReviewReductionTolerance = (requiredCutValue: number): number =>
        getAdjustmentTolerance(requiredCutValue, { minimum: 1000, ratio: 0.05 });

    const portfolioAdjustmentRowsByAssetClass = new Map<
        string,
        AdjustmentPlanRow
    >(
        (portfolioAdjustmentPlan?.rows || []).map((row) => [
            normalizeAssetClassCode(row.key),
            row,
        ]),
    );
    const portfolioRequiredReductionByAssetClass =
        portfolioAdjustmentPlan?.rows?.length
            ? portfolioAdjustmentPlan.rows.reduce<Record<string, number>>(
                  (acc, row) => {
                      const key = normalizeAssetClassCode(row.key);
                      if (row.direction === 'decrease' && row.required_value > 0) {
                          acc[key] = row.required_value;
                      }
                      return acc;
                  },
                  {},
              )
            : portfolioRowsSorted.reduce<Record<string, number>>((acc, row) => {
                  const key = normalizeAssetClassCode(row.asset_class);
                  const { moveValue } = getPortfolioRebalanceRowMove(
                      row,
                      portfolioTotalValue,
                  );
                  if (moveValue < -Math.max(50, portfolioTotalValue * 0.0005)) {
                      acc[key] = Math.abs(moveValue);
                  }
                  return acc;
              }, {});
    const portfolioStockReductionByAssetClass =
        aggregateHoldingAdjustmentsByAssetClass(
            positionAdjustmentHoldings,
            portfolioReductionInputs,
        );
    const portfolioStockReductionInputAssetClasses = getAssetClassesWithHoldingInputs(
        positionAdjustmentHoldings,
        portfolioReductionInputs,
    );
    const portfolioRowsWithCashInputs = portfolioRowsSorted.map((row) => {
        const key = normalizeAssetClassCode(row.asset_class);
        const classInputActive = portfolioStockReductionInputAssetClasses.has(key);
        const parsed = Number.parseFloat(portfolioCashMoveInputs[key] || '');
        return {
            ...row,
            recorded_move_value: classInputActive
                ? portfolioStockReductionByAssetClass[key] || 0
                : Number.isFinite(parsed)
                  ? Math.max(0, parsed)
                  : row.recorded_move_value || 0,
        };
    });
    const portfolioCashMovementPlan = buildPortfolioCashMovementPlan(
        portfolioRowsWithCashInputs,
        portfolioTotalValue,
    );
    const portfolioAdjustmentDecreaseRows =
        portfolioAdjustmentPlan?.rows?.filter(
            (row) => row.direction === 'decrease',
        ) || [];
    const portfolioAdjustmentIncreaseRows =
        portfolioAdjustmentPlan?.rows?.filter(
            (row) => row.direction === 'increase',
        ) || [];
    const getPortfolioRecordedActionForAssetClass = (
        assetClassCode?: string | null,
    ): number => {
        const key = normalizeAssetClassCode(assetClassCode);
        if (!key) return 0;
        if (portfolioStockReductionInputAssetClasses.has(key)) {
            return portfolioStockReductionByAssetClass[key] || 0;
        }
        const parsed = Number.parseFloat(portfolioCashMoveInputs[key] || '');
        if (Number.isFinite(parsed)) return Math.max(0, parsed);
        return portfolioAdjustmentRowsByAssetClass.get(key)?.recorded_value || 0;
    };
    const portfolioAdjustmentRequiredDecrease =
        portfolioAdjustmentPlan?.required_decrease_value ??
        portfolioCashMovementPlan.totalRequiredCash;
    const portfolioAdjustmentRecordedDecrease = portfolioAdjustmentPlan
        ? portfolioAdjustmentDecreaseRows.reduce(
              (sum, row) => sum + getPortfolioRecordedActionForAssetClass(row.key),
              0,
          )
        : portfolioCashMovementPlan.totalRecordedCash;
    const portfolioAdjustmentRequiredIncrease =
        portfolioAdjustmentPlan?.required_increase_value ??
        portfolioCashMovementPlan.totalPendingAdd;
    const portfolioAdjustmentRemainingDecrease = Math.max(
        0,
        portfolioAdjustmentRequiredDecrease - portfolioAdjustmentRecordedDecrease,
    );
    const portfolioAdjustmentTolerance =
        portfolioAdjustmentPlan?.tolerance_value ?? portfolioCashMovementPlan.tolerance;
    const portfolioAdjustmentReadyToConfirm = portfolioAdjustmentPlan
        ? portfolioAdjustmentRequiredDecrease <= 0 ||
          (portfolioAdjustmentRemainingDecrease <= portfolioAdjustmentTolerance &&
              portfolioAdjustmentRecordedDecrease <=
                  portfolioAdjustmentRequiredDecrease + portfolioAdjustmentTolerance)
        : portfolioCashMovementPlan.readyToConfirm;
    const reviewHasAllocationAvailableAction =
        activeTab === 'POSITIONS' &&
        !reviewHasForcedReduction &&
        !reviewStatementStageLocked &&
        Boolean(overlaySummary?.active_event_id) &&
        reviewActiveEventStatus === 'PENDING' &&
        (overlaySummary?.available_headroom_value || 0) > 1;
    const signalAdjustmentActiveForNav =
        reviewHasAllocationAvailableAction ||
        (!reviewReserveConfirmed &&
            (reviewHasForcedReduction || reviewStatementStageLocked));
    const portfolioAdjustmentActiveForNav =
        Boolean(portfolioRebalancePlan) &&
        !portfolioBaselineApproved &&
        (portfolioAdjustmentRequiredDecrease > 1 ||
            portfolioAdjustmentRequiredIncrease > 1 ||
            portfolioTransitionCompleted);
    const adjustmentCallToActionCount =
        (signalAdjustmentActiveForNav ? 1 : 0) +
        (portfolioAdjustmentActiveForNav ? 1 : 0);
    const hasAdjustmentCallToAction = adjustmentCallToActionCount > 0;
    useEffect(() => {
        if (
            activeTab === 'POSITIONS' &&
            positionsMode === 'review' &&
            !hasAdjustmentCallToAction
        ) {
            setPositionsMode('normal');
        }
    }, [activeTab, hasAdjustmentCallToAction, positionsMode]);
    useEffect(() => {
        if (
            activeTab === 'POSITIONS' &&
            positionsMode === 'review' &&
            activeAdjustmentSource === 'signal' &&
            !signalAdjustmentActiveForNav &&
            portfolioAdjustmentActiveForNav
        ) {
            setActiveAdjustmentSource('portfolio_target');
        }
    }, [
        activeAdjustmentSource,
        activeTab,
        portfolioAdjustmentActiveForNav,
        positionsMode,
        signalAdjustmentActiveForNav,
    ]);
    const portfolioLiveRowsSorted = buildLivePortfolioRebalanceRows(
        portfolioRowsSorted,
        portfolioMix?.rows || [],
    );
    const portfolioImportValidation = validatePortfolioRebalanceImport(
        portfolioLiveRowsSorted,
        portfolioTotalValue,
    );

    const getPortfolioRequiredCutForAssetCodes = (
        assetCodes: Array<string | null | undefined>,
    ): number =>
        Array.from(
            new Set(
                assetCodes
                    .filter(Boolean)
                    .map((code) => normalizeAssetClassCode(String(code)))
                    .filter(Boolean),
            ),
        ).reduce(
            (sum, code) => sum + (portfolioRequiredReductionByAssetClass[code] || 0),
            0,
        );

    const getPortfolioPlannedCutForStock = (stock: Stock): number => {
        return getPlannedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            portfolioReductionInputs,
        );
    };

    const getPortfolioPlannedCutForStocks = (
        stocksForPlan: typeof positionStocks,
    ): number =>
        getPlannedAdjustmentForHoldings(
            stocksForPlan.map(getAdjustmentHoldingForStock),
            portfolioReductionInputs,
        );

    const getPortfolioAssetCodesForStocks = (
        stocksForPlan: typeof positionStocks,
    ): string[] =>
        Array.from(
            new Set(
                stocksForPlan
                    .map((stock) => getStockAssetClassCode(stock))
                    .filter(Boolean),
            ),
        );

    const getPortfolioAssetCodesForGroup = (group: StockGroup): string[] => {
        const codes = new Set(
            getPortfolioAssetCodesForStocks(getGroupStocksRecursive(group.id)),
        );
        const namedCode = getNamedGroupAssetClassCode(group);
        if (namedCode) codes.add(namedCode);
        return Array.from(codes);
    };

    const getPortfolioRequiredCutForGroup = (group: StockGroup): number =>
        getPortfolioRequiredCutForAssetCodes(getPortfolioAssetCodesForGroup(group));

    const getPortfolioRequiredCutForStock = (stock: Stock): number =>
        portfolioRequiredReductionByAssetClass[getStockAssetClassCode(stock)] || 0;

    const getPortfolioSuggestedCutForStock = (stock: Stock): number => {
        return getSuggestedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            positionAdjustmentHoldings,
            portfolioRequiredReductionByAssetClass,
        );
    };

    const getPortfolioRemainingSuggestedCutForStock = (stock: Stock): number => {
        return getRemainingSuggestedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            positionAdjustmentHoldings,
            portfolioRequiredReductionByAssetClass,
            portfolioReductionInputs,
        );
    };

    const setAdjustmentInputForStock = (stock: Stock, cappedValue: string) => {
        if (usesPortfolioAdjustmentModel) {
            setPortfolioReductionInputs((prev) => {
                if (cappedValue === '') {
                    const next = { ...prev };
                    delete next[stock.id];
                    return next;
                }
                return {
                    ...prev,
                    [stock.id]: cappedValue,
                };
            });
            setPortfolioCashMoveInputs((prev) => {
                const next = { ...prev };
                delete next[getStockAssetClassCode(stock)];
                return next;
            });
            return;
        }

        setReviewStage1CompletedAt(null);
        setReviewStageConfirmationOpen(false);
        setReviewCashMovementRecord(null);
        setReviewStageSaveError(null);
        setReviewCutInputs((prev) => {
            if (cappedValue === '') {
                const next = { ...prev };
                delete next[stock.id];
                return next;
            }
            return {
                ...prev,
                [stock.id]: cappedValue,
            };
        });
    };

    const renderReviewProgressCell = (
        plannedCutValue: number,
        currentValue: number,
        showStats: boolean,
        requiredCutValue = 0,
        enforceTarget = true,
        stock?: Stock,
    ) => {
        if (!positionHasReductionWorkflow) return null;
        const adjustmentEditable = stock
            ? usesPortfolioAdjustmentModel
                ? portfolioReductionEditable
                : reviewReductionEditable
            : false;
        return (
            <PositionAdjustmentProgressCell
                showStats={showStats}
                plannedValue={plannedCutValue}
                currentValue={currentValue}
                requiredValue={requiredCutValue}
                tolerance={getReviewReductionTolerance(requiredCutValue)}
                enforceTarget={enforceTarget}
                editablePercent={adjustmentEditable}
                onFocus={
                    stock
                        ? () =>
                              setReviewFocus({
                                  type: 'stock',
                                  key: `stock:${stock.id}`,
                                  stockId: stock.id,
                                  label: stock.name,
                              })
                        : undefined
                }
                onChangePercent={
                    stock
                        ? (rawValue) => {
                              const normalizedValue = rawValue
                                  .replace('%', '')
                                  .trim();
                              const numericValue =
                                  Number.parseFloat(normalizedValue);
                              const cappedPct =
                                  normalizedValue === '' ||
                                  !Number.isFinite(numericValue)
                                      ? null
                                      : Math.min(
                                            100,
                                            Math.max(0, numericValue),
                                        );
                              const nextValue =
                                  cappedPct == null
                                      ? ''
                                      : String(
                                            Math.round(
                                                ((stock.positionValue || 0) *
                                                    cappedPct) /
                                                    100,
                                            ),
                                        );
                              setAdjustmentInputForStock(stock, nextValue);
                          }
                        : undefined
                }
                moneyFormatter={money}
            />
        );
    };

    const renderReviewTargetPercentCell = (
        targetCutValue: number,
        currentValue: number,
        showStats: boolean,
        cutLabel?: string,
        targetPctOverride?: number | null,
    ) => {
        if (
            !positionHasReductionWorkflow ||
            !positionColumnVisible('targetAdjustment')
        ) return null;
        return (
            <PositionAdjustmentTargetCell
                showStats={showStats}
                targetValue={targetCutValue}
                currentValue={currentValue}
                mode="value"
                label={cutLabel}
                targetPctOverride={targetPctOverride}
                showZero={usesPortfolioAdjustmentModel}
                moneyFormatter={money}
            />
        );
    };

    const renderTargetMovePctCell = (
        targetMoveValue: number,
        currentValue: number,
        showStats: boolean,
    ) => {
        if (
            !positionHasReductionWorkflow ||
            !positionColumnVisible('targetAdjustmentPercent')
        ) return null;
        const hasTarget = targetMoveValue > 0 && currentValue > 0;
        const targetPct = hasTarget ? (targetMoveValue / currentValue) * 100 : 0;
        const showZero = usesPortfolioAdjustmentModel;
        return (
            <td
                className={`h-[26px] text-center font-mono font-light text-[10px] border-r align-middle ${
                    hasTarget
                        ? 'border-border/25 bg-muted/[0.055] text-muted-foreground'
                        : 'border-border/25 bg-muted/[0.035] text-muted-foreground'
                }`}
                style={{ width: '70px', minWidth: '70px', maxWidth: '70px' }}
                title={
                    hasTarget
                        ? `${pct1(targetPct)} target adjustment from this row`
                        : undefined
                }
            >
                {showStats && (hasTarget || showZero) ? pct1(targetPct) : ''}
            </td>
        );
    };

    const renderReviewCutCell = (
        plannedCutValue: number,
        showStats: boolean,
        requiredCutValue = 0,
        stock?: Stock,
        cutLabel?: string,
        enforceTarget = true,
    ) => {
        if (!positionHasReductionWorkflow) return null;
        if (stock) {
            const suggestedCutValue = usesPortfolioAdjustmentModel
                ? getPortfolioRemainingSuggestedCutForStock(stock)
                : getReviewRemainingSuggestedCutForStock(stock);
            const plannedStockCut = usesPortfolioAdjustmentModel
                ? getPortfolioPlannedCutForStock(stock)
                : getReviewPlannedCutForStock(stock);
            const reductionEditable = usesPortfolioAdjustmentModel
                ? portfolioReductionEditable
                : reviewReductionEditable;
            if (!reductionEditable) {
                return (
                    <PositionAdjustmentActionCell
                        showStats={showStats}
                        plannedValue={plannedStockCut}
                        currentValue={stock.positionValue || 0}
                        emptyWhenZero
                        moneyFormatter={money}
                    />
                );
            }
            return (
                <PositionAdjustmentActionCell
                    showStats={showStats}
                    plannedValue={plannedStockCut}
                    suggestedValue={suggestedCutValue}
                    currentValue={stock.positionValue || 0}
                    value={
                        usesPortfolioAdjustmentModel
                            ? portfolioReductionInputs[stock.id] || ''
                            : reviewCutInputs[stock.id] || ''
                    }
                    editable
                    onFocus={() =>
                        setReviewFocus({
                            type: 'stock',
                            key: `stock:${stock.id}`,
                            stockId: stock.id,
                            label: stock.name,
                        })
                    }
                    onChangeValue={(cappedValue) => {
                        setAdjustmentInputForStock(stock, cappedValue);
                    }}
                    onCommitSuggested={(value) => {
                        setAdjustmentInputForStock(stock, String(value));
                    }}
                    inputTestId={`adjustment-input-${stock.symbol || stock.id}`}
                    moneyFormatter={money}
                />
            );
        }

        const requiredTolerance = getReviewReductionTolerance(requiredCutValue);
        return (
            <PositionAdjustmentActionCell
                showStats={showStats}
                plannedValue={plannedCutValue}
                requiredValue={requiredCutValue}
                tolerance={requiredTolerance}
                label={cutLabel}
                enforceTarget={enforceTarget}
                moneyFormatter={money}
            />
        );
    };

    const renderClassPercentCell = (
        value: number | null | undefined,
        showStats: boolean,
        toneClass = 'text-foreground',
    ) => {
        if (!positionColumnVisible('classPercent')) return null;
        const shouldRenderStats = showStats || positionStatsPeekMode;
        const statsFadeClass = positionStatsPeekMode
            ? 'transition-opacity'
            : '';
        const statsFadeStyle = positionStatsPeekFadeStyle(showStats);
        const hasValue =
            shouldRenderStats && value != null && Number.isFinite(value);
        const fillPct = hasValue
            ? Math.min(100, Math.max(0, Number(value)))
            : 0;
        return (
            <td
                data-column-key="classPercent"
                className="relative h-[26px] overflow-hidden text-center align-middle font-mono text-[10px] border-r border-border/30"
                style={{ width: '56px', minWidth: '56px', maxWidth: '56px' }}
            >
                {hasValue && fillPct > 0 ? (
                    <div aria-hidden="true" className="position-percent-fill">
                        <div
                            className="absolute inset-y-0 left-0 bg-sky-400/[0.16] transition-[width,opacity] ease-out"
                            style={{
                                width: `${fillPct}%`,
                                ...(statsFadeStyle ?? {}),
                            }}
                        />
                    </div>
                ) : null}
                {hasValue ? (
                    <span
                        className={`relative z-10 ${toneClass} ${statsFadeClass}`}
                        style={statsFadeStyle}
                    >
                        {Number(value).toFixed(1)}%
                    </span>
                ) : null}
            </td>
        );
    };

    const renderReviewReconciliationCell = (
        column: 'expected' | 'imported' | 'variance',
        check: ReviewReconciliationCheck | null | undefined,
        showStats: boolean,
    ) => {
        const hasVariance = isReconciliationVariance(check);
        const cellClass = hasVariance
            ? 'border-border/40 bg-background/20 text-foreground'
            : 'border-border/30 bg-background/10 text-muted-foreground';
        const varianceClass =
            check && Math.abs(check.variance || 0) > 1
                ? 'text-destructive'
                : 'text-emerald-200';

        if (column === 'expected') {
            return (
                <td
                    className={`h-[26px] text-center align-middle font-mono text-[10px] border-r ${cellClass}`}
                    style={{ width: '74px', minWidth: '74px', maxWidth: '74px' }}
                >
                    {showStats && check ? money(check.expected_after_value) : null}
                </td>
            );
        }
        if (column === 'imported') {
            return (
                <td
                    className={`h-[26px] text-center align-middle font-mono text-[10px] border-r ${cellClass}`}
                    style={{ width: '74px', minWidth: '74px', maxWidth: '74px' }}
                >
                    {showStats && check ? money(check.imported_value) : null}
                </td>
            );
        }
        return (
            <td
                className={`h-[26px] text-center align-middle font-mono text-[10px] border-r ${cellClass}`}
                style={{ width: '74px', minWidth: '74px', maxWidth: '74px' }}
            >
                {showStats && check ? (
                    <span className={varianceClass}>
                        {signedMoney(check.variance)}
                    </span>
                ) : null}
            </td>
        );
    };

    const renderReviewReconciliationCells = (
        check: ReviewReconciliationCheck | null | undefined,
        showStats: boolean,
    ) => {
        if (!reviewImportVarianceActive) return null;
        return (
            <>
                {renderReviewReconciliationCell('expected', check, showStats)}
                {renderReviewReconciliationCell('imported', check, showStats)}
                {renderReviewReconciliationCell('variance', check, showStats)}
            </>
        );
    };

    const roundPortfolioTargetPct = (value: number) =>
        Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
    const parsePortfolioTargetPctInput = (value: string | number) => {
        if (typeof value === 'number') return value;
        return Number(value.trim().replace(/%$/, ''));
    };
    const formatPortfolioTargetPctInput = (value: number) =>
        `${roundPortfolioTargetPct(value).toFixed(1)}%`;

    const updatePortfolioRebalanceTarget = (
        assetClass: string,
        rawValue: string,
    ) => {
        const parsed = rawValue === '' ? 0 : parsePortfolioTargetPctInput(rawValue);
        const target = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        const normalizedAssetClass = normalizeAssetClassCode(assetClass);
        setPortfolioRebalanceRows((prev) =>
            prev.map((row) =>
                normalizeAssetClassCode(row.asset_class) === normalizedAssetClass
                    ? {
                          ...row,
                          target_weight_pct: target,
                          delta_weight_pct: target - (row.current_weight_pct || 0),
                      }
                    : row,
            ),
        );
    };

    const updatePortfolioTargetBalanced = (
        assetClass: string,
        rawValue: string | number,
    ) => {
        const parsed =
            rawValue === '' ? 0 : parsePortfolioTargetPctInput(rawValue);
        if (!Number.isFinite(parsed)) return;
        const normalizedAssetClass = normalizeAssetClassCode(assetClass);

        setPortfolioRebalanceRows((prev) => {
            const currentRow = prev.find(
                (row) => normalizeAssetClassCode(row.asset_class) === normalizedAssetClass,
            );
            if (!currentRow) return prev;

            const desiredTotal = 100;
            const currentTarget = currentRow.target_weight_pct || 0;
            const nextTarget = roundPortfolioTargetPct(parsed);
            const requiredOffset = Math.round((currentTarget - nextTarget) * 10) / 10;
            const nextRows = prev.map((row) =>
                normalizeAssetClassCode(row.asset_class) === normalizedAssetClass
                    ? { ...row, target_weight_pct: nextTarget }
                    : { ...row },
            );
            const cashRow = nextRows.find(
                (row) =>
                    normalizeAssetClassCode(row.asset_class) === 'CASH' &&
                    normalizeAssetClassCode(row.asset_class) !== normalizedAssetClass,
            );
            let remainingOffset = requiredOffset;

            if (cashRow && Math.abs(remainingOffset) > 0.0001) {
                const cashTarget = cashRow.target_weight_pct || 0;
                if (remainingOffset > 0) {
                    cashRow.target_weight_pct = roundPortfolioTargetPct(
                        cashTarget + remainingOffset,
                    );
                    remainingOffset = 0;
                } else {
                    const cashReduction = Math.min(cashTarget, Math.abs(remainingOffset));
                    cashRow.target_weight_pct = roundPortfolioTargetPct(
                        cashTarget - cashReduction,
                    );
                    remainingOffset += cashReduction;
                }
            }

            if (Math.abs(remainingOffset) > 0.0001) {
                const candidates = nextRows.filter(
                    (row) =>
                        normalizeAssetClassCode(row.asset_class) !== normalizedAssetClass &&
                        normalizeAssetClassCode(row.asset_class) !== 'CASH',
                );
                if (remainingOffset < 0) {
                    let remainingReduction = Math.abs(remainingOffset);
                    let reducible = candidates.filter(
                        (row) => (row.target_weight_pct || 0) > 0,
                    );
                    while (remainingReduction > 0.0001 && reducible.length > 0) {
                        const totalReducible = reducible.reduce(
                            (sum, row) => sum + (row.target_weight_pct || 0),
                            0,
                        );
                        if (totalReducible <= 0) break;
                        let used = 0;
                        reducible.forEach((row) => {
                            const share =
                                (remainingReduction *
                                    (row.target_weight_pct || 0)) /
                                totalReducible;
                            const reduction = Math.min(
                                row.target_weight_pct || 0,
                                share,
                            );
                            row.target_weight_pct = Math.max(
                                0,
                                (row.target_weight_pct || 0) - reduction,
                            );
                            used += reduction;
                        });
                        if (used <= 0.0001) break;
                        remainingReduction -= used;
                        reducible = reducible.filter(
                            (row) => (row.target_weight_pct || 0) > 0.0001,
                        );
                    }
                } else if (candidates.length > 0) {
                    const totalWeight = candidates.reduce(
                        (sum, row) => sum + Math.max(row.target_weight_pct || 0, 1),
                        0,
                    );
                    candidates.forEach((row) => {
                        const weight = Math.max(row.target_weight_pct || 0, 1);
                        row.target_weight_pct =
                            (row.target_weight_pct || 0) +
                            (remainingOffset * weight) / totalWeight;
                    });
                }
            }

            const roundedRows = nextRows.map((row) => ({
                ...row,
                target_weight_pct: roundPortfolioTargetPct(row.target_weight_pct || 0),
            }));
            const total = roundedRows.reduce(
                (sum, row) => sum + (row.target_weight_pct || 0),
                0,
            );
            const correction = Math.round((desiredTotal - total) * 10) / 10;
            if (Math.abs(correction) >= 0.1) {
                const correctionRow =
                    roundedRows.find(
                        (row) =>
                            normalizeAssetClassCode(row.asset_class) !==
                                normalizedAssetClass &&
                            (row.target_weight_pct || 0) + correction >= 0,
                    ) || roundedRows[0];
                correctionRow.target_weight_pct = roundPortfolioTargetPct(
                    (correctionRow.target_weight_pct || 0) + correction,
                );
            }

            return roundedRows.map((row) => ({
                ...row,
                delta_weight_pct:
                    (row.target_weight_pct || 0) - (row.current_weight_pct || 0),
            }));
        });
    };

    const updatePortfolioTargetAdjacentPair = (
        leftAssetClass: string,
        rightAssetClass: string,
        leftTargetPct: number,
        rightTargetPct: number,
    ) => {
        const leftKey = normalizeAssetClassCode(leftAssetClass);
        const rightKey = normalizeAssetClassCode(rightAssetClass);
        setPortfolioRebalanceRows((prev) =>
            prev.map((row) => {
                const key = normalizeAssetClassCode(row.asset_class);
                const target =
                    key === leftKey
                        ? roundPortfolioTargetPct(leftTargetPct)
                        : key === rightKey
                          ? roundPortfolioTargetPct(rightTargetPct)
                          : row.target_weight_pct || 0;
                return {
                    ...row,
                    target_weight_pct: target,
                    delta_weight_pct: target - (row.current_weight_pct || 0),
                };
            }),
        );
    };

    const getPortfolioAssetClassTintStyle = (
        assetClassCode: string | null,
    ): React.CSSProperties | undefined => {
        if (
            !isPortfolioRebalanceMode ||
            !assetClassCode ||
            !hoveredPortfolioAssetClassCodes.includes(
                normalizeAssetClassCode(assetClassCode),
            )
        ) {
            return undefined;
        }

        const color = getPortfolioAssetClassColor(assetClassCode);

        return {
            backgroundColor: portfolioColorToSurfaceTint(color),
        };
    };

    const renderPortfolioAllocationVisualPanel = () => {
        const totalValue = portfolioMix?.total_value || portfolio.totalValue || 0;
        const targetSourceActive =
            (portfolioWorkflowActive || portfolioTargetDraftActive) &&
            portfolioRebalanceRows.length > 0;
        const visualDataOptions = {
            totalValue,
            targetActive: targetSourceActive,
            portfolioMixRows: portfolioMix?.rows,
            overlayAssetClassRows: overlaySummary?.asset_classes,
            portfolioRebalanceRows,
            getParentGroup: getPortfolioAssetClassParentGroup,
        };
        const currentSegments = buildPortfolioVisualSegments({
            ...visualDataOptions,
            source: 'current',
            flatten: portfolioBarFlatten,
            equalWidth: portfolioBarEqualWidth,
            lockedOrder: null,
        });
        const targetSegments = buildPortfolioVisualSegments({
            ...visualDataOptions,
            source: 'target',
            flatten: portfolioBarFlatten,
            equalWidth: portfolioBarEqualWidth,
            lockedOrder: portfolioTargetBarLockedOrder,
        });
        const targetComparisonVisible =
            (portfolioWorkflowActive || portfolioTargetDraftActive) &&
            targetSegments.length > 0;

        return (
            <PortfolioAllocationVisualPanel
                currentSegments={currentSegments}
                targetSegments={targetSegments}
                currentPieRows={buildPortfolioPieRows({
                    ...visualDataOptions,
                    source: 'current',
                })}
                targetPieRows={buildPortfolioPieRows({
                    ...visualDataOptions,
                    source: 'target',
                })}
                showComparison={targetComparisonVisible}
                isPortfolioRebalanceMode={isPortfolioRebalanceMode}
                hasPortfolioRebalancePlan={Boolean(portfolioRebalancePlan)}
                portfolioRebalanceRowCount={portfolioRebalanceRows.length}
                portfolioVisualMode={portfolioVisualMode}
                setPortfolioVisualMode={setPortfolioVisualMode}
                portfolioBarFlatten={portfolioBarFlatten}
                setPortfolioBarFlatten={setPortfolioBarFlatten}
                portfolioBarEqualWidth={portfolioBarEqualWidth}
                setPortfolioBarEqualWidth={setPortfolioBarEqualWidth}
                portfolioTargetBarEditor={portfolioTargetBarEditor}
                portfolioTargetBarDragRef={portfolioTargetBarDragRef}
                setPortfolioTargetBarEditor={setPortfolioTargetBarEditor}
                setPortfolioTargetBarLockedOrder={
                    setPortfolioTargetBarLockedOrder
                }
                hoveredPortfolioAssetClassCodes={
                    hoveredPortfolioAssetClassCodes
                }
                pct1={pct1}
                formatPortfolioTargetPctInput={formatPortfolioTargetPctInput}
                hoverPortfolioAssetClasses={hoverPortfolioAssetClasses}
                clearHoveredPortfolioAssetClass={
                    clearHoveredPortfolioAssetClass
                }
                selectPortfolioAssetClass={selectPortfolioAssetClass}
                updatePortfolioTargetBalanced={updatePortfolioTargetBalanced}
                updatePortfolioTargetAdjacentPair={
                    updatePortfolioTargetAdjacentPair
                }
            />
        );
    };

    const renderPositionBlankCell = () => (
        <td className="h-[26px] border-r border-border/30" />
    );

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

    const applyNonAllocatingInstrument = async (stock: Stock) => {
        if (nonAllocatingUpdating[stock.id]) return;
        const currentlyExcluded = isNonAllocatingSecurityType(stock.securityType);
        const nextType = currentlyExcluded ? 'STOCK' : 'NON_ALLOCATING';
        const ticker = [stock.prefix, stock.symbol].filter(Boolean).join('');
        setNonAllocatingUpdating((current) => ({
            ...current,
            [stock.id]: true,
        }));
        setNonAllocatingErrors((current) => ({ ...current, [stock.id]: '' }));
        try {
            await api.setAnalysisSecurityType({
                analysis_id: stock.analysisId,
                name: stock.name,
                ticker,
                primary_asset_class: currentlyExcluded
                    ? stock.primaryAssetClass || null
                    : null,
                security_type: nextType,
            });
            updateStock(stock.id, {
                securityType: nextType,
                ...(currentlyExcluded
                    ? {}
                    : {
                          primaryAssetClass: null,
                          allocation: 0,
                          includeInSizing: false,
                      }),
            });
            await fetchHoldings();
        } catch (error) {
            setNonAllocatingErrors((current) => ({
                ...current,
                [stock.id]: `Could not ${currentlyExcluded ? 'restore' : 'archive'} this instrument. Try again.`,
            }));
            console.error(
                '[ALPHA EDGE] Failed to update non-allocating instrument:',
                error,
            );
        } finally {
            setNonAllocatingUpdating((current) => ({
                ...current,
                [stock.id]: false,
            }));
        }
    };

    const toggleNonAllocatingInstrument = (stock: Stock) => {
        if (nonAllocatingUpdating[stock.id]) return;
        const currentlyExcluded = isNonAllocatingSecurityType(stock.securityType);
        if (
            !currentlyExcluded &&
            requiresNonAllocatingConfirmation(stock.positionValue)
        ) {
            setNonAllocatingConfirmStock(stock);
            return;
        }
        void applyNonAllocatingInstrument(stock);
    };

    // Helper function to render a stock row
    const renderStockRow = (
        stock: (typeof stocks)[0],
        hierarchyDepth = 0,
    ) => {
        const breakout = positionStockStatsVisible
            ? getActiveBreakout(stock)
            : null;
        const breakoutDaysLeft = breakout?.expiry_date
            ? getDaysRemaining(breakout.expiry_date)
            : null;
        const canOpenDetails =
            activeTab === 'POSITIONS' && positionsMode === 'normal';
        const coreETFRatio = coreETFRatioForStock(stock);
        const isCoreETF = coreETFRatio !== undefined;

        return (
            <PositionStockRow
                key={`stock:${stock.id}`}
                stock={stock}
                hierarchyDepth={hierarchyDepth}
                isPortfolioReviewMode={isPortfolioReviewMode}
                isPositionsTab={activeTab === 'POSITIONS'}
                className={`${reviewRowClass(
                    `stock:${stock.id}`,
                )}${positionStockRowClass(stock.id)}`}
                style={positionStockRowFadeStyle}
                canOpenDetails={canOpenDetails}
                showStats={positionStockStatsVisible}
                breakoutDaysLeft={breakoutDaysLeft}
                breakoutExpiryDate={breakout?.expiry_date ?? null}
                isCoreETF={isCoreETF}
                coreETFRatioLabel={
                    isCoreETF ? formatCoreRatio(coreETFRatio) : null
                }
                outperformStatus={stock.symbol ? outperformStates[stock.symbol.toUpperCase().split(':').pop() || stock.symbol.toUpperCase()] : undefined}
                isNonAllocating={isNonAllocatingSecurityType(stock.securityType)}
                nonAllocatingUpdating={Boolean(nonAllocatingUpdating[stock.id])}
                onClick={() => {
                    if (isPortfolioReviewMode) {
                        setReviewFocus({
                            type: 'stock',
                            key: `stock:${stock.id}`,
                            stockId: stock.id,
                            label: stock.name,
                        });
                        return;
                    }
                    if (activeTab === 'POSITIONS' && positionsMode === 'normal') {
                        setSelectedPositionStockId((current) =>
                            current === stock.id ? null : stock.id,
                        );
                    }
                }}
                onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('stockId', stock.id.toString());
                }}
                onOpenDetails={() => {
                    if (!canOpenDetails || !stock.symbol) {
                        return;
                    }
                    openSecurityDetails({ ticker: `${stock.prefix || ''}${stock.symbol}`, name: stock.name || stock.symbol });
                }}
                onToggleNonAllocating={(event) => {
                    event.stopPropagation();
                    void toggleNonAllocatingInstrument(stock);
                }}
            >
                {renderPositionStockCells(stock)}
            </PositionStockRow>
        );
    };

    const toggleBucketCollapsed = (bucket: PositionBucketKey) => {
        setCollapsedRegimeGroups((prev) => {
            const next = new Set(prev);
            const key = `bucket:${bucket}`;
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const isBucketCollapsed = (bucket: PositionBucketKey) =>
        collapsedRegimeGroups.has(`bucket:${bucket}`);

    const collapseReviewHierarchyForConfirmation = () => {
        setCollapsedRegimeGroups(new Set());
        setGroups((prev) => prev.map((group) => ({ ...group, collapsed: true })));
        setReviewFocus({
            type: 'bucket',
            key: 'bucket:q1',
            bucket: 'q1',
            label: 'Q1',
        });
    };

    const renderBucketRow = (
        bucket: PositionBucketKey,
        label: string,
        depth: number,
        stats: {
            marketValue: number;
            bookValue: number;
            cashReserve: number;
            plDollar: number;
        },
        options: {
            classPercent?: number | null;
            showChildren?: boolean;
            tone?: string;
        } = {},
    ) => {
        const portfolioPercentValue =
            bucket === 'cash_reserve'
                ? stats.marketValue + stats.cashReserve
                : stats.marketValue;
        const portfolioPercentTotal =
            portfolioMix?.total_value ||
            overlaySummary?.portfolio_value ||
            portfolio.totalValue ||
            0;
        const portfolioPercent =
            portfolioPercentTotal > 0
                ? (portfolioPercentValue / portfolioPercentTotal) * 100
                : 0;
        const isCollapsed = isBucketCollapsed(bucket);
        const isBracketHeading = !isPortfolioReviewMode && !isPortfolioRebalanceMode
            && ['full_q1', 'partial_q1', 'q1_exempt'].includes(bucket);
        const tone = isBracketHeading
            ? 'position-risk-heading border-b border-border/30 text-foreground'
            : options.tone || 'border-l-4 border-b border-border/60 border-l-sky-500/70 bg-sky-500/[0.08] text-foreground';
        const reconciliationCheck = getBucketReconciliationCheck(bucket);
        const reconciliationTone = isReconciliationVariance(reconciliationCheck)
            ? ' border-l-destructive/70'
            : '';
        const portfolioBucketAssetClassCode =
            bucket === 'cash_reserve' ? 'CASH' : null;
        return (
            <PositionBucketAggregateRow
                portfolioAssetClassRow={
                    isPortfolioRebalanceMode && Boolean(portfolioBucketAssetClassCode)
                }
                assetClassCode={portfolioBucketAssetClassCode}
                className={`${tone}${reviewRowClass(`bucket:${bucket}`)}${reconciliationTone}`}
                isPortfolioReviewMode={isPortfolioReviewMode}
                depth={depth}
                label={label}
                collapsed={isCollapsed}
                showChildren={options.showChildren !== false}
                onMouseEnter={() => enterPositionStatsPeekLayer('bucket')}
                onMouseLeave={leavePositionStatsPeekLayer}
                onNameClick={() => {
                    if (isPortfolioReviewMode) {
                        setReviewFocus({
                            type: 'bucket',
                            key: `bucket:${bucket}`,
                            bucket,
                            label,
                        });
                    }
                    options.showChildren !== false &&
                        toggleBucketCollapsed(bucket);
                }}
            >
                {renderPositionAggregateCells(stats, {
                    classPercent: options.classPercent ?? null,
                    plannedCutValue: isPortfolioTargetAdjustmentMode
                        ? getPortfolioPlannedCutForStocks(
                              bucket === 'q1'
                                  ? [
                                        ...bucketStocksMap.full_q1,
                                        ...bucketStocksMap.partial_q1,
                                    ]
                                  : bucketStocksMap[bucket],
                          )
                        : isSignalAdjustmentMode
                          ? getReviewPlannedCutForStocks(
                            bucket === 'q1'
                                  ? [
                                        ...bucketStocksMap.full_q1,
                                        ...bucketStocksMap.partial_q1,
                                    ]
                                  : bucketStocksMap[bucket],
                          )
                        : isPortfolioRebalanceMode
                          ? getPortfolioPlannedCutForStocks(
                                bucket === 'q1'
                                    ? [
                                          ...bucketStocksMap.full_q1,
                                          ...bucketStocksMap.partial_q1,
                                      ]
                                    : bucketStocksMap[bucket],
                            )
                        : 0,
                    requiredCutValue: isPortfolioTargetAdjustmentMode
                        ? getPortfolioRequiredCutForAssetCodes(
                              getPortfolioAssetCodesForStocks(
                                  bucket === 'q1'
                                      ? [
                                            ...bucketStocksMap.full_q1,
                                            ...bucketStocksMap.partial_q1,
                                        ]
                                      : bucketStocksMap[bucket],
                              ),
                          )
                        : isSignalAdjustmentMode
                        ? getReviewPlanForBucket(bucket, label).moveValue
                        : isPortfolioRebalanceMode
                          ? getPortfolioRequiredCutForAssetCodes(
                                getPortfolioAssetCodesForStocks(
                                    bucket === 'q1'
                                        ? [
                                              ...bucketStocksMap.full_q1,
                                              ...bucketStocksMap.partial_q1,
                                          ]
                                        : bucketStocksMap[bucket],
                                ),
                            )
                        : 0,
                    cutLabel: undefined,
                    targetReductionPct:
                        isSignalAdjustmentMode && bucket === 'q1'
                            ? immutableReviewSignalCutRatio * 100
                            : null,
                    portfolioPercent,
	                    showStats: positionQ1StatsVisible,
	                    subtle: true,
	                    emphasizePortfolioPercent: bucket === 'q1',
	                    portfolioAssetClassCode:
	                        bucket === 'cash_reserve' ? 'CASH' : null,
                        assetLabel: getBucketSummaryText(bucket),
	                    reconciliationCheck,
	                })}
            </PositionBucketAggregateRow>
        );
    };

    const pendingReserveValue = Math.max(
        0,
        overlaySummary?.stage1_recorded_reduction_value ??
            reviewCashMovementRecord?.recordedReductionValue ??
            0,
    );
    const pendingReserveExpectedValue = Math.max(
        0,
        overlaySummary?.stage1_expected_reserve_value ??
            reviewCashMovementRecord?.expectedReserveValue ??
            0,
    );
    const pendingReserveStatus = String(
        overlaySummary?.cash_confirmation_status || '',
    ).toUpperCase();
    const showPendingReserveRow =
        isSignalAdjustmentMode &&
        pendingReserveValue > 1 &&
        pendingReserveStatus !== 'CONFIRMED' &&
        Boolean(
            reviewStage1CompletedAt ||
                overlaySummary?.active_event_stage1_applied_at,
        );

    const renderPendingReserveRow = () => {
        if (!showPendingReserveRow) return null;

        return (
            <PositionPendingReserveRow
                isPortfolioReviewMode={isPortfolioReviewMode}
                title={
                    pendingReserveExpectedValue > 0
                        ? `Expected reserve after import: ${money(
                              pendingReserveExpectedValue,
                          )}`
                        : 'Pending reserve cash from confirmed adjustments'
                }
            >
                {renderPositionAggregateCells(
                    {
                        marketValue: 0,
                        bookValue: 0,
                        cashReserve: pendingReserveValue,
                        plDollar: 0,
                    },
                        {
                        classPercent: null,
                        plannedCutValue: 0,
                        requiredCutValue: 0,
	                        portfolioPercent: 0,
	                        showStats: positionQ1StatsVisible,
	                        portfolioAssetClassCode: 'CASH',
	                        reconciliationCheck: getReserveReconciliationCheck(),
	                    },
                )}
            </PositionPendingReserveRow>
        );
    };

    const getPortfolioPositionTotalValue = () =>
        portfolioMix?.total_value ||
        overlaySummary?.portfolio_value ||
        portfolio.totalValue ||
        0;

    const renderPortfolioCashAssetClassRow = (): React.ReactNode =>
        renderPortfolioCashAssetClassRows({
            isPortfolioRebalanceMode,
            portfolioCashBucketValue,
            portfolioMixCashRow,
            cashComponents: portfolioMix?.cash_components,
            portfolioTotalValue: getPortfolioPositionTotalValue(),
            portfolioCollapsedGroupIds,
            portfolioClassTintStyle: getPortfolioAssetClassTintStyle('CASH'),
            isPortfolioReviewMode,
            positionQ1StatsVisible,
            rowClassName: `bg-muted/10 border-b border-border/50 cursor-pointer${portfolioAssetClassSelectRowClass('CASH')}`,
            renderPositionAggregateCells,
            hoverPortfolioAssetClass,
            clearHoveredPortfolioAssetClass,
            selectPortfolioAssetClass,
            togglePortfolioGroupCollapsed,
        });

    const renderPortfolioUnassignedAssetClassRow = (): React.ReactNode =>
        renderPortfolioUnassignedAssetClassRows({
            isPortfolioRebalanceMode,
            portfolioMixUnassignedRow,
            unassignedPortfolioStocks,
            portfolioTotalValue: getPortfolioPositionTotalValue(),
            portfolioCollapsedGroupIds,
            portfolioClassTintStyle: getPortfolioAssetClassTintStyle('UNASSIGNED'),
            isPortfolioReviewMode,
            positionGroupStatsVisible,
            reviewSummaryRowsOnly,
            rowClassName: `bg-muted/10 border-b border-border/50 cursor-pointer${portfolioAssetClassSelectRowClass('UNASSIGNED')}`,
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
        });

    const getPortfolioCashClassPercent = () =>
        portfolioCashBucketValue > 0.01 || portfolioMixCashRow ? 100 : 0;

    const getPortfolioCashPortfolioPercent = () =>
        portfolioMixCashRow?.weight_pct ??
        (getPortfolioPositionTotalValue() > 0
            ? (portfolioCashBucketValue / getPortfolioPositionTotalValue()) * 100
            : 0);

    const renderPortfolioPureSortedRows = () =>
        buildPortfolioPureSortedRows({
            topLevelGroups,
            includeUnassigned:
                (portfolioMixUnassignedRow?.value || 0) > 0.01 ||
                unassignedPortfolioStocks.length > 0,
            includeCash: portfolioCashBucketValue > 0.01 || Boolean(portfolioMixCashRow),
            sortColumn,
            sortDirection,
            getEntryDisplayOrder: (entry) => {
                if (entry.kind === 'reduce') return 10000;
                if (entry.kind === 'unassigned') {
                    return getAssetClassSetting('UNASSIGNED')?.display_order ?? 999;
                }
                const code = getGroupAssetClassCode(entry.group);
                return getAssetClassSetting(code)?.display_order ?? entry.group.order;
            },
            getEntryClassPercent: (entry) =>
                entry.kind === 'reduce'
                    ? getPortfolioCashClassPercent()
                    : entry.kind === 'unassigned'
                      ? 100
                      : getClassPercentForGroup(entry.group) ?? 0,
            getEntryPortfolioPercent: (entry) => {
                if (entry.kind === 'reduce') return getPortfolioCashPortfolioPercent();
                if (entry.kind === 'unassigned') {
                    return (
                        portfolioMixUnassignedRow?.weight_pct ??
                        (portfolio.totalValue > 0
                            ? (unassignedPortfolioStocks.reduce(
                                  (sum, stock) => sum + (stock.positionValue || 0),
                                  0,
                              ) /
                                  portfolio.totalValue) *
                              100
                            : 0)
                    );
                }
                const stats = calculateGroupStats(entry.group.id);
                return portfolio.totalValue > 0
                    ? (stats.marketValue / portfolio.totalValue) * 100
                    : 0;
            },
            renderGroupBranch,
            renderPortfolioCashAssetClassRows: renderPortfolioCashAssetClassRow,
            renderPortfolioUnassignedAssetClassRows:
                renderPortfolioUnassignedAssetClassRow,
        });

    const renderPortfolioHiddenBucketSpacerRow = (key: string) => (
        <PortfolioHiddenBucketSpacerRow
            key={key}
            rowKey={key}
            isPortfolioRebalanceMode={isPortfolioRebalanceMode}
            showPortfolioBucketRows={showPortfolioBucketRows}
            positionGridColumns={positionGridColumns}
        />
    );

    const renderGroupBranch = (
        group: StockGroup,
        depth: number,
    ): React.ReactNode[] => {
        if (!visiblePositionGroupIds.has(group.id)) return [];
        const branchRows: React.ReactNode[] = [];
        const directStocks = getGroupDirectStocks(group.id);
        const childGroups = sortPositionGroupsForActiveColumn(
            groups
                .filter((g) => g.parent_id === group.id)
                .sort((a, b) => a.order - b.order),
        );
        const stats = calculateGroupStats(group.id);
        const portfolioPercent =
            portfolio.totalValue > 0
                ? (stats.marketValue / portfolio.totalValue) * 100
                : 0;
        const groupCollapsed = isPortfolioRebalanceMode
            ? portfolioCollapsedGroupIds.has(group.id)
            : group.collapsed;
        const groupOpen = reviewSummaryRowsOnly ? false : !groupCollapsed;
        const groupAssetClassCode = getNamedGroupAssetClassCode(group);
        const positionShapeModel = resolvePositionAssetClassShape({
            assetClassCode: groupAssetClassCode,
            currentRows: portfolioMix?.rows,
            approvedRows: approvedPortfolioMix?.rows,
            fallbackCurrentPct: portfolioPercent,
        });
        const showPositionShapeComparison =
            activeTab === 'POSITIONS' &&
            positionsMode === 'normal' &&
            positionAssetClassRowMode === 'shape' &&
            Boolean(positionShapeModel);
        const commodityEquityTheme = groupAssetClassCode
            ? commodityThemesByTacticalAssetClass.get(groupAssetClassCode)
            : undefined;
        const commodityDirectTheme = groupAssetClassCode
            ? commodityThemesByStrategicAssetClass.get(groupAssetClassCode)
            : undefined;
        const commodityTheme = commodityEquityTheme || commodityDirectTheme;
        const commodityThemeIndicator = commodityTheme ? (
            <CommodityThemeDirectAndEquityGateIndicator theme={commodityTheme} />
        ) : null;
        const showGroupHeaderSupplement =
            activeTab === 'POSITIONS' &&
            (!showPositionShapeComparison || Boolean(commodityThemeIndicator));
        const portfolioGroupSummaryLabel = showPositionShapeComparison ? (
            commodityThemeIndicator
        ) : positionShapeModel ? (
            <span className="inline-flex min-w-0 items-center gap-1">
                <span>
                    {pct1(positionShapeModel.currentPct)} /{' '}
                    <span
                        className={
                            positionShapeModel.targetPct === null
                                ? 'text-muted-foreground/50'
                                : 'text-yellow-400'
                        }
                    >
                        {positionShapeModel.targetPct === null
                            ? '—'
                            : pct1(positionShapeModel.targetPct)}
                    </span>
                </span>
                {commodityThemeIndicator}
            </span>
        ) : (
            <span className="inline-flex min-w-0 items-center gap-1">
                <span>{money(stats.marketValue)} ({pct1(portfolioPercent)})</span>
                {commodityThemeIndicator}
            </span>
        );
        const portfolioGroupSummaryTitle = showPositionShapeComparison
            ? 'Commodity and producer-equity gates'
            : positionShapeModel
            ? positionShapeModel.targetPct === null
                ? `Actual ${pct1(positionShapeModel.currentPct)} · No approved target · ${money(stats.marketValue)}`
                : `Actual ${pct1(positionShapeModel.currentPct)} / Target ${pct1(
                      positionShapeModel.targetPct,
                  )} · ${money(stats.marketValue)} / ${money(
                      (positionShapeModel.targetPct / 100) * portfolioTotalValue,
                  )}`
            : `${money(stats.marketValue)} (${pct1(portfolioPercent)})`;
        const reconciliationCheck =
            getAssetClassReconciliationCheck(groupAssetClassCode);
        const reconciliationTone = isReconciliationVariance(reconciliationCheck)
            ? ' border-l-2 border-l-destructive/70'
            : '';
        const portfolioClassTintStyle =
            getPortfolioAssetClassTintStyle(groupAssetClassCode);

        branchRows.push(
            <PositionGroupAggregateRow
                key={group.id}
                appearanceCode={activeTab === 'POSITIONS' && positionsMode === 'normal' ? getPositionAppearanceClassCode(group) : null}
                assetClassCode={
                    isPortfolioRebalanceMode ? groupAssetClassCode : null
                }
                className={`bg-muted/10 border-b border-border/50 cursor-move group-drag-target${activeTab === 'POSITIONS' ? ' positions-parent-row' : ''}${reviewRowClass(`group:${group.id}`)}${portfolioAssetClassSelectRowClass(groupAssetClassCode)}${reconciliationTone}`}
                style={portfolioClassTintStyle}
                isPortfolioReviewMode={isPortfolioReviewMode}
                depth={depth}
                label={getLeafGroupLabel(group)}
                open={groupOpen}
                showSupplement={showGroupHeaderSupplement}
                supplementLabel={portfolioGroupSummaryLabel}
                supplementTitle={portfolioGroupSummaryTitle}
                onMouseEnter={() => {
                    enterPositionStatsPeekLayer('group');
                    hoverPortfolioAssetClass(groupAssetClassCode);
                }}
                onMouseLeave={() => {
                    leavePositionStatsPeekLayer();
                    clearHoveredPortfolioAssetClass();
                }}
                onClick={() => selectPortfolioAssetClass(groupAssetClassCode)}
                onDragStart={(e) => {
                    e.dataTransfer.setData('groupId', group.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedGroupId(group.id);
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    const droppedGroupId = e.dataTransfer.getData('groupId');
                    const stockId = e.dataTransfer.getData('stockId');
                    if (droppedGroupId) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const insertBefore =
                            e.clientY < rect.top + rect.height / 2;
                        reorderGroup(droppedGroupId, group.id, insertBefore);
                    } else if (stockId) {
                        assignStockToGroup(parseInt(stockId), group.id);
                    }
                    setDraggedGroupId(null);
                }}
                onDragEnd={() => setDraggedGroupId(null)}
                onNameClick={(e) => {
                    e.stopPropagation();
                    selectPortfolioAssetClass(groupAssetClassCode);
                    if (isPortfolioReviewMode) {
                        setReviewFocus({
                            type: 'group',
                            key: `group:${group.id}`,
                            groupId: group.id,
                            label: getLeafGroupLabel(group),
                        });
                    }
                    if (reviewSummaryRowsOnly) return;
                    if (isPortfolioRebalanceMode) {
                        togglePortfolioGroupCollapsed(group.id);
                        return;
                    }
                    toggleGroupCollapsed(group.id, {
                        persist: !isPortfolioReviewMode,
                    });
                }}
            >
                {showPositionShapeComparison && positionShapeModel ? (
                    <PositionAssetClassShapeCell
                        model={positionShapeModel}
                        scaleMax={positionShapeScaleMax}
                        accentColor={getPortfolioAssetClassColor(
                            groupAssetClassCode || '',
                            Math.max(
                                0,
                                groups.findIndex((item) => item.id === group.id),
                            ),
                        )}
                        columnSpan={Math.max(1, positionGridColumns.length - 1)}
                        unit={positionShapeUnit}
                        totalValue={portfolioTotalValue}
                    />
                ) : renderPositionAggregateCells(stats, {
                    classPercent: getClassPercentForGroup(group),
                    plannedCutValue: isPortfolioTargetAdjustmentMode
                        ? getPortfolioPlannedCutForStocks(
                              getGroupStocksRecursive(group.id),
                          )
                        : isSignalAdjustmentMode
                        ? getReviewPlannedCutForStocks(
                              getGroupStocksRecursive(group.id),
                          )
                        : isPortfolioRebalanceMode
                          ? getPortfolioPlannedCutForStocks(
                                getGroupStocksRecursive(group.id),
                            )
                        : 0,
                    requiredCutValue: isPortfolioTargetAdjustmentMode
                        ? getPortfolioRequiredCutForGroup(group)
                        : isSignalAdjustmentMode
                        ? getReviewPlanForGroup(group).moveValue
                        : isPortfolioRebalanceMode
                          ? getPortfolioRequiredCutForGroup(group)
                        : 0,
                    cutLabel: undefined,
                    portfolioPercent:
                        positionShapeModel?.currentPct ?? portfolioPercent,
                    portfolioTargetPercent:
                        positionShapeModel?.targetPct ?? null,
                    showStats: positionGroupStatsVisible,
                    subtle: true,
                    alwaysShowPortfolioPercent:
                        activeTab === 'POSITIONS' && !isPortfolioReviewMode,
	                    editableCashAssetClassCode:
	                        getEditableAssetClassCodeForGroup(group),
	                    portfolioAssetClassCode: groupAssetClassCode,
                    assetLabel: formatAssetClassLabel(groupAssetClassCode),
	                    enforceReductionTarget: !group.parent_id,
	                    reconciliationCheck,
                })}
            </PositionGroupAggregateRow>,
        );

        if (groupOpen) {
            if (!reviewSummaryRowsOnly) {
                directStocks.forEach((stock) => {
                    branchRows.push(renderStockRow(stock, depth + 1));
                });
            }
            childGroups.forEach((child) => {
                branchRows.push(...renderGroupBranch(child, depth + 1));
            });
        }

        return branchRows;
    };

    const renderBucketBody = (
        bucket: PositionBucketKey,
        depth: number,
        respectBucketCollapse = true,
    ) => {
        const nodes: React.ReactNode[] = [];
        if (respectBucketCollapse && isBucketCollapsed(bucket)) return nodes;

        sortPositionGroupsForActiveColumn(
            topLevelGroupsByBucket[bucket],
        ).forEach((group) => {
            nodes.push(...renderGroupBranch(group, depth));
        });

        if (ungroupedStocksByBucket[bucket].length > 0) {
            const ungroupedAssetClassCode = ungroupedStocksByBucket[bucket].some(
                (stock) => getStockAssetClassCode(stock) === 'UNASSIGNED',
            )
                ? 'UNASSIGNED'
                : null;
            nodes.push(
                <PositionUngroupedAggregateRow
                    key={`ungrouped-${bucket}`}
                    portfolioAssetClassRow={
                        isPortfolioRebalanceMode && Boolean(ungroupedAssetClassCode)
                    }
                    assetClassCode={ungroupedAssetClassCode}
                    isPortfolioReviewMode={isPortfolioReviewMode}
                    depth={depth}
                    onMouseEnter={() => enterPositionStatsPeekLayer('group')}
                    onMouseLeave={leavePositionStatsPeekLayer}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add('bg-primary/10');
                    }}
                    onDragLeave={(e) => {
                        e.currentTarget.classList.remove('bg-primary/10');
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('bg-primary/10');
                        const stockId = parseInt(
                            e.dataTransfer.getData('stockId'),
                        );
                        if (stockId) {
                            assignStockToGroup(stockId, null);
                        }
                    }}
                >
                    {renderPositionAggregateCells(
                        calculateStatsForStocks(
                            ungroupedStocksByBucket[bucket],
                        ),
                        {
                            classPercent: null,
                            plannedCutValue: isPortfolioTargetAdjustmentMode
                                ? getPortfolioPlannedCutForStocks(
                                      ungroupedStocksByBucket[bucket],
                                  )
                                : isSignalAdjustmentMode
                                ? getReviewPlannedCutForStocks(
                                      ungroupedStocksByBucket[bucket],
                                  )
                                : 0,
                            requiredCutValue: isPortfolioTargetAdjustmentMode
                                ? getPortfolioRequiredCutForAssetCodes(
                                      getPortfolioAssetCodesForStocks(
                                          ungroupedStocksByBucket[bucket],
                                      ),
                                  )
                                : 0,
                            portfolioPercent:
                                portfolio.totalValue > 0
                                    ? (calculateStatsForStocks(
                                          ungroupedStocksByBucket[bucket],
                                      ).marketValue /
                                          portfolio.totalValue) *
                                      100
                                    : 0,
                            showStats: positionGroupStatsVisible,
                            subtle: true,
                            enforceReductionTarget: false,
                        },
                    )}
                </PositionUngroupedAggregateRow>,
            );
            if (!reviewSummaryRowsOnly) {
                ungroupedStocksByBucket[bucket].forEach((stock) => {
                    nodes.push(renderStockRow(stock));
                });
            }
        }

        return nodes;
    };

    const renderPositionRowsWithoutBucketRows = () => (
        <>
            {sortPositionGroupsForActiveColumn(topLevelGroups).flatMap((group) =>
                renderGroupBranch(group, 0),
            )}
            {ungroupedStocks.length > 0 && (
                <PositionUngroupedAggregateRow
                    key="ungrouped-all"
                    portfolioAssetClassRow={false}
                    isPortfolioReviewMode={isPortfolioReviewMode}
                    depth={0}
                    assetClassCode={
                        ungroupedStocks.some(
                            (stock) => getStockAssetClassCode(stock) === 'UNASSIGNED',
                        )
                            ? 'UNASSIGNED'
                            : null
                    }
                    onMouseEnter={() => enterPositionStatsPeekLayer('group')}
                    onMouseLeave={leavePositionStatsPeekLayer}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add('bg-primary/10');
                    }}
                    onDragLeave={(e) => {
                        e.currentTarget.classList.remove('bg-primary/10');
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('bg-primary/10');
                        const stockId = parseInt(
                            e.dataTransfer.getData('stockId'),
                        );
                        if (stockId) {
                            assignStockToGroup(stockId, null);
                        }
                    }}
                >
                    {renderPositionAggregateCells(
                        calculateStatsForStocks(ungroupedStocks),
                        {
                            classPercent: null,
                            plannedCutValue: isPortfolioTargetAdjustmentMode
                                ? getPortfolioPlannedCutForStocks(ungroupedStocks)
                                : isSignalAdjustmentMode
                                ? getReviewPlannedCutForStocks(ungroupedStocks)
                                : 0,
                            requiredCutValue: isPortfolioTargetAdjustmentMode
                                ? getPortfolioRequiredCutForAssetCodes(
                                      getPortfolioAssetCodesForStocks(
                                          ungroupedStocks,
                                      ),
                                  )
                                : 0,
                            portfolioPercent:
                                portfolio.totalValue > 0
                                    ? (calculateStatsForStocks(ungroupedStocks)
                                          .marketValue /
                                          portfolio.totalValue) *
                                      100
                                    : 0,
                            showStats: positionGroupStatsVisible,
                            subtle: true,
                            enforceReductionTarget: false,
                        },
                    )}
                </PositionUngroupedAggregateRow>
            )}
            {!reviewSummaryRowsOnly &&
                ungroupedStocks.map((stock) => renderStockRow(stock))}
            {renderBucketRow(
                'cash_reserve',
                'Cash/Reserve',
                0,
                bucketStats.cash_reserve,
                {
                    showChildren: false,
                    tone: 'border-l-4 border-b border-border border-l-zinc-400/70 bg-zinc-400/[0.08] text-foreground',
                },
            )}
            {renderPendingReserveRow()}
        </>
    );

    const getBucketAssetCodes = (bucket: PositionBucketKey): string[] => {
        const stocksForBucket =
            bucket === 'q1'
                ? [
                      ...bucketStocksMap.full_q1,
                      ...bucketStocksMap.partial_q1,
                  ]
                : bucketStocksMap[bucket];
        const codes = new Set<string>();
        stocksForBucket.forEach((stock) => {
            const code = getStockAssetClassCode(stock);
            if (code !== 'UNASSIGNED' && code !== 'CASH') codes.add(code);
        });
        return Array.from(codes);
    };

    const getBucketOverlayDelta = (bucket: PositionBucketKey): number =>
        getBucketAssetCodes(bucket).reduce((sum, code) => {
            const row = overlayRowsByCode.get(code);
            if (!row || typeof row.delta_value !== 'number') return sum;
            return sum + Math.max(0, row.delta_value);
        }, 0);

    const getOverlayPlanForCodes = (
        assetCodes: string[],
        fallbackCurrentValue: number,
    ) => {
        const rows = assetCodes
            .map((code) => overlayRowsByCode.get(code))
            .filter(Boolean) as OverlayAssetClassRow[];

        if (rows.length === 0) {
            return {
                actualValue: fallbackCurrentValue,
                targetValue: fallbackCurrentValue,
                moveValue: 0,
                hasOverlay: false,
            };
        }

        return rows.reduce(
            (acc, row) => {
                const actual =
                    row.actual_invested_value ?? row.invested_value ?? 0;
                const target =
                    !isQ4DReviewSignal && row.overlay_eligible === false
                        ? actual
                        : row.allowed_invested_value ?? actual;
                const move =
                    typeof row.delta_value === 'number'
                        ? row.delta_value
                        : actual - target;

                return {
                    actualValue: acc.actualValue + actual,
                    targetValue: acc.targetValue + target,
                    moveValue: acc.moveValue + Math.max(0, move),
                    hasOverlay: true,
                };
            },
            {
                actualValue: 0,
                targetValue: 0,
                moveValue: 0,
                hasOverlay: false,
            },
        );
    };

    const getReviewPortfolioPct = (value: number) => {
        const totalValue = overlaySummary?.portfolio_value || portfolio.totalValue;
        return totalValue > 0 ? (value / totalValue) * 100 : 0;
    };

    const getReviewPlanForBucket = (
        bucket: PositionBucketKey,
        label: string,
    ): ReviewSelectionPlan => {
        const stats = bucketStats[bucket];
        if (bucket === 'q1') {
            const currentValue = stats.marketValue;
            const moveValue = getBucketOverlayDelta(bucket);
            const targetValue = Math.max(0, currentValue - moveValue);
            const plannedMoveValue = getReviewPlannedCutForStocks([
                ...bucketStocksMap.full_q1,
                ...bucketStocksMap.partial_q1,
            ]);
            const displayTargetValue =
                plannedMoveValue > 0
                    ? Math.max(0, currentValue - plannedMoveValue)
                    : targetValue;
            const currentClassPct = currentValue > 0 ? 100 : null;
            const targetClassPct =
                currentValue > 0
                    ? (displayTargetValue / currentValue) * 100
                    : null;
            return {
                label,
                level: 'Q1 positions',
                executionMode: 'sleeve_target',
                currentValue,
                targetValue: displayTargetValue,
                moveValue,
                requiredMoveValue: moveValue,
                plannedMoveValue,
                remainingMoveValue: Math.max(0, moveValue - plannedMoveValue),
                currentPortfolioPct: getReviewPortfolioPct(currentValue),
                targetPortfolioPct: getReviewPortfolioPct(displayTargetValue),
                currentClassPct,
                targetClassPct,
                note:
                    moveValue > 1
                        ? `Sell ${money(
                              moveValue,
                          )} from Q1 holdings and hold the proceeds in reserve.`
                        : 'Q1 exposure is already inside the signal allowance.',
            };
        }

        const plan = getOverlayPlanForCodes(
            getBucketAssetCodes(bucket),
            stats.marketValue,
        );
        const targetValue = Math.max(0, plan.targetValue);
        const plannedMoveValue = getReviewPlannedCutForStocks(
            bucketStocksMap[bucket],
        );
        const displayTargetValue =
            plannedMoveValue > 0
                ? Math.max(0, plan.actualValue - plannedMoveValue)
                : targetValue;
        const q1PlannedMove = getReviewPlannedCutForStocks([
            ...bucketStocksMap.full_q1,
            ...bucketStocksMap.partial_q1,
        ]);
        const q1DraftDenominator =
            bucketStats.q1.marketValue > 0
                ? Math.max(0, bucketStats.q1.marketValue - q1PlannedMove)
                : 0;
        const currentClassPct =
            bucket === 'full_q1' ||
            bucket === 'partial_q1'
                ? getBucketClassPercent(bucket)
                : null;
        const targetClassPct =
            currentClassPct != null && q1DraftDenominator > 0
                ? (displayTargetValue / q1DraftDenominator) * 100
                : currentClassPct;

        return {
            label,
            level:
                bucket === 'partial_q1'
                    ? 'Q1-defensive bucket'
                    : bucket === 'q1_exempt'
                    ? 'Q1-exempt bucket'
                    : bucket === 'cash_reserve'
                      ? 'Reserve bucket'
                      : 'Q1 throttle bucket',
            executionMode: 'sleeve_target',
            currentValue: plan.actualValue,
            targetValue: displayTargetValue,
            moveValue: plan.moveValue,
            requiredMoveValue: plan.moveValue,
            plannedMoveValue,
            remainingMoveValue: Math.max(0, plan.moveValue - plannedMoveValue),
            currentPortfolioPct: getReviewPortfolioPct(plan.actualValue),
            targetPortfolioPct: getReviewPortfolioPct(displayTargetValue),
            currentClassPct,
            targetClassPct,
            note:
                plan.moveValue > 1
                    ? 'Reduce this bucket and place proceeds in reserve.'
                    : 'No forced move from this bucket.',
        };
    };

    const getReviewPlanForGroup = (
        group: StockGroup,
    ): ReviewSelectionPlan => {
        const currentStats = calculateGroupStats(group.id);
        const plan = getOverlayPlanForCodes(
            getGroupAssetCodesForRegime(group),
            currentStats.marketValue,
        );
        const targetValue = Math.max(0, plan.targetValue);
        const classDenominator = group.parent_id
            ? calculateGroupMarketValue(group.parent_id)
            : bucketStats[
                  getBucketMetaForAssetClass(getGroupAssetClassCode(group))
                      .bucket
              ].marketValue;
        const plannedMoveValue = getReviewPlannedCutForStocks(
            getGroupStocksRecursive(group.id),
        );
        const displayTargetValue =
            plannedMoveValue > 0
                ? Math.max(0, currentStats.marketValue - plannedMoveValue)
                : targetValue;
        const draftClassDenominator = (() => {
            if (group.parent_id) {
                return Math.max(
                    0,
                    calculateGroupMarketValue(group.parent_id) -
                        getReviewPlannedCutForStocks(
                            getGroupStocksRecursive(group.parent_id),
                        ),
                );
            }
            const bucket =
                getBucketMetaForAssetClass(getGroupAssetClassCode(group)).bucket;
            const bucketStocks =
                bucket === 'q1'
                    ? [
                          ...bucketStocksMap.full_q1,
                          ...bucketStocksMap.partial_q1,
                      ]
                    : bucketStocksMap[bucket] || [];
            return Math.max(
                0,
                bucketStats[bucket].marketValue -
                    getReviewPlannedCutForStocks(bucketStocks),
            );
        })();
        const currentClassPct =
            classDenominator > 0
                ? (currentStats.marketValue / classDenominator) * 100
                : null;
        const targetClassPct =
            draftClassDenominator > 0
                ? (displayTargetValue / draftClassDenominator) * 100
                : currentClassPct;

        return {
            label: getLeafGroupLabel(group),
            level: group.parent_id ? 'Group / subclass' : 'Asset class',
            executionMode: 'sleeve_target',
            currentValue: currentStats.marketValue,
            targetValue: displayTargetValue,
            moveValue: plan.moveValue,
            requiredMoveValue: plan.moveValue,
            plannedMoveValue,
            remainingMoveValue: Math.max(0, plan.moveValue - plannedMoveValue),
            currentPortfolioPct: getReviewPortfolioPct(currentStats.marketValue),
            targetPortfolioPct: getReviewPortfolioPct(displayTargetValue),
            currentClassPct,
            targetClassPct,
            note:
                plan.moveValue > 1
                    ? 'Reduce this sleeve into reserve. Stock selection is discretionary.'
                    : 'No forced move from this row.',
        };
    };

    const getReviewPlanForStock = (stock: Stock): ReviewSelectionPlan => {
        const currentValue = stock.positionValue || 0;
        const assetCode = getStockAssetClassCode(stock);
        const row = overlayRowsByCode.get(assetCode);
        const classDenominator =
            getImmediateParentMarketValueForStock(stock) || 0;
        const currentClassPct =
            classDenominator > 0
                ? (currentValue / classDenominator) * 100
                : null;
        const sleeveMove = Math.max(0, row?.delta_value ?? 0);
        const assetLabel = formatAssetClassLabel(assetCode);
        const stockPlannedMove = getReviewPlannedCutForStock(stock);
        const assetPlannedMove = getReviewPlannedCutForAssetCodes([assetCode]);
        const stockSuggestedMove = getReviewSuggestedCutForStock(stock);
        const displayMove =
            stockPlannedMove > 0 ? stockPlannedMove : stockSuggestedMove;
        const targetValue = Math.max(0, currentValue - displayMove);
        const targetClassPct =
            displayMove > 0 && classDenominator > 0
                ? (targetValue / classDenominator) * 100
                : null;

        return {
            label: stock.name,
            level: 'Stock',
            executionMode: 'stock_choice',
            currentValue,
            targetValue,
            moveValue: stockPlannedMove,
            suggestedMoveValue: stockSuggestedMove,
            requiredMoveValue: sleeveMove,
            plannedMoveValue: assetPlannedMove,
            remainingMoveValue: Math.max(0, sleeveMove - assetPlannedMove),
            currentPortfolioPct: getReviewPortfolioPct(currentValue),
            targetPortfolioPct: getReviewPortfolioPct(targetValue),
            currentClassPct,
            targetClassPct,
            note:
                sleeveMove > 1
                    ? `${assetLabel} needs ${money(
                          sleeveMove,
                      )} moved to reserve. The suggested amount is proportional guidance only; you can allocate the adjustment across stocks manually.`
                    : `No sleeve-level reserve move is required for ${assetLabel}.`,
        };
    };

    const getActiveReviewPlan = (): ReviewSelectionPlan => {
        const focus =
            reviewFocus ??
            ({
                type: 'bucket',
                key: 'bucket:q1',
                bucket: 'q1',
                label: 'Q1',
            } as ReviewFocus);

        if (focus.type === 'bucket') {
            return getReviewPlanForBucket(focus.bucket, focus.label);
        }

        if (focus.type === 'group') {
            const group = groups.find((item) => item.id === focus.groupId);
            if (group) return getReviewPlanForGroup(group);
        }

        if (focus.type === 'stock') {
            const stock = positionStocks.find((item) => item.id === focus.stockId);
            if (stock) return getReviewPlanForStock(stock);
        }

        return getReviewPlanForBucket('q1', 'Q1');
    };



    const positionColumnWidthScope = isPortfolioRebalanceMode
        ? 'portfolio'
        : isPortfolioReviewMode
          ? 'review'
          : 'normal';
    const estimateColumnTextWidth = (
        values: Array<string | number | null | undefined>,
        {
            charPx = 6.4,
            paddingPx = 18,
            minPx = 0,
            maxPx = 240,
        }: {
            charPx?: number;
            paddingPx?: number;
            minPx?: number;
            maxPx?: number;
        } = {},
    ) => {
        const longest = values.reduce<number>((max, value) => {
            const text = value == null ? '' : String(value);
            return Math.max(max, text.length);
        }, 0);
        return Math.max(
            minPx,
            Math.min(maxPx, Math.ceil(longest * charPx + paddingPx)),
        );
    };
    const formatWholeMoneyForColumn = (value: number | null | undefined) =>
        `$${Math.round(Math.abs(value || 0)).toLocaleString()}`;
    const positionGridContentMin = {
        name: estimateColumnTextWidth(
            [
                'NAME',
                ...positionStocks.map((stock) => stock.name),
                ...groups.map((group) => getLeafGroupLabel(group)),
                'Cash/Reserve',
            ],
            {
                charPx: 6.2,
                paddingPx: 30,
                minPx: isPortfolioReviewMode ? 240 : 190,
                maxPx: 320,
            },
        ),
        classPercent: estimateColumnTextWidth(['CLASS %', '100.0%'], {
            minPx: 60,
            maxPx: 78,
        }),
        asset: estimateColumnTextWidth(
            [
                'ASSET',
                ...positionStocks.map((stock) => getStockAssetDisplay(stock)),
                ...groups.map((group) => getNamedGroupAssetClassCode(group) || ''),
            ],
            {
                charPx: 6.1,
                paddingPx: 20,
                minPx: 74,
                maxPx: 120,
            },
        ),
        signal: estimateColumnTextWidth(['ACTION', 'BREAKOUT', 'SELL'], {
            charPx: 6.1,
            paddingPx: 16,
            minPx: 58,
            maxPx: 76,
        }),
        price: estimateColumnTextWidth(
            ['PRICE', ...positionStocks.map((stock) => `$${(stock.price || 0).toFixed(2)}`)],
            {
                charPx: 6.1,
                paddingPx: 18,
                minPx: 58,
                maxPx: 92,
            },
        ),
        money: estimateColumnTextWidth(
            [
                'BOOK VALUE',
                'VALUE',
                'P/L$',
                ...positionStocks.flatMap((stock) => [
                    formatWholeMoneyForColumn(stock.bookValue),
                    formatWholeMoneyForColumn(stock.positionValue),
                    `${(stock.changeValue || 0) >= 0 ? '+' : '-'}${formatWholeMoneyForColumn(
                        stock.changeValue,
                    )}`,
                ]),
            ],
            {
                charPx: 6.1,
                paddingPx: 20,
                minPx: 82,
                maxPx: 124,
            },
        ),
        adjustmentMoney: estimateColumnTextWidth(
            [
                'REQUIRED / GUIDE',
                'RECORDED',
                'EXPECTED',
                'IMPORTED',
                'VARIANCE',
                ...positionStocks.map((stock) =>
                    formatWholeMoneyForColumn(stock.positionValue),
                ),
            ],
            {
                charPx: 6.1,
                paddingPx: 22,
                minPx: 96,
                maxPx: 138,
            },
        ),
        smallPercent: estimateColumnTextWidth(['EXP%', 'P/L%', '+100.00%'], {
            charPx: 6.1,
            paddingPx: 18,
            minPx: 62,
            maxPx: 86,
        }),
        targetPercent: estimateColumnTextWidth(['GUIDE %', '100.0%'], {
            charPx: 6.1,
            paddingPx: 18,
            minPx: 72,
            maxPx: 96,
        }),
        portfolioPercent: estimateColumnTextWidth(['PORTFOLIO %', '100.0%'], {
            charPx: 6.1,
            paddingPx: 30,
            minPx: 96,
            maxPx: 118,
        }),
        currentReduction: estimateColumnTextWidth(['RECORDED %', '100.0%'], {
            charPx: 6.1,
            paddingPx: 26,
            minPx: 108,
            maxPx: 138,
        }),
    };
    const positionGridBaseColumnsUnordered: PositionGridColumn[] = [
        {
            key: 'name',
            widthPx: Math.max(
                isPortfolioReviewMode ? 128 : 224,
                positionGridContentMin.name,
            ),
            minWidthPx: positionGridContentMin.name,
            manualMinWidthPx: isPortfolioReviewMode ? 96 : 128,
            maxWidthPx: isPortfolioReviewMode ? 260 : 360,
            fillMaxWidthPx: isPortfolioReviewMode ? 360 : 560,
            fillWeight: isPortfolioReviewMode ? 0.8 : 0.75,
            manualMaxWidthPx: 1200,
            growWeight: isPortfolioReviewMode ? 0.9 : 0.8,
        },
        ...(positionColumnVisible('classPercent')
            ? [
                  {
                      key: 'classPercent' as const,
                      widthPx: Math.max(56, positionGridContentMin.classPercent),
                      minWidthPx: positionGridContentMin.classPercent,
                      manualMinWidthPx: 44,
                      maxWidthPx: 110,
                      fillMaxWidthPx: 135,
                      fillWeight: 0.25,
                      growWeight: 0.45,
                  },
              ]
            : []),
        ...(positionColumnVisible('modelWeight') ? [{
            key: 'modelWeight' as const, widthPx: 78, minWidthPx: 72,
            manualMinWidthPx: 60, maxWidthPx: 110, fillMaxWidthPx: 135,
            fillWeight: 0.25, growWeight: 0.45,
        }] : []),
        ...(!isPortfolioReviewMode
            ? [
	                  ...(positionColumnVisible('asset')
	                      ? [
		                            {
		                                key: 'asset' as const,
		                                widthPx: Math.max(
		                                    82,
		                                    positionGridContentMin.asset,
		                                ),
		                                minWidthPx: positionGridContentMin.asset,
		                                manualMinWidthPx: 54,
		                                maxWidthPx: 220,
	                                fillMaxWidthPx: 320,
	                                fillWeight: 1,
	                                growWeight: 1.15,
	                            },
	                        ]
	                      : []),
                  ...(positionColumnVisible('trend')
                      ? [
	                            {
	                                key: 'cdf' as const,
	                                widthPx: positionGridContentMin.signal,
	                                minWidthPx: positionGridContentMin.signal,
	                                manualMinWidthPx: 38,
	                                maxWidthPx: 70,
                                growWeight: 0.15,
                            },
                        ]
                      : []),
                  ...(positionColumnVisible('action')
                      ? [
	                            {
	                                key: 'atr' as const,
	                                widthPx: positionGridContentMin.signal,
	                                minWidthPx: positionGridContentMin.signal,
	                                manualMinWidthPx: 42,
	                                maxWidthPx: 80,
                                growWeight: 0.2,
                            },
                        ]
                      : []),
                  ...(positionColumnVisible('dca')
                      ? [
                            {
                                key: 'dca' as const,
                                widthPx: 48,
                                minWidthPx: 44,
                                manualMinWidthPx: 36,
                                maxWidthPx: 62,
                                growWeight: 0.1,
                            },
                        ]
                      : []),
              ]
            : []),
        ...(positionColumnVisible('price')
            ? [
		                  {
		                      key: 'price' as const,
	                      widthPx: positionGridContentMin.price,
	                      minWidthPx: positionGridContentMin.price,
	                      manualMinWidthPx: 44,
	                      maxWidthPx: 90,
                      fillMaxWidthPx: 120,
                      fillWeight: 0.25,
                      growWeight: 0.4,
	                  },
	              ]
            : []),
        ...(positionColumnVisible('bookValue')
            ? [
	                  {
	                      key: 'bookValue' as const,
	                      widthPx: positionGridContentMin.money,
	                      minWidthPx: positionGridContentMin.money,
	                      manualMinWidthPx: 58,
	                      maxWidthPx: 130,
                      fillMaxWidthPx: 170,
                      fillWeight: 0.55,
                      growWeight: 0.75,
                  },
              ]
            : []),
        ...(positionColumnVisible('mktValue')
            ? [
	                  {
	                      key: 'mktValue' as const,
	                      widthPx: Math.max(
	                          isPortfolioReviewMode ? 64 : 72,
	                          positionGridContentMin.money,
	                      ),
	                      minWidthPx: positionGridContentMin.money,
	                      manualMinWidthPx: 58,
	                      maxWidthPx: isPortfolioReviewMode ? 120 : 150,
                      fillMaxWidthPx: isPortfolioReviewMode ? 150 : 190,
                      fillWeight: 0.65,
                      growWeight: 0.9,
                  },
              ]
            : []),
        ...(positionHasReductionWorkflow
            ? [
                  ...(positionColumnVisible('targetAdjustment')
                      ? [
	                            {
	                                key: 'targetAdjustment' as const,
	                                widthPx: Math.max(
	                                    104,
	                                    positionGridContentMin.adjustmentMoney,
	                                ),
	                                minWidthPx:
	                                    positionGridContentMin.adjustmentMoney,
	                                manualMinWidthPx: 72,
	                                maxWidthPx: 150,
                                fillMaxWidthPx: 190,
                                fillWeight: 0.6,
                                growWeight: 0.8,
                            },
                        ]
                      : []),
                  ...(positionColumnVisible('targetAdjustmentPercent')
                      ? [
	                            {
	                                key: 'targetMovePct' as const,
	                                widthPx: positionGridContentMin.targetPercent,
	                                minWidthPx:
	                                    positionGridContentMin.targetPercent,
	                                manualMinWidthPx: 54,
	                                maxWidthPx: 100,
                                fillMaxWidthPx: 125,
                                fillWeight: 0.25,
                                growWeight: 0.45,
                            },
                        ]
                      : []),
	                  {
	                      key: 'reduction' as const,
	                      widthPx: Math.max(
	                          98,
	                          positionGridContentMin.adjustmentMoney,
	                      ),
	                      minWidthPx: positionGridContentMin.adjustmentMoney,
	                      manualMinWidthPx: 72,
	                      maxWidthPx: 150,
                      fillMaxWidthPx: 200,
                      fillWeight: 0.7,
                      growWeight: 0.9,
                  },
              ]
            : []),
        ...(reviewImportVarianceActive
            ? [
	                  {
	                      key: 'expected' as const,
	                      widthPx: positionGridContentMin.adjustmentMoney,
	                      minWidthPx: positionGridContentMin.adjustmentMoney,
	                      manualMinWidthPx: 72,
	                      maxWidthPx: 110,
                      fillMaxWidthPx: 135,
                      fillWeight: 0.35,
                      growWeight: 0.5,
                  },
	                  {
	                      key: 'imported' as const,
	                      widthPx: positionGridContentMin.adjustmentMoney,
	                      minWidthPx: positionGridContentMin.adjustmentMoney,
	                      manualMinWidthPx: 72,
	                      maxWidthPx: 110,
                      fillMaxWidthPx: 135,
                      fillWeight: 0.35,
                      growWeight: 0.5,
                  },
	                  {
	                      key: 'variance' as const,
	                      widthPx: positionGridContentMin.adjustmentMoney,
	                      minWidthPx: positionGridContentMin.adjustmentMoney,
	                      manualMinWidthPx: 72,
	                      maxWidthPx: 110,
                      fillMaxWidthPx: 135,
                      fillWeight: 0.35,
                      growWeight: 0.5,
                  },
              ]
            : []),
        ...(positionColumnVisible('reduce')
            ? [
	                  {
	                      key: 'reduce' as const,
	                      widthPx: Math.max(
	                          isPortfolioReviewMode ? 58 : 64,
	                          positionGridContentMin.money,
	                      ),
	                      minWidthPx: positionGridContentMin.money,
	                      manualMinWidthPx: 58,
	                      maxWidthPx: 110,
                      fillMaxWidthPx: 140,
                      fillWeight: 0.35,
                      growWeight: 0.45,
                  },
              ]
            : []),
        ...(positionColumnVisible('exposurePercent')
            ? [
	                  {
	                      key: 'exposurePercent' as const,
	                      widthPx: Math.max(
	                          isPortfolioReviewMode ? 78 : 54,
	                          positionGridContentMin.smallPercent,
	                      ),
	                      minWidthPx: positionGridContentMin.smallPercent,
	                      manualMinWidthPx: 46,
	                      maxWidthPx: isPortfolioReviewMode ? 110 : 90,
                      fillMaxWidthPx: isPortfolioReviewMode ? 135 : 115,
                      fillWeight: 0.25,
                      growWeight: 0.35,
                  },
              ]
            : []),
        ...(positionColumnVisible('qty')
            ? [
	                  {
	                      key: 'qty' as const,
	                      widthPx: estimateColumnTextWidth(
	                          [
	                              'QTY',
	                              ...positionStocks.map((stock) =>
	                                  stock.position?.toLocaleString() || '0',
	                              ),
	                          ],
	                          {
	                              charPx: 6.1,
	                              paddingPx: 18,
	                              minPx: 56,
	                              maxPx: 92,
	                          },
	                      ),
	                      minWidthPx: estimateColumnTextWidth(
	                          [
	                              'QTY',
	                              ...positionStocks.map((stock) =>
	                                  stock.position?.toLocaleString() || '0',
	                              ),
	                          ],
	                          {
	                              charPx: 6.1,
	                              paddingPx: 18,
	                              minPx: 56,
	                              maxPx: 92,
	                          },
	                      ),
	                      manualMinWidthPx: 44,
	                      maxWidthPx: 90,
                      fillMaxWidthPx: 110,
                      fillWeight: 0.2,
                      growWeight: 0.3,
                  },
              ]
            : []),
        ...(positionColumnVisible('plDollar')
            ? [
	                  {
	                      key: 'plDollar' as const,
	                      widthPx: positionGridContentMin.money,
	                      minWidthPx: positionGridContentMin.money,
	                      manualMinWidthPx: 58,
	                      maxWidthPx: 110,
                      fillMaxWidthPx: 140,
                      fillWeight: 0.35,
                      growWeight: 0.5,
                  },
              ]
            : []),
        ...(positionColumnVisible('plPercent')
            ? [
	                  {
	                      key: 'plPercent' as const,
	                      widthPx: positionGridContentMin.smallPercent,
	                      minWidthPx: positionGridContentMin.smallPercent,
	                      manualMinWidthPx: 46,
	                      maxWidthPx: 90,
                      fillMaxWidthPx: 110,
                      fillWeight: 0.2,
                      growWeight: 0.3,
                  },
              ]
            : []),
        ...(positionColumnVisible('portfolioPercent')
            ? [
	                  {
	                      key: 'portfolioPercent' as const,
	                      widthPx: Math.max(
	                          isPortfolioReviewMode ? 70 : 46,
	                          positionGridContentMin.portfolioPercent,
	                      ),
	                      minWidthPx: positionGridContentMin.portfolioPercent,
	                      manualMinWidthPx: 58,
	                      maxWidthPx: isPortfolioReviewMode ? 110 : 90,
                      fillMaxWidthPx: isPortfolioReviewMode ? 135 : 115,
                      fillWeight: 0.25,
                      growWeight: 0.35,
                  },
              ]
            : []),
        ...(positionHasReductionWorkflow
            ? [
	                  {
	                      key: 'currentReduction' as const,
	                      widthPx: Math.max(
	                          132,
	                          positionGridContentMin.currentReduction,
	                      ),
	                      minWidthPx: positionGridContentMin.currentReduction,
                      manualMinWidthPx: 82,
                      maxWidthPx: 170,
                      fillMaxWidthPx: 220,
                      fillWeight: 0.45,
                      growWeight: 0.65,
                  },
              ]
            : []),
    ];
    const defaultPositionColumnOrder = isPortfolioReviewMode
        ? positionGridBaseColumnsUnordered.map((column) => column.key)
        : defaultNormalPositionColumnOrder;
    // Insert the new column beside Class % without resetting a user's saved order.
    const migratedPositionColumnOrder = [...positionColumnOrder];
    if (migratedPositionColumnOrder.length && !migratedPositionColumnOrder.includes('modelWeight')) {
        const classIndex = migratedPositionColumnOrder.indexOf('classPercent');
        migratedPositionColumnOrder.splice(classIndex >= 0 ? classIndex + 1 : migratedPositionColumnOrder.length, 0, 'modelWeight');
    }
    const positionColumnOrderIndex = new Map(
        migratedPositionColumnOrder.map((key, index) => [key, index] as const),
    );
    const defaultPositionColumnOrderIndex = new Map(
        defaultPositionColumnOrder.map((key, index) => [key, index] as const),
    );
    const actionColumns = isPositionAdjustmentMode ? [
        ...positionGridBaseColumnsUnordered.filter(column => {
            if (reviewImportVarianceActive) return ['name', 'expected', 'imported', 'variance'].includes(column.key);
            if (actionStatementMode) return ['name', 'mktValue'].includes(column.key);
            if (column.key === 'currentReduction') return actionVisibleColumns.targetAdjustmentPercent;
            return true;
        }),
        ...(!actionStatementMode && !reviewImportVarianceActive && positionHasReductionWorkflow ? [{ key: 'remaining' as const,
            widthPx: 100, minWidthPx: 100, fillMaxWidthPx: 140, fillWeight: 0.5 }] : []),
    ] : positionGridBaseColumnsUnordered;
    const positionGridColumns = [...actionColumns].sort(
        (a, b) => {
            if (a.key === 'name') return -1;
            if (b.key === 'name') return 1;
            const aOrder =
                positionColumnOrderIndex.get(a.key) ??
                (migratedPositionColumnOrder.length + (defaultPositionColumnOrderIndex.get(a.key) ?? 999));
            const bOrder =
                positionColumnOrderIndex.get(b.key) ??
                (migratedPositionColumnOrder.length + (defaultPositionColumnOrderIndex.get(b.key) ?? 999));
            return aOrder - bOrder;
        },
    );
    const renderPositionAggregateCells = createRenderPositionAggregateCells({
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
    });
    const renderPositionStockCells = createRenderPositionStockCells({
        usesPortfolioAdjustmentModel,
        isPortfolioReviewMode,
        positionStockStatsVisible,
        reviewImportVarianceActive,
        portfolioTotalValue: portfolio.totalValue,
        securityPositions,
        securityActions,
        onOpenSecurityActions: openAlertAction,
        contributionOverrides,
        setContributionOverrides,
        fetchHoldings,
        logContribution: api.logContribution,
        contributeByName: api.contributeByName,
        getPortfolioPlannedCutForStock,
        getReviewPlannedCutForStock,
        getPortfolioSuggestedCutForStock,
        getReviewTargetCutForStock,
        getReviewPortfolioPct,
        getStockReconciliationCheck,
        getClassPercentForStock,
        modelWeights: positionModelWeights,
        getStockAssetDisplay,
        renderPositionOrderedCells,
        renderClassPercentCell,
        renderReviewTargetPercentCell,
        renderTargetMovePctCell,
        renderReviewCutCell,
        renderReviewReconciliationCell,
        renderReviewProgressCell,
    });
    const positionColumnKeys = positionGridColumns.map((column) => column.key);
    const movePositionColumn = (
        sourceKey: PositionGridColumnKey,
        targetKey: PositionGridColumnKey,
    ) => {
        if (
            sourceKey === targetKey ||
            sourceKey === 'name' ||
            targetKey === 'name'
        ) {
            return;
        }
        setPositionColumnOrder((prev) => {
            const nextOrder = [...positionColumnKeys];
            const sourceIndex = nextOrder.indexOf(sourceKey);
            const targetIndex = nextOrder.indexOf(targetKey);
            if (sourceIndex < 0 || targetIndex < 0) return prev;
            const [moved] = nextOrder.splice(sourceIndex, 1);
            nextOrder.splice(targetIndex, 0, moved);
            return nextOrder;
        });
    };
	    const reviewColumnToggleKeys: Array<keyof PositionVisibleColumns> = [
	        'classPercent',
	        'mktValue',
	        'targetAdjustment',
	        'targetAdjustmentPercent',
	        'reduce',
	        'exposurePercent',
	        'portfolioPercent',
	    ];
	    const canShowPositionColumnToggle = (
	        key: keyof PositionVisibleColumns,
	    ) =>
	        !isPortfolioReviewMode || reviewColumnToggleKeys.includes(key);
	    const columnToggleItem = (
	        key: keyof PositionVisibleColumns,
	        label: string,
	    ): PositionColumnMenuItem | null =>
	        canShowPositionColumnToggle(key)
	            ? { key, label, visibleKey: key }
	            : null;
	    const fixedColumnItem = (
	        key: PositionGridColumnKey,
	        label: string,
	    ): PositionColumnMenuItem => ({ key, label, fixed: true });
    const actionColumnMenuItems: Array<PositionColumnMenuItem | null> = reviewImportVarianceActive
        ? [fixedColumnItem('expected', 'Expected'), fixedColumnItem('imported', 'Statement'), fixedColumnItem('variance', 'Difference')]
        : actionStatementMode
            ? [fixedColumnItem('mktValue', 'Statement value')]
            : [
                columnToggleItem('mktValue', 'Held'),
                columnToggleItem('classPercent', 'Class %'),
                columnToggleItem('portfolioPercent', 'Portfolio %'),
                ...(positionHasReductionWorkflow ? [
                    columnToggleItem('targetAdjustment', 'Required / guide'),
                    columnToggleItem('targetAdjustmentPercent', 'Guide / recorded %'),
                    fixedColumnItem('reduction', 'Record reduction'),
                    fixedColumnItem('remaining', 'Remaining'),
                ] : []),
            ];
	    const positionColumnMenuItems = (isPositionAdjustmentMode ? actionColumnMenuItems : [
	        columnToggleItem('classPercent', 'CLASS %'),
            columnToggleItem('modelWeight', 'Ideal wt'),
	        ...(!isPortfolioReviewMode
	            ? [
	                  columnToggleItem('asset', 'ASSET'),
	                  columnToggleItem('trend', 'TREND'),
	                  columnToggleItem('action', 'ACTION'),
	                  columnToggleItem('dca', 'DCA'),
		              ]
		            : []),
		        columnToggleItem('price', 'PRICE'),
		        columnToggleItem('bookValue', 'BOOK VALUE'),
	        columnToggleItem('mktValue', 'VALUE'),
	        ...(positionHasReductionWorkflow
	            ? [
	                  columnToggleItem('targetAdjustment', 'TARGET'),
	                  columnToggleItem('targetAdjustmentPercent', 'TARGET %'),
	                  fixedColumnItem('reduction', '$ ADJUSTMENT'),
	              ]
	            : []),
	        ...(reviewImportVarianceActive
	            ? [
	                  fixedColumnItem('expected', 'EXPECTED'),
	                  fixedColumnItem('imported', 'IMPORTED'),
	                  fixedColumnItem('variance', 'VARIANCE'),
	              ]
	            : []),
	        columnToggleItem('reduce', 'CASH'),
	        ...(isPortfolioReviewMode
	            ? [columnToggleItem('exposurePercent', 'EXPOSURE %')]
	            : []),
	        columnToggleItem('qty', 'QTY'),
	        columnToggleItem('plDollar', 'P/L$'),
	        columnToggleItem('plPercent', 'P/L%'),
	        columnToggleItem('portfolioPercent', 'PORTFOLIO %'),
	        ...(positionHasReductionWorkflow
	            ? [fixedColumnItem('currentReduction', 'ADJUSTMENT %')]
	            : []),
	    ]).filter((item): item is PositionColumnMenuItem => Boolean(item));
    const renderPositionHeaderCell = (column: PositionGridColumn, controls: PositionGridHeaderControls) => (
        <PositionHeaderCell
            key={column.key}
            column={column}
            resizeHandle={controls.resizeHandle}
            resetColumnWidths={controls.resetColumnWidths}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            draggedPositionColumnKey={draggedPositionColumnKey}
            setDraggedPositionColumnKey={setDraggedPositionColumnKey}
            movePositionColumn={movePositionColumn}
            columnMenuRef={columnMenuRef}
            columnMenuPanelRef={columnMenuPanelRef}
            showColumnMenu={showColumnMenu}
            setShowColumnMenu={setShowColumnMenu}
            columnMenuPosition={columnMenuPosition}
            setColumnMenuPosition={setColumnMenuPosition}
            positionColumnMenuItems={positionColumnMenuItems}
            positionColumnVisible={positionColumnVisible}
            toggleColumn={isPositionAdjustmentMode ? key => setActionVisibleColumns(prev => ({ ...prev, [key]: !prev[key] })) : toggleColumn}
            handleSort={handleSort}
            isPortfolioReviewMode={isPortfolioReviewMode}
            adjustmentEditable={positionAdjustmentEditable}
        />
    );

    const renderGroupNameSuggestionDropdown = (
        targetKey: string,
        value: string,
        onSelect: (name: string) => void,
    ) => {
        if (groupNameSuggestionTarget !== targetKey) return null;
        const suggestions = getGroupNameSuggestions(value);
        if (suggestions.length === 0) return null;
        return (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded border border-border/80 bg-background shadow-xl">
                {suggestions.map((option) => (
                    <button
                        key={option.code}
                        type="button"
                        onMouseDown={(event) => {
                            event.preventDefault();
                            onSelect(option.name);
                            setGroupNameSuggestionTarget(null);
                        }}
                        className="flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                    >
                        <span>{option.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                            {option.code}
                        </span>
                    </button>
                ))}
            </div>
        );
    };

    // ── Context value — assembled once, wraps entire return tree ─────────────
    const stockTableContextValue = {
        // Hook domains
        overlay: overlayResult,
        rebalance: rebalanceResult,
        memo: memoResult,
        review: reviewResult,
        stockGroups: stockGroupsResult,
        sizing: sizingResult,
        council: councilResult,
        history: historyResult,
        // Convenience wrapper for JSX handlers
        runPortfolioMemo,
        // Store values
        stocks,
        portfolio,
        lastSyncTime,
        // Key component state
        monitoringBenchmarks,
        activeTab,
        setActiveTab,
        positionsMode,
        setPositionsMode,
        portfolioMode,
        setPortfolioMode,
        activeAdjustmentSource,
        setActiveAdjustmentSource,
        assetClasses,
        setAssetClasses,
        assetClassConfig,
        portfolioFocusMode,
        setPortfolioFocusMode,
        hoveredPortfolioAssetClassCodes,
        setHoveredPortfolioAssetClassCodes,
        selectedPortfolioAssetClassCode,
        setSelectedPortfolioAssetClassCode,
        handleMainTabClick,
        navigateToTab,
        analysisGroupMode,
        setAnalysisGroupMode,
        watchlistHighlightEnabled,
        setWatchlistHighlightEnabled,
        analysisEtfsHidden,
        setAnalysisEtfsHidden,
        showNonAllocatingInstruments,
        setShowNonAllocatingInstruments,
        nonAllocatingUpdating,
        nonAllocatingErrors,
        toggleNonAllocatingInstrument,
        analysisScoreAlignment,
        setAnalysisScoreAlignment,
        analysisTickerPinned,
        setAnalysisTickerPinned,
        analysisSearch,
        setAnalysisSearch,
        analysisMissingExchangeOnly,
        analysisMissingResearchOnly,
        focusedAnalysisAssetClass,
        setFocusedAnalysisAssetClass,
        // Shared panel callbacks
        ensurePortfolioTargetGroups,
        removePendingPortfolioTargetGroups,
        getPortfolioRecordedActionForAssetClass,
        // Derived
        sortedStocks,
        positionStocks,
        nonAllocatingStocks,
        // Sort state (shared: positions header + analysis header)
        sortColumn,
        sortDirection,
        handleSort,
        // Security positions (used in analysis panel)
        securityPositions,
    } satisfies import('@/components/stock-table/stock-table-context').StockTableContextValue;

    const cashMovementSourceOptions: Array<{
        value: CashMovementSourceType;
        label: string;
    }> = [
        { value: 'PORTFOLIO_CASH_TRANSFER', label: 'Portfolio cash transfer' },
        { value: 'STOCK_SALE', label: 'Stock sale' },
        { value: 'EXTERNAL_CAPITAL', label: 'New capital' },
    ];
    const editingCashSetting = editingCashAssetClass
        ? getAssetClassSetting(editingCashAssetClass)
        : null;
    const editingCashLabel =
        editingCashSetting?.display_name ||
        formatAssetClassLabel(editingCashAssetClass);
    const editingCashCurrent = editingCashSetting?.cash_reserve || 0;
    const editingCashTargetRaw = Number.parseFloat(cashInput);
    const editingCashTarget = Number.isFinite(editingCashTargetRaw)
        ? Math.round(editingCashTargetRaw)
        : 0;
    const editingCashDelta = editingCashTarget - editingCashCurrent;
    const showStockTableHeader =
        !primaryNavigationInShell ||
        activeTab === 'POSITIONS' ||
        activeTab === 'HISTORY' ||
        isPortfolioRebalanceMode;

    return (
        <StockTableContext.Provider value={stockTableContextValue}>
        <div className="panel-positions w-full h-full flex flex-col overflow-hidden rounded-2xl">
            {showStockTableHeader && (
            <div className={`terminal-tabbar flex flex-shrink-0 flex-wrap items-stretch gap-x-3 gap-y-0 border-b border-border/80 bg-background/95 px-[12px] ${
                primaryNavigationInShell
                    ? 'terminal-contextbar h-[42px]'
                    : 'h-[60px]'
            }`}>
                {!primaryNavigationInShell && (
                <div className="terminal-primary-tabs relative z-[90] flex flex-shrink-0 flex-wrap items-stretch gap-x-3 gap-y-0 min-w-0">
                    <button
                        onClick={() => handleMainTabClick('POSITIONS')}
                        data-testid="main-tab-positions"
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'POSITIONS'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        POSITIONS
                    </button>
                    <button
                        onClick={() => handleMainTabClick('ANALYSIS')}
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'ANALYSIS'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        ANALYSIS
                    </button>
                    <button
                        onClick={() => handleMainTabClick('PORTFOLIO')}
                        data-testid="main-tab-portfolio"
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'PORTFOLIO'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        PORTFOLIO
                        {portfolioActiveDrift > 1 && activeTab !== 'PORTFOLIO' && (
                            <span
                                className="ml-1.5 inline-block h-[6px] w-[6px] rounded-full"
                                style={{ background: 'oklch(0.82 0.14 60)', boxShadow: '0 0 4px oklch(0.82 0.14 60)' }}
                            />
                        )}
                    </button>
                    <button
                        onClick={() => handleMainTabClick('SYSTEM')}
                        data-testid="main-tab-system"
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'SYSTEM'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        SYSTEM
                    </button>
                    <button
                        onClick={() => handleMainTabClick('MARKETS')}
                        data-testid="main-tab-markets"
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'MARKETS'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        MARKETS
                    </button>
                    <button
                        onClick={() => handleMainTabClick('ALERTS')}
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'ALERTS'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        ALERTS
                    </button>
                    <button
                        onClick={() => handleMainTabClick('NEWS')}
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'NEWS'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        NEWS
                    </button>
                    <button
                        onClick={() => handleMainTabClick('HISTORY')}
                        className={`terminal-primary-tab relative flex h-[60px] cursor-pointer items-center px-[8px] py-[14px] text-[12px] font-bold uppercase leading-none tracking-[0.075em] transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:content-[''] ${
                            activeTab === 'HISTORY'
                                ? 'text-foreground after:bg-foreground'
                                : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border'
                        }`}
                    >
                        HISTORY
                    </button>
                </div>
                )}

                <div
                    className={`terminal-tab-actions ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 self-stretch ${
                        activeTab === 'POSITIONS' || activeTab === 'PORTFOLIO'
                            ? 'relative z-[80] flex-wrap'
                            : ''
                    }`}
                >
                {activeTab === 'HISTORY' && (
                    <div className={`${historyStyles.modeTabs} terminal-workspace-controls`} role="group" aria-label="History view">
                        <button
                            onClick={() => setHistoryMode('signals')}
                            aria-pressed={historyMode === 'signals'}
                        >
                            Activity
                        </button>
	                        <button
	                            onClick={() => setHistoryMode('performance')}
	                            aria-pressed={historyMode === 'performance'}
	                        >
	                            Portfolio
	                        </button>
	                        <button
	                            onClick={() => setHistoryMode('stock')}
	                            aria-pressed={historyMode === 'stock'}
	                        >
	                            Stocks
	                        </button>
                    </div>
                )}
                {(activeTab === 'POSITIONS' || isPortfolioRebalanceMode) && (
                    <PositionsToolbar
                        activeTab={activeTab}
                        isPortfolioRebalanceMode={isPortfolioRebalanceMode}
                        positionsMode={positionsMode}
                        positionsPresentation={positionsPresentation}
                        onSetPositionsPresentation={changePositionsPresentation}
                        hasAdjustmentCallToAction={hasAdjustmentCallToAction}
                        adjustmentCallToActionCount={
                            adjustmentCallToActionCount
                        }
                        groupingEnabled={groupingEnabled}
                        showGroupManager={showGroupManager}
                        showPositionVisibilityControls={
                            showPositionVisibilityControls
                        }
                        positionStatsPeekEnabled={positionStatsPeekEnabled}
                        positionStatsPeekMode={positionStatsPeekMode}
                        fixedQ1StatsVisible={fixedQ1StatsVisible}
                        fixedGroupStatsVisible={fixedGroupStatsVisible}
                        fixedStockStatsVisible={fixedStockStatsVisible}
                        positionAssetClassOrder={positionAssetClassOrder}
                        positionAssetClassOrderDirection={
                            positionAssetClassOrderDirection
                        }
                        portfolioFocusMode={portfolioFocusMode}
                        showPortfolioBucketRows={showPortfolioBucketRows}
                        showPositionBucketRows={showPositionBucketRows}
                        positionTableGroupingEnabled={
                            positionTableGroupingEnabled
                        }
                        portfolioPureSort={portfolioPureSort}
                        positionGroupsAllCollapsed={positionGroupsAllCollapsed}
                        showNonAllocatingInstruments={
                            showNonAllocatingInstruments
                        }
                        onSetPositionsMode={setPositionsMode}
                        onToggleGrouping={() => {
                            const newValue = !groupingEnabled;
                            setGroupingEnabled(newValue);
                            if (!newValue) setShowGroupManager(false);
                        }}
                        onToggleGroupManager={() =>
                            setShowGroupManager(!showGroupManager)
                        }
                        onTogglePeekMode={() => {
                            setPositionStatsPeekLayer(null);
                            setPositionStatsTransitionSuppressed(true);
                            setPositionStatsPeekEnabled(
                                (enabled) => !enabled,
                            );
                        }}
                        onToggleQ1Stats={() => {
                            if (isPortfolioRebalanceMode) {
                                setPortfolioShowQ1Stats((v) => !v);
                            } else {
                                setShowQ1Stats((v) => !v);
                            }
                        }}
                        onToggleGroupStats={() => {
                            if (isPortfolioRebalanceMode) {
                                setPortfolioShowGroupStats((v) => !v);
                            } else {
                                setShowGroupStats((v) => !v);
                            }
                        }}
                        onToggleStockStats={() => {
                            if (isPortfolioRebalanceMode) {
                                setPortfolioShowStockStats((v) => !v);
                            } else {
                                setShowStockStats((v) => !v);
                            }
                        }}
                        onSetPositionAssetClassOrder={
                            handlePositionAssetClassOrder
                        }
                        onTogglePortfolioFocusMode={() =>
                            setPortfolioFocusMode((mode) =>
                                mode === 'hover' ? 'select' : 'hover',
                            )
                        }
                        onTogglePortfolioBucketRows={() =>
                            setShowPortfolioBucketRows((v) => !v)
                        }
                        onTogglePositionBucketRows={() =>
                            setShowPositionBucketRows((v) => !v)
                        }
                        onTogglePortfolioPureSort={() =>
                            setPortfolioPureSort((v) => !v)
                        }
                        onToggleAllPositionGroupsCollapsed={
                            () => toggleAllPositionGroupsCollapsed(visiblePositionGroupIds)
                        }
                        onToggleNonAllocatingInstruments={() =>
                            setShowNonAllocatingInstruments((visible) => !visible)
                        }
                    />
                )}
                </div>
            </div>
            )}

            {activeTab === 'ANALYSIS' && (
                <AnalysisToolbar
                    groupMode={analysisGroupMode}
                    watchlistHighlightEnabled={watchlistHighlightEnabled}
                    etfsHidden={analysisEtfsHidden}
                    showNonAllocatingInstruments={showNonAllocatingInstruments}
                    scoreAlignment={analysisScoreAlignment}
                    search={analysisSearch}
                    focusedAssetClassLabel={focusedAnalysisAssetClass?.label}
                    listingReviewCount={listingReviews.length}
                    missingExchangeCount={missingAnalysisExchangeCount}
                    missingExchangeTargets={missingAnalysisExchangeStocks.map(stock => stock.isWatchlist || stock.isExternal
                        ? { kind: 'analysis' as const, id: stock.analysisId! }
                        : { kind: 'holding' as const, id: stock.id }).filter(target => target.id > 0)}
                    missingExchangeOnly={analysisMissingExchangeOnly}
                    missingResearchCount={missingResearchStocks.length}
                    missingResearchOnly={analysisMissingResearchOnly}
                    onToggleMissingResearch={() => {
                        setAnalysisMissingResearchOnly(value => !value);
                        setAnalysisMissingExchangeOnly(false);
                        setAnalysisSearch('');
                        setFocusedAnalysisAssetClass(null);
                    }}
                    onToggleMissingExchange={() => {
                        setAnalysisMissingExchangeOnly(value => !value);
                        setAnalysisMissingResearchOnly(false);
                    }}
                    refreshingPrices={refreshingPrices}
                    onSetGroupMode={(mode) => {
                        setAnalysisGroupMode(mode);
                        if (mode === 'none') {
                            setFocusedAnalysisAssetClass(null);
                        }
                    }}
                    onToggleWatchlistHighlight={() =>
                        setWatchlistHighlightEnabled((enabled) => !enabled)
                    }
                    onToggleEtfs={() =>
                        setAnalysisEtfsHidden((hidden) => !hidden)
                    }
                    onToggleNonAllocatingInstruments={() =>
                        setShowNonAllocatingInstruments((visible) => !visible)
                    }
                    onSetScoreAlignment={setAnalysisScoreAlignment}
                    onSearchChange={setAnalysisSearch}
                    onClearAssetClassFocus={() =>
                        setFocusedAnalysisAssetClass(null)
                    }
                    onOpenListingReviews={() => setShowListingReviews(true)}
                    onOpenTemplateLibrary={() => setShowTemplateLibrary(true)}
                    onRefreshPrices={handleRefreshPrices}
                    onAddToWatchlist={() => setShowAddStockModal(true)}
                />
            )}

            {/* Group Manager Panel */}
            {showGroupManager &&
                activeTab === 'POSITIONS' &&
                !isSimplePositionsView &&
                positionsMode === 'normal' && (
                    <div className="border border-border bg-card p-3 mb-3 flex-shrink-0">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-sm font-bold text-foreground">
                                GROUP MANAGER
                            </div>
                            <label
                                className="flex cursor-pointer items-center gap-2 text-[11px] font-mono uppercase tracking-[0.06em] text-muted-foreground"
                                title="Show saved group rows in the positions spreadsheet"
                            >
                                <span>Grouped view</span>
                                <input
                                    type="checkbox"
                                    checked={groupingEnabled}
                                    onChange={() => setGroupingEnabled((v) => !v)}
                                    className="h-4 w-4 cursor-pointer accent-primary"
                                />
                            </label>
                        </div>
                        {groupManagerError && (
                            <div className="mb-2 rounded border border-destructive/35 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                                {groupManagerError}
                            </div>
                        )}

                        {/* Create New Group */}
                        <div className="mb-3 space-y-2">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        value={newGroupName}
                                        onChange={(e) => {
                                            setNewGroupName(e.target.value);
                                            setGroupManagerError(null);
                                        }}
                                        onFocus={() =>
                                            setGroupNameSuggestionTarget('new')
                                        }
                                        onBlur={() =>
                                            window.setTimeout(
                                                () =>
                                                    setGroupNameSuggestionTarget(
                                                        null,
                                                    ),
                                                120,
                                            )
                                        }
                                        onKeyDown={(e) =>
                                            e.key === 'Enter' && createGroup()
                                        }
                                        placeholder="Select asset class group..."
                                        className="w-full px-2 py-1 text-xs bg-background border border-border rounded text-foreground"
                                    />
                                    {renderGroupNameSuggestionDropdown(
                                        'new',
                                        newGroupName,
                                        setNewGroupName,
                                    )}
                                </div>
                                <button
                                    onClick={createGroup}
                                    disabled={!resolveGroupAssetClassCodeFromName(newGroupName)}
                                    className="px-3 py-1 text-xs bg-primary text-black rounded hover:bg-primary/80 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                                >
                                    CREATE
                                </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-muted-foreground">
                                    Custom fund class
                                </span>
                                <select
                                    value={newCustomGroupQuartile}
                                    onChange={(event) =>
                                        setNewCustomGroupQuartile(event.target.value)
                                    }
                                    className="border border-border bg-background px-2 py-1 text-xs text-foreground"
                                >
                                    <option value="Q1">Q1</option>
                                    <option value="Q1_DEFENSIVE">
                                        Q1-Defensive
                                    </option>
                                    <option value="Q1_EXEMPT">Q1-Exempt</option>
                                    <option value="NON_MARKET">Non-market</option>
                                </select>
                                <button
                                    type="button"
                                    onClick={() => void createCustomGroup()}
                                    disabled={
                                        !newGroupName.trim() ||
                                        Boolean(
                                            resolveGroupAssetClassCodeFromName(
                                                newGroupName,
                                            ),
                                        ) ||
                                        creatingCustomGroup
                                    }
                                    className="rounded border border-border px-2 py-1 text-xs font-bold uppercase text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                    Create Custom Class
                                </button>
                            </div>
                            {customGroupAssetClasses.length > 0 && (
                                <div className="space-y-1 border-t border-border/60 pt-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                                        Custom asset classes
                                    </div>
                                    {customGroupAssetClasses.map((assetClass) => {
                                        const deleting =
                                            deletingCustomClassCode ===
                                            assetClass.code;
                                        return (
                                            <div
                                                key={assetClass.code}
                                                className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/45 px-2 py-1"
                                            >
                                                <div className="min-w-0">
                                                    <div className="truncate text-xs font-medium text-foreground">
                                                        {formatAssetClassName(
                                                            assetClass,
                                                        )}
                                                    </div>
                                                    <div className="truncate text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                                                        {assetClass.risk_bucket ||
                                                            assetClass.quartile ||
                                                            'Custom'}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void deleteCustomAssetClass(
                                                            assetClass.code,
                                                        )
                                                    }
                                                    disabled={deleting}
                                                    className="shrink-0 rounded border border-border/70 px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground hover:border-destructive/60 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-45"
                                                >
                                                    {deleting ? 'Removing' : 'Remove'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Existing Groups */}
                        {groups.length > 0 && (
                            <div className="space-y-1">
                                <div
                                    className="text-xs text-muted-foreground mb-1 p-2 rounded transition-colors"
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (draggedGroupId) {
                                            const draggedGroup = groups.find(
                                                (g) => g.id === draggedGroupId,
                                            );
                                            // Only show drop zone if it's a subgroup
                                            if (draggedGroup?.parent_id) {
                                                e.currentTarget.style.backgroundColor =
                                                    'rgba(39, 203, 45, 0.2)';
                                                e.currentTarget.style.borderColor =
                                                    'var(--success)';
                                                e.currentTarget.style.border =
                                                    '2px dashed var(--success)';
                                            }
                                        }
                                    }}
                                    onDragLeave={(e) => {
                                        e.currentTarget.style.backgroundColor =
                                            '';
                                        e.currentTarget.style.border = '';
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.currentTarget.style.backgroundColor =
                                            '';
                                        e.currentTarget.style.border = '';

                                        const droppedGroupId =
                                            e.dataTransfer.getData('groupId');
                                        if (droppedGroupId) {
                                            convertToTopLevel(droppedGroupId);
                                        }
                                        setDraggedGroupId(null);
                                    }}
                                >
                                    Existing Groups:
                                </div>

                                {(() => {
                                    // Build hierarchical list of groups (same as positions UI)
                                    const buildHierarchicalGroupList = () => {
                                        const topLevelGroups = groups
                                            .filter((g) => !g.parent_id)
                                            .sort((a, b) => a.order - b.order);
                                        const result: Array<{
                                            group: StockGroup;
                                            indentLevel: number;
                                        }> = [];

                                        const addGroupWithChildren = (
                                            group: StockGroup,
                                            indentLevel: number,
                                        ) => {
                                            result.push({ group, indentLevel });
                                            const children = groups
                                                .filter(
                                                    (g) =>
                                                        g.parent_id ===
                                                        group.id,
                                                )
                                                .sort(
                                                    (a, b) => a.order - b.order,
                                                );
                                            children.forEach((child) =>
                                                addGroupWithChildren(
                                                    child,
                                                    indentLevel + 1,
                                                ),
                                            );
                                        };

                                        topLevelGroups.forEach((topGroup) =>
                                            addGroupWithChildren(topGroup, 0),
                                        );
                                        return result;
                                    };

                                    const hierarchicalGroups =
                                        buildHierarchicalGroupList();

                                    return hierarchicalGroups.map(
                                        ({ group, indentLevel }) => {
                                            return (
                                                <div
                                                    key={group.id}
                                                    className="flex items-center gap-2 bg-muted/20 p-2 rounded transition-colors border border-transparent cursor-move"
                                                    style={{
                                                        marginLeft: `${
                                                            indentLevel * 16
                                                        }px`,
                                                    }}
                                                    draggable
                                                    onDragStart={(e) => {
                                                        e.stopPropagation();
                                                        e.dataTransfer.effectAllowed =
                                                            'move';
                                                        e.dataTransfer.setData(
                                                            'groupId',
                                                            group.id,
                                                        );
                                                        setDraggedGroupId(
                                                            group.id,
                                                        );
                                                    }}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();

                                                        if (
                                                            draggedGroupId &&
                                                            draggedGroupId !==
                                                                group.id
                                                        ) {
                                                            // Divide into three zones: top 30%, middle 40%, bottom 30%
                                                            const rect =
                                                                e.currentTarget.getBoundingClientRect();
                                                            const mouseY =
                                                                e.clientY;
                                                            const relativeY =
                                                                mouseY -
                                                                rect.top;
                                                            const height =
                                                                rect.height;
                                                            const topZone =
                                                                height * 0.3;
                                                            const bottomZone =
                                                                height * 0.7;

                                                            // Remove all previous indicators
                                                            e.currentTarget.style.borderTop =
                                                                '';
                                                            e.currentTarget.style.borderBottom =
                                                                '';
                                                            e.currentTarget.style.backgroundColor =
                                                                '';

                                                            if (
                                                                relativeY <
                                                                topZone
                                                            ) {
                                                                // Top 30% - show line above (reorder above)
                                                                e.currentTarget.style.borderTop =
                                                                    '3px solid var(--success)';
                                                            } else if (
                                                                relativeY >
                                                                bottomZone
                                                            ) {
                                                                // Bottom 30% - show line below (reorder below)
                                                                e.currentTarget.style.borderBottom =
                                                                    '3px solid var(--success)';
                                                            } else {
                                                                // Middle 40% - show background highlight (nest as subgroup)
                                                                e.currentTarget.style.backgroundColor =
                                                                    'rgba(39, 203, 45, 0.2)';
                                                            }
                                                        }
                                                    }}
                                                    onDragLeave={(e) => {
                                                        e.currentTarget.style.borderTop =
                                                            '';
                                                        e.currentTarget.style.borderBottom =
                                                            '';
                                                        e.currentTarget.style.backgroundColor =
                                                            '';
                                                    }}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        e.currentTarget.style.borderTop =
                                                            '';
                                                        e.currentTarget.style.borderBottom =
                                                            '';
                                                        e.currentTarget.style.backgroundColor =
                                                            '';

                                                        const stockId =
                                                            e.dataTransfer.getData(
                                                                'stockId',
                                                            );
                                                        const droppedGroupId =
                                                            e.dataTransfer.getData(
                                                                'groupId',
                                                            );

                                                        if (stockId) {
                                                            // Dropping a stock into this group
                                                            assignStockToGroup(
                                                                parseInt(
                                                                    stockId,
                                                                ),
                                                                group.id,
                                                            );
                                                        } else if (
                                                            droppedGroupId &&
                                                            droppedGroupId !==
                                                                group.id
                                                        ) {
                                                            // Determine action based on drop zone (top/middle/bottom)
                                                            const rect =
                                                                e.currentTarget.getBoundingClientRect();
                                                            const mouseY =
                                                                e.clientY;
                                                            const relativeY =
                                                                mouseY -
                                                                rect.top;
                                                            const height =
                                                                rect.height;
                                                            const topZone =
                                                                height * 0.3;
                                                            const bottomZone =
                                                                height * 0.7;

                                                            if (
                                                                relativeY <
                                                                topZone
                                                            ) {
                                                                // Top 30% - reorder above
                                                                reorderGroup(
                                                                    droppedGroupId,
                                                                    group.id,
                                                                    true,
                                                                );
                                                            } else if (
                                                                relativeY >
                                                                bottomZone
                                                            ) {
                                                                // Bottom 30% - reorder below
                                                                reorderGroup(
                                                                    droppedGroupId,
                                                                    group.id,
                                                                    false,
                                                                );
                                                            } else {
                                                                // Middle 40% - nest as subgroup
                                                                nestGroupAsSubgroup(
                                                                    droppedGroupId,
                                                                    group.id,
                                                                );
                                                            }
                                                        }

                                                        setDraggedGroupId(null);
                                                    }}
                                                    onDragEnd={() => {
                                                        setDraggedGroupId(null);
                                                    }}
                                                >
                                                    {editingGroupId ===
                                                    group.id ? (
                                                        <>
                                                            <div className="relative flex-1">
                                                                <input
                                                                    type="text"
                                                                    value={
                                                                        editingGroupName
                                                                    }
                                                                    onChange={(
                                                                        e,
                                                                    ) =>
                                                                        setEditingGroupName(
                                                                            e
                                                                                .target
                                                                                .value,
                                                                        )
                                                                    }
                                                                    onFocus={() =>
                                                                        setGroupNameSuggestionTarget(
                                                                            group.id,
                                                                        )
                                                                    }
                                                                    onBlur={() =>
                                                                        window.setTimeout(
                                                                            () =>
                                                                                setGroupNameSuggestionTarget(
                                                                                    null,
                                                                                ),
                                                                            120,
                                                                        )
                                                                    }
                                                                    onKeyDown={(
                                                                        e,
                                                                    ) => {
                                                                        if (
                                                                            e.key ===
                                                                            'Enter'
                                                                        )
                                                                            renameGroup(
                                                                                group.id,
                                                                                editingGroupName,
                                                                            );
                                                                        if (
                                                                            e.key ===
                                                                            'Escape'
                                                                        ) {
                                                                            setEditingGroupId(
                                                                                null,
                                                                            );
                                                                            setEditingGroupName(
                                                                                '',
                                                                            );
                                                                            setGroupNameSuggestionTarget(
                                                                                null,
                                                                            );
                                                                        }
                                                                    }}
                                                                    className="w-full px-2 py-1 text-xs bg-background border border-border rounded text-foreground"
                                                                    autoFocus
                                                                />
                                                                {renderGroupNameSuggestionDropdown(
                                                                    group.id,
                                                                    editingGroupName,
                                                                    setEditingGroupName,
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={() =>
                                                                    renameGroup(
                                                                        group.id,
                                                                        editingGroupName,
                                                                    )
                                                                }
                                                                className="text-primary hover:text-primary/80 text-xs"
                                                            >
                                                                ✓
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingGroupId(
                                                                        null,
                                                                    );
                                                                    setEditingGroupName(
                                                                        '',
                                                                    );
                                                                    setGroupNameSuggestionTarget(
                                                                        null,
                                                                    );
                                                                }}
                                                                className="text-destructive hover:text-destructive text-xs"
                                                            >
                                                                ✕
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="text-foreground text-xs whitespace-nowrap">
                                                                {indentLevel > 0
                                                                    ? '└ '
                                                                    : ''}
                                                                {group.name}{' '}
                                                                (
                                                                {calculateGroupStockCount(
                                                                    group.id,
                                                                )}
                                                                )
                                                            </span>
                                                            <div className="flex-1 mx-2 border-b border-dotted border-muted-foreground/30 min-w-[20px]" />
                                                            <button
                                                                onClick={() => {
                                                                    setEditingGroupId(
                                                                        group.id,
                                                                    );
                                                                    setEditingGroupName(
                                                                        group.name,
                                                                    );
                                                                    setGroupNameSuggestionTarget(
                                                                        group.id,
                                                                    );
                                                                }}
                                                                className="text-xs text-muted-foreground hover:text-foreground"
                                                                title="Rename"
                                                            >
                                                                ✏️
                                                            </button>
                                                            <button
                                                                onClick={() =>
                                                                    deleteGroup(
                                                                        group.id,
                                                                    )
                                                                }
                                                                className="text-xs text-destructive hover:text-destructive"
                                                                title="Delete"
                                                            >
                                                                🗑️
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        },
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                )}

            <div
                ref={positionsScrollViewportRef}
                data-terminal-page={activeTab}
                className={
                    activeTab === 'ALERTS'
                        ? 'min-h-0 flex-1 overflow-hidden'
                        : isPositionAdjustmentMode
                          ? `${actionStyles.scope} overflow-auto flex-1 min-h-0`
                          : 'overflow-auto flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                }
            >
                {isSimplePositionsView && <PositionsCapitalMap
                    holdings={positionStocks.map(stock => {
                        const code = getStockAssetClassCode(stock);
                        return {
                            id: stock.id, name: stock.name || stock.symbol || 'Unnamed holding',
                            ticker: stock.symbol ? `${stock.prefix || ''}${stock.symbol}` : '',
                            classCode: code,
                            className: assetClassMap.get(code)?.display_name || assetClassConfigMap.get(code)?.display_name || (code === 'UNASSIGNED' ? 'Unassigned' : (stock.primaryAssetClass || code).replaceAll('_', ' ')),
                            value: stock.positionValue, isETF: stock.securityType === 'ETF',
                            profitLossPercent: Number.isFinite(stock.changePercent) ? stock.changePercent : null,
                            trend: securityPositions[stock.id] ?? null,
                        };
                    })}
                    portfolioValue={portfolio.totalValue}
                    loading={positionsLoading} error={positionsDataError}
                    onSelect={setSelectedPositionStockId}
                />}
                {isPositionsTableTab && !isSimplePositionsView && (
                    <div
                        className={
                            isPositionAdjustmentMode ? actionStyles.layout : positionsTableHasSidePanel
                                ? `grid h-full min-h-0 ${
                                      isPortfolioRebalanceMode
                                          ? 'grid-cols-[minmax(0,1fr)_21rem]'
                                          : 'grid-cols-[minmax(0,1fr)_19rem]'
                                  } gap-3`
                                : 'h-full'
                        }
                    >
                        <div
                            ref={reviewTablePanelRef}
                            className={
                                isPositionAdjustmentMode ? actionStyles.tablePanel : positionsTableHasSidePanel
                                    ? 'relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/55 bg-card/20'
                                    : showPositionShapeFooter
                                      ? 'relative flex h-full min-w-0 flex-col overflow-hidden'
                                      : 'relative'
                            }
                        >
                            {isPositionAdjustmentMode && (
                                <div className={actionStyles.tableCaption}>
                                    <strong>{reviewImportVarianceActive ? 'Statement reconciliation' : actionStatementMode ? 'Latest statement holdings' : 'Position reductions'}</strong>
                                    <span>{reviewImportVarianceActive ? 'Expected and imported values from broker evidence'
                                        : actionStatementMode ? 'Latest holdings are not confirmation of the recorded execution'
                                        : 'Required at class level; proportional guidance per stock'}</span>
                                </div>
                            )}
                            {isPortfolioRebalanceMode && (
                                <div className="sticky top-0 z-40 border-b border-border/35 bg-card/95 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground backdrop-blur">
                                    Current Positions
                                </div>
                            )}
                            <PositionGridStyles />
                        <PositionGrid
                            columns={positionGridColumns}
                            widthScope={positionColumnWidthScope}
                            containerClassName={
                                isPositionAdjustmentMode ? actionStyles.tableScroll : positionsTableHasSidePanel ||
                                showPositionShapeFooter
                                    ? 'min-h-0 flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                                    : ''
                            }
                            tableClassName={`positions-grid table-fixed text-xs border-collapse ${
                                isPositionAdjustmentMode
                                    ? 'positions-actions-grid'
                                    : ''
                            } ${
                                isPortfolioReviewMode || isPortfolioRebalanceMode
                                    ? `positions-review-grid ${
                                          isPortfolioRebalanceMode
                                              ? 'portfolio-workflow-grid'
                                              : ''
                                      } ${
                                          (isPortfolioReviewMode &&
                                              reviewReductionEditable) ||
                                          portfolioReductionEditable
                                              ? 'positions-review-reducing'
                                              : ''
                                      }`
                                    : ''
                            }`}
                            renderHeaderCell={renderPositionHeaderCell}
                        >
                                {positionTableGroupingEnabled ? (
                                    <>
                                        {isPortfolioRebalanceMode &&
                                        !showPortfolioBucketRows ? (
                                            portfolioPureSort ? (
                                                <>
                                                    {renderPortfolioPureSortedRows()}
                                                    {renderPendingReserveRow()}
                                                </>
                                            ) : (
                                                <>
                                                {renderPortfolioHiddenBucketSpacerRow(
                                                    'hidden-bucket-q1',
                                                )}
                                                {renderPortfolioHiddenBucketSpacerRow(
                                                    'hidden-bucket-full-q1',
                                                )}
                                                {sortPositionGroupsForActiveColumn(
                                                    topLevelGroupsByBucket.full_q1,
                                                ).flatMap((group) =>
                                                    renderGroupBranch(group, 0),
                                                )}
                                                {renderPortfolioHiddenBucketSpacerRow(
                                                    'hidden-bucket-partial-q1',
                                                )}
                                                {sortPositionGroupsForActiveColumn(
                                                    topLevelGroupsByBucket.partial_q1,
                                                ).flatMap((group) =>
                                                    renderGroupBranch(group, 0),
                                                )}
                                                {renderPortfolioHiddenBucketSpacerRow(
                                                    'hidden-bucket-q1-exempt',
                                                )}
                                                {sortPositionGroupsForActiveColumn(
                                                    topLevelGroupsByBucket.q1_exempt,
                                                ).flatMap((group) =>
                                                    renderGroupBranch(group, 0),
                                                )}
                                                {renderPortfolioUnassignedAssetClassRow()}
                                                {renderPortfolioCashAssetClassRow()}
                                                {renderPendingReserveRow()}
                                                </>
                                            )
                                        ) : !isPortfolioRebalanceMode &&
                                          !showPositionBucketRows ? (
                                            renderPositionRowsWithoutBucketRows()
                                        ) : (
                                            <>
                                                <PositionRiskGroup group="full_q1" enabled={!isPortfolioReviewMode && !isPortfolioRebalanceMode}>
                                                {renderBucketRow(
                                                    'full_q1',
                                                    'Q1',
                                                    0,
                                                    bucketStats.full_q1,
                                                    {
                                                        classPercent:
                                                            getBucketClassPercent(
                                                                'full_q1',
                                                            ),
                                                        showChildren: true,
                                                        tone: 'border-l-4 border-b border-border/60 border-l-sky-500/70 bg-sky-500/[0.08] text-foreground',
                                                    },
                                                )}
                                                {renderBucketBody(
                                                    'full_q1',
                                                    0,
                                                )}
                                                </PositionRiskGroup>
                                                <PositionRiskGroup group="partial_q1" enabled={!isPortfolioReviewMode && !isPortfolioRebalanceMode}>
                                                {renderBucketRow(
                                                    'partial_q1',
                                                    'Q1-Defensive',
                                                    0,
                                                    bucketStats.partial_q1,
                                                    {
                                                        classPercent:
                                                            getBucketClassPercent(
                                                                'partial_q1',
                                                            ),
                                                        showChildren: true,
                                                        tone: 'border-l-4 border-b border-border/60 border-l-teal-500/70 bg-teal-500/[0.085] text-foreground',
                                                    },
                                                )}
                                                {renderBucketBody(
                                                    'partial_q1',
                                                    0,
                                                )}
                                                </PositionRiskGroup>
                                                <PositionRiskGroup group="q1_exempt" enabled={!isPortfolioReviewMode && !isPortfolioRebalanceMode}>
                                                {renderBucketRow(
                                                    'q1_exempt',
                                                    'Q1-Exempt',
                                                    0,
                                                    bucketStats.q1_exempt,
                                                    {
                                                        classPercent: null,
                                                        showChildren: true,
                                                        tone: 'border-l-4 border-b border-border/60 border-l-emerald-500/70 bg-emerald-500/[0.065] text-foreground',
                                                    },
                                                )}
                                                {renderBucketBody('q1_exempt', 0)}
                                                </PositionRiskGroup>

                                                {isPortfolioRebalanceMode ? (
                                                    renderPortfolioCashAssetClassRow()
                                                ) : (
                                                    renderBucketRow(
                                                        'cash_reserve',
                                                        'Cash/Reserve',
                                                        0,
                                                        bucketStats.cash_reserve,
                                                        {
                                                            showChildren: false,
                                                            tone: 'border-l-4 border-b border-border border-l-zinc-400/70 bg-zinc-400/[0.08] text-foreground',
                                                        },
                                                    )
                                                )}
                                                {renderPendingReserveRow()}
                                            </>
                                        )}
		                                    </>
	                                ) : (
                                    /* Flat view - all stocks sortable */
                                    mounted &&
                                    positionStocks.map((s) =>
                                        renderStockRow(s),
                                    )
                                )}
                                {activeTab === 'POSITIONS' &&
                                    positionsMode === 'normal' &&
                                    showNonAllocatingInstruments &&
                                    nonAllocatingStocks.length > 0 && (
                                        <>
                                            <tr className="border-y border-border/70 bg-muted/[0.08]">
                                                <td
                                                    colSpan={positionGridColumns.length}
                                                    className="h-[26px] px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                                                >
                                                    Excluded instruments ·{' '}
                                                    {nonAllocatingStocks.length}
                                                </td>
                                            </tr>
                                            {nonAllocatingStocks.map((stock) =>
                                                renderStockRow(stock),
                                            )}
                                        </>
                                    )}
                        </PositionGrid>
                        {showPositionShapeFooter && (
                            <PositionShapeFooter
                                currentRows={portfolioMix?.rows || []}
                                approvedRows={approvedPortfolioMix?.rows || []}
                                totalValue={portfolioTotalValue}
                                comparisonActive={
                                    positionAssetClassRowMode === 'shape'
                                }
                                unit={positionShapeUnit}
                                onToggleComparison={() =>
                                    setPositionAssetClassRowMode((mode) =>
                                        mode === 'shape' ? 'metrics' : 'shape',
                                    )
                                }
                                onSetUnit={setPositionShapeUnit}
                            />
                        )}
                        {isPortfolioRebalanceMode &&
                            renderPortfolioAllocationVisualPanel()}
                    </div>
                    {activeTab === 'POSITIONS' &&
                        positionsMode === 'review' &&
                        <PortfolioReviewPanel />}
                    {activeTab === 'PORTFOLIO' &&
                        portfolioMode === 'workflow' &&
                        <PortfolioRebalancePanel />}
                    </div>
                )}

                {activeTab === 'PORTFOLIO' && portfolioMode === 'shape' && (
                    <PortfolioShapeView />
                )}

                {activeTab === 'SYSTEM' && <SystemArchitectureTab />}

                {activeTab === 'HELP' && <HelpTab />}

                {activeTab === 'MARKETS' && <CommodityMarketMap />}

                {activeTab === 'ANALYSIS' && <AnalysisPanel />}

	                {activeTab === 'HISTORY' && (
	                    <div
	                        className={`${historyStyles.page} terminal-workspace-controls`}
                                data-mode={historyMode}
	                    >
	                        {historyMode === 'performance' && (
	                            <HistoryPerformancePanel
                                    historyDemoAvailable={historyResult.historyDemoAvailable}
                                    historyDemo={historyResult.historyDemo}
                                    setHistoryDemo={historyResult.setHistoryDemo}
	                                historyPerformanceExpanded={
	                                    historyPerformanceExpanded
	                                }
	                                setHistoryPerformanceExpanded={
	                                    setHistoryPerformanceExpanded
	                                }
	                                historyPerformanceRange={
	                                    historyPerformanceRange
	                                }
	                                setHistoryPerformanceRange={
	                                    setHistoryPerformanceRange
	                                }
	                                portfolioPerformanceChartData={
	                                    portfolioPerformanceChartData
	                                }
	                                historyPerformanceEvents={
	                                    historyPerformanceEvents
	                                }
	                                portfolioShapeConfirmations={
	                                    portfolioShapeConfirmations
	                                }
	                                historyPortfolioSummary={
	                                    historyPortfolioSummary
	                                }
	                                historyAssetClassLatestRows={
	                                    historyAssetClassLatestRows
	                                }
	                                latestPortfolioPerformance={
	                                    latestPortfolioPerformance
	                                }
	                                historyPerformanceEventLegendItems={
	                                    historyPerformanceEventLegendItems
	                                }
	                                assetClassPerformanceShape={
	                                    assetClassPerformanceShape
	                                }
	                            />
	                        )}
	                        {historyMode === 'stock' && (
	                            <HistoryStockPanel
	                                historySelectedTicker={historySelectedTicker}
	                                historySelectedStockName={
	                                    historySelectedStockName
	                                }
	                                setHistorySelectedTicker={
	                                    setHistorySelectedTicker
	                                }
	                                setHistorySelectedStockName={
	                                    setHistorySelectedStockName
	                                }
	                                historyStockOptions={historyStockOptions}
	                                historyPerformanceRange={
	                                    historyPerformanceRange
	                                }
	                                setHistoryPerformanceRange={
	                                    setHistoryPerformanceRange
	                                }
	                                historySecurityLoading={
	                                    historySecurityLoading
	                                }
	                                historySecurityError={historySecurityError}
	                                selectedSecurityChartPointCount={
	                                    filteredSecurityPerformance.length
	                                }
	                                selectedSecurityLatest={
	                                    selectedSecurityLatest
	                                }
	                                selectedSecurityPriceChange={
	                                    selectedSecurityPriceChange
	                                }
	                                selectedSecurityPriceChangePct={
	                                    selectedSecurityPriceChangePct
	                                }
	                                historyStockShowValue={
	                                    historyStockShowValue
	                                }
	                                setHistoryStockShowValue={
	                                    setHistoryStockShowValue
	                                }
	                                selectedSecurityValueChange={
	                                    selectedSecurityValueChange
	                                }
	                                selectedSecurityValueChangePct={
	                                    selectedSecurityValueChangePct
	                                }
	                                filteredSecurityPerformance={
	                                    filteredSecurityPerformance
	                                }
	                                selectedSecurityEvents={
	                                    selectedSecurityEvents
	                                }
	                            />
	                        )}
	                        {historyMode === 'signals' && (
	                            <HistorySignalsPanel
                                    assetClasses={assetClasses}
	                                decisions={decisions}
	                                filteredDecisions={filteredDecisions}
	                                decisionHistoryTickerQuery={
	                                    decisionHistoryTickerQuery
	                                }
	                                setDecisionHistoryTickerQuery={
	                                    setDecisionHistoryTickerQuery
	                                }
	                                allSignals={allSignals}
	                                filteredSignals={filteredSignals}
	                                signalHistoryTickerQuery={
	                                    signalHistoryTickerQuery
	                                }
	                                setSignalHistoryTickerQuery={
	                                    setSignalHistoryTickerQuery
	                                }
	                            />
	                        )}
                    </div>
                )}

                {activeTab === 'ALERTS' && (
                    <div className="h-full min-h-0 overflow-hidden">
                        <AlertsTab />
                    </div>
                )}

	                {activeTab === 'ETF' && (
                    <div>
                        <ETFAllocationsTab />
                    </div>
                )}

                {activeTab === 'NEWS' && (
                    <div className="h-full min-h-0 overflow-hidden">
                        <NewsTab />
                    </div>
                )}

                {editingCashAssetClass && (
                    <div
                        className="fixed inset-0 z-[120] flex items-center justify-center bg-background/70 backdrop-blur-sm"
                        data-inline-edit-root="true"
                    >
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                handleCashSave(editingCashAssetClass);
                            }}
                            className="w-[25rem] max-w-[calc(100vw-2rem)] border border-border/80 bg-background p-4 shadow-2xl"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                                <div>
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                        Sleeve Cash
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                        {editingCashLabel}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCashCancel}
                                    className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 py-3 text-xs">
                                <div className="border border-border/60 p-2">
                                    <div className="uppercase tracking-[0.12em] text-muted-foreground">
                                        Current
                                    </div>
                                    <div className="mt-1 font-mono text-sm text-foreground">
                                        {money(editingCashCurrent)}
                                    </div>
                                </div>
                                <div className="border border-border/60 p-2">
                                    <div className="uppercase tracking-[0.12em] text-muted-foreground">
                                        Change
                                    </div>
                                    <div
                                        className={`mt-1 font-mono text-sm ${
                                            editingCashDelta > 0
                                                ? 'text-primary'
                                                : editingCashDelta < 0
                                                  ? 'text-destructive'
                                                  : 'text-foreground'
                                        }`}
                                    >
                                        {signedMoney(editingCashDelta)}
                                    </div>
                                </div>
                            </div>

                            <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Target sleeve cash
                            </label>
                            <input
                                type="number"
                                min="0"
                                value={cashInput}
                                onChange={(event) =>
                                    setCashInput(event.target.value)
                                }
                                autoFocus
                                onFocus={(event) => event.target.select()}
                                className="mt-1 w-full border border-border bg-card px-3 py-2 text-right font-mono text-sm text-foreground outline-none focus:border-primary"
                            />

                            <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Source
                            </label>
                            <select
                                value={cashSourceType}
                                onChange={(event) =>
                                    setCashSourceType(
                                        event.target
                                            .value as CashMovementSourceType,
                                    )
                                }
                                className="mt-1 w-full border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                            >
                                {cashMovementSourceOptions.map((option) => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </select>

                            <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Note
                            </label>
                            <textarea
                                value={cashNote}
                                onChange={(event) =>
                                    setCashNote(event.target.value)
                                }
                                rows={2}
                                className="mt-1 w-full resize-none border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                                placeholder="Optional"
                            />

                            {cashIntentError && (
                                <div className="mt-3 border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                                    {cashIntentError}
                                </div>
                            )}

                            <div className="mt-4 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={handleCashCancel}
                                    className="border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                                    disabled={cashSaving}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="border border-primary/60 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
                                    disabled={cashSaving}
                                >
                                    {cashSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {showAddStockModal && (
                    <div
                        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70"
                        onClick={() => {
                            if (!addingStock) setShowAddStockModal(false);
                        }}
                    >
                        <div
                            className="terminal-action-dialog w-[420px] rounded border border-border bg-card p-4 shadow-xl"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="mb-4 border-b border-border pb-2">
                                <div className="text-sm font-semibold tracking-wide text-foreground">
                                    ADD TO WATCHLIST
                                </div>
                            </div>

                            <div className="space-y-3 text-xs">
                                <div>
                                    <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                        Company
                                    </label>
                                    <input
                                        value={newStockName}
                                        onChange={(event) => setNewStockName(event.target.value)}
                                        className="w-full rounded border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                        Ticker
                                    </label>
                                    <input
                                        value={newStockTicker}
                                        onChange={(event) => setNewStockTicker(event.target.value.toUpperCase())}
                                        placeholder="ASX:AEE"
                                        className="w-full rounded border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                void handleAddWatchlistStock();
                                            }
                                        }}
                                    />
                                </div>
                                {addStockError && (
                                    <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-destructive">
                                        {addStockError}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowAddStockModal(false)}
                                    className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                                    disabled={addingStock}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleAddWatchlistStock()}
                                    className="rounded border border-primary/60 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
                                    disabled={addingStock}
                                >
                                    {addingStock ? 'Adding...' : 'Add'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <EnrichmentTemplateModal
                    open={showTemplateLibrary}
                    onClose={() => setShowTemplateLibrary(false)}
                />
                <PortfolioAnalysisDialog
                    open={portfolioAnalysisOpen}
                    onOpenChange={setPortfolioAnalysisOpen}
                    error={portfolioMemoError}
                    onStart={(plays, brief) => overlaySummary
                        ? runPortfolioMemoBase(overlaySummary, plays, brief)
                        : Promise.resolve(false)}
                />
                <ListingReviewsModal
                    open={showListingReviews}
                    reviews={listingReviews}
                    loading={listingReviewsLoading}
                    error={listingReviewsError}
                    onClose={() => setShowListingReviews(false)}
                />
                <NonAllocatingInstrumentDialog
                    open={Boolean(nonAllocatingConfirmStock)}
                    name={nonAllocatingConfirmStock?.name || ''}
                    ticker={
                        nonAllocatingConfirmStock
                            ? [
                                  nonAllocatingConfirmStock.prefix,
                                  nonAllocatingConfirmStock.symbol,
                              ]
                                  .filter(Boolean)
                                  .join('')
                            : null
                    }
                    positionValue={
                        nonAllocatingConfirmStock?.positionValue || 0
                    }
                    onCancel={() => setNonAllocatingConfirmStock(null)}
                    onConfirm={() => {
                        const stock = nonAllocatingConfirmStock;
                        setNonAllocatingConfirmStock(null);
                        if (stock) void applyNonAllocatingInstrument(stock);
                    }}
                />
            </div>
        </div>
        </StockTableContext.Provider>
    );
}
