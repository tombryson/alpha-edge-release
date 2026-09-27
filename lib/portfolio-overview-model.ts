import type { PortfolioMixRow } from './api';
import { normalizeAssetClassCode } from './asset-class';

export const PORTFOLIO_TARGET_TOLERANCE_PP = 0.5;

export function comparePortfolioReferenceOrder(
    a: { code: string; current: number; target: number | null },
    b: { code: string; current: number; target: number | null },
    hasApproved: boolean,
): number {
    // Market movement must not reorder the approved reference.
    return (hasApproved ? (b.target ?? 0) - (a.target ?? 0) : b.current - a.current)
        || a.code.localeCompare(b.code);
}

export function joinPortfolioShapeRows(
    currentRows: PortfolioMixRow[],
    approvedRows: PortfolioMixRow[],
    hasApproved: boolean,
) {
    const current = new Map(currentRows.map(row => [normalizeAssetClassCode(row.asset_class), row]));
    const approved = new Map((hasApproved ? approvedRows : []).map(row => [normalizeAssetClassCode(row.asset_class), row]));
    return [...new Set([...approved.keys(), ...current.keys()])].map(code => {
        const held = current.get(code);
        const reference = approved.get(code);
        const row = reference ?? held!;
        const currentPct = held?.weight_pct ?? 0;
        const target = reference?.weight_pct ?? null;
        const delta = target === null ? null : currentPct - target;
        return {
            code,
            assetClassCode: row.asset_class,
            name: row.display_name,
            value: held?.value ?? 0,
            current: currentPct,
            target,
            delta,
            absDelta: delta === null ? 0 : Math.abs(delta),
            status: classifyPortfolioDifference(currentPct, target),
            governedByQ1: row.governed_by_q1,
        };
    }).filter(row => row.current > 0 || (row.target ?? 0) > 0)
        .sort((a, b) => comparePortfolioReferenceOrder(a, b, hasApproved));
}

export type PortfolioDifferenceState =
    | 'over'
    | 'under'
    | 'inline'
    | 'no-target';

export type PortfolioImplementationState = {
    key:
        | 'above'
        | 'available'
        | 'constrained'
        | 'suspended'
        | 'inline'
        | 'unassessed'
        | 'none'
        | 'stale';
    label: string;
    deployablePp: number;
};

export function classifyPortfolioDifference(
    currentPct: number,
    targetPct: number | null,
    tolerancePp = PORTFOLIO_TARGET_TOLERANCE_PP,
): PortfolioDifferenceState {
    if (targetPct === null) return 'no-target';
    const difference = currentPct - targetPct;
    if (Math.abs(difference) < tolerancePp) return 'inline';
    return difference > 0 ? 'over' : 'under';
}

export function estimatePortfolioRebalanceTurnover(
    rows: Array<{ currentPct: number; targetPct: number | null }>,
): number {
    return rows.reduce(
        (sum, row) =>
            sum +
            (row.targetPct === null
                ? 0
                : Math.abs(row.currentPct - row.targetPct)),
        0,
    ) / 2;
}

export function derivePortfolioImplementationState({
    differenceState,
    differencePp,
    riskMode,
    stale,
    isReserve,
    actualInvestedPct,
    allowedInvestedPct,
}: {
    differenceState: PortfolioDifferenceState;
    differencePp: number | null;
    riskMode?: string | null;
    stale?: boolean;
    isReserve?: boolean;
    actualInvestedPct?: number | null;
    allowedInvestedPct?: number | null;
}): PortfolioImplementationState {
    if (stale) {
        return {
            key: 'stale',
            label: 'Awaiting current portfolio data',
            deployablePp: 0,
        };
    }
    if (differenceState === 'no-target' || differencePp === null) {
        return { key: 'none', label: 'No approved target', deployablePp: 0 };
    }
    if (differenceState === 'over') {
        return {
            key: 'above',
            label: 'Above approved target',
            deployablePp: 0,
        };
    }
    if (differenceState === 'inline') {
        return {
            key: 'inline',
            label: 'Within target tolerance',
            deployablePp: 0,
        };
    }
    if (isReserve) {
        return {
            key: 'constrained',
            label: 'Below reserve floor · not deployable',
            deployablePp: 0,
        };
    }
    if (riskMode === 'Q4_CRISIS') {
        return {
            key: 'suspended',
            label: 'Below target · new deployment suspended',
            deployablePp: 0,
        };
    }
    if (
        actualInvestedPct === undefined ||
        actualInvestedPct === null ||
        allowedInvestedPct === undefined ||
        allowedInvestedPct === null
    ) {
        return {
            key: 'unassessed',
            label: 'Below target · capacity not assessed',
            deployablePp: 0,
        };
    }

    const shortfall = Math.max(0, -differencePp);
    const deployablePp = Math.max(
        0,
        Math.min(shortfall, allowedInvestedPct - actualInvestedPct),
    );
    if (
        riskMode === 'Q3_THROTTLE' ||
        deployablePp < shortfall - 0.05
    ) {
        return {
            key: 'constrained',
            label:
                deployablePp > 0
                    ? `Below target · ${deployablePp.toFixed(1)}pp permitted`
                    : 'Below target · deployment constrained',
            deployablePp,
        };
    }
    return {
        key: 'available',
        label: 'Below target · capacity available',
        deployablePp,
    };
}
