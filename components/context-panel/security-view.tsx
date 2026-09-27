'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { api, type CommodityThemeSecurity, type ETFMomentumWorkspaceResponse } from '@/lib/api';
import { useStore } from '@/lib/store';
import { managementTicker, useETFManagement } from '@/lib/etf-management-store';
import { useContextPanelStore } from '@/lib/context-panel-store';
import { usePanelResearch } from '@/lib/context-panel-research';
import { findByTicker, etfTarget, tickerLeaf } from '@/lib/context-panel-model';
import { requestTerminalTab } from '@/lib/terminal-route';
import { openSecurityHistory } from '@/lib/security-navigation';
import { calculateAveragePriceTarget, calculateBaseRatingTotal, hasAnalysisSizingEvidence } from '@/components/stock-table/ratings';
import { isNonAllocatingSecurityType } from '@/lib/security-types';
import { usePanelData } from './panel-data';
import { CoreETFControl } from './core-etf-control';
import { ETFManagementControl } from './etf-management-control';
import { SecurityPriceChart } from './security-price-chart';
import { AllocationLine, money, percent } from './allocation-visuals';
import styles from './panel.module.css';
import securityStyles from './security-view.module.css';

const dataDate = (value: string | Date | null | undefined) => {
    if (!value) return 'unavailable';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? 'unavailable' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function SecurityView() {
    const stocks = useStore(state => state.stocks);
    const connections = useStore(state => state.activeAlerts);
    const selected = useContextPanelStore(state => state.security);
    const { ledger, errors, revision } = usePanelData();
    const research = usePanelResearch(state => state.results);
    const anchored = usePanelResearch(state => state.anchored);
    const [momentum, setMomentum] = useState<ETFMomentumWorkspaceResponse | null>(null);
    const [trend, setTrend] = useState<string | null>(null);
    const [evidence, setEvidence] = useState<CommodityThemeSecurity | null>(null);
    const [feedError, setFeedError] = useState('');
    const stock = findByTicker(stocks.filter(row => !isNonAllocatingSecurityType(row.securityType)), selected, row => `${row.prefix || ''}${row.symbol}`);
    const fund = findByTicker([...(ledger?.rows || []), ...(ledger?.candidates || [])], selected, row => row.ticker);
    const isETF = stock?.securityType === 'ETF' || Boolean(fund);
    const managementMode = useETFManagement(state => state.modes[managementTicker(selected)] || 'etf_tms');
    const modesReady = useETFManagement(state => state.ready);
    const qualifiedTicker = selected.includes(':') ? selected : stock?.prefix ? `${stock.prefix}${stock.symbol}` : fund?.ticker || selected;
    const symbol = tickerLeaf(qualifiedTicker);
    const exchange = qualifiedTicker.includes(':') ? qualifiedTicker.split(':')[0].trim().toUpperCase() : '';
    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            setTrend(null); setEvidence(null); setFeedError(''); setMomentum(null);
            if (!selected) return;
            try {
                const [positions, themes, workspace] = await Promise.allSettled([api.getSecurityPositions(), api.getCommodityThemes({ includeSecurities: true }), isETF ? api.getETFMomentumWorkspace() : Promise.resolve(null)]);
                if (cancelled) return;
                const connection = findByTicker((connections || []).filter(row => (isETF && managementMode === 'etf_tms' ? ['etf_tms', 'etf_cdf'] : ['cdf']).includes(row.script)), selected, row => row.ticker);
                const fundDirection = !errors.ledger ? findByTicker(ledger?.rows || [], selected, row => row.ticker)?.tactical_status : null;
                setTrend(connection && (!isETF || modesReady) ? isETF && managementMode === 'etf_tms' ? fundDirection || null : positions.status === 'fulfilled' ? findByTicker(positions.value || [], selected, row => row.ticker)?.position_state || null : null : null);
                const securities = (themes.status === 'fulfilled' ? themes.value.themes || [] : []).flatMap(theme => theme.eligible_securities || []);
                setEvidence(findByTicker(securities, selected, row => row.ticker) || null);
                if (workspace.status === 'fulfilled') setMomentum(workspace.value);
                if (positions.status === 'rejected' || themes.status === 'rejected') setFeedError('Some signal evidence is unavailable.');
            } catch { if (!cancelled) setFeedError('Signal evidence could not be refreshed.'); }
        };
        void refresh();
        return () => { cancelled = true; };
    }, [selected, isETF, managementMode, modesReady, connections, revision, ledger, errors.ledger]);
    const advice = stock ? research.get(stock.id) : undefined;
    const validAdvice = !isETF && advice?.eligible_for_target_weight && anchored && !errors.ledger;
    const etfRow = findByTicker(ledger?.rows || [], selected, row => row.ticker);
    const target = etfRow && !errors.ledger ? etfTarget(etfRow) : null;
    const run = momentum?.latest_run || momentum?.published_run;
    const momentumRow = findByTicker(run?.rows || [], selected, row => row.ticker);
    const score = stock && hasAnalysisSizingEvidence(stock) ? calculateBaseRatingTotal(stock) : null;
    const priceTarget = stock ? calculateAveragePriceTarget(stock) : 0;
    const openAnalysis = () => {
        requestTerminalTab('ANALYSIS');
        window.dispatchEvent(new CustomEvent('analysisSecurityRequested', { detail: { ticker: selected, name: stock?.name || fund?.display_name } }));
    };
    return <div className={securityStyles.security}>
        {!selected ? <p className={styles.empty}>No security selected.</p> : <>
            <section className={securityStyles.section} aria-label="Security holding">
                <div className={securityStyles.identity}>
                    <h3>{stock?.name || fund?.display_name || 'No matching security record'}</h3>
                    <div className={securityStyles.identityMeta}>
                        <p className={securityStyles.ticker}>
                            <span data-testid="security-symbol">{symbol}</span>
                            {exchange && <><span aria-hidden="true">{'\u00b7'}</span><span className={securityStyles.exchange} data-testid="security-exchange">{exchange}</span></>}
                        </p>
                        {fund && <CoreETFControl fund={fund} />}
                    </div>
                </div>
                {stock?.isExternal && <p className={securityStyles.meta}>External holding</p>}
                <dl className={`${securityStyles.metrics} ${securityStyles.primaryMetrics}`}>
                    <div><dt>Held value</dt><dd>{money(etfRow?.actual_value ?? stock?.positionValue)}</dd></div>
                    {isETF ? <div><dt>ETF target</dt><dd>{money(target)}</dd></div> : <div><dt>Units</dt><dd>{stock?.position?.toLocaleString() ?? '\u2014'}</dd></div>}
                </dl>
                {etfRow && <AllocationLine actual={etfRow.actual_value} target={target} label={selected} />}
                {isETF && errors.ledger && <p role="alert" className={styles.notice}>ETF target and allocation source unavailable.</p>}
                <div className={securityStyles.commands}><button type="button" className={securityStyles.command} onClick={() => openSecurityHistory({ ticker: stock?.symbol || selected, name: stock?.name || fund?.display_name || selected })}><ArrowUpRight aria-hidden="true" />Performance history</button></div>
            </section>
            <section className={`${securityStyles.section} ${securityStyles.signals}`} aria-label="Signal evidence">
                <div className={securityStyles.sectionHeading}>
                    <h3>Signal evidence</h3>
                    <button className={securityStyles.iconCommand} type="button" onClick={() => requestTerminalTab('ALERTS')} title="Connections" aria-label="Connections"><ArrowUpRight aria-hidden="true" /></button>
                </div>
                {feedError ? <p role="alert" className={styles.notice}>{feedError}</p> : <>
                    {isETF && <div className={securityStyles.readout}><span>Management</span><ETFManagementControl ticker={qualifiedTicker} /></div>}
                    <div className={securityStyles.readout}><span>Trend</span><span style={{ color: trend === 'BUY' ? 'var(--success)' : trend === 'SELL' ? 'var(--destructive)' : undefined }}>{trend === 'BUY' ? 'Buy' : trend === 'SELL' ? 'Sell' : 'Not initialised'}</span></div>
                    {evidence && <div className={securityStyles.readout}><span>Outperformance</span><span>{evidence.stage_states.SECURITY_OUTPERFORM === 'CONFIRMED' ? 'Outperforming' : evidence.stage_states.SECURITY_OUTPERFORM === 'BLOCKED' ? 'Not outperforming' : 'No current signal'}</span></div>}
                    {evidence?.latest_events.SECURITY_OUTPERFORM?.occurred_at && <p className={securityStyles.meta}>{new Date(evidence.latest_events.SECURITY_OUTPERFORM.occurred_at).toLocaleString()}</p>}
                </>}
            </section>
            <SecurityPriceChart key={qualifiedTicker} ticker={qualifiedTicker} />
            <section className={securityStyles.section} aria-label={isETF ? 'ETF momentum' : 'Research'}>
                <h3>{isETF ? 'ETF momentum' : 'Research'}</h3>
                {isETF ? <>
                    <dl className={securityStyles.metrics}>
                        <div><dt>80-session return</dt><dd style={{ color: 'var(--info)' }}>{percent(momentumRow?.return_80_pct)}</dd></div>
                        <div><dt>Rank</dt><dd>{momentumRow?.rank || '\u2014'}</dd></div>
                        <div><dt>Score</dt><dd>{momentumRow?.score?.toFixed(2) ?? '\u2014'}</dd></div>
                    </dl>
                    <div className={securityStyles.readout}><span>Weight used for allocation</span><span>{percent(errors.ledger ? null : fund?.momentum_weight_pct)}</span></div>
                    <div className={securityStyles.sources}>
                        <p>{momentum?.latest_run ? 'Latest internal calculation' : 'Internal model calculation'}</p>
                        <dl><div><dt>Price data</dt><dd>{dataDate(momentumRow?.price_date || run?.data_fresh_through)}</dd></div></dl>
                        <p>Target source: {!ledger || errors.ledger ? 'unavailable' : ledger.policy.momentum_source === 'INTERNAL_PUBLISHED' ? 'Internal published model' : 'TradingView compatibility weights'}</p>
                    </div>
                </> : <>
                    <dl className={securityStyles.metrics}>
                        <div><dt>Research score</dt><dd>{score?.toFixed(1) ?? '\u2014'}</dd></div>
                        <div><dt>Average price target</dt><dd>{priceTarget > 0 ? `$${priceTarget.toFixed(2)}` : '\u2014'}</dd></div>
                        <div><dt>6-month return</dt><dd>{percent(stock?.performance6MPct)}</dd></div>
                        <div><dt>Research suggestion</dt><dd>{validAdvice ? percent(advice.allocation_pct) : '\u2014'}</dd></div>
                    </dl>
                    <div className={securityStyles.sources}>
                        <dl>
                            <div><dt>Price data</dt><dd>{dataDate(stock?.performanceAsOf)}</dd></div>
                            <div><dt>Research</dt><dd>{stock?.lastContributedAt ? dataDate(stock.lastContributedAt) : 'not dated'}</dd></div>
                        </dl>
                    </div>
                    {stock?.thesis && <details className={securityStyles.researchNote} key={selected}>
                        <summary>Research note<ChevronDown aria-hidden="true" /></summary>
                        <p className={securityStyles.thesis}>{stock.thesis}</p>
                    </details>}
                </>}
                <div className={securityStyles.commands}><button className={securityStyles.command} type="button" onClick={openAnalysis}><ArrowUpRight aria-hidden="true" />Open research</button>{isETF && <button className={securityStyles.command} type="button" onClick={() => requestTerminalTab('ETF')}><ArrowUpRight aria-hidden="true" />ETF ranking</button>}</div>
            </section>
        </>}
    </div>;
}
