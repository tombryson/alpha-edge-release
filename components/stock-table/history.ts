import type { HistoryPerformanceRange } from './types';
import styles from './history-workspace.module.css';

export const HISTORY_TABLE_SCROLL_CLASS =
    styles.tableScroll;

export const HISTORY_PANEL_CLASS =
    `terminal-workspace ${styles.panel}`;

export const HISTORY_TABLE_CLASS =
    styles.table;

export const HISTORY_METRIC_TILE_CLASS =
    styles.metric;

export const HISTORY_PERFORMANCE_RANGES: Array<{
    key: HistoryPerformanceRange;
    label: string;
    days: number | null;
}> = [
    { key: '1M', label: '1M', days: 31 },
    { key: '3M', label: '3M', days: 93 },
    { key: '6M', label: '6M', days: 186 },
    { key: 'ALL', label: 'All', days: null },
];
