'use client';

import { portfolioApprovalLock } from '@/lib/use-portfolio-cycle';

import React, { useMemo, useCallback } from 'react';
import {
    api,
    type AssetClass,
    type AssetClassConfig,
    type AdjustmentPlanRow,
    type PortfolioRebalancePlanRow,
    type StockGroup,
} from '@/lib/api';
import type { Stock } from '@/lib/store';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import {
    summarizePortfolioRebalanceRows,
    buildPortfolioCashMovementPlan,
    buildLivePortfolioRebalanceRows,
    validatePortfolioRebalanceImport,
    getPortfolioRebalanceRowMove,
    formatPortfolioRebalanceDisplayName,
} from '@/lib/portfolio-rebalance';
import { buildPortfolioRebalanceRowsFromCurrent } from '@/components/stock-table/hooks/use-portfolio-rebalance';
import {
    aggregateHoldingAdjustmentsByAssetClass,
    getAssetClassesWithHoldingInputs,
} from '@/lib/adjustments';
import {
    resolveActiveWorkflowStage,
    canSelectWorkflowStage,
    portfolioRebalanceWorkflowStageOrder,
    type PortfolioRebalanceWorkflowStage,
} from '@/lib/workflow-stages';
import {
    getPortfolioAssetClassColor,
    portfolioColorToSurfaceTint,
} from '@/components/stock-table/portfolio-visual-data';
import {
    AdjustmentInbox,
    AdjustmentStageRail,
} from '@/components/adjustments/position-adjustment-workflow';
import { useStockTableContext } from '@/components/stock-table/stock-table-context';

// ── PortfolioRebalancePanel ────────────────────────────────────────────────────
// Extracted from renderPortfolioRebalancePanel() in stock-table.tsx.
// Reads all state from StockTableContext; re-derives cheap computed values locally.

export function PortfolioRebalancePanel() {
    // ── Context ────────────────────────────────────────────────────────────────
    const {
        rebalance,
        overlay,
        memo,
        review,
        stockGroups,
        portfolio,
        assetClasses,
        assetClassConfig,
        positionStocks,
        activeTab,
        positionsMode,
        portfolioMode,
        setPortfolioMode,
        activeAdjustmentSource,
        setPositionsMode,
        setActiveAdjustmentSource,
        portfolioFocusMode,
        hoveredPortfolioAssetClassCodes,
        setHoveredPortfolioAssetClassCodes,
        selectedPortfolioAssetClassCode,
        setSelectedPortfolioAssetClassCode,
        handleMainTabClick,
        runPortfolioMemo,
        ensurePortfolioTargetGroups,
        removePendingPortfolioTargetGroups,
        getPortfolioRecordedActionForAssetClass,
    } = useStockTableContext();

    // ── Hook destructuring ─────────────────────────────────────────────────────
    const {
        portfolioMix,
        approvedPortfolioMix,
        setApprovedPortfolioMix,
        portfolioRebalancePlan,
        setPortfolioRebalancePlan,
        portfolioAdjustmentPlan,
        setPortfolioAdjustmentPlan,
        portfolioRebalanceRows,
        setPortfolioRebalanceRows,
        portfolioRebalanceTitle,
        setPortfolioRebalanceTitle,
        portfolioRebalanceSaving,
        setPortfolioRebalanceSaving,
        portfolioRebalanceError,
        setPortfolioRebalanceError,
        portfolioRebalanceControlsOpen,
        setPortfolioRebalanceControlsOpen,
        portfolioTargetDraftActive,
        setPortfolioTargetDraftActive,
        portfolioRebalancePanelRef,
        portfolioTargetAlignmentRef,
        portfolioTargetAlignment,
        portfolioCashMoveInputs,
        setPortfolioCashMoveInputs,
        portfolioReductionInputs,
        setPortfolioReductionInputs,
        portfolioSelectedStage,
        setPortfolioSelectedStage,
        portfolioAdjustmentDraftSavedAt,
        loadPortfolioRebalanceData,
        getDefaultPortfolioTargetTitle,
    } = rebalance;

    const { overlaySummary, reviewSignalCopy } = overlay;
    const {
        portfolioMemoState,
        portfolioMemoError,
        applyPortfolioMemoTargets,
    } = memo;
    const { setReviewSelectedStage } = review;
    const {
        groups,
        setGroups,
        stockGroupAssignments,
        saveGroupsToBackend,
    } = stockGroups;

    // ── Asset-class lookup maps ────────────────────────────────────────────────
    const assetClassConfigMap = new Map(
        assetClassConfig.map(
            (setting) =>
                [normalizeAssetClassCode(setting.key), setting] as const,
        ),
    );
    const assetClassMap = useMemo(() => {
        const map = new Map<string, AssetClass>();
        const add = (key: string | null | undefined, sleeve: AssetClass) => {
            const normalized = normalizeAssetClassCode(key);
            if (normalized && !map.has(normalized)) map.set(normalized, sleeve);
        };
        assetClasses.forEach((sleeve) => add(sleeve.code, sleeve));
        assetClasses.forEach((sleeve) => add(sleeve.asset_class_code, sleeve));
        return map;
    }, [assetClasses]);

    const getAssetClassSetting = (
        code?: string | null,
    ): AssetClassConfig | null => {
        const normalized = normalizeAssetClassCode(code);
        return assetClassConfigMap.get(normalized) || null;
    };

    const getNamedGroupAssetClassCode = (group: StockGroup): string | null => {
        const explicitCode = normalizeAssetClassCode(group.asset_class_code);
        if (explicitCode && explicitCode !== 'UNASSIGNED') return explicitCode;
        const legacyNameCode = normalizeAssetClassCode(group.name);
        return legacyNameCode !== 'UNASSIGNED' &&
            assetClassMap.has(legacyNameCode)
            ? legacyNameCode
            : null;
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

    // ── Derived mode flags ─────────────────────────────────────────────────────
    const isPortfolioRebalanceMode =
        activeTab === 'PORTFOLIO' && portfolioMode === 'workflow';
    const isPortfolioTargetAdjustmentMode =
        activeTab === 'POSITIONS' &&
        positionsMode === 'review' &&
        activeAdjustmentSource === 'portfolio_target' &&
        Boolean(portfolioRebalancePlan);

    // ── Portfolio summary ──────────────────────────────────────────────────────
    const portfolioTotalValue =
        portfolioMix?.total_value || portfolio.totalValue || 0;

    const portfolioHasTargetChanges = portfolioRebalanceRows.some(
        (row) =>
            Math.abs(
                (row.target_weight_pct || 0) - (row.current_weight_pct || 0),
            ) > 0.05,
    );
    const portfolioHasDraftTarget =
        portfolioTargetDraftActive ||
        (!portfolioRebalancePlan && portfolioHasTargetChanges);
    const portfolioTargetActive =
        Boolean(portfolioRebalancePlan) || portfolioHasDraftTarget;

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

    const portfolioMixUnassignedRow = portfolioMix?.rows?.find(
        (row) => normalizeAssetClassCode(row.asset_class) === 'UNASSIGNED',
    );

    const getStockAssetClassCode = (stock: Stock): string => {
        if (stock.primaryAssetClass)
            return normalizeAssetClassCode(stock.primaryAssetClass);
        if (
            String(stock.securityType || '')
                .trim()
                .toUpperCase() === 'ETF'
        )
            return 'ETF';
        return 'UNASSIGNED';
    };

    const ungroupedStocks = positionStocks.filter(
        (stock) => !stockGroupAssignments[stock.name],
    );
    const unassignedPortfolioStocks = ungroupedStocks.filter(
        (stock) => getStockAssetClassCode(stock) === 'UNASSIGNED',
    );

    // ── Adjustment derivations ─────────────────────────────────────────────────
    const portfolioAdjustmentRowsByAssetClass = new Map<
        string,
        AdjustmentPlanRow
    >(
        (portfolioAdjustmentPlan?.rows || []).map((row) => [
            normalizeAssetClassCode(row.key),
            row,
        ]),
    );

    const positionAdjustmentHoldings = positionStocks.map((stock) => ({
        id: stock.id,
        assetClass: getStockAssetClassCode(stock),
        currentValue: stock.positionValue || 0,
    }));

    const portfolioStockReductionByAssetClass =
        aggregateHoldingAdjustmentsByAssetClass(
            positionAdjustmentHoldings,
            portfolioReductionInputs,
        );
    const portfolioStockReductionInputAssetClasses =
        getAssetClassesWithHoldingInputs(
            positionAdjustmentHoldings,
            portfolioReductionInputs,
        );

    const portfolioRowsWithCashInputs = portfolioRowsSorted.map((row) => {
        const key = normalizeAssetClassCode(row.asset_class);
        const classInputActive =
            portfolioStockReductionInputAssetClasses.has(key);
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

    const portfolioAdjustmentRequiredDecrease =
        portfolioAdjustmentPlan?.required_decrease_value ??
        portfolioCashMovementPlan.totalRequiredCash;
    const portfolioAdjustmentRecordedDecrease = portfolioAdjustmentPlan
        ? portfolioAdjustmentDecreaseRows.reduce(
              (sum, row) =>
                  sum + getPortfolioRecordedActionForAssetClass(row.key),
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
        portfolioAdjustmentPlan?.tolerance_value ??
        portfolioCashMovementPlan.tolerance;
    const portfolioAdjustmentReadyToConfirm = portfolioAdjustmentPlan
        ? portfolioAdjustmentRequiredDecrease <= 0 ||
          (portfolioAdjustmentRemainingDecrease <=
              portfolioAdjustmentTolerance &&
              portfolioAdjustmentRecordedDecrease <=
                  portfolioAdjustmentRequiredDecrease +
                      portfolioAdjustmentTolerance)
        : portfolioCashMovementPlan.readyToConfirm;

    const portfolioLiveRowsSorted = buildLivePortfolioRebalanceRows(
        portfolioRowsSorted,
        portfolioMix?.rows || [],
    );
    const portfolioImportValidation = validatePortfolioRebalanceImport(
        portfolioLiveRowsSorted,
        portfolioTotalValue,
    );

    // ── Focus / hover helpers ──────────────────────────────────────────────────
    const hoverPortfolioAssetClass = (assetClassCode?: string | null) => {
        if (activeTab !== 'PORTFOLIO' || !assetClassCode) return;
        const code = normalizeAssetClassCode(assetClassCode);
        if (code) setHoveredPortfolioAssetClassCodes([code]);
    };
    const clearHoveredPortfolioAssetClass = () => {
        if (activeTab !== 'PORTFOLIO') return;
        setHoveredPortfolioAssetClassCodes([]);
    };
    const selectPortfolioAssetClass = (assetClassCode?: string | null) => {
        if (
            !isPortfolioRebalanceMode ||
            portfolioFocusMode !== 'select' ||
            !assetClassCode
        )
            return;
        const normalizedCode = normalizeAssetClassCode(assetClassCode);
        setSelectedPortfolioAssetClassCode((current) =>
            current === normalizedCode ? null : normalizedCode,
        );
    };
    const isPortfolioAssetClassFocused = (assetClassCode?: string | null) => {
        if (!isPortfolioRebalanceMode || !assetClassCode) return false;
        const normalizedCode = normalizeAssetClassCode(assetClassCode);
        if (hoveredPortfolioAssetClassCodes.includes(normalizedCode))
            return true;
        return (
            portfolioFocusMode === 'select' &&
            selectedPortfolioAssetClassCode === normalizedCode
        );
    };
    const portfolioAssetClassSelectPanelClass = (
        assetClassCode?: string | null,
    ) =>
        isPortfolioRebalanceMode &&
        portfolioFocusMode === 'select' &&
        assetClassCode &&
        selectedPortfolioAssetClassCode ===
            normalizeAssetClassCode(assetClassCode)
            ? '!border-sky-500/55 !bg-sky-500/[0.07] ring-1 ring-sky-500/35'
            : '';

    const getPortfolioAssetClassTintStyle = (
        assetClassCode: string | null,
    ): React.CSSProperties | undefined => {
        if (
            !isPortfolioRebalanceMode ||
            !assetClassCode ||
            !hoveredPortfolioAssetClassCodes.includes(
                normalizeAssetClassCode(assetClassCode),
            )
        )
            return undefined;
        return {
            backgroundColor: portfolioColorToSurfaceTint(
                getPortfolioAssetClassColor(assetClassCode),
            ),
        };
    };

    // ── Formatters ─────────────────────────────────────────────────────────────
    const money = (value?: number | null): string =>
        `$${Math.round(value || 0).toLocaleString()}`;
    const pct1 = (value?: number | null): string =>
        `${(value || 0).toFixed(1)}%`;
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

    const parsePortfolioTargetPctInput = (value: string | number) => {
        if (typeof value === 'number') return value;
        return Number(value.trim().replace(/%$/, ''));
    };
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

        // ── Panel body (verbatim from renderPortfolioRebalancePanel) ──────────────
    const totalValue = portfolioTotalValue;
    const rowsSorted = portfolioRowsSorted;
    const targetTotal = portfolioTargetTotal;
    const targetTotalValid = portfolioTargetTotalValid;
    const grossMove = portfolioGrossMove;
    const netMove = portfolioNetMove;
    const targetMoveBalanced = portfolioTargetMoveBalanced;
    const transitionCompleted = portfolioTransitionCompleted;
    const baselineApproved = portfolioBaselineApproved;
    const targetMixLocked = Boolean(portfolioRebalancePlan);
    const liveRowsSorted = portfolioLiveRowsSorted;
    const importValidation = portfolioImportValidation;
    const rowsWithCashInputs = portfolioRowsWithCashInputs;
    const cashMovementPlan = portfolioCashMovementPlan;
    const normalizedAdjustmentPlan = isPortfolioTargetAdjustmentMode
        ? portfolioAdjustmentPlan
        : null;
    const adapterImportValidation =
        normalizedAdjustmentPlan?.import_validation || null;
    const statementImportPassed =
        adapterImportValidation?.passed ?? importValidation.passed;
    const statementVarianceRows =
        adapterImportValidation?.variance_rows ??
        importValidation.varianceRows;
    const statementAbsVarianceValue =
        adapterImportValidation?.total_abs_variance_value ??
        importValidation.totalAbsVarianceValue;
    const rebalanceRowsByClass = new Map(
        portfolioRowsSorted.map((row) => [
            normalizeAssetClassCode(row.asset_class),
            row,
        ]),
    );
    const adapterRowsForPanel =
        normalizedAdjustmentPlan?.rows?.map((row) => {
            const key = normalizeAssetClassCode(row.key);
            const existing = rebalanceRowsByClass.get(key);
            return {
                asset_class: key,
                display_name:
                    row.label || existing?.display_name || row.key || key,
                display_order: existing?.display_order || 9999,
                governed_by_q1: existing?.governed_by_q1 || false,
                current_weight_pct: row.current_weight_pct || 0,
                target_weight_pct: row.target_weight_pct || 0,
                delta_weight_pct: row.delta_weight_pct || 0,
                recorded_move_value: row.recorded_value || 0,
                note: existing?.note || row.status || '',
            };
        }) || [];
    const rowsForPanel =
        adapterRowsForPanel.length > 0
            ? adapterRowsForPanel
            : transitionCompleted
              ? liveRowsSorted
              : rowsWithCashInputs;
    const memoRunning =
        portfolioMemoState?.status === 'queued' ||
        portfolioMemoState?.status === 'running';
    const memoTargets = Array.isArray(
        portfolioMemoState?.summary?.assetClassTargets,
    )
        ? (portfolioMemoState?.summary?.assetClassTargets ?? [])
        : [];
    const memoReportId =
        portfolioMemoState?.runId || portfolioMemoState?.jobId || '';
    const memoReportUrl = memoReportId
        ? `https://llm-council-analysis.fly.dev/portfolio-positioning?run_id=${encodeURIComponent(
              memoReportId,
          )}`
        : '';
    const memoDate =
        portfolioMemoState?.summary?.analysisDate ||
        portfolioMemoState?.finishedAt ||
        portfolioMemoState?.createdAt ||
        '';
    const memoDateLabel = memoDate
        ? new Date(memoDate).toLocaleDateString('en-AU', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
          })
        : '';
    const memoTargetsAvailable =
        portfolioMemoState?.status === 'succeeded' && memoTargets.length > 0;
    const draftSourceIsMemo =
        portfolioHasDraftTarget &&
        !portfolioRebalancePlan &&
        memoTargetsAvailable;
    const signedMoney = (value: number) =>
        `${value > 0 ? '+' : value < 0 ? '-' : ''}${money(Math.abs(value))}`;
    const signedPct = (value: number) =>
        `${value > 0 ? '+' : ''}${pct1(value)}`;
    const formatPlanStatus = (value?: string | null) => {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, ' ');
        return normalized
            ? normalized.replace(/\b\w/g, (char) => char.toUpperCase())
            : '';
    };
    const measuredAssetClassOrder = Object.entries(
        portfolioTargetAlignment.offsets,
    )
        .sort((a, b) => a[1] - b[1])
        .map(([code], index) => [code, index] as const);
    const fallbackAssetClassOrder = groups
        .map((group, index) => {
            const code = getPortfolioAlignmentAssetClassCode(
                getNamedGroupAssetClassCode(group),
            );
            return [code, index] as const;
        })
        .filter((entry): entry is [string, number] => Boolean(entry[0]))
        .filter(
            ([code], index, entries) =>
                entries.findIndex(([seenCode]) => seenCode === code) ===
                index,
        )
        .sort((a, b) => {
            const aOrder = getAssetClassSetting(a[0])?.display_order ?? a[1];
            const bOrder = getAssetClassSetting(b[0])?.display_order ?? b[1];
            return aOrder - bOrder;
        });
    if (
        ((portfolioMixUnassignedRow?.value || 0) > 0.01 ||
            unassignedPortfolioStocks.length > 0) &&
        !fallbackAssetClassOrder.some(([code]) => code === 'UNASSIGNED')
    ) {
        fallbackAssetClassOrder.push([
            'UNASSIGNED',
            getAssetClassSetting('UNASSIGNED')?.display_order ??
                fallbackAssetClassOrder.length,
        ]);
    }
    const visibleAssetClassOrder = new Map(fallbackAssetClassOrder);
    measuredAssetClassOrder.forEach(([code, index]) => {
        visibleAssetClassOrder.set(code, index);
    });
    const orderedRows = [...rowsForPanel].sort((a, b) => {
        const aKey = getPortfolioAlignmentAssetClassCode(a.asset_class);
        const bKey = getPortfolioAlignmentAssetClassCode(b.asset_class);
        const aIsCash = aKey === 'CASH';
        const bIsCash = bKey === 'CASH';
        if (aIsCash !== bIsCash) return aIsCash ? 1 : -1;
        const aOrder = visibleAssetClassOrder.get(aKey);
        const bOrder = visibleAssetClassOrder.get(bKey);
        const aVisible = aOrder != null;
        const bVisible = bOrder != null;
        if (aVisible !== bVisible) return aVisible ? -1 : 1;
        if (aVisible && bVisible && aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        return (
            (a.display_order || 9999) - (b.display_order || 9999) ||
            a.display_name.localeCompare(b.display_name)
        );
    });
    const hasMeasuredAlignment =
        Object.keys(portfolioTargetAlignment.offsets).length > 0;
    const alignedRows = orderedRows.filter((row) => {
        const key = getPortfolioAlignmentAssetClassCode(row.asset_class);
        if (key === 'CASH') return true;
        return hasMeasuredAlignment
            ? portfolioTargetAlignment.offsets[key] != null ||
                  visibleAssetClassOrder.has(key)
            : visibleAssetClassOrder.has(key);
    });
        const unmatchedRows = orderedRows.filter((row) => {
            const key = getPortfolioAlignmentAssetClassCode(row.asset_class);
            if (key === 'CASH') return false;
            return hasMeasuredAlignment
                ? portfolioTargetAlignment.offsets[key] == null &&
                      !visibleAssetClassOrder.has(key)
                : !visibleAssetClassOrder.has(key);
        });
        const unmatchedRowGap = 6;
        const targetRowHeight = 29;
        const getFallbackRowTop = (row: PortfolioRebalancePlanRow) => {
            const key = getPortfolioAlignmentAssetClassCode(row.asset_class);
            const order = visibleAssetClassOrder.get(key) ?? 0;
            return 32 + order * 31;
        };
        const getRawAlignedRowTop = (row: PortfolioRebalancePlanRow) => {
            const key = getPortfolioAlignmentAssetClassCode(row.asset_class);
            return (
                portfolioTargetAlignment.offsets[key] ??
                getFallbackRowTop(row)
            );
        };
        const nonCashAlignedRowTops = alignedRows
            .filter(
                (row) =>
                    getPortfolioAlignmentAssetClassCode(row.asset_class) !==
                    'CASH',
            )
            .map(getRawAlignedRowTop)
            .filter((top) => Number.isFinite(top));
        const cashMinimumTop =
            nonCashAlignedRowTops.length > 0
                ? Math.max(...nonCashAlignedRowTops) +
                  targetRowHeight +
                  unmatchedRowGap
                : 32;
        const getAlignedRowTop = (row: PortfolioRebalancePlanRow) => {
            const key = getPortfolioAlignmentAssetClassCode(row.asset_class);
            const rawTop = getRawAlignedRowTop(row);
            return key === 'CASH' ? Math.max(rawTop, cashMinimumTop) : rawTop;
        };
        const alignedRowTops = alignedRows
            .map(getAlignedRowTop)
            .filter((top) => Number.isFinite(top));
    const unmatchedStartTop =
        alignedRowTops.length > 0
            ? Math.max(...alignedRowTops) + targetRowHeight * 2
            : 32;
        const unmatchedBlockHeight =
            unmatchedRows.length > 0
                ? unmatchedRows.length * targetRowHeight +
                  Math.max(0, unmatchedRows.length - 1) * unmatchedRowGap
                : 0;
    const targetAlignmentBaseHeight = portfolioTargetAlignment.height || 420;
    const targetAlignmentHeight =
        unmatchedRows.length > 0
            ? Math.max(
                      targetAlignmentBaseHeight,
                      unmatchedStartTop + unmatchedBlockHeight + 12,
                  )
                : targetAlignmentBaseHeight;
    const renderTargetAllocationRow = (
        row: PortfolioRebalancePlanRow,
        options: { subtle?: boolean } = {},
    ) => {
        const key = normalizeAssetClassCode(row.asset_class);
        const alignmentKey = getPortfolioAlignmentAssetClassCode(
            row.asset_class,
        );
        const isVisibleOnLeft = visibleAssetClassOrder.has(alignmentKey);
        const delta = row.delta_weight_pct || 0;
        const adjustmentRow = portfolioAdjustmentRowsByAssetClass.get(key);
        const fallbackMove = getPortfolioRebalanceRowMove(row, totalValue);
        const moveValue = adjustmentRow?.delta_value ?? fallbackMove.moveValue;
        const requiredActionValue =
            adjustmentRow?.required_value ?? Math.abs(moveValue);
        const recordedActionValue =
            getPortfolioRecordedActionForAssetClass(key);
        const remainingActionValue = Math.max(
            0,
            requiredActionValue - recordedActionValue,
        );
        const isUnmatched = options.subtle || !isVisibleOnLeft;
        const displayName = formatPortfolioRebalanceDisplayName(row);
        const portfolioClassTintStyle =
            getPortfolioAssetClassTintStyle(key);
        const targetPercentFocused = isPortfolioAssetClassFocused(key);
        const showCashMovementControls =
            isPortfolioTargetAdjustmentMode &&
            activePortfolioStage === 'reduce' &&
            targetMixLocked &&
            !transitionCompleted;
        const isReduceAction =
            adjustmentRow?.direction === 'decrease' || moveValue < -50;
        const isPendingAdd =
            adjustmentRow?.direction === 'increase' || moveValue > 50;
        const isRemoveTarget =
            (row.target_weight_pct || 0) <= 0.05 && delta < -0.05;
        const actionStatus = adjustmentRow?.status || '';
        const stockReductionDriven =
            portfolioStockReductionInputAssetClasses.has(key);
        const stockReductionValue =
            portfolioStockReductionByAssetClass[key] || 0;
        const moveTitle = actionStatus
            ? `${formatPlanStatus(actionStatus)} · ${money(
                  remainingActionValue,
              )} remaining`
            : undefined;
        return (
            <div
                key={row.asset_class}
                    className={`grid h-[26px] grid-cols-[minmax(0,1fr)_58px_54px_72px] items-center gap-2 rounded border border-border/30 bg-background/20 px-2 text-[11px] cursor-pointer hover:border-sky-500/35 ${portfolioAssetClassSelectPanelClass(key)}`}
                    title={
                        isUnmatched
                            ? 'Target asset class is not currently visible in the holdings hierarchy.'
                        : moveTitle
                }
                style={portfolioClassTintStyle}
                onMouseEnter={() => hoverPortfolioAssetClass(key)}
                onMouseLeave={clearHoveredPortfolioAssetClass}
                onClick={() => selectPortfolioAssetClass(key)}
            >
                <div className="min-w-0">
                    <div className="truncate text-foreground">
                        {displayName}
                    </div>
                </div>
                <input
                    type="number"
                    min="0"
                    step="0.1"
                    disabled={targetMixLocked}
                    value={(row.target_weight_pct || 0).toFixed(1)}
                    onChange={(event) =>
                        updatePortfolioRebalanceTarget(
                            row.asset_class,
                            event.target.value,
                        )
                    }
                    className={`h-[21px] w-full rounded border px-1 text-right font-mono text-[11px] outline-none focus:border-sky-500/50 ${
                        targetMixLocked
                            ? 'bg-background/20 text-muted-foreground cursor-not-allowed'
                            : 'bg-background/45 text-foreground'
                    } ${
                        targetPercentFocused
                            ? 'border-sky-300/80 shadow-[0_0_0_1px_rgba(125,211,252,0.38)]'
                            : 'border-border/45'
                    }`}
                />
                <div
                    className={`text-right font-mono ${
                        showCashMovementControls && isReduceAction
                            ? 'text-destructive'
                            : showCashMovementControls && isPendingAdd
                              ? 'text-emerald-200'
                              : delta > 0.05
                            ? 'text-emerald-200'
                            : delta < -0.05
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                    }`}
                >
                        {showCashMovementControls
                            ? isReduceAction
                                ? 'CUT'
                                : isPendingAdd
                                  ? 'ADD'
                                  : 'HOLD'
                            : isRemoveTarget
                              ? 'Remove'
                              : signedPct(delta)}
                    </div>
                {showCashMovementControls && isReduceAction ? (
                    <input
                        type="number"
                        min="0"
                        step="100"
                        value={
                            stockReductionDriven
                                ? String(Math.round(stockReductionValue))
                                : portfolioCashMoveInputs[key] || ''
                        }
                        placeholder={String(Math.round(requiredActionValue))}
                        readOnly={stockReductionDriven}
                        onChange={(event) =>
                            setPortfolioCashMoveInputs((prev) => ({
                                ...prev,
                                [key]: event.target.value,
                            }))
                        }
                        title={
                            stockReductionDriven
                                ? 'Driven by stock-level adjustments in the table'
                                : 'Class-level fallback adjustment'
                        }
                        className={`h-[21px] w-full rounded border border-border/45 px-1 text-right font-mono text-[11px] outline-none placeholder:text-muted-foreground focus:border-sky-500/50 ${
                            stockReductionDriven
                                ? 'bg-background/20 text-muted-foreground'
                                : 'bg-background/45 text-foreground'
                        }`}
                    />
                ) : (
                    <div
                        className={`text-right font-mono ${
                            moveValue > 50
                                ? 'text-emerald-200'
                                : moveValue < -50
                                  ? 'text-destructive'
                                  : 'text-muted-foreground'
                        }`}
                    >
                        {showCashMovementControls && isPendingAdd
                            ? money(moveValue)
                            : signedMoney(moveValue)}
                    </div>
                )}
            </div>
        );
    };
    const stageBadgeClass = {
        locked: 'border-border/50 bg-background/35 text-muted-foreground',
        active: 'border-sky-500/35 bg-sky-500/[0.055] text-sky-200',
        ready: 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200',
        warning: 'border-warning/35 bg-warning/[0.06] text-warning',
    };
    const portfolioStageRailItems = [
        {
            key: 'target',
            label: '1 Target',
            badge: targetMixLocked ? 'Locked' : 'Draft',
            badgeClassName: targetMixLocked
                ? stageBadgeClass.ready
                : stageBadgeClass.active,
            caption: targetMixLocked
                ? isPortfolioTargetAdjustmentMode
                    ? 'locked target'
                    : 'target mix locked'
                : portfolioHasTargetChanges
                  ? 'review and lock target'
                  : 'create target mix',
            active: activePortfolioStage === 'target',
            onClick: canSelectPortfolioStage('target')
                ? () => {
                      void selectPortfolioStage('target');
                  }
                : undefined,
        },
        {
            key: 'reduce',
            label: isPortfolioTargetAdjustmentMode
                ? '2 Actions'
                : '2 Reduce',
            badge: transitionCompleted
                ? 'Complete'
                : portfolioRebalancePlan
                  ? 'Active'
                  : 'Locked',
            badgeClassName: transitionCompleted
                ? stageBadgeClass.ready
                : portfolioRebalancePlan
                  ? stageBadgeClass.active
                  : stageBadgeClass.locked,
            caption: transitionCompleted
                ? isPortfolioTargetAdjustmentMode
                    ? 'actions confirmed'
                    : 'actions confirmed'
                : portfolioRebalancePlan
                  ? portfolioAdjustmentRemainingDecrease >
                    portfolioAdjustmentTolerance
                      ? `${money(portfolioAdjustmentRemainingDecrease)} left`
                      : 'ready to confirm'
                  : 'lock target first',
            active: activePortfolioStage === 'reduce',
            onClick: canSelectPortfolioStage('reduce')
                ? () => {
                      void selectPortfolioStage('reduce');
                  }
                : undefined,
        },
        {
            key: 'confirm_cash',
            label: '3 Statement',
            badge: baselineApproved ? 'Approved' : 'Locked',
            badgeClassName: baselineApproved
                ? stageBadgeClass.ready
                : transitionCompleted && statementImportPassed
                  ? stageBadgeClass.active
                  : stageBadgeClass.locked,
            caption: baselineApproved
                ? 'new baseline active'
                : transitionCompleted
                  ? statementImportPassed
                      ? 'ready to finalise'
                      : 'check import'
                  : isPortfolioTargetAdjustmentMode
                    ? 'confirm actions first'
                    : 'confirm actions first',
            active: activePortfolioStage === 'confirm_cash',
            onClick: canSelectPortfolioStage('confirm_cash')
                ? () => {
                      void selectPortfolioStage('confirm_cash');
                  }
                : undefined,
        },
    ];
    const resetToCurrent = () => {
        if (!portfolioMix) return;
        setPortfolioRebalancePlan(null);
        setPortfolioTargetDraftActive(false);
        setPortfolioSelectedStage('target');
        setPortfolioCashMoveInputs({});
        setPortfolioReductionInputs({});
        setPortfolioRebalanceRows(
            buildPortfolioRebalanceRowsFromCurrent(portfolioMix),
        );
        setPortfolioRebalanceTitle(getDefaultPortfolioTargetTitle());
        setPortfolioRebalanceError(null);
    };

    const startNewPortfolioTarget = () => {
        if (!portfolioMix) return;
        setPortfolioMode('workflow');
        setPortfolioRebalancePlan(null);
        setPortfolioTargetDraftActive(true);
        setPortfolioSelectedStage('target');
        setPortfolioCashMoveInputs({});
        setPortfolioReductionInputs({});
        setPortfolioRebalanceRows(buildPortfolioRebalanceRowsFromCurrent(portfolioMix));
        setPortfolioRebalanceTitle(getDefaultPortfolioTargetTitle());
        setPortfolioRebalanceError(null);
    };

        const saveTargetMix = async () => {
            if (!targetTotalValid || portfolioRebalanceSaving) return;
            setPortfolioRebalanceSaving(true);
            setPortfolioRebalanceError(null);
            try {
                if (!portfolioHasTargetChanges && !draftSourceIsMemo) {
                    const approvedMix = await api.approveCurrentPortfolioMix({
                        reason: 'DISCRETIONARY',
                        notes: 'Approved from the Portfolio tab as the current baseline.',
                    });
                    setApprovedPortfolioMix(approvedMix);
                    setPortfolioTargetDraftActive(false);
                    setPortfolioSelectedStage('target');
                    setPortfolioRebalancePlan(null);
                    setPortfolioAdjustmentPlan(null);
                    setPortfolioCashMoveInputs({});
                    setPortfolioReductionInputs({});
                    await loadPortfolioRebalanceData();
                    return;
                }
                const payload = {
                    title:
                        portfolioRebalanceTitle.trim() ||
                        getDefaultPortfolioTargetTitle(),
                notes:
                    'Created from the Portfolio tab using the Positions table view.',
                memo_job_id: draftSourceIsMemo
                    ? portfolioMemoState?.jobId || ''
                    : '',
                rows: rowsSorted,
            };
            const response = draftSourceIsMemo
                ? await api.createPortfolioRebalanceFromMemo(payload)
                : await api.createPortfolioRebalance({
                      ...payload,
                      driver: 'DISCRETIONARY',
                  });
            setPortfolioTargetDraftActive(false);
            setPortfolioSelectedStage('reduce');
            setPortfolioRebalancePlan(response.plan || null);
            await loadPortfolioRebalanceData();
            removePendingPortfolioTargetGroups();
            handleMainTabClick('POSITIONS');
            setPositionsMode('review');
            setActiveAdjustmentSource('portfolio_target');
            setPortfolioRebalanceControlsOpen(true);
        } catch (error) {
            setPortfolioRebalanceError(
                error instanceof Error
                    ? error.message
                    : 'Failed to save portfolio target mix',
            );
        } finally {
            setPortfolioRebalanceSaving(false);
        }
    };

    const renderPortfolioMemoControls = (
        options: { showRunButton?: boolean } = {},
    ) => {
        const showRunButton = options.showRunButton ?? true;
        return (
        <div className="rounded-lg border border-border/40 bg-card/20 p-2.5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        Latest AI Analysis
                    </div>
                    <div className="mt-1 truncate text-xs font-semibold text-foreground">
                        {portfolioMemoState?.jobId
                            ? memoDateLabel || 'Analysis available'
                        : 'No analysis run yet'}
                    </div>
                </div>
                {showRunButton && (
                    <button
                        type="button"
                        onClick={runPortfolioMemo}
                        disabled={!overlaySummary || memoRunning}
                        className="shrink-0 rounded border border-violet-400/35 bg-violet-400/[0.07] px-2 py-1 text-[10px] font-mono uppercase text-violet-100 hover:bg-violet-400/[0.12] disabled:border-border/35 disabled:bg-muted/10 disabled:text-muted-foreground"
                    >
                        {memoRunning ? 'Running...' : 'Run New'}
                    </button>
                )}
            </div>
            {portfolioMemoState?.jobId && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase text-muted-foreground">
                    <span>
                        {portfolioMemoState.status}
                        {portfolioMemoState.stage
                            ? ` · ${portfolioMemoState.stage}`
                            : ''}
                        {portfolioMemoState.progressPct !== undefined
                            ? ` · ${portfolioMemoState.progressPct}%`
                            : ''}
                    </span>
                    {memoTargetsAvailable && (
                        <span className="rounded border border-border/35 bg-background/25 px-1.5 py-0.5">
                            {memoTargets.length} targets
                        </span>
                    )}
                </div>
                )}
                {(memoReportUrl || memoTargetsAvailable) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {memoReportUrl &&
                            portfolioMemoState?.status === 'succeeded' && (
                                <a
                                    href={memoReportUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex rounded border border-border/45 bg-background/25 px-2 py-1 text-[10px] font-mono uppercase text-foreground hover:border-violet-300/45"
                                >
                                    Review Analysis
                                </a>
                            )}
                        {memoTargetsAvailable && (
                            <button
                                type="button"
                                onClick={() =>
                                    applyPortfolioMemoTargets(
                                        portfolioMemoState.summary,
                                    )
                                }
                                className="inline-flex rounded border border-violet-300/35 bg-violet-300/[0.06] px-2 py-1 text-[10px] font-mono uppercase text-violet-100 hover:bg-violet-300/[0.1]"
                            >
	                                Create New Target
                            </button>
                        )}
                    </div>
                )}
            {portfolioMemoError && (
                <div className="mt-2 rounded border border-destructive/35 bg-destructive/[0.06] px-2 py-1.5 text-[10px] text-destructive">
                    {portfolioMemoError}
                </div>
            )}
        </div>
        );
    };

    const selectPortfolioStage = async (
        stage: PortfolioRebalanceWorkflowStage,
    ) => {
        if (!canSelectPortfolioStage(stage) || portfolioRebalanceSaving) return;
        if (
            stage === 'reduce' &&
            transitionCompleted &&
            !baselineApproved &&
            portfolioRebalancePlan
        ) {
            setPortfolioRebalanceSaving(true);
            setPortfolioRebalanceError(null);
            try {
                await api.markPortfolioRebalancePartial(
                    portfolioRebalancePlan.id,
                );
                setPortfolioSelectedStage('reduce');
                await loadPortfolioRebalanceData();
            } catch (error) {
                setPortfolioRebalanceError(
                    error instanceof Error
                        ? error.message
                        : 'Failed to reopen portfolio movement stage',
                );
            } finally {
                setPortfolioRebalanceSaving(false);
            }
            return;
        }
        setPortfolioSelectedStage(stage);
    };

    const confirmPortfolioAdjustmentActions = async () => {
        if (!portfolioRebalancePlan || portfolioRebalanceSaving) return;
        setPortfolioRebalanceSaving(true);
        setPortfolioRebalanceError(null);
        try {
            await api.completePortfolioRebalance(portfolioRebalancePlan.id, {
                rows: rowsWithCashInputs,
            });
            setPortfolioSelectedStage('confirm_cash');
            await loadPortfolioRebalanceData();
        } catch (error) {
            setPortfolioRebalanceError(
                error instanceof Error
                    ? error.message
                    : 'Failed to confirm portfolio adjustment actions',
            );
        } finally {
            setPortfolioRebalanceSaving(false);
        }
    };

    const approvePortfolioAdjustmentBaseline = async () => {
        if (!portfolioRebalancePlan || portfolioRebalanceSaving) return;
        setPortfolioRebalanceSaving(true);
        setPortfolioRebalanceError(null);
        try {
            await api.approvePortfolioRebalance(portfolioRebalancePlan.id);
            ensurePortfolioTargetGroups();
            setPortfolioSelectedStage('confirm_cash');
            await loadPortfolioRebalanceData();
        } catch (error) {
            setPortfolioRebalanceError(
                error instanceof Error
                    ? error.message
                    : 'Failed to approve portfolio adjustment baseline',
            );
        } finally {
            setPortfolioRebalanceSaving(false);
        }
        };

    const openPortfolioActionWorkflow = () => {
        setActiveAdjustmentSource('portfolio_target');
        handleMainTabClick('POSITIONS');
        setPositionsMode('review');
        setPortfolioSelectedStage(transitionCompleted ? 'confirm_cash' : 'reduce');
        setPortfolioRebalanceControlsOpen(true);
    };

    const approvedPortfolioTargetSet = Boolean(
        approvedPortfolioMix?.snapshot && approvedPortfolioMix.rows?.length,
    );
    const approvalLock = portfolioApprovalLock(approvedPortfolioMix);

    if (!portfolioTargetActive) {
            return (
                <aside
                    ref={portfolioRebalancePanelRef}
	                    className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-[#69696917] p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    <div className="rounded-xl border border-border/50 bg-background/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                                    Current Portfolio
                                </div>
                                <div className="mt-1 text-sm font-semibold text-foreground">
                                    {approvedPortfolioTargetSet
                                        ? 'Portfolio target set.'
                                        : 'No portfolio target is active.'}
                                </div>
                                {approvedPortfolioTargetSet && (
                                    <div className="mt-1 text-[10px] text-muted-foreground">
                                        Approved{' '}
                                        {formatRegimeDateTime(
                                            approvedPortfolioMix?.snapshot
                                                ?.approved_at,
                                        )}
                                    </div>
                                )}
                            </div>
                            <div
                                className={`shrink-0 rounded border px-2 py-1 text-[10px] font-mono uppercase ${
                                    approvedPortfolioTargetSet
                                        ? 'border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-200'
                                        : 'border-border/35 bg-muted/10 text-muted-foreground'
                                }`}
                            >
                                {approvedPortfolioTargetSet
                                    ? 'Target Set'
                                    : 'No Target'}
                            </div>
                        </div>
                    </div>

	                    <div className="mt-3 rounded-xl border border-border/45 bg-background/25 p-3">
	                        <div className="flex flex-col gap-2">
	                            <button
	                                type="button"
	                                onClick={startNewPortfolioTarget}
                                disabled={!portfolioMix || portfolioRebalanceSaving}
	                                className="w-full rounded border border-border/60 bg-background/30 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-foreground hover:bg-muted/35 disabled:border-border/35 disabled:bg-muted/10 disabled:text-muted-foreground"
                            >
                                New Portfolio Target
                            </button>
                            <button
                                type="button"
                                onClick={runPortfolioMemo}
                                disabled={!overlaySummary || memoRunning}
	                                className="w-full rounded border border-border/60 bg-background/30 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-foreground hover:bg-muted/35 disabled:border-border/35 disabled:bg-muted/10 disabled:text-muted-foreground"
                            >
                                {memoRunning
                                    ? 'Running AI Analysis...'
                                    : 'Run New AI Portfolio Analysis'}
                            </button>
                        </div>
                        {(portfolioMemoState?.jobId || portfolioMemoError) && (
                            <div className="mt-3">
                                {renderPortfolioMemoControls({
                                    showRunButton: false,
                                })}
                            </div>
                        )}
	                        {portfolioRebalanceError && (
                            <div className="mt-2 rounded border border-destructive/35 bg-destructive/[0.06] px-2 py-1.5 text-[10px] text-destructive">
                                {portfolioRebalanceError}
                            </div>
                        )}
	                    </div>
                </aside>
            );
        }

    if (portfolioRebalancePlan && !isPortfolioTargetAdjustmentMode) {
        const planStatus = formatPlanStatus(portfolioRebalancePlan.status);
        const handoffTitle = baselineApproved
            ? 'Baseline approved'
            : transitionCompleted
              ? 'Awaiting Statement'
              : 'Action in progress';

        return (
            <aside
                ref={portfolioRebalancePanelRef}
                    className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-[#69696917] p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <div className="rounded-xl border border-border/50 bg-background/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                                Portfolio Target
                            </div>
                            <div className="mt-1 text-sm font-semibold text-foreground">
                                {handoffTitle}
                            </div>
                        </div>
                        <div className="shrink-0 rounded border border-sky-500/35 bg-sky-500/[0.055] px-2 py-1 text-[10px] font-mono uppercase text-sky-200">
                            {planStatus || 'Active'}
                        </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded border border-border/35 bg-background/25 px-2 py-1.5">
                            <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                Target
                            </div>
                            <div className="mt-1 font-mono text-xs text-foreground">
                                {pct1(targetTotal)}
                            </div>
                        </div>
                        <div className="rounded border border-border/35 bg-background/25 px-2 py-1.5">
                            <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                Gross
                            </div>
                            <div className="mt-1 font-mono text-xs text-foreground">
                                {money(grossMove)}
                            </div>
                        </div>
                        <div className="rounded border border-border/35 bg-background/25 px-2 py-1.5">
                            <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                Net
                            </div>
                            <div className="mt-1 font-mono text-xs text-foreground">
                                {signedMoney(netMove)}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-3 rounded-xl border border-border/45 bg-background/25 p-3">
                    <button
                        type="button"
                        onClick={openPortfolioActionWorkflow}
                        className="w-full rounded border border-sky-500/35 bg-sky-500/[0.07] px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-sky-100 hover:bg-sky-500/[0.12]"
                    >
                        Open Actions
                    </button>
                    {portfolioRebalanceError && (
                        <div className="mt-2 rounded border border-destructive/35 bg-destructive/[0.06] px-2 py-1.5 text-[10px] text-destructive">
                            {portfolioRebalanceError}
                        </div>
                    )}
                </div>
            </aside>
        );
    }

    return (
        <aside
            ref={portfolioRebalancePanelRef}
                className="relative min-h-0 overflow-hidden rounded-xl border border-border/60 bg-[#69696917] p-3"
        >
            {isPortfolioTargetAdjustmentMode && (
                <div className="mb-3">
                    <AdjustmentInbox
                        title="Active Actions"
                        items={[
                            {
                                key: 'signal-adjustment',
                                title: reviewSignalCopy.title,
                                source: reviewSignalCopy.eyebrow,
                                summary: 'Portfolio risk workflow',
                                badge: 'Risk',
                                badgeClassName:
                                    'border-sky-500/35 bg-sky-500/[0.055] text-sky-200',
                                active: false,
                                onClick: () => {
                                    setActiveAdjustmentSource('signal');
                                    setReviewSelectedStage(null);
                                },
                            },
                            {
                                key: 'portfolio-target-adjustment',
                                title: formatPortfolioTargetTitle(
                                    portfolioRebalanceTitle,
                                ),
                                source: 'Portfolio Rebalancing',
                                badge:
                                    formatPlanStatus(
                                        normalizedAdjustmentPlan?.status,
                                    ) ||
                                    (transitionCompleted
                                        ? 'Statement'
                                        : 'Pending'),
                                badgeClassName: transitionCompleted
                                    ? 'border-sky-500/35 bg-sky-500/[0.055] text-sky-200'
                                    : 'border-warning/35 bg-warning/[0.06] text-warning',
                                active: true,
                            },
                        ]}
                        />
                    </div>
                )}
                <div className="mb-2 border-b border-border/35 px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Target Allocation
                </div>
                <div className="sticky top-0 z-30 mb-1 grid h-[26px] grid-cols-[minmax(0,1fr)_58px_54px_72px] items-end gap-2 border-b border-border/35 bg-card/95 px-2 pb-1 font-mono text-[9px] uppercase text-muted-foreground backdrop-blur">
                    <div className="truncate whitespace-nowrap">Class</div>
                <div className="whitespace-nowrap text-center">%</div>
                <div className="whitespace-nowrap text-right">
                    {isPortfolioTargetAdjustmentMode &&
                    activePortfolioStage === 'reduce' &&
                    !transitionCompleted
                        ? 'Action'
                        : 'Δ%'}
                </div>
                <div className="whitespace-nowrap text-right">
                    {isPortfolioTargetAdjustmentMode &&
                    activePortfolioStage === 'reduce' &&
                    !transitionCompleted
                        ? '$ Move'
                        : '$ Move'}
                </div>
            </div>
            <div
                    ref={portfolioTargetAlignmentRef}
                    className="relative overflow-hidden rounded-xl border border-border/45 bg-background/25"
                    style={{
                        height: `${targetAlignmentHeight}px`,
                    }}
                >
                {alignedRows.map((row) => {
                    const top = getAlignedRowTop(row);
                    return (
                        <div
                            key={row.asset_class}
                            className="absolute left-2 right-2"
                            style={{ top: `${top}px` }}
                        >
                            {renderTargetAllocationRow(row)}
                        </div>
                    );
                })}
                    {unmatchedRows.length > 0 && (
                        <>
                            <div
                                className="absolute left-2 right-2 border-t border-foreground/35"
                                style={{ top: `${unmatchedStartTop - 15}px` }}
                            />
                            <div
                                data-testid="portfolio-target-unmatched-label"
                                className="absolute left-2 z-20 rounded border border-emerald-300/30 bg-card/95 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-[0.16em] text-emerald-200"
                                style={{ top: `${unmatchedStartTop - 28}px` }}
                            >
                                Add
                            </div>
                        </>
                    )}
                {unmatchedRows.map((row, index) => (
                    <div
                        key={row.asset_class}
                            className="absolute left-2 right-2"
                            style={{
                                top: `${
                                    unmatchedStartTop +
                                    index *
                                        (targetRowHeight + unmatchedRowGap)
                                }px`,
                            }}
                        >
                            {renderTargetAllocationRow(row, { subtle: true })}
                    </div>
                ))}
            </div>

                <div className="pointer-events-none absolute inset-x-3 bottom-3 z-40">
                    <div className="pointer-events-auto rounded-xl border border-border/60 border-t-zinc-500/70 shadow-xl shadow-background/35 backdrop-blur" style={{ backgroundColor: 'var(--portfolio-target-controls-bg)' }}>
                        <button
                            type="button"
                            aria-expanded={portfolioRebalanceControlsOpen}
                            onClick={() =>
                                setPortfolioRebalanceControlsOpen((value) => !value)
                            }
                            className="flex w-full items-center justify-between gap-3 rounded-t-xl border-b border-border/35 px-3 py-2 text-left hover:bg-muted/10"
                        >
                            <div className="min-w-0">
                                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                                    {isPortfolioTargetAdjustmentMode
                                        ? 'Adjustment Actions'
                                        : 'Target Controls'}
                                </div>
                                <div className="mt-0.5 truncate text-xs font-semibold text-foreground">
                                    {isPortfolioTargetAdjustmentMode
                                        ? transitionCompleted
                                            ? 'Confirm latest statement'
                                            : 'Action locked portfolio target'
                                        : portfolioRebalancePlan
                                          ? 'Locked rebalance plan'
                                          : 'Draft target actions'}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <span
                                    className={`h-0 w-0 border-x-[5px] border-b-[7px] border-x-transparent border-b-muted-foreground transition-transform duration-200 ease-out ${
                                        portfolioRebalanceControlsOpen
                                            ? 'rotate-180'
                                            : 'rotate-0'
                                    }`}
                                    aria-hidden="true"
                                />
                                <div className="rounded border border-sky-500/35 bg-sky-500/[0.055] px-2 py-1 text-[10px] font-mono uppercase text-sky-200">
                                    {portfolioRebalancePlan?.status ||
                                        (portfolioHasTargetChanges
                                            ? 'Draft'
                                            : 'Draft Target')}
                                </div>
                                <span className="sr-only">
                                    {portfolioRebalanceControlsOpen
                                        ? 'Close portfolio rebalance panel'
                                        : 'Open portfolio rebalance panel'}
                                </span>
                            </div>
                        </button>
                        <div
                            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                                portfolioRebalanceControlsOpen
                                    ? 'grid-rows-[1fr] opacity-100'
                                    : 'grid-rows-[0fr] opacity-0'
                            }`}
                        >
                            <div className="min-h-0 overflow-hidden">
                            <div className="max-h-[min(68vh,560px)] overflow-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {isPortfolioTargetAdjustmentMode && (
                                    <AdjustmentStageRail
                                        stages={portfolioStageRailItems}
                                        layout="horizontal"
                                    />
                                )}
                                    {!isPortfolioTargetAdjustmentMode && (
                                        <div className="rounded-xl border border-border/50 bg-background/20 p-3">
                                            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                                Target
                                            </div>
                                            <div className="mt-2">
                                                <button
                                                    type="button"
                                                    onClick={startNewPortfolioTarget}
                                                disabled={
                                                    !portfolioMix ||
                                                    portfolioRebalanceSaving ||
                                                    targetMixLocked
                                                }
                                                    className="w-full rounded border border-border/45 bg-background/25 px-2 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-foreground hover:border-foreground/40 disabled:border-border/30 disabled:bg-muted/10 disabled:text-muted-foreground"
                                            >
                                                    Manual Target
                                                </button>
                                            </div>
                                            {(portfolioMemoState?.jobId ||
                                                portfolioMemoError) && (
                                            <div className="mt-3">
                                                {renderPortfolioMemoControls({
                                                    showRunButton: false,
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-3 rounded-xl border border-border/50 bg-background/20 p-3">
                                    {isPortfolioTargetAdjustmentMode ? (
                                        <div>
                                            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                                Locked Target
                                            </div>
                                            <div className="mt-1 truncate text-sm font-semibold text-foreground">
                                                {formatPortfolioTargetTitle(
                                                    portfolioRebalanceTitle,
                                                )}
                                            </div>
                                            {normalizedAdjustmentPlan && (
                                                <div className="mt-1 text-[10px] text-muted-foreground">
                                                    {formatPlanStatus(
                                                        normalizedAdjustmentPlan.stage,
                                                    )}
                                                    {' · '}
                                                    {formatPlanStatus(
                                                        normalizedAdjustmentPlan.status,
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div>
                                            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                                Draft Target
                                            </div>
                                            <input
                                                value={portfolioRebalanceTitle}
                                                disabled={targetMixLocked}
                                                onChange={(event) =>
                                                    setPortfolioRebalanceTitle(
                                                        event.target.value,
                                                    )
                                                }
                                                placeholder="Portfolio rebalance title"
                                                className={`mt-2 w-full rounded border border-border/50 px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-sky-500/50 ${
                                                    targetMixLocked
                                                        ? 'bg-background/20 text-muted-foreground cursor-not-allowed'
                                                        : 'bg-background/45 text-foreground'
                                                }`}
                                            />
                                        </div>
                                    )}

                                {isPortfolioTargetAdjustmentMode ? (
                                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                                        <div className="rounded border border-border/35 bg-background/25 p-2">
                                            <div className="text-muted-foreground">
                                                Required cut
                                            </div>
                                            <div className="mt-1 font-mono text-destructive">
                                                {money(
                                                    portfolioAdjustmentRequiredDecrease,
                                                )}
                                            </div>
                                        </div>
                                        <div className="rounded border border-border/35 bg-background/25 p-2">
                                            <div className="text-muted-foreground">
                                                Recorded cut
                                            </div>
                                            <div
                                                className={`mt-1 font-mono ${
                                                    portfolioAdjustmentReadyToConfirm
                                                        ? 'text-emerald-200'
                                                        : 'text-sky-200'
                                                }`}
                                            >
                                                {money(
                                                    portfolioAdjustmentRecordedDecrease,
                                                )}
                                            </div>
                                        </div>
                                        <div className="rounded border border-border/35 bg-background/25 p-2">
                                            <div className="text-muted-foreground">
                                                Remaining
                                            </div>
                                            <div
                                                className={`mt-1 font-mono ${
                                                    portfolioAdjustmentReadyToConfirm
                                                        ? 'text-emerald-200'
                                                        : 'text-warning'
                                                }`}
                                            >
                                                {money(
                                                    portfolioAdjustmentRemainingDecrease,
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                                        <div className="rounded border border-border/35 bg-background/25 p-2">
                                            <div className="text-muted-foreground">Target</div>
                                            <div
                                                className={`mt-1 font-mono ${
                                                    targetTotalValid
                                                        ? 'text-emerald-200'
                                                        : 'text-warning'
                                                }`}
                                            >
                                                {pct1(targetTotal)}
                                            </div>
                                        </div>
                                        <div className="rounded border border-border/35 bg-background/25 p-2">
                                            <div className="text-muted-foreground">Gross</div>
                                            <div className="mt-1 font-mono text-foreground">
                                                {money(grossMove)}
                                            </div>
                                        </div>
                                        <div className="rounded border border-border/35 bg-background/25 p-2">
                                            <div className="text-muted-foreground">Net</div>
                                            <div
                                                className={`mt-1 font-mono ${
                                                    Math.abs(netMove) <= 50
                                                        ? 'text-muted-foreground'
                                                        : netMove > 0
                                                          ? 'text-emerald-200'
                                                          : 'text-destructive'
                                                }`}
                                            >
                                                {signedMoney(netMove)}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {isPortfolioTargetAdjustmentMode &&
                                    portfolioAdjustmentRequiredIncrease > 1 && (
                                        <div className="mt-2 rounded border border-emerald-500/25 bg-emerald-500/[0.04] px-2 py-1.5 text-[11px]">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-muted-foreground">
                                                    Pending add
                                                </span>
                                                <span className="font-mono text-emerald-200">
                                                    {money(
                                                        portfolioAdjustmentRequiredIncrease,
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                {transitionCompleted &&
                                    isPortfolioTargetAdjustmentMode && (
                                    <div
                                        className={`mt-3 rounded border px-2 py-2 text-[11px] ${
                                            statementImportPassed
                                                ? 'border-emerald-500/30 bg-emerald-500/[0.045] text-emerald-200'
                                                : 'border-warning/35 bg-warning/[0.055] text-warning'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono uppercase tracking-[0.1em]">
                                                Import Check
                                            </span>
                                            <span className="font-mono">
                                                {statementImportPassed
                                                    ? 'Matched'
                                                    : `${statementVarianceRows} variance${
                                                          statementVarianceRows === 1
                                                              ? ''
                                                              : 's'
                                                      }`}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-muted-foreground">
                                            Total variance{' '}
                                            {money(statementAbsVarianceValue)}
                                        </div>
                                        {adapterImportValidation?.checks?.some(
                                            (check) =>
                                                check.status === 'VARIANCE',
                                        ) && (
                                            <div className="mt-2 space-y-1">
                                                {adapterImportValidation.checks
                                                    .filter(
                                                        (check) =>
                                                            check.status ===
                                                            'VARIANCE',
                                                    )
                                                    .slice(0, 5)
                                                    .map((check) => (
                                                        <div
                                                            key={check.key}
                                                            className="grid grid-cols-[minmax(0,1fr)_52px_64px] gap-2 rounded border border-warning/25 bg-background/25 px-2 py-1 text-[10px]"
                                                        >
                                                            <div className="truncate text-foreground">
                                                                {check.label ||
                                                                    check.key}
                                                            </div>
                                                            <div className="text-right font-mono text-muted-foreground">
                                                                {signedPct(
                                                                    check.variance_weight_pct,
                                                                )}
                                                            </div>
                                                            <div className="text-right font-mono text-warning">
                                                                {signedMoney(
                                                                    check.variance_value,
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 rounded-xl border border-border/45 bg-background/25 p-3">
                                {!isPortfolioTargetAdjustmentMode && (
                                    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                        Confirm
                                    </div>
                                )}
                                    <div className="flex flex-col gap-2">
                                        {approvalLock && <p role="status" className="text-xs leading-5 text-muted-foreground">{approvalLock}</p>}
                                        {isPortfolioTargetAdjustmentMode ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={
                                                    confirmPortfolioAdjustmentActions
                                                }
                                                disabled={
                                                    portfolioRebalanceSaving ||
                                                    !portfolioAdjustmentReadyToConfirm ||
                                                    transitionCompleted
                                                }
                                                className="rounded border border-emerald-500/35 bg-emerald-500/[0.06] px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-emerald-200 hover:bg-emerald-500/[0.1] disabled:border-border/35 disabled:bg-muted/10 disabled:text-muted-foreground"
                                            >
                                                {transitionCompleted
                                                    ? 'Position Actions Confirmed'
                                                    : 'Confirm Position Actions'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={
                                                    approvePortfolioAdjustmentBaseline
                                                }
                                                title={approvalLock ?? undefined}
                                                disabled={
                                                    Boolean(approvalLock) ||
                                                    portfolioRebalanceSaving ||
                                                    !transitionCompleted ||
                                                    !statementImportPassed ||
                                                    baselineApproved
                                                }
                                                className="rounded border border-border/35 bg-background/25 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground disabled:opacity-50"
                                            >
                                                {baselineApproved
                                                    ? 'Baseline Approved'
                                                    : 'Approve As Baseline'}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                                <button
                                                    type="button"
                                                    onClick={saveTargetMix}
                                                    title={!portfolioHasTargetChanges && !draftSourceIsMemo ? approvalLock ?? undefined : undefined}
                                                    disabled={
                                                        (!portfolioHasTargetChanges && !draftSourceIsMemo && Boolean(approvalLock)) ||
                                                        targetMixLocked ||
                                                        portfolioRebalanceSaving ||
                                                        rowsSorted.length === 0 ||
                                                        !targetTotalValid
                                                    }
                                                className="rounded border border-sky-500/35 bg-sky-500/[0.07] px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-sky-100 hover:bg-sky-500/[0.12] disabled:border-border/35 disabled:bg-muted/10 disabled:text-muted-foreground"
                                            >
                                                {portfolioRebalanceSaving
                                                    ? 'Saving...'
                                                    : targetMixLocked
                                                      ? 'Target Mix Locked'
                                                      : 'Lock Target Mix'}
                                            </button>
                                            {portfolioRebalancePlan && (
                                                <div className="rounded border border-emerald-500/25 bg-emerald-500/[0.045] px-3 py-2 text-[10px] text-muted-foreground">
                                                    <div className="font-mono uppercase tracking-[0.1em] text-emerald-200">
                                                        Action Created
                                                    </div>
                                                    <div className="mt-1">
                                                        This locked target is now an item in
                                                        Actions.
                                                    </div>
                                                </div>
                                            )}
                                            {!portfolioRebalancePlan && (
                                                <button
                                                    type="button"
                                                    onClick={resetToCurrent}
                                                    disabled={
                                                        portfolioRebalanceSaving ||
                                                        !portfolioMix
                                                    }
                                                    className="rounded border border-border/35 bg-background/25 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground disabled:opacity-50"
                                                >
                                                    Cancel Draft
                                                </button>
                                            )}
                                        </>
                                        )}
                                    </div>
                                    {portfolioRebalanceError && (
                                    <div className="mt-2 rounded border border-destructive/35 bg-destructive/[0.06] px-2 py-1.5 text-[10px] text-destructive">
                                        {portfolioRebalanceError}
                                    </div>
                                    )}
                                </div>
                            </div>
                            </div>
                        </div>
                    </div>
                </div>
        </aside>
    );
}
