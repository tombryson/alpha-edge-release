import type { ResizableGridColumn } from './columns';

// Null records an explicit reset, so an old v3 preference cannot reappear.
export type PositionColumnWidths = Record<string, number | null>;

export function getPositionColumnStorageKey(scope: string, key: string) {
    return `${scope}:${key}`;
}

export function parsePositionColumnWidths(raw: string | null): PositionColumnWidths {
    try {
        const parsed: unknown = JSON.parse(raw ?? '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter(([, value]) =>
            value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 4096),
        ));
    } catch {
        return {};
    }
}

export function getPositionColumnBounds(column: ResizableGridColumn) {
    return {
        min: column.manualMinWidthPx ?? column.minWidthPx ?? 36,
        max: column.manualMaxWidthPx ?? Math.max(column.fillMaxWidthPx ?? 0, column.maxWidthPx ?? 0, 420),
    };
}

export function clampPositionColumnWidth(column: ResizableGridColumn, width: number) {
    const { min, max } = getPositionColumnBounds(column);
    return Math.round(Math.max(min, Math.min(max, width)));
}

export function migratePositionColumnWidths(
    columns: ResizableGridColumn[], scope: string, widths: PositionColumnWidths,
    legacy: Record<string, unknown>,
): PositionColumnWidths {
    const next = { ...widths };
    for (const column of columns) {
        const key = getPositionColumnStorageKey(scope, column.key);
        const delta = legacy[key];
        if (!(key in next) && typeof delta === 'number' && Number.isFinite(delta)) {
            next[key] = clampPositionColumnWidth(column, column.widthPx + delta);
        }
    }
    return next;
}

export function resolvePositionGridColumns<K extends string>(
    columns: ResizableGridColumn<K>[], panelWidth: number, widths: PositionColumnWidths, scope: string,
): ResizableGridColumn<K>[] {
    const isManual = (column: ResizableGridColumn<K>) =>
        typeof widths[getPositionColumnStorageKey(scope, column.key)] === 'number';
    const next = columns.map(column => {
        const saved = widths[getPositionColumnStorageKey(scope, column.key)];
        return { ...column, widthPx: typeof saved === 'number'
            ? Math.round(Math.max(getPositionColumnBounds(column).min, Math.min(column.manualMaxWidthPx ?? 4096, saved)))
            : Math.max(column.minWidthPx ?? 36, Math.min(column.maxWidthPx ?? 420, column.widthPx)) };
    });
    // Automatic columns fill the workspace. User-sized columns never absorb or
    // donate pixels when a neighbour, sidebar, holding value or viewport changes.
    const automatic = next.filter(column => !isManual(column) && column.resizable !== false);
    const total = next.reduce((sum, column) => sum + column.widthPx, 0);
    if (panelWidth > total) {
        const weight = automatic.reduce((sum, column) => sum + (column.fillWeight ?? column.growWeight ?? 0), 0);
        if (weight > 0) {
            for (const column of automatic) {
                column.widthPx += (panelWidth - total) * (column.fillWeight ?? column.growWeight ?? 0) / weight;
            }
        }
    } else if (panelWidth > 0 && panelWidth < total) {
        const capacity = automatic.reduce((sum, column) => sum + Math.max(0, column.widthPx - (column.minWidthPx ?? 36)), 0);
        if (capacity > 0) {
            for (const column of automatic) {
                column.widthPx -= Math.min(total - panelWidth, capacity) * Math.max(0, column.widthPx - (column.minWidthPx ?? 36)) / capacity;
            }
        }
    }
    const remainder = Math.round(next.reduce((sum, column) => sum + column.widthPx % 1, 0));
    const roundedUp = new Set(next.map((column, index) => ({ index, fraction: column.widthPx % 1 }))
        .sort((a, b) => b.fraction - a.fraction).slice(0, remainder).map(item => item.index));
    return next.map((column, index) => ({ ...column, widthPx: Math.floor(column.widthPx) + (roundedUp.has(index) ? 1 : 0) }));
}
