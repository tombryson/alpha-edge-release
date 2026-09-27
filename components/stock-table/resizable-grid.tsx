import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import type { ResizableGridColumn } from './columns';
import styles from './resizable-grid.module.css';
import {
    clampPositionColumnWidth, getPositionColumnBounds, getPositionColumnStorageKey,
    migratePositionColumnWidths, parsePositionColumnWidths, resolvePositionGridColumns,
    type PositionColumnWidths,
} from './position-grid-sizing';

export type GridHeaderControls<K extends string> = {
    resizeHandle: (key: K) => React.ReactNode;
    resetColumnWidths: () => void;
};

type ResizableGridProps<K extends string> = {
    columns: ResizableGridColumn<K>[];
    widthScope: string;
    storageKey: string;
    legacyStorageKey?: string;
    columnNames: Partial<Record<K, string>>;
    onPanelWidthChange?: (width: number) => void;
    headerClassName?: string;
    containerClassName?: string;
    tableClassName: string;
    renderHeader: (columns: ResizableGridColumn<K>[], controls: GridHeaderControls<K>) => React.ReactNode;
    children: React.ReactNode;
};

type ResizeSession<K extends string> = {
    pointerId: number;
    handle: HTMLElement;
    column: ResizableGridColumn<K>;
    startX: number;
    startScroll: number;
    startScrollWidth: number;
    widths: Record<string, number>;
    latest: Record<string, number>;
};

export function ResizableGrid<K extends string>({
    columns, widthScope, storageKey, legacyStorageKey, columnNames, onPanelWidthChange,
    containerClassName = '', tableClassName, renderHeader, children,
    headerClassName = 'sticky top-0 z-30',
}: ResizableGridProps<K>) {
    const mobile = useMobileLayout();
    const scope = mobile ? `${widthScope}-mobile` : widthScope;
    const viewportRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLTableElement>(null);
    const sessionRef = useRef<ResizeSession<K> | null>(null);
    const suppressClickRef = useRef(false);
    const [panelWidth, setPanelWidth] = useState(0);
    const [widths, setWidths] = useState<PositionColumnWidths>({});
    const [ready, setReady] = useState(false);
    const [preview, setPreview] = useState<Record<string, number> | null>(null);
    const legacyRef = useRef<Record<string, unknown>>({});

    const saveWidths = (next: PositionColumnWidths) => {
        setWidths(next);
        try {
            localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
            // Resizing still works when browser storage is unavailable.
        }
    };

    useEffect(() => {
        try {
            setWidths(parsePositionColumnWidths(localStorage.getItem(storageKey)));
            const legacy: unknown = JSON.parse(legacyStorageKey ? localStorage.getItem(legacyStorageKey) ?? '{}' : '{}');
            if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) legacyRef.current = legacy as Record<string, unknown>;
        } catch { /* Ignore malformed or unavailable browser preferences. */ }
        setReady(true);
    }, [storageKey, legacyStorageKey]);

    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const measure = () => {
            const css = getComputedStyle(viewport);
            const width = Math.max(0, Math.floor(viewport.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)));
            setPanelWidth(width);
            onPanelWidthChange?.(width);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [onPanelWidthChange]);

    const baseColumns = columns.map(column => mobile && column.key === 'name' ? {
        ...column, widthPx: 200, minWidthPx: 200, maxWidthPx: 200,
        manualMinWidthPx: 128, manualMaxWidthPx: Math.min(280, Math.max(200, panelWidth - 80)),
        fillWeight: 0, growWeight: 0,
    } : column);
    useEffect(() => {
        if (!ready || mobile) return;
        const migrated = migratePositionColumnWidths(columns, scope, widths, legacyRef.current);
        if (Object.keys(migrated).some(key => migrated[key] !== widths[key])) saveWidths(migrated);
    }, [columns, scope, ready, mobile, widths]);

    const resolved = resolvePositionGridColumns(baseColumns, panelWidth, widths, scope);
    const visibleColumns = resolved.map(column => ({ ...column, widthPx: preview?.[column.key] ?? column.widthPx }));
    const renderedWidth = visibleColumns.reduce((sum, column) => sum + column.widthPx, 0);

    const releaseSession = () => {
        const session = sessionRef.current;
        sessionRef.current = null;
        if (session?.handle.hasPointerCapture(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
        document.body.classList.remove('position-column-resizing');
    };
    const cancelResize = () => {
        releaseSession();
        setPreview(null);
    };
    const columnSignature = columns.map(column => column.key).join(',');
    useEffect(() => {
        // Do not finish a drag against a different mode, column order or viewport.
        cancelResize();
    }, [scope, columnSignature, panelWidth]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && sessionRef.current) {
                event.preventDefault();
                cancelResize();
            }
        };
        const onVisibility = () => { if (document.hidden) cancelResize(); };
        window.addEventListener('blur', cancelResize);
        window.addEventListener('keydown', onKey);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            releaseSession();
            window.removeEventListener('blur', cancelResize);
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    const measuredWidths = () => Object.fromEntries(visibleColumns.map((column, index) => [
        column.key, Math.round(tableRef.current?.tHead?.rows[0]?.cells[index]?.getBoundingClientRect().width ?? column.widthPx),
    ]));
    const commitWidths = (snapshot: Record<string, number>) => {
        const next = { ...widths };
        for (const [key, value] of Object.entries(snapshot)) next[getPositionColumnStorageKey(scope, key as K)] = value;
        saveWidths(next);
    };
    const resetColumnWidths = (key?: K) => {
        cancelResize();
        const next = { ...widths };
        const keys = key ? [getPositionColumnStorageKey(scope, key)] : [
            ...Object.keys(widths).filter(item => item.startsWith(`${scope}:`)),
            ...Object.keys(legacyRef.current).filter(item => item.startsWith(`${scope}:`)),
            ...columns.map(column => getPositionColumnStorageKey(scope, column.key)),
        ];
        for (const item of keys) next[item] = null;
        saveWidths(next);
    };
    const updateResize = (event: React.PointerEvent<HTMLElement>) => {
        const session = sessionRef.current;
        if (!session || event.pointerId !== session.pointerId) return;
        if (!session.handle.hasPointerCapture(session.pointerId)) { cancelResize(); return; }
        const scrollDelta = session.column.key === 'name' && mobile ? 0 : (viewportRef.current?.scrollLeft ?? 0) - session.startScroll;
        const width = clampPositionColumnWidth(session.column, session.widths[session.column.key] + event.clientX - session.startX + scrollDelta);
        session.latest = { ...session.widths, [session.column.key]: width };
        setPreview(session.latest);
    };

    const resizeHandle = (column: ResizableGridColumn<K>) => {
        if (column.resizable === false) return null;
        const bounds = getPositionColumnBounds(column);
        return (
            <span
                className={styles.handle}
                data-column-resize-handle=""
                role="separator" tabIndex={0} aria-orientation="vertical"
                aria-label={`Resize ${columnNames[column.key] ?? column.key} column`} aria-valuenow={column.widthPx}
                aria-valuemin={bounds.min} aria-valuemax={Math.max(bounds.max, column.widthPx)}
                title="Resize column; double-click to reset"
                onPointerDown={event => {
                    if (event.button !== 0 || !event.isPrimary || !ready) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const snapshot = measuredWidths();
                    suppressClickRef.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    sessionRef.current = {
                        pointerId: event.pointerId, handle: event.currentTarget,
                        column: { ...column, manualMaxWidthPx: Math.max(bounds.max, snapshot[column.key]) },
                        startX: event.clientX, startScroll: viewportRef.current?.scrollLeft ?? 0,
                        startScrollWidth: viewportRef.current?.scrollWidth ?? renderedWidth,
                        widths: snapshot, latest: snapshot,
                    };
                    setPreview(snapshot);
                    document.body.classList.add('position-column-resizing');
                }}
                onPointerMove={updateResize}
                onPointerUp={event => {
                    const session = sessionRef.current;
                    if (!session || event.pointerId !== session.pointerId) return;
                    if (!session.handle.hasPointerCapture(session.pointerId)) { cancelResize(); return; }
                    updateResize(event);
                    if (session.latest[column.key] !== session.widths[column.key]) commitWidths(session.latest);
                    releaseSession();
                    setPreview(null);
                }}
                onPointerCancel={cancelResize}
                onLostPointerCapture={() => { if (sessionRef.current) cancelResize(); }}
                onClick={event => { event.preventDefault(); event.stopPropagation(); }}
                onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); resetColumnWidths(column.key); }}
                onKeyDown={event => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    event.stopPropagation();
                    const snapshot = measuredWidths();
                    snapshot[column.key] = clampPositionColumnWidth({ ...column, manualMaxWidthPx: Math.max(bounds.max, snapshot[column.key]) }, snapshot[column.key] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 10));
                    commitWidths(snapshot);
                }}
            />
        );
    };

    return (
        <div ref={viewportRef} className={containerClassName} style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
            {/* Keep the scroll range steady while shrinking at the right edge. */}
            <div style={{ width: preview && sessionRef.current ? Math.max(renderedWidth, sessionRef.current.startScrollWidth) : renderedWidth }}>
            <table ref={tableRef} className={`${styles.table} ${tableClassName}`} aria-busy={!ready} style={{ tableLayout: 'fixed', width: renderedWidth, minWidth: renderedWidth }}>
                <colgroup>{visibleColumns.map(column => <col key={column.key} style={{ width: column.widthPx }} />)}</colgroup>
                <thead className={headerClassName}
                    onPointerDownCapture={event => {
                        if (!(event.target as HTMLElement).closest('[data-column-resize-handle]')) suppressClickRef.current = false;
                    }}
                    onClickCapture={event => {
                        if (suppressClickRef.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
                    }}
                    onDragStartCapture={event => {
                        if (sessionRef.current || (event.target as HTMLElement).closest('[data-column-resize-handle]')) event.preventDefault();
                    }}
                >
                    {renderHeader(visibleColumns, {
                        resizeHandle: key => {
                            const column = visibleColumns.find(item => item.key === key);
                            return column ? resizeHandle(column) : null;
                        },
                        resetColumnWidths: () => resetColumnWidths(),
                    })}
                </thead>
                <tbody>{children}</tbody>
            </table>
            </div>
        </div>
    );
}
