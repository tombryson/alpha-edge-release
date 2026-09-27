import { subscribePoll } from '@/lib/polling';
import {
    useState,
    useEffect,
    useCallback,
    useRef,
    type Dispatch,
    type SetStateAction,
    type MutableRefObject,
} from 'react';
import {
    api,
    type PortfolioMixCurrentResponse,
    type PortfolioMixSnapshotResponse,
    type PortfolioRebalancePlan,
    type AdjustmentPlan,
    type PortfolioRebalancePlanRow,
} from '@/lib/api';
import type { AdjustmentSource, PortfolioTargetBarDrag, PortfolioTargetBarEditor, TabType } from '@/components/stock-table/types';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import { type PortfolioRebalanceWorkflowStage } from '@/lib/workflow-stages';

// ── Module-level pure helpers ──────────────────────────────────────────────────

function getOrdinalSuffix(day: number): string {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

export function formatPortfolioTargetDate(date = new Date()): string {
    const month = new Intl.DateTimeFormat('en-AU', { month: 'long' }).format(date);
    const day = date.getDate();
    return `${month} ${day}${getOrdinalSuffix(day)} ${date.getFullYear()}`;
}

export function getDefaultPortfolioTargetTitle(): string {
    return `New Portfolio Target - ${formatPortfolioTargetDate()}`;
}

/** Pure transform — exported for render-function call sites in stock-table.tsx */
export function buildPortfolioRebalanceRowsFromCurrent(
    mix: PortfolioMixCurrentResponse,
): PortfolioRebalancePlanRow[] {
    return [...(mix.rows || [])]
        .sort(
            (a, b) =>
                (a.display_order || 9999) - (b.display_order || 9999) ||
                a.display_name.localeCompare(b.display_name),
        )
        .map((row) => ({
            asset_class: row.asset_class,
            display_name: row.display_name,
            display_order: row.display_order,
            governed_by_q1: row.governed_by_q1,
            current_weight_pct: row.weight_pct || 0,
            target_weight_pct: row.weight_pct || 0,
            delta_weight_pct: 0,
            note: '',
        }));
}

// ── Return type ───────────────────────────────────────────────────────────────

export interface UsePortfolioRebalanceResult {
    // ── Portfolio target bar UI state ─────────────────────────────────────────
    portfolioTargetBarEditor: PortfolioTargetBarEditor;
    setPortfolioTargetBarEditor: Dispatch<SetStateAction<PortfolioTargetBarEditor>>;
    portfolioTargetBarLockedOrder: string[] | null;
    setPortfolioTargetBarLockedOrder: Dispatch<SetStateAction<string[] | null>>;
    portfolioTargetBarDragRef: MutableRefObject<PortfolioTargetBarDrag | null>;
    portfolioTargetDraftActive: boolean;
    setPortfolioTargetDraftActive: Dispatch<SetStateAction<boolean>>;
    portfolioRebalanceControlsOpen: boolean;
    setPortfolioRebalanceControlsOpen: Dispatch<SetStateAction<boolean>>;

    // ── Panel layout refs ─────────────────────────────────────────────────────
    portfolioRebalancePanelRef: MutableRefObject<HTMLElement | null>;
    portfolioTargetAlignmentRef: MutableRefObject<HTMLDivElement | null>;
    portfolioTargetAlignment: { offsets: Record<string, number>; height: number };
    setPortfolioTargetAlignment: Dispatch<
        SetStateAction<{ offsets: Record<string, number>; height: number }>
    >;

    // ── Core rebalance data state ─────────────────────────────────────────────
    portfolioMix: PortfolioMixCurrentResponse | null;
    setPortfolioMix: Dispatch<SetStateAction<PortfolioMixCurrentResponse | null>>;
    approvedPortfolioMix: PortfolioMixSnapshotResponse | null;
    setApprovedPortfolioMix: Dispatch<SetStateAction<PortfolioMixSnapshotResponse | null>>;
    portfolioRebalancePlan: PortfolioRebalancePlan | null;
    setPortfolioRebalancePlan: Dispatch<SetStateAction<PortfolioRebalancePlan | null>>;
    portfolioAdjustmentPlan: AdjustmentPlan | null;
    setPortfolioAdjustmentPlan: Dispatch<SetStateAction<AdjustmentPlan | null>>;
    portfolioRebalanceRows: PortfolioRebalancePlanRow[];
    setPortfolioRebalanceRows: Dispatch<SetStateAction<PortfolioRebalancePlanRow[]>>;
    portfolioRebalanceTitle: string;
    setPortfolioRebalanceTitle: Dispatch<SetStateAction<string>>;
    portfolioRebalanceSaving: boolean;
    setPortfolioRebalanceSaving: Dispatch<SetStateAction<boolean>>;
    portfolioRebalanceError: string | null;
    setPortfolioRebalanceError: Dispatch<SetStateAction<string | null>>;

    // ── Adjustment draft state ────────────────────────────────────────────────
    portfolioAdjustmentDraftSavedAt: string | null;
    setPortfolioAdjustmentDraftSavedAt: Dispatch<SetStateAction<string | null>>;
    portfolioSelectedStage: PortfolioRebalanceWorkflowStage | null;
    setPortfolioSelectedStage: Dispatch<SetStateAction<PortfolioRebalanceWorkflowStage | null>>;
    portfolioCashMoveInputs: Record<string, string>;
    setPortfolioCashMoveInputs: Dispatch<SetStateAction<Record<string, string>>>;
    portfolioReductionInputs: Record<number, string>;
    setPortfolioReductionInputs: Dispatch<SetStateAction<Record<number, string>>>;

    // ── Refs (exposed for callers that need them directly) ────────────────────
    portfolioCashMoveInputsRef: MutableRefObject<Record<string, string>>;
    portfolioReductionInputsRef: MutableRefObject<Record<number, string>>;
    portfolioAdjustmentDraftSavedAtRef: MutableRefObject<string | null>;
    portfolioRebalancePlanIdRef: MutableRefObject<number | null>;
    portfolioTargetDraftActiveRef: MutableRefObject<boolean>;

    // ── Loader callback ───────────────────────────────────────────────────────
    loadPortfolioRebalanceData: () => Promise<void>;

    // ── Module-level pure helpers re-exported for callers ────────────────────
    getDefaultPortfolioTargetTitle: () => string;
    formatPortfolioTargetDate: (date?: Date) => string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePortfolioRebalance(params: {
    activeTab: TabType;
    portfolioMode: string;
    positionsMode: string;
    activeAdjustmentSource: AdjustmentSource;
}): UsePortfolioRebalanceResult {
    const { activeTab, portfolioMode, positionsMode, activeAdjustmentSource } = params;

    // ── Portfolio target bar UI state ─────────────────────────────────────────
    const [portfolioTargetBarEditor, setPortfolioTargetBarEditor] =
        useState<PortfolioTargetBarEditor>(null);
    const [portfolioTargetBarLockedOrder, setPortfolioTargetBarLockedOrder] =
        useState<string[] | null>(null);
    const portfolioTargetBarDragRef = useRef<PortfolioTargetBarDrag | null>(null);
    const [portfolioTargetDraftActive, setPortfolioTargetDraftActive] =
        useState(false);
    const [portfolioRebalanceControlsOpen, setPortfolioRebalanceControlsOpen] =
        useState(false);

    // ── Panel layout refs ─────────────────────────────────────────────────────
    const portfolioRebalancePanelRef = useRef<HTMLElement | null>(null);
    const portfolioTargetAlignmentRef = useRef<HTMLDivElement | null>(null);
    const [portfolioTargetAlignment, setPortfolioTargetAlignment] = useState<{
        offsets: Record<string, number>;
        height: number;
    }>({ offsets: {}, height: 0 });

    // ── Core rebalance data state ─────────────────────────────────────────────
    const [portfolioMix, setPortfolioMix] =
        useState<PortfolioMixCurrentResponse | null>(null);
    const [approvedPortfolioMix, setApprovedPortfolioMix] =
        useState<PortfolioMixSnapshotResponse | null>(null);
    const [portfolioRebalancePlan, setPortfolioRebalancePlan] =
        useState<PortfolioRebalancePlan | null>(null);
    const [portfolioAdjustmentPlan, setPortfolioAdjustmentPlan] =
        useState<AdjustmentPlan | null>(null);
    const [portfolioRebalanceRows, setPortfolioRebalanceRows] = useState<
        PortfolioRebalancePlanRow[]
    >([]);
    const [portfolioRebalanceTitle, setPortfolioRebalanceTitle] = useState('');
    const [portfolioRebalanceSaving, setPortfolioRebalanceSaving] =
        useState(false);
    const [portfolioRebalanceError, setPortfolioRebalanceError] = useState<
        string | null
    >(null);

    // ── Adjustment draft state ────────────────────────────────────────────────
    const [portfolioAdjustmentDraftSavedAt, setPortfolioAdjustmentDraftSavedAt] =
        useState<string | null>(null);
    const [portfolioSelectedStage, setPortfolioSelectedStage] =
        useState<PortfolioRebalanceWorkflowStage | null>(null);
    const [portfolioCashMoveInputs, setPortfolioCashMoveInputs] = useState<
        Record<string, string>
    >({});
    const [portfolioReductionInputs, setPortfolioReductionInputs] = useState<
        Record<number, string>
    >({});

    // ── Refs ──────────────────────────────────────────────────────────────────
    const portfolioCashMoveInputsRef = useRef<Record<string, string>>({});
    const portfolioReductionInputsRef = useRef<Record<number, string>>({});
    const portfolioAdjustmentDraftSavedAtRef = useRef<string | null>(null);
    const portfolioRebalancePlanIdRef = useRef<number | null>(null);
    const portfolioTargetDraftActiveRef = useRef(false);

    // ── Ref-sync effects ──────────────────────────────────────────────────────
    useEffect(() => {
        portfolioTargetDraftActiveRef.current = portfolioTargetDraftActive;
    }, [portfolioTargetDraftActive]);
    useEffect(() => {
        portfolioCashMoveInputsRef.current = portfolioCashMoveInputs;
    }, [portfolioCashMoveInputs]);
    useEffect(() => {
        portfolioReductionInputsRef.current = portfolioReductionInputs;
    }, [portfolioReductionInputs]);
    useEffect(() => {
        portfolioAdjustmentDraftSavedAtRef.current = portfolioAdjustmentDraftSavedAt;
    }, [portfolioAdjustmentDraftSavedAt]);
    useEffect(() => {
        portfolioRebalancePlanIdRef.current = portfolioRebalancePlan?.id ?? null;
    }, [portfolioRebalancePlan?.id]);

    // ── buildPortfolioRebalanceRowsFromCurrent (stable ref for useCallback dep) ─
    // The pure version is exported at module scope; wrap in useCallback so
    // loadPortfolioRebalanceData's dep array stays stable.
    const buildRebalanceRowsFn = useCallback(buildPortfolioRebalanceRowsFromCurrent, []);

    // ── loadPortfolioRebalanceData ────────────────────────────────────────────

    const loadPortfolioRebalanceData = useCallback(async () => {
        try {
            const refreshWarnings: string[] = [];
            const [mix, planResponse, approvedMixResponse] = await Promise.all([
                api.getCurrentPortfolioMix().catch((error) => {
                    console.warn('[PORTFOLIO] Failed to load current holdings:', error);
                    refreshWarnings.push('Current holdings could not be refreshed. Saved approved weights remain available.');
                    return null;
                }),
                api.getCurrentPortfolioRebalance().catch((error) => {
                    console.warn(
                        '[PORTFOLIO] Failed to load current portfolio target:',
                        error,
                    );
                    refreshWarnings.push(
                        'The current target workflow could not be refreshed.',
                    );
                    return undefined;
                }),
                api.getApprovedPortfolioMix().catch((error) => {
                    console.warn(
                        '[PORTFOLIO] Failed to load approved portfolio mix:',
                        error,
                    );
                    refreshWarnings.push(
                        'The approved target could not be refreshed.',
                    );
                    return undefined;
                }),
            ]);
            setPortfolioMix(mix);
            if (approvedMixResponse !== undefined) {
                setApprovedPortfolioMix(approvedMixResponse);
            }
            if (!mix) {
                setPortfolioRebalanceError(refreshWarnings.join(' '));
                return;
            }
            if (!planResponse) {
                setPortfolioRebalanceError(refreshWarnings.join(' '));
                return;
            }
            const plan = planResponse.plan || null;
            let adjustmentPlan: AdjustmentPlan | null = null;
            if (plan) {
                try {
                    adjustmentPlan =
                        (await api.getCurrentPortfolioAdjustmentPlan()).plan || null;
                } catch (error) {
                    console.warn(
                        '[PORTFOLIO] Failed to load adjustment-plan adapter:',
                        error,
                    );
                    refreshWarnings.push(
                        'The target adjustment plan could not be refreshed.',
                    );
                }
            }
            setPortfolioRebalanceError(
                refreshWarnings.length > 0 ? refreshWarnings.join(' ') : null,
            );
            if (portfolioTargetDraftActiveRef.current) {
                setPortfolioRebalancePlan(null);
                setPortfolioAdjustmentPlan(null);
                return;
            }
            setPortfolioRebalancePlan(plan);
            setPortfolioAdjustmentPlan(adjustmentPlan);
            if (plan?.rows?.length) {
                setPortfolioTargetDraftActive(false);
                setPortfolioRebalanceRows(
                    plan.rows.map((row) => ({
                        ...row,
                        delta_weight_pct:
                            (row.target_weight_pct || 0) -
                            (row.current_weight_pct || 0),
                    })),
                );
                const persistedPortfolioDraft = (() => {
                    try {
                        const raw = localStorage.getItem(
                            'terminal-portfolio-adjustment-draft',
                        );
                        if (!raw) return null;
                        const parsed = JSON.parse(raw);
                        return parsed?.planId === plan.id ? parsed : null;
                    } catch {
                        localStorage.removeItem(
                            'terminal-portfolio-adjustment-draft',
                        );
                        return null;
                    }
                })();
                const recordedMoveInputs = plan.rows.reduce<Record<string, string>>(
                    (acc, row) => {
                        const value = row.recorded_move_value || 0;
                        if (value > 0) {
                            acc[normalizeAssetClassCode(row.asset_class)] =
                                String(Math.round(value));
                        }
                        return acc;
                    },
                    {},
                );
                if (plan.status === 'COMPLETED' || plan.status === 'APPROVED') {
                    localStorage.removeItem(
                        'terminal-portfolio-adjustment-draft',
                    );
                    setPortfolioReductionInputs({});
                    setPortfolioAdjustmentDraftSavedAt(null);
                } else if (persistedPortfolioDraft) {
                    setPortfolioCashMoveInputs(
                        persistedPortfolioDraft.cashMoveInputs || {},
                    );
                    setPortfolioReductionInputs(
                        persistedPortfolioDraft.reductionInputs || {},
                    );
                    setPortfolioAdjustmentDraftSavedAt(
                        persistedPortfolioDraft.savedAt || null,
                    );
                } else {
                    const hasLocalPortfolioDraft =
                        portfolioAdjustmentDraftSavedAtRef.current != null ||
                        Object.values(portfolioCashMoveInputsRef.current).some(
                            (value) => {
                                const numericValue = Number.parseFloat(value);
                                return (
                                    Number.isFinite(numericValue) &&
                                    numericValue > 0
                                );
                            },
                        ) ||
                        Object.values(portfolioReductionInputsRef.current).some(
                            (value) => {
                                const numericValue = Number.parseFloat(value);
                                return (
                                    Number.isFinite(numericValue) &&
                                    numericValue > 0
                                );
                            },
                        );
                    const samePlanIsLoaded =
                        portfolioRebalancePlanIdRef.current === plan.id;
                    if (!samePlanIsLoaded || !hasLocalPortfolioDraft) {
                        setPortfolioCashMoveInputs(recordedMoveInputs);
                        setPortfolioReductionInputs({});
                        setPortfolioAdjustmentDraftSavedAt(null);
                    }
                }
                setPortfolioRebalanceTitle(plan.title || '');
            } else if (portfolioTargetDraftActiveRef.current) {
                setPortfolioRebalancePlan(null);
                setPortfolioAdjustmentPlan(null);
            } else {
                setPortfolioAdjustmentPlan(null);
                setPortfolioCashMoveInputs({});
                setPortfolioReductionInputs({});
                setPortfolioAdjustmentDraftSavedAt(null);
                setPortfolioRebalanceRows(buildRebalanceRowsFn(mix));
                setPortfolioRebalanceTitle(getDefaultPortfolioTargetTitle());
            }
        } catch (error) {
            console.error('[PORTFOLIO] Failed to load rebalance data:', error);
            setPortfolioRebalanceError(
                error instanceof Error
                    ? error.message
                    : 'Failed to load portfolio rebalance data',
            );
        }
    }, [buildRebalanceRowsFn]);

    // ── Polling effect ────────────────────────────────────────────────────────

    useEffect(() => {
        const shouldLoadPortfolioRebalance =
            activeTab === 'PORTFOLIO' ||
            activeTab === 'POSITIONS';
        if (!shouldLoadPortfolioRebalance) return;
        return subscribePoll(loadPortfolioRebalanceData, 30000);
    }, [
        activeAdjustmentSource,
        activeTab,
        loadPortfolioRebalanceData,
        portfolioMode,
        positionsMode,
    ]);

    // ── Result ────────────────────────────────────────────────────────────────

    return {
        // Portfolio target bar UI
        portfolioTargetBarEditor, setPortfolioTargetBarEditor,
        portfolioTargetBarLockedOrder, setPortfolioTargetBarLockedOrder,
        portfolioTargetBarDragRef,
        portfolioTargetDraftActive, setPortfolioTargetDraftActive,
        portfolioRebalanceControlsOpen, setPortfolioRebalanceControlsOpen,
        // Panel layout refs
        portfolioRebalancePanelRef,
        portfolioTargetAlignmentRef,
        portfolioTargetAlignment, setPortfolioTargetAlignment,
        // Core rebalance data
        portfolioMix, setPortfolioMix,
        approvedPortfolioMix, setApprovedPortfolioMix,
        portfolioRebalancePlan, setPortfolioRebalancePlan,
        portfolioAdjustmentPlan, setPortfolioAdjustmentPlan,
        portfolioRebalanceRows, setPortfolioRebalanceRows,
        portfolioRebalanceTitle, setPortfolioRebalanceTitle,
        portfolioRebalanceSaving, setPortfolioRebalanceSaving,
        portfolioRebalanceError, setPortfolioRebalanceError,
        // Adjustment draft
        portfolioAdjustmentDraftSavedAt, setPortfolioAdjustmentDraftSavedAt,
        portfolioSelectedStage, setPortfolioSelectedStage,
        portfolioCashMoveInputs, setPortfolioCashMoveInputs,
        portfolioReductionInputs, setPortfolioReductionInputs,
        // Refs
        portfolioCashMoveInputsRef,
        portfolioReductionInputsRef,
        portfolioAdjustmentDraftSavedAtRef,
        portfolioRebalancePlanIdRef,
        portfolioTargetDraftActiveRef,
        // Loader
        loadPortfolioRebalanceData,
        // Pure helpers
        getDefaultPortfolioTargetTitle,
        formatPortfolioTargetDate,
    };
}
