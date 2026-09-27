import { normalizeAssetClassCode } from './asset-class';
import { getPortfolioAssetClassColor } from './portfolio-composition-colors';

export type PortfolioAnalyticView = 'shape' | 'cumulative' | 'deviation' | 'radial';

export interface ShapeHistoryRecord {
    id: string;
    kind: string;
    status: string;
    occurred_at: string;
    snapshot_id?: number | null;
    rows: { asset_class: string; display_name: string; weight_pct: number }[];
}

export interface ApprovedShape {
    id: string;
    version: number | null;
    at: string;
    weights: Map<string, number | null>;
    names: Map<string, string>;
    total: number | null;
    complete: boolean;
}

export interface ShapeClassIdentity {
    code: string;
    asset_class_code: string;
    display_name: string;
    allow_target_weight: boolean;
}

export function shapeClassIdentities(classes: readonly ShapeClassIdentity[]) {
    const result = new Map<string, { code: string; name: string }>();
    const candidates = classes.filter(item => item.allow_target_weight);
    for (const item of candidates) result.set(normalizeAssetClassCode(item.code), {
        code: normalizeAssetClassCode(item.code), name: item.display_name,
    });
    const aliases = new Map<string, Set<string>>();
    for (const item of candidates) {
        if (!item.asset_class_code) continue;
        const alias = normalizeAssetClassCode(item.asset_class_code);
        const codes = aliases.get(alias) ?? new Set<string>();
        codes.add(normalizeAssetClassCode(item.code));
        aliases.set(alias, codes);
    }
    for (const [alias, codes] of aliases) {
        if (!result.has(alias) && codes.size === 1) result.set(alias, result.get([...codes][0])!);
    }
    return result;
}

export function approvedShapeArchive(records: readonly ShapeHistoryRecord[], classes: readonly ShapeClassIdentity[] = []): ApprovedShape[] {
    const shapes = new Map<string, ApprovedShape>();
    const identities = shapeClassIdentities(classes);
    for (const record of records) {
        if (record.kind !== 'shape' || !['APPROVED', 'SUPERSEDED'].includes(record.status)
            || !Number.isFinite(Date.parse(record.occurred_at))) continue;
        const weights = new Map<string, number | null>();
        const names = new Map<string, string>();
        const rawCodes = new Set<string>();
        for (const row of record.rows) {
            const rawCode = normalizeAssetClassCode(row.asset_class);
            const identity = identities.get(rawCode);
            const code = identity?.code ?? rawCode;
            const weight = Number.isFinite(row.weight_pct) && row.weight_pct >= 0 && row.weight_pct <= 100
                ? row.weight_pct : null;
            const previous = weights.get(code);
            weights.set(code, rawCodes.has(rawCode) || weight === null || previous === null ? null : (previous ?? 0) + weight);
            rawCodes.add(rawCode);
            names.set(code, identity?.name || row.display_name || row.asset_class);
        }
        const total = weights.size > 0 && [...weights.values()].every(value => value !== null)
            ? [...weights.values()].reduce<number>((sum, value) => sum + value!, 0) : null;
        const id = record.snapshot_id != null ? `shape:${record.snapshot_id}` : record.id;
        shapes.set(id, {
            id, version: record.snapshot_id ?? null, at: record.occurred_at, weights, names, total,
            complete: total !== null && Math.abs(total - 100) < 0.01,
        });
    }
    return [...shapes.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)
        || (a.version ?? 0) - (b.version ?? 0) || a.id.localeCompare(b.id));
}

export function shapeHistorySelection(shapes: readonly ApprovedShape[], fromId: string, toId: string) {
    const to = shapes.findIndex(shape => shape.id === toId);
    const toIndex = to >= 1 ? to : shapes.length - 1;
    const from = shapes.findIndex(shape => shape.id === fromId);
    const fromIndex = from >= 0 && from < toIndex ? from : toIndex - 1;
    return { fromIndex, toIndex, from: shapes[fromIndex], to: shapes[toIndex] };
}

export function compareApprovedShapes(archive: readonly ApprovedShape[], from: ApprovedShape, to: ApprovedShape, presentation: Readonly<Record<string, { name: string; color: string }>> = {}) {
    const names = new Map<string, string>();
    const peaks: Record<string, number> = {};
    // Use the full loaded archive to keep colours, spokes and scales stable while stepping.
    for (const shape of archive) {
        for (const [code, name] of shape.names) names.set(code, name);
        for (const [code, value] of shape.weights) peaks[code] = Math.max(peaks[code] ?? 0, value ?? 0);
    }
    const weight = (shape: ApprovedShape, code: string) => shape.weights.has(code)
        ? shape.weights.get(code)! : shape.complete ? 0 : null;
    const relevantCodes = [...names.keys()].filter(code => (peaks[code] ?? 0) > 0
        || archive.some(shape => shape.weights.get(code) === null));
    const rows = (relevantCodes.length ? relevantCodes : [...names.keys()]).sort().map((code, index) => {
        const earlier = weight(from, code);
        const later = weight(to, code);
        return {
            code, name: presentation[code]?.name ?? names.get(code)!, color: getPortfolioAssetClassColor(code),
            current: later, target: earlier,
            difference: earlier !== null && later !== null ? later - earlier : null,
        };
    });
    const ranked = (shape: ApprovedShape) => shape.complete
        ? [...shape.weights.entries()].filter(([, value]) => value! > 0).sort((a, b) => b[1]! - a[1]! || a[0].localeCompare(b[0])) : [];
    const earlierRanked = ranked(from);
    const laterRanked = ranked(to);
    let earlierSum = 0;
    let laterSum = 0;
    const concentration = from.complete && to.complete ? Array.from({ length: Math.max(earlierRanked.length, laterRanked.length) }, (_, index) => {
        const earlier = earlierRanked[index];
        const later = laterRanked[index];
        earlierSum += earlier?.[1] ?? 0;
        laterSum += later?.[1] ?? 0;
        return { rank: index + 1, earlier: earlierSum, later: laterSum,
            earlierName: earlier ? presentation[earlier[0]]?.name ?? from.names.get(earlier[0])! : null,
            laterName: later ? presentation[later[0]]?.name ?? to.names.get(later[0])! : null };
    }) : [];
    const maximum = Math.max(0, ...Object.values(peaks));
    const scale = Math.max(10, Math.ceil(maximum / 10) * 10);
    const incompleteCodes = rows.filter(row => archive.some(shape => weight(shape, row.code) === null)).map(row => row.code);
    return { rows, peaks, scale, concentration, incompleteCodes };
}
