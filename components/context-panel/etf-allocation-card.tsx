'use client';

import { useState } from 'react';
import type { ETFAllocationLedgerRow } from '@/lib/api';
import { allocationDifference, allocationLineFill, allocationRingFill, tickerLeaf } from '@/lib/context-panel-model';
import { AlertStatusIndicator } from '@/components/alert-status-indicator';
import { CoreETFControl } from './core-etf-control';
import { money } from './allocation-visuals';
import styles from '../etf-monitor.module.css';

export function ETFAllocationCard({ fund, target, signal, view }: { fund: ETFAllocationLedgerRow; target: number | null; signal: string | null; view: 'line' | 'ring' }) {
    const line = view === 'line';
    const [showCash, setShowCash] = useState(false);
    const fill = line ? allocationLineFill(fund.actual_value, target) : allocationRingFill(fund.actual_value, target);
    const difference = allocationDifference(fund.actual_value, target);
    const value = showCash ? difference.amount : difference.percentage;
    const rounded = value === null ? null : Number(Math.abs(value).toFixed(showCash ? 0 : 1));
    const direction = value === null || rounded === 0 ? 'neutral' : value > 0 ? 'above' : 'below';
    const sign = direction === 'above' ? '+' : direction === 'below' ? '\u2212' : '';
    const differenceText = rounded === null ? '\u2014' : `${sign}${showCash ? money(rounded) : `${rounded.toFixed(1)}%`}`;
    const nextUnit = showCash ? 'percentage' : 'dollar';
    const differenceHint = difference.amount === null ? 'ETF target unavailable.'
        : value === null ? `Percentage difference is unavailable for a zero ETF target. Click to show the dollar difference.`
        : `${differenceText} versus ETF target${showCash ? '' : ' (held minus target, divided by target)'}. Click to show the ${nextUnit} difference.`;
    const caption = `${fund.display_name}: ${money(fund.actual_value)} held / ${money(target)} target`;
    const progressLabel = target === null || fill.unknown ? `${caption}. No effective target.`
        : target === 0 ? `${caption}. ${fund.actual_value > 0 ? 'All held value is above target.' : 'No funding required.'}`
        : `${caption}. ${(Math.max(0, fund.actual_value) / target * 100).toFixed(1)}% funded.`;
    return <div className={line ? styles.chip : styles.ringChip} role="group" aria-label={`${fund.ticker} ETF allocation`}
        data-empty={fund.actual_value <= 0} data-unknown={fill.unknown} data-over={fill.excess > 0}
    >
        <CoreETFControl fund={fund} trigger={<button type="button" className={line ? styles.lineCoreTrigger : styles.ringCoreTrigger}
            aria-label={`Configure Core ETF ${fund.ticker}`} title={`${caption}. ${fund.asset_class_name || 'Unassigned'}`} onClick={event => event.stopPropagation()} />} />
        {!line && <svg className={styles.fundingRing} width="26" height="26" viewBox="0 0 26 26" role="img" aria-label={progressLabel}>
            <circle className={styles.ringTrack} cx="13" cy="13" r="11.5" fill="none" strokeWidth="3" strokeDasharray={fill.unknown ? '2 3' : undefined} />
            {fill.funded > 0 && <circle className={styles.ringFunded} data-ring="funded" cx="13" cy="13" r="11.5" fill="none" strokeWidth="3" strokeLinecap="round"
                pathLength="100" strokeDasharray={`${fill.funded} 100`} transform="rotate(-90 13 13)" />}
            {fill.excess > 0 && <circle className={styles.ringExcess} data-ring="excess" cx="13" cy="13" r="11.5" fill="none" strokeWidth="3" strokeLinecap="round"
                pathLength="100" strokeDasharray={`${fill.excess} 100`} strokeDashoffset={-(100 - fill.excess)} transform="rotate(-90 13 13)" />}
        </svg>}
        <span className={line ? styles.lineIdentity : styles.ringIdentity}>
            <span className={styles.tickerAnchor}>
                <AlertStatusIndicator ticker={fund.ticker} mode="position" securityType="ETF" className={styles.connection} />
                <span className={line ? styles.ticker : styles.ringTicker} title={fund.ticker}>{tickerLeaf(fund.ticker)}</span>
            </span>
            <span className={line ? styles.fundName : styles.ringName} title={fund.display_name}>{fund.display_name}</span>
            {signal && <span className={styles.signal} data-signal={signal}>{signal}</span>}
        </span>
        <button type="button" className={line ? styles.lineDifference : styles.ringDifference} data-direction={direction}
            title={differenceHint} aria-label={`${fund.ticker} allocation difference: ${differenceText}. ${difference.amount === null ? 'ETF target unavailable.' : `Show ${nextUnit} difference.`}`}
            aria-pressed={showCash} disabled={difference.amount === null}
            onClick={event => { event.stopPropagation(); setShowCash(current => !current); }}>{differenceText}</button>
        <span className={line ? styles.lineDetails : styles.ringDetails}>
            <span className={styles.amountPair} aria-label={`${money(fund.actual_value)} held, ${target === null ? 'no target' : `${money(target)} target`}`}>
                <span>{money(fund.actual_value)}</span><span>/</span><span>{money(target)}</span>
            </span>
        </span>
        {line && <span className={styles.fillLine} role="img" aria-label={progressLabel}>
            <span style={{ width: `${fill.funded}%` }} />
            <span className={styles.excess} style={{ left: '80%', width: `${fill.excess}%` }} />
            {target !== null && target > 0 && <i className={styles.targetMarker} aria-hidden="true" />}
        </span>}
    </div>;
}
