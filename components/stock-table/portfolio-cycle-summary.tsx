'use client';

import { Info } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { PortfolioCycleClassReturn, PortfolioCyclePerformance } from '@/lib/api';
import styles from './portfolio-cycle-summary.module.css';

const date = (value: string) => new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
export const cycleReturnLabel = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${value >= 0.05 ? '+' : value <= -0.05 ? '−' : ''}${Math.abs(value).toFixed(1)}%`;
export const cycleReturnTone = (value: number | null | undefined) => value == null || !Number.isFinite(value) || Math.abs(value) < 0.05 ? styles.neutral : value > 0 ? styles.positive : styles.negative;

export function CycleReturn({ row, unavailable }: { row?: PortfolioCycleClassReturn; unavailable?: string }) {
    const detail = row?.return_pct == null
        ? row?.reason || unavailable || 'No opening holdings or price evidence for this class.'
        : `Cycle adjusted-price return, weighted by opening capital. ${row.covered}/${row.securities} opening holdings covered. Not personal P/L.`;
    return <span className={cycleReturnTone(row?.return_pct)} title={detail} aria-label={`${cycleReturnLabel(row?.return_pct)}. ${detail}`}>{cycleReturnLabel(row?.return_pct)}</span>;
}

export function PortfolioCycleSummary({ data, error, loading }: { data: PortfolioCyclePerformance | null; error: string; loading: boolean }) {
    const cycle = data?.cycle;
    const winner = data?.best_performer;
    return <div className={styles.summary} data-testid="portfolio-cycle-summary">
        <span className={styles.period}>{cycle ? `Cycle v${cycle.snapshot_id}` : 'Cycle'}{cycle && <span>{date(cycle.started_at)} – {cycle.closed ? date(cycle.ended_at) : 'now'}</span>}</span>
        <span className={styles.result}>
            {winner ? <><span>Best performer</span><strong title={winner.name}>{winner.name}</strong><span className={cycleReturnTone(winner.return_pct)}>{cycleReturnLabel(winner.return_pct)}</span></>
                : <span>{loading ? 'Loading returns…' : 'Return unavailable'}</span>}
        </span>
        <Popover.Root>
            <Popover.Trigger asChild><button type="button" className={styles.info} aria-label="About cycle returns" title="About cycle returns"><Info size={15} /></button></Popover.Trigger>
            <Popover.Portal><Popover.Content className={styles.detail} sideOffset={6} collisionPadding={12} align="end">
                <strong>Cycle returns</strong>
                <p>Opening holdings, weighted by their starting capital. Returns use adjusted daily prices in each listing currency, not personal P/L. Provider adjustments may include dividends and splits; trading, fees and currency gains are not measured.</p>
                {data?.baseline_at && <p>Opening statement: {date(data.baseline_at)}. Price coverage: {data.covered}/{data.securities.length} holdings.</p>}
                {winner?.end_price_date && <p>Best performer prices: {winner.start_price_date} to {winner.end_price_date}.</p>}
                {(error || data?.reason) && <p role="status">{error || data?.reason}</p>}
            </Popover.Content></Popover.Portal>
        </Popover.Root>
    </div>;
}
