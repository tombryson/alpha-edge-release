import type { CSSProperties, ReactNode } from 'react';
import type { AnalysisGridColumnKey } from './columns';
import type {
    SortColumn,
    SortDirection,
} from '@/components/stock-table/types';

type AnalysisColumnHeaderProps = {
    columnKey: AnalysisGridColumnKey;
    resizeHandle: ReactNode;
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
    sortColumn: SortColumn | null;
    sortDirection: SortDirection;
    sortKey?: Exclude<SortColumn, null>;
    onSort: (column: SortColumn) => void;
    title?: string;
};

export function AnalysisColumnHeader({
    columnKey,
    resizeHandle,
    children,
    className = '',
    style,
    sortColumn,
    sortDirection,
    sortKey,
    onSort,
    title,
}: AnalysisColumnHeaderProps) {
    const isSortable = sortKey != null;
    const isActive = isSortable && sortColumn === sortKey && sortDirection != null;
    const directionLabel =
        sortDirection === 'asc' ? 'ascending' : 'descending';

    return (
        <th
            data-column-key={columnKey}
            className={className}
            style={style}
            title={title}
            aria-sort={
                isSortable
                    ? isActive
                        ? directionLabel
                        : 'none'
                    : undefined
            }
        >
            {isSortable ? (
                <button
                    type="button"
                    onClick={() => onSort(sortKey)}
                    className="flex h-full w-full items-center justify-center gap-1 text-inherit hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    aria-label={`${typeof children === 'string' ? children : 'Column'}: ${
                        isActive ? `sorted ${directionLabel}` : 'sort descending'
                    }`}
                >
                    <span>{children}</span>
                    <span aria-hidden="true" className="font-mono text-[9px]">
                        {isActive ? (sortDirection === 'desc' ? '↓' : '↑') : ''}
                    </span>
                </button>
            ) : (
                children
            )}
            {resizeHandle}
        </th>
    );
}
