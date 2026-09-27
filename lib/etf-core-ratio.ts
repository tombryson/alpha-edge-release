export function formatCoreRatio(percentage: number): string {
    if (!Number.isFinite(percentage) || percentage <= 0) return '0%';

    const denominator = 100 / percentage;
    if (Math.abs(denominator - Math.round(denominator)) < 0.01) {
        return `1:${Math.round(denominator)}`;
    }

    return `${percentage.toFixed(0)}%`;
}
