import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { postJson, apiBaseUrl } from './overlay-api';

export type PortfolioMixRow = {
    asset_class: string;
    display_name: string;
    display_order: number;
    governed_by_q1: boolean;
    weight_pct: number;
};

export type PortfolioMixResponse = {
    total_value: number;
    rows: PortfolioMixRow[];
};

export type PortfolioRebalancePlanRow = {
    asset_class: string;
    display_name: string;
    display_order: number;
    governed_by_q1: boolean;
    current_weight_pct: number;
    target_weight_pct: number;
    delta_weight_pct: number;
    recorded_move_value?: number;
    note?: string;
};

export type PortfolioRebalancePlan = {
    id: number;
    status: 'OPEN' | 'PARTIAL' | 'COMPLETED' | 'APPROVED' | 'SUPERSEDED';
    rows: PortfolioRebalancePlanRow[];
};

export type AdjustmentPlanRow = {
    key: string;
    label: string;
    current_weight_pct: number;
    target_weight_pct: number;
    direction: 'increase' | 'decrease' | 'hold';
    required_value: number;
    recorded_value: number;
    remaining_value: number;
    status: string;
};

export type PortfolioAdjustmentPlan = {
    id: string;
    source_id: number;
    stage: 'review_target' | 'action_positions' | 'confirm_statement' | 'complete';
    status: string;
    total_value: number;
    required_decrease_value: number;
    recorded_decrease_value: number;
    remaining_decrease_value: number;
    required_increase_value: number;
    tolerance_value: number;
    ready_to_confirm: boolean;
    rows: AdjustmentPlanRow[];
    import_validation?: {
        passed: boolean;
        variance_rows: number;
        total_abs_variance_value: number;
    } | null;
};

export const assertUatSafety = (): void => {
    expect(
        process.env.UAT_RESET_COMMAND || process.env.UAT_SQLITE_DB_PATH,
        'destructive workflow tests require UAT_RESET_COMMAND or UAT_SQLITE_DB_PATH',
    ).toBeTruthy();

    expect(
        /uat|127\.0\.0\.1|localhost/.test(apiBaseUrl),
        `refusing to run destructive workflow tests against non-UAT API: ${apiBaseUrl}`,
    ).toBe(true);
};

export const getCurrentPortfolioMix = async (
    request: APIRequestContext,
): Promise<PortfolioMixResponse> => {
    const response = await request.get(`${apiBaseUrl}/portfolio-mix/current`);
    expect(response.ok(), `/portfolio-mix/current failed: ${await response.text()}`).toBe(
        true,
    );
    return (await response.json()) as PortfolioMixResponse;
};

export const createPortfolioRebalance = async (
    request: APIRequestContext,
    rows: PortfolioRebalancePlanRow[],
): Promise<PortfolioRebalancePlan> => {
    const response = await postJson<{ plan: PortfolioRebalancePlan }>(
        request,
        '/portfolio-rebalances',
        {
            driver: 'UAT',
            title: 'UAT Portfolio Target',
            notes: 'Created by the destructive UAT action workflow suite.',
            rows,
        },
    );
    expect(response.plan).toBeTruthy();
    return response.plan;
};

export const getCurrentPortfolioAdjustmentPlan = async (
    request: APIRequestContext,
): Promise<PortfolioAdjustmentPlan> => {
    const response = await request.get(
        `${apiBaseUrl}/portfolio-rebalances/current/adjustment-plan`,
    );
    expect(
        response.ok(),
        `/portfolio-rebalances/current/adjustment-plan failed: ${await response.text()}`,
    ).toBe(true);
    const body = (await response.json()) as { plan: PortfolioAdjustmentPlan | null };
    expect(body.plan).toBeTruthy();
    return body.plan!;
};

export const completePortfolioRebalance = async (
    request: APIRequestContext,
    planId: number,
    rows: PortfolioRebalancePlanRow[],
): Promise<PortfolioRebalancePlan> => {
    const response = await postJson<{ plan: PortfolioRebalancePlan }>(
        request,
        `/portfolio-rebalances/${planId}/complete`,
        { rows },
    );
    expect(response.plan.status).toBe('COMPLETED');
    return response.plan;
};

export const approvePortfolioRebalance = async (
    request: APIRequestContext,
    planId: number,
): Promise<unknown> =>
    postJson(request, `/portfolio-rebalances/${planId}/approve`, {});

const adjustTarget = (
    rows: PortfolioRebalancePlanRow[],
    assetClass: string | string[],
    deltaPct: number,
) => {
    const candidates = Array.isArray(assetClass) ? assetClass : [assetClass];
    const row = rows.find((item) => candidates.includes(item.asset_class));
    expect(row, `missing ${candidates.join(' or ')} row in portfolio mix`).toBeTruthy();
    row!.target_weight_pct = Math.max(
        0,
        Math.round((row!.target_weight_pct + deltaPct) * 1000) / 1000,
    );
    row!.delta_weight_pct =
        Math.round((row!.target_weight_pct - row!.current_weight_pct) * 1000) /
        1000;
};

export const buildManualPortfolioTargetRows = (
    mix: PortfolioMixResponse,
): PortfolioRebalancePlanRow[] => {
    const rows = mix.rows.map((row) => ({
        asset_class: row.asset_class,
        display_name: row.display_name || row.asset_class,
        display_order: row.display_order,
        governed_by_q1: row.governed_by_q1,
        current_weight_pct: row.weight_pct || 0,
        target_weight_pct: row.weight_pct || 0,
        delta_weight_pct: 0,
        note: '',
    }));

    adjustTarget(rows, ['GOLD_MINERS', 'GOLD'], -5);
    adjustTarget(rows, 'TECHNOLOGY', -5);
    adjustTarget(rows, ['ENERGY_PRODUCERS', 'ENERGY'], 5);
    adjustTarget(rows, 'CASH', 5);

    return rows;
};

export const buildRecordedDecreaseRows = (
    plan: PortfolioAdjustmentPlan,
): PortfolioRebalancePlanRow[] =>
    plan.rows.map((row) => ({
        asset_class: row.key,
        display_name: row.label || row.key,
        display_order: 0,
        governed_by_q1: false,
        current_weight_pct: row.current_weight_pct,
        target_weight_pct: row.target_weight_pct,
        delta_weight_pct: row.target_weight_pct - row.current_weight_pct,
        recorded_move_value:
            row.direction === 'decrease' ? row.required_value : row.recorded_value,
    }));

export const targetWeightsFromAdjustmentPlan = (
    plan: PortfolioAdjustmentPlan,
): Record<string, number> =>
    plan.rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.key] = row.target_weight_pct;
        return acc;
    }, {});
