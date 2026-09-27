import {
    useState,
    useEffect,
    useCallback,
    useRef,
    type Dispatch,
    type SetStateAction,
} from 'react';
import {
    api,
    apiFetch,
    type PortfolioMixCurrentResponse,
    type PortfolioOverlaySummaryResponse,
} from '@/lib/api';
import type { AssetClass } from '@/lib/api';
import { CouncilSubmissionUncertainError, isCouncilSubmissionUncertain, recoverCouncilSubmission } from '@/lib/council-submission';
import { prepareInvestmentPlays, type PortfolioInvestmentPlay } from '@/lib/portfolio-investment-plays';
import { prepareInvestmentBrief, type PortfolioInvestmentBrief } from '@/lib/portfolio-investment-brief';
import {
    buildPortfolioMemoSummary,
    loadPortfolioMemoState,
    savePortfolioMemoState,
    type PortfolioMemoState,
} from '@/lib/portfolio-memo';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import {
    buildPortfolioMemoTargetUniverse,
    getPortfolioTargetDisplayName,
    mapCurrentAssetClassToPortfolioTarget,
    mapOverlayAssetClassesForMemo,
    mapPortfolioTargetToCurrentAssetClass,
} from '@/lib/portfolio-target-taxonomy';
import { getDefaultPortfolioTargetTitle } from '@/components/stock-table/hooks/use-portfolio-rebalance';
import type { PortfolioRebalancePlan, PortfolioRebalancePlanRow } from '@/lib/api';
import type { PortfolioRebalanceWorkflowStage } from '@/lib/workflow-stages';

// ── Module-level pure helper ──────────────────────────────────────────────────

/** Pure transform — takes summary + sleeves, returns API job payload. No state deps. */
export function buildPortfolioMemoPayload(
    summary: PortfolioOverlaySummaryResponse,
    sleeves: AssetClass[],
    investmentPlays: PortfolioInvestmentPlay[] = [],
    investmentBrief: PortfolioInvestmentBrief = {},
) {
    const availableAssetClasses = buildPortfolioMemoTargetUniverse(sleeves);
    const positions = Array.isArray(summary.positions)
        ? summary.positions.map((position) => ({
              ticker: position.ticker || '',
              name: position.name || '',
              source_asset_class: position.asset_class || '',
              asset_class: mapCurrentAssetClassToPortfolioTarget(position.asset_class),
              value: position.value || 0,
              cash: position.cash || 0,
              portfolio_pct: position.portfolio_pct || 0,
              q1_governed: Boolean(position.q1_governed),
          }))
        : [];
    return {
        job_type: 'portfolio_positioning',
        query:
            'Analyse the current macro environment first, including rates, major commodity prices, Q1/Q2/Q3/Q4 regime fit, and major broker themes. Build an ideal asset-class portfolio using ranges, then compare it with the current asset-class percentages only and provide directional commentary with conviction.',
        ticker: '',
        company_name: '',
        template_id: null,
        company_type: null,
        exchange: '',
        stage1_only: false,
        stage2_revision_pass: 'on' as const,
        secondary_chairman_model: undefined,
        run_label: 'portfolio_positioning',
        diagnostic_mode: false,
        reuse_recent_bundle: false,
        reuse_supplementary_from_job_id: null,
        supplementary_mode: null,
        portfolio_positioning_mode: 'deep',
        portfolio_context: {
            mandate: prepareInvestmentBrief(investmentBrief),
            investment_plays: prepareInvestmentPlays(investmentPlays),
            as_of: new Date().toISOString(),
            portfolio: {
                total_value:
                    summary.total_portfolio_value || summary.portfolio_value || 0,
                cash_value: summary.portfolio_cash_bucket_value || 0,
                cash_pct: summary.portfolio_cash_bucket_pct || 0,
                holdings_count: positions.length,
            },
            overlay: {
                q1_exposure_pct: summary.effective_equity_pct || 0,
                last_applied_q1_exposure_pct: summary.last_applied_q1_exposure_pct || 0,
                status: summary.overlay_status || '',
                required_de_risk_pct: summary.required_de_risk_pct || 0,
                required_de_risk_value: summary.required_de_risk_value || 0,
                available_headroom_pct: summary.available_headroom_pct || 0,
                available_headroom_value: summary.available_headroom_value || 0,
                regime_cash_pct: summary.portfolio_cash_bucket_pct || 0,
                regime_cash_value: summary.portfolio_cash_bucket_value || 0,
            },
            available_asset_classes: availableAssetClasses,
            asset_classes: mapOverlayAssetClassesForMemo(summary.asset_classes || []),
            positions,
        },
        label: `Analysis (${new Date().toISOString().slice(0, 10)})`,
        analysis_date: '',
        is_synthetic: false,
    };
}

// ── Return type ───────────────────────────────────────────────────────────────

export interface UsePortfolioMemoResult {
    portfolioMemoState: PortfolioMemoState | null;
    setPortfolioMemoState: Dispatch<SetStateAction<PortfolioMemoState | null>>;
    portfolioMemoError: string | null;
    setPortfolioMemoError: Dispatch<SetStateAction<string | null>>;
    persistPortfolioMemoState: (next: PortfolioMemoState | null) => void;
    applyPortfolioMemoTargets: (
        memoSummary: PortfolioMemoState['summary'] | undefined,
    ) => void;
    runPortfolioMemo: (
        overlaySummary: PortfolioOverlaySummaryResponse,
        investmentPlays?: PortfolioInvestmentPlay[],
        investmentBrief?: PortfolioInvestmentBrief,
    ) => Promise<boolean>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePortfolioMemo(params: {
    /** Current mix rows — needed by applyPortfolioMemoTargets to merge targets */
    portfolioMixRows: PortfolioMixCurrentResponse['rows'] | null | undefined;
    // Rebalance setters that applyPortfolioMemoTargets cross-writes:
    setPortfolioRebalancePlan: Dispatch<SetStateAction<PortfolioRebalancePlan | null>>;
    setPortfolioTargetDraftActive: Dispatch<SetStateAction<boolean>>;
    setPortfolioSelectedStage: Dispatch<
        SetStateAction<PortfolioRebalanceWorkflowStage | null>
    >;
    setPortfolioCashMoveInputs: Dispatch<SetStateAction<Record<string, string>>>;
    setPortfolioReductionInputs: Dispatch<SetStateAction<Record<number, string>>>;
    setPortfolioRebalanceTitle: Dispatch<SetStateAction<string>>;
    setPortfolioRebalanceRows: Dispatch<SetStateAction<PortfolioRebalancePlanRow[]>>;
}): UsePortfolioMemoResult {
    const {
        portfolioMixRows,
        setPortfolioRebalancePlan,
        setPortfolioTargetDraftActive,
        setPortfolioSelectedStage,
        setPortfolioCashMoveInputs,
        setPortfolioReductionInputs,
        setPortfolioRebalanceTitle,
        setPortfolioRebalanceRows,
    } = params;

    // ── State ─────────────────────────────────────────────────────────────────
    const [portfolioMemoState, setPortfolioMemoState] =
        useState<PortfolioMemoState | null>(null);
    const [portfolioMemoError, setPortfolioMemoError] = useState<string | null>(null);
    const portfolioMemoMountedRef = useRef(true);
    const submissionInFlight = useRef(false);

    // ── persistPortfolioMemoState ─────────────────────────────────────────────
    const persistPortfolioMemoState = useCallback(
        (next: PortfolioMemoState | null) => {
            if (portfolioMemoMountedRef.current) {
                setPortfolioMemoState(next);
            }
            savePortfolioMemoState(next);
        },
        [],
    );

    // ── applyPortfolioMemoTargets ─────────────────────────────────────────────
    const applyPortfolioMemoTargets = useCallback(
        (memoSummary: PortfolioMemoState['summary'] | undefined) => {
            const targets = Array.isArray(memoSummary?.assetClassTargets)
                ? (memoSummary?.assetClassTargets ?? [])
                : [];
            if (targets.length === 0) {
                setPortfolioMemoError(
                    'AI analysis completed, but no asset-class target weights were returned.',
                );
                return;
            }

            type MemoTargetRow = {
                sourceAssetClass: string;
                displayName: string;
                targetWeight: number;
                currentWeight: number | null;
                rationale: string;
            };

            const byAssetClass = new Map<string, MemoTargetRow>();
            targets.forEach((target) => {
                const sourceAssetClass = String(
                    target.asset_class || target.display_name || '',
                );
                const assetClass = normalizeAssetClassCode(
                    mapPortfolioTargetToCurrentAssetClass(sourceAssetClass),
                );
                const targetWeight = Number(target.target_pct);
                if (!assetClass || !Number.isFinite(targetWeight)) return;

                const displayName =
                    getPortfolioTargetDisplayName(sourceAssetClass) ||
                    String(target.display_name || '').trim() ||
                    assetClass;
                const currentWeight = Number(target.current_pct);
                const rationale = String(target.rationale || '').trim();
                const existing = byAssetClass.get(assetClass);
                if (existing) {
                    existing.targetWeight += targetWeight;
                    if (!existing.displayName && displayName) {
                        existing.displayName = displayName;
                    }
                    if (rationale && !existing.rationale.includes(rationale)) {
                        existing.rationale = existing.rationale
                            ? `${existing.rationale}; ${rationale}`
                            : rationale;
                    }
                    return;
                }

                byAssetClass.set(assetClass, {
                    sourceAssetClass,
                    displayName,
                    targetWeight,
                    currentWeight: Number.isFinite(currentWeight) ? currentWeight : null,
                    rationale,
                });
            });

            if (byAssetClass.size === 0) {
                setPortfolioMemoError(
                    'AI analysis completed, but no usable asset-class target weights were returned.',
                );
                return;
            }

            setPortfolioRebalancePlan(null);
            setPortfolioTargetDraftActive(true);
            setPortfolioSelectedStage('target');
            setPortfolioCashMoveInputs({});
            setPortfolioReductionInputs({});
            setPortfolioRebalanceTitle(getDefaultPortfolioTargetTitle());
            setPortfolioRebalanceRows((prev) => {
                const seen = new Set<string>();
                const currentRowsByClass = new Map(
                    (portfolioMixRows || []).map((row) => [
                        normalizeAssetClassCode(row.asset_class),
                        row,
                    ]),
                );
                const next = prev
                    .map((row) => {
                        const key = normalizeAssetClassCode(row.asset_class);
                        const target = byAssetClass.get(key);
                        seen.add(key);
                        if (!target) {
                            const currentWeight = row.current_weight_pct || 0;
                            return {
                                ...row,
                                target_weight_pct: 0,
                                delta_weight_pct: -currentWeight,
                                note:
                                    row.note || 'Not included in the AI target mix.',
                            };
                        }
                        const targetWeight = target.targetWeight;
                        return {
                            ...row,
                            target_weight_pct: targetWeight,
                            delta_weight_pct: targetWeight - (row.current_weight_pct || 0),
                            note: target.rationale || row.note || '',
                        };
                    })
                    .filter(
                        (row) =>
                            Math.abs(row.current_weight_pct || 0) > 0.0001 ||
                            Math.abs(row.target_weight_pct || 0) > 0.0001,
                    );

                byAssetClass.forEach((target, key) => {
                    if (seen.has(key)) return;
                    const currentRow = currentRowsByClass.get(key);
                    const currentWeight = currentRow?.weight_pct ?? 0;
                    next.push({
                        asset_class: key,
                        display_name:
                            getPortfolioTargetDisplayName(target.sourceAssetClass) ||
                            target.displayName ||
                            currentRow?.display_name ||
                            key,
                        display_order: currentRow?.display_order ?? 9000 + next.length,
                        governed_by_q1: Boolean(currentRow?.governed_by_q1),
                        current_weight_pct: Number.isFinite(currentWeight)
                            ? currentWeight
                            : 0,
                        target_weight_pct: target.targetWeight,
                        delta_weight_pct:
                            target.targetWeight -
                            (Number.isFinite(currentWeight) ? currentWeight : 0),
                        note: target.rationale,
                    });
                });

                return next.sort(
                    (a, b) =>
                        (a.display_order || 9999) - (b.display_order || 9999) ||
                        a.display_name.localeCompare(b.display_name),
                );
            });
        },
        [
            portfolioMixRows,
            setPortfolioRebalancePlan,
            setPortfolioTargetDraftActive,
            setPortfolioSelectedStage,
            setPortfolioCashMoveInputs,
            setPortfolioReductionInputs,
            setPortfolioRebalanceTitle,
            setPortfolioRebalanceRows,
        ],
    );

    // ── pollPortfolioMemoJob ──────────────────────────────────────────────────
    const pollPortfolioMemoJob = useCallback(
        async (jobId: string) => {
            let consecutiveErrors = 0;
            while (portfolioMemoMountedRef.current) {
                try {
                    const job = await api.getCouncilAnalysisJob(jobId);
                    consecutiveErrors = 0;
                    const nextState: PortfolioMemoState = {
                        jobId: job.job_id,
                        mode: 'DEEP',
                        status: job.status,
                        stage: job.stage,
                        stageMessage: job.stage_message,
                        progressPct: job.progress_pct,
                        createdAt: job.created_at,
                        startedAt: job.started_at,
                        finishedAt: job.finished_at,
                        runId: job.run_id,
                        error: job.error || '',
                        summary:
                            portfolioMemoState?.jobId === job.job_id
                                ? portfolioMemoState.summary
                                : undefined,
                    };
                    persistPortfolioMemoState(nextState);

                    if (job.status === 'succeeded') {
                        const result = await api.getCouncilAnalysisResult(job.job_id);
                        const memoSummary = buildPortfolioMemoSummary(result);
                        const completeState = {
                            ...nextState,
                            status: result.job.status,
                            stage: result.job.stage,
                            stageMessage: result.job.stage_message,
                            progressPct: result.job.progress_pct,
                            runId:
                                (result.run?.id as string) ||
                                result.job.run_id ||
                                job.run_id,
                            summary: memoSummary,
                        };
                        persistPortfolioMemoState(completeState);
                        setPortfolioMemoError(null);
                        return;
                    }

                    if (job.status === 'failed') {
                        setPortfolioMemoError(
                            job.error || 'AI portfolio analysis failed',
                        );
                        return;
                    }

                    await new Promise((resolve) => setTimeout(resolve, 5000));
                } catch (error) {
                    consecutiveErrors += 1;
                    const message =
                        error instanceof Error
                            ? error.message
                            : 'Failed to poll AI portfolio analysis';
                    setPortfolioMemoError(message);
                    if (consecutiveErrors >= 4) {
                        persistPortfolioMemoState({
                            jobId,
                            mode: 'DEEP',
                            status: 'failed',
                            stage: 'polling',
                            stageMessage: 'Polling failed',
                            progressPct: 0,
                            error: message,
                            summary:
                                portfolioMemoState?.jobId === jobId
                                    ? portfolioMemoState.summary
                                    : undefined,
                        });
                        return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                }
            }
        },
        [
            persistPortfolioMemoState,
            portfolioMemoState?.jobId,
            portfolioMemoState?.summary,
        ],
    );

    // ── Mount effect: load saved state + resume in-flight job ─────────────────
    useEffect(() => {
        portfolioMemoMountedRef.current = true;
        const saved = loadPortfolioMemoState();
        const pendingKey = 'alpha-edge-council-submission:portfolio_positioning:portfolio';
        const pendingSubmissionId = localStorage.getItem(pendingKey);
        const submissionId = pendingSubmissionId || (!saved?.jobId ? saved?.submissionId : undefined);
        let active = true;
        if (submissionId) {
            persistPortfolioMemoState({ jobId: '', submissionId, mode: 'DEEP', status: 'submission_uncertain' });
            void recoverCouncilSubmission(apiFetch, submissionId).then(job => {
                if (!active || !portfolioMemoMountedRef.current) return;
                if (!job) {
                    persistPortfolioMemoState({ jobId: '', submissionId, mode: 'DEEP', status: 'submission_uncertain' });
                    return;
                }
                localStorage.removeItem(pendingKey);
                persistPortfolioMemoState({ jobId: job.job_id, submissionId, mode: 'DEEP', status: job.status });
                void pollPortfolioMemoJob(job.job_id);
            });
        } else if (saved) {
            if (
                saved.status === 'succeeded' &&
                saved.jobId &&
                !saved.summary?.assetClassTargets?.length
            ) {
                // A completed result is persisted with its summary. If the saved
                // state has none, the historical Council artifact is unavailable.
                // Remove the dead reference rather than leaving a permanent warning.
                persistPortfolioMemoState(null);
                setPortfolioMemoError(null);
            } else {
                setPortfolioMemoState(saved);
                if (saved.status === 'queued' || saved.status === 'running') {
                    void pollPortfolioMemoJob(saved.jobId);
                }
            }
        }
        return () => {
            active = false;
            portfolioMemoMountedRef.current = false;
        };
    }, []);

    // ── runPortfolioMemo ──────────────────────────────────────────────────────
    const runPortfolioMemo = useCallback(
        async (overlaySummary: PortfolioOverlaySummaryResponse, investmentPlays: PortfolioInvestmentPlay[] = [], investmentBrief?: PortfolioInvestmentBrief) => {
            if (submissionInFlight.current) return false;
            submissionInFlight.current = true;
            setPortfolioMemoError(null);
            try {
                const sleeves = await api.getAssetClasses();
                const brief = investmentBrief ?? await api.getPortfolioInvestmentBrief();
                const payload = buildPortfolioMemoPayload(overlaySummary, sleeves, investmentPlays, brief);
                const job = await api.createCouncilAnalysisJob(payload);
                persistPortfolioMemoState({
                    jobId: job.job_id,
                    mode: 'DEEP',
                    status: job.status,
                    stage: job.stage,
                    stageMessage: job.stage_message,
                    progressPct: job.progress_pct,
                    createdAt: job.created_at,
                    startedAt: job.started_at,
                    finishedAt: job.finished_at,
                    runId: job.run_id,
                    error: job.error || '',
                });
                void pollPortfolioMemoJob(job.job_id);
                return true;
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Failed to start AI portfolio analysis';
                setPortfolioMemoError(message);
                persistPortfolioMemoState({
                    jobId: '',
                    submissionId: error instanceof CouncilSubmissionUncertainError ? error.submissionId : undefined,
                    mode: 'DEEP',
                    status: isCouncilSubmissionUncertain(error) ? 'submission_uncertain' : 'failed',
                    stage: 'submit',
                    stageMessage: isCouncilSubmissionUncertain(error) ? 'Submission uncertain' : 'Submit failed',
                    progressPct: 0,
                    error: message,
                });
                return false;
            } finally {
                submissionInFlight.current = false;
            }
        },
        [persistPortfolioMemoState, pollPortfolioMemoJob],
    );

    // ── Result ────────────────────────────────────────────────────────────────
    return {
        portfolioMemoState,
        setPortfolioMemoState,
        portfolioMemoError,
        setPortfolioMemoError,
        persistPortfolioMemoState,
        applyPortfolioMemoTargets,
        runPortfolioMemo,
    };
}
