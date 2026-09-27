import React from 'react';
import { WorkflowStageButton } from '@/components/workflow-stage-button';

const formatMoney = (value?: number | null): string =>
    `$${Math.round(value || 0).toLocaleString()}`;

type MoneyFormatter = (value?: number | null) => string;

export type AdjustmentStageRailItem = {
    key: string;
    label: string;
    badge: string;
    badgeClassName: string;
    caption: string;
    active?: boolean;
    onClick?: () => void;
};

type AdjustmentStageRailProps = {
    stages: AdjustmentStageRailItem[];
    layout?: 'horizontal' | 'vertical';
    className?: string;
    testIdPrefix?: string;
};

export function AdjustmentStageRail({
    stages,
    layout = 'vertical',
    className = '',
    testIdPrefix,
}: AdjustmentStageRailProps) {
    const layoutClass =
        layout === 'horizontal'
            ? 'grid grid-cols-3 gap-1.5'
            : 'grid overflow-hidden rounded-xl border border-border/45 bg-background/20';

    return (
        <div className={`${layoutClass} ${className}`}>
            {stages.map((stage) => (
                <WorkflowStageButton
                    key={stage.key}
                    label={stage.label}
                    badge={stage.badge}
                    badgeClassName={stage.badgeClassName}
                    caption={stage.caption}
                    active={stage.active}
                    onClick={stage.onClick}
                    variant={layout === 'horizontal' ? 'card' : 'section'}
                    testId={
                        testIdPrefix
                            ? `${testIdPrefix}-workflow-stage-${stage.key}`
                            : undefined
                    }
                />
            ))}
        </div>
    );
}

type AdjustmentMetricProps = {
    label: string;
    value: string;
    valueClassName?: string;
};

export function AdjustmentMetric({
    label,
    value,
    valueClassName = 'text-foreground',
}: AdjustmentMetricProps) {
    return (
        <div className="rounded border border-border/45 bg-background/35 px-3 py-2">
            <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {label}
            </div>
            <div className={`mt-1 font-mono text-sm ${valueClassName}`}>
                {value}
            </div>
        </div>
    );
}

export type AdjustmentInboxItem = {
    key: string;
    title: string;
    source: string;
    summary?: string;
    badge: string;
    badgeClassName: string;
    active?: boolean;
    onClick?: () => void;
};

type AdjustmentInboxProps = {
    title?: string;
    items: AdjustmentInboxItem[];
    className?: string;
};

export function AdjustmentInbox({
    title = 'Actions',
    items,
    className = '',
}: AdjustmentInboxProps) {
    const containerClassName = `rounded-xl border ${
        className || 'border-border/50'
    } bg-background/20 p-3`;

    if (items.length === 0) {
        return (
            <div className={containerClassName}>
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    {title}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                    No active actions.
                </div>
            </div>
        );
    }

    return (
        <div className={containerClassName}>
            <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    {title}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                    {items.length} open
                </div>
            </div>
            <div className="mt-3 space-y-1.5">
                {items.map((item) => {
                    const body = (
                        <>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div
                                        className={`truncate text-xs font-semibold ${
                                            item.active
                                                ? 'text-sky-100'
                                                : 'text-foreground'
                                        }`}
                                    >
                                        {item.title}
                                    </div>
                                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                        {item.source}
                                    </div>
                                </div>
                                <span
                                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-mono uppercase ${item.badgeClassName}`}
                                >
                                    {item.badge}
                                </span>
                            </div>
                            {item.summary && (
                                <div className="mt-1 truncate text-[10px] text-muted-foreground">
                                    {item.summary}
                                </div>
                            )}
                        </>
                    );
                    const className = `w-full rounded-lg border p-[0.6rem] text-left ${
                        item.active
                            ? 'border-sky-300/70 bg-sky-500/[0.1] shadow-[inset_3px_0_0_rgba(56,189,248,0.85)]'
                            : 'border-border/35 bg-background/20'
                    } ${
                        item.onClick
                            ? 'cursor-pointer hover:border-sky-400/45 hover:bg-sky-500/[0.04]'
                            : 'cursor-default'
                    }`;

                    return item.onClick ? (
                        <button
                            key={item.key}
                            type="button"
                            onClick={item.onClick}
                            className={className}
                        >
                            {body}
                        </button>
                    ) : (
                        <div key={item.key} className={className}>
                            {body}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

type PositionAdjustmentTargetCellProps = {
    showStats: boolean;
    targetValue: number;
    currentValue: number;
    mode: 'percent' | 'value';
    label?: string;
    targetPctOverride?: number | null;
    showZero?: boolean;
    moneyFormatter?: MoneyFormatter;
};

export function PositionAdjustmentTargetCell({
    showStats,
    targetValue,
    currentValue,
    mode,
    label,
    targetPctOverride = null,
    showZero = false,
    moneyFormatter = formatMoney,
}: PositionAdjustmentTargetCellProps) {
    const targetPct =
        targetPctOverride != null
            ? targetPctOverride
            : currentValue > 0
              ? Math.min(100, (targetValue / currentValue) * 100)
              : 0;
    const hasTarget =
        (targetPctOverride != null && targetPctOverride > 0) ||
        (targetValue > 0 && currentValue > 0);
    const displayText =
        mode === 'value'
            ? hasTarget
                ? moneyFormatter(targetValue)
                : showZero
                  ? moneyFormatter(0)
                  : ''
            : label === 'EXEMPT'
              ? ''
              : hasTarget
                ? `${targetPct.toFixed(0)}%`
                : showZero
                  ? '0%'
                  : '';

    return (
        <td
            className={`h-[26px] text-center font-mono font-light text-[10px] border-r align-middle ${
                label === 'EXEMPT'
                    ? 'border-border/25 bg-muted/[0.035] text-muted-foreground'
                    : hasTarget
                      ? 'border-border/25 bg-muted/[0.055] text-muted-foreground'
                      : 'border-border/25 bg-muted/[0.035] text-muted-foreground'
            }`}
            style={{ width: '104px', minWidth: '104px', maxWidth: '104px' }}
            title={
                hasTarget
                    ? mode === 'value'
                        ? `${moneyFormatter(targetValue)} required adjustment for this row`
                        : `${targetPct.toFixed(0)}% suggested adjustment for this row`
                    : undefined
            }
        >
            {showStats ? displayText : ''}
        </td>
    );
}

type PositionAdjustmentProgressCellProps = {
    showStats: boolean;
    plannedValue: number;
    currentValue: number;
    requiredValue?: number;
    tolerance?: number;
    enforceTarget?: boolean;
    editablePercent?: boolean;
    onFocus?: () => void;
    onChangePercent?: (value: string) => void;
    moneyFormatter?: MoneyFormatter;
};

export function PositionAdjustmentProgressCell({
    showStats,
    plannedValue,
    currentValue,
    requiredValue = 0,
    tolerance = 0,
    enforceTarget = true,
    editablePercent = false,
    onFocus,
    onChangePercent,
    moneyFormatter = formatMoney,
}: PositionAdjustmentProgressCellProps) {
    const progressPct =
        currentValue > 0 ? Math.min(100, (plannedValue / currentValue) * 100) : 0;
    const [percentDraft, setPercentDraft] = React.useState<string | null>(null);
    const percentDisplayValue =
        percentDraft ?? (plannedValue > 0 ? `${Math.round(progressPct)}%` : '');
    const hasRequiredTarget = enforceTarget && requiredValue > 1;
    const targetMatched =
        hasRequiredTarget &&
        plannedValue > 0 &&
        plannedValue >= requiredValue - tolerance &&
        plannedValue <= requiredValue + tolerance;
    const overTarget =
        hasRequiredTarget && plannedValue > requiredValue + tolerance;
    const tone = targetMatched
        ? 'border-emerald-400/55 bg-emerald-500/[0.12] text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]'
        : overTarget
          ? 'border-warning/45 bg-warning/[0.09] text-warning'
          : progressPct > 0
            ? enforceTarget
                ? 'border-warning/35 bg-warning/[0.055] text-warning'
                : 'border-border/30 bg-background/15 text-foreground'
            : 'border-border/30 bg-background/15 text-muted-foreground';

    return (
        <td
            className={`h-[26px] text-center font-mono font-light text-[10px] border-r align-middle ${tone}`}
            style={{ width: '132px', minWidth: '132px', maxWidth: '132px' }}
            title={
                hasRequiredTarget
                    ? targetMatched
                        ? `Within execution tolerance: ${moneyFormatter(plannedValue)} recorded against ${moneyFormatter(requiredValue)} required`
                        : `${moneyFormatter(plannedValue)} recorded against ${moneyFormatter(requiredValue)} required; tolerance ${moneyFormatter(tolerance)}`
                    : currentValue > 0
                      ? `${moneyFormatter(plannedValue)} recorded adjustment from ${moneyFormatter(currentValue)}`
                      : undefined
            }
        >
            {showStats && editablePercent && currentValue > 0 ? (
                <input
                    data-position-adjustment-percent-input="true"
                    type="text"
                    inputMode="decimal"
                    value={percentDisplayValue}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                        onFocus?.();
                        setPercentDraft(
                            plannedValue > 0 ? String(Math.round(progressPct)) : '',
                        );
                        window.requestAnimationFrame(() => {
                            event.currentTarget.select();
                        });
                    }}
                    onBlur={() => {
                        setPercentDraft(null);
                    }}
                    onChange={(event) => {
                        setPercentDraft(event.target.value);
                        onChangePercent?.(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        const currentInput = event.currentTarget;
                        const inputs = Array.from(
                            document.querySelectorAll<HTMLInputElement>(
                                'input[data-position-adjustment-percent-input="true"]:not(:disabled)',
                            ),
                        );
                        const index = inputs.indexOf(currentInput);
                        const nextInput = inputs[index + 1];
                        window.requestAnimationFrame(() => {
                            if (nextInput) {
                                nextInput.focus();
                                nextInput.select();
                                return;
                            }
                            currentInput.blur();
                        });
                    }}
                    className="h-full w-full border-0 bg-transparent px-0 text-center font-mono text-[10px] font-light text-inherit outline-none placeholder:text-muted-foreground focus:bg-transparent"
                    placeholder="0%"
                    title="Enter current adjustment percentage"
                />
            ) : showStats && currentValue > 0 ? (
                targetMatched ? (
                    <span className="inline-flex items-center gap-1">
                        <span>✓</span>
                        <span>{progressPct.toFixed(0)}%</span>
                    </span>
                ) : (
                    `${progressPct.toFixed(0)}%`
                )
            ) : (
                ''
            )}
        </td>
    );
}

type PositionAdjustmentActionCellProps = {
    showStats: boolean;
    plannedValue: number;
    suggestedValue?: number;
    requiredValue?: number;
    tolerance?: number;
    currentValue?: number;
    value?: string;
    editable?: boolean;
    label?: string;
    enforceTarget?: boolean;
    emptyWhenZero?: boolean;
    onFocus?: () => void;
    onChangeValue?: (value: string) => void;
    onCommitSuggested?: (value: number) => void;
    inputTestId?: string;
    moneyFormatter?: MoneyFormatter;
};

export function PositionAdjustmentActionCell({
    showStats,
    plannedValue,
    suggestedValue = 0,
    requiredValue = 0,
    tolerance = 0,
    currentValue = 0,
    value = '',
    editable = false,
    label,
    enforceTarget = true,
    emptyWhenZero = false,
    onFocus,
    onChangeValue,
    onCommitSuggested,
    inputTestId,
    moneyFormatter = formatMoney,
}: PositionAdjustmentActionCellProps) {
    if (editable) {
        return (
            <td
                className={`review-reduce-cell h-[26px] border-r px-1 align-middle ${
                    plannedValue > 0
                        ? 'border-warning/60 bg-warning/[0.035]'
                        : suggestedValue > 0
                          ? 'border-warning/35 bg-background/10'
                          : 'border-border/30 bg-background/10'
                }`}
                style={{ width: '98px', minWidth: '98px', maxWidth: '98px' }}
            >
                {showStats ? (
                    <input
                        data-review-reduce-input="true"
                        data-position-adjustment-input="true"
                        data-testid={inputTestId}
                        type="number"
                        min="0"
                        max={Math.round(currentValue || 0)}
                        value={value}
                        onClick={(event) => event.stopPropagation()}
                        onFocus={onFocus}
                        onChange={(event) => {
                            const rawValue = event.target.value;
                            const numericValue = Number.parseFloat(rawValue);
                            const cappedValue =
                                rawValue === '' || !Number.isFinite(numericValue)
                                    ? rawValue
                                    : String(
                                          Math.min(
                                              Math.max(0, numericValue),
                                              currentValue || 0,
                                          ),
                                      );
                            onChangeValue?.(cappedValue);
                        }}
                        onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            const focusNextInput = () => {
                                const currentInput = event.currentTarget;
                                const inputs = Array.from(
                                    document.querySelectorAll<HTMLInputElement>(
                                        'input[data-position-adjustment-input="true"]:not(:disabled)',
                                    ),
                                );
                                const index = inputs.indexOf(currentInput);
                                const nextInput = inputs[index + 1];
                                window.requestAnimationFrame(() => {
                                    if (nextInput) {
                                        nextInput.focus();
                                        nextInput.select();
                                        return;
                                    }
                                    currentInput.blur();
                                });
                            };
                            const currentParsed = Number.parseFloat(
                                event.currentTarget.value || '',
                            );
                            if (Number.isFinite(currentParsed) && currentParsed > 0) {
                                focusNextInput();
                            } else if (suggestedValue > 0) {
                                onCommitSuggested?.(Math.round(suggestedValue));
                                focusNextInput();
                            } else {
                                focusNextInput();
                            }
                        }}
                        className={`h-[22px] w-full rounded border px-1 text-right font-mono text-[10px] outline-none placeholder:text-muted-foreground/70 focus:border-sky-300/80 ${
                            plannedValue > 0
                                ? 'border-warning/65 bg-background/40 text-warning'
                                : suggestedValue > 0
                                  ? 'border-border/45 bg-background/25 text-foreground focus:border-warning/70'
                                  : 'border-border/30 bg-background/15 text-muted-foreground'
                        }`}
                        placeholder={
                            suggestedValue > 0
                                ? Math.round(suggestedValue).toLocaleString()
                                : '0'
                        }
                        title={
                            suggestedValue > 0
                                ? `Suggested adjustment ${moneyFormatter(suggestedValue)}`
                                : 'No adjustment suggested'
                        }
                    />
                ) : null}
            </td>
        );
    }

    const remainingValue = Math.max(0, requiredValue - plannedValue);
    const hasRequiredTarget = enforceTarget && requiredValue > 0;
    const targetMatched =
        hasRequiredTarget &&
        plannedValue > 0 &&
        plannedValue >= requiredValue - tolerance &&
        plannedValue <= requiredValue + tolerance;
    const overTarget = hasRequiredTarget && plannedValue > requiredValue + tolerance;

    return (
        <td
            className={`review-reduce-cell h-[26px] text-center font-mono font-light text-[10px] border-r align-middle ${
                label === 'EXEMPT'
                    ? 'border-border/25 bg-muted/[0.03] text-muted-foreground'
                    : targetMatched
                      ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200'
                    : overTarget
                      ? 'border-warning/45 bg-warning/[0.08] text-warning'
                    : hasRequiredTarget
                      ? 'border-warning/40 bg-background/15 text-foreground'
                    : plannedValue > 0
                      ? 'border-border/30 bg-background/15 text-foreground'
                    : 'border-border/30 bg-background/20 text-muted-foreground'
            }`}
            style={{ width: '98px', minWidth: '98px', maxWidth: '98px' }}
            title={
                requiredValue > 0
                    ? `Needs ${moneyFormatter(requiredValue)}; recorded ${moneyFormatter(plannedValue)}; remaining ${moneyFormatter(remainingValue)}; tolerance ${moneyFormatter(tolerance)}`
                    : plannedValue > 0
                      ? `Recorded adjustment ${moneyFormatter(plannedValue)}`
                      : 'No adjustment recorded'
            }
        >
            {showStats
                ? label === 'EXEMPT'
                    ? ''
                    : label
                      ? label
                    : emptyWhenZero && plannedValue <= 0
                      ? ''
                      : plannedValue > 0
                        ? moneyFormatter(plannedValue)
                        : moneyFormatter(0)
                : ''}
        </td>
    );
}
