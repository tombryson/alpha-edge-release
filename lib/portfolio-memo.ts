import type {
    CouncilAnalysisJobResponse,
    CouncilAnalysisResultResponse,
    PortfolioMemoPersistPayload,
} from '@/lib/api';

export type PortfolioMemoMode = 'FAST' | 'DEEP';

export interface PortfolioMemoSummary {
    analysisDate?: string;
    primaryTheme?: string;
    secondaryTheme?: string;
    overallConviction?: string;
    executiveSummary?: string;
    analystMemoMarkdown?: string;
    chairmanMemoMarkdown?: string;
    assetClassTargets?: Array<Record<string, unknown>>;
}

export interface PortfolioMemoState {
    jobId: string;
    submissionId?: string;
    mode: PortfolioMemoMode;
    status: CouncilAnalysisJobResponse['status'] | 'submission_uncertain';
    stage?: string;
    stageMessage?: string;
    progressPct?: number;
    createdAt?: string;
    startedAt?: string;
    finishedAt?: string;
    runId?: string;
    error?: string;
    summary?: PortfolioMemoSummary;
}

const STORAGE_KEY = 'alpha-edge-portfolio-memo';

function asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, any>)
        : {};
}

function firstRecord(...values: unknown[]): Record<string, any> {
    for (const value of values) {
        const record = asRecord(value);
        if (Object.keys(record).length > 0) return record;
    }
    return {};
}

function firstArray(...values: unknown[]): Array<Record<string, unknown>> {
    for (const value of values) {
        if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    }
    return [];
}

export function loadPortfolioMemoState(): PortfolioMemoState | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as PortfolioMemoState;
    } catch {
        return null;
    }
}

export function savePortfolioMemoState(state: PortfolioMemoState | null): void {
    if (typeof window === 'undefined') return;
    try {
        if (!state) {
            window.localStorage.removeItem(STORAGE_KEY);
            return;
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Ignore localStorage errors.
    }
}

export function buildPortfolioMemoSummary(
    result: CouncilAnalysisResultResponse,
): PortfolioMemoSummary {
    const resultRecord = asRecord(result);
    const reportPacket = asRecord(resultRecord.report_packet);
    const run = asRecord(resultRecord.run);
    const labPayload = asRecord(reportPacket.lab_payload);
    const structuredData = firstRecord(
        labPayload.structured_data,
        reportPacket.structured_data,
        run.structured_data,
        resultRecord.structured_data,
        run.macro_positioning,
        resultRecord.macro_positioning,
    );
    const macroPositioning = firstRecord(
        structuredData.macro_positioning,
        run.macro_positioning,
        resultRecord.macro_positioning,
    );
    const summaryFields = firstRecord(
        reportPacket.summary_fields,
        run.summary_fields,
        resultRecord.summary_fields,
    );
    const allocatorCommentary = firstRecord(
        structuredData.allocator_commentary,
        run.allocator_commentary,
        resultRecord.allocator_commentary,
    );
    const memos = asRecord(reportPacket.memos);

    return {
        analysisDate:
            summaryFields.analysis_date ||
            structuredData.analysis_date ||
            result?.job?.finished_at ||
            '',
        primaryTheme: summaryFields.primary_theme || '',
        secondaryTheme: summaryFields.secondary_theme || '',
        overallConviction:
            allocatorCommentary.overall_conviction ||
            structuredData?.overall_conviction ||
            '',
        executiveSummary: structuredData?.executive_summary || '',
        analystMemoMarkdown:
            memos.analyst_memo_markdown ||
            run.analyst_memo_markdown ||
            resultRecord.analyst_memo_markdown ||
            '',
        chairmanMemoMarkdown:
            memos.chairman_memo_markdown ||
            run.chairman_memo_markdown ||
            resultRecord.chairman_memo_markdown ||
            '',
        assetClassTargets: firstArray(
            structuredData.asset_class_targets,
            macroPositioning.asset_class_targets,
            run.asset_class_targets,
            resultRecord.asset_class_targets,
        ),
    };
}

export function buildPortfolioMemoPersistPayload(
    result: CouncilAnalysisResultResponse,
    summary: PortfolioMemoSummary,
    mode: PortfolioMemoMode,
): PortfolioMemoPersistPayload {
    const resultRecord = asRecord(result);
    const run = asRecord(resultRecord.run);
    const jobRequest = asRecord(result.job?.request);
    return {
        memo_job_id: result.job.job_id,
        run_id: String(run.id || result.job.run_id || ''),
        mode,
        status: result.job.status,
        model: String(jobRequest.model || jobRequest.primary_model || ''),
        analysis_date: summary.analysisDate || '',
        primary_theme: summary.primaryTheme || '',
        secondary_theme: summary.secondaryTheme || '',
        overall_conviction: summary.overallConviction || '',
        executive_summary: summary.executiveSummary || '',
        analyst_memo_markdown: summary.analystMemoMarkdown || '',
        chairman_memo_markdown: summary.chairmanMemoMarkdown || '',
        asset_class_targets: summary.assetClassTargets || [],
        raw_result: result as unknown as Record<string, unknown>,
    };
}

export function buildPortfolioMemoPersistPayloadFromState(
    state: PortfolioMemoState,
): PortfolioMemoPersistPayload | null {
    if (!state.jobId || !state.summary) return null;
    return {
        memo_job_id: state.jobId,
        run_id: state.runId || '',
        mode: state.mode,
        status: state.status,
        analysis_date: state.summary.analysisDate || '',
        primary_theme: state.summary.primaryTheme || '',
        secondary_theme: state.summary.secondaryTheme || '',
        overall_conviction: state.summary.overallConviction || '',
        executive_summary: state.summary.executiveSummary || '',
        analyst_memo_markdown: state.summary.analystMemoMarkdown || '',
        chairman_memo_markdown: state.summary.chairmanMemoMarkdown || '',
        asset_class_targets: state.summary.assetClassTargets || [],
    };
}
