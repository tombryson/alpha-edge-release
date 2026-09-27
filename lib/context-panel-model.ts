import type { ETFAllocationLedgerRow, PortfolioHistoryEntry, PortfolioMixRow } from './api';
import { normalizeAssetClassCode } from './asset-class';
import { comparePortfolioReferenceOrder } from './portfolio-overview-model';

export const classKey = normalizeAssetClassCode;

export type ContextPanelView = 'security' | 'shape' | 'etf';
export type AllocationView = 'line' | 'map' | 'ring';

export function restorePanelView(value: unknown): ContextPanelView {
    return ['security', 'shape', 'etf'].includes(String(value)) ? value as ContextPanelView : 'etf';
}

export function restoreAllocationView(value: unknown): AllocationView {
    return value === 'map' || value === 'ring' ? value : 'line';
}

export const tickerKey = (value: string) => value.trim().toUpperCase();
export const tickerLeaf = (value: string) => tickerKey(value).split(':').pop() || '';

// Prefer the full exchange-qualified identity. Legacy bare symbols may resolve
// only when unique; never assign a Core policy to an ambiguous listing.
export function findByTicker<T>(rows: T[], ticker: string, read: (row: T) => string): T | undefined {
    if (!ticker.trim()) return undefined;
    const exact = rows.filter(row => tickerKey(read(row)) === tickerKey(ticker));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return undefined;
    const matches = rows.filter(row => tickerLeaf(read(row)) === tickerLeaf(ticker));
    if (matches.length !== 1) return undefined;
    if (ticker.includes(':') && read(matches[0]).includes(':')) return undefined;
    return matches[0];
}

export function etfTarget(row: ETFAllocationLedgerRow): number | null {
    if (!row.is_core || row.class_not_in_shape || row.asset_class_unassignable || row.class_target_value <= 0) return null;
    return Math.max(0, row.effective_target_value);
}

export function allocationFill(actual: number, target: number | null) {
    const held = Number.isFinite(actual) ? Math.max(0, actual) : 0;
    if (target === null || !Number.isFinite(target)) return { funded: 0, excess: 0, unknown: held > 0, ratio: null };
    const ceiling = Math.max(held, target, 1);
    return {
        funded: Math.min(held, Math.max(target, 0)) / ceiling * 100,
        excess: Math.max(held - Math.max(target, 0), 0) / ceiling * 100,
        unknown: false,
        ratio: target > 0 ? held / target : null,
    };
}

// Line chips keep one fixed scale: target at 80%, with 25% excess capacity.
export function allocationLineFill(actual: number, target: number | null) {
    const fill = allocationFill(actual, target);
    return {
        ...fill,
        funded: fill.ratio === null ? 0 : Math.min(fill.ratio, 1) * 80,
        excess: fill.ratio === null ? (fill.excess > 0 ? 20 : 0) : Math.min(Math.max(fill.ratio - 1, 0) * 80, 20),
    };
}

// A full ring is 100% funded. Red overlays the excess, capped at another 100%.
export function allocationRingFill(actual: number, target: number | null) {
    const fill = allocationFill(actual, target);
    return {
        funded: fill.ratio === null ? 0 : Math.min(fill.ratio, 1) * 100,
        excess: fill.ratio === null ? (fill.excess > 0 ? 100 : 0) : Math.min(Math.max(fill.ratio - 1, 0), 1) * 100,
        unknown: target === null || !Number.isFinite(target),
    };
}

export function allocationDifference(actual: number, target: number | null) {
    if (!Number.isFinite(actual) || target === null || !Number.isFinite(target) || target < 0) {
        return { amount: null, percentage: null };
    }
    const amount = actual - target;
    return { amount, percentage: target > 0 ? amount / target * 100 : amount === 0 ? 0 : null };
}

export function compareShapeRows(target: Pick<PortfolioMixRow, 'asset_class' | 'display_name' | 'weight_pct'>[], current: Pick<PortfolioMixRow, 'asset_class' | 'display_name' | 'weight_pct'>[]) {
    const rows = new Map<string, { code: string; name: string; target: number; current: number }>();
    for (const row of target) rows.set(row.asset_class, { code: row.asset_class, name: row.display_name, target: row.weight_pct, current: 0 });
    for (const row of current) {
        const existing = rows.get(row.asset_class);
        if (existing) existing.current = row.weight_pct;
        else rows.set(row.asset_class, { code: row.asset_class, name: row.display_name, target: 0, current: row.weight_pct });
    }
    return [...rows.values()].sort((a, b) => comparePortfolioReferenceOrder(
        { ...a, code: normalizeAssetClassCode(a.code) },
        { ...b, code: normalizeAssetClassCode(b.code) },
        target.length > 0,
    ));
}

export function approvedHistory(entries: PortfolioHistoryEntry[]) {
    return entries.filter(entry => entry.kind === 'shape' && ['APPROVED', 'SUPERSEDED'].includes(entry.status.toUpperCase()))
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}
