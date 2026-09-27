import { normalizeAssetClassCode } from './asset-class';

export interface PortfolioRadialDatum {
    code: string;
    name: string;
    current: number | null;
    target: number | null;
    color: string;
}

export function radialWeight(value: number | null): number | null {
    return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildPortfolioRadialModel(input: readonly PortfolioRadialDatum[], minimumWeight: number | null = null, contextPeaks: Readonly<Record<string, number>> = {}, contextIncompleteCodes: readonly string[] = []) {
    // Weight-based sorting would rotate the axes whenever holdings change.
    const allRows = input.map(row => ({
        ...row,
        current: radialWeight(row.current),
        target: radialWeight(row.target),
    })).sort((a, b) => normalizeAssetClassCode(a.code).localeCompare(normalizeAssetClassCode(b.code)));
    // Keep unknown holdings visible; unavailable does not mean negligible.
    const rows = minimumWeight === null ? allRows : allRows.filter(row =>
        row.current === null || row.current > minimumWeight || (row.target !== null && row.target > minimumWeight)
        || (contextPeaks[row.code] ?? 0) > minimumWeight || contextIncompleteCodes.includes(row.code),
    );
    const maximum = Math.max(0, ...allRows.flatMap(row => [row.current ?? 0, row.target ?? 0]),
        ...Object.values(contextPeaks).filter(value => Number.isFinite(value) && value >= 0));
    const step = maximum <= 20 ? 5 : maximum <= 60 ? 10 : 25;
    const scaleMax = Math.max(step * 2, Math.ceil(maximum / step) * step);
    return {
        rows,
        scaleMax,
        ticks: Array.from({ length: scaleMax / step }, (_, index) => (index + 1) * step),
        completeTarget: rows.length > 0 && rows.every(row => row.target !== null),
        totalClasses: allRows.length,
        heldCoverage: rows.every(row => row.current !== null) ? rows.reduce((sum, row) => sum + row.current!, 0) : null,
    };
}

export function radialPoint(index: number, count: number, distance: number, cx: number, cy: number) {
    const angle = index * Math.PI * 2 / Math.max(1, count) - Math.PI / 2;
    return { x: cx + Math.cos(angle) * distance, y: cy + Math.sin(angle) * distance };
}

export function radialSelectedIndex(x: number, y: number, count: number): number | null {
    if (count === 0 || Math.hypot(x, y) < 4) return null;
    const angle = Math.atan2(y, x) + Math.PI / 2;
    return (Math.round(angle * count / (Math.PI * 2)) + count) % count;
}

// Separate segments leave missing observations visibly disconnected, including at the wrap.
export function radialSegments(values: readonly (number | null)[]) {
    if (values.length < 2) return [];
    return values.flatMap((value, index) => {
        const next = (index + 1) % values.length;
        return radialWeight(value) !== null && radialWeight(values[next]) !== null
            ? [{ from: index, to: next }]
            : [];
    });
}

export function radialOutline(points: readonly ({ x: number; y: number } | null)[]): string {
    if (points.length < 2) return '';
    const firstGap = points.findIndex(point => point === null);
    if (firstGap < 0) {
        return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point!.x} ${point!.y}`).join(' ')
            + (points.length >= 3 ? ' Z' : '');
    }
    // Begin after a gap so the final-to-first valid edge remains connected.
    let penDown = false;
    const commands: string[] = [];
    for (let offset = 1; offset <= points.length; offset++) {
        const point = points[(firstGap + offset) % points.length];
        if (point === null) {
            penDown = false;
        } else {
            commands.push(`${penDown ? 'L' : 'M'} ${point.x} ${point.y}`);
            penDown = true;
        }
    }
    return commands.join(' ');
}

export function spaceRadialLabels(labels: { index: number; y: number; height: number }[], top: number, bottom: number) {
    const sorted = labels.map(label => ({ ...label })).sort((a, b) => a.y - b.y);
    for (let i = 0; i < sorted.length; i++) {
        const previous = sorted[i - 1];
        sorted[i].y = Math.max(sorted[i].y, previous
            ? previous.y + (previous.height + sorted[i].height) / 2 + 6
            : top + sorted[i].height / 2);
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
        const next = sorted[i + 1];
        sorted[i].y = Math.min(sorted[i].y, next
            ? next.y - (next.height + sorted[i].height) / 2 - 6
            : bottom - sorted[i].height / 2);
    }
    return sorted;
}

export function wrapRadialLabel(name: string, maxWidth: number, measure: (text: string) => number): string[] {
    const words = name.trim().split(/\s+/);
    const split = words.length > 2 ? Math.ceil(words.length / 2) : words.length;
    const balanced = [words.slice(0, split).join(' '), words.slice(split).join(' ')].filter(Boolean);
    if (balanced.every(line => measure(line) <= maxWidth)) return balanced;

    const lines: string[] = [];
    let line = '';
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (measure(candidate) <= maxWidth) {
            line = candidate;
            continue;
        }
        if (line) lines.push(line);
        line = '';
        for (const character of word) {
            if (line && measure(line + character) > maxWidth) {
                lines.push(line);
                line = '';
            }
            line += character;
        }
    }
    if (line) lines.push(line);
    return lines;
}
