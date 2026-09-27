import type { AssetClassPerformancePoint, PortfolioHistoryEntry, PortfolioPerformancePoint } from './api';

export const PORTFOLIO_HISTORY_DEMO_AS_OF = '2026-09-09';
export const PORTFOLIO_HISTORY_DEMO_SOURCE = 'Portfolio history demo';

export function portfolioHistoryDemoAllowed(hostname: string) {
    return ['localhost', '127.0.0.1', '[::1]', 'alpha-edge-uat-frontend.fly.dev'].includes(hostname);
}

// Frozen sample allocations, not recommendations or reconstructed account history.
const classes = [
    ['ENERGY', 'Energy Producers', 33.7],
    ['GOLD_MINERS', 'Gold Miners', 22.1],
    ['PHARMA', 'Pharma & Biotech', 13.5],
    ['SILVER_MINERS', 'Silver Miners', 8.9],
    ['REE', 'Rare Earths & Critical Minerals', 3.3],
    ['HEALTHCARE', 'Healthcare Services', 2.9],
    ['BASE_METALS', 'Base Metals Miners', 2.8],
    ['COPPER_MINERS', 'Copper Miners', 2.3],
    ['STAPLES', 'Staples', 1.6],
    ['INSURANCE', 'Insurance', 1.5],
    ['SEMICONDUCTORS', 'Semiconductors', 1.4],
    ['TECHNOLOGY', 'Technology', 0.9],
    ['URANIUM_MINERS', 'Uranium Miners', 0.8],
    ['DEFENCE', 'Defence', 0.8],
    ['GAMBLING', 'Gambling', 0.8],
    ['TELECOMMUNICATIONS', 'Telecommunications', 0.7],
    ['LITHIUM_MINERS', 'Lithium Miners', 0.7],
    ['CASH', 'Cash/Reserve', 1.3],
] as const;

const changes = [
    [-12, -7, 5, -3, 1, 16],
    [-7, -4, 3, -2, 1, 9],
    [-3, 1, 1, 0, 1, 0],
    [-10, 5, 2, 1, -1, 3],
    [-5, 3, 1, 1, 0, 0],
    [-2, 2, -1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [-3, -1, 1, 1, 1, 1],
];
const changedClasses = [0, 1, 2, 3, 7, 17];
const DAY = 86400000;
const round = (value: number) => Math.round(value * 100) / 100;

export type PortfolioHistoryDemo = ReturnType<typeof buildPortfolioHistoryDemo>;

export function buildPortfolioHistoryDemo() {
    const end = Date.parse(`${PORTFOLIO_HISTORY_DEMO_AS_OF}T00:00:00Z`);
    const start = end - 365 * DAY;
    const entries: PortfolioHistoryEntry[] = changes.map((deltas, index) => ({
        id: `demo-shape:${index + 1}`,
        kind: 'shape',
        status: index === changes.length - 1 ? 'APPROVED' : 'SUPERSEDED',
        title: `Demo approval ${index + 1}`,
        source: PORTFOLIO_HISTORY_DEMO_SOURCE,
        snapshot_id: index + 1,
        occurred_at: new Date(start + Math.floor(index * 345 / 7) * DAY).toISOString(),
        rows: classes.map(([code, name, base], classIndex) => ({
            asset_class: code, display_name: name, display_order: classIndex,
            weight_pct: round(base + (deltas[changedClasses.indexOf(classIndex)] ?? 0)),
        })),
    }));
    const dates = new Set<number>([start, end, ...entries.map(entry => Date.parse(entry.occurred_at))]);
    for (let time = start; time <= end; time += 7 * DAY) dates.add(time);
    const portfolio: PortfolioPerformancePoint[] = [];
    const assetClasses: AssetClassPerformancePoint[] = [];
    let weights = entries[0].rows.map(row => row.weight_pct);
    let previousTime = start;

    [...dates].sort((a, b) => a - b).forEach((time, index) => {
        // Holdings respond gradually to the most recent approval, never a future one.
        const approvals = entries.filter(entry => Date.parse(entry.occurred_at) <= previousTime);
        const target = approvals[approvals.length - 1];
        const weeks = (time - previousTime) / (7 * DAY);
        const response = 1 - Math.pow(0.7, weeks);
        const moved = weights.map((weight, classIndex) => {
            const towardsTarget = weight + (target.rows[classIndex].weight_pct - weight) * response;
            return towardsTarget * (1 + 0.012 * weeks * Math.sin(index * 0.6 + classIndex * 1.7));
        });
        const sum = moved.reduce((total, weight) => total + weight, 0);
        weights = moved.map(weight => weight / sum * 100);
        previousTime = time;
        const progress = (time - start) / (end - start);
        const total = round(58000 * (1 + 0.1 * progress + 0.035 * Math.sin(progress * 12)));
        const observedAt = new Date(time).toISOString();
        const values = weights.map(weight => round(total * weight / 100));
        values[values.length - 1] = round(total - values.slice(0, -1).reduce((sum, value) => sum + value, 0));
        const cash = values[values.length - 1];
        portfolio.push({
            statement_id: -(index + 1), observed_at: observedAt, source: PORTFOLIO_HISTORY_DEMO_SOURCE,
            total_value_aud: total, invested_value_aud: round(total - cash),
            statement_cash_aud: cash, residual_cash_aud: cash, sleeve_cash_aud: 0, holdings_count: 0,
        });
        classes.forEach(([code, name], classIndex) => assetClasses.push({
            statement_id: -(index + 1), observed_at: observedAt, source: PORTFOLIO_HISTORY_DEMO_SOURCE,
            asset_class: code, display_name: name, total_value_aud: values[classIndex],
            portfolio_weight_pct: values[classIndex] / total * 100,
            invested_value_aud: code === 'CASH' ? 0 : values[classIndex],
            cash_value_aud: code === 'CASH' ? values[classIndex] : 0,
        }));
    });

    return { entries, portfolio, assetClasses, start, end };
}
