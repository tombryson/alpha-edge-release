'use client';

import { useState, useMemo } from 'react';
import {
    api,
    getCouncilTemplateForAssetClass,
    type CouncilReportPacket,
    type CouncilRunListEntry,
} from '@/lib/api';
import type { Stock } from '@/lib/store';
import { isCouncilSubmissionUncertain } from '@/lib/council-submission';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CouncilRunnerState {
    // Provider detail display toggles (analysis tab popovers)
    showGeminiDetails: Record<string, boolean>;
    showGptDetails: Record<string, boolean>;
    showPerplexityDetails: Record<string, boolean>;
    showClaudeDetails: Record<string, boolean>;
    showCouncilDetails: Record<string, boolean>;
    showTvPtEdit: Record<number, boolean>;
    setShowTvPtEdit: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
    showResearchPanel: Record<string, boolean>;
    setShowResearchPanel: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

    // Council run state
    councilRunning: Record<string, boolean>;
    councilProgress: Record<string, string>;
    councilProgressStage: Record<string, string>;
    councilProgressPct: Record<string, number>;
    councilRunIds: Record<string, string>;
    councilRunPickerOpen: Record<string, boolean>;
    councilRunOptions: Record<string, CouncilRunListEntry[]>;
    councilRunOptionsLoading: Record<string, boolean>;
    councilError: Record<string, string>;
    councilSupplementaryFiles: Record<string, File | null>;

    // Derived
    analysisNextCatalystByStockId: Map<
        number,
        { name: string; period: string; title: string; impactColor: string }
    >;

    // Provider detail toggles
    toggleGeminiDetails: (symbol: string) => void;
    toggleGptDetails: (symbol: string) => void;
    togglePerplexityDetails: (symbol: string) => void;
    toggleClaudeDetails: (symbol: string) => void;
    toggleCouncilDetails: (symbol: string) => void;

    // Supplementary file helpers
    setCouncilSupplementaryFileForKey: (key: string, file: File | null) => void;

    // Council query helpers
    hasCouncilImportedAnalysis: (stock: Stock) => boolean;
    hasCouncilCatalystContent: (stock: Stock) => boolean;
    hasCouncilResearchPanelContent: (stock: Stock) => boolean;

    // Council run management
    toggleCouncilRunPicker: (stock: Stock) => Promise<void>;
    loadCouncilRunById: (stock: Stock, runId: string) => Promise<void>;
    loadLatestCouncilRun: (stock: Stock) => Promise<void>;
    runCouncilForStock: (stock: Stock) => Promise<void>;
    clearCouncilImportedAnalysis: (stock: Stock) => Promise<void>;
    openCouncilRunsManager: (stock: Stock, focusRunId?: string) => void;

    // Display helpers
    buildCouncilRunOptionLabel: (run: CouncilRunListEntry) => string;
    councilResolveTickerContext: (
        stock: Stock,
    ) => { ticker: string; exchange: string; hasPrefix: boolean };
    councilParseTicker: (stock: Stock) => string;
    councilStageLabel: (stage: string, status: string) => string;
    councilStageDetail: (stage: string, stageMessage: string) => string;
    councilDisplayProgressPct: (
        status: string,
        stage: string,
        rawPct: unknown,
    ) => number;
    sanitizeCouncilCatalystName: (value: unknown) => string;
    formatCouncilRunTimestamp: (value: unknown) => string;
    shortCouncilRunId: (value: unknown) => string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages all state and async operations related to running and displaying
 * LLM council analyses in the Analysis tab.
 *
 * Inputs:
 *   updateStock  – store action to persist field updates to a stock
 *   sortedStocks – full sorted stock list (used for catalyst memos)
 */
export function useCouncilRunner(
    updateStock: (id: number, updates: Partial<Stock>) => void,
    sortedStocks: Stock[],
): CouncilRunnerState {
    // ── Provider detail display toggles ─────────────────────────────────────
    const [showGeminiDetails, setShowGeminiDetails] = useState<
        Record<string, boolean>
    >({});
    const [showGptDetails, setShowGptDetails] = useState<
        Record<string, boolean>
    >({});
    const [showPerplexityDetails, setShowPerplexityDetails] = useState<
        Record<string, boolean>
    >({});
    const [showClaudeDetails, setShowClaudeDetails] = useState<
        Record<string, boolean>
    >({});
    const [showCouncilDetails, setShowCouncilDetails] = useState<
        Record<string, boolean>
    >({});
    const [showTvPtEdit, setShowTvPtEdit] = useState<Record<number, boolean>>(
        {},
    );
    const [showResearchPanel, setShowResearchPanel] = useState<
        Record<string, boolean>
    >({});

    // ── Council run state ────────────────────────────────────────────────────
    const [councilRunning, setCouncilRunning] = useState<
        Record<string, boolean>
    >({});
    const [councilProgress, setCouncilProgress] = useState<
        Record<string, string>
    >({});
    const [councilProgressStage, setCouncilProgressStage] = useState<
        Record<string, string>
    >({});
    const [councilProgressPct, setCouncilProgressPct] = useState<
        Record<string, number>
    >({});
    const [councilRunIds, setCouncilRunIds] = useState<
        Record<string, string>
    >({});
    const [councilRunPickerOpen, setCouncilRunPickerOpen] = useState<
        Record<string, boolean>
    >({});
    const [councilRunOptions, setCouncilRunOptions] = useState<
        Record<string, CouncilRunListEntry[]>
    >({});
    const [councilRunOptionsLoading, setCouncilRunOptionsLoading] = useState<
        Record<string, boolean>
    >({});
    const [councilError, setCouncilError] = useState<Record<string, string>>(
        {},
    );
    const [councilSupplementaryFiles, setCouncilSupplementaryFiles] = useState<
        Record<string, File | null>
    >({});

    // ── Provider detail toggles ──────────────────────────────────────────────

    const toggleGeminiDetails = (symbol: string) => {
        setShowGeminiDetails((prev) => ({ ...prev, [symbol]: !prev[symbol] }));
    };

    const toggleGptDetails = (symbol: string) => {
        setShowGptDetails((prev) => ({ ...prev, [symbol]: !prev[symbol] }));
    };

    const togglePerplexityDetails = (symbol: string) => {
        setShowPerplexityDetails((prev) => ({
            ...prev,
            [symbol]: !prev[symbol],
        }));
    };

    const toggleClaudeDetails = (symbol: string) => {
        setShowClaudeDetails((prev) => ({ ...prev, [symbol]: !prev[symbol] }));
    };

    const toggleCouncilDetails = (symbol: string) => {
        setShowCouncilDetails((prev) => ({ ...prev, [symbol]: !prev[symbol] }));
    };

    // ── Supplementary file helpers ───────────────────────────────────────────

    const setCouncilSupplementaryFileForKey = (
        key: string,
        file: File | null,
    ) => {
        setCouncilSupplementaryFiles((prev) => ({ ...prev, [key]: file }));
    };

    // ── Catalyst name sanitizer ──────────────────────────────────────────────

    const sanitizeCouncilCatalystName = (value: unknown): string => {
        let text = String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) return '';
        text = text.replace(/\s*\([^)]*$/, '');
        text = text.replace(/\s*\[[^\]]*$/, '');
        text = text.replace(/\s*\{[^}]*$/, '');
        text = text.replace(/\s*[|:;,\-]+$/, '');
        text = text.replace(/\s*\($/, '');
        return text.trim();
    };

    // ── Next catalyst memo (per stock) ───────────────────────────────────────

    const analysisNextCatalystByStockId = useMemo(() => {
        const dateFormatter = new Intl.DateTimeFormat('en-AU', {
            month: 'short',
            day: 'numeric',
        });
        const now = Date.now();
        const nextByStockId = new Map<
            number,
            {
                name: string;
                period: string;
                title: string;
                impactColor: string;
            }
        >();

        for (const stock of sortedStocks) {
            if (!stock.catalysts) continue;

            try {
                const catalysts = JSON.parse(stock.catalysts) as Array<{
                    name: string;
                    date: string;
                    period?: string;
                    impact: string;
                }>;
                const next = catalysts
                    .map((catalyst) => ({
                        ...catalyst,
                        time: new Date(catalyst.date).getTime(),
                    }))
                    .filter(
                        (catalyst) =>
                            catalyst.date &&
                            Number.isFinite(catalyst.time) &&
                            catalyst.time > now,
                    )
                    .sort((a, b) => a.time - b.time)[0];

                if (!next) continue;

                const displayName =
                    sanitizeCouncilCatalystName(next.name) || next.name;
                const period =
                    String(next.period || '').trim() ||
                    dateFormatter.format(new Date(next.time));
                const impactColor =
                    next.impact === 'HIGH'
                        ? 'text-destructive'
                        : next.impact === 'MED'
                        ? 'text-caution'
                        : 'text-info';

                nextByStockId.set(stock.id, {
                    name: displayName,
                    period,
                    title: `${displayName} ${period}`,
                    impactColor,
                });
            } catch {
                // Ignore malformed legacy catalyst payloads.
            }
        }

        return nextByStockId;
    }, [sortedStocks]);

    // ── Timestamp / run-id formatters ────────────────────────────────────────

    const formatCouncilRunTimestamp = (value: unknown): string => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const dt = new Date(raw);
        if (Number.isNaN(dt.getTime())) return '';
        try {
            return new Intl.DateTimeFormat('en-AU', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }).format(dt);
        } catch {
            return dt.toISOString().replace('T', ' ').slice(0, 16);
        }
    };

    const shortCouncilRunId = (value: unknown): string => {
        const raw = String(value || '')
            .trim()
            .replace(/\.json$/i, '');
        if (!raw) return '';
        const tail = raw.match(/(\d{6})$/);
        if (tail) return tail[1];
        return raw.slice(-8);
    };

    const buildCouncilRunOptionLabel = (run: CouncilRunListEntry): string => {
        const label = String(
            run?.label || run?.file || run?.id || 'Run',
        ).trim();
        const timestamp = formatCouncilRunTimestamp(
            run?.analysis_date || run?.updated_at || '',
        );
        const suffix = shortCouncilRunId(run?.id || run?.file || '');
        return [label, timestamp, suffix ? `#${suffix}` : '']
            .filter(Boolean)
            .join(' · ');
    };

    const normalizeCouncilRunMeta = (
        runId: unknown,
        runLabel: unknown,
    ) => {
        const normalizedRunId = String(runId || '').trim();
        const normalizedRunLabel = String(runLabel || '').trim();
        return {
            runId: normalizedRunId,
            runLabel: normalizedRunLabel || normalizedRunId,
        };
    };

    // ── Stage label / detail / progress helpers ──────────────────────────────

    const councilStageLabel = (stage: string, status: string): string => {
        const normalized = String(stage || '').trim().toLowerCase();
        const normalizedStatus = String(status || '').trim().toLowerCase();
        if (normalizedStatus === 'failed') return 'Failed';
        if (normalizedStatus === 'succeeded') return 'Complete';
        switch (normalized) {
            case 'queued':          return 'Queued';
            case 'initializing':    return 'Starting';
            case 'prepass':         return 'Prepass';
            case 'stage1':          return 'Stage 1 Research';
            case 'stage2':          return 'Stage 2 Ranking';
            case 'stage2_5':        return 'Stage 2.5 Revision';
            case 'stage3':          return 'Stage 3 Synthesis';
            case 'stage3_secondary':return 'Stage 3 Compare';
            case 'complete':        return 'Complete';
            default:                return 'Running';
        }
    };

    const councilStageDetail = (
        stage: string,
        stageMessage: string,
    ): string => {
        const message = String(stageMessage || '').trim();
        const lower = message.toLowerCase();
        if (!message) return 'Preparing analysis';
        if (lower.includes('queued')) return 'Waiting to start';
        if (lower.includes('subprocess started')) return 'Booting worker';
        if (lower.includes('market facts prepass start')) return 'Collecting market facts';
        if (lower.includes('market facts prepass done')) return 'Market facts ready';
        if (lower.includes('primary injection prepass start')) return 'Building evidence packet';
        if (lower.includes('primary injection bundle ready')) return 'Evidence packet ready';
        if (lower.includes('stage 1 start')) return 'Gathering evidence';
        if (lower.includes('stage1 progress')) return 'Evaluating model responses';
        if (lower.includes('stage 1 done')) return 'Research complete';
        if (lower.includes('stage 2 start')) return 'Ranking model outputs';
        if (lower.includes('stage 2 done')) return 'Ranking complete';
        if (lower.includes('stage 2.5 revision pass start')) return 'Revising Stage 1 outputs';
        if (lower.includes('stage 2.5 revision pass done')) return 'Revision pass complete';
        if (lower.includes('stage 3 start')) return 'Synthesizing final analysis';
        if (lower.includes('stage 3 primary done')) return 'Primary synthesis complete';
        if (lower.includes('stage 3 secondary start')) return 'Generating comparison synthesis';
        if (lower.includes('stage 3 secondary done')) return 'Comparison synthesis complete';
        if (lower.includes('run completed successfully')) return 'Analysis ready';
        if (lower.includes('reconnecting')) return message;

        const stageKey = String(stage || '').trim().toLowerCase();
        if (stageKey === 'prepass') return 'Preparing evidence packet';
        if (stageKey === 'stage1') return 'Evaluating model responses';
        if (stageKey === 'stage2') return 'Ranking model outputs';
        if (stageKey === 'stage2_5') return 'Revision pass';
        if (stageKey === 'stage3') return 'Synthesizing final analysis';
        return message;
    };

    const councilDisplayProgressPct = (
        status: string,
        stage: string,
        rawPct: unknown,
    ): number => {
        const numeric = Number(rawPct);
        let pct = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
        const normalizedStatus = String(status || '').trim().toLowerCase();
        const normalizedStage = String(stage || '').trim().toLowerCase();
        if (normalizedStatus === 'running' && normalizedStage !== 'complete') {
            pct = Math.min(pct, 99);
        }
        const stageCaps: Record<string, number> = {
            prepass: 16,
            stage1: 55,
            stage2: 72,
            stage2_5: 84,
            stage3: 95,
            stage3_secondary: 98,
        };
        if (stageCaps[normalizedStage] != null) {
            pct = Math.min(pct, stageCaps[normalizedStage]);
        }
        return Math.round(pct);
    };

    // ── Council import query helpers ─────────────────────────────────────────

    const hasCouncilImportedAnalysis = (stock: Stock): boolean => {
        const numericSignals = [
            stock.councilQuality, stock.councilValue, stock.councilPT,
            stock.analystPT, stock.upside24M,
            stock.bearCasePT, stock.baseCasePT, stock.bullCasePT,
            stock.bearCasePT12M, stock.baseCasePT12M, stock.bullCasePT12M,
            stock.bearProbability, stock.baseProbability, stock.bullProbability,
            stock.bearProbability12M, stock.baseProbability12M, stock.bullProbability12M,
        ];
        if (numericSignals.some((v) => Number(v || 0) > 0)) return true;
        if (String(stock.thesis || '').trim()) return true;
        if (String(stock.catalysts || '').trim()) return true;
        return false;
    };

    const hasCouncilCatalystContent = (stock: Stock): boolean => {
        const raw = String(stock.catalysts || '').trim();
        if (!raw) return false;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return false;
            return parsed.some((entry) => {
                const name = String(entry?.name || '').trim();
                const date = String(entry?.date || '').trim();
                const period = String(entry?.period || '').trim();
                return Boolean(name || date || period);
            });
        } catch {
            return false;
        }
    };

    const hasCouncilResearchPanelContent = (stock: Stock): boolean => {
        if (String(stock.thesis || '').trim()) return true;
        const scenarioSignals = [
            stock.bearCasePT, stock.baseCasePT, stock.bullCasePT,
            stock.bearCasePT12M, stock.baseCasePT12M, stock.bullCasePT12M,
            stock.bearProbability, stock.baseProbability, stock.bullProbability,
            stock.bearProbability12M, stock.baseProbability12M, stock.bullProbability12M,
        ];
        if (scenarioSignals.some((value) => Number(value || 0) > 0)) return true;
        return hasCouncilCatalystContent(stock);
    };

    // ── Ticker context resolver ──────────────────────────────────────────────

    const councilResolveTickerContext = (
        stock: Stock,
    ): { ticker: string; exchange: string; hasPrefix: boolean } => {
        const rawPrefix = String(stock.prefix || '').trim().toUpperCase();
        const symbol = String(stock.symbol || '').trim().toUpperCase();
        if (!symbol) return { ticker: '', exchange: '', hasPrefix: false };
        const prefix = rawPrefix
            ? rawPrefix.endsWith(':')
                ? rawPrefix
                : `${rawPrefix}:`
            : '';
        const ticker = prefix ? `${prefix}${symbol}` : symbol;
        const exchange = prefix ? prefix.slice(0, -1) : '';
        return { ticker, exchange, hasPrefix: Boolean(prefix) };
    };

    const councilParseTicker = (stock: Stock): string =>
        councilResolveTickerContext(stock).ticker;

    // ── Period → ISO date converter ──────────────────────────────────────────

    const councilPeriodToDate = (period: string): string => {
        const p = String(period || '').toUpperCase().trim();
        const iso = p.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        const q = p.match(/Q([1-4])\s*(20\d{2})/);
        if (q) return `${q[2]}-${String(Number(q[1]) * 3).padStart(2, '0')}-15`;
        const h = p.match(/H([12])\s*(20\d{2})/);
        if (h) return `${h[2]}-${Number(h[1]) === 1 ? '03' : '09'}-15`;
        const hCy = p.match(/H([12])\s*CY\s*(20\d{2})/);
        if (hCy) return `${hCy[2]}-${Number(hCy[1]) === 1 ? '03' : '09'}-15`;
        const endCy = p.match(/END\s*CY\s*(20\d{2})/);
        if (endCy) return `${endCy[1]}-12-15`;
        const lateCy = p.match(/LATE\s*CY\s*(20\d{2})/);
        if (lateCy) return `${lateCy[1]}-09-15`;
        const midCy = p.match(/MID\s*CY\s*(20\d{2})/);
        if (midCy) return `${midCy[1]}-03-15`;
        const earlyCy = p.match(/(EARLY|START|BEGINNING)\s*CY\s*(20\d{2})/);
        if (earlyCy) return `${earlyCy[2]}-03-15`;
        const monthQuarter = p.match(
            /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+Q\s*(20\d{2})\b/,
        );
        if (monthQuarter) {
            const quarterMap: Record<string, string> = {
                JAN: '03', FEB: '03', MAR: '03',
                APR: '06', MAY: '06', JUN: '06',
                JUL: '09', AUG: '09', SEP: '09', SEPT: '09',
                OCT: '12', NOV: '12', DEC: '12',
            };
            return `${monthQuarter[2]}-${quarterMap[monthQuarter[1]] || '12'}-15`;
        }
        const m = p.match(
            /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s*(20\d{2})\b/,
        );
        if (m) {
            const monthMap: Record<string, string> = {
                JAN: '01', FEB: '02', MAR: '03', APR: '04',
                MAY: '05', JUN: '06', JUL: '07', AUG: '08',
                SEP: '09', SEPT: '09', OCT: '10', NOV: '11', DEC: '12',
            };
            return `${m[2]}-${monthMap[m[1]] || '12'}-15`;
        }
        const y = p.match(/^(20\d{2})$/);
        if (y) return `${y[1]}-12-15`;
        return '';
    };

    // ── Packet parsers ───────────────────────────────────────────────────────

    const buildCouncilStockUpdates = (
        stock: Stock,
        packet: CouncilReportPacket,
    ): Partial<Stock> => {
        const toNum = (v: unknown) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        const pkt = packet as any;
        const summary = pkt?.summary_fields || {};
        const stage = pkt?.lab_payload?.structured_data || {};
        const thesisMap = stage?.thesis_map || {};
        const targets12 = stage?.price_targets?.scenario_targets?.['12m'] || {};
        const probs12 = stage?.price_targets?.scenario_probabilities?.['12m'] || {};
        const targets24 = stage?.price_targets?.scenario_targets?.['24m'] || {};
        const probs24 = stage?.price_targets?.scenario_probabilities?.['24m'] || {};

        const quality = toNum(summary.quality_score);
        const value = toNum(summary.value_score);
        const target24 = toNum(summary.target_24m_base);
        const weighted24 = toNum(summary.prob_weighted_target_24m) ?? target24;
        const currentPrice = toNum(summary.current_price) ?? toNum(stock.price);
        const upside =
            weighted24 != null && currentPrice && currentPrice > 0
                ? ((weighted24 - currentPrice) / currentPrice) * 100
                : null;
        const updates: Partial<Stock> = {};

        if (quality != null) updates.councilQuality = quality;
        if (value != null) updates.councilValue = value;
        if (target24 != null) updates.councilPT = target24;
        if (weighted24 != null) updates.analystPT = weighted24;
        if (upside != null) updates.upside24M = upside;

        const bear = toNum(targets24.bear);
        const base = toNum(targets24.base);
        const bull = toNum(targets24.bull);
        const summaryBase12 = toNum(summary.target_12m_base);
        const headlineBase12 = toNum(stage?.price_targets?.target_12m);
        const bear12 = toNum(targets12.bear) ?? toNum(thesisMap?.bear?.target_12m);
        const base12 =
            toNum(targets12.base) ??
            toNum(thesisMap?.base?.target_12m) ??
            summaryBase12 ??
            headlineBase12;
        const bull12 = toNum(targets12.bull) ?? toNum(thesisMap?.bull?.target_12m);
        if (bear != null) updates.bearCasePT = bear;
        if (base != null) updates.baseCasePT = base;
        if (bull != null) updates.bullCasePT = bull;
        if (bear12 != null) updates.bearCasePT12M = bear12;
        if (base12 != null) updates.baseCasePT12M = base12;
        if (bull12 != null) updates.bullCasePT12M = bull12;

        const toProb = (v: unknown) => {
            const n = toNum(v);
            return n == null ? null : n <= 1 ? n * 100 : n;
        };
        const bearProb = toProb(probs24.bear);
        const baseProb = toProb(probs24.base);
        const bullProb = toProb(probs24.bull);
        const bearProb12 = toProb(probs12.bear);
        const baseProb12 = toProb(probs12.base);
        const bullProb12 = toProb(probs12.bull);
        if (bearProb != null) updates.bearProbability = bearProb;
        if (baseProb != null) updates.baseProbability = baseProb;
        if (bullProb != null) updates.bullProbability = bullProb;
        if (bearProb12 != null) updates.bearProbability12M = bearProb12;
        if (baseProb12 != null) updates.baseProbability12M = baseProb12;
        if (bullProb12 != null) updates.bullProbability12M = bullProb12;

        const rec = stage?.investment_recommendation || {};
        const verdict = stage?.investment_verdict || {};
        const thesis =
            [rec?.summary, rec?.rationale, verdict?.rationale]
                .map((v: any) => String(v || '').trim())
                .filter(Boolean)[0] ||
            String(pkt?.memos?.analyst_memo_markdown || '')
                .split('\n')
                .map((l: string) => l.trim())
                .find((l: string) => l && !l.startsWith('#')) ||
            '';
        if (thesis) updates.thesis = thesis;

        const timelineRows: any[] = Array.isArray(pkt?.timeline_rows)
            ? pkt.timeline_rows
            : [];
        const catalysts = timelineRows
            .map((row: any, idx: number) => {
                const name = sanitizeCouncilCatalystName(
                    row.milestone || row.name || row.event,
                );
                const rawPeriod = String(
                    row.target_period || row.when || '',
                ).trim();
                const date = councilPeriodToDate(rawPeriod);
                const s = String(row.status || '').toLowerCase();
                const impact =
                    s.includes('at_risk') || s.includes('delayed') || s.includes('failed')
                        ? 'HIGH'
                        : s.includes('planned') || s.includes('pending')
                        ? 'MED'
                        : 'LOW';
                return {
                    name: name || 'Milestone',
                    date,
                    period: rawPeriod || '',
                    impact,
                    _idx: idx,
                };
            })
            .filter((c: any) => c.name)
            .sort((a: any, b: any) => {
                const at = Date.parse(String(a?.date || ''));
                const bt = Date.parse(String(b?.date || ''));
                const aValid = Number.isFinite(at);
                const bValid = Number.isFinite(bt);
                if (aValid && bValid) {
                    if (at !== bt) return at - bt;
                    return Number(a?._idx ?? 0) - Number(b?._idx ?? 0);
                }
                if (aValid) return -1;
                if (bValid) return 1;
                return Number(a?._idx ?? 0) - Number(b?._idx ?? 0);
            })
            .map((c: any) => ({
                name: c.name,
                date: c.date,
                period: c.period || '',
                impact: c.impact,
            }))
            .slice(0, 12);
        if (catalysts.length) updates.catalysts = JSON.stringify(catalysts);

        return updates;
    };

    const extractCouncilTemplateId = (packet: CouncilReportPacket): string => {
        const pkt = packet as any;
        const summaryTemplateId = String(pkt?.summary_fields?.template_id || '').trim();
        if (summaryTemplateId) return summaryTemplateId;
        const stage = pkt?.lab_payload?.structured_data || {};
        const directTemplateId = String(stage?.template_id || '').trim();
        if (directTemplateId) return directTemplateId;
        const topLevelContractTemplateId = String(stage?.template_contract?.id || '').trim();
        if (topLevelContractTemplateId) return topLevelContractTemplateId;
        const councilMetaContractTemplateId = String(
            stage?.council_metadata?.template_contract?.id || '',
        ).trim();
        if (councilMetaContractTemplateId) return councilMetaContractTemplateId;
        return '';
    };

    const councilApplyPacket = async (
        stock: Stock,
        packet: CouncilReportPacket,
        runMeta?: { runId?: string; runLabel?: string },
    ) => {
        const updates = buildCouncilStockUpdates(stock, packet);
        const resolvedTemplateId = extractCouncilTemplateId(packet);
        const normalizedRunMeta = normalizeCouncilRunMeta(
            runMeta?.runId,
            runMeta?.runLabel,
        );
        const nextStockUpdates: Partial<Stock> = { ...updates };
        if (resolvedTemplateId) {
            nextStockUpdates.templateId = resolvedTemplateId;
        }
        if (normalizedRunMeta.runId) {
            nextStockUpdates.councilRunId = normalizedRunMeta.runId;
            nextStockUpdates.councilRunLabel = normalizedRunMeta.runLabel;
        }

        if (Object.keys(nextStockUpdates).length) {
            updateStock(stock.id, nextStockUpdates);
        }

        if (
            resolvedTemplateId &&
            stock.symbol &&
            stock.prefix &&
            resolvedTemplateId !== (stock.templateId || '')
        ) {
            try {
                await api.updateTickerMapping(
                    stock.name,
                    stock.symbol,
                    stock.prefix,
                    resolvedTemplateId,
                );
            } catch (error) {
                console.warn(
                    '[ALPHA EDGE] Failed to persist council template mapping:',
                    error,
                );
            }
        }

        if (!stock.analysisId) return;

        const merged = { ...stock, ...nextStockUpdates };
        await api.updateAnalysis(stock.analysisId, {
            ticker: (merged.prefix || '') + merged.symbol,
            council_quality: merged.councilQuality || 0,
            council_value: merged.councilValue || 0,
            council_pt: merged.councilPT || 0,
            council_run_id: merged.councilRunId || null,
            council_run_label: merged.councilRunLabel || null,
            analyst_pt: merged.analystPT || 0,
            upside_24m: merged.upside24M || 0,
            thesis: merged.thesis || null,
            bear_case_pt: merged.bearCasePT || 0,
            base_case_pt: merged.baseCasePT || 0,
            bull_case_pt: merged.bullCasePT || 0,
            bear_probability: merged.bearProbability || 0,
            base_probability: merged.baseProbability || 0,
            bull_probability: merged.bullProbability || 0,
            catalysts: merged.catalysts || null,
        });
    };

    // ── Async run / load operations ──────────────────────────────────────────

    const clearCouncilImportedAnalysis = async (stock: Stock) => {
        const key = stock.symbol || stock.name;
        const cleared: Partial<Stock> = {
            councilQuality: 0, councilValue: 0, councilPT: 0,
            analystPT: 0, upside24M: 0, thesis: null,
            bearCasePT: 0, baseCasePT: 0, bullCasePT: 0,
            bearCasePT12M: 0, baseCasePT12M: 0, bullCasePT12M: 0,
            bearProbability: 0, baseProbability: 0, bullProbability: 0,
            bearProbability12M: 0, baseProbability12M: 0, bullProbability12M: 0,
            catalysts: null, councilRunId: null, councilRunLabel: null,
        };

        updateStock(stock.id, cleared);
        setCouncilRunIds((prev) => { const n = { ...prev }; delete n[key]; return n; });
        setCouncilProgressStage((prev) => { const n = { ...prev }; delete n[key]; return n; });
        setCouncilError((prev) => { const n = { ...prev }; delete n[key]; return n; });
        setCouncilProgress((prev) => { const n = { ...prev }; delete n[key]; return n; });
        setCouncilProgressPct((prev) => { const n = { ...prev }; delete n[key]; return n; });
        setShowResearchPanel((prev) => { const n = { ...prev }; delete n[key]; return n; });

        if (!stock.analysisId) return;

        try {
            await api.updateAnalysis(stock.analysisId, {
                council_quality: 0, council_value: 0, council_pt: 0,
                council_run_id: null, council_run_label: null,
                analyst_pt: 0, upside_24m: 0, thesis: null,
                bear_case_pt: 0, base_case_pt: 0, bull_case_pt: 0,
                bear_probability: 0, base_probability: 0, bull_probability: 0,
                catalysts: null,
            });
        } catch (error) {
            console.error(
                `[ALPHA EDGE] Failed to clear council import for ${stock.name}:`,
                error,
            );
            setCouncilError((prev) => ({
                ...prev,
                [key]: 'Failed to clear imported council analysis',
            }));
        }
    };

    const openCouncilRunsManager = (stock: Stock, focusRunId = '') => {
        const { ticker } = councilResolveTickerContext(stock);
        const params = new URLSearchParams();
        if (ticker) params.set('ticker', ticker);
        if (String(focusRunId || '').trim())
            params.set('run_id', String(focusRunId).trim());
        const qs = params.toString();
        const url = `https://llm-council-analysis.fly.dev/gantt-lab${qs ? `?${qs}` : ''}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const loadCouncilRunById = async (stock: Stock, runId: string) => {
        const key = stock.symbol || stock.name;
        const normalizedRunId = String(runId || '').trim();
        if (!normalizedRunId) return;

        setCouncilRunning((prev) => ({ ...prev, [key]: true }));
        setCouncilError((prev) => ({ ...prev, [key]: '' }));
        setCouncilProgress((prev) => ({ ...prev, [key]: 'loading selected run…' }));
        setCouncilProgressPct((prev) => ({ ...prev, [key]: 0 }));
        try {
            const selectedRun = await api.getCouncilRunById(normalizedRunId);
            if (!selectedRun?.report_packet)
                throw new Error('No report packet for selected run');
            const runMeta = normalizeCouncilRunMeta(
                selectedRun.run_id || normalizedRunId,
                selectedRun.run_label,
            );
            await councilApplyPacket(stock, selectedRun.report_packet, runMeta);
            setCouncilRunIds((prev) => ({ ...prev, [key]: runMeta.runId }));
            setCouncilProgress((prev) => ({ ...prev, [key]: 'loaded' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 100 }));
            setCouncilRunPickerOpen((prev) => ({ ...prev, [key]: false }));
        } catch (err: any) {
            setCouncilError((prev) => ({
                ...prev,
                [key]: String(err?.message || err || 'Failed to load selected run'),
            }));
            setCouncilProgress((prev) => ({ ...prev, [key]: '' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 0 }));
        } finally {
            setCouncilRunning((prev) => ({ ...prev, [key]: false }));
        }
    };

    const toggleCouncilRunPicker = async (stock: Stock) => {
        const key = stock.symbol || stock.name;
        const nextOpen = !Boolean(councilRunPickerOpen[key]);
        setCouncilRunPickerOpen((prev) => ({ ...prev, [key]: nextOpen }));
        if (!nextOpen) return;

        const { ticker, hasPrefix } = councilResolveTickerContext(stock);
        if (!ticker) return;
        if (!hasPrefix) {
            setCouncilError((prev) => ({
                ...prev,
                [key]: 'Missing exchange prefix in stored mapping. Set the ticker mapping before loading council runs.',
            }));
            return;
        }

        setCouncilRunOptionsLoading((prev) => ({ ...prev, [key]: true }));
        setCouncilError((prev) => ({ ...prev, [key]: '' }));
        try {
            const payload = await api.getCouncilRunsByTicker(ticker, 12);
            setCouncilRunOptions((prev) => ({
                ...prev,
                [key]: Array.isArray(payload?.runs) ? payload.runs : [],
            }));
        } catch (err: any) {
            setCouncilError((prev) => ({
                ...prev,
                [key]: String(err?.message || err || 'Failed to load council runs'),
            }));
        } finally {
            setCouncilRunOptionsLoading((prev) => ({ ...prev, [key]: false }));
        }
    };

    const runCouncilForStock = async (stock: Stock) => {
        const key = stock.symbol || stock.name;
        const { ticker, exchange, hasPrefix } = councilResolveTickerContext(stock);
        const supplementaryFile = councilSupplementaryFiles[key] || null;
        if (!ticker) return;
        if (!hasPrefix || !exchange) {
            setCouncilError((prev) => ({
                ...prev,
                [key]: 'Missing exchange prefix in stored mapping. Set the ticker mapping before running council.',
            }));
            setCouncilProgress((prev) => ({ ...prev, [key]: 'missing prefix' }));
            return;
        }
        const storedTemplateId = String(stock.templateId || '').trim();
        const assetClassTemplateId = getCouncilTemplateForAssetClass(
            stock.primaryAssetClass,
        );
        const resolvedTemplateId = assetClassTemplateId || storedTemplateId || undefined;
        setCouncilRunning((prev) => ({ ...prev, [key]: true }));
        setCouncilError((prev) => ({ ...prev, [key]: '' }));
        setCouncilProgressStage((prev) => ({ ...prev, [key]: 'Queued' }));
        setCouncilProgress((prev) => ({ ...prev, [key]: 'Submitting run request' }));
        setCouncilProgressPct((prev) => ({ ...prev, [key]: 0 }));
        let createdJobId = '';
        try {
            let job = await api.createCouncilAnalysisJob(
                {
                    query: `Run full analysis on ${stock.name} (${ticker})`,
                    ticker,
                    company_name: stock.name,
                    template_id: resolvedTemplateId,
                    company_type: resolvedTemplateId,
                    exchange,
                    stage2_revision_pass: 'on',
                },
                supplementaryFile,
            );
            createdJobId = String(job?.job_id || '').trim();
            setCouncilProgressStage((prev) => ({ ...prev, [key]: 'Queued' }));
            setCouncilProgress((prev) => ({ ...prev, [key]: 'Waiting to start' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 0 }));
            let pollCount = 0;
            let consecutivePollErrors = 0;
            const maxConsecutivePollErrors = 5;
            while (job.status !== 'succeeded' && job.status !== 'failed') {
                await new Promise((r) => setTimeout(r, 6000));
                try {
                    job = await api.getCouncilAnalysisJob(job.job_id);
                    consecutivePollErrors = 0;
                    pollCount++;
                    const pct = councilDisplayProgressPct(job.status, job.stage, job.progress_pct);
                    const elapsed = Math.round((pollCount * 6) / 60);
                    const stageLabel = councilStageLabel(job.stage, job.status);
                    const stageDetail = councilStageDetail(job.stage, job.stage_message);
                    setCouncilProgressPct((prev) => ({ ...prev, [key]: pct }));
                    setCouncilProgressStage((prev) => ({ ...prev, [key]: stageLabel }));
                    setCouncilProgress((prev) => ({ ...prev, [key]: `${stageDetail} · ${elapsed}m` }));
                } catch (pollErr: any) {
                    consecutivePollErrors += 1;
                    setCouncilProgressStage((prev) => ({ ...prev, [key]: 'Reconnecting' }));
                    setCouncilProgress((prev) => ({
                        ...prev,
                        [key]: `reconnecting ${consecutivePollErrors}/${maxConsecutivePollErrors}…`,
                    }));
                    if (consecutivePollErrors < maxConsecutivePollErrors) {
                        continue;
                    }
                    // Recovery path: server may have a completed run despite polling failures.
                    try {
                        const latest = await api.getLatestCouncilRunByTicker(ticker);
                        if (latest?.report_packet) {
                            const recoveredRunMeta = normalizeCouncilRunMeta(
                                latest.run_id,
                                latest.run_label,
                            );
                            await councilApplyPacket(stock, latest.report_packet, recoveredRunMeta);
                            if (recoveredRunMeta.runId)
                                setCouncilRunIds((prev) => ({ ...prev, [key]: recoveredRunMeta.runId }));
                            setCouncilProgressStage((prev) => ({ ...prev, [key]: 'Recovered' }));
                            setCouncilProgress((prev) => ({ ...prev, [key]: 'Recovered from server state' }));
                            setCouncilProgressPct((prev) => ({ ...prev, [key]: 100 }));
                            return;
                        }
                    } catch {
                        // fall through to explicit failure below
                    }
                    throw new Error(
                        `Polling lost connection after ${maxConsecutivePollErrors} retries. ` +
                            `The job may still be running on server. Job ID: ${createdJobId || job.job_id || 'n/a'}`,
                    );
                }
            }
            if (job.status !== 'succeeded')
                throw new Error(job.error || `Job did not complete (${job.status})`);
            setCouncilProgressStage((prev) => ({ ...prev, [key]: 'Finalizing' }));
            setCouncilProgress((prev) => ({ ...prev, [key]: 'Applying final analysis' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 100 }));
            const result = await api.getCouncilAnalysisResult(job.job_id);
            const packet = result?.report_packet;
            if (!packet) throw new Error('Missing report packet');
            const runMeta = normalizeCouncilRunMeta(
                (result?.run as any)?.id || (packet as any)?.run_id || '',
                (result?.run as any)?.label || (result?.run as any)?.file || '',
            );
            await councilApplyPacket(stock, packet, runMeta);
            if (runMeta.runId)
                setCouncilRunIds((prev) => ({ ...prev, [key]: runMeta.runId }));
            setCouncilProgressStage((prev) => ({ ...prev, [key]: 'Complete' }));
            setCouncilProgress((prev) => ({ ...prev, [key]: 'Analysis ready' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 100 }));
        } catch (err: any) {
            setCouncilError((prev) => ({
                ...prev,
                [key]: String(err?.message || err || 'Failed'),
            }));
            setCouncilProgressStage((prev) => ({ ...prev, [key]: isCouncilSubmissionUncertain(err) ? 'Submission uncertain' : 'Failed' }));
            setCouncilProgress((prev) => ({ ...prev, [key]: isCouncilSubmissionUncertain(err) ? 'Check existing jobs before resubmitting' : 'Run failed' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 0 }));
        } finally {
            setCouncilRunning((prev) => ({ ...prev, [key]: false }));
        }
    };

    const loadLatestCouncilRun = async (stock: Stock) => {
        const key = stock.symbol || stock.name;
        const { ticker, hasPrefix } = councilResolveTickerContext(stock);
        if (!ticker) return;
        if (!hasPrefix) {
            setCouncilError((prev) => ({
                ...prev,
                [key]: 'Missing exchange prefix in stored mapping. Set the ticker mapping before loading council runs.',
            }));
            setCouncilProgress((prev) => ({ ...prev, [key]: 'missing prefix' }));
            return;
        }
        setCouncilRunning((prev) => ({ ...prev, [key]: true }));
        setCouncilError((prev) => ({ ...prev, [key]: '' }));
        setCouncilProgress((prev) => ({ ...prev, [key]: 'loading…' }));
        setCouncilProgressPct((prev) => ({ ...prev, [key]: 0 }));
        try {
            const latest = await api.getLatestCouncilRunByTicker(ticker);
            if (!latest?.report_packet)
                throw new Error('No report packet for latest run');
            const latestRunMeta = normalizeCouncilRunMeta(
                latest.run_id,
                latest.run_label,
            );
            await councilApplyPacket(stock, latest.report_packet, latestRunMeta);
            if (latestRunMeta.runId)
                setCouncilRunIds((prev) => ({ ...prev, [key]: latestRunMeta.runId }));
            setCouncilProgress((prev) => ({ ...prev, [key]: 'done' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 100 }));
        } catch (err: any) {
            const rawMessage = String(err?.message || err || 'Failed');
            const friendlyMessage = rawMessage.toLowerCase().includes('no saved council run')
                ? 'No saved run'
                : rawMessage;
            setCouncilError((prev) => ({ ...prev, [key]: friendlyMessage }));
            setCouncilProgress((prev) => ({ ...prev, [key]: '' }));
            setCouncilProgressPct((prev) => ({ ...prev, [key]: 0 }));
        } finally {
            setCouncilRunning((prev) => ({ ...prev, [key]: false }));
        }
    };

    // ── Return ───────────────────────────────────────────────────────────────

    return {
        // Provider detail display state
        showGeminiDetails,
        showGptDetails,
        showPerplexityDetails,
        showClaudeDetails,
        showCouncilDetails,
        showTvPtEdit,
        setShowTvPtEdit,
        showResearchPanel,
        setShowResearchPanel,

        // Council run state
        councilRunning,
        councilProgress,
        councilProgressStage,
        councilProgressPct,
        councilRunIds,
        councilRunPickerOpen,
        councilRunOptions,
        councilRunOptionsLoading,
        councilError,
        councilSupplementaryFiles,

        // Derived
        analysisNextCatalystByStockId,

        // Provider detail toggles
        toggleGeminiDetails,
        toggleGptDetails,
        togglePerplexityDetails,
        toggleClaudeDetails,
        toggleCouncilDetails,

        // Supplementary file helpers
        setCouncilSupplementaryFileForKey,

        // Council query helpers
        hasCouncilImportedAnalysis,
        hasCouncilCatalystContent,
        hasCouncilResearchPanelContent,

        // Council run management
        toggleCouncilRunPicker,
        loadCouncilRunById,
        loadLatestCouncilRun,
        runCouncilForStock,
        clearCouncilImportedAnalysis,
        openCouncilRunsManager,

        // Display helpers
        buildCouncilRunOptionLabel,
        councilResolveTickerContext,
        councilParseTicker,
        councilStageLabel,
        councilStageDetail,
        councilDisplayProgressPct,
        sanitizeCouncilCatalystName,
        formatCouncilRunTimestamp,
        shortCouncilRunId,
    };
}
