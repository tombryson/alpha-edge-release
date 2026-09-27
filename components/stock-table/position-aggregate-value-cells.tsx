import type { CSSProperties, ReactNode } from 'react';

type AggregateFadeProps = {
    statsFadeClass?: string;
    statsFadeStyle?: CSSProperties;
};

export function PositionAggregateAssetCell({
    showStats,
    assetLabel,
    fallbackLabel,
}: {
    showStats: boolean;
    assetLabel?: ReactNode;
    fallbackLabel?: ReactNode;
}) {
    return (
        <td className="text-center font-mono text-[10px] text-muted-foreground border-r border-border/30">
            {showStats ? assetLabel ?? fallbackLabel ?? null : null}
        </td>
    );
}

export function PositionAggregateMoneyCell({
    showStats,
    value,
    toneClass,
    statsFadeClass = '',
    statsFadeStyle,
    padded = false,
}: AggregateFadeProps & {
    showStats: boolean;
    value: number;
    toneClass: string;
    padded?: boolean;
}) {
    return (
        <td
            className={`h-[26px] text-center ${
                padded ? 'px-1 ' : ''
            }align-middle font-mono text-[10px] border-r border-border/30`}
        >
            {showStats ? (
                <span
                    className={`${toneClass} ${statsFadeClass}`}
                    style={statsFadeStyle}
                >
                    ${Math.round(value).toLocaleString()}
                </span>
            ) : null}
        </td>
    );
}

export function PositionAggregateExposurePercentCell({
    showStats,
    exposurePercent,
    toneClass,
    statsFadeClass = '',
    statsFadeStyle,
    reviewMode,
}: AggregateFadeProps & {
    showStats: boolean;
    exposurePercent: number | null;
    toneClass: string;
    reviewMode: boolean;
}) {
    return (
        <td
            className="h-[26px] text-center align-middle font-mono text-[10px] border-r border-border/30"
            style={
                reviewMode
                    ? {
                          width: '78px',
                          minWidth: '78px',
                          maxWidth: '78px',
                      }
                    : undefined
            }
        >
            {showStats && exposurePercent !== null ? (
                <span
                    className={`${toneClass} ${statsFadeClass}`}
                    style={statsFadeStyle}
                >
                    {exposurePercent.toFixed(1)}%
                </span>
            ) : null}
        </td>
    );
}

export function PositionAggregatePlDollarCell({
    showStats,
    value,
    positive,
    statsFadeClass = '',
    statsFadeStyle,
}: AggregateFadeProps & {
    showStats: boolean;
    value: number;
    positive: boolean;
}) {
    return (
        <td
            className={`h-[26px] text-center align-middle font-mono text-[10px] border-r border-border/30 ${
                positive ? 'text-primary' : 'text-destructive'
            }`}
        >
            {showStats ? (
                <span className={statsFadeClass} style={statsFadeStyle}>
                    {`${positive ? '+' : '-'}$${Math.round(
                        Math.abs(value),
                    ).toLocaleString()}`}
                </span>
            ) : null}
        </td>
    );
}

export function PositionAggregatePlPercentCell({
    showStats,
    value,
    positive,
    statsFadeClass = '',
    statsFadeStyle,
}: AggregateFadeProps & {
    showStats: boolean;
    value: number;
    positive: boolean;
}) {
    return (
        <td
            className={`h-[26px] text-center align-middle font-mono text-[10px] border-r border-border/30 ${
                positive ? 'text-primary' : 'text-destructive'
            }`}
        >
            {showStats ? (
                <span className={statsFadeClass} style={statsFadeStyle}>
                    {`${positive ? '+' : '-'}${Math.abs(value).toFixed(1)}%`}
                </span>
            ) : null}
        </td>
    );
}

export function PositionAggregatePortfolioPercentCell({
    shouldShowPortfolioPercent,
    displayPortfolioPercent,
    hasDisplayPortfolioPercent,
    fillPct,
    statsFadeStyle,
    textClass,
    textStyle,
    emphasize,
    reviewMode,
    focused,
    targetMarkerPct,
}: {
    shouldShowPortfolioPercent: boolean;
    displayPortfolioPercent: number | null;
    hasDisplayPortfolioPercent: boolean;
    fillPct: number;
    statsFadeStyle?: CSSProperties;
    textClass: string;
    textStyle?: CSSProperties;
    emphasize: boolean;
    reviewMode: boolean;
    focused: boolean;
    targetMarkerPct?: number | null;
}) {
    return (
        <td
            data-column-key="portfolioPercent"
            className={`relative h-[26px] overflow-hidden text-center align-middle font-mono text-[10px] border-r border-border/30 ${
                emphasize && reviewMode
                    ? 'border-y border-sky-500/35 bg-sky-500/[0.08] text-sky-100'
                    : ''
            } ${
                focused
                    ? '!border !border-sky-300/70 bg-sky-400/[0.08] shadow-[inset_0_0_0_1px_rgba(125,211,252,0.32)]'
                    : ''
            }`}
            style={
                reviewMode
                    ? {
                          width: '70px',
                          minWidth: '70px',
                          maxWidth: '70px',
                      }
                    : undefined
            }
        >
            <div aria-hidden="true" className="position-percent-fill">
                {shouldShowPortfolioPercent && hasDisplayPortfolioPercent && fillPct > 0 ? (
                    <div
                        className="absolute inset-y-0 left-0 bg-sky-400/[0.16] transition-[width,opacity] ease-out"
                        style={{
                            width: `${fillPct}%`,
                            ...(statsFadeStyle ?? {}),
                        }}
                    />
                ) : null}
                {shouldShowPortfolioPercent && targetMarkerPct != null ? (
                    <div
                        className="absolute inset-y-[3px] w-px bg-warning/80"
                        style={{
                            left: `${targetMarkerPct}%`,
                            ...(statsFadeStyle ?? {}),
                        }}
                    />
                ) : null}
            </div>
            {shouldShowPortfolioPercent ? (
                <span className={textClass} style={textStyle}>
                    {Number(displayPortfolioPercent).toFixed(1)}%
                </span>
            ) : null}
        </td>
    );
}
