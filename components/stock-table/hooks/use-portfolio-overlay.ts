import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { subscribePoll } from '@/lib/polling';
import {
    api,
    type PortfolioOverlaySummaryResponse,
    type PortfolioOverlayReconciliationResponse,
} from '@/lib/api';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import type { TabType } from '@/components/stock-table/types';

// ── Re-exported convenience types ─────────────────────────────────────────────

export type OverlayAssetClassRow =
    PortfolioOverlaySummaryResponse['asset_classes'][number];

export type OverlaySourceCheck =
    PortfolioOverlayReconciliationResponse['source_checks'][number];

export type OverlayAssetClassCheck =
    PortfolioOverlayReconciliationResponse['asset_class_checks'][number];

// ── Return type ───────────────────────────────────────────────────────────────

export interface UsePortfolioOverlayResult {
    // ── Raw state ─────────────────────────────────────────────────────────────
    overlaySummary: PortfolioOverlaySummaryResponse | null;
    /** Expose setter so callers can update after a POST sync without waiting for poll */
    setOverlaySummary: Dispatch<SetStateAction<PortfolioOverlaySummaryResponse | null>>;
    overlayReconciliation: PortfolioOverlayReconciliationResponse | null;

    // ── Regime sleeve expand state (belongs here — driven by overlay tab) ─────
    expandedRegimeSleeves: Record<string, boolean>;
    setExpandedRegimeSleeves: Dispatch<SetStateAction<Record<string, boolean>>>;

    // ── Derived from overlaySummary ────────────────────────────────────────────
    rawOverlayRows: OverlayAssetClassRow[];
    overlayRowsByCode: Map<string, OverlayAssetClassRow>;
    immutableReviewSignalCutRatio: number;
    reviewGoverningSource: string;
    portfolioRisk: PortfolioOverlaySummaryResponse['portfolio_risk'];
    portfolioRiskMode: string;
    q4Crisis: PortfolioOverlaySummaryResponse['q4_crisis'];
    q4CrisisActive: boolean;
    q4CrisisTargetPct: number;
    reviewAlertKind: 'q4d' | 'q3d';
    isQ4DReviewSignal: boolean;
    reviewSignalCopy: { eyebrow: string; title: string; badge: string };

    // ── Derived from overlaySummary (string status helpers) ──────────────────
    reviewActiveEventStatus: string;
    reviewCashConfirmationStatus: string;

    // ── Derived from overlayReconciliation ────────────────────────────────────
    reconciliationOverallStatus: string;
    reconciliationSourceStatus: string;
    reconciliationAssetClassStatus: string;
    sourceReconciliationByName: Map<string, OverlaySourceCheck>;
    assetClassReconciliationByCode: Map<string, OverlayAssetClassCheck>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePortfolioOverlay(
    activeTab: TabType,
): UsePortfolioOverlayResult {
    // ── State ─────────────────────────────────────────────────────────────────
    const [overlaySummary, setOverlaySummary] =
        useState<PortfolioOverlaySummaryResponse | null>(null);
    const [overlayReconciliation, setOverlayReconciliation] =
        useState<PortfolioOverlayReconciliationResponse | null>(null);
    const [expandedRegimeSleeves, setExpandedRegimeSleeves] = useState<
        Record<string, boolean>
    >({});

    // ── Effects ───────────────────────────────────────────────────────────────

    // Overlay summary — polls every 30 s on POSITIONS, PORTFOLIO, and ANALYSIS tabs.
    // ANALYSIS needs it to compute anchored class budgets for the Target Weight column.
    useEffect(() => {
        if (activeTab !== 'POSITIONS' && activeTab !== 'PORTFOLIO' && activeTab !== 'ANALYSIS') return;
        const load = async () => {
            try {
                const summary = await api.getPortfolioOverlaySummary();
                setOverlaySummary(summary || null);
            } catch (error) {
                console.error(
                    '[ALPHA EDGE] Failed to load portfolio overlay summary:',
                    error,
                );
                setOverlaySummary(null);
            }
        };
        return subscribePoll(load, 30_000);
    }, [activeTab]);

    // Overlay reconciliation — polls every 5 s on POSITIONS tab only
    useEffect(() => {
        if (activeTab !== 'POSITIONS') {
            setOverlayReconciliation(null);
            return;
        }
        const load = async () => {
            try {
                const reconciliation =
                    await api.getPortfolioOverlayReconciliation();
                setOverlayReconciliation(reconciliation || null);
            } catch {
                setOverlayReconciliation(null);
            }
        };
        return subscribePoll(load, 5_000);
    }, [activeTab]);

    // ── Derivations from overlaySummary ───────────────────────────────────────

    const rawOverlayRows: OverlayAssetClassRow[] =
        overlaySummary?.asset_classes || [];

    const overlayRowsByCode = new Map(
        rawOverlayRows.map((row) => {
            const code = normalizeAssetClassCode(
                row.asset_class || row.display_name,
            );
            return [code, row];
        }),
    );

    const immutableReviewSignalCutRatio = Math.max(
        0,
        Math.min(1, 1 - (overlaySummary?.signal_adjustment_ratio ?? 1)),
    );

    const reviewGoverningSource = String(
        overlaySummary?.active_event_governing_source ||
            overlaySummary?.governing_source ||
            '',
    ).toLowerCase();

    const portfolioRisk = overlaySummary?.portfolio_risk;
    const portfolioRiskMode = String(portfolioRisk?.mode || '').toUpperCase();
    const q4Crisis = overlaySummary?.q4_crisis;
    const q4CrisisActive =
        portfolioRiskMode === 'Q4_CRISIS' || Boolean(q4Crisis?.active);
    const q4CrisisTargetPct =
        portfolioRiskMode === 'Q4_CRISIS'
            ? (portfolioRisk?.target_pct ?? q4Crisis?.target_equity_pct ?? 10)
            : (q4Crisis?.target_equity_pct ?? 10);

    const reviewAlertKind: 'q4d' | 'q3d' =
        q4CrisisActive || reviewGoverningSource.includes('q4') ? 'q4d' : 'q3d';

    const isQ4DReviewSignal = reviewAlertKind === 'q4d';

    const reviewSignalCopy =
        reviewAlertKind === 'q3d'
            ? { eyebrow: 'Portfolio Risk', title: 'Q3 Detector', badge: 'risk' }
            : {
                  eyebrow: 'Portfolio Risk',
                  title:
                      portfolioRiskMode === 'Q4_CRISIS' || q4CrisisActive
                          ? 'Q4 Crisis'
                          : 'Q4 Detector',
                  badge: 'risk',
              };

    // ── Derived string statuses from overlaySummary ──────────────────────────

    const reviewActiveEventStatus = String(
        overlaySummary?.active_event_status || '',
    ).toUpperCase();
    const reviewCashConfirmationStatus = String(
        overlaySummary?.cash_confirmation_status || '',
    ).toUpperCase();

    // ── Derivations from overlayReconciliation ────────────────────────────────

    const reconciliationOverallStatus = String(
        overlayReconciliation?.overall_status || '',
    ).toUpperCase();
    const reconciliationSourceStatus = String(
        overlayReconciliation?.source_status || '',
    ).toUpperCase();
    const reconciliationAssetClassStatus = String(
        overlayReconciliation?.asset_class_status || '',
    ).toUpperCase();

    const sourceReconciliationByName = new Map(
        (overlayReconciliation?.source_checks || []).map(
            (check) => [check.stock_name.toLowerCase(), check] as const,
        ),
    );

    const assetClassReconciliationByCode = new Map(
        (overlayReconciliation?.asset_class_checks || []).map(
            (check) =>
                [normalizeAssetClassCode(check.asset_class), check] as const,
        ),
    );

    // ── Result ────────────────────────────────────────────────────────────────

    return {
        // Raw state
        overlaySummary,
        setOverlaySummary,
        overlayReconciliation,
        expandedRegimeSleeves,
        setExpandedRegimeSleeves,
        // Derived from overlaySummary
        rawOverlayRows,
        overlayRowsByCode,
        immutableReviewSignalCutRatio,
        reviewGoverningSource,
        portfolioRisk,
        portfolioRiskMode,
        q4Crisis,
        q4CrisisActive,
        q4CrisisTargetPct,
        reviewAlertKind,
        isQ4DReviewSignal,
        reviewSignalCopy,
        reviewActiveEventStatus,
        reviewCashConfirmationStatus,
        // Derived from overlayReconciliation
        reconciliationOverallStatus,
        reconciliationSourceStatus,
        reconciliationAssetClassStatus,
        sourceReconciliationByName,
        assetClassReconciliationByCode,
    };
}
