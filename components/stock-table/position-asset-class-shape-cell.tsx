import type { PositionAssetClassShapeModel } from '@/lib/position-asset-class-shape';
import type { PositionShapeUnit } from './position-shape-footer';

const clampBarWidth = (value: number, scaleMax: number): number =>
    Math.max(0, Math.min(100, (value / Math.max(scaleMax, value, 1)) * 100));

const formatPct = (value: number): string => `${value.toFixed(1)}%`;

const formatMoney = (value: number): string => {
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value).toLocaleString()}`;
};

const driftText = (value: number | null): string => {
    if (value === null) return 'NO TARGET';
    if (Math.abs(value) < 0.05) return 'IN LINE';
    return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}pp`;
};

const driftTone = (value: number | null): string => {
    if (value === null || Math.abs(value) <= 1) {
        return 'text-muted-foreground';
    }
    return value > 0 ? 'text-warning' : 'text-sky-300';
};

const formatShapeValue = (
    valuePct: number,
    unit: PositionShapeUnit,
    totalValue: number,
): string =>
    unit === 'pct'
        ? formatPct(valuePct)
        : formatMoney((valuePct / 100) * Math.max(0, totalValue));

export function PositionAssetClassShapeCell({
    model,
    scaleMax,
    accentColor,
    columnSpan,
    unit = 'pct',
    totalValue = 0,
}: {
    model: PositionAssetClassShapeModel;
    scaleMax: number;
    accentColor: string;
    columnSpan: number;
    unit?: PositionShapeUnit;
    totalValue?: number;
}) {
    const effectiveScale = Math.max(
        scaleMax,
        model.currentPct,
        model.targetPct || 0,
        1,
    );
    const currentWidth = clampBarWidth(model.currentPct, effectiveScale);
    const targetWidth =
        model.targetPct === null
            ? 0
            : clampBarWidth(model.targetPct, effectiveScale);
    const accessibleLabel =
        model.targetPct === null
            ? `Current ${formatPct(model.currentPct)}. No approved target.`
            : `Target ${formatPct(model.targetPct)}. Current ${formatPct(
                  model.currentPct,
              )}. Drift ${driftText(model.driftPct)}.`;

    return (
        <td
            colSpan={columnSpan}
            className="position-shape-comparison-cell h-[36px] border-r border-border/30 px-[14px] align-middle"
            data-testid={`position-shape-comparison-${model.assetClassCode}`}
            aria-label={accessibleLabel}
            title={accessibleLabel}
        >
            <div className="flex h-full min-w-0 items-center justify-end">
                <div className="position-shape-compare flex min-w-0 items-center gap-[9px]">
                    <span className="position-shape-label font-mono font-medium uppercase tracking-[0.14em] text-muted-foreground/75">
                        TARGET
                    </span>
                    <span className="position-shape-target-value min-w-[52px] text-right font-mono tabular-nums text-muted-foreground">
                        {model.targetPct === null
                            ? '—'
                            : formatShapeValue(
                                  model.targetPct,
                                  unit,
                                  totalValue,
                              )}
                    </span>

                    <span
                        className="position-shape-bar-pair flex w-[clamp(112px,12vw,150px)] shrink-0 flex-col gap-[3px]"
                        aria-hidden="true"
                    >
                        <i
                            className="block h-[5px] rounded-[1px]"
                            style={{
                                width: `${targetWidth}%`,
                                background:
                                    model.targetPct === null
                                        ? 'transparent'
                                        : `color-mix(in srgb, ${accentColor} 55%, transparent)`,
                            }}
                        />
                        <i
                            className="block h-[5px] rounded-[1px]"
                            style={{
                                width: `${currentWidth}%`,
                                background: accentColor,
                            }}
                        />
                    </span>

                    <span className="position-shape-label font-mono font-medium uppercase tracking-[0.14em] text-muted-foreground/75">
                        NOW
                    </span>
                    <span className="position-shape-current-value min-w-[58px] text-right font-mono font-semibold tabular-nums text-foreground">
                        {formatShapeValue(
                            model.currentPct,
                            unit,
                            totalValue,
                        )}
                    </span>
                    <span
                        className={`position-shape-drift min-w-[64px] text-right font-mono tabular-nums ${driftTone(
                            model.driftPct,
                        )}`}
                    >
                        {unit === 'pct' || model.driftPct === null
                            ? driftText(model.driftPct)
                            : `${model.driftPct > 0 ? '+' : model.driftPct < 0 ? '−' : ''}${formatMoney(
                                  (Math.abs(model.driftPct) / 100) *
                                      Math.max(0, totalValue),
                              )}`}
                    </span>
                </div>
            </div>
        </td>
    );
}
