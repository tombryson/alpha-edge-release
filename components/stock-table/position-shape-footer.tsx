import type { PortfolioMixRow } from '@/lib/api';
import { buildPortfolioGroupDialModel } from '@/lib/portfolio-group-dial';
import styles from './position-shape-footer.module.css';

export type PositionShapeUnit = 'pct' | 'cash';

const formatPct = (value: number): string => `${value.toFixed(1)}%`;

const formatMoney = (value: number): string => {
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value).toLocaleString()}`;
};

const formatValue = (
    valuePct: number,
    unit: PositionShapeUnit,
    totalValue: number,
): string =>
    unit === 'pct'
        ? formatPct(valuePct)
        : formatMoney((valuePct / 100) * Math.max(0, totalValue));

export function PositionShapeFooter({
    currentRows,
    approvedRows,
    totalValue,
    comparisonActive,
    unit,
    onToggleComparison,
    onSetUnit,
}: {
    currentRows: PortfolioMixRow[];
    approvedRows: PortfolioMixRow[];
    totalValue: number;
    comparisonActive: boolean;
    unit: PositionShapeUnit;
    onToggleComparison: () => void;
    onSetUnit: (unit: PositionShapeUnit) => void;
}) {
    const model = buildPortfolioGroupDialModel({ currentRows, approvedRows });
    const scaleMax = Math.max(
        5,
        Math.ceil(
            Math.max(
                0,
                ...model.slices.flatMap((slice) => [
                    slice.currentPct,
                    slice.targetPct,
                ]),
            ) / 5,
        ) * 5,
    );
    return (
        <section
            className={`${styles.footer} relative z-30 shrink-0 border border-border/70 bg-[color-mix(in_oklab,var(--card)_94%,var(--background))] shadow-[0_-8px_22px_rgba(0,0,0,0.32)]`}
            aria-label="Approved portfolio shape comparison"
            data-testid="positions-shape-footer"
        >
            <div className={`${styles.strip} flex min-w-0 self-stretch items-stretch gap-[14px] overflow-x-auto`} role="list" aria-label="Asset class comparisons">
                {model.slices.map((slice) => {
                    const targetWidth = Math.max(
                        0,
                        Math.min(100, (slice.targetPct / scaleMax) * 100),
                    );
                    const currentPosition = Math.max(
                        0,
                        Math.min(100, (slice.currentPct / scaleMax) * 100),
                    );
                    return (
                        <div
                            key={slice.key}
                            className={`${styles.slice} group flex min-w-[118px] flex-1 flex-col justify-center gap-[4px]`}
                            role="listitem"
                            tabIndex={0}
                            title={`${slice.label}: ${
                                model.hasTarget
                                    ? `target ${formatPct(slice.targetPct)}`
                                    : 'target unavailable'
                            }, current ${formatPct(slice.currentPct)}`}
                        >
                            <div className="flex min-w-0 items-baseline gap-[5px]">
                                <i
                                    className="h-[8px] w-[8px] shrink-0 rounded-[1px]"
                                    style={{ backgroundColor: slice.color }}
                                />
                                <span className={`${styles.label} min-w-0 truncate font-mono text-[8.5px] uppercase tracking-[0.08em] text-foreground/80`}>
                                    {slice.label}
                                </span>
                                {model.hasTarget && (
                                    <span className={`${styles.target} ml-auto shrink-0 whitespace-nowrap font-mono text-[9.5px] font-medium tabular-nums text-foreground`} title="Approved allocation">
                                        {formatValue(
                                            slice.targetPct,
                                            unit,
                                            totalValue,
                                        )}
                                    </span>
                                )}
                                <span
                                    title="Current holdings"
                                    className={`${styles.current} min-w-[34px] shrink-0 text-right font-mono text-[9px] tabular-nums text-muted-foreground ${
                                        model.hasTarget ? '' : 'ml-auto'
                                    }`}
                                >
                                    {formatValue(
                                        slice.currentPct,
                                        unit,
                                        totalValue,
                                    )}
                                </span>
                            </div>
                            <div className="relative h-[7px] overflow-visible bg-foreground/[0.045]">
                                <i
                                    className="absolute inset-y-0 left-0 block"
                                    style={{
                                        width: `${targetWidth}%`,
                                        background: model.hasTarget
                                            ? `color-mix(in srgb, ${slice.color} 80%, transparent)`
                                            : 'transparent',
                                    }}
                                />
                                <i
                                    className="absolute top-[-2px] h-[11px] w-[2px] bg-foreground/85"
                                    style={{ left: `${currentPosition}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
                {model.slices.length === 0 && (
                    <div className="flex items-center font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/70">
                        Portfolio shape unavailable
                    </div>
                )}
            </div>

            <div className={`${styles.controls} flex shrink-0 items-center gap-[6px]`}>
                <button
                    type="button"
                    onClick={onToggleComparison}
                    className={`h-[28px] border px-[11px] font-mono text-[9px] uppercase tracking-[0.12em] transition-colors ${
                        comparisonActive
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border/70 text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                    }`}
                    aria-pressed={comparisonActive}
                >
                    {comparisonActive ? 'Comparing' : 'Compare'}
                </button>
                <div className={`${styles.units} inline-flex h-[28px] border border-border/70`}>
                    {(['pct', 'cash'] as const).map((value) => (
                        <button
                            type="button"
                            key={value}
                            onClick={() => onSetUnit(value)}
                            className={`grid w-[28px] place-items-center font-mono text-[10px] transition-colors ${
                                unit === value
                                    ? 'bg-foreground text-background'
                                    : 'text-muted-foreground hover:bg-muted/20 hover:text-foreground'
                            }`}
                            aria-pressed={unit === value}
                            aria-label={
                                value === 'pct'
                                    ? 'Show shape as percentages'
                                    : 'Show shape as dollars'
                            }
                        >
                            {value === 'pct' ? '%' : '$'}
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
}
