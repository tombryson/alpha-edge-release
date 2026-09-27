'use client';

import { useEffect, useRef, useState, type CSSProperties, type MouseEventHandler } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { Pencil, Search } from 'lucide-react';
import { AssetClassColourControl } from '@/components/asset-class-colour-dialog';
import { useClassColours } from '@/lib/asset-class-colour-store';
import { assetClassColor } from '@/lib/asset-class-identity';
import { resolveRowIcon, rowIconUsesClassColour } from '@/lib/position-row-appearance';
import { usePositionRowAppearance } from '@/lib/position-row-appearance-store';
import { PositionRowEmblem, ROW_EMBLEM_OPTIONS } from './position-row-emblem';
import styles from './position-row-appearance.module.css';

export function PositionRowIconPicker({ code, label, expanded, onToggle }: {
    code: string; label: string; expanded: boolean; onToggle: MouseEventHandler<HTMLButtonElement>;
}) {
    const emblem = usePositionRowAppearance(state => resolveRowIcon(state.preferences, code));
    const saveIcon = usePositionRowAppearance(state => state.saveIcon);
    const useClassColour = usePositionRowAppearance(state => rowIconUsesClassColour(state.preferences, code));
    const saveIconColour = usePositionRowAppearance(state => state.saveIconColour);
    const [open, setOpen] = useState(false);
    const [selectorReady, setSelectorReady] = useState(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const pointerType = useRef('');
    const suppressClick = useRef(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);
    const clearTimer = () => {
        if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
    };
    const resetSelector = () => { clearTimer(); setSelectorReady(false); touchStart.current = null; };
    const changeOpen = (next: boolean) => {
        resetSelector(); setOpen(next); setError(''); setQuery('');
    };
    const scheduleSelector = (activate = () => setSelectorReady(true)) => {
        clearTimer();
        hoverTimer.current = setTimeout(() => { hoverTimer.current = null; activate(); }, 800);
    };
    useEffect(() => () => { if (hoverTimer.current !== null) clearTimeout(hoverTimer.current); }, []);
    const selecting = open || selectorReady;
    const triggerLabel = selecting ? `Choose icon for ${label}` : `${expanded ? 'Collapse' : 'Expand'} ${label}`;
    const coloursReady = useClassColours(state => state.ready);
    const colourError = useClassColours(state => state.error);
    const refreshing = useClassColours(state => state.refreshing);
    const refreshColours = useClassColours(state => state.refresh);
    useEffect(() => { if (open && !coloursReady) void refreshColours(); }, [open, coloursReady, refreshColours]);
    const matches = ROW_EMBLEM_OPTIONS.filter(option => {
        if (option.group === 'Selection') return false;
        const terms = `${option.label} ${option.group} ${'classes' in option ? option.classes.join(' ').replaceAll('_', ' ') : ''}`.toLowerCase();
        return query.toLowerCase().trim().split(/\s+/).every(term => terms.includes(term));
    });
    const groups = [...new Set(matches.map(option => option.group))];
    const choices = (options: typeof ROW_EMBLEM_OPTIONS) => <div className={styles.icons}>
        {options.map(({ value, label: option, icon: Icon }) => (
            <button type="button" key={value} className={styles.iconOption} aria-label={option} title={option} data-icon-choice=""
                aria-pressed={emblem === value} onClick={() => {
                    try { saveIcon(code, value); changeOpen(false); }
                    catch { setError('Icon could not be saved. Please try again.'); }
                }}>{value === 'none' ? <PositionRowEmblem code={code} emblem="none" expanded={expanded} /> : <Icon size={18} aria-hidden="true" />}</button>
        ))}
    </div>;

    return <Popover.Root open={open} onOpenChange={changeOpen}>
        <span className={styles.iconSlot} data-icon-slot="">
        <Popover.Trigger asChild>
            <button type="button" className={styles.iconTrigger} draggable={false}
                aria-label={triggerLabel} title={selecting ? triggerLabel : undefined} data-row-icon={emblem}
                data-icon-mode={selecting ? 'selector' : 'disclosure'}
                aria-expanded={selecting ? open : expanded} aria-haspopup={selecting ? 'dialog' : undefined}
                aria-keyshortcuts="ArrowDown F2"
                data-icon-colour={useClassColour ? 'class' : 'neutral'}
                onPointerEnter={event => { if (event.pointerType !== 'touch' && !event.buttons && !open) scheduleSelector(); }}
                onPointerLeave={resetSelector} onPointerCancel={resetSelector} onBlur={resetSelector}
                onPointerDown={event => {
                    event.stopPropagation(); clearTimer(); pointerType.current = event.pointerType; suppressClick.current = false;
                    if (event.pointerType === 'touch') {
                        touchStart.current = { x: event.clientX, y: event.clientY };
                        scheduleSelector(() => { suppressClick.current = true; changeOpen(true); });
                    }
                }}
                onPointerMove={event => {
                    if (touchStart.current && Math.hypot(event.clientX - touchStart.current.x, event.clientY - touchStart.current.y) > 8) resetSelector();
                }}
                onPointerUp={() => { clearTimer(); touchStart.current = null; }}
                onClick={event => {
                    event.stopPropagation();
                    if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); return; }
                    if (selecting) return;
                    // Prevent Radix opening the picker on an ordinary disclosure click.
                    event.preventDefault(); resetSelector(); onToggle(event);
                    if (event.detail > 0 && pointerType.current === 'mouse') scheduleSelector();
                }}
                onKeyDown={event => {
                    if (event.key === 'ArrowDown' || event.key === 'F2' || (event.shiftKey && event.key === 'F10')) {
                        event.preventDefault(); event.stopPropagation(); changeOpen(true);
                    } else if (event.key === 'Escape' && !open) resetSelector();
                }}
                onContextMenu={event => {
                    event.preventDefault(); event.stopPropagation();
                    if (pointerType.current !== 'touch') changeOpen(true);
                }}
                onDoubleClick={event => event.stopPropagation()}
                onDragStart={event => { resetSelector(); event.preventDefault(); event.stopPropagation(); }}>
                {selecting ? <Pencil size={16} data-selector-icon="" aria-hidden="true" /> : <PositionRowEmblem code={code} emblem={emblem} expanded={expanded} />}
            </button>
        </Popover.Trigger>
        </span>
        <Popover.Portal>
            <Popover.Content ref={contentRef} className={styles.iconPicker} align="start" sideOffset={6} collisionPadding={12}
                onOpenAutoFocus={event => { event.preventDefault(); contentRef.current?.querySelector<HTMLButtonElement>('[data-icon-choice]')?.focus(); }}
                aria-label={`Icon for ${label}`} onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
                onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
                <div className={styles.iconHeading}>
                    <span>{label}</span>
                    <AssetClassColourControl assetClass={{ code, display_name: label }} variant="swatch" className={styles.rowColourButton} />
                </div>
                {!coloursReady && colourError && <div className={styles.colourError}>
                    <span role="alert">Saved colours are unavailable.</span>
                    <button type="button" disabled={refreshing} onClick={() => void refreshColours()}>Retry</button>
                </div>}
                <label className={styles.iconSearch}>
                    <Search size={15} aria-hidden="true" />
                    <input type="search" aria-label="Search icons" placeholder="Search icons" value={query} onChange={event => setQuery(event.target.value)} />
                </label>
                <div className={styles.iconQuickChoices}>
                    {choices(ROW_EMBLEM_OPTIONS.filter(option => option.group === 'Selection'))}
                    <RadioGroup.Root className={styles.iconColourChoices} aria-label="Icon colour" orientation="horizontal"
                        style={{ '--icon-class-colour': assetClassColor(code) } as CSSProperties}
                        value={useClassColour ? 'class' : 'neutral'} onValueChange={value => {
                            try { saveIconColour(code, value === 'class'); setError(''); }
                            catch { setError('Icon colour preference could not be saved. Please try again.'); }
                        }}>
                        <RadioGroup.Item value="neutral" className={styles.iconColourOption} aria-label="Neutral" title="Neutral">
                            <PositionRowEmblem code={code} emblem={emblem} expanded={expanded} />
                        </RadioGroup.Item>
                        <RadioGroup.Item value="class" className={styles.iconColourOption} aria-label="Class colour" title="Class colour">
                            <PositionRowEmblem code={code} emblem={emblem} expanded={expanded} />
                        </RadioGroup.Item>
                    </RadioGroup.Root>
                </div>
                <div className={styles.iconResults}>
                    {groups.map(group => <section className={styles.iconGroup} key={group} aria-label={group}>
                        <h3>{group}</h3>
                        {choices(matches.filter(option => option.group === group))}
                    </section>)}
                    {matches.length === 0 && <p className={styles.iconEmpty} role="status">No matching icons</p>}
                </div>
                {error && <p className={styles.error} role="alert">{error}</p>}
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>;
}
