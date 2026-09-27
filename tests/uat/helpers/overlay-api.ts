import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Stage1SourceFixture } from '../fixtures/portfolio-states';

export const apiBaseUrl =
    process.env.UAT_API_BASE_URL || 'http://127.0.0.1:8081/api';

export type OverlaySellCandidate = {
    ticker: string;
    name: string;
    position_value: number;
};

export type OverlayAssetClassSummary = {
    asset_class: string;
    display_name?: string;
    delta_value?: number;
    sell_candidates?: OverlaySellCandidate[];
};

export type OverlaySummary = {
    effective_equity_pct?: number;
    last_applied_q1_exposure_pct?: number;
    signal_adjustment_ratio?: number;
    active_event_id?: number | null;
    active_event_from_q1_exposure_pct?: number | null;
    active_event_to_q1_exposure_pct?: number | null;
    portfolio_cash_bucket_value?: number;
    required_de_risk_value?: number;
    available_headroom_value?: number;
    active_event_status?: string | null;
    cash_confirmation_status?: string | null;
    reserve_variance?: number | null;
    stage1_required_reduction_value?: number;
    stage1_recorded_reduction_value?: number;
    stage1_baseline_reserve_value?: number;
    stage1_expected_reserve_value?: number;
    asset_classes?: OverlayAssetClassSummary[];
    q4_crisis?: {
        active?: boolean;
        reason?: string | null;
        target_equity_pct?: number;
    };
    portfolio_risk?: {
        mode?: string;
        priority?: number;
        target_pct?: number;
        target_kind?: string;
        inputs?: {
            q3?: {
                active?: boolean;
                effective_target_pct?: number | null;
            };
            q4?: {
                active?: boolean;
                target_pct?: number;
            };
        };
    };
};

export type EquitySizingResponse = {
    effective_pct?: number;
    sources?: Array<{
        source_ticker: string;
        target_equity_pct: number;
        last_updated?: string;
    }>;
    history?: Array<{
        id: number;
        source_ticker: string;
        target_equity_pct: number;
        received_at?: string;
    }>;
};

export type PortfolioRiskHeaderState = {
    q3: null | {
        target_pct: number;
        source: string;
        active: boolean;
        spx_target_pct?: number;
        /** @deprecated Use spx_target_pct. */
        spy_target_pct?: number;
        xao_target_pct?: number;
        last_applied_pct?: number;
    };
    q4: null | {
        active: boolean;
        reason?: string;
        target_equity_pct?: number;
    };
    baseline_mix?: {
        snapshot?: unknown;
        rows?: Array<{
            asset_class: string;
            display_name: string;
            weight_pct: number;
        }>;
    };
};

export type OverlayReconciliation = {
    cash_confirmation_status?: string | null;
    source_status?: string;
    asset_class_status?: string;
    overall_status?: string;
    import_received?: boolean;
    source_checks?: Array<{
        stock_name: string;
        ticker: string;
        asset_class: string;
        variance: number;
        status: string;
    }>;
    asset_class_checks?: Array<{
        asset_class: string;
        variance: number;
        status: string;
    }>;
};

export type Stage1Plan = {
    requiredReduction: number;
    recordedReduction: number;
    baselineReserve: number;
    expectedReserve: number;
    sources: Stage1SourceFixture[];
};

export const postJson = async <T>(
    request: APIRequestContext,
    path: string,
    data: unknown,
): Promise<T> => {
    const response = await request.post(`${apiBaseUrl}${path}`, { data });
    expect(response.ok(), `${path} failed: ${await response.text()}`).toBe(true);
    return (await response.json()) as T;
};

export const getJson = async <T>(
    request: APIRequestContext,
    path: string,
): Promise<T> => {
    const response = await request.get(`${apiBaseUrl}${path}`);
    expect(response.ok(), `${path} failed: ${await response.text()}`).toBe(true);
    return (await response.json()) as T;
};

export const getOverlaySummary = async (
    request: APIRequestContext,
): Promise<OverlaySummary> => {
    const response = await request.get(`${apiBaseUrl}/portfolio-overlay-summary`);
    expect(
        response.ok(),
        `/portfolio-overlay-summary failed: ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as OverlaySummary;
};

export const getEquitySizing = async (
    request: APIRequestContext,
): Promise<EquitySizingResponse> =>
    getJson<EquitySizingResponse>(request, '/equity-sizing');

export const getPortfolioRiskHeaderState = async (
    request: APIRequestContext,
): Promise<PortfolioRiskHeaderState> =>
    getJson<PortfolioRiskHeaderState>(request, '/portfolio-risk/header-state');

export const getOverlayReconciliation = async (
    request: APIRequestContext,
): Promise<OverlayReconciliation> => {
    const response = await request.get(
        `${apiBaseUrl}/portfolio-overlay/reconciliation`,
    );
    expect(
        response.ok(),
        `/portfolio-overlay/reconciliation failed: ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as OverlayReconciliation;
};

export const postQ1Signal = async (
    request: APIRequestContext,
    ticker: 'SPY' | 'SPX' | 'XAO',
    targetEquityPct: number,
): Promise<void> => {
    await postJson(request, '/webhook/regime', {
        ticker,
        signal: 'update',
        target_equity_pct: targetEquityPct,
        script: 'q3d',
    });
};

export const postQ4Signal = async (
    request: APIRequestContext,
    signal: 'SELL' | 'BUY',
): Promise<void> => {
    await postJson(request, '/webhook/regime', {
        ticker: 'Q4',
        signal,
        script: 'q4d',
    });
};

export const importStatement = async (
    request: APIRequestContext,
    payload: unknown,
): Promise<unknown> => postJson(request, '/statements/import', payload);

export const markSignalReviewed = async (
    request: APIRequestContext,
): Promise<unknown> =>
    postJson(request, '/portfolio-overlay/mark-reviewed', {});

export const buildStage1PlanFromSummary = (
    summary: OverlaySummary,
): Stage1Plan => {
    const sources: Stage1SourceFixture[] = [];

    for (const assetClass of summary.asset_classes || []) {
        let remaining = Math.max(0, Number(assetClass.delta_value || 0));
        if (remaining <= 0) continue;

        for (const candidate of assetClass.sell_candidates || []) {
            if (remaining <= 0.01) break;
            const amount = Math.min(
                remaining,
                Math.max(0, Number(candidate.position_value || 0)),
            );
            if (amount <= 0) continue;
            sources.push({
                ticker: candidate.ticker,
                stock_name: candidate.name,
                asset_class: assetClass.asset_class,
                amount_sold: amount,
            });
            remaining = Math.round((remaining - amount) * 100) / 100;
        }
    }

    const recordedReduction =
        Math.round(
            sources.reduce((sum, source) => sum + source.amount_sold, 0) * 100,
        ) / 100;
    const requiredReduction = Number(summary.required_de_risk_value || 0);
    const baselineReserve = Number(summary.portfolio_cash_bucket_value || 0);
    const expectedReserve =
        Math.round((baselineReserve + recordedReduction) * 100) / 100;

    return {
        requiredReduction,
        recordedReduction,
        baselineReserve,
        expectedReserve,
        sources,
    };
};

export const applyStage1Plan = async (
    request: APIRequestContext,
    plan: Stage1Plan,
): Promise<unknown> =>
    postJson(request, '/portfolio-overlay/apply-stage1', {
        required_reduction_value: plan.requiredReduction,
        recorded_reduction_value: plan.recordedReduction,
        baseline_reserve_value: plan.baselineReserve,
        expected_reserve_value: plan.expectedReserve,
        sources: plan.sources,
    });

export const saveStage2Targets = async (
    request: APIRequestContext,
    items: Array<{ asset_class: string; target_pct: number | null }>,
): Promise<unknown> =>
    postJson(request, '/portfolio-overlay/save-stage2', { items });

export const completeStage2 = async (
    request: APIRequestContext,
): Promise<unknown> => postJson(request, '/portfolio-overlay/complete-stage2', {});

export const acceptOverlayBaseline = async (
    request: APIRequestContext,
): Promise<unknown> =>
    postJson(request, '/portfolio-overlay/set-baseline', {});

export const reopenStage1 = async (
    request: APIRequestContext,
): Promise<unknown> =>
    postJson(request, '/portfolio-overlay/reopen-stage1', {});

export const preparePendingStage1 = async (
    request: APIRequestContext,
): Promise<{ summary: OverlaySummary; plan: Stage1Plan }> => {
    await postQ1Signal(request, 'SPY', 100);
    await postQ1Signal(request, 'XAO', 100);
    await postQ1Signal(request, 'SPY', 50);
    await postQ1Signal(request, 'XAO', 100);

    const summary = await getOverlaySummary(request);
    expect(Number(summary.required_de_risk_value || 0)).toBeGreaterThan(0);

    const plan = buildStage1PlanFromSummary(summary);
    const tolerance = Math.max(1000, plan.requiredReduction * 0.05);
    expect(
        Math.abs(plan.recordedReduction - plan.requiredReduction),
        'generated Stage 1 source plan must match the required reduction within execution tolerance',
    ).toBeLessThanOrEqual(tolerance);

    await applyStage1Plan(request, plan);
    return { summary, plan };
};
