'use client';

import { useMemo, useState } from 'react';
import {
    PortfolioOverviewV3,
    type PortfolioOverviewRow,
} from '@/components/stock-table/portfolio-overview-v3';
import { PortfolioTimelineView } from '@/components/stock-table/portfolio-timeline-view';
import { useStockTableContext } from '@/components/stock-table/stock-table-context';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import type { PortfolioMemoRun } from '@/lib/api';
import { joinPortfolioShapeRows } from '@/lib/portfolio-overview-model';
import type { Stock } from '@/lib/store';
import timelineStyles from './portfolio-timeline-view.module.css';

function PortfolioMemoStatus({
    running,
    ready,
    resultUnavailable,
    error,
    stage,
    progress,
    onReview,
    onDismiss,
}: {
    running: boolean;
    ready: boolean;
    resultUnavailable: boolean;
    error: string | null;
    stage?: string | null;
    progress?: number | null;
    onReview: () => void;
    onDismiss: () => void;
}) {
    if (!running && !ready && !error) return null;

    const accent = error ? 'var(--signal-sell)' : ready ? 'var(--signal-buy)' : 'var(--info)';
    const border = `color-mix(in srgb, ${accent} 35%, var(--border))`;
    const background = `color-mix(in srgb, ${accent} 7%, var(--background))`;
    const color = `color-mix(in srgb, ${accent} 45%, var(--foreground))`;
    const title = resultUnavailable
        ? 'Portfolio analysis result unavailable'
        : stage === 'Submission uncertain'
            ? 'Portfolio analysis submission uncertain'
        : error
            ? 'Portfolio analysis failed'
            : ready
                ? 'Portfolio analysis ready'
                : 'Portfolio analysis running';
    const detail = resultUnavailable
        ? 'The saved Council result is no longer available. Dismiss it or run a new analysis.'
        : error || stage || 'Preparing portfolio analysis';

    return (
        <div data-testid="portfolio-memo-status" style={{ margin: '0 18px 10px', border: `1px solid ${border}`, background, padding: '9px 11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ font: `600 9px 'IBM Plex Mono', monospace`, letterSpacing: '0.035em', color }}>{title}</div>
                    <div style={{ marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 10px 'IBM Plex Sans', sans-serif`, color: 'var(--foreground)' }}>{detail}</div>
                </div>
                {ready && (
                    <button type="button" onClick={onReview} style={{ flexShrink: 0, border: '1px solid color-mix(in srgb, var(--signal-buy) 45%, var(--border))', background: 'color-mix(in srgb, var(--signal-buy) 10%, var(--background))', color: 'color-mix(in srgb, var(--signal-buy) 45%, var(--foreground))', padding: '6px 10px', font: `600 9px 'IBM Plex Mono', monospace`, letterSpacing: '0.025em', cursor: 'pointer' }}>
                        Review
                    </button>
                )}
                {resultUnavailable && (
                    <button type="button" onClick={onDismiss} style={{ flexShrink: 0, border: '1px solid color-mix(in srgb, var(--signal-sell) 45%, var(--border))', background: 'color-mix(in srgb, var(--signal-sell) 10%, var(--background))', color: 'color-mix(in srgb, var(--signal-sell) 45%, var(--foreground))', padding: '6px 10px', font: `600 9px 'IBM Plex Mono', monospace`, letterSpacing: '0.025em', cursor: 'pointer' }}>
                        Dismiss
                    </button>
                )}
            </div>
            {running && (
                <div style={{ height: 2, marginTop: 8, background: 'var(--border)' }}>
                    <div style={{ width: `${Math.max(3, Math.min(100, progress ?? 3))}%`, height: '100%', background: 'var(--info)', transition: 'width 180ms linear' }} />
                </div>
            )}
        </div>
    );
}

export function PortfolioShapeView() {
    const {
        rebalance,
        memo,
        runPortfolioMemo,
        setPortfolioMode,
        overlay,
        positionStocks,
        securityPositions,
    } = useStockTableContext();
    const {
        portfolioMix,
        approvedPortfolioMix,
        portfolioRebalanceError,
        loadPortfolioRebalanceData,
    } = rebalance;
    const { overlaySummary, overlayRowsByCode } = overlay;
    const {
        portfolioMemoState,
        portfolioMemoError,
        applyPortfolioMemoTargets,
        persistPortfolioMemoState,
        setPortfolioMemoError,
    } = memo;

    const [portfolioView, setPortfolioView] = useState<'overview' | 'timeline'>('overview');
    const [timelineFocusMemoJobId, setTimelineFocusMemoJobId] = useState<string | null>(null);

    const hasTarget = Boolean(approvedPortfolioMix?.snapshot?.approved_at);
    const totalValue = portfolioMix?.total_value ?? 0;
    const memoRunning = portfolioMemoState?.status === 'queued' || portfolioMemoState?.status === 'running';
    const memoReady = portfolioMemoState?.status === 'succeeded' && Boolean(portfolioMemoState.jobId) && Boolean(portfolioMemoState.summary);
    const memoResultUnavailable = portfolioMemoState?.status === 'succeeded' && Boolean(portfolioMemoError) && !portfolioMemoState.summary;

    const stocksByClass = useMemo<Map<string, Stock[]>>(() => {
        const map = new Map<string, Stock[]>();
        for (const stock of positionStocks) {
            const code = normalizeAssetClassCode(stock.primaryAssetClass);
            if (!map.has(code)) map.set(code, []);
            map.get(code)!.push(stock);
        }
        return map;
    }, [positionStocks]);

    const overviewRows = useMemo<PortfolioOverviewRow[]>(() => {
        return joinPortfolioShapeRows(portfolioMix?.rows ?? [], approvedPortfolioMix?.rows ?? [], hasTarget)
            .map(row => ({ ...row, stocks: stocksByClass.get(row.code) ?? [] }));
    }, [portfolioMix, approvedPortfolioMix, hasTarget, stocksByClass]);

    const reviewLatestMemo = () => {
        setTimelineFocusMemoJobId(portfolioMemoState?.jobId || null);
        setPortfolioView('timeline');
    };

    const dismissUnavailableMemo = () => {
        persistPortfolioMemoState(null);
        setPortfolioMemoError(null);
        setTimelineFocusMemoJobId(null);
    };

    const createTargetFromMemo = (run: PortfolioMemoRun) => {
        const summary = {
            analysisDate: run.analysis_date,
            primaryTheme: run.primary_theme,
            secondaryTheme: run.secondary_theme,
            overallConviction: run.overall_conviction,
            executiveSummary: run.executive_summary,
            analystMemoMarkdown: run.analyst_memo_markdown,
            chairmanMemoMarkdown: run.chairman_memo_markdown,
            assetClassTargets: run.asset_class_targets,
        };
        persistPortfolioMemoState({
            jobId: run.memo_job_id,
            runId: run.run_id,
            mode: run.mode === 'FAST' ? 'FAST' : 'DEEP',
            status: 'succeeded',
            finishedAt: run.analysis_date,
            summary,
        });
        applyPortfolioMemoTargets(summary);
        setPortfolioMode('workflow');
    };

    return (
        <div style={{ display: 'flex', height: '100%', minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
            <PortfolioMemoStatus
                running={memoRunning}
                ready={memoReady}
                resultUnavailable={memoResultUnavailable}
                error={portfolioMemoError || portfolioMemoState?.error || null}
                stage={portfolioMemoState?.stageMessage || portfolioMemoState?.stage}
                progress={portfolioMemoState?.progressPct}
                onReview={reviewLatestMemo}
                onDismiss={dismissUnavailableMemo}
            />

            {portfolioRebalanceError && (
                <div className={timelineStyles.dataError} role="status">
                    <div style={{ minWidth: 0 }}>
                        <strong>{portfolioMix ? 'Portfolio data partially unavailable' : 'Portfolio data unavailable'}</strong>
                        <p>{portfolioRebalanceError}</p>
                    </div>
                    <button type="button" onClick={() => void loadPortfolioRebalanceData()}>
                        Retry
                    </button>
                </div>
            )}

            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <PortfolioOverviewV3
                    rows={overviewRows}
                    totalValue={totalValue}
                    currentAvailable={Boolean(portfolioMix)}
                    asOf={portfolioMix?.as_of}
                    approvedAt={approvedPortfolioMix?.snapshot?.approved_at}
                    approvedId={approvedPortfolioMix?.snapshot?.id}
                    overlaySummary={overlaySummary}
                    overlayRowsByCode={overlayRowsByCode}
                    securityPositions={securityPositions}
                    onOpenTimeline={() => setPortfolioView('timeline')}
                    onCloseTimeline={() => setPortfolioView('overview')}
                    timeline={portfolioView === 'timeline' ? (
                        <PortfolioTimelineView
                            onBackToShape={() => setPortfolioView('overview')}
                            refreshKey={`${portfolioMemoState?.jobId || ''}:${portfolioMemoState?.status || ''}:${portfolioMemoState?.finishedAt || ''}`}
                            focusMemoJobId={timelineFocusMemoJobId}
                            onCreateTargetFromMemo={createTargetFromMemo}
                        />
                    ) : undefined}
                />
            </div>

            {portfolioView === 'overview' && (
                <footer style={{ display: 'flex', minHeight: 58, flex: '0 0 auto', alignItems: 'center', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)', background: 'color-mix(in srgb, var(--background) 97%, var(--foreground))', padding: '0 20px' }}>
                    <button type="button" onClick={() => setPortfolioMode('workflow')} style={{ minHeight: 34, border: '1px solid color-mix(in srgb, var(--info) 45%, var(--border))', borderRadius: 4, background: 'color-mix(in srgb, var(--info) 8%, var(--background))', color: 'color-mix(in srgb, var(--info) 45%, var(--foreground))', padding: '8px 14px', font: `600 10px 'IBM Plex Mono', monospace`, letterSpacing: '0.025em', cursor: 'pointer' }}>
                        New portfolio target
                    </button>
                    <button type="button" onClick={runPortfolioMemo} disabled={!overlaySummary || memoRunning} style={{ minHeight: 34, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--background)', color: 'var(--foreground)', padding: '8px 14px', font: `600 10px 'IBM Plex Mono', monospace`, letterSpacing: '0.025em', cursor: 'pointer', opacity: overlaySummary && !memoRunning ? 1 : 0.5 }}>
                        {memoRunning ? 'Analysis running' : 'Run portfolio analysis'}
                    </button>
                </footer>
            )}
        </div>
    );
}
