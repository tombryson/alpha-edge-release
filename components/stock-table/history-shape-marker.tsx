'use client';

import { useEffect, useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { portfolioShapeMarkerLabel, portfolioShapePreviewRows, type PortfolioShapeConfirmation } from '@/lib/portfolio-history-markers';
import type { ApprovedShape } from '@/lib/portfolio-shape-comparison';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import styles from './history-shape-marker.module.css';

type Props = {
    confirmation: PortfolioShapeConfirmation;
    confirmations?: PortfolioShapeConfirmation[];
    plotRight?: number;
    x1?: number;
    y1?: number;
    y2?: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
});
const percentFormatter = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });
const percent = (value: number | null) => value === null
    ? 'Unavailable' : `${percentFormatter.format(value)}%`;
const shortDateFormatter = new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

function ShapeBar({ shape, rows, previous = false }: {
    shape: ApprovedShape;
    rows: ReturnType<typeof portfolioShapePreviewRows>;
    previous?: boolean;
}) {
    if (shape.total === null || shape.total <= 0 || shape.total > 100.000001) return null;
    const column = previous ? 'previous' : 'approved';
    return (
        <div
            className={styles.shapeBar}
            role="img"
            aria-label={`${previous ? 'Previous' : 'Saved'} portfolio shape: ${rows.map(row => `${row.name} ${percent(row[column])}`).join(', ')}. ${percent(shape.total)} recorded.`}
        >
            {rows.map(row => row[column] !== null && row[column]! > 0 && (
                <span key={row.code} style={{ width: `${row[column]}%`, backgroundColor: row.color }}
                    title={`${row.name}: ${percent(row[column])}`} />
            ))}
        </div>
    );
}

export function HistoryShapeMarker({ confirmation: anchor, confirmations = [anchor], plotRight = Infinity, x1 = 0, y1 = 0, y2 = 0, open, onOpenChange }: Props) {
    const [selectedId, setSelectedId] = useState(anchor.id);
    const confirmation = confirmations.find(item => item.id === selectedId) ?? anchor;
    const grouped = confirmations.length > 1;
    const mobile = useMobileLayout();
    const labelRef = useRef<SVGTextElement>(null);
    const triggerRef = useRef<SVGGElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pinned = useRef(false);
    const titleId = useId();
    const contentId = useId();
    const { shape, previousShape } = confirmation;
    const comparing = previousShape !== null;
    const bottom = Math.max(y1, y2);
    const label = portfolioShapeMarkerLabel(confirmations);
    const labelWidth = Math.max(44, label.length * 6 + 12);
    const labelX = Math.max(38 + labelWidth / 2, Math.min(x1, plotRight - labelWidth / 2));
    const rows = portfolioShapePreviewRows(shape, comparing ? previousShape : null);
    const showShapeBar = shape.total !== null && shape.total > 0 && shape.total <= 100.000001;
    const date = dateFormatter.format(new Date(confirmation.occurredAt));
    const version = confirmation.demo ? `Demo approval ${confirmation.snapshotId ?? ''}`.trim()
        : confirmation.snapshotId === null ? 'Approved shape' : `Approved shape v${confirmation.snapshotId}`;

    function cancelClose() {
        if (closeTimer.current) clearTimeout(closeTimer.current);
    }
    function close() {
        cancelClose();
        pinned.current = false;
        onOpenChange(false);
    }
    function preview() {
        cancelClose();
        onOpenChange(true);
    }
    function scheduleClose() {
        cancelClose();
        if (pinned.current) return;
        // Bridge the small gap between the chart marker and the floating preview.
        closeTimer.current = setTimeout(() => {
            if (contentRef.current?.contains(document.activeElement)) return;
            onOpenChange(false);
        }, 180);
    }
    function togglePinned() {
        if (pinned.current) close();
        else {
            pinned.current = true;
            preview();
        }
    }

    useEffect(() => {
        if (!open) pinned.current = false;
    }, [open]);
    useEffect(() => () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
    }, []);

    return (
        <Popover.Root open={open} onOpenChange={(next) => next ? preview() : close()}>
            <Popover.Anchor virtualRef={{ current: {
                getBoundingClientRect: () => labelRef.current?.getBoundingClientRect() ?? new DOMRect(),
            } }} />
            <g
                ref={triggerRef}
                className={styles.marker}
                data-approval-count={confirmations.length}
                role="button"
                tabIndex={0}
                aria-label={grouped ? `${confirmations.length} ${anchor.demo ? 'demo' : 'approved'} shapes. View approved allocations` : `${version}, ${date}. View approved allocations`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? contentId : undefined}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch') preview(); }}
                onPointerLeave={scheduleClose}
                onFocus={preview}
                onBlur={scheduleClose}
                onClick={(event) => { event.stopPropagation(); togglePinned(); }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        togglePinned();
                    } else if (event.key === 'Escape') {
                        event.stopPropagation();
                        close();
                    } else if (event.key === 'ArrowDown' && open) {
                        event.preventDefault();
                        pinned.current = true;
                        contentRef.current?.focus();
                    }
                }}
            >
                <line x1={x1} x2={x1} y1={y1} y2={y2} className={styles.line} />
                <line x1={x1} x2={x1} y1={y1} y2={y2} stroke="transparent" strokeWidth={18} pointerEvents="stroke" />
                <rect x={labelX - labelWidth / 2} y={bottom - 24} width={labelWidth} height={24} fill="transparent" />
                <text ref={labelRef} x={labelX} y={bottom - 8} textAnchor="middle" className={styles.label}>
                    {label}
                </text>
            </g>
            <Popover.Portal>
                <Popover.Content
                    ref={contentRef}
                    id={contentId}
                    aria-labelledby={titleId}
                    aria-describedby={undefined}
                    tabIndex={-1}
                    className={`${styles.preview} ${comparing ? styles.comparing : ''}`}
                    side={mobile ? 'top' : 'right'}
                    align={mobile ? 'center' : 'end'}
                    sideOffset={12}
                    collisionPadding={12}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    onPointerEnter={cancelClose}
                    onPointerLeave={scheduleClose}
                    onFocusCapture={cancelClose}
                    onBlurCapture={scheduleClose}
                    onEscapeKeyDown={() => {
                        // Return keyboard users to their marker without reopening it on focus.
                        triggerRef.current?.focus();
                        close();
                    }}
                    onInteractOutside={(event) => {
                        if (event.target instanceof Node && triggerRef.current?.contains(event.target)) event.preventDefault();
                    }}
                >
                    <header className={styles.header}>
                        <div>
                            <h3 id={titleId}>{version}</h3>
                            <time dateTime={confirmation.occurredAt}>{date}</time>
                        </div>
                        <Popover.Close className={styles.close} aria-label="Close approved shape preview" title="Close preview">
                            <X size={16} aria-hidden="true" />
                        </Popover.Close>
                    </header>
                    {grouped && (
                        <div className={styles.approvalChoices} role="group" aria-label="Approvals in this group">
                            {confirmations.map(item => (
                                <button key={item.id} type="button" aria-pressed={item.id === confirmation.id}
                                    onClick={() => { pinned.current = true; setSelectedId(item.id); }}>
                                    <span>{item.demo ? 'Demo' : 'Approved'}{item.snapshotId !== null ? ` v${item.snapshotId}` : ''}</span>
                                    <time dateTime={item.occurredAt}>{dateFormatter.format(new Date(item.occurredAt))}</time>
                                </button>
                            ))}
                        </div>
                    )}
                    {(showShapeBar || comparing) && (
                        <div className={`${styles.shapeBarContainer} ${comparing ? styles.shapeBarPair : ''}`}>
                            {comparing && <div className={styles.shapeSummary}>
                                <span>Previous{previousShape.version !== null ? ` v${previousShape.version}` : ''}</span>
                                <time dateTime={previousShape.at}>{shortDateFormatter.format(new Date(previousShape.at))}</time>
                                <ShapeBar shape={previousShape} rows={rows} previous />
                            </div>}
                            <div className={styles.shapeSummary}>
                                {comparing && <>
                                    <span>Approved{shape.version !== null ? ` v${shape.version}` : ''}</span>
                                    <time dateTime={shape.at}>{shortDateFormatter.format(new Date(shape.at))}</time>
                                </>}
                                <ShapeBar shape={shape} rows={rows} />
                            </div>
                        </div>
                    )}
                    <div className={styles.allocations} tabIndex={0} role="region" aria-label="Saved asset class allocations">
                        {rows.length === 0 ? (
                            <p className={styles.message}>Allocations are unavailable for this saved shape.</p>
                        ) : (
                            <table>
                                <colgroup><col />{comparing && <col className={styles.weightColumn} />}<col className={styles.weightColumn} /></colgroup>
                                <thead><tr><th scope="col">Asset class</th>{comparing && <th scope="col">Previous %</th>}<th scope="col">Approved %</th></tr></thead>
                                <tbody>
                                    {rows.map(({ code, name, color, approved, previous }) => (
                                        <tr key={code}>
                                            <th scope="row">
                                                <span className={styles.name}>
                                                    <i aria-hidden="true" style={{ backgroundColor: color }} />
                                                    <span>{name}</span>
                                                </span>
                                            </th>
                                            {comparing && <td>{percent(previous)}</td>}
                                            <td>{percent(approved)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    {rows.length > 0 && <div className={styles.total}><span>Recorded total</span>
                        {comparing && <strong>{percent(previousShape.total)}</strong>}<strong>{percent(shape.total)}</strong></div>}
                    <footer className={styles.footer}>
                        {comparing && !previousShape.complete && <p>Previous shape is incomplete. Percentages are shown as recorded.</p>}
                        {rows.length > 0 && !shape.complete && <p>Incomplete saved shape. Percentages are shown as recorded.</p>}
                        <span>{confirmation.demo ? 'Simulated allocation. Not a real approval.' : 'Approved allocation, not holdings.'}</span>
                    </footer>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
