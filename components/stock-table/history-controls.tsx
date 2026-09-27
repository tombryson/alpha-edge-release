import type { AssetClass } from '@/lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatAssetClassName } from '@/lib/asset-classes';
import { getPortfolioAssetClassColor } from '@/lib/portfolio-composition-colors';
import { HISTORY_PERFORMANCE_RANGES } from './history';
import type { HistoryPerformanceRange } from './types';
import styles from './history-workspace.module.css';

export function HistoryPagination({ page, pageCount, start, end, total, setPage }: {
    page: number;
    pageCount: number;
    start: number;
    end: number;
    total: number;
    setPage: (page: number) => void;
}) {
    return <div className={styles.pagination} role="group" aria-label="History pagination">
        <span className={styles.count} aria-live="polite" aria-atomic="true">
            {total > 0 ? `${start + 1}-${end} of ${total}` : '0 records'}
        </span>
        {pageCount > 1 && <>
            <button type="button" className={`${styles.button} ${styles.iconButton}`}
                aria-label="Previous page" title="Previous page" disabled={page === 0}
                onClick={() => setPage(page - 1)}><ChevronLeft aria-hidden="true" /></button>
            <button type="button" className={`${styles.button} ${styles.iconButton}`}
                aria-label="Next page" title="Next page" disabled={page === pageCount - 1}
                onClick={() => setPage(page + 1)}><ChevronRight aria-hidden="true" /></button>
        </>}
    </div>;
}

export function HistoryRangeControl({ value, onChange }: {
    value: HistoryPerformanceRange;
    onChange: (value: HistoryPerformanceRange) => void;
}) {
    return <div className={styles.segments} role="group" aria-label="History date range">
        {HISTORY_PERFORMANCE_RANGES.map(range => <button key={range.key} type="button"
            aria-pressed={value === range.key} onClick={() => onChange(range.key)}>{range.label}</button>)}
    </div>;
}

export function HistoryDate({ value }: { value: string }) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return <span>-</span>;
    return <time className={styles.date} dateTime={value}>
        {date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
        <span>{date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</span>
    </time>;
}

export function HistorySubject({ ticker, assetClasses = [] }: { ticker: string; assetClasses?: AssetClass[] }) {
    const match = /^(ASSET_CLASS|THEME):(.+)$/i.exec(ticker);
    if (!match) return <span className={styles.subject}>{ticker || '-'}</span>;
    const code = match[2];
    const configured = assetClasses.find(item => item.code === code);
    const label = configured ? formatAssetClassName(configured) : code.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return <span className={styles.subject} title={ticker}>
        <i aria-hidden="true" style={{ background: getPortfolioAssetClassColor(code) }} />{label}
    </span>;
}
