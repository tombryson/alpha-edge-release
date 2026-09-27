import { positionWeightTone, type PositionModelWeight } from '@/lib/positions-model-weight';

export function PositionStockModelWeightCell({ showStats, weight, actualPercent }: {
    showStats: boolean;
    weight?: PositionModelWeight;
    actualPercent?: number | null;
}) {
    const tone = positionWeightTone(actualPercent, weight);
    const comparison = tone === 'overstretch' ? ' Class % exceeds the suggested weight stretch range.'
        : tone === 'under' ? ' Class % is below Ideal wt.'
        : tone === 'aligned' ? ' Class % matches Ideal wt.' : '';
    const title = (weight?.dollar != null
        ? `$${Math.round(weight.dollar).toLocaleString('en-AU')} - ${weight.reason}`
        : weight?.reason || 'Model allocation unavailable.') + comparison;
    return (
        <td data-column-key="modelWeight" className="h-[26px] px-2 text-right align-middle font-mono text-foreground border-r border-border/30">
            {showStats && (weight?.percent != null ? (
                <span className="position-model-weight" data-weight-tone={tone} title={title}>
                    <span className="position-model-weight-number">{weight.percent.toFixed(1)}%</span>
                    <span className="position-model-weight-bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Math.max(0, weight.percent))}%` }} />
                    </span>
                </span>
            ) : <span className="text-muted-foreground" title={title}>-</span>)}
        </td>
    );
}

type PositionStockDisplayCellProps = {
    showStats: boolean;
    value: string | number;
};

export function PositionStockAssetCell({
    showStats,
    value,
}: PositionStockDisplayCellProps) {
    return (
        <td className="h-[26px] text-center px-1 border-r border-border/30 align-middle">
            {showStats ? (
                <span className="text-[10px] font-mono text-muted-foreground">
                    {value}
                </span>
            ) : null}
        </td>
    );
}

export function PositionStockPriceCell({
    showStats,
    value,
}: PositionStockDisplayCellProps) {
    return (
        <td className="h-[26px] text-center font-mono font-light text-[10px] text-foreground border-r border-border/30 align-middle">
            {showStats ? `$${Number(value || 0).toFixed(2)}` : null}
        </td>
    );
}

export function PositionStockMoneyCell({
    showStats,
    value,
    padded = false,
}: PositionStockDisplayCellProps & { padded?: boolean }) {
    return (
        <td
            className={`h-[26px] text-center ${
                padded ? 'px-1 ' : ''
            }font-mono font-light text-[10px] text-foreground border-r border-border/30 align-middle`}
        >
            {showStats
                ? `$${Math.round(Number(value || 0)).toLocaleString()}`
                : null}
        </td>
    );
}

export function PositionStockQuantityCell({
    showStats,
    value,
}: PositionStockDisplayCellProps) {
    return (
        <td className="h-[26px] text-center font-mono font-light text-[10px] text-foreground border-r border-border/30 align-middle">
            {showStats ? Number(value || 0).toLocaleString() : null}
        </td>
    );
}

export function PositionStockPlDollarCell({
    showStats,
    value,
}: PositionStockDisplayCellProps) {
    const numericValue = Number(value || 0);
    return (
        <td
            className={`h-[26px] text-center font-mono font-light text-[10px] border-r border-border/30 align-middle ${
                numericValue >= 0 ? 'text-primary' : 'text-destructive'
            }`}
        >
            {showStats
                ? `${numericValue >= 0 ? '+' : '-'}$${Math.round(
                      Math.abs(numericValue),
                  ).toLocaleString()}`
                : null}
        </td>
    );
}

export function PositionStockPlPercentCell({
    showStats,
    value,
}: PositionStockDisplayCellProps) {
    const numericValue = Number(value || 0);
    return (
        <td
            className={`h-[26px] text-center font-mono font-light text-[10px] border-r border-border/30 align-middle ${
                numericValue >= 0 ? 'text-primary' : 'text-destructive'
            }`}
        >
            {showStats
                ? `${numericValue >= 0 ? '+' : ''}${numericValue.toFixed(2)}%`
                : null}
        </td>
    );
}

type PositionStockPortfolioPercentCellProps = {
    showStats: boolean;
    portfolioPercent: number;
};

export function PositionStockPortfolioPercentCell({
    showStats,
    portfolioPercent,
}: PositionStockPortfolioPercentCellProps) {
    const fillPct = Math.min(100, Math.max(0, portfolioPercent));
    return (
        <td data-column-key="portfolioPercent" className="relative h-[26px] overflow-hidden text-center font-mono font-light text-[10px] text-foreground border-r border-border/30 align-middle">
            {showStats ? (
                <>
                    {fillPct > 0 ? (
                        <div aria-hidden="true" className="position-percent-fill">
                            <div
                                className="absolute inset-y-0 left-0 bg-sky-400/[0.16] transition-[width] duration-150"
                                style={{ width: `${fillPct}%` }}
                            />
                        </div>
                    ) : null}
                    <span className="relative z-10">
                        {portfolioPercent.toFixed(1)}%
                    </span>
                </>
            ) : null}
        </td>
    );
}
