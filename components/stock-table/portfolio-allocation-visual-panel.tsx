import type {
    Dispatch,
    MutableRefObject,
    SetStateAction,
    MouseEvent as ReactMouseEvent,
} from 'react';
import { PortfolioCompositionPie } from '@/components/portfolio-composition-pie';
import type {
    PortfolioTargetBarDrag,
    PortfolioTargetBarEditor,
    PortfolioVisualMode,
} from '@/components/stock-table/types';
import type {
    PortfolioPieRow,
    PortfolioVisualSegment,
} from '@/components/stock-table/portfolio-visual-data';

type PortfolioStackedBarProps = {
    label: string;
    segments: PortfolioVisualSegment[];
    targetEditable: boolean;
    portfolioBarEqualWidth: boolean;
    portfolioTargetBarEditor: PortfolioTargetBarEditor;
    portfolioTargetBarDragRef: MutableRefObject<PortfolioTargetBarDrag | null>;
    setPortfolioTargetBarEditor: Dispatch<
        SetStateAction<PortfolioTargetBarEditor>
    >;
    setPortfolioTargetBarLockedOrder: Dispatch<SetStateAction<string[] | null>>;
    pct1: (value?: number | null) => string;
    formatPortfolioTargetPctInput: (value: number) => string;
    hoverPortfolioAssetClasses: (assetClassCodes?: string[] | null) => void;
    clearHoveredPortfolioAssetClass: () => void;
    selectPortfolioAssetClass: (assetClassCode?: string | null) => void;
    updatePortfolioTargetBalanced: (
        assetClassCode: string,
        rawValue: string | number,
    ) => void;
    updatePortfolioTargetAdjacentPair: (
        leftAssetClass: string,
        rightAssetClass: string,
        nextLeftPct: number,
        nextRightPct: number,
    ) => void;
};

function PortfolioStackedBar({
    label,
    segments,
    targetEditable,
    portfolioBarEqualWidth,
    portfolioTargetBarEditor,
    portfolioTargetBarDragRef,
    setPortfolioTargetBarEditor,
    setPortfolioTargetBarLockedOrder,
    pct1,
    formatPortfolioTargetPctInput,
    hoverPortfolioAssetClasses,
    clearHoveredPortfolioAssetClass,
    selectPortfolioAssetClass,
    updatePortfolioTargetBalanced,
    updatePortfolioTargetAdjacentPair,
}: PortfolioStackedBarProps) {
    const total = segments.reduce((sum, segment) => sum + segment.pct, 0);
    const segmentWidth = (pct: number) =>
        total > 0 ? `${Math.max((pct / total) * 100, 0)}%` : '0%';

    const commitTargetBarEdit = () => {
        if (!portfolioTargetBarEditor) return;
        updatePortfolioTargetBalanced(
            portfolioTargetBarEditor.assetClass,
            portfolioTargetBarEditor.value,
        );
        setPortfolioTargetBarEditor(null);
        setPortfolioTargetBarLockedOrder(null);
    };

    const lockTargetBarOrder = () => {
        setPortfolioTargetBarLockedOrder(segments.map((segment) => segment.key));
    };

    const startTargetBoundaryDrag = (
        event: ReactMouseEvent<HTMLDivElement>,
        index: number,
    ) => {
        const left = segments[index];
        const right = segments[index + 1];
        if (
            !targetEditable ||
            !left ||
            !right ||
            left.assetClassCodes.length !== 1 ||
            right.assetClassCodes.length !== 1
        ) {
            return;
        }

        const track = event.currentTarget.closest(
            '[data-portfolio-target-bar-track="true"]',
        ) as HTMLElement | null;
        const barWidth = track?.getBoundingClientRect().width || 0;
        if (barWidth <= 0) return;

        event.preventDefault();
        event.stopPropagation();
        lockTargetBarOrder();
        portfolioTargetBarDragRef.current = {
            leftAssetClass: left.assetClassCodes[0],
            rightAssetClass: right.assetClassCodes[0],
            startX: event.clientX,
            barWidth,
            leftStartPct: left.rawPct,
            rightStartPct: right.rawPct,
        };

        const handleMove = (moveEvent: MouseEvent) => {
            const drag = portfolioTargetBarDragRef.current;
            if (!drag) return;
            const deltaPct =
                ((moveEvent.clientX - drag.startX) / drag.barWidth) * 100;
            const boundedDelta = Math.max(
                -drag.leftStartPct,
                Math.min(drag.rightStartPct, deltaPct),
            );
            updatePortfolioTargetAdjacentPair(
                drag.leftAssetClass,
                drag.rightAssetClass,
                drag.leftStartPct + boundedDelta,
                drag.rightStartPct - boundedDelta,
            );
        };

        const handleEnd = () => {
            portfolioTargetBarDragRef.current = null;
            setPortfolioTargetBarLockedOrder(null);
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleEnd);
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);
    };

    return (
        <div className="grid grid-cols-[84px_minmax(0,1fr)_46px] items-start gap-3">
            <div className="pt-2">
                <div className="text-[11px] font-semibold text-foreground">
                    {label}
                </div>
            </div>
            <div className="relative min-w-0">
                <div
                    className={`flex h-10 w-full overflow-hidden rounded ${
                        targetEditable ? 'border' : ''
                    }`}
                    style={
                        targetEditable
                            ? {
                                  borderColor:
                                      'var(--portfolio-target-bar-border)',
                              }
                            : undefined
                    }
                    data-portfolio-target-bar-track={
                        targetEditable ? 'true' : undefined
                    }
                >
                    {segments.map((segment, index) => (
                        <div
                            key={`${label}-${segment.key}`}
                            title={`${segment.label} ${pct1(segment.rawPct)}`}
                            className={`group relative h-full min-w-0 ${
                                segment.assetClassCodes.length > 0
                                    ? 'cursor-pointer'
                                    : 'cursor-default'
                            } ${targetEditable && index > 0 ? 'border-l' : ''}`}
                            style={{
                                width: segmentWidth(segment.pct),
                                backgroundColor: segment.color,
                                borderColor: targetEditable
                                    ? 'var(--portfolio-target-bar-border)'
                                    : undefined,
                            }}
                            onMouseEnter={() =>
                                hoverPortfolioAssetClasses(
                                    segment.assetClassCodes,
                                )
                            }
                            onMouseLeave={clearHoveredPortfolioAssetClass}
                            onClick={() => {
                                if (segment.assetClassCodes.length !== 1) {
                                    return;
                                }
                                selectPortfolioAssetClass(
                                    segment.assetClassCodes[0],
                                );
                                if (targetEditable) {
                                    lockTargetBarOrder();
                                    setPortfolioTargetBarEditor({
                                        assetClass: segment.assetClassCodes[0],
                                        value: formatPortfolioTargetPctInput(
                                            segment.rawPct,
                                        ),
                                    });
                                }
                            }}
                        >
                            <div className="absolute inset-0 bg-white/0 transition-colors group-hover:bg-white/10" />
                            {targetEditable && (
                                <div className="absolute inset-x-0 top-0 h-1 bg-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
                            )}
                            {targetEditable &&
                                !portfolioBarEqualWidth &&
                                index < segments.length - 1 && (
                                    <div
                                        aria-hidden="true"
                                        className="absolute right-[-4px] top-0 z-20 h-full w-[8px] cursor-col-resize border-x bg-black/0 transition-colors hover:bg-black/20"
                                        style={{
                                            borderColor:
                                                'var(--portfolio-target-bar-border)',
                                        }}
                                        onMouseDown={(event) =>
                                            startTargetBoundaryDrag(event, index)
                                        }
                                    />
                                )}
                        </div>
                    ))}
                </div>

                <div className="mt-2 flex w-full">
                    {segments.map((segment) => {
                        const segmentHasAssetClass =
                            segment.assetClassCodes.length > 0;
                        const segmentEditable =
                            targetEditable &&
                            segment.assetClassCodes.length === 1;
                        const segmentEditing =
                            segmentEditable &&
                            portfolioTargetBarEditor?.assetClass ===
                                segment.assetClassCodes[0];

                        const openSegmentEditor = () => {
                            if (!segmentEditable) return;
                            selectPortfolioAssetClass(segment.assetClassCodes[0]);
                            lockTargetBarOrder();
                            setPortfolioTargetBarEditor({
                                assetClass: segment.assetClassCodes[0],
                                value: formatPortfolioTargetPctInput(
                                    segment.rawPct,
                                ),
                            });
                        };

                        const handleSegmentBlockClick = () => {
                            if (!segmentHasAssetClass) return;
                            if (segment.assetClassCodes.length === 1) {
                                selectPortfolioAssetClass(
                                    segment.assetClassCodes[0],
                                );
                            }
                            openSegmentEditor();
                        };

                        return (
                            <div
                                key={`${label}-${segment.key}-label`}
                                className={`min-w-0 px-0.5 text-center font-mono uppercase leading-tight ${
                                    segmentHasAssetClass
                                        ? 'cursor-pointer'
                                        : 'cursor-default'
                                }`}
                                style={{ width: segmentWidth(segment.pct) }}
                                title={
                                    segmentEditable
                                        ? `Edit ${segment.label} target`
                                        : `${segment.label} ${pct1(segment.rawPct)}`
                                }
                                onMouseEnter={() =>
                                    hoverPortfolioAssetClasses(
                                        segment.assetClassCodes,
                                    )
                                }
                                onMouseLeave={clearHoveredPortfolioAssetClass}
                                onClick={handleSegmentBlockClick}
                            >
                                <div
                                    className={`mx-auto block max-w-full rounded-sm px-1.5 py-0.5 text-[11px] transition-colors ${
                                        segmentHasAssetClass
                                            ? 'cursor-pointer hover:bg-white/[0.045] hover:text-white'
                                            : 'cursor-default'
                                    } ${
                                        segmentEditable
                                            ? 'text-[var(--portfolio-target-bar-label)]'
                                            : 'text-muted-foreground'
                                    }`}
                                >
                                    <span className="block truncate">
                                        {segment.label}
                                    </span>
                                    {segmentEditing &&
                                    portfolioTargetBarEditor ? (
                                        <input
                                            autoFocus
                                            type="text"
                                            inputMode="decimal"
                                            value={portfolioTargetBarEditor.value}
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                            onChange={(event) =>
                                                setPortfolioTargetBarEditor({
                                                    assetClass:
                                                        portfolioTargetBarEditor.assetClass,
                                                    value: event.target.value,
                                                })
                                            }
                                            onBlur={commitTargetBarEdit}
                                            onKeyDown={(event) => {
                                                if (
                                                    event.key === 'ArrowUp' ||
                                                    event.key === 'ArrowDown'
                                                ) {
                                                    event.preventDefault();
                                                    const current =
                                                        Number.parseFloat(
                                                            portfolioTargetBarEditor.value,
                                                        );
                                                    const step = event.shiftKey
                                                        ? 1
                                                        : 0.1;
                                                    const direction =
                                                        event.key === 'ArrowUp'
                                                            ? 1
                                                            : -1;
                                                    const nextValue = Math.max(
                                                        0,
                                                        Math.min(
                                                            100,
                                                            Math.round(
                                                                ((Number.isFinite(
                                                                    current,
                                                                )
                                                                    ? current
                                                                    : segment.rawPct) +
                                                                    direction *
                                                                        step) *
                                                                    10,
                                                            ) / 10,
                                                        ),
                                                    );
                                                    const value =
                                                        formatPortfolioTargetPctInput(
                                                            nextValue,
                                                        );
                                                    setPortfolioTargetBarEditor({
                                                        assetClass:
                                                            portfolioTargetBarEditor.assetClass,
                                                        value,
                                                    });
                                                    updatePortfolioTargetBalanced(
                                                        portfolioTargetBarEditor.assetClass,
                                                        value,
                                                    );
                                                } else if (
                                                    event.key === 'Enter'
                                                ) {
                                                    event.currentTarget.blur();
                                                } else if (
                                                    event.key === 'Escape'
                                                ) {
                                                    setPortfolioTargetBarEditor(null);
                                                    setPortfolioTargetBarLockedOrder(
                                                        null,
                                                    );
                                                }
                                            }}
                                            className="mx-auto mt-0.5 block h-[18px] w-[4.2rem] rounded-sm border px-1 text-center font-mono text-[9px] outline-none"
                                            style={{
                                                borderColor:
                                                    'var(--portfolio-target-bar-border)',
                                                backgroundColor:
                                                    'var(--background)',
                                                color: 'var(--foreground)',
                                            }}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleSegmentBlockClick();
                                            }}
                                            onKeyDown={(event) => {
                                                if (
                                                    event.key === 'ArrowUp' ||
                                                    event.key === 'ArrowDown'
                                                ) {
                                                    event.preventDefault();
                                                    openSegmentEditor();
                                                    const step = event.shiftKey
                                                        ? 1
                                                        : 0.1;
                                                    const direction =
                                                        event.key === 'ArrowUp'
                                                            ? 1
                                                            : -1;
                                                    const nextValue = Math.max(
                                                        0,
                                                        Math.min(
                                                            100,
                                                            Math.round(
                                                                (segment.rawPct +
                                                                    direction *
                                                                        step) *
                                                                    10,
                                                            ) / 10,
                                                        ),
                                                    );
                                                    const value =
                                                        formatPortfolioTargetPctInput(
                                                            nextValue,
                                                        );
                                                    setPortfolioTargetBarEditor({
                                                        assetClass:
                                                            segment
                                                                .assetClassCodes[0],
                                                        value,
                                                    });
                                                    updatePortfolioTargetBalanced(
                                                        segment.assetClassCodes[0],
                                                        value,
                                                    );
                                                }
                                            }}
                                            className={`mx-auto mt-0.5 block h-[18px] max-w-full rounded-sm border px-1.5 font-mono text-[9px] transition-colors ${
                                                segmentHasAssetClass
                                                    ? 'cursor-pointer hover:text-white'
                                                    : 'cursor-default'
                                            } ${
                                                segmentEditable
                                                    ? 'text-[var(--portfolio-target-bar-label)]'
                                                    : 'text-muted-foreground'
                                            }`}
                                            style={{
                                                borderColor: segmentEditable
                                                    ? 'var(--portfolio-target-bar-border)'
                                                    : 'transparent',
                                                backgroundColor: segmentEditable
                                                    ? 'var(--portfolio-target-bar-pill-bg)'
                                                    : 'transparent',
                                            }}
                                        >
                                            {pct1(segment.rawPct)}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="pt-2 text-right text-[11px] font-mono text-muted-foreground">
                {pct1(total)}
            </div>
        </div>
    );
}

export function PortfolioAllocationVisualPanel({
    currentSegments,
    targetSegments,
    currentPieRows,
    targetPieRows,
    showComparison,
    isPortfolioRebalanceMode,
    hasPortfolioRebalancePlan,
    portfolioRebalanceRowCount,
    portfolioVisualMode,
    setPortfolioVisualMode,
    portfolioBarFlatten,
    setPortfolioBarFlatten,
    portfolioBarEqualWidth,
    setPortfolioBarEqualWidth,
    portfolioTargetBarEditor,
    portfolioTargetBarDragRef,
    setPortfolioTargetBarEditor,
    setPortfolioTargetBarLockedOrder,
    hoveredPortfolioAssetClassCodes,
    pct1,
    formatPortfolioTargetPctInput,
    hoverPortfolioAssetClasses,
    clearHoveredPortfolioAssetClass,
    selectPortfolioAssetClass,
    updatePortfolioTargetBalanced,
    updatePortfolioTargetAdjacentPair,
}: {
    currentSegments: PortfolioVisualSegment[];
    targetSegments: PortfolioVisualSegment[];
    currentPieRows: PortfolioPieRow[];
    targetPieRows: PortfolioPieRow[];
    showComparison: boolean;
    isPortfolioRebalanceMode: boolean;
    hasPortfolioRebalancePlan: boolean;
    portfolioRebalanceRowCount: number;
    portfolioVisualMode: PortfolioVisualMode;
    setPortfolioVisualMode: Dispatch<SetStateAction<PortfolioVisualMode>>;
    portfolioBarFlatten: boolean;
    setPortfolioBarFlatten: Dispatch<SetStateAction<boolean>>;
    portfolioBarEqualWidth: boolean;
    setPortfolioBarEqualWidth: Dispatch<SetStateAction<boolean>>;
    portfolioTargetBarEditor: PortfolioTargetBarEditor;
    portfolioTargetBarDragRef: MutableRefObject<PortfolioTargetBarDrag | null>;
    setPortfolioTargetBarEditor: Dispatch<
        SetStateAction<PortfolioTargetBarEditor>
    >;
    setPortfolioTargetBarLockedOrder: Dispatch<SetStateAction<string[] | null>>;
    hoveredPortfolioAssetClassCodes: string[];
    pct1: (value?: number | null) => string;
    formatPortfolioTargetPctInput: (value: number) => string;
    hoverPortfolioAssetClasses: (assetClassCodes?: string[] | null) => void;
    clearHoveredPortfolioAssetClass: () => void;
    selectPortfolioAssetClass: (assetClassCode?: string | null) => void;
    updatePortfolioTargetBalanced: (
        assetClassCode: string,
        rawValue: string | number,
    ) => void;
    updatePortfolioTargetAdjacentPair: (
        leftAssetClass: string,
        rightAssetClass: string,
        nextLeftPct: number,
        nextRightPct: number,
    ) => void;
}) {
    if (currentSegments.length === 0 && targetSegments.length === 0) {
        return null;
    }

    const targetEditable =
        isPortfolioRebalanceMode &&
        !hasPortfolioRebalancePlan &&
        portfolioRebalanceRowCount > 0;

    const stackedBarProps = {
        portfolioBarEqualWidth,
        portfolioTargetBarEditor,
        portfolioTargetBarDragRef,
        setPortfolioTargetBarEditor,
        setPortfolioTargetBarLockedOrder,
        pct1,
        formatPortfolioTargetPctInput,
        hoverPortfolioAssetClasses,
        clearHoveredPortfolioAssetClass,
        selectPortfolioAssetClass,
        updatePortfolioTargetBalanced,
        updatePortfolioTargetAdjacentPair,
    };

    return (
        <div className="shrink-0 border-t border-border/50 bg-background/20 px-3 py-4">
            <div className="rounded-lg border border-border/45 bg-card/25 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                            Portfolio Shape
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {portfolioVisualMode === 'bar' && (
                            <div className="flex items-center gap-3">
                                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                    <input
                                        className="h-3 w-3"
                                        type="checkbox"
                                        checked={portfolioBarFlatten}
                                        onChange={(event) =>
                                            setPortfolioBarFlatten(
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    Flatten
                                </label>
                                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                    <input
                                        className="h-3 w-3"
                                        type="checkbox"
                                        checked={portfolioBarEqualWidth}
                                        onChange={(event) =>
                                            setPortfolioBarEqualWidth(
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    Split
                                </label>
                            </div>
                        )}
                        <div className="inline-flex rounded border border-border/50 bg-background/35 p-0.5 text-[10px] font-mono uppercase">
                            <button
                                type="button"
                                onClick={() => setPortfolioVisualMode('bar')}
                                className={`rounded px-2 py-1 ${
                                    portfolioVisualMode === 'bar'
                                        ? 'bg-foreground text-background'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                Bar
                            </button>
                            <button
                                type="button"
                                onClick={() => setPortfolioVisualMode('pie')}
                                className={`rounded px-2 py-1 ${
                                    portfolioVisualMode === 'pie'
                                        ? 'bg-foreground text-background'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                Pie
                            </button>
                        </div>
                    </div>
                </div>

                {portfolioVisualMode === 'bar' ? (
                    <div className="space-y-4">
                        <PortfolioStackedBar
                            label="Current"
                            segments={currentSegments}
                            targetEditable={false}
                            {...stackedBarProps}
                        />
                        {showComparison && (
                            <PortfolioStackedBar
                                label="Target"
                                segments={targetSegments}
                                targetEditable={targetEditable}
                                {...stackedBarProps}
                            />
                        )}
                    </div>
                ) : (
                    <div
                        className={
                            showComparison
                                ? 'grid gap-4 md:grid-cols-2'
                                : 'grid gap-4'
                        }
                    >
                        <PortfolioCompositionPie
                            title="Current Portfolio"
                            rows={currentPieRows}
                            activeAssetClassCodes={hoveredPortfolioAssetClassCodes}
                            onAssetClassHover={(assetClassCodes) =>
                                assetClassCodes.length
                                    ? hoverPortfolioAssetClasses(assetClassCodes)
                                    : clearHoveredPortfolioAssetClass()
                            }
                        />
                        {showComparison && (
                            <PortfolioCompositionPie
                                title="Target Portfolio"
                                rows={targetPieRows}
                                activeAssetClassCodes={
                                    hoveredPortfolioAssetClassCodes
                                }
                                onAssetClassHover={(assetClassCodes) =>
                                    assetClassCodes.length
                                        ? hoverPortfolioAssetClasses(
                                              assetClassCodes,
                                          )
                                        : clearHoveredPortfolioAssetClass()
                                }
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
