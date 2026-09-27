import {
    useState,
    useEffect,
    type Dispatch,
    type SetStateAction,
} from 'react';
import type {
    ReviewCashMovementRecord,
    ReviewFocus,
    ReviewRecoveryContext,
} from '@/components/stock-table/types';
import type { ReviewWorkflowStage } from '@/lib/workflow-stages';

// ── Return type ───────────────────────────────────────────────────────────────

export interface UsePortfolioReviewResult {
    reviewFocus: ReviewFocus | null;
    setReviewFocus: Dispatch<SetStateAction<ReviewFocus | null>>;
    reviewCutInputs: Record<number, string>;
    setReviewCutInputs: Dispatch<SetStateAction<Record<number, string>>>;
    reviewDraftSavedAt: string | null;
    setReviewDraftSavedAt: Dispatch<SetStateAction<string | null>>;
    reviewStage1CompletedAt: string | null;
    setReviewStage1CompletedAt: Dispatch<SetStateAction<string | null>>;
    reviewSelectedStage: ReviewWorkflowStage | null;
    setReviewSelectedStage: Dispatch<SetStateAction<ReviewWorkflowStage | null>>;
    reviewStageConfirmationOpen: boolean;
    setReviewStageConfirmationOpen: Dispatch<SetStateAction<boolean>>;
    reviewReopenConfirmOpen: boolean;
    setReviewReopenConfirmOpen: Dispatch<SetStateAction<boolean>>;
    reviewCashMovementRecord: ReviewCashMovementRecord | null;
    setReviewCashMovementRecord: Dispatch<
        SetStateAction<ReviewCashMovementRecord | null>
    >;
    reviewRecoveryContext: ReviewRecoveryContext | null;
    setReviewRecoveryContext: Dispatch<SetStateAction<ReviewRecoveryContext | null>>;
    reviewStageSaving: boolean;
    setReviewStageSaving: Dispatch<SetStateAction<boolean>>;
    reviewStageSaveError: string | null;
    setReviewStageSaveError: Dispatch<SetStateAction<string | null>>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePortfolioReview(params: {
    /** Pre-uppercased; drives the PENDING→reset effect. From usePortfolioOverlay. */
    reviewActiveEventStatus: string;
    /** Pre-uppercased; drives the CONFIRMED→clear effect. From usePortfolioOverlay. */
    reviewCashConfirmationStatus: string;
}): UsePortfolioReviewResult {
    const { reviewActiveEventStatus, reviewCashConfirmationStatus } = params;

    // ── State ─────────────────────────────────────────────────────────────────
    const [reviewFocus, setReviewFocus] = useState<ReviewFocus | null>(null);
    const [reviewCutInputs, setReviewCutInputs] = useState<Record<number, string>>(
        {},
    );
    const [reviewDraftSavedAt, setReviewDraftSavedAt] = useState<string | null>(
        null,
    );
    const [reviewStage1CompletedAt, setReviewStage1CompletedAt] = useState<
        string | null
    >(null);
    const [reviewSelectedStage, setReviewSelectedStage] =
        useState<ReviewWorkflowStage | null>(null);
    const [reviewStageConfirmationOpen, setReviewStageConfirmationOpen] =
        useState(false);
    const [reviewReopenConfirmOpen, setReviewReopenConfirmOpen] = useState(false);
    const [reviewCashMovementRecord, setReviewCashMovementRecord] =
        useState<ReviewCashMovementRecord | null>(null);
    const [reviewRecoveryContext, setReviewRecoveryContext] =
        useState<ReviewRecoveryContext | null>(null);
    const [reviewStageSaving, setReviewStageSaving] = useState(false);
    const [reviewStageSaveError, setReviewStageSaveError] = useState<
        string | null
    >(null);

    // ── Effect 1: load saved draft from localStorage on mount ─────────────────
    useEffect(() => {
        const saved = localStorage.getItem('terminal-review-draft');
        try {
            if (saved) {
                const parsed = JSON.parse(saved);
                setReviewCutInputs(parsed.cutInputs || {});
                setReviewDraftSavedAt(parsed.savedAt || null);
                setReviewStage1CompletedAt(parsed.stage1CompletedAt || null);
                setReviewCashMovementRecord(parsed.cashMovementRecord || null);
            }
            const recovery = localStorage.getItem('terminal-review-recovery');
            setReviewRecoveryContext(recovery ? JSON.parse(recovery) : null);
            localStorage.removeItem('terminal-review-adjustments-reopened');
        } catch (e) {
            console.error('[ALPHA EDGE] Failed to parse saved review draft:', e);
        }
    }, []);

    // ── Effect 2: when active_event_status → PENDING, reset stage to 'reduce' ─
    useEffect(() => {
        if (
            reviewStage1CompletedAt &&
            !reviewStageSaving &&
            reviewSelectedStage !== 'confirm_cash' &&
            reviewActiveEventStatus === 'PENDING'
        ) {
            const savedDraft = localStorage.getItem('terminal-review-draft');
            if (savedDraft) {
                try {
                    const parsed = JSON.parse(savedDraft);
                    localStorage.setItem(
                        'terminal-review-draft',
                        JSON.stringify({
                            ...parsed,
                            stage1CompletedAt: null,
                            cashMovementRecord: null,
                        }),
                    );
                } catch {
                    localStorage.removeItem('terminal-review-draft');
                }
            }
            setReviewStage1CompletedAt(null);
            setReviewCashMovementRecord(null);
            setReviewSelectedStage('reduce');
        }
    }, [
        reviewActiveEventStatus,
        reviewSelectedStage,
        reviewStage1CompletedAt,
        reviewStageSaving,
    ]);

    // ── Effect 3: when cash_confirmation_status → CONFIRMED, clear draft ──────
    useEffect(() => {
        if (reviewCashConfirmationStatus !== 'CONFIRMED' || reviewStageSaving) return;

        const hasLocalReductionState =
            Object.keys(reviewCutInputs).length > 0 ||
            Boolean(reviewStage1CompletedAt) ||
            Boolean(reviewCashMovementRecord) ||
            Boolean(reviewDraftSavedAt);
        if (!hasLocalReductionState) return;

        localStorage.removeItem('terminal-review-draft');
        localStorage.removeItem('terminal-review-recovery');
        setReviewCutInputs({});
        setReviewDraftSavedAt(null);
        setReviewStage1CompletedAt(null);
        setReviewStageConfirmationOpen(false);
        setReviewCashMovementRecord(null);
        setReviewRecoveryContext(null);
        setReviewSelectedStage('complete');
    }, [
        reviewCashConfirmationStatus,
        reviewCashMovementRecord,
        reviewCutInputs,
        reviewDraftSavedAt,
        reviewStage1CompletedAt,
        reviewStageSaving,
    ]);

    // ── Result ────────────────────────────────────────────────────────────────
    return {
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
    };
}
