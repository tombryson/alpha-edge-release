export type PositionsPresentation = 'table' | 'simple';
export const POSITIONS_PRESENTATION_KEY = 'alpha-edge:positions-presentation';
export type PositionsMapLayout = '2d' | '1d';
export const POSITIONS_MAP_LAYOUT_KEY = 'alpha-edge:positions-map-layout';
export const POSITIONS_MAP_COLOUR_KEY = 'alpha-edge:positions-map-colour';

// Fixed endpoints keep the same P/L comparable across portfolios and class focus.
export function capitalMapPerformanceLevel(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value / 50)) : null;
}

export type CapitalMapHolding = {
    id: number;
    name: string;
    ticker: string;
    classCode: string;
    className: string;
    value: number;
    isETF: boolean;
    profitLossPercent: number | null;
    trend: 'BUY' | 'SELL' | null;
};

export type CapitalMapClass = {
    code: string;
    name: string;
    value: number;
    children: CapitalMapHolding[];
};

export function capitalMapShare(value: number, total: number): number | null {
    return Number.isFinite(value) && Number.isFinite(total) && total > 0 ? value / total * 100 : null;
}

export function capitalMapAxisTicks(visibleValue: number, portfolioValue: number) {
    const coverage = capitalMapShare(visibleValue, portfolioValue);
    if (coverage === null || !Number.isFinite(coverage) || coverage <= 0) return [];
    // Roughly four intervals, using 25-point steps for a near-full portfolio.
    const interval = coverage / 4;
    const magnitude = 10 ** Math.floor(Math.log10(interval));
    const step = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= interval)! * magnitude;
    if (!Number.isFinite(step) || step <= 0) return [];
    return Array.from({ length: Math.floor(coverage / step) + 1 }, (_, index) => {
        const percentage = Number((index * step).toPrecision(12));
        return { percentage, offset: percentage / coverage };
    });
}

// The caller supplies the same eligible rows as Positions. Never replace missing
// or zero values with a minimum area, or mix suggested targets into held capital.
export function buildPositionsCapitalMap(holdings: CapitalMapHolding[]) {
    const classes = new Map<string, CapitalMapClass>();
    const unplotted: CapitalMapHolding[] = [];
    let total = 0;
    for (const holding of holdings) {
        if (!Number.isFinite(holding.value) || holding.value <= 0) {
            unplotted.push(holding);
            continue;
        }
        const code = holding.classCode || 'UNASSIGNED';
        const group = classes.get(code) || { code, name: holding.className || 'Unassigned', value: 0, children: [] };
        group.children.push(holding);
        group.value += holding.value;
        total += holding.value;
        classes.set(code, group);
    }
    const ordered = [...classes.values()].sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));
    for (const group of ordered) group.children.sort((a, b) => b.value - a.value || a.id - b.id);
    return { classes: ordered, holdings: ordered.flatMap(group => group.children), unplotted, total };
}

export function capitalMapMatches(holding: CapitalMapHolding, query: string): boolean {
    const text = `${holding.name} ${holding.ticker} ${holding.className}`.toLocaleLowerCase();
    return query.toLocaleLowerCase().trim().split(/\s+/).every(word => text.includes(word));
}
