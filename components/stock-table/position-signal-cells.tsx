import { normalizeActionType, securityActionLabel } from './action-labels';
import type { SecurityActionResponse } from '@/lib/api';
import { Clock3, TriangleAlert } from 'lucide-react';
import { actionStatusLabel, actionCompactLabel, openDecisionHistory } from '@/lib/action-presentation';

type PositionTrendCellProps = {
    showStats: boolean;
    positionState?: string | null;
};

export function PositionTrendCell({
    showStats,
    positionState,
}: PositionTrendCellProps) {
    return (
        <td className="h-[26px] text-center font-mono font-light text-[10px] border-r border-border/30 px-1 align-middle">
            {showStats ? (
                !positionState ? (
                    <span className="text-muted-foreground text-[11px] leading-none">
                        -
                    </span>
                ) : positionState === 'BUY' ? (
                    <span
                        className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold leading-none"
                        style={{ color: 'var(--primary)' }}
                    >
                        <span className="text-[18px] leading-none">↑</span>
                        <span>Buy</span>
                    </span>
                ) : (
                    <span
                        className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold leading-none"
                        style={{ color: 'var(--destructive)' }}
                    >
                        <span className="text-[18px] leading-none">↓</span>
                        <span>Sell</span>
                    </span>
                )
            ) : null}
        </td>
    );
}

type PositionActionCellProps = {
    showStats: boolean;
    action?: SecurityActionResponse | null;
    onOpen: () => void;
};

export function PositionActionCell({
    showStats,
    action,
    onOpen,
}: PositionActionCellProps) {
    const historyOnly = action?.status === 'AWAITING_STATEMENT' || action?.status === 'BLOCKED';
    return (
        <td className="h-[26px] border-r border-border/30 px-1 text-center align-middle">
            {showStats ? (
                !action ? (
                    <span className="inline-flex h-[25px] w-full items-center justify-center text-[11px] leading-none text-muted-foreground">
                        -
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            if (historyOnly) openDecisionHistory(action.ticker);
                            else onOpen();
                        }}
                        className="group flex h-[25px] w-full items-center justify-center px-1 text-left outline-none"
                        title={`${securityActionLabel(action.alert_type)}: ${actionStatusLabel(action)}. ${historyOnly ? 'View in Decision History.' : 'Open in Alert Stack.'}`}
                    >
                        <PositionActionCellContent action={action} />
                    </button>
                )
            ) : null}
        </td>
    );
}

function PositionActionCellContent({
    action,
}: {
    action: SecurityActionResponse;
}) {
    const normalizedSignal = normalizeActionType(action.alert_type);
    const isExit = normalizedSignal === 'SELL';
    const label = action.intent === 'DEPLOY' && action.deployment_state && action.deployment_state !== 'FUNDED'
        ? 'Add paused'
        : actionCompactLabel(action) || securityActionLabel(normalizedSignal);
    const actionTone =
        isExit
            ? {
                  dot: 'bg-[#f87171]',
                  text: 'text-destructive',
              }
            : normalizedSignal === 'SELL_50' || normalizedSignal === 'SELL_DOWN' ||
                normalizedSignal === 'REDUCE_TO_OUTPERFORM_LIMIT' ||
                normalizedSignal === 'EQUITY_REGIME_STRONG_TRIM' || normalizedSignal === 'WEIGHT_REDUCE' || (action.intent === 'DEPLOY' && action.deployment_state && action.deployment_state !== 'FUNDED')
              ? {
                    dot: 'bg-[#f4b95f]',
                    text: 'text-foreground',
                }
            : normalizedSignal === 'TRIM'
              ? {
                    dot: 'bg-[#f4b95f]',
                    text: 'text-foreground',
                }
              : normalizedSignal === 'BREAKOUT'
                ? {
                      dot: 'bg-[#58aee8]',
                      text: 'text-foreground',
                  }
                : normalizedSignal === 'DCA'
                  ? {
                        dot: 'bg-[#f4b95f]',
                        text: 'text-foreground',
                    }
                  : {
                        dot: 'bg-[#58d37c]',
                        text: 'text-foreground',
                    };
    const isBreakout = normalizedSignal === 'BREAKOUT';
    const isAwaitingStatement = action.status === 'AWAITING_STATEMENT';
    const isVariance = action.status === 'VARIANCE';

    if (isAwaitingStatement || isVariance) {
        const Icon = isVariance ? TriangleAlert : Clock3;
        return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: isVariance ? 'var(--caution)' : 'var(--info)' }}>
            <Icon size={12} aria-hidden="true" />{isVariance ? 'Check' : 'Pending'}
        </span>;
    }

    return (
        <div className="flex h-[26px] items-center justify-center leading-none">
            <span className="inline-flex items-center justify-center gap-[7px]">
                {isBreakout ? (
                    <span
                        className="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full bg-[#58aee8]/18"
                        aria-hidden="true"
                    >
                        <span
                            className={`block h-[7px] w-[7px] rounded-full ${actionTone.dot}`}
                        />
                    </span>
                ) : (
                    <span
                        className={`block h-[9px] w-[9px] shrink-0 rounded-full ${actionTone.dot}`}
                        aria-hidden="true"
                    />
                )}
                <span
                    className={`text-[11px] font-semibold leading-none ${actionTone.text}`}
                >
                    {label}
                </span>
            </span>
        </div>
    );
}

type PositionDcaCellProps = {
    showStats: boolean;
    isWatchlist?: boolean;
    daysSince: number | null;
    title: string;
    onLogContribution: () => void;
};

export function PositionDcaCell({
    showStats,
    isWatchlist,
    daysSince,
    title,
    onLogContribution,
}: PositionDcaCellProps) {
    if (!showStats || isWatchlist) {
        return (
            <td className="h-[26px] border-r border-border/30 p-0 relative overflow-hidden align-middle" />
        );
    }

    const dcaProgress =
        daysSince === null
            ? 0
            : Math.min(100, Math.max(0, (daysSince / 70) * 100));
    const dcaTextClass =
        daysSince === null
            ? 'text-muted-foreground/45'
            : 'text-muted-foreground';

    return (
        <td
            onClick={onLogContribution}
            title={title}
            className="group h-[26px] border-r border-border/30 p-0 relative overflow-hidden cursor-pointer align-middle"
        >
            <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-2">
                {daysSince !== null ? (
                    <>
                        <span
                            className={`self-end text-[10px] font-mono font-semibold leading-none ${dcaTextClass}`}
                        >
                            {daysSince}d
                        </span>
                        <span className="mt-1 block h-[2px] w-full overflow-hidden rounded-full bg-muted-foreground/18">
                            <span
                                className="block h-full rounded-full bg-[#79b7c0]/80 transition-[width] duration-150"
                                style={{ width: `${dcaProgress}%` }}
                            />
                        </span>
                    </>
                ) : (
                    <span className="text-muted-foreground/45 text-[11px]">
                        -
                    </span>
                )}
            </div>
        </td>
    );
}
