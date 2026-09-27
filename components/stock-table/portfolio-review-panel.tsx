'use client';

import React, { useMemo } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { ActionsWorkspaceRail, ActionMetrics } from './actions-workspace';
import actionStyles from './actions-workspace.module.css';
import {
    api,
    type AssetClass,
    type AssetClassConfig,
    type AdjustmentPlanRow,
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
} from '@/lib/portfolio-rebalance';
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
    canSelectWorkflowStage,
    resolveActiveWorkflowStage,
    portfolioRebalanceWorkflowStageOrder,
    reviewWorkflowStageOrder,
    type PortfolioRebalanceWorkflowStage,
    type ReviewWorkflowStage,
} from '@/lib/workflow-stages';
import {
    AdjustmentInbox,
    AdjustmentMetric,
} from '@/components/adjustments/position-adjustment-workflow';
import type {
    OverlayAssetClassRow,
    PositionBucketKey,
    ReviewCashMovementRecord,
    ReviewFocus,
    ReviewRecoveryContext,
    ReviewSelectionPlan,
} from '@/components/stock-table/types';
import { useStockTableContext } from '@/components/stock-table/stock-table-context';
import { portfolioApprovalLock } from '@/lib/use-portfolio-cycle';

// ── PortfolioReviewPanel ──────────────────────────────────────────────────────
// Extracted from renderPortfolioReviewPanel() in stock-table.tsx.
// Reads all state from StockTableContext; re-derives cheap computed values locally.

export function PortfolioReviewPanel() {
    // ── Context ────────────────────────────────────────────────────────────────
    const {
        overlay,
        rebalance,
        review,
        stockGroups,
        portfolio,
        assetClasses,
        assetClassConfig,
        positionStocks,
        activeAdjustmentSource,
        setActiveAdjustmentSource,
    navigateToTab,
        setPositionsMode,
        setPortfolioMode,
        selectedPortfolioAssetClassCode,
        ensurePortfolioTargetGroups,
        getPortfolioRecordedActionForAssetClass,
        lastSyncTime,
    } = useStockTableContext();
    const approvalLock = portfolioApprovalLock(rebalance.approvedPortfolioMix);

    // ── Overlay destructuring ──────────────────────────────────────────────────
    const {
        overlaySummary,
        setOverlaySummary,
        overlayRowsByCode,
        rawOverlayRows,
        isQ4DReviewSignal,
        reviewSignalCopy,
        overlayReconciliation,
        immutableReviewSignalCutRatio,
        q4Crisis,
        q4CrisisTargetPct,
        reconciliationOverallStatus,
        reconciliationSourceStatus,
        reconciliationAssetClassStatus,
        reviewActiveEventStatus,
        reviewCashConfirmationStatus,
    } = overlay;

    // ── Review hook destructuring ──────────────────────────────────────────────
    const {
        reviewFocus,
        setReviewFocus,
        reviewCutInputs,
        setReviewCutInputs,
        reviewStageConfirmationOpen,
        setReviewStageConfirmationOpen,
        reviewReopenConfirmOpen,
        setReviewReopenConfirmOpen,
        reviewStage1CompletedAt,
        setReviewStage1CompletedAt,
        reviewCashMovementRecord,
        setReviewCashMovementRecord,
        reviewStageSaving,
        setReviewStageSaving,
        reviewStageSaveError,
        setReviewStageSaveError,
        reviewRecoveryContext,
        setReviewRecoveryContext,
        reviewDraftSavedAt,
        setReviewDraftSavedAt,
        reviewSelectedStage,
        setReviewSelectedStage,
    } = review;

    // ── Rebalance hook destructuring ───────────────────────────────────────────
    const {
        portfolioMix,
        portfolioRebalancePlan,
        portfolioRebalanceRows,
        portfolioAdjustmentPlan,
        portfolioReductionInputs,
        setPortfolioReductionInputs,
        portfolioCashMoveInputs,
        setPortfolioCashMoveInputs,
        portfolioRebalanceTitle,
        portfolioRebalanceSaving,
        setPortfolioRebalanceSaving,
        portfolioRebalanceError,
        setPortfolioRebalanceError,
        setPortfolioRebalanceControlsOpen,
        portfolioAdjustmentDraftSavedAt,
        setPortfolioAdjustmentDraftSavedAt,
        loadPortfolioRebalanceData,
        portfolioSelectedStage,
        setPortfolioSelectedStage,
    } = rebalance;

    // ── StockGroups destructuring ──────────────────────────────────────────────
    const {
        groups,
        stockGroupAssignments,
        collapsedRegimeGroups,
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

    const getAssetClassCashReserve = (code?: string | null): number => {
        const setting = getAssetClassSetting(code);
        return setting?.cash_reserve || 0;
    };

    // ── Stock / group helpers ──────────────────────────────────────────────────
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

    const getBucketMetaForAssetClass = (
        assetClassCode?: string | null,
    ): {
        bucket: PositionBucketKey;
        label: string;
        parentBucket: PositionBucketKey | null;
    } => {
        const normalized = normalizeAssetClassCode(assetClassCode);
        if (normalized === 'CASH') {
            return { bucket: 'cash_reserve', label: 'Cash/Reserve', parentBucket: null };
        }
        const setting = getAssetClassSetting(normalized);
        if (!setting) {
            return { bucket: 'q1_exempt', label: 'Q1-Exempt', parentBucket: null };
        }
        if (!setting.overlay_eligible) {
            return { bucket: 'q1_exempt', label: 'Q1-Exempt', parentBucket: null };
        }
        if (setting.q3_beneficiary) {
            return { bucket: 'partial_q1', label: 'Q1-Defensive', parentBucket: 'q1' };
        }
        return { bucket: 'full_q1', label: 'Q1', parentBucket: null };
    };

    const getGroupDirectStocks = (groupId: string) =>
        positionStocks.filter(
            (stock) => stockGroupAssignments[stock.name] === groupId,
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
        if (explicitCode && explicitCode !== 'UNASSIGNED') return explicitCode;
        const legacyNameCode = normalizeAssetClassCode(group.name);
        if (legacyNameCode !== 'UNASSIGNED' && assetClassMap.has(legacyNameCode))
            return legacyNameCode;
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
        if (explicitCode && explicitCode !== 'UNASSIGNED') return explicitCode;
        const legacyNameCode = normalizeAssetClassCode(group.name);
        return legacyNameCode !== 'UNASSIGNED' && assetClassMap.has(legacyNameCode)
            ? legacyNameCode
            : null;
    };

    const getEditableAssetClassCodeForGroup = (
        group: StockGroup,
    ): string | null => {
        const explicitCode = normalizeAssetClassCode(group.asset_class_code);
        if (explicitCode && explicitCode !== 'UNASSIGNED') return explicitCode;
        const legacyNameCode = normalizeAssetClassCode(group.name);
        if (legacyNameCode !== 'UNASSIGNED' && assetClassMap.has(legacyNameCode))
            return legacyNameCode;
        const descendantCodes = Array.from(
            new Set(
                getGroupStocksRecursive(group.id)
                    .map((stock) => getStockAssetClassCode(stock))
                    .filter((code) => code !== 'UNASSIGNED' && code !== 'CASH'),
            ),
        );
        return descendantCodes.length === 1 ? descendantCodes[0] : null;
    };

    const calculateGroupStats = (
        groupId: string,
    ): {
        marketValue: number;
        bookValue: number;
        cashReserve: number;
        plDollar: number;
    } => calculateStatsForStocks(getGroupStocksRecursive(groupId));

    const calculateGroupStockCount = (groupId: string): number => {
        const directStocks = positionStocks.filter(
            (stock) => stockGroupAssignments[stock.name] === groupId,
        );
        const childGroups = groups.filter((g) => g.parent_id === groupId);
        return (
            directStocks.length +
            childGroups.reduce((sum, child) => sum + calculateGroupStockCount(child.id), 0)
        );
    };

    const calculateGroupMarketValue = (groupId: string): number =>
        calculateGroupStats(groupId).marketValue;

    const getLeafGroupLabel = (group: StockGroup): string => {
        const childGroups = groups.filter((g) => g.parent_id === group.id);
        const count = calculateGroupStockCount(group.id);
        if (childGroups.length === 0 && count > 0) {
            return `${group.name} (${count})`;
        }
        return group.name;
    };

    const formatAssetClassLabel = (code?: string | null): string => {
        const normalized = normalizeAssetClassCode(code);
        if (!normalized || normalized === 'UNASSIGNED') return '—';
        const sleeve = assetClassMap.get(normalized);
        if (sleeve?.display_name) return sleeve.display_name.toUpperCase();
        const setting = getAssetClassSetting(normalized);
        if (setting?.display_name) return setting.display_name.toUpperCase();
        if (normalized === 'BASEMETALS') return 'BASE METALS';
        if (normalized === 'SEMICONDUCTORS') return 'SEMICONDUCTORS';
        return normalized;
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

    // ── Bucket derivations ─────────────────────────────────────────────────────
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
        { q1: [], full_q1: [], partial_q1: [], q1_exempt: [], cash_reserve: [] },
    );

    const portfolioCashBucketValue =
        overlaySummary?.portfolio_cash_bucket_value ?? portfolio.cashOnHand ?? 0;

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

    const getImmediateParentMarketValueForStock = (
        stock: Stock,
    ): number | null => {
        const groupId = stockGroupAssignments[stock.name];
        if (groupId) return calculateGroupMarketValue(groupId);
        const bucket = getBucketMetaForAssetClass(getStockAssetClassCode(stock)).bucket;
        return bucketStats[bucket].marketValue || null;
    };

    const getBucketClassPercent = (bucket: PositionBucketKey): number | null => {
        if (bucket === 'full_q1' || bucket === 'partial_q1') {
            return bucketStats.q1.marketValue > 0
                ? (bucketStats[bucket].marketValue / bucketStats.q1.marketValue) * 100
                : null;
        }
        return null;
    };

    // ── Adjustment holding helpers ─────────────────────────────────────────────
    const getAdjustmentHoldingForStock = (stock: Stock): AdjustmentHolding => ({
        id: stock.id,
        assetClass: getStockAssetClassCode(stock),
        currentValue: stock.positionValue || 0,
    });

    const positionAdjustmentHoldings = positionStocks.map(getAdjustmentHoldingForStock);

    // ── Review reduction helpers ───────────────────────────────────────────────
    const reviewRequiredReductionByAssetClass = rawOverlayRows.reduce<
        Record<string, number>
    >((acc, row) => {
        const key = normalizeAssetClassCode(row.asset_class || row.display_name);
        const required = Math.max(0, row.delta_value || 0);
        if (required > 0) acc[key] = required;
        return acc;
    }, {});

    const getReviewPlannedCutForStock = (stock: Stock): number =>
        getPlannedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            reviewCutInputs,
        );

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

    const getReviewSuggestedCutForStock = (stock: Stock): number =>
        getSuggestedAdjustmentForHolding(
            getAdjustmentHoldingForStock(stock),
            positionAdjustmentHoldings,
            reviewRequiredReductionByAssetClass,
        );

    const getReviewReductionTolerance = (requiredCutValue: number): number =>
        getAdjustmentTolerance(requiredCutValue, { minimum: 1000, ratio: 0.05 });

    // ── Review base required reduction ─────────────────────────────────────────
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

    // ── Bucket / overlay plan helpers ──────────────────────────────────────────
    const getBucketAssetCodes = (bucket: PositionBucketKey): string[] => {
        const stocksForBucket =
            bucket === 'q1'
                ? [...bucketStocksMap.full_q1, ...bucketStocksMap.partial_q1]
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
            { actualValue: 0, targetValue: 0, moveValue: 0, hasOverlay: false },
        );
    };

    const getReviewPortfolioPct = (value: number) => {
        const totalValue = overlaySummary?.portfolio_value || portfolio.totalValue;
        return totalValue > 0 ? (value / totalValue) * 100 : 0;
    };

    // ── Review selection plans ─────────────────────────────────────────────────
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
                        ? `Sell ${money(moveValue)} from Q1 holdings and hold the proceeds in reserve.`
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
            bucket === 'full_q1' || bucket === 'partial_q1'
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

    const getReviewPlanForGroup = (group: StockGroup): ReviewSelectionPlan => {
        const currentStats = calculateGroupStats(group.id);
        const plan = getOverlayPlanForCodes(
            getGroupAssetCodesForRegime(group),
            currentStats.marketValue,
        );
        const targetValue = Math.max(0, plan.targetValue);
        const classDenominator = group.parent_id
            ? calculateGroupMarketValue(group.parent_id)
            : bucketStats[
                  getBucketMetaForAssetClass(getGroupAssetClassCode(group)).bucket
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
                    ? [...bucketStocksMap.full_q1, ...bucketStocksMap.partial_q1]
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
                    ? `${assetLabel} needs ${money(sleeveMove)} moved to reserve. The suggested amount is proportional guidance only; you can allocate the adjustment across stocks manually.`
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

    // ── Portfolio adjustment derivations ───────────────────────────────────────
    const portfolioTotalValue =
        portfolioMix?.total_value || portfolio.totalValue || 0;

    const portfolioRebalanceSummary = summarizePortfolioRebalanceRows(
        portfolioRebalanceRows,
        portfolioTotalValue,
        portfolioRebalancePlan,
    );
    const {
        rowsSorted: portfolioRowsSorted,
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

    const portfolioAdjustmentRowsByAssetClass = new Map<string, AdjustmentPlanRow>(
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

    const portfolioLiveRowsSorted = buildLivePortfolioRebalanceRows(
        portfolioRowsSorted,
        portfolioMix?.rows || [],
    );
    const portfolioImportValidation = validatePortfolioRebalanceImport(
        portfolioLiveRowsSorted,
        portfolioTotalValue,
    );

    // ── Formatters ─────────────────────────────────────────────────────────────
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

    const compactPct = (value: number): string =>
        `${value.toLocaleString('en-AU', { maximumFractionDigits: 1 })}%`;

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

    // ── Panel body ─────────────────────────────────────────────────────────────
    const requiredReduction =
        reviewRecoveryRequiredReduction > 1
            ? reviewRecoveryRequiredReduction
            : reviewBaseRequiredReduction;
    const selectedPlan = getActiveReviewPlan();
    const signalCutPct = immutableReviewSignalCutRatio * 100;
    const fullQ1SignalCutPct =
        bucketStats.full_q1.marketValue > 0
            ? (getBucketOverlayDelta('full_q1') /
                  bucketStats.full_q1.marketValue) *
              100
            : signalCutPct;
    const q1DefensiveSignalCutPct =
        bucketStats.partial_q1.marketValue > 0
            ? (getBucketOverlayDelta('partial_q1') /
                  bucketStats.partial_q1.marketValue) *
              100
            : 0;
    const q1ExemptSignalCutPct =
        bucketStats.q1_exempt.marketValue > 0
            ? (getBucketOverlayDelta('q1_exempt') /
                  bucketStats.q1_exempt.marketValue) *
              100
            : 0;
const fullQ1PlannedMove = getReviewPlannedCutForStocks(
    bucketStocksMap.full_q1,
);
const q1DefensivePlannedMove = getReviewPlannedCutForStocks(
    bucketStocksMap.partial_q1,
);
const q1ExemptPlannedMove = getReviewPlannedCutForStocks(
    bucketStocksMap.q1_exempt,
);
const stage1PlannedMove = getReviewPlannedCutForStocks([
    ...bucketStocksMap.full_q1,
    ...bucketStocksMap.partial_q1,
    ...bucketStocksMap.q1_exempt,
]);
const activeEventStatus = String(
    overlaySummary?.active_event_status || '',
).toUpperCase();
const backendStage1Locked =
    Boolean(reviewStage1CompletedAt) ||
    Boolean(overlaySummary?.active_event_stage1_applied_at) ||
    activeEventStatus === 'STAGE1_DONE' ||
    activeEventStatus === 'STAGE2_DONE' ||
    activeEventStatus === 'PARTIAL';
const stage1RecordedMove = Math.max(
    0,
    overlaySummary?.stage1_recorded_reduction_value ??
        reviewCashMovementRecord?.recordedReductionValue ??
        0,
);
const stage1DisplayMove =
    backendStage1Locked && stage1RecordedMove > 0
        ? stage1RecordedMove
        : stage1PlannedMove;
const reviewBookCurrentValue =
    bucketStats.q1.marketValue + bucketStats.q1_exempt.marketValue;
const reviewPortfolioTotalValue =
    overlaySummary?.portfolio_value || portfolio.totalValue || 0;
const q4MarketCurrentPct =
    reviewPortfolioTotalValue > 0
        ? (reviewBookCurrentValue / reviewPortfolioTotalValue) * 100
        : 0;
const currentAdjustmentPct =
    reviewBookCurrentValue > 0
        ? (stage1DisplayMove / reviewBookCurrentValue) * 100
        : 0;
const stage1RemainingMove = Math.max(
    0,
    requiredReduction - stage1DisplayMove,
);
const stage1Tolerance = getReviewReductionTolerance(requiredReduction);
const q1ExposureNowPct =
    reviewBookCurrentValue > 0
        ? (Math.max(0, reviewBookCurrentValue - stage1DisplayMove) /
              reviewBookCurrentValue) *
          100
        : 100;
const q4MarketExposureNowPct =
    reviewPortfolioTotalValue > 0
        ? (Math.max(0, reviewBookCurrentValue - stage1DisplayMove) /
              reviewPortfolioTotalValue) *
          100
        : 0;
const fullQ1ExposureNowPct =
    bucketStats.full_q1.marketValue > 0
        ? (Math.max(
              0,
              bucketStats.full_q1.marketValue - fullQ1PlannedMove,
          ) /
              bucketStats.full_q1.marketValue) *
          100
        : 100;
const q1DefensiveExposureNowPct =
    bucketStats.partial_q1.marketValue > 0
        ? (Math.max(
              0,
              bucketStats.partial_q1.marketValue -
                  q1DefensivePlannedMove,
          ) /
              bucketStats.partial_q1.marketValue) *
          100
        : 100;
const q1ExemptExposureNowPct =
    bucketStats.q1_exempt.marketValue > 0
        ? (Math.max(
              0,
              bucketStats.q1_exempt.marketValue - q1ExemptPlannedMove,
          ) /
              bucketStats.q1_exempt.marketValue) *
              100
        : 100;
const currentReserveValue =
    overlaySummary?.portfolio_cash_bucket_value ?? portfolio.cashOnHand ?? 0;
const draftReserveAfter =
    overlaySummary?.stage1_expected_reserve_value ??
    currentReserveValue + stage1DisplayMove;
const displayedSignalPct = isQ4DReviewSignal
    ? q4CrisisTargetPct
    : signalCutPct;
const q3DetectorTargetPct =
    overlaySummary?.active_event_to_q1_exposure_pct ??
    overlaySummary?.effective_equity_pct ??
    Math.max(0, 100 - signalCutPct);
const allocationAvailableValue =
    overlaySummary?.available_headroom_value || 0;
const isPending = requiredReduction > 1;
const statusLabel = isPending
    ? 'Pending'
    : allocationAvailableValue > 1
      ? 'Allocation allowed'
      : 'No forced move';
const statusClass =
    isPending
        ? 'border-sky-500/35 bg-sky-500/[0.055] text-sky-200'
        : 'border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-200';
const signalValueClass =
    isQ4DReviewSignal
        ? q4MarketCurrentPct > q4CrisisTargetPct + 0.05
            ? 'text-destructive'
            : 'text-emerald-200'
        : signalCutPct > 0.05
          ? 'text-destructive'
          : 'text-emerald-200';
const selectedRequiredMove =
    selectedPlan.requiredMoveValue ?? selectedPlan.moveValue;
const selectedPlannedMove = selectedPlan.plannedMoveValue ?? 0;
const selectedRemainingMove =
    selectedPlan.remainingMoveValue ??
    Math.max(0, selectedRequiredMove - selectedPlannedMove);
const selectedStock =
    reviewFocus?.type === 'stock'
        ? positionStocks.find((item) => item.id === reviewFocus.stockId) ||
          null
        : null;
const selectedAssetContext = selectedStock
    ? (() => {
          const assetCode = getStockAssetClassCode(selectedStock);
          const assetStocks = positionStocks.filter(
              (item) => getStockAssetClassCode(item) === assetCode,
          );
          const currentValue = assetStocks.reduce(
              (sum, item) => sum + (item.positionValue || 0),
              0,
          );
          const requiredMoveValue = Math.max(
              0,
              overlayRowsByCode.get(assetCode)?.delta_value ?? 0,
          );
          const plannedMoveValue = getReviewPlannedCutForAssetCodes([
              assetCode,
          ]);
          const remainingMoveValue = Math.max(
              0,
              requiredMoveValue - plannedMoveValue,
          );
          return {
              label: formatAssetClassLabel(assetCode),
              level:
                  selectedStock.name ||
                  selectedStock.symbol ||
                  'Selected position',
              currentValue,
              requiredMoveValue,
              plannedMoveValue,
              remainingMoveValue,
          };
      })()
    : null;
const selectedContext = selectedAssetContext ?? {
    label: selectedPlan.label,
    level: selectedPlan.level,
    currentValue: selectedPlan.currentValue,
    requiredMoveValue: selectedRequiredMove,
    plannedMoveValue: selectedPlannedMove,
    remainingMoveValue: selectedRemainingMove,
};
const showSelectedContextCard =
    selectedContext.requiredMoveValue > 1 ||
    selectedContext.remainingMoveValue > 1 ||
    reviewFocus?.type === 'stock' ||
    reviewFocus?.type === 'group';
const selectedRequiredPct =
    selectedContext.currentValue > 0
        ? (selectedContext.requiredMoveValue /
              selectedContext.currentValue) *
          100
        : 0;
const selectedRequiredDisplayPct =
    selectedContext.label === 'Q1'
        ? signalCutPct
        : selectedRequiredPct;
const selectedRecordedPct =
    selectedContext.currentValue > 0
        ? (selectedContext.plannedMoveValue /
              selectedContext.currentValue) *
          100
        : 0;
const selectedHasRequiredMove =
    selectedContext.requiredMoveValue > 1;
const selectedProgressPct =
    selectedHasRequiredMove
        ? Math.min(
              100,
              (selectedContext.plannedMoveValue /
                  selectedContext.requiredMoveValue) *
                  100,
          )
        : 0;
const selectedProgressComplete =
    selectedHasRequiredMove && selectedProgressPct >= 99.5;
const reserveRatio =
    (overlaySummary?.total_tactical_cash_value || 0) > 0
        ? Math.min(
              100,
              ((overlaySummary?.portfolio_cash_bucket_value || 0) /
                  (overlaySummary?.total_tactical_cash_value || 1)) *
                  100,
          )
        : 100;
const stage1Overplanned =
    stage1PlannedMove > requiredReduction + stage1Tolerance;
const stage1ReadyToComplete =
    requiredReduction > 1 &&
    stage1RemainingMove <= stage1Tolerance &&
    !stage1Overplanned;
const hasDraftCuts = Object.values(reviewCutInputs).some((value) => {
    const parsed = Number.parseFloat(value || '');
    return Number.isFinite(parsed) && parsed > 0;
});
const latestImportAt = lastSyncTime ? lastSyncTime.toISOString() : null;
const cashMovementTolerance = reviewCashMovementRecord
    ? Math.max(50, reviewCashMovementRecord.expectedReserveIncrease * 0.02)
    : 50;
const cashMovementImportAfterRecord =
    Boolean(
        reviewCashMovementRecord &&
            lastSyncTime &&
            lastSyncTime.getTime() >
                new Date(reviewCashMovementRecord.completedAt).getTime(),
    );
const cashMovementConfirmed =
    Boolean(reviewCashMovementRecord) &&
    cashMovementImportAfterRecord &&
    currentReserveValue >=
        (reviewCashMovementRecord?.expectedReserveValue || 0) -
            cashMovementTolerance;
const backendCashStatus = String(
    overlaySummary?.cash_confirmation_status || '',
).toUpperCase();
const statementReconciliationVariance =
    reconciliationOverallStatus === 'VARIANCE' ||
    reconciliationSourceStatus === 'VARIANCE' ||
    reconciliationAssetClassStatus === 'VARIANCE';
const reductionRecorded =
    Boolean(reviewStage1CompletedAt) ||
    Boolean(overlaySummary?.active_event_stage1_applied_at) ||
    activeEventStatus === 'STAGE1_DONE' ||
    activeEventStatus === 'STAGE2_DONE' ||
    activeEventStatus === 'PARTIAL';
const reserveConfirmed =
    (backendCashStatus === 'CONFIRMED' || cashMovementConfirmed) &&
    !statementReconciliationVariance;
const reserveVariance =
    backendCashStatus === 'VARIANCE' || statementReconciliationVariance;
const statementVarianceActive =
    reserveVariance && Boolean(overlayReconciliation?.cash);
const statementWorkflowActive =
    !reserveConfirmed &&
    (reductionRecorded || statementVarianceActive);
const activeHeadroomOnlyEvent =
    activeEventStatus === 'PENDING' &&
    requiredReduction <= 1 &&
    allocationAvailableValue > 1;
const reviewNoForcedMove =
    activeHeadroomOnlyEvent ||
    (!reviewHasForcedReduction &&
        !reductionRecorded &&
        !reserveConfirmed &&
        !reserveVariance);
const stage2Badge = !statementWorkflowActive && !reductionRecorded
    ? 'Locked'
    : reserveConfirmed
      ? 'Confirmed'
      : statementVarianceActive
        ? 'Variance'
        : 'Waiting';
const stage2BadgeClass = reserveConfirmed
    ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
    : statementVarianceActive
      ? 'border-destructive/45 bg-destructive/[0.06] text-destructive'
      : statementWorkflowActive || reductionRecorded
        ? 'border-sky-500/35 bg-sky-500/[0.055] text-sky-200'
        : 'border-border/50 bg-background/35 text-muted-foreground';
const completeBadge = reserveConfirmed ? 'Complete' : 'Locked';
const completeBadgeClass = reserveConfirmed
    ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
    : 'border-border/50 bg-background/35 text-muted-foreground';
const refreshOverlaySummary = async () => {
    const summary = await api.getPortfolioOverlaySummary();
    setOverlaySummary(summary || null);
};
const reviewPortfolioShape = () => {
    setPortfolioMode('workflow');
    setPortfolioRebalanceControlsOpen(true);
    navigateToTab('PORTFOLIO');
};
const markSignalReviewed = async () => {
    setReviewStageSaving(true);
    setReviewStageSaveError(null);
    try {
        await api.markPortfolioOverlaySignalReviewed();
        await refreshOverlaySummary();
    } catch (error) {
        setReviewStageSaveError(
            String(
                (error as any)?.message ||
                    error ||
                    'Failed to mark signal reviewed',
            ),
        );
    } finally {
        setReviewStageSaving(false);
    }
};
    const movedGroupSummaries = groups
    .filter((group) => calculateGroupStockCount(group.id) > 0)
    .filter(
        (group) =>
            !groups.some(
                (child) =>
                    child.parent_id === group.id &&
                    calculateGroupStockCount(child.id) > 0,
            ),
    )
    .map((group) => {
        const stats = calculateGroupStats(group.id);
        const required = getReviewPlanForGroup(group).moveValue;
        const recorded = getReviewPlannedCutForStocks(
            getGroupStocksRecursive(group.id),
        );
        const reductionPct =
            stats.marketValue > 0
                ? (recorded / stats.marketValue) * 100
                : 0;
        return {
            id: group.id,
            label: getLeafGroupLabel(group),
            required,
            recorded,
            reductionPct,
        };
    })
    .filter((item) => item.required > 1 || item.recorded > 1)
    .sort((a, b) => b.recorded - a.recorded || b.required - a.required)
    .slice(0, 8);
const movedBucketSummaries = [
    {
        label: 'Q1',
        recorded: fullQ1PlannedMove,
        required: getBucketOverlayDelta('full_q1'),
        pct: signalCutPct,
    },
    {
        label: 'Q1-Defensive',
        recorded: q1DefensivePlannedMove,
        required: getBucketOverlayDelta('partial_q1'),
        pct: q1DefensiveSignalCutPct,
    },
    {
        label: 'Q1-Exempt',
        recorded: q1ExemptPlannedMove,
        required: getBucketOverlayDelta('q1_exempt'),
        pct: q1ExemptSignalCutPct,
    },
].filter((item) => item.required > 1 || item.recorded > 1);
const saveReviewDraft = () => {
    const savedAt = new Date().toISOString();
    localStorage.setItem(
        'terminal-review-draft',
        JSON.stringify({
            cutInputs: reviewCutInputs,
            savedAt,
            stage1CompletedAt: reviewStage1CompletedAt,
            cashMovementRecord: reviewCashMovementRecord,
        }),
    );
    setReviewDraftSavedAt(savedAt);
};
    const clearReviewDraft = () => {
        localStorage.removeItem('terminal-review-draft');
        localStorage.removeItem('terminal-review-recovery');
        setReviewCutInputs({});
        setReviewDraftSavedAt(null);
    setReviewStage1CompletedAt(null);
    setReviewSelectedStage(null);
    setReviewStageConfirmationOpen(false);
        setReviewCashMovementRecord(null);
        setReviewRecoveryContext(null);
        setReviewStageSaveError(null);
    };
    const buildReserveRecoveryDraft = () => {
        if (!reserveVariance || !overlayReconciliation?.cash) {
            return null;
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

        for (const source of overlayReconciliation.source_checks || []) {
            const stock =
                (source.holding_id != null
                    ? stockById.get(Number(source.holding_id))
                    : null) ||
                stockByName.get(source.stock_name.trim().toLowerCase());
            if (!stock) continue;

            const expectedReduction = Math.max(
                0,
                source.expected_reduction || 0,
            );
            const actualReduction = Math.max(
                0,
                source.actual_reduction || 0,
            );
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

        const cash = overlayReconciliation.cash;
        const reserveShortfall = Math.max(0, -(cash.reserve_variance || 0));
        const context: ReviewRecoveryContext = {
            eventId: overlayReconciliation.event_id,
            createdAt: new Date().toISOString(),
            reserveShortfall,
            previousRequiredReduction: reviewBaseRequiredReduction,
            previousRecordedReduction: stage1RecordedMove,
            expectedReserveValue: cash.expected_reserve_value || 0,
            importedReserveValue: cash.imported_reserve_value || 0,
            restoredCutTotal,
            restoredCutCount,
        };

        return { cutInputs, context };
    };
    const reopenReduceStage = async () => {
        if (reviewStageSaving) return;
        const backendNeedsReopen =
            !reviewStageConfirmationOpen &&
            (Boolean(overlaySummary?.active_event_stage1_applied_at) ||
                activeEventStatus === 'STAGE1_DONE' ||
                activeEventStatus === 'STAGE2_DONE' ||
                activeEventStatus === 'PARTIAL');
        if (
            !backendNeedsReopen &&
            !reviewStage1CompletedAt &&
            !reviewStageConfirmationOpen
        ) {
            setReviewSelectedStage('reduce');
            return;
        }

        setReviewStageSaving(true);
        setReviewStageSaveError(null);
        try {
            const recoveryDraft = buildReserveRecoveryDraft();
            if (backendNeedsReopen) {
                await api.reopenPortfolioOverlayStage1();
            }
            const reopenedAt = new Date().toISOString();
            const nextCutInputs =
                recoveryDraft?.context.reserveShortfall &&
                recoveryDraft.context.reserveShortfall > 1
                    ? recoveryDraft.cutInputs
                    : reviewCutInputs;
            localStorage.setItem(
                'terminal-review-draft',
                JSON.stringify({
                    cutInputs: nextCutInputs,
                    savedAt: reviewDraftSavedAt || reopenedAt,
                    stage1CompletedAt: null,
                    cashMovementRecord: null,
                }),
            );
            if (recoveryDraft?.context.reserveShortfall) {
                localStorage.setItem(
                    'terminal-review-recovery',
                    JSON.stringify(recoveryDraft.context),
                );
                setReviewRecoveryContext(recoveryDraft.context);
            }
            setReviewCutInputs(nextCutInputs);
            setReviewDraftSavedAt((prev) => prev || reopenedAt);
            setReviewStage1CompletedAt(null);
            setReviewSelectedStage('reduce');
            setReviewStageConfirmationOpen(false);
            setReviewCashMovementRecord(null);
            setReviewFocus({
                type: 'bucket',
                key: 'bucket:q1',
                bucket: 'q1',
                label: 'Q1',
            });
            if (backendNeedsReopen) {
                await refreshOverlaySummary();
            }
        } catch (error) {
            setReviewStageSaveError(
                error instanceof Error
                    ? error.message
                    : 'Failed to reopen Stage 1',
            );
        } finally {
            setReviewStageSaving(false);
        }
    };
const renderReviewReopenConfirmModal = () => (
    <AlertDialog.Root open={reviewReopenConfirmOpen} onOpenChange={open => {
        if (!reviewStageSaving) setReviewReopenConfirmOpen(open);
    }}>
        <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-[250] bg-black/60" />
            <AlertDialog.Content className={actionStyles.dialog}>
                <AlertDialog.Title className={actionStyles.dialogTitle}>Reopen Actions?</AlertDialog.Title>
                <AlertDialog.Description className={actionStyles.note}>
                    This ends the current statement wait and reopens the recorded adjustments.
                    Reopening does not execute or reverse a trade.
                </AlertDialog.Description>
                <div className={actionStyles.dialogActions}>
                    <AlertDialog.Cancel asChild>
                        <button type="button" disabled={reviewStageSaving} className={actionStyles.button}>Cancel</button>
                    </AlertDialog.Cancel>
                    <button type="button" disabled={reviewStageSaving} className={actionStyles.button}
                        onClick={async () => {
                            await reopenReduceStage();
                            setReviewReopenConfirmOpen(false);
                        }}>{reviewStageSaving ? 'Reopening...' : 'Reopen Actions'}</button>
                </div>
            </AlertDialog.Content>
        </AlertDialog.Portal>
    </AlertDialog.Root>
);
const buildStage1SourcePayload = () =>
    positionStocks
        .map((stock) => {
            const amountSold = getReviewPlannedCutForStock(stock);
            if (amountSold <= 0) return null;
            const groupId = stockGroupAssignments[stock.name] || '';
            const group = groupId
                ? groups.find((item) => item.id === groupId)
                : null;
            return {
                holding_id: stock.id,
                stock_name: stock.name,
                ticker: `${stock.prefix || ''}${stock.symbol || ''}`,
                asset_class: getStockAssetClassCode(stock),
                group_id: groupId,
                group_label: group ? getLeafGroupLabel(group) : '',
                amount_sold: amountSold,
            };
        })
        .filter(Boolean) as Array<{
        holding_id: number;
        stock_name: string;
        ticker: string;
        asset_class: string;
        group_id: string;
        group_label: string;
        amount_sold: number;
    }>;
const markStage1Complete = async () => {
    if (!stage1ReadyToComplete || reviewStageSaving) return;
    if (!reviewStageConfirmationOpen) {
        setReviewStageConfirmationOpen(true);
        setReviewStageSaveError(null);
        const savedAt = new Date().toISOString();
        localStorage.setItem(
            'terminal-review-draft',
            JSON.stringify({
                cutInputs: reviewCutInputs,
                savedAt,
                stage1CompletedAt: reviewStage1CompletedAt,
                cashMovementRecord: reviewCashMovementRecord,
            }),
        );
        setReviewDraftSavedAt(savedAt);
        return;
    }
    setReviewStageSaving(true);
    setReviewStageSaveError(null);
    const completedAt = new Date().toISOString();
    const cashMovementRecord: ReviewCashMovementRecord = {
        completedAt,
        expectedReserveIncrease: stage1PlannedMove,
        baselineReserveValue: currentReserveValue,
        expectedReserveValue: currentReserveValue + stage1PlannedMove,
        recordedReductionValue: stage1PlannedMove,
        requiredReductionValue: requiredReduction,
        q1ExposureAfterPct: q1ExposureNowPct,
        fullQ1ExposureAfterPct: fullQ1ExposureNowPct,
        q1DefensiveExposureAfterPct: q1DefensiveExposureNowPct,
        q1ExemptExposureAfterPct: q1ExemptExposureNowPct,
        importAt: latestImportAt,
        activeEventId: overlaySummary?.active_event_id ?? null,
    };
    try {
        const response = await api.applyPortfolioOverlayStage1({
            required_reduction_value: requiredReduction,
            recorded_reduction_value: stage1PlannedMove,
            baseline_reserve_value: currentReserveValue,
            expected_reserve_value: currentReserveValue + stage1PlannedMove,
            sources: buildStage1SourcePayload(),
        });
        const persistedRecord = {
            ...cashMovementRecord,
            expectedReserveValue:
                response.expected_reserve_value ??
                cashMovementRecord.expectedReserveValue,
            baselineReserveValue:
                response.baseline_reserve_value ??
                cashMovementRecord.baselineReserveValue,
            recordedReductionValue:
                response.recorded_reduction_value ??
                cashMovementRecord.recordedReductionValue,
            requiredReductionValue:
                response.required_reduction_value ??
                cashMovementRecord.requiredReductionValue,
            activeEventId:
                response.event_id ??
                cashMovementRecord.activeEventId ??
                null,
        };
        localStorage.setItem(
            'terminal-review-draft',
            JSON.stringify({
                cutInputs: reviewCutInputs,
                savedAt: reviewDraftSavedAt || completedAt,
                stage1CompletedAt: completedAt,
                cashMovementRecord: persistedRecord,
            }),
        );
        setReviewDraftSavedAt((prev) => prev || completedAt);
        setReviewStage1CompletedAt(completedAt);
        setReviewSelectedStage('confirm_cash');
        setReviewStageConfirmationOpen(false);
        setReviewCashMovementRecord(persistedRecord);
        try {
            const summary = await api.getPortfolioOverlaySummary();
            setOverlaySummary(summary || null);
        } catch (error) {
            console.error(
                '[ALPHA EDGE] Failed to refresh overlay summary after Stage 1:',
                error,
            );
        }
    } catch (error) {
        console.error('[ALPHA EDGE] Failed to apply Stage 1:', error);
        setReviewStageSaveError(
            String(
                (error as any)?.message ||
                    error ||
                    'Failed to save adjustment history',
            ),
        );
    } finally {
        setReviewStageSaving(false);
    }
};
const stage1LockedForDisplay =
    reductionRecorded || statementWorkflowActive;
const stage1Badge = stage1LockedForDisplay
    ? 'Complete'
    : stage1Overplanned
      ? 'Above target'
      : stage1ReadyToComplete
        ? 'Ready'
        : isPending
          ? 'Active'
          : 'No Action';
const stage1BadgeClass = stage1LockedForDisplay
    ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
    : stage1Overplanned
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : stage1ReadyToComplete
          ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
        : isPending
          ? 'border-sky-500/35 bg-sky-500/[0.055] text-sky-200'
          : 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200';

const metric = (
    label: string,
    value: string,
    className = 'text-foreground',
) => (
    <AdjustmentMetric
        label={label}
        value={value}
        valueClassName={className}
    />
);

const planProgress =
    requiredReduction > 1
        ? Math.max(
              0,
              Math.min(100, (stage1DisplayMove / requiredReduction) * 100),
          )
        : 100;
const stage2Active = statementWorkflowActive && !reserveConfirmed;
const currentWorkflowStage: ReviewWorkflowStage = reserveConfirmed
    ? 'complete'
    : stage2Active
      ? 'confirm_cash'
      : 'reduce';
const effectiveReviewSelectedStage =
    statementWorkflowActive && reviewSelectedStage === 'reduce'
        ? null
        : reviewSelectedStage;
const activeReviewStage = resolveActiveWorkflowStage(
    reviewWorkflowStageOrder,
    currentWorkflowStage,
    effectiveReviewSelectedStage,
    'complete',
);
const statementReviewMode =
    statementWorkflowActive && activeReviewStage === 'confirm_cash';
const statementReserveExpected =
    overlayReconciliation?.cash?.expected_reserve_value ??
    reviewRecoveryContext?.expectedReserveValue ??
    draftReserveAfter;
const statementReserveImported =
    overlayReconciliation?.cash?.imported_reserve_value ??
    reviewRecoveryContext?.importedReserveValue ??
    currentReserveValue;
const statementReserveVariance = statementReserveImported - statementReserveExpected;
const canSelectReviewStage = (stage: ReviewWorkflowStage): boolean => {
    return canSelectWorkflowStage(
        reviewWorkflowStageOrder,
        stage,
        activeReviewStage,
        currentWorkflowStage,
        'complete',
    );
};
const selectReviewStage = (stage: ReviewWorkflowStage) => {
    if (!canSelectReviewStage(stage)) return;
    if (stage === 'reduce' && statementWorkflowActive) {
        setReviewReopenConfirmOpen(true);
        return;
    }
    setReviewSelectedStage(stage);
};
const reviewStageRailItems = [
    {
        key: 'reduce',
        label: '1 Adjust Positions',
        badge: stage1Badge,
        badgeClassName: stage1BadgeClass,
        caption:
            stage1LockedForDisplay
                ? 'position adjustment recorded'
                : stage1RemainingMove > 1
                  ? `${money(stage1RemainingMove)} left · use adjustment column`
                  : 'ready · review and confirm',
        active: activeReviewStage === 'reduce',
        onClick:
            canSelectReviewStage('reduce') && !reserveConfirmed
                ? () => {
                      if (statementWorkflowActive) {
                          setReviewReopenConfirmOpen(true);
                          return;
                      }
                      void reopenReduceStage();
                  }
                : undefined,
    },
    {
        key: 'confirm_cash',
        label: '2 Await Statement',
        badge: stage2Badge,
        badgeClassName: stage2BadgeClass,
        caption: reserveConfirmed
            ? 'statement confirmed'
            : statementVarianceActive
              ? 'statement variance'
              : reductionRecorded
                ? 'awaiting statement'
                : 'locked',
        active: activeReviewStage === 'confirm_cash',
        onClick: canSelectReviewStage('confirm_cash')
            ? () => selectReviewStage('confirm_cash')
            : undefined,
    },
    {
        key: 'complete',
        label: '3 Complete',
        badge: completeBadge,
        badgeClassName: completeBadgeClass,
        caption: reserveConfirmed
              ? 'reserve confirmed'
              : 'locked',
        active: activeReviewStage === 'complete',
        onClick: canSelectReviewStage('complete')
            ? () => selectReviewStage('complete')
            : undefined,
    },
];
const signalAdjustmentOpen =
    !reviewNoForcedMove || Boolean(overlaySummary?.active_event_id);
const signalAdjustmentSummary = statementWorkflowActive
    ? statementVarianceActive
        ? 'Statement variance · review imported reserve'
        : 'Awaiting statement import'
    : undefined;
const reviewDraftStatusText = reviewStage1CompletedAt
    ? `Adjustment completed ${formatRegimeDateTime(
          reviewStage1CompletedAt,
      )}`
    : reviewDraftSavedAt
      ? `Draft saved ${formatRegimeDateTime(reviewDraftSavedAt)}`
      : stage1Overplanned
        ? 'Draft adjustments exceed target beyond tolerance.'
        : 'Unsaved local draft.';
const showReviewBottomDock =
    !reviewNoForcedMove &&
    !statementReviewMode &&
    !reductionRecorded &&
    activeReviewStage === 'reduce';
const portfolioAdjustmentOpen =
    Boolean(portfolioRebalancePlan) &&
    !portfolioBaselineApproved &&
    (portfolioAdjustmentRequiredDecrease > 1 ||
        portfolioAdjustmentRequiredIncrease > 1 ||
        portfolioTransitionCompleted);
const effectiveActiveAdjustmentSource =
    activeAdjustmentSource === 'signal' &&
    !signalAdjustmentOpen &&
    portfolioAdjustmentOpen
        ? 'portfolio_target'
        : activeAdjustmentSource;
const adjustmentInboxItems = [
    ...(signalAdjustmentOpen
        ? [
              {
                  key: 'signal-adjustment',
                  title: reviewSignalCopy.title,
                  source: reviewSignalCopy.eyebrow,
                  summary: signalAdjustmentSummary,
                  badge: statusLabel,
                  badgeClassName: statusClass,
                  active: effectiveActiveAdjustmentSource === 'signal',
                  onClick: () => {
                      setActiveAdjustmentSource('signal');
                      setReviewSelectedStage(activeReviewStage);
                  },
              },
          ]
        : []),
    ...(portfolioAdjustmentOpen
        ? [
              {
                  key: 'portfolio-target-adjustment',
                  title: formatPortfolioTargetTitle(portfolioRebalanceTitle),
                  source: 'Portfolio Rebalancing',
                  badge: portfolioAdjustmentPlan?.status
                      ? portfolioAdjustmentPlan.status
                            .toLowerCase()
                            .replace(/_/g, ' ')
                      : portfolioTransitionCompleted
                        ? 'Statement'
                        : 'Pending',
                  badgeClassName: portfolioTransitionCompleted
                      ? 'border-sky-500/35 bg-sky-500/[0.055] text-sky-200'
                      : 'border-warning/35 bg-warning/[0.06] text-warning',
                  active:
                      effectiveActiveAdjustmentSource ===
                      'portfolio_target',
                  onClick: () => {
                      setActiveAdjustmentSource('portfolio_target');
                      setPositionsMode('review');
                      setPortfolioRebalanceControlsOpen(true);
                      setPortfolioSelectedStage(
                          portfolioTransitionCompleted
                              ? 'confirm_cash'
                              : 'reduce',
                      );
                  },
              },
          ]
        : []),
];

if (effectiveActiveAdjustmentSource === 'portfolio_target') {
    const portfolioStatementImportPassed =
        portfolioAdjustmentPlan?.import_validation?.passed ??
        portfolioImportValidation.passed;
    const portfolioStatementVarianceRows =
        portfolioAdjustmentPlan?.import_validation?.variance_rows ??
        portfolioImportValidation.varianceRows;
    const portfolioStatementAbsVarianceValue =
        portfolioAdjustmentPlan?.import_validation
            ?.total_abs_variance_value ??
        portfolioImportValidation.totalAbsVarianceValue;
    const portfolioStageItems = [
        {
            key: 'reduce',
            label: '1 Adjust Positions',
            badge: portfolioTransitionCompleted
                ? 'Complete'
                : portfolioAdjustmentReadyToConfirm
                  ? 'Ready'
                  : 'Active',
            badgeClassName: portfolioTransitionCompleted
                ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
                : portfolioAdjustmentReadyToConfirm
                  ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
                  : 'border-sky-500/35 bg-sky-500/[0.055] text-sky-200',
            caption: portfolioTransitionCompleted
                  ? 'position move recorded'
                : portfolioAdjustmentRemainingDecrease > 1
                  ? `${money(portfolioAdjustmentRemainingDecrease)} left · use adjustment column`
                  : 'ready to confirm',
            active: activePortfolioStage === 'reduce',
            onClick:
                !portfolioBaselineApproved &&
                activePortfolioStage !== 'reduce'
                    ? () => {
                          setPortfolioSelectedStage('reduce');
                      }
                    : undefined,
        },
        {
            key: 'confirm_cash',
            label: '2 Await Statement',
            badge: portfolioBaselineApproved
                ? 'Complete'
                : portfolioTransitionCompleted
                  ? portfolioStatementImportPassed
                      ? 'Matched'
                      : 'Check'
                  : 'Locked',
            badgeClassName: portfolioBaselineApproved
                ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
                : portfolioTransitionCompleted &&
                    portfolioStatementImportPassed
                  ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
                  : portfolioTransitionCompleted
                    ? 'border-warning/35 bg-warning/[0.06] text-warning'
                    : 'border-border/50 bg-background/35 text-muted-foreground',
            caption: portfolioBaselineApproved
                ? 'statement confirmed'
                : portfolioTransitionCompleted
                  ? portfolioStatementImportPassed
                      ? 'ready to finalise'
                      : 'variance'
                  : 'locked',
            active: activePortfolioStage === 'confirm_cash',
            onClick: portfolioTransitionCompleted
                ? () => {
                      setPortfolioSelectedStage('confirm_cash');
                  }
                : undefined,
        },
        {
            key: 'complete',
            label: '3 Complete',
            badge: portfolioBaselineApproved ? 'Complete' : 'Locked',
            badgeClassName: portfolioBaselineApproved
                ? 'border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-200'
                : 'border-border/50 bg-background/35 text-muted-foreground',
            caption: portfolioBaselineApproved
                ? 'new baseline active'
                : 'locked',
            active: portfolioBaselineApproved,
            onClick: undefined,
        },
    ];
    const confirmPortfolioAdjustmentActions = async () => {
        if (
            !portfolioRebalancePlan ||
            portfolioRebalanceSaving ||
            !portfolioAdjustmentReadyToConfirm ||
            portfolioTransitionCompleted
        ) {
            return;
        }
        setPortfolioRebalanceSaving(true);
        setPortfolioRebalanceError(null);
        try {
            await api.completePortfolioRebalance(
                portfolioRebalancePlan.id,
                {
                    rows: portfolioRowsWithCashInputs,
                },
            );
            localStorage.removeItem(
                'terminal-portfolio-adjustment-draft',
            );
            setPortfolioAdjustmentDraftSavedAt(null);
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
        if (
            !portfolioRebalancePlan ||
            portfolioRebalanceSaving ||
            !portfolioTransitionCompleted ||
            !portfolioStatementImportPassed ||
            portfolioBaselineApproved
        ) {
            return;
        }
        setPortfolioRebalanceSaving(true);
        setPortfolioRebalanceError(null);
        try {
            await api.approvePortfolioRebalance(
                portfolioRebalancePlan.id,
            );
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
    const topPortfolioDecreaseRows = [...portfolioAdjustmentDecreaseRows]
        .filter((row) => row.required_value > 1)
        .sort(
            (a, b) =>
                (b.remaining_value || b.required_value || 0) -
                (a.remaining_value || a.required_value || 0),
        )
        .slice(0, 6);
    const topPortfolioIncreaseRows = [...portfolioAdjustmentIncreaseRows]
        .filter((row) => row.required_value > 1)
        .sort(
            (a, b) =>
                (b.required_value || 0) - (a.required_value || 0),
        )
        .slice(0, 4);
    const portfolioActionRows = [
        ...portfolioAdjustmentDecreaseRows,
        ...portfolioAdjustmentIncreaseRows,
    ];
    const selectedPortfolioStock =
        reviewFocus?.type === 'stock'
            ? positionStocks.find(
                  (item) => item.id === reviewFocus.stockId,
              ) || null
            : null;
    const selectedPortfolioStockAssetCode = selectedPortfolioStock
        ? getStockAssetClassCode(selectedPortfolioStock)
        : '';
    const selectedPortfolioActionRow =
        (selectedPortfolioStockAssetCode &&
            portfolioActionRows.find(
                (row) =>
                    normalizeAssetClassCode(row.key) ===
                    selectedPortfolioStockAssetCode,
            )) ||
        (selectedPortfolioAssetClassCode &&
            portfolioActionRows.find(
                (row) =>
                    normalizeAssetClassCode(row.key) ===
                    selectedPortfolioAssetClassCode,
            )) ||
        topPortfolioDecreaseRows[0] ||
        topPortfolioIncreaseRows[0] ||
        null;
    const selectedAssetClassLabel =
        selectedPortfolioActionRow?.label || 'Portfolio target';
    const selectedPortfolioRecordedValue = selectedPortfolioActionRow
        ? getPortfolioRecordedActionForAssetClass(
              selectedPortfolioActionRow.key,
          )
        : portfolioAdjustmentRecordedDecrease;
    const selectedPortfolioRequiredValue =
        selectedPortfolioActionRow?.required_value ||
        portfolioAdjustmentRequiredDecrease;
    const selectedPortfolioRemainingValue = Math.max(
        0,
        selectedPortfolioRequiredValue - selectedPortfolioRecordedValue,
    );
    const selectedPortfolioProgressPct =
        selectedPortfolioRequiredValue > 0
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      (selectedPortfolioRecordedValue /
                          selectedPortfolioRequiredValue) *
                          100,
                  ),
              )
            : 100;
    const selectedPortfolioStockContext =
        selectedPortfolioStock &&
        selectedPortfolioActionRow &&
        normalizeAssetClassCode(selectedPortfolioActionRow.key) ===
            selectedPortfolioStockAssetCode
            ? selectedPortfolioStock.name ||
              selectedPortfolioStock.symbol ||
              null
            : null;
    const selectedPortfolioContext =
        selectedPortfolioStockContext ??
        (selectedPortfolioActionRow?.direction === 'decrease'
            ? selectedPortfolioActionRow.target_weight_pct <= 0.05
                ? 'Remove target'
                : `Target: ${pct1(
                      selectedPortfolioActionRow.target_weight_pct,
                  )}`
            : selectedPortfolioActionRow?.direction === 'increase'
              ? 'Pending add'
              : null);
    const portfolioDraftActionActive =
        Object.values(portfolioCashMoveInputs).some((value) => {
            const numericValue = Number.parseFloat(value);
            return Number.isFinite(numericValue) && numericValue > 0;
        }) ||
        Object.values(portfolioReductionInputs).some((value) => {
            const numericValue = Number.parseFloat(value);
            return Number.isFinite(numericValue) && numericValue > 0;
        });
    const portfolioActionProgress =
        portfolioAdjustmentRequiredDecrease > 1
            ? Math.max(
                  0,
                  Math.min(
                      100,
                      (portfolioAdjustmentRecordedDecrease /
                          portfolioAdjustmentRequiredDecrease) *
                          100,
                  ),
              )
            : 100;
    const portfolioTargetActionText =
        portfolioAdjustmentRequiredDecrease > 1
            ? `Reduce by ${money(portfolioAdjustmentRequiredDecrease)}`
            : portfolioAdjustmentRequiredIncrease > 1
              ? `Add ${money(portfolioAdjustmentRequiredIncrease)}`
              : 'No position action required';
    const portfolioActionOverplanned =
        portfolioAdjustmentRecordedDecrease >
        portfolioAdjustmentRequiredDecrease + portfolioAdjustmentTolerance;
    const portfolioDraftCashAfter =
        (portfolio.cashOnHand || 0) + portfolioAdjustmentRecordedDecrease;
    const portfolioDraftStatusText = portfolioTransitionCompleted
        ? 'Position actions confirmed'
        : portfolioAdjustmentDraftSavedAt
          ? `Draft saved ${formatRegimeDateTime(
                portfolioAdjustmentDraftSavedAt,
            )}`
          : portfolioDraftActionActive
            ? 'Unsaved local draft'
            : 'No local changes';
    const savePortfolioAdjustmentDraft = () => {
        const savedAt = new Date().toISOString();
        localStorage.setItem(
            'terminal-portfolio-adjustment-draft',
            JSON.stringify({
                planId: portfolioRebalancePlan?.id ?? null,
                cashMoveInputs: portfolioCashMoveInputs,
                reductionInputs: portfolioReductionInputs,
                savedAt,
            }),
        );
        setPortfolioAdjustmentDraftSavedAt(savedAt);
    };
    const clearPortfolioAdjustmentDraft = () => {
        localStorage.removeItem('terminal-portfolio-adjustment-draft');
        setPortfolioCashMoveInputs({});
        setPortfolioReductionInputs({});
        setPortfolioAdjustmentDraftSavedAt(null);
        setPortfolioRebalanceError(null);
    };

    return (
        <>
            <ActionsWorkspaceRail
                items={adjustmentInboxItems} stages={portfolioStageItems}
                title={portfolioBaselineApproved ? 'Rebalance complete' : portfolioTransitionCompleted
                    ? portfolioStatementImportPassed ? 'Ready to approve baseline' : 'Review statement differences'
                    : portfolioTargetActionText}
                tone={portfolioBaselineApproved || (portfolioTransitionCompleted && portfolioStatementImportPassed)
                    ? 'success' : portfolioTransitionCompleted ? 'warning' : 'neutral'}
                description={portfolioBaselineApproved ? 'The statement is verified and the new baseline is active.'
                    : portfolioTransitionCompleted
                        ? 'Execution is recorded and locked. Check the statement before approving the baseline; do not repeat the recorded trades.'
                        : 'Record reductions against the asset-class requirements. Stock amounts are proportional guides, not individual targets.'}
            >
                <section className={actionStyles.section}>
                    <h3>{portfolioTransitionCompleted ? 'Recorded reductions' : 'Portfolio reductions'}</h3>
                    <ActionMetrics label="Portfolio reduction totals" values={[
                        { label: 'Required', value: money(portfolioAdjustmentRequiredDecrease) },
                        { label: 'Recorded', value: money(portfolioAdjustmentRecordedDecrease) },
                        { label: 'Remaining', value: money(portfolioAdjustmentRemainingDecrease) },
                    ]} />
                    <div className={actionStyles.progress} role="progressbar" aria-label="Reductions recorded"
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={portfolioActionProgress}>
                        <div style={{ width: `${portfolioActionProgress}%` }} />
                    </div>
                    {portfolioTransitionCompleted && <p>{portfolioAdjustmentReadyToConfirm
                        ? `Recorded within the ${money(portfolioAdjustmentTolerance)} tolerance; awaiting statement verification.`
                        : 'Recorded amounts are not statement verification.'}</p>}
                    {portfolioAdjustmentRequiredIncrease > 1 && <p>Planned additions: {money(portfolioAdjustmentRequiredIncrease)}. Purchases remain subject to available, confirmed capacity.</p>}
                </section>

                {portfolioTransitionCompleted ? (
                    <section className={actionStyles.section} aria-label="Statement comparison">
                        <h3>Statement comparison</h3>
                        <ActionMetrics label="Statement verification" values={[
                            { label: 'Differences', value: String(portfolioStatementVarianceRows), tone: portfolioStatementImportPassed ? 'success' : 'warning' },
                            { label: 'Absolute difference', value: money(portfolioStatementAbsVarianceValue) },
                        ]} />
                        <p>{portfolioAdjustmentPlan?.import_validation?.checked_rows ?? portfolioImportValidation.checkedRows} classes checked against the locked target.</p>
                        {portfolioAdjustmentPlan?.import_validation?.checks?.some(check => check.status === 'VARIANCE') && (
                            <details className={actionStyles.section}>
                                <summary>Review class differences ({portfolioStatementVarianceRows})</summary>
                                <table className={actionStyles.evidence}>
                                    <thead><tr><th>Asset class</th><th>Difference</th><th>pp</th></tr></thead>
                                    <tbody>{portfolioAdjustmentPlan.import_validation.checks.filter(check => check.status === 'VARIANCE').map(check => (
                                        <tr key={check.key}><td>{check.label || check.key}</td>
                                            <td data-variance="true">{signedMoney(check.variance_value)}</td>
                                            <td>{check.variance_weight_pct > 0 ? '+' : ''}{check.variance_weight_pct.toFixed(1)}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </details>
                        )}
                    </section>
                ) : (
                    <section className={actionStyles.section}>
                        <h3>{selectedAssetClassLabel}</h3>
                        {selectedPortfolioContext && <p>{selectedPortfolioContext}</p>}
                        <ActionMetrics label="Selected asset-class reduction" values={[
                            { label: 'Required', value: money(selectedPortfolioRequiredValue) },
                            { label: 'Recorded', value: money(selectedPortfolioRecordedValue) },
                            { label: 'Remaining', value: money(selectedPortfolioRemainingValue) },
                        ]} />
                    </section>
                )}
                {portfolioRebalanceError && <p role="alert" className={actionStyles.error}>{portfolioRebalanceError}</p>}
            </ActionsWorkspaceRail>
            {portfolioAdjustmentOpen && (
                <footer className="review-dock">
                    <div className="review-dock-main">
                        <div className="review-dock-left">
                            <span>{portfolioTransitionCompleted
                                ? portfolioStatementImportPassed ? 'Statement verified. Ready to approve.' : 'Resolve statement differences before approval.'
                                : portfolioDraftStatusText}</span>
                            {!portfolioTransitionCompleted && <>
                                <span>Recorded <strong data-testid="portfolio-dock-recorded">{money(portfolioAdjustmentRecordedDecrease)}</strong></span>
                                <span>Remaining <strong data-testid="portfolio-dock-remaining">{money(portfolioAdjustmentRemainingDecrease)}</strong></span>
                                <span>Expected cash <strong data-testid="portfolio-dock-cash-after-draft">{money(portfolioDraftCashAfter)}</strong></span>
                            </>}
                        </div>
                    </div>
                    {!portfolioTransitionCompleted && (
                        <div className={`review-dock-progress ${portfolioActionOverplanned ? 'review-dock-progress-over'
                            : portfolioAdjustmentReadyToConfirm ? 'review-dock-progress-ready' : ''}`}
                            data-testid="portfolio-dock-progress">
                            <div className="review-dock-progress-fill" style={{ width: `${portfolioActionProgress}%` }} />
                        </div>
                    )}
                    <div className="review-dock-actions">
                        {!portfolioTransitionCompleted && <>
                            <button type="button" onClick={clearPortfolioAdjustmentDraft}
                                disabled={(!portfolioDraftActionActive && !portfolioAdjustmentDraftSavedAt) || portfolioRebalanceSaving}
                                data-testid="portfolio-clear-draft"
                                className="review-dock-button review-dock-button-ghost review-dock-button-danger">Clear</button>
                            <button type="button" onClick={savePortfolioAdjustmentDraft}
                                disabled={!portfolioDraftActionActive || portfolioRebalanceSaving}
                                data-testid="portfolio-save-draft"
                                className="review-dock-button review-dock-button-ghost">Save draft</button>
                        </>}
                        {!portfolioTransitionCompleted ? (
                            <button type="button" onClick={confirmPortfolioAdjustmentActions}
                                disabled={portfolioRebalanceSaving || !portfolioAdjustmentReadyToConfirm}
                                data-testid="portfolio-confirm-position-actions"
                                className="review-dock-button review-dock-button-primary">Confirm position actions</button>
                        ) : (
                            <div>
                            {approvalLock && <p className="text-xs leading-5 text-muted-foreground" role="status">{approvalLock}</p>}
                            <button type="button" onClick={approvePortfolioAdjustmentBaseline}
                                disabled={Boolean(approvalLock) || portfolioRebalanceSaving || !portfolioStatementImportPassed || portfolioBaselineApproved}
                                title={approvalLock || (!portfolioStatementImportPassed ? 'The broker statement must match before approval' : undefined)}
                                data-testid="portfolio-approve-baseline"
                                className="review-dock-button review-dock-button-primary">Approve baseline</button>
                            </div>
                        )}
                    </div>
                </footer>
            )}
        </>
    );
}

if (reviewStageConfirmationOpen && !reviewStage1CompletedAt) {
    return (
        <ActionsWorkspaceRail items={adjustmentInboxItems} stages={reviewStageRailItems}
            title="Review recorded reductions"
            description="Confirm only the reductions you executed. Proceeds leave the affected asset classes; a later broker statement must verify the reserve balance.">
            <section className={actionStyles.section}>
                <ActionMetrics label="Confirm reduction totals" values={[
                    { label: 'Required', value: money(requiredReduction) },
                    { label: 'Recorded', value: money(stage1PlannedMove) },
                    { label: 'Expected reserve', value: money(draftReserveAfter) },
                ]} />
                <p>{latestImportAt ? `Statement baseline: ${formatRegimeDateTime(latestImportAt)}` : 'No import baseline available.'}</p>
            </section>
            <section className={actionStyles.section}>
                <h3>Reductions by bucket</h3>
                <table className={actionStyles.evidence}>
                    <thead><tr><th>Bucket</th><th>Recorded</th><th>Reduction</th></tr></thead>
                    <tbody>{movedBucketSummaries.map(item => <tr key={item.label}>
                        <td>{item.label}</td><td>{money(item.recorded)}</td><td>{pct1(item.pct)}</td>
                    </tr>)}</tbody>
                </table>
            </section>
            {movedGroupSummaries.length > 0 && <details className={actionStyles.section}>
                <summary>Asset-class breakdown</summary>
                <table className={actionStyles.evidence}>
                    <thead><tr><th>Asset class</th><th>Recorded</th><th>Reduction</th></tr></thead>
                    <tbody>{movedGroupSummaries.map(item => <tr key={item.id}>
                        <td>{item.label}</td><td>{money(item.recorded)}</td><td>{pct1(item.reductionPct)}</td>
                    </tr>)}</tbody>
                </table>
            </details>}
            <div className={actionStyles.section}>
                <button type="button" onClick={markStage1Complete}
                    disabled={reviewStageSaving || !stage1ReadyToComplete}
                    data-testid="risk-confirm-reserve-move" className={actionStyles.button}>
                    {reviewStageSaving ? 'Saving adjustment...' : 'Confirm reserve move'}
                </button>{' '}
                <button type="button" onClick={reopenReduceStage} disabled={reviewStageSaving}
                    className={actionStyles.button}>Back to adjustments</button>
            </div>
            {reviewStageSaveError && <p role="alert" className={actionStyles.error}>{reviewStageSaveError}</p>}
        </ActionsWorkspaceRail>
    );
}

if (!signalAdjustmentOpen) {
    return (
        <aside className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-card/35 p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <AdjustmentInbox
                title="Active Actions"
                items={adjustmentInboxItems}
            />
        </aside>
    );
}

return (
    <>
    {renderReviewReopenConfirmModal()}
    <ActionsWorkspaceRail items={adjustmentInboxItems}
        stages={reviewNoForcedMove ? [] : reviewStageRailItems}
        title={reviewNoForcedMove ? allocationAvailableValue > 1 ? 'Additional capacity available' : 'No adjustment required'
            : reserveConfirmed ? 'Adjustment complete'
            : statementReviewMode ? statementVarianceActive ? 'Review statement differences' : 'Waiting for a broker statement'
            : isQ4DReviewSignal ? 'Record position reductions'
            : signalCutPct > 0 ? `Reduce Q1 by ${compactPct(signalCutPct)}` : 'Reduce Q1 to target'}
        tone={reserveConfirmed ? 'success' : statementVarianceActive ? 'warning' : 'neutral'}
        description={reviewNoForcedMove
            ? allocationAvailableValue > 1 ? 'Q3 permits a higher Q1 allocation. A portfolio shape review is optional; no reserve move is required.'
                : 'Current exposure is within the permitted range. No position adjustment is required.'
            : reserveConfirmed ? 'Reserve cash has been confirmed by the broker statement.'
            : statementReviewMode ? 'Execution is recorded and locked. A later broker statement must verify the reserve movement.'
            : isQ4DReviewSignal
                ? 'Reduce the affected asset classes into reserve. Stock amounts are proportional guides; the class requirement remains authoritative.'
                : `Q1 exposure target: ${compactPct(q3DetectorTargetPct)}.`}
    >
        {statementReviewMode ? (
            <section className={actionStyles.section}>
                <h3>Reserve verification</h3>
                <ActionMetrics label="Reserve verification" values={[
                    { label: 'Expected', value: money(statementReserveExpected) },
                    { label: 'Statement', value: money(statementReserveImported) },
                    { label: 'Difference', value: signedMoney(statementReserveVariance), tone: statementVarianceActive ? 'warning' : undefined },
                ]} />
                <p>{latestImportAt ? `Last import: ${formatRegimeDateTime(latestImportAt)}` : 'Import timestamp unavailable.'}</p>
                {statementVarianceActive && <>
                    <p>The imported reserve does not match. Review the differences before reopening the recorded actions.</p>
                    <button type="button" onClick={() => setReviewReopenConfirmOpen(true)}
                        disabled={reviewStageSaving} className={actionStyles.button}>Review and reopen</button>
                </>}
            </section>
        ) : !reviewNoForcedMove && !reserveConfirmed ? (
            <section className={actionStyles.section}>
                <h3>Portfolio reductions</h3>
                <ActionMetrics label="Portfolio reduction totals" values={[
                    { label: 'Required', value: money(requiredReduction) },
                    { label: 'Recorded', value: money(stage1DisplayMove) },
                    { label: 'Remaining', value: money(stage1RemainingMove) },
                ]} />
                <div className={actionStyles.progress} role="progressbar" aria-label="Reductions recorded"
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={planProgress}>
                    <div style={{ width: `${planProgress}%` }} />
                </div>
            </section>
        ) : null}

        {!statementReviewMode && !reserveConfirmed && (
            <details className={actionStyles.section}>
                <summary>{isQ4DReviewSignal ? 'Q4 exposure rule' : 'Q3 exposure rule'}</summary>
                <p>{isQ4DReviewSignal ? `Market exposure target ${pct0(q4CrisisTargetPct)}`
                    : `Q1 exposure target ${pct1(q3DetectorTargetPct)}`}</p>
                <ActionMetrics label="Exposure reductions" values={[
                    { label: 'Q1 reduction', value: pct1(displayedSignalPct) },
                    { label: 'Defensive', value: pct1(q1DefensiveSignalCutPct) },
                    { label: 'Exempt', value: pct1(q1ExemptSignalCutPct) },
                ]} />
            </details>
        )}

        {reviewNoForcedMove && allocationAvailableValue > 1 && (
            <div className={actionStyles.section}>
                <button type="button" onClick={reviewPortfolioShape} className={actionStyles.button}>Review portfolio shape</button>{' '}
                <button type="button" onClick={markSignalReviewed} disabled={reviewStageSaving}
                    className={actionStyles.button}>{reviewStageSaving ? 'Saving...' : 'Mark reviewed'}</button>
            </div>
        )}

        {reviewRecoveryContext && !reviewNoForcedMove && !statementReviewMode && !reductionRecorded && activeReviewStage === 'reduce' && (
            <section className={actionStyles.section}>
                <h3>Unconfirmed reserve movement</h3>
                <p>{money(reviewRecoveryContext.reserveShortfall)} remains unconfirmed. The outstanding adjustments have been restored.</p>
                <ActionMetrics label="Restored adjustments" values={[
                    { label: 'Restored', value: money(reviewRecoveryContext.restoredCutTotal) },
                    { label: 'Statement reserve', value: money(reviewRecoveryContext.importedReserveValue) },
                ]} />
            </section>
        )}

        {!reviewNoForcedMove && !statementReviewMode && !reductionRecorded && showSelectedContextCard && activeReviewStage === 'reduce' && (
            <section className={actionStyles.section}>
                <h3>{selectedContext.label}</h3>
                <p>{selectedContext.level}</p>
                <ActionMetrics label="Selected reduction requirement" values={[
                    { label: 'Required', value: money(selectedContext.requiredMoveValue) },
                    { label: 'Recorded', value: money(selectedContext.plannedMoveValue) },
                    { label: 'Remaining', value: money(selectedContext.remainingMoveValue) },
                ]} />
            </section>
        )}
        {reviewStageSaveError && <p role="alert" className={actionStyles.error}>{reviewStageSaveError}</p>}
    </ActionsWorkspaceRail>
        {showReviewBottomDock && (
            <footer className="review-dock">
                <div className="review-dock-main">
                    <div className="review-dock-left">
                        <span>
                            <span className="review-dock-label-strong">
                                Draft
                            </span>{' '}
                            {reviewDraftStatusText.replace(
                                /^Draft\s+/i,
                                '',
                            )}
                        </span>
                        <span>
                            <span className="review-dock-label">
                                Recorded
                            </span>{' '}
                            <strong
                                className="font-mono"
                                data-testid="risk-dock-recorded"
                            >
                                {money(stage1DisplayMove)}
                            </strong>
                        </span>
                        <span>
                            <span className="review-dock-label">
                                Remaining
                            </span>{' '}
                            <strong
                                className={`font-mono ${
                                    stage1RemainingMove > 1
                                        ? 'text-sky-200'
                                        : 'text-emerald-200'
                                }`}
                                data-testid="risk-dock-remaining"
                            >
                                {money(stage1RemainingMove)}
                            </strong>
                        </span>
                            <span>
                                <span className="review-dock-label">
                                    Cash after draft
                                </span>{' '}
                                <strong
                                    className="font-mono text-emerald-200"
                                    data-testid="risk-dock-cash-after-draft"
                                >
                                    {money(draftReserveAfter)}
                            </strong>
                        </span>
                        {reviewStageSaveError && (
                            <span className="review-dock-error">
                                {reviewStageSaveError}
                            </span>
                        )}
                    </div>
                </div>
                <div
                    className={`review-dock-progress ${
                        stage1Overplanned
                            ? 'review-dock-progress-over'
                            : stage1ReadyToComplete
                              ? 'review-dock-progress-ready'
                              : ''
                    }`}
                >
                    <div
                        className="review-dock-progress-fill"
                        style={{ width: `${planProgress}%` }}
                    />
                </div>
                <div className="review-dock-actions">
                    <button
                        type="button"
                        onClick={clearReviewDraft}
                        disabled={!hasDraftCuts && !reviewDraftSavedAt}
                        data-testid="risk-clear-draft"
                        className="review-dock-button review-dock-button-ghost review-dock-button-danger"
                    >
                        Clear
                    </button>
                    <button
                        type="button"
                        onClick={saveReviewDraft}
                        disabled={!hasDraftCuts}
                        data-testid="risk-save-draft"
                        className="review-dock-button review-dock-button-ghost"
                    >
                        Save Draft
                    </button>
                    <button
                        type="button"
                        onClick={markStage1Complete}
                        disabled={!stage1ReadyToComplete}
                        data-testid="risk-review-totals"
                        className="review-dock-button review-dock-button-primary"
                    >
                        Review Totals
                    </button>
                </div>
            </footer>
        )}
    </>
);

}
