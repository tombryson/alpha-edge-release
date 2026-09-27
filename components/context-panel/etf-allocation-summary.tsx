'use client';

import { useEffect, useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight } from 'lucide-react';
import { allocationLineFill } from '@/lib/context-panel-model';
import { COMPACT_SHELL_QUERY, useMobileLayout } from '@/lib/use-mobile-layout';
import { requestTerminalTab, terminalRouteHash } from '@/lib/terminal-route';
import { AllocationViewControls, money } from './allocation-visuals';
import styles from '../etf-monitor.module.css';

export function ETFAllocationSummary({ actual, target }: { actual: number; target: number | null }) {
    const compact = useMobileLayout(COMPACT_SHELL_QUERY);
    const [open, setOpen] = useState(false);
    const pinned = useRef(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const id = useId();
    const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
    const close = () => { cancelClose(); pinned.current = false; setOpen(false); };
    const preview = () => { cancelClose(); setOpen(true); };
    const scheduleClose = () => {
        cancelClose();
        if (pinned.current) return;
        closeTimer.current = setTimeout(() => {
            if (!content.current?.contains(document.activeElement)) setOpen(false);
        }, 180);
    };
    useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

    const fill = allocationLineFill(actual, target);
    const difference = target === null ? null : Math.round(actual - target);
    const direction = difference === null || difference === 0 ? 'neutral' : difference > 0 ? 'above' : 'below';
    const signedDifference = difference === null ? '\u2014' : `${difference > 0 ? '+' : difference < 0 ? '\u2212' : ''}${money(Math.abs(difference))}`;
    const caption = `${money(actual)} held, ${target === null ? 'no approved ETF target' : `${money(target)} ETF target`}`;
    // A zero target means every held dollar is excess, not 80% empty capacity.
    const marker = target === 0 ? '0%' : '80%';
    const excess = target === 0 && actual > 0 ? 100 : fill.excess;

    return <section className={styles.summary} aria-label="ETF allocations">
        <div className={styles.summaryHeading}>
            {/* The title is the way into the ETF tab; modified clicks open it in a new tab. */}
            <h3>
                <a className={styles.summaryTitleLink} href={terminalRouteHash({ tab: 'ETF' })} title="Open ETF ranking and allocations"
                    onClick={event => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        requestTerminalTab('ETF');
                    }}>
                    <span>ETF allocations</span><ArrowUpRight aria-hidden="true" />
                </a>
            </h3>
            <AllocationViewControls />
        </div>
        <Popover.Root open={open} onOpenChange={next => next ? preview() : close()}>
            <Popover.Anchor asChild>
                <button ref={trigger} type="button" className={styles.summaryTrigger}
                    aria-label={`ETF allocation: ${caption}. View details`}
                    aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
                    onPointerEnter={event => { if (event.pointerType !== 'touch') preview(); }}
                    onPointerLeave={scheduleClose} onFocus={preview} onBlur={scheduleClose}
                    onClick={() => { if (pinned.current) close(); else { pinned.current = true; preview(); } }}
                    onKeyDown={event => { if (event.key === 'Escape') close(); }}>
                    <span className={styles.summaryAmountsRow}>
                        <span className={styles.summaryAmounts} aria-label={caption}>
                            <span>{money(actual)}</span><span className={styles.summarySlash}>/</span><span>{money(target)}</span>
                        </span>
                        <span className={styles.summaryDifference} data-direction={direction}>{signedDifference}</span>
                    </span>
                    <span className={styles.summaryLine} role="img" aria-label={caption}>
                        <span style={{ width: `${fill.funded}%` }} />
                        <span className={styles.excess} style={{ left: marker, width: `${excess}%` }} />
                        {target !== null && <i className={styles.targetMarker} style={{ left: marker }} aria-hidden="true" />}
                    </span>
                </button>
            </Popover.Anchor>
            <Popover.Portal>
                <Popover.Content ref={content} id={id} className={styles.summaryDetails} aria-label="ETF allocation details"
                    side={compact ? 'bottom' : 'left'} align="start" sideOffset={8} collisionPadding={12}
                    onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
                    onPointerEnter={cancelClose} onPointerLeave={scheduleClose} onFocusCapture={cancelClose} onBlurCapture={scheduleClose}
                    onInteractOutside={event => { if (event.target instanceof Node && trigger.current?.contains(event.target)) event.preventDefault(); }}>
                    <dl>
                        <div><dt>Held</dt><dd>{money(actual)}</dd></div>
                        <div><dt>ETF target</dt><dd>{target === null ? 'Not set' : money(target)}</dd></div>
                        <div><dt>Difference</dt><dd data-direction={direction}>{signedDifference}</dd></div>
                    </dl>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    </section>;
}
