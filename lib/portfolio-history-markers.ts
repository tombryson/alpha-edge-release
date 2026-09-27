import { approvedShapeArchive, type ApprovedShape, type ShapeHistoryRecord } from './portfolio-shape-comparison';
import { getPortfolioAssetClassColor } from './portfolio-composition-colors';

export type PortfolioShapeConfirmation = {
    id: string;
    occurredAt: string;
    timeMs: number;
    snapshotId: number | null;
    label: string;
    source: string;
    shape: ApprovedShape;
    previousShape: ApprovedShape | null;
    demo?: boolean;
};

export function portfolioShapeMarkerLabel(confirmations: readonly PortfolioShapeConfirmation[]): string {
    const item = confirmations[confirmations.length - 1];
    if (!item) return '';
    if (confirmations.length > 1) return `${confirmations.length} ${item.demo ? 'demo shapes' : 'approvals'}`;
    return item.demo ? `Demo ${item.snapshotId ?? ''}`.trim()
        : item.snapshotId === null ? 'Approved' : `v${item.snapshotId}`;
}

/** Group neighbouring labels in screen space without changing their saved dates or shapes. */
export function groupPortfolioShapeConfirmations(
    confirmations: readonly PortfolioShapeConfirmation[],
    domain: readonly [number, number],
    plotWidth: number,
): PortfolioShapeConfirmation[][] {
    const ordered = [...confirmations].filter(item => Number.isFinite(item.timeMs))
        .sort((a, b) => a.timeMs - b.timeMs || (a.snapshotId ?? 0) - (b.snapshotId ?? 0) || a.id.localeCompare(b.id));
    const groups: PortfolioShapeConfirmation[][] = [];
    const span = domain[1] - domain[0];
    const width = Math.max(0, plotWidth);
    const labelWidth = (group: PortfolioShapeConfirmation[]) => Math.max(44, portfolioShapeMarkerLabel(group).length * 6 + 12);
    const x = (group: PortfolioShapeConfirmation[]) => {
        const projected = span > 0 ? (group[group.length - 1].timeMs - domain[0]) / span * width : 0;
        return Math.max(labelWidth(group) / 2, Math.min(projected, width - labelWidth(group) / 2));
    };
    for (const item of ordered) {
        groups.push([item]);
        while (groups.length > 1) {
            const current = groups[groups.length - 1];
            const previous = groups[groups.length - 2];
            if (x(current) - x(previous) >= (labelWidth(previous) + labelWidth(current)) / 2 + 10) break;
            previous.push(...current);
            groups.pop();
        }
    }
    return groups;
}

type PortfolioHistoryShapeSource = {
    id: string;
    kind: string;
    occurred_at: string;
    status: string;
    snapshot_id?: number | null;
    source?: string;
    rows?: ShapeHistoryRecord['rows'];
};

export function buildPortfolioShapeConfirmations(
    entries: PortfolioHistoryShapeSource[],
    minimumTimeMs: number | null = null,
    maximumTimeMs = Date.now(),
): PortfolioShapeConfirmation[] {
    const confirmations = new Map<string, PortfolioShapeConfirmation>();

    for (const entry of entries) {
        if (entry.kind !== 'shape') continue;
        const status = String(entry.status || '').toUpperCase();
        if (status !== 'APPROVED' && status !== 'SUPERSEDED') continue;

        const timeMs = new Date(entry.occurred_at).getTime();
        if (!Number.isFinite(timeMs)) continue;
        if (timeMs > maximumTimeMs) continue;

        const snapshotId =
            typeof entry.snapshot_id === 'number' &&
            Number.isFinite(entry.snapshot_id)
                ? entry.snapshot_id
                : null;
        const demo = entry.source === 'Portfolio history demo';
        const id = demo ? entry.id : snapshotId === null ? entry.id : `shape:${snapshotId}`;
        confirmations.set(id, {
            id,
            occurredAt: entry.occurred_at,
            timeMs,
            snapshotId,
            label: demo ? `Demo ${snapshotId ?? ''}`.trim() : snapshotId === null ? 'APPROVED' : `APPROVED v${snapshotId}`,
            source: String(entry.source || 'Portfolio approval'),
            shape: approvedShapeArchive([{ ...entry, status, rows: entry.rows ?? [] }])[0],
            previousShape: null,
            demo,
        });
    }

    const ordered = Array.from(confirmations.values()).sort(
        (left, right) => left.timeMs - right.timeMs
            || (left.snapshotId ?? 0) - (right.snapshotId ?? 0) || left.id.localeCompare(right.id),
    );
    const previousBySource = new Map<boolean, ApprovedShape>();
    // Link approvals before filtering visible markers; a predecessor may be outside the chart range.
    for (const confirmation of ordered) {
        const demo = Boolean(confirmation.demo);
        confirmation.previousShape = previousBySource.get(demo) ?? null;
        previousBySource.set(demo, confirmation.shape);
    }
    return ordered.filter(item => minimumTimeMs === null || item.timeMs >= minimumTimeMs);
}

export function portfolioShapePreviewRows(shape: ApprovedShape, previous: ApprovedShape | null = null) {
    const weight = (saved: ApprovedShape | null, code: string) => saved?.weights.has(code)
        ? saved.weights.get(code)! : saved?.complete ? 0 : null;
    const codes = new Set([...shape.weights.keys(), ...previous?.weights.keys() ?? []]);
    return [...codes].sort((a, b) => (weight(shape, b) ?? -1) - (weight(shape, a) ?? -1)
        || a.localeCompare(b)).map((code, index) => ({
        code,
        name: shape.names.get(code) || previous?.names.get(code) || code,
        color: getPortfolioAssetClassColor(code, index),
        approved: weight(shape, code),
        previous: weight(previous, code),
    }));
}
