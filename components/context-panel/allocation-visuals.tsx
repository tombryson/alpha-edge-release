'use client';

import { AlignJustify, CircleDashed, SquareStack } from 'lucide-react';
import { allocationFill } from '@/lib/context-panel-model';
import { useContextPanelStore } from '@/lib/context-panel-store';
import styles from './panel.module.css';

export const money = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '\u2014' : `$${Math.round(value).toLocaleString()}`;
export const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '\u2014' : `${value.toFixed(1)}%`;

export function AllocationLine({ actual, target, label }: { actual: number; target: number | null; label: string }) {
    const fill = allocationFill(actual, target);
    return <div className={styles.line} role="img" aria-label={`${label}: ${money(actual)} held, ${target === null ? 'no target' : `${money(target)} target`}`}>
        <span style={{ left: 0, width: `${fill.unknown ? 100 : fill.funded}%`, background: fill.unknown ? 'var(--muted-foreground)' : 'var(--info)' }} />
        <span style={{ left: `${fill.funded}%`, width: `${fill.excess}%`, background: 'var(--destructive)' }} />
    </div>;
}

export function AllocationViewControls() {
    const view = useContextPanelStore(state => state.allocationView);
    const setView = useContextPanelStore(state => state.setAllocationView);
    return <div className={styles.tools} role="group" aria-label="Allocation display">
        {([{ id: 'line', name: 'Line fill', Icon: AlignJustify }, { id: 'map', name: 'Capital map', Icon: SquareStack }, { id: 'ring', name: 'Ring fill', Icon: CircleDashed }] as const).map(({ id, name, Icon }) => <button key={id} className={styles.icon} type="button" title={name} aria-label={name} aria-pressed={view === id} onClick={() => setView(id)}><Icon aria-hidden="true" /></button>)}
    </div>;
}

export type CapitalItem = { id: string; name: string; actual: number; target: number | null; color?: string };
export function CapitalMap({ items, onSelect }: { items: CapitalItem[]; onSelect: (id: string) => void }) {
    const total = items.reduce((sum, item) => sum + Math.max(item.actual, item.target || 0, 0), 0);
    if (total <= 0) return <p className={styles.empty}>No allocated capital to map.</p>;
    return <div className={styles.map} aria-label="Capital map">
        {items.map(item => {
            const size = Math.max(item.actual, item.target || 0, 0) / total * 100;
            if (!size) return null;
            const fill = allocationFill(item.actual, item.target);
            const caption = `${item.name}: ${money(item.actual)} / ${money(item.target)}`;
            return <button key={item.id} type="button" className={styles.mapBlock} style={{ height: `${size}%` }} title={caption} aria-label={caption} onClick={() => onSelect(item.id)}>
                <span className={styles.mapFill} style={{ left: 0, width: `${fill.unknown ? 100 : fill.funded}%`, background: `color-mix(in srgb, ${fill.unknown ? item.color || 'var(--muted-foreground)' : item.color || 'var(--info)'} 20%, transparent)` }} />
                <span className={styles.mapFill} style={{ left: `${fill.funded}%`, width: `${fill.excess}%`, background: 'color-mix(in srgb, var(--destructive) 20%, transparent)' }} />
                {size >= 14 && <span className={styles.mapLabel}><span>{item.name}</span><span>{money(item.actual)}</span></span>}
            </button>;
        })}
    </div>;
}
