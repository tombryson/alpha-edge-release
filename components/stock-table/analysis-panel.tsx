'use client';
import { hasMissingSizingResearch } from '@/lib/positions-model-weight';

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import * as Dialog from '@radix-ui/react-dialog';
import { ResizableGrid } from './resizable-grid';
import { useStore } from '@/lib/store';
import { useContextPanelStore } from '@/lib/context-panel-store';
import type { Stock } from '@/lib/store';
import {
    api,
    getCouncilTemplateForAssetClass,
    type AssetClass,
    type AssetClassConfig,
    type CouncilReportPacket,
} from '@/lib/api';
import {
    defaultAnalysisVisibleColumns,
    type AnalysisGridColumn,
    type AnalysisGridColumnKey,
    type AnalysisVisibleColumns,
} from '@/components/stock-table/columns';
import {
    analysisPerformanceToneClass,
    formatAnalysisPerformancePct,
    formatPerformanceDate,
    isStalePerformance,
    stalePerformanceClass,
} from '@/components/stock-table/formatters';
import {
    calculateAnalysisMomentumModifier,
    calculateAnalysisProviderScore,
    calculateAnalysisTargetWeight,
    calculateAverageCompletedModelField,
    calculateAverageCompletedModelScore,
    calculateAveragePriceTarget,
    calculateBaseRatingTotal,
    calculateCouncilCompositeScore,
    getAnalysisModelCompletion,
    hasAnalysisSizingEvidence,
    isAnalysisModelRunComplete,
} from '@/components/stock-table/ratings';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import { assetClassColor } from '@/lib/asset-class-identity';
import { positionRowClassKey } from '@/lib/position-row-appearance';
import { usePositionRowAppearanceSync } from '@/lib/position-row-appearance-store';
import { PositionRowIconPicker } from './position-row-icon-picker';
import appearanceStyles from './position-row-appearance.module.css';
import {
    getAnalysisExchangeCode,
    getAnalysisGroupPerformance,
    matchesAnalysisSearch,
} from '@/lib/analysis-workbench';
import { getAnalysisAssetClasses } from '@/lib/asset-classes';
import { isNonAllocatingSecurityType } from '@/lib/security-types';
import { useStockTableContext } from '@/components/stock-table/stock-table-context';
import { AnalysisColumnHeader } from '@/components/stock-table/analysis-column-header';
import { CommodityThemePathIndicator } from '@/components/commodity-theme-path-indicator';
import { AlertStatusIndicator } from '@/components/alert-status-indicator';
import type { PositionBucketKey } from '@/components/stock-table/types';
import type { StockGroup } from '@/lib/api';
import { Archive, ArrowUpRight, Eye, FileText, Focus, Pin, RotateCcw, TrendingUp } from 'lucide-react';
import { CouncilControlsDialog } from '@/components/council-controls-dialog';
import { AnalysisRowResearch } from './analysis-row-research';
import { AnalysisRunTemplate } from './analysis-run-template';
import { isWatchlistStock, openWatchlistEntry } from '@/lib/watchlist-opportunities';

const ResearchPanel = dynamic(
    () =>
        import('@/components/research-panel').then(
            (module) => module.ResearchPanel,
        ),
    {
        ssr: false,
        loading: () => (
            <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                Loading research panel...
            </div>
        ),
    },
);

const analysisAlertOvalStyle = {
    width: 'calc(var(--spacing) * 2)',
    height: 'calc(var(--spacing) * 6)',
    borderRadius: '30%',
};

const activeAlertSymbol = (ticker?: string | null) =>
    String(ticker || '')
        .split(':')
        .pop()
        ?.toUpperCase() || '';

type AnalysisModelKey = 'gemini' | 'gpt' | 'perplexity' | 'claude';

type AnalysisCompletionState = 'complete' | 'provisional' | 'early' | 'not-run';

type AnalysisRunDraft = {
    quality: string;
    value: string;
    priceTarget: string;
    inputAt: string;
    sourceText: string;
};

type AnalysisModelDefinition = {
    key: AnalysisModelKey;
    label: string;
    shortLabel: string;
    qualityField: keyof Stock;
    valueField: keyof Stock;
    ptField: keyof Stock;
    sourceField: keyof Stock;
    inputAtField: keyof Stock;
};

const ANALYSIS_EXPECTED_MODELS: AnalysisModelDefinition[] = [
    {
        key: 'gemini',
        label: 'Gemini',
        shortLabel: 'GEM',
        qualityField: 'geminiQuality',
        valueField: 'geminiValue',
        ptField: 'geminiPT',
        sourceField: 'geminiWebuiOutput',
        inputAtField: 'geminiWebuiInputAt',
    },
    {
        key: 'gpt',
        label: 'GPT',
        shortLabel: 'GPT',
        qualityField: 'gptQuality',
        valueField: 'gptValue',
        ptField: 'gptPT',
        sourceField: 'gptWebuiOutput',
        inputAtField: 'gptWebuiInputAt',
    },
    {
        key: 'perplexity',
        label: 'Perplexity',
        shortLabel: 'PPLX',
        qualityField: 'perplexityQuality',
        valueField: 'perplexityValue',
        ptField: 'perplexityPT',
        sourceField: 'perplexityWebuiOutput',
        inputAtField: 'perplexityWebuiInputAt',
    },
    {
        key: 'claude',
        label: 'Claude',
        shortLabel: 'CLD',
        qualityField: 'claudeQuality',
        valueField: 'claudeValue',
        ptField: 'claudePT',
        sourceField: 'claudeWebuiOutput',
        inputAtField: 'claudeWebuiInputAt',
    },
];

const ANALYSIS_PROVISIONAL_MIN = 3;

const stockNumberValue = (stock: Stock, field: keyof Stock) => {
    const value = stock[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const stockStringValue = (stock: Stock, field: keyof Stock) => {
    const value = stock[field];
    return typeof value === 'string' ? value : null;
};

const getAnalysisModelRuns = (stock: Stock) =>
    ANALYSIS_EXPECTED_MODELS.map((definition) => {
        const quality = stockNumberValue(stock, definition.qualityField);
        const value = stockNumberValue(stock, definition.valueField);
        const priceTarget = stockNumberValue(stock, definition.ptField);
        return {
            definition,
            quality,
            value,
            priceTarget,
            sourceText: stockStringValue(stock, definition.sourceField),
            inputAt: stockStringValue(stock, definition.inputAtField),
            complete: isAnalysisModelRunComplete(quality, value, priceTarget),
        };
    });

const getAnalysisCompletionState = (
    completion: ReturnType<typeof getAnalysisModelCompletion>,
): AnalysisCompletionState => {
    if (completion.completed === 0) return 'not-run';
    if (completion.completed === completion.total) return 'complete';
    if (completion.completed >= ANALYSIS_PROVISIONAL_MIN) return 'provisional';
    return 'early';
};

const parsePositiveFloat = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const emptyAnalysisRunDraft: AnalysisRunDraft = {
    quality: '',
    value: '',
    priceTarget: '',
    inputAt: '',
    sourceText: '',
};

// Strong research (80+) is green and weak research (below 50) is red. The
// ordinary middle range stays neutral: an amber band there coloured nearly
// every row and hid the good and bad news.
const scoreColor = (value?: number | null) => {
    if (value == null || !Number.isFinite(value)) return 'var(--foreground)';
    if (value >= 80) return 'var(--signal-buy)';
    if (value < 50) return 'var(--signal-sell)';
    return 'var(--foreground)';
};

const scoreBarColor = (value?: number | null) => {
    if (value != null && Number.isFinite(value) && (value >= 80 || value < 50)) return scoreColor(value);
    return 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)';
};

// Signed returns carry direction only: positive, negative, or neutral at zero.
const signColor = (value?: number | null) => {
    if (value == null || !Number.isFinite(value) || value === 0) return 'var(--muted-foreground)';
    return value > 0 ? 'var(--signal-buy)' : 'var(--signal-sell)';
};

const formatAnalysisScore = (value: number) => Math.round(value).toString();

const targetWeightColor = (): string =>
    'color-mix(in srgb, var(--primary) 32%, var(--muted-foreground) 68%)';

/** Compact dollar formatter for the Target Weight cell (76px column). */
const formatTargetDollar = (d: number): string => {
    if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
    if (d >= 10_000)    return `$${Math.round(d / 1_000)}k`;
    if (d >= 1_000)     return `$${(d / 1_000).toFixed(1)}k`;
    return `$${Math.round(d)}`;
};

const targetUpsideColor = (value?: number | null) => {
    if (value == null || !Number.isFinite(value)) return 'var(--muted-foreground)';
    if (value < 0) return 'var(--signal-sell)';
    if (value < 50) return 'var(--signal-warn)';
    return 'var(--signal-buy)';
};

const targetUpsideTone = (value?: number | null) => {
    if (value == null || !Number.isFinite(value)) return 'muted';
    if (value < 0) return 'sell';
    if (value < 50) return 'warn';
    return 'buy';
};

const extractSourceMetric = (source: string, labels: string[]) => {
    for (const label of labels) {
        const pattern = new RegExp(`${label}\\s*(?:score|target|pt)?\\s*[:=\\-]?\\s*\\$?([0-9]+(?:\\.[0-9]+)?)`, 'i');
        const match = source.match(pattern);
        if (match?.[1]) return match[1];
    }
    return '';
};

const inferDraftFromSource = (source: string): Partial<AnalysisRunDraft> => ({
    quality: extractSourceMetric(source, ['quality', 'qual']),
    value: extractSourceMetric(source, ['value', 'valuation']),
    priceTarget: extractSourceMetric(source, ['price target', 'target price', 'pt', '24m target']),
});

const ratingCompletionCellStyle = (_ratio: number): React.CSSProperties => ({});

const MODEL_SOURCE_STALE_DAYS = 90;

const toDateInputValue = (value?: string | null) => {
    if (!value) return '';
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const modelSourceAgeDays = (value?: string | null) => {
    const dateValue = toDateInputValue(value);
    if (!dateValue) return null;
    const parsed = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    const elapsed = Date.now() - parsed.getTime();
    return Math.max(0, Math.floor(elapsed / 86_400_000));
};

const ModelSourceStamp = ({
    inputAt,
    hasModelValues,
    staleOnly = false,
}: {
    inputAt?: string | null;
    hasModelValues: boolean;
    /** Table cells show the age only once it needs attention; the age stays in the tooltip. */
    staleOnly?: boolean;
}) => {
    const ageDays = modelSourceAgeDays(inputAt);
    if (staleOnly) {
        if (ageDays == null || ageDays <= MODEL_SOURCE_STALE_DAYS) return null;
        return (
            <span
                className="analysis-council-stale"
                title={`${ageDays} days old; refresh this model run`}
            >
                {ageDays}d
            </span>
        );
    }
    if (ageDays == null && !hasModelValues) return null;
    if (ageDays == null) {
        return (
            <span className="text-[8px] font-mono leading-none text-muted-foreground">
                -
            </span>
        );
    }
    const stale = ageDays > MODEL_SOURCE_STALE_DAYS;
    return (
        <span
            className={`text-[8px] font-mono leading-none ${
                stale ? 'text-destructive' : 'text-muted-foreground'
            }`}
            title={
                stale
                    ? `${ageDays} days old; refresh this model run`
                    : `${ageDays} days old`
            }
        >
            {ageDays}d
        </span>
    );
};

const isAnalysisEtf = (stock: Pick<Stock, 'securityType'>) =>
    String(stock.securityType || '').trim().toUpperCase() === 'ETF';

const ModelSourceCapture = ({
    stockId,
    output,
    outputField,
    inputAt,
    inputAtField,
    onFieldUpdate,
}: {
    stockId: number;
    output?: string | null;
    outputField: keyof Stock;
    inputAt?: string | null;
    inputAtField: keyof Stock;
    onFieldUpdate: (
        id: number,
        field: keyof Stock,
        value: number | string | null,
    ) => void;
}) => (
    <div className="mt-2 border-t border-border/40 pt-2">
        <div className="mb-1 flex items-center gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                Input date
                <input
                    type="date"
                    value={toDateInputValue(inputAt)}
                    onChange={(event) =>
                        onFieldUpdate(
                            stockId,
                            inputAtField,
                            event.target.value || null,
                        )
                    }
                    className="border border-border/50 bg-background px-1 py-0.5 text-[10px] normal-case tracking-normal text-foreground"
                />
            </label>
            <button
                type="button"
                onClick={() =>
                    onFieldUpdate(
                        stockId,
                        inputAtField,
                        new Date().toISOString().slice(0, 10),
                    )
                }
                className="mt-4 border border-border/50 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
            >
                Today
            </button>
        </div>
        <label className="flex flex-col gap-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            Source text
            <textarea
                key={`${stockId}-${String(outputField)}-${output?.length || 0}`}
                defaultValue={output || ''}
                onBlur={(event) =>
                    onFieldUpdate(
                        stockId,
                        outputField,
                        event.target.value.trim() || null,
                    )
                }
                rows={5}
                placeholder="Paste the model output here"
                className="min-h-24 resize-y border border-border/50 bg-background px-2 py-1 text-[10px] normal-case leading-snug tracking-normal text-foreground"
            />
        </label>
    </div>
);

export function AnalysisPanel() {
    usePositionRowAppearanceSync();
    // ── Store ─────────────────────────────────────────────────────────────────
    const stocks = useStore((state) => state.stocks);
    const updateStock = useStore((state) => state.updateStock);
    const fetchHoldings = useStore((state) => state.fetchHoldings);
    const fetchActiveAlerts = useStore((state) => state.fetchActiveAlerts);

    // ── Context ────────────────────────────────────────────────────────────────
    const {
        sortedStocks,
        positionStocks,
        assetClasses,
        assetClassConfig,
        monitoringBenchmarks,
        portfolio,
        council: councilResult,
        sizing: sizingResult,
        stockGroups: stockGroupsResult,
        sortColumn,
        sortDirection,
        handleSort,
        securityPositions,
        analysisGroupMode,
        watchlistHighlightEnabled,
        analysisEtfsHidden,
        showNonAllocatingInstruments,
        nonAllocatingStocks,
        nonAllocatingUpdating,
        nonAllocatingErrors,
        toggleNonAllocatingInstrument,
        analysisScoreAlignment,
        analysisTickerPinned,
        setAnalysisTickerPinned,
        analysisSearch,
        analysisMissingExchangeOnly,
        analysisMissingResearchOnly,
        focusedAnalysisAssetClass,
        setFocusedAnalysisAssetClass,
    } = useStockTableContext();

    const {
        backendAllocations,
        classBudgetsApplied,
        classBudgetsRequired,
    } = sizingResult;

    const {
        groups,
        stockGroupAssignments,
    } = stockGroupsResult;

    const {
        // State
        showGeminiDetails,
        showGptDetails,
        showPerplexityDetails,
        showClaudeDetails,
        showTvPtEdit,
        setShowTvPtEdit,
        showResearchPanel,
        setShowResearchPanel,
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
        // Toggles
        toggleGeminiDetails,
        toggleGptDetails,
        togglePerplexityDetails,
        toggleClaudeDetails,
        // Supplementary file helpers
        setCouncilSupplementaryFileForKey,
        // Query helpers
        hasCouncilImportedAnalysis,
        hasCouncilResearchPanelContent,
        // Run management
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
    } = councilResult;

    // ── Local state ────────────────────────────────────────────────────────────
    const [ratingsExpanded, setRatingsExpanded] = useState(false);
    const [notesExpanded, setNotesExpanded] = useState(false);
    const [expandedAnalysisRowId, setExpandedAnalysisRowId] = useState<number | null>(null);
    const expandedAnalysisTriggerRef = useRef<HTMLElement | null>(null);
    const closeAnalysisResearch = () => {
        setExpandedAnalysisRowId(null);
        expandedAnalysisTriggerRef.current?.focus({ preventScroll: true });
    };
    const [analysisRunEditor, setAnalysisRunEditor] = useState<{
        stockId: number;
        modelKey: AnalysisModelKey;
        stockName: string;
    } | null>(null);
    const [analysisRunDraft, setAnalysisRunDraft] = useState<AnalysisRunDraft>(emptyAnalysisRunDraft);
    const [analysisRunTemplateOpen, setAnalysisRunTemplateOpen] = useState(false);
    const analysisRunTemplateTriggerRef = useRef<HTMLButtonElement | null>(null);
    const analysisRunEditorTriggerRef = useRef<HTMLElement | null>(null);
    const analysisRunQualityInputRef = useRef<HTMLInputElement | null>(null);
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const [columnMenuPosition, setColumnMenuPosition] = useState({ top: 0, left: 0 });
    const [analysisVisibleColumns, setAnalysisVisibleColumns] =
        useState<AnalysisVisibleColumns>(defaultAnalysisVisibleColumns);
    const [analysisCollapsedRows, setAnalysisCollapsedRows] = useState<
        Record<string, boolean>
    >({});
    const [analysisGridPanelWidth, setAnalysisGridPanelWidth] = useState(0);
    const [tickerRailOpen, setTickerRailOpen] = useState(false);
    const [councilControlsStockId, setCouncilControlsStockId] = useState<number | null>(null);
    const councilControlsTriggerRef = useRef<HTMLButtonElement | null>(null);
    const [modelPopover, setModelPopover] = useState<{
        model: 'gemini' | 'perplexity' | 'gpt' | 'claude';
        stock: Stock;
        top: number;
        left: number;
    } | null>(null);
    const [tickerInput, setTickerInput] = useState('');
    const [prefixInput, setPrefixInput] = useState('');
    const [showTickerEdit, setShowTickerEdit] = useState<Record<number, boolean>>({});
    const [showPrefixEdit, setShowPrefixEdit] = useState<Record<number, boolean>>({});
    const [showNameEdit, setShowNameEdit] = useState<Record<number, boolean>>({});
    const [nameInputs, setNameInputs] = useState<Record<number, string>>({});
    const [nameSaving, setNameSaving] = useState<Record<number, boolean>>({});
    const [nameErrors, setNameErrors] = useState<Record<number, string>>({});
    const [showAssetClassDropdown, setShowAssetClassDropdown] = useState<
        Record<string, boolean>
    >({});
    const [assetClassSearch, setAssetClassSearch] = useState('');
    const [assetClassClassifying, setAssetClassClassifying] = useState<
        Record<number, boolean>
    >({});
    const [assetClassClassifyError, setAssetClassClassifyError] = useState<
        Record<number, string>
    >({});
    const [securityTypeUpdating, setSecurityTypeUpdating] = useState<
        Record<number, boolean>
    >({});
    const [dropdownPosition, setDropdownPosition] = useState<
        Record<string, 'above' | 'below'>
    >({});

    const analysisColumnStorageKey = 'terminal-analysis-visible-columns-v2';

    // ── Load persisted column visibility ──────────────────────────────────────
    useEffect(() => {
        const saved = localStorage.getItem(analysisColumnStorageKey);
        if (saved) {
            try {
                setAnalysisVisibleColumns((prev) => ({ ...prev, ...JSON.parse(saved) }));
            } catch (e) {
                console.error('[ALPHA EDGE] Failed to parse saved analysis column preferences:', e);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Refs ───────────────────────────────────────────────────────────────────
    const columnMenuRef = useRef<HTMLDivElement | null>(null);
    const columnMenuPanelRef = useRef<HTMLDivElement | null>(null);
    const stocksRef = useRef(stocks);
    const saveTimerRef = useRef<Record<number, NodeJS.Timeout>>({});

    useEffect(() => {
        stocksRef.current = stocks;
    }, [stocks]);

    // ── Click-outside / escape handling ───────────────────────────────────────
    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                showColumnMenu &&
                columnMenuRef.current &&
                !columnMenuRef.current.contains(event.target as Node) &&
                !columnMenuPanelRef.current?.contains(event.target as Node)
            ) {
                setShowColumnMenu(false);
            }
            if (
                target &&
                !target.closest('[data-inline-edit-root="true"]') &&
                (Object.values(showTickerEdit).some(Boolean) ||
                    Object.values(showPrefixEdit).some(Boolean) ||
                    Object.values(showNameEdit).some(Boolean))
            ) {
                setShowTickerEdit({});
                setShowPrefixEdit({});
                setTickerInput('');
                setPrefixInput('');
                setShowNameEdit({});
                setNameInputs({});
                setNameErrors({});
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowColumnMenu(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [showColumnMenu, showNameEdit, showTickerEdit]);

    // ── Debounced save ─────────────────────────────────────────────────────────
    const debouncedSave = useCallback(
        (stockId: number) => {
            if (saveTimerRef.current[stockId]) {
                clearTimeout(saveTimerRef.current[stockId]);
            }
            saveTimerRef.current[stockId] = setTimeout(async () => {
                const stock = stocksRef.current.find((s) => s.id === stockId);
                if (!stock) return;
                try {
                    const payload = {
                        name: stock.name,
                        ticker: (stock.prefix || '') + stock.symbol,
                        grok_quality: stock.grokQuality || 0,
                        grok_value: stock.grokValue || 0,
                        gemini_quality: stock.geminiQuality || 0,
                        gemini_value: stock.geminiValue || 0,
                        gpt_quality: stock.gptQuality || 0,
                        gpt_value: stock.gptValue || 0,
                        deer_flow_quality: stock.deerFlowQuality || 0,
                        deer_flow_value: stock.deerFlowValue || 0,
                        perplexity_quality: stock.perplexityQuality || 0,
                        perplexity_value: stock.perplexityValue || 0,
                        claude_quality: stock.claudeQuality || 0,
                        claude_value: stock.claudeValue || 0,
                        council_quality: stock.councilQuality || 0,
                        council_value: stock.councilValue || 0,
                        grok_pt: stock.grokPT || 0,
                        gemini_pt: stock.geminiPT || 0,
                        gpt_pt: stock.gptPT || 0,
                        deer_flow_pt: stock.deerFlowPT || 0,
                        perplexity_pt: stock.perplexityPT || 0,
                        claude_pt: stock.claudePT || 0,
                        council_pt: stock.councilPT || 0,
                        gemini_webui_output: stock.geminiWebuiOutput || null,
                        gemini_webui_input_at: stock.geminiWebuiInputAt || null,
                        perplexity_webui_output: stock.perplexityWebuiOutput || null,
                        perplexity_webui_input_at: stock.perplexityWebuiInputAt || null,
                        gpt_webui_output: stock.gptWebuiOutput || null,
                        gpt_webui_input_at: stock.gptWebuiInputAt || null,
                        claude_webui_output: stock.claudeWebuiOutput || null,
                        claude_webui_input_at: stock.claudeWebuiInputAt || null,
                        council_source_output: stock.councilSourceOutput || null,
                        council_source_input_at: stock.councilSourceInputAt || null,
                        tipranks_pt: stock.tipRanksPT || 0,
                        analyst_pt: stock.analystPT || 0,
                        upside_24m: stock.upside24M || 0,
                        allocation: stock.allocation || 0,
                        include_in_sizing: stock.includeInSizing !== false,
                        risk_profile: stock.riskProfile || null,
                        market_cap: stock.marketCap || null,
                        notes: stock.notes || null,
                        thesis: stock.thesis || null,
                        bear_case_pt: stock.bearCasePT || 0,
                        base_case_pt: stock.baseCasePT || 0,
                        bull_case_pt: stock.bullCasePT || 0,
                        bear_probability: stock.bearProbability || 0,
                        base_probability: stock.baseProbability || 0,
                        bull_probability: stock.bullProbability || 0,
                        catalysts: stock.catalysts || null,
                    };
                    if (stock.analysisId) {
                        await api.updateAnalysis(stock.analysisId, payload);
                    } else {
                        await api.upsertAnalysis(payload);
                    }
                } catch (error) {
                    console.error(
                        `[ALPHA EDGE] Failed to save analysis for ${(stocksRef.current.find(s => s.id === stockId) || {}).name}:`,
                        error,
                    );
                }
            }, 500);
        },
        [],
    );

    // ── Handlers ───────────────────────────────────────────────────────────────
    const handleTickerSave = async (stock: (typeof stocks)[0]) => {
        if (!tickerInput.trim() || !prefixInput.trim()) {
            console.error('[ALPHA EDGE] Ticker save blocked: exchange prefix is required.');
            return;
        }
        try {
            const normalizedTicker = tickerInput.trim().toUpperCase();
            const normalizedPrefix = (() => {
                const raw = prefixInput.trim().toUpperCase();
                return raw.endsWith(':') ? raw : `${raw}:`;
            })();
            if ((stock.isWatchlist || stock.isExternal) && stock.analysisId) {
                await api.updateAnalysis(stock.analysisId, {
                    ticker: `${normalizedPrefix}${normalizedTicker}`,
                });
            } else {
                await api.updateTickerMapping(stock.name, normalizedTicker, normalizedPrefix);
            }
            setShowTickerEdit((prev) => ({ ...prev, [stock.id]: false }));
            await Promise.all([fetchHoldings(), fetchActiveAlerts()]);
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to update ticker:', error);
        }
    };

    const handleTickerCancel = (stockId: number) => {
        setShowTickerEdit((prev) => ({ ...prev, [stockId]: false }));
        setTickerInput('');
        setPrefixInput('');
    };

    const togglePrefixEdit = (stockId: number) => {
        const isShown = showPrefixEdit[stockId];
        setShowPrefixEdit({});
        setShowTickerEdit({});
        if (!isShown) {
            const stock = stocks.find((s) => s.id === stockId);
            setPrefixInput(String(stock?.prefix || '').replace(':', ''));
            setShowPrefixEdit({ [stockId]: true });
        }
    };

    const handlePrefixSave = async (stock: (typeof stocks)[0]) => {
        if (!prefixInput.trim()) return;
        try {
            const normalizedPrefix = (() => {
                const raw = prefixInput.trim().toUpperCase();
                return raw.endsWith(':') ? raw : `${raw}:`;
            })();
            if ((stock.isWatchlist || stock.isExternal) && stock.analysisId) {
                await api.updateAnalysis(stock.analysisId, {
                    ticker: `${normalizedPrefix}${stock.symbol || ''}`,
                });
            } else {
                await api.updateTickerMapping(stock.name, stock.symbol || '', normalizedPrefix);
            }
            setShowPrefixEdit((prev) => ({ ...prev, [stock.id]: false }));
            setPrefixInput('');
            await Promise.all([fetchHoldings(), fetchActiveAlerts()]);
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to update exchange prefix:', error);
        }
    };

    const handlePrefixCancel = (stockId: number) => {
        setShowPrefixEdit((prev) => ({ ...prev, [stockId]: false }));
        setPrefixInput('');
    };

    const handleNameCancel = (stockId: number) => {
        setShowNameEdit((prev) => ({ ...prev, [stockId]: false }));
        setNameInputs((prev) => {
            const next = { ...prev };
            delete next[stockId];
            return next;
        });
        setNameErrors((prev) => {
            const next = { ...prev };
            delete next[stockId];
            return next;
        });
        setNameSaving((prev) => {
            const next = { ...prev };
            delete next[stockId];
            return next;
        });
    };

    const handleExternalToggle = async (stock: (typeof stocks)[0]) => {
        const ticker = `${stock.prefix || ''}${stock.symbol || ''}`.trim();
        const nextExternal = !stock.isExternal;
        try {
            let analysisId = stock.analysisId;
            if (analysisId) {
                await api.updateAnalysis(analysisId, {
                    is_external: nextExternal,
                } as Parameters<typeof api.updateAnalysis>[1]);
            } else {
                const saved = await api.upsertAnalysis({
                    name: stock.name,
                    ticker: ticker || null,
                    is_external: nextExternal,
                });
                analysisId = saved.id;
            }
            updateStock(stock.id, {
                analysisId,
                isExternal: nextExternal,
            } as Partial<(typeof stocks)[0]>);
            await fetchHoldings();
            handleNameCancel(stock.id);
        } catch (error) {
            console.error('[EXT] Failed to toggle external:', error);
        }
    };

    const handleNameSave = async (stock: (typeof stocks)[0]) => {
        const draftName = (nameInputs[stock.id] || '').trim();
        if (!draftName) {
            setNameErrors((prev) => ({ ...prev, [stock.id]: 'Name is required' }));
            return;
        }
        if (draftName === stock.name) {
            handleNameCancel(stock.id);
            return;
        }
        const ticker = `${stock.prefix || ''}${stock.symbol || ''}`.trim();
        setNameSaving((prev) => ({ ...prev, [stock.id]: true }));
        setNameErrors((prev) => ({ ...prev, [stock.id]: '' }));
        try {
            let analysisId = stock.analysisId;
            if (analysisId) {
                await api.renameAnalysis(analysisId, draftName);
            } else {
                const saved = await api.upsertAnalysis({
                    name: draftName,
                    ticker: ticker || null,
                    is_external: !!stock.isExternal,
                });
                analysisId = saved.id;
            }
            updateStock(stock.id, { name: draftName, analysisId });
            setShowNameEdit((prev) => ({ ...prev, [stock.id]: false }));
            setNameInputs((prev) => {
                const next = { ...prev };
                delete next[stock.id];
                return next;
            });
            setNameErrors((prev) => {
                const next = { ...prev };
                delete next[stock.id];
                return next;
            });
            void fetchHoldings().catch((error) => {
                console.error('[ALPHA EDGE] Holdings refresh after rename failed:', error);
            });
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to rename:', error);
            setNameErrors((prev) => ({
                ...prev,
                [stock.id]: String((error as any)?.message || error || 'Failed to rename'),
            }));
        } finally {
            setNameSaving((prev) => ({ ...prev, [stock.id]: false }));
        }
    };

    const toggleNameEdit = (stockId: number) => {
        const isCurrentlyShown = showNameEdit[stockId];
        setShowTickerEdit((prev) => ({ ...prev, [stockId]: false }));
        setShowNameEdit((prev) => ({ ...prev, [stockId]: !prev[stockId] }));
        if (!isCurrentlyShown) {
            const stock = stocks.find((s) => s.id === stockId);
            if (stock) {
                setNameInputs((prev) => ({ ...prev, [stockId]: stock.name || '' }));
            }
            setNameErrors((prev) => {
                const next = { ...prev };
                delete next[stockId];
                return next;
            });
        }
    };

    const toggleTickerEdit = (stockId: number) => {
        const isCurrentlyShown = showTickerEdit[stockId];
        setShowNameEdit((prev) => ({ ...prev, [stockId]: false }));
        setShowTickerEdit((prev) => ({ ...prev, [stockId]: !prev[stockId] }));
        if (!isCurrentlyShown) {
            const stock = stocks.find((s) => s.id === stockId);
            if (stock) {
                setTickerInput(stock.symbol || '');
                setPrefixInput(stock.prefix || '');
            }
        }
    };

    const toggleAnalysisColumn = (column: keyof AnalysisVisibleColumns) => {
        setAnalysisVisibleColumns((prev) => {
            const newColumns = { ...prev, [column]: !prev[column] };
            if (typeof window !== 'undefined') {
                localStorage.setItem(
                    analysisColumnStorageKey,
                    JSON.stringify(newColumns),
                );
            }
            return newColumns;
        });
    };

    const toggleAssetClassDropdown = (stockId: number, event: React.MouseEvent) => {
        const button = event.currentTarget as HTMLElement;
        const rect = button.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const position = spaceBelow < 200 ? 'above' : 'below';
        setDropdownPosition((prev) => ({ ...prev, [`asset-class-${stockId}`]: position }));
        setShowAssetClassDropdown((prev) => ({ ...prev, [stockId]: !prev[stockId] }));
        setAssetClassSearch('');
    };

    const getStockRegimes = (stock: Stock): string[] => {
        const regimes: string[] = [];
        const normalizedAssetClass = normalizeAssetClassCode(stock.primaryAssetClass);
        if (normalizedAssetClass && normalizedAssetClass !== 'UNASSIGNED') {
            regimes.push(normalizedAssetClass);
        }
        if (isAnalysisEtf(stock) && !regimes.includes('ETF')) {
            regimes.push('ETF');
        }
        return regimes;
    };

    const handleAssetClassUpdate = async (
        stock: (typeof stocks)[0],
        assetClassCode: string | null,
    ) => {
        const normalized =
            assetClassCode && normalizeAssetClassCode(assetClassCode) !== 'UNASSIGNED'
                ? normalizeAssetClassCode(assetClassCode)
                : null;
        try {
            updateStock(stock.id, { primaryAssetClass: normalized });
            setShowAssetClassDropdown({});
            setAssetClassSearch('');
            if (stock.analysisId) {
                await api.updateAnalysis(stock.analysisId, { primary_asset_class: normalized });
            } else {
                await api.upsertAnalysis({
                    name: stock.name,
                    ticker:
                        stock.symbol && stock.prefix
                            ? `${stock.prefix}${stock.symbol}`
                            : stock.symbol || null,
                    is_external: stock.isExternal,
                    is_watchlist: stock.isWatchlist,
                    primary_asset_class: normalized,
                });
            }
            await fetchHoldings();
        } catch (error) {
            console.error('[ALPHA EDGE] Failed to update primary asset class:', error);
        }
    };

    const toggleAnalysisEtf = async (stock: Stock) => {
        if (securityTypeUpdating[stock.id]) return;

        const previousType = stock.securityType || 'STOCK';
        const nextType = isAnalysisEtf(stock) ? 'STOCK' : 'ETF';
        const ticker = [stock.prefix, stock.symbol].filter(Boolean).join('');

        setSecurityTypeUpdating((prev) => ({ ...prev, [stock.id]: true }));
        updateStock(stock.id, { securityType: nextType });
        try {
            await api.setAnalysisSecurityType({
                analysis_id: stock.analysisId,
                name: stock.name,
                ticker,
                primary_asset_class: stock.primaryAssetClass || null,
                security_type: nextType,
            });
            await fetchHoldings();
        } catch (error) {
            updateStock(stock.id, { securityType: previousType });
            console.error('[ALPHA EDGE] Failed to update security type:', error);
        } finally {
            setSecurityTypeUpdating((prev) => ({ ...prev, [stock.id]: false }));
        }
    };

    const handleAssetClassClassify = async (stock: (typeof stocks)[0]) => {
        setAssetClassClassifying((prev) => ({ ...prev, [stock.id]: true }));
        setAssetClassClassifyError((prev) => {
            const next = { ...prev };
            delete next[stock.id];
            return next;
        });
        try {
            const ticker = [stock.prefix, stock.symbol]
                .filter(Boolean)
                .join('')
                .replace(/\s+/g, '');
            const result = await api.classifyAssetClass({
                company_name: stock.name,
                ticker,
                exchange_code: String(stock.prefix || '').replace(':', ''),
            });
            if (!result.asset_class) throw new Error('No asset class returned');
            await handleAssetClassUpdate(stock, result.asset_class);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Classification failed';
            setAssetClassClassifyError((prev) => ({ ...prev, [stock.id]: message }));
        } finally {
            setAssetClassClassifying((prev) => ({ ...prev, [stock.id]: false }));
        }
    };

    const handleFieldUpdate = (
        id: number,
        field: keyof (typeof stocks)[0],
        value: number | string | null,
    ) => {
        updateStock(id, { [field]: value });
        debouncedSave(id);
    };

    const handleBulkFieldUpdate = (id: number, updates: Partial<Stock>) => {
        updateStock(id, updates);
        debouncedSave(id);
    };

    const openAnalysisRunEditor = (
        stock: Stock,
        modelKey: AnalysisModelKey,
        trigger?: HTMLElement,
    ) => {
        const run = getAnalysisModelRuns(stock).find(
            (item) => item.definition.key === modelKey,
        );
        if (!run) return;
        analysisRunEditorTriggerRef.current = trigger || null;
        setExpandedAnalysisRowId(stock.id);
        setAnalysisRunEditor({ stockId: stock.id, modelKey, stockName: stock.name });
        setAnalysisRunTemplateOpen(false);
        setAnalysisRunDraft({
            quality: run.quality > 0 ? String(run.quality) : '',
            value: run.value > 0 ? String(run.value) : '',
            priceTarget: run.priceTarget > 0 ? String(run.priceTarget) : '',
            inputAt: toDateInputValue(run.inputAt),
            sourceText: run.sourceText || '',
        });
    };

    const cancelAnalysisRunEditor = () => {
        setAnalysisRunEditor(null);
        setAnalysisRunDraft(emptyAnalysisRunDraft);
        const trigger = analysisRunEditorTriggerRef.current;
        analysisRunEditorTriggerRef.current = null;
        requestAnimationFrame(() => trigger?.focus());
    };

    const updateAnalysisRunDraft = (
        field: keyof AnalysisRunDraft,
        value: string,
    ) => {
        setAnalysisRunDraft((prev) => ({ ...prev, [field]: value }));
    };

    const autoFillAnalysisRunDraft = () => {
        const inferred = inferDraftFromSource(analysisRunDraft.sourceText);
        setAnalysisRunDraft((prev) => ({
            ...prev,
            quality: inferred.quality || prev.quality,
            value: inferred.value || prev.value,
            priceTarget: inferred.priceTarget || prev.priceTarget,
        }));
    };

    const saveAnalysisRunEditor = () => {
        if (!analysisRunEditor) return;
        const definition = ANALYSIS_EXPECTED_MODELS.find(
            (model) => model.key === analysisRunEditor.modelKey,
        );
        if (!definition) return;
        const updates = {
            [definition.qualityField]: parsePositiveFloat(analysisRunDraft.quality),
            [definition.valueField]: parsePositiveFloat(analysisRunDraft.value),
            [definition.ptField]: parsePositiveFloat(analysisRunDraft.priceTarget),
            [definition.inputAtField]:
                analysisRunDraft.inputAt || new Date().toISOString().slice(0, 10),
            [definition.sourceField]: analysisRunDraft.sourceText.trim() || null,
        } as Partial<Stock>;
        handleBulkFieldUpdate(analysisRunEditor.stockId, updates);
        cancelAnalysisRunEditor();
    };

    // ── Asset class helpers ────────────────────────────────────────────────────
    const assetClassConfigMap = new Map(
        assetClassConfig.map(
            (setting) => [normalizeAssetClassCode(setting.key), setting] as const,
        ),
    );
    const assetClassMap = useMemo(() => {
        const map = new Map<string, AssetClass>();
        const add = (key: string | null | undefined, sleeve: AssetClass) => {
            const normalized = normalizeAssetClassCode(key);
            if (normalized && !map.has(normalized)) map.set(normalized, sleeve);
        };
        assetClasses.forEach((sleeve) => add(sleeve.code, sleeve));
        assetClasses.forEach((sleeve) => add(sleeve.asset_class_code, sleeve));
        return map;
    }, [assetClasses]);

    const getAssetClassSetting = (code?: string | null): AssetClassConfig | null => {
        const normalized = normalizeAssetClassCode(code);
        return assetClassConfigMap.get(normalized) || null;
    };

    const formatAssetClassLabel = (code?: string | null): string => {
        const normalized = normalizeAssetClassCode(code);
        if (!normalized || normalized === 'UNASSIGNED') return '—';
        if (normalized === 'NON_ALLOCATING') return 'EXCLUDED INSTRUMENTS';
        const sleeve = assetClassMap.get(normalized);
        if (sleeve?.display_name) return sleeve.display_name.toUpperCase();
        const setting = getAssetClassSetting(normalized);
        if (setting?.display_name) return setting.display_name.toUpperCase();
        if (normalized === 'BASEMETALS') return 'BASE METALS';
        if (normalized === 'SEMICONDUCTORS') return 'SEMICONDUCTORS';
        return normalized;
    };

    const getStockAssetClassCode = (stock: (typeof stocks)[0]): string => {
        if (isNonAllocatingSecurityType(stock.securityType)) {
            return 'NON_ALLOCATING';
        }
        if (stock.primaryAssetClass) return normalizeAssetClassCode(stock.primaryAssetClass);
        if (String(stock.securityType || '').trim().toUpperCase() === 'ETF') return 'ETF';
        return 'UNASSIGNED';
    };

    const analysisAssetClassOptions = (() => {
        const configured = getAnalysisAssetClasses(assetClasses)
            .map((sleeve) => normalizeAssetClassCode(sleeve.code))
            .filter(Boolean);
        return Array.from(new Set(configured));
    })();
    const assetClassSearchQuery = assetClassSearch.trim().toLowerCase();
    const filteredAnalysisAssetClassOptions = assetClassSearchQuery
        ? analysisAssetClassOptions.filter((assetClassCode) => {
              const label = formatAssetClassLabel(assetClassCode).toLowerCase();
              return (
                  label.includes(assetClassSearchQuery) ||
                  assetClassCode.toLowerCase().includes(assetClassSearchQuery)
              );
          })
        : analysisAssetClassOptions;

    // ── Allocations ────────────────────────────────────────────────────────────
    const isStockIncludedInSizing = (stock: Stock) => stock.includeInSizing !== false;
    const isStockEligibleForSizing = (stock: Stock) =>
        isStockIncludedInSizing(stock) &&
        !isAnalysisEtf(stock) &&
        !isNonAllocatingSecurityType(stock.securityType);

    const allocations = (() => {
        const totalPortfolioValue = portfolio.totalValue;
        const sizingStocks = sortedStocks.filter(isStockEligibleForSizing);
        const stockWeights = sizingStocks.map((stock) => {
            return { id: stock.id, weight: calculateAnalysisTargetWeight(stock) };
        });
        const totalWeight = stockWeights.reduce((sum, sw) => sum + sw.weight, 0);
        return stockWeights.map((sw) => {
            const percent = totalWeight > 0 ? (sw.weight / totalWeight) * 100 : 0;
            return { id: sw.id, percent, dollar: (percent / 100) * totalPortfolioValue };
        });
    })();

    const getAllocation = (stock: Stock) => {
        if (
            !isStockEligibleForSizing(stock) ||
            !hasAnalysisSizingEvidence(stock)
        ) {
            return null;
        }
        const backend = backendAllocations.get(stock.id);
        if (
            backend &&
            (!classBudgetsRequired || classBudgetsApplied) &&
            (backend.eligible_for_target_weight ?? backend.base_rating > 0)
        ) {
            return { id: backend.id, percent: backend.allocation_pct, dollar: backend.allocation_dollar };
        }
        // Once an approved class budget exists, an unanchored fallback would
        // overstate available stock capital by ignoring the Core ETF reserve.
        if (classBudgetsRequired) return null;
        return allocations.find((a) => a.id === stock.id) || null;
    };

    const startBuyFlow = (stock: Stock) => {
        if (isWatchlistStock(stock)) {
            openWatchlistEntry(councilParseTicker(stock));
            return;
        }
        const assetClassCode = getStockAssetClassCode(stock);
        const allocation = getAllocation(stock);
        const ticker = councilParseTicker(stock);
        window.dispatchEvent(
            new CustomEvent('buy-flow:start', {
                detail: {
                    ticker,
                    name: stock.name,
                    assetClass: formatAssetClassLabel(assetClassCode),
                    suggestedPct: allocation?.percent ?? null,
                    qualityScore: calculateAverageCompletedModelField(stock, 'quality'),
                    valueScore: calculateAverageCompletedModelField(stock, 'value'),
                    totalScore: calculateBaseRatingTotal(stock),
                    priceTarget: calculateAveragePriceTarget(stock) || null,
                    currentPrice: stock.price || null,
                    cdfState: stock.symbol
                        ? securityPositions[stock.id] || null
                        : null,
                },
            }),
        );
    };

    // ── Bucket stats (for getClassPercentForStock) ─────────────────────────────
    const getBucketMetaForAssetClass = (assetClassCode?: string | null): {
        bucket: PositionBucketKey;
        label: string;
        parentBucket: PositionBucketKey | null;
    } => {
        const normalized = normalizeAssetClassCode(assetClassCode);
        if (normalized === 'CASH') return { bucket: 'cash_reserve', label: 'Cash/Reserve', parentBucket: null };
        const setting = getAssetClassSetting(normalized);
        if (!setting) return { bucket: 'q1_exempt', label: 'Q1-Exempt', parentBucket: null };
        if (!setting.overlay_eligible) return { bucket: 'q1_exempt', label: 'Q1-Exempt', parentBucket: null };
        if (setting.q3_beneficiary) return { bucket: 'partial_q1', label: 'Q1-Defensive', parentBucket: 'q1' };
        return { bucket: 'full_q1', label: 'Q1', parentBucket: null };
    };

    const bucketKeys: PositionBucketKey[] = ['full_q1', 'partial_q1', 'q1', 'q1_exempt', 'cash_reserve'];
    const bucketStocksMap = useMemo(() => {
        const map = new Map<PositionBucketKey, typeof positionStocks>();
        bucketKeys.forEach((k) => map.set(k, []));
        positionStocks.forEach((stock) => {
            const { bucket } = getBucketMetaForAssetClass(getStockAssetClassCode(stock));
            map.get(bucket)?.push(stock);
        });
        return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [positionStocks, assetClassConfig]);

    const bucketStats = useMemo(() => {
        const calc = (key: PositionBucketKey) => {
            const stocks = bucketStocksMap.get(key) || [];
            return { marketValue: stocks.reduce((sum, s) => sum + (s.positionValue || 0), 0) };
        };
        const full = calc('full_q1');
        const partial = calc('partial_q1');
        const exempt = calc('q1_exempt');
        const cash = calc('cash_reserve');
        return {
            full_q1: full,
            partial_q1: partial,
            q1: { marketValue: full.marketValue + partial.marketValue },
            q1_exempt: exempt,
            cash_reserve: cash,
        };
    }, [bucketStocksMap]);

    const getGroupDirectStocks = (groupId: string) =>
        positionStocks.filter((stock) => stockGroupAssignments[stock.name] === groupId);

    const getGroupStocksRecursive = (groupId: string): typeof positionStocks => {
        const directStocks = getGroupDirectStocks(groupId);
        const childGroups = groups.filter((g) => g.parent_id === groupId);
        return childGroups.reduce<typeof positionStocks>(
            (acc, child) => { acc.push(...getGroupStocksRecursive(child.id)); return acc; },
            [...directStocks],
        );
    };

    const calculateGroupMarketValue = (groupId: string): number =>
        getGroupStocksRecursive(groupId).reduce((sum, s) => sum + (s.positionValue || 0), 0);

    const getImmediateParentMarketValueForStock = (stock: (typeof stocks)[0]): number | null => {
        const groupId = stockGroupAssignments[stock.name];
        if (groupId) return calculateGroupMarketValue(groupId);
        const bucket = getBucketMetaForAssetClass(getStockAssetClassCode(stock)).bucket;
        return bucketStats[bucket].marketValue || null;
    };

    const getClassPercentForStock = (stock: (typeof stocks)[0]): number | null => {
        const parentMarketValue = getImmediateParentMarketValueForStock(stock);
        if (!parentMarketValue || parentMarketValue <= 0) return null;
        return (stock.positionValue / parentMarketValue) * 100;
    };

    // ── Formatters ─────────────────────────────────────────────────────────────
    const money = (value?: number | null): string =>
        `$${Math.round(value || 0).toLocaleString()}`;

    const pct1 = (value?: number | null): string => `${(value || 0).toFixed(1)}%`;

    const renderCouncilControls = (stock: Stock, entry: 'column' | 'expanded' = 'column') => {
        const key = stock.symbol || stock.name;
        const isRunning = councilRunning[key];
        const progressStage = councilProgressStage[key] || 'Running';
        const progress = councilProgress[key];
        const progressPct = councilProgressPct[key] ?? 0;
        const progressWidthPct = Math.max(0, Math.min(100, progressPct));
        const persistedRunId = String(stock.councilRunId || '').trim();
        const runId = String(councilRunIds[key] || persistedRunId).trim();
        const runLabel = String(stock.councilRunLabel || '').trim();
        const error = councilError[key];
        const councilPopoverId = `council-controls-${stock.id}`;
        const controlsOpen = councilControlsStockId === stock.id;
        const councilScore = calculateCouncilCompositeScore(stock);
        const hasCouncilError = Boolean(error);
        const councilTriggerLabel = hasCouncilError
            ? 'RETRY'
            : hasCouncilImportedAnalysis(stock) && councilScore != null
              ? formatAnalysisScore(councilScore)
              : 'RUN';

        return (
            <div
                className={`relative flex min-h-[24px] items-center justify-center overflow-visible ${entry === 'column' ? 'flex-row gap-1.5' : 'flex-col'}`}
                data-analysis-row-interactive="true"
                onClick={(event) => event.stopPropagation()}
            >
                {isRunning ? (
                    <div className="group relative w-[6.7rem] rounded border border-primary/25 bg-primary/10 px-1.5 py-1 text-left shadow-[0_0_10px_rgba(112,199,255,0.12)]">
                        <div className="mb-0.5 flex items-center justify-between gap-1">
                            <span className="truncate text-[8px] font-semibold uppercase tracking-[0.12em] text-foreground/85">
                                {progressStage}
                            </span>
                            <span className="font-mono text-[9px] text-primary">
                                {progressPct}%
                            </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/55 ring-1 ring-inset ring-border/60">
                            <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(90,170,255,0.45),rgba(112,199,255,0.92),rgba(166,226,255,0.9))] shadow-[0_0_10px_rgba(112,199,255,0.35)] transition-all duration-500 ease-out"
                                style={{ width: `${progressWidthPct}%` }}
                            />
                        </div>
                        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 hidden w-64 -translate-x-1/2 rounded-md border border-border/70 bg-background/95 p-2.5 text-left shadow-xl group-hover:block">
                            <div className="mb-1 flex items-center justify-between gap-2 border-b border-border/40 pb-1.5">
                                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                                    Council
                                </span>
                                <span className="rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] text-primary">
                                    {progressPct}%
                                </span>
                            </div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground/85">
                                {progressStage}
                            </div>
                            <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                                {progress || 'Working...'}
                            </div>
                            {runId && (
                                <div
                                    className="mt-2 truncate border-t border-border/40 pt-1.5 font-mono text-[9px] text-muted-foreground"
                                    title={runLabel || runId}
                                >
                                    Run {runLabel || runId}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={event => {
                                councilControlsTriggerRef.current = event.currentTarget;
                                setCouncilControlsStockId(stock.id);
                            }}
                            className={entry === 'expanded' ? 'analysis-council-expanded-trigger' : `analysis-council-trigger ${
                                hasCouncilError
                                    ? 'has-error'
                                    : hasCouncilImportedAnalysis(stock) && councilScore != null
                                    ? 'has-score'
                                    : 'is-empty'
                            }`}
                            style={
                                entry === 'expanded' ? undefined : hasCouncilError
                                    ? { color: 'var(--signal-sell)' }
                                    : hasCouncilImportedAnalysis(stock) && councilScore != null
                                    ? { color: scoreColor(councilScore) }
                                    : undefined
                            }
                            title={
                                hasCouncilError
                                    ? `Council needs attention: ${error}`
                                    : 'Open Council controls'
                            }
                            aria-haspopup="dialog"
                            aria-expanded={controlsOpen}
                            aria-controls={councilPopoverId}
                            aria-label={
                                entry === 'expanded' ? undefined : hasCouncilError
                                    ? `Council needs attention for ${stock.name}. Open controls.`
                                    : `Open Council controls for ${stock.name}`
                            }
                        >
                            {entry === 'expanded'
                                ? hasCouncilImportedAnalysis(stock) ? 'Rerun Council' : 'Run Council'
                                : councilTriggerLabel}
                        </button>
                        {entry === 'column' && <ModelSourceStamp
                            staleOnly
                            inputAt={stock.councilSourceInputAt}
                            hasModelValues={Boolean(
                                stock.councilQuality ||
                                    stock.councilValue ||
                                    stock.councilPT ||
                                    stock.councilSourceOutput,
                            )}
                        />}
                    </>
                )}

            </div>
        );
    };

    // ── Column layout ──────────────────────────────────────────────────────────
    const estimateColumnTextWidth = (
        values: Array<string | number | null | undefined>,
        {
            charPx = 6.4,
            paddingPx = 18,
            minPx = 0,
            maxPx = 240,
        }: { charPx?: number; paddingPx?: number; minPx?: number; maxPx?: number } = {},
    ) => {
        const longest = values.reduce<number>((max, value) => {
            const text = value == null ? '' : String(value);
            return Math.max(max, text.length);
        }, 0);
        return Math.max(minPx, Math.min(maxPx, Math.ceil(longest * charPx + paddingPx)));
    };

    const analysisColumnVisible = (column: keyof AnalysisVisibleColumns) =>
        analysisVisibleColumns[column];
    const tickerRevealEnabled = analysisColumnVisible('ticker');

    const analysisColumnNames: Record<AnalysisGridColumnKey, string> = {
        name: 'Name', ticker: 'Ticker', tags: 'Tags', upside: 'Upside',
        assetClass: 'Asset class', total: 'Total', price: 'Price',
        avgPt: 'Upside', performance12m: '12 month performance', quality: 'Quality',
        value: 'Value', council: 'Council', gemini: 'Gemini', perplexity: 'Perplexity',
        gpt: 'GPT', claude: 'Claude', tvPt: 'TradingView price target', signal: 'Signal',
        thesisDrift: 'Thesis change', suggestedAllocation: 'Target weight', classPercent: 'Class percentage',
        performance6m: 'Momentum', modelIncluded: 'Active', chart: 'Chart',
        thesis: 'Thesis', nextCatalyst: 'Next catalyst',
    };
    const analysisColumnMenuItems: Array<{ key: keyof AnalysisVisibleColumns; label: string }> = [
        { key: 'ticker', label: 'TICKER' },
        { key: 'assetClass', label: 'ASSET CLASS' },
        { key: 'price', label: 'PRICE' },
        { key: 'performance6m', label: 'MOMENTUM' },
        { key: 'performance12m', label: '12M %' },
        { key: 'quality', label: 'QUALITY' },
        { key: 'value', label: 'VALUE' },
        { key: 'council', label: 'COUNCIL' },
        { key: 'total', label: 'RATINGS TOTAL' },
        { key: 'avgPt', label: 'UPSIDE' },
        { key: 'signal', label: 'SIGNAL' },
        { key: 'thesisDrift', label: 'THESIS DRIFT' },
        { key: 'modelIncluded', label: 'ACTIVE' },
        { key: 'suggestedAllocation', label: 'TARGET WEIGHT' },
        { key: 'classPercent', label: 'CLASS %' },
        { key: 'chart', label: 'CHART' },
        { key: 'thesis', label: 'THESIS' },
        { key: 'nextCatalyst', label: 'NEXT CATALYST' },
    ];

    const analysisGridContentMin = {
        name: estimateColumnTextWidth(
            ['NAME', ...sortedStocks.map((stock) => stock.name || '')],
            { charPx: 5.9, paddingPx: 34, minPx: 180, maxPx: 300 },
        ),
        ticker: estimateColumnTextWidth(
            ['TICKER', ...sortedStocks.map((stock) => stock.symbol || 'add')],
            { charPx: 5.8, paddingPx: 22, minPx: 64, maxPx: 88 },
        ),
        assetClass: estimateColumnTextWidth(
            ['ASSET CLASS', ...sortedStocks.map((stock) => stock.primaryAssetClass || 'UNASSIGNED')],
            { charPx: 5.9, paddingPx: 18, minPx: 78, maxPx: 132 },
        ),
        price: estimateColumnTextWidth(
            ['PRICE', ...sortedStocks.map((stock) => `$${(stock.price || 0).toFixed(2)}`)],
            { charPx: 5.9, paddingPx: 16, minPx: 58, maxPx: 86 },
        ),
        percent: estimateColumnTextWidth(['100.0%', '+100.0%', '-100.0%'], {
            charPx: 5.9, paddingPx: 16, minPx: 58, maxPx: 84,
        }),
        rating: estimateColumnTextWidth(['RATINGS TOTAL', '100.0'], {
            charPx: 5.9, paddingPx: 18, minPx: 64, maxPx: 88,
        }),
        score: estimateColumnTextWidth(['QUALITY', '100.0', '...'], {
            charPx: 5.9, paddingPx: 18, minPx: 74, maxPx: 96,
        }),
        money: estimateColumnTextWidth(['UPSIDE(24M)', '$100.000'], {
            charPx: 5.9, paddingPx: 18, minPx: 72, maxPx: 102,
        }),
        compact: estimateColumnTextWidth(['SIGNAL', 'BREAKOUT'], {
            charPx: 5.9, paddingPx: 18, minPx: 62, maxPx: 90,
        }),
        thesis: estimateColumnTextWidth(
            ['THESIS', ...sortedStocks.map((stock) => stock.thesis || '')],
            { charPx: 5.4, paddingPx: 20, minPx: 126, maxPx: 220 },
        ),
        nextCatalyst: estimateColumnTextWidth(
            ['NEXT CATALYST', ...sortedStocks.map((stock) => stock.catalysts || '')],
            { charPx: 5.4, paddingPx: 20, minPx: 150, maxPx: 260 },
        ),
    };

    const analysisGridBaseColumns: AnalysisGridColumn[] = [
        // Leave room for the indent, monitoring lane and inline tools before sizing the name.
        { key: 'name', widthPx: Math.max(344, analysisGridContentMin.name + 96) + (analysisTickerPinned ? analysisGridContentMin.ticker : 0), minWidthPx: 344 + (analysisTickerPinned ? analysisGridContentMin.ticker : 0), maxWidthPx: 1200, manualMinWidthPx: 224, manualMaxWidthPx: 1200, fillWeight: 1.2 },
        ...(analysisColumnVisible('assetClass') ? [{ key: 'assetClass' as const, widthPx: Math.max(104, analysisGridContentMin.assetClass), minWidthPx: 82, maxWidthPx: 150, fillWeight: 0.55 }] : []),
        ...(analysisColumnVisible('price') ? [{ key: 'price' as const, widthPx: analysisGridContentMin.price, minWidthPx: 56, maxWidthPx: 72, fillWeight: 0.14 }] : []),
        ...(analysisColumnVisible('avgPt') ? [{ key: 'avgPt' as const, widthPx: 88, minWidthPx: 76, maxWidthPx: 104, fillWeight: 0.22 }] : []),
        ...(analysisColumnVisible('performance12m') ? [{ key: 'performance12m' as const, widthPx: analysisGridContentMin.percent, minWidthPx: 56, maxWidthPx: 88, fillWeight: 0.22 }] : []),
        ...(analysisColumnVisible('quality') ? [{ key: 'quality' as const, widthPx: analysisGridContentMin.score, minWidthPx: 72, maxWidthPx: 104, fillWeight: 0.2 }] : []),
        ...(analysisColumnVisible('value') ? [{ key: 'value' as const, widthPx: analysisGridContentMin.score, minWidthPx: 72, maxWidthPx: 104, fillWeight: 0.2 }] : []),
        ...(analysisColumnVisible('total') ? [{ key: 'total' as const, widthPx: 56, minWidthPx: 48, maxWidthPx: 72, fillWeight: 0.12 }] : []),
        ...(analysisColumnVisible('council') ? [{ key: 'council' as const, widthPx: 76, minWidthPx: 68, maxWidthPx: 96, fillWeight: 0.16 }] : []),
        ...(ratingsExpanded ? [
            ...(analysisColumnVisible('gemini') ? [{ key: 'gemini' as const, widthPx: 70, minWidthPx: 62, fillWeight: 0.12 }] : []),
            ...(analysisColumnVisible('perplexity') ? [{ key: 'perplexity' as const, widthPx: 92, minWidthPx: 82, fillWeight: 0.14 }] : []),
            ...(analysisColumnVisible('gpt') ? [{ key: 'gpt' as const, widthPx: 56, minWidthPx: 50, fillWeight: 0.08 }] : []),
            ...(analysisColumnVisible('claude') ? [{ key: 'claude' as const, widthPx: 72, minWidthPx: 64, fillWeight: 0.12 }] : []),
            ...(analysisColumnVisible('tvPt') ? [{ key: 'tvPt' as const, widthPx: 60, minWidthPx: 52, fillWeight: 0.08 }] : []),
        ] : []),
        ...(analysisColumnVisible('signal') ? [{ key: 'signal' as const, widthPx: analysisGridContentMin.compact, minWidthPx: 64, fillWeight: 0.18 }] : []),
        ...(analysisColumnVisible('thesisDrift') ? [{ key: 'thesisDrift' as const, widthPx: 74, minWidthPx: 62, maxWidthPx: 88, fillWeight: 0.14 }] : []),
        ...(analysisColumnVisible('suggestedAllocation') ? [{ key: 'suggestedAllocation' as const, widthPx: 76, minWidthPx: 58, fillWeight: 0.2 }] : []),
        ...(analysisColumnVisible('classPercent') ? [{ key: 'classPercent' as const, widthPx: 76, minWidthPx: 58, fillWeight: 0.2 }] : []),
        ...(analysisColumnVisible('performance6m') ? [{ key: 'performance6m' as const, widthPx: analysisGridContentMin.percent, minWidthPx: 56, maxWidthPx: 88, fillWeight: 0.22 }] : []),
        ...(analysisColumnVisible('modelIncluded') ? [{ key: 'modelIncluded' as const, widthPx: 68, minWidthPx: 58, fillWeight: 0.12 }] : []),
        ...(analysisColumnVisible('chart') ? [{ key: 'chart' as const, widthPx: 72, minWidthPx: 56, fillWeight: 0.18 }] : []),
        ...(!ratingsExpanded && notesExpanded && analysisColumnVisible('thesis') ? [{ key: 'thesis' as const, widthPx: analysisGridContentMin.thesis, minWidthPx: 118, manualMaxWidthPx: 1200, fillWeight: 1.25 }] : []),
        ...(!ratingsExpanded && notesExpanded && analysisColumnVisible('nextCatalyst') ? [{ key: 'nextCatalyst' as const, widthPx: Math.max(214, analysisGridContentMin.nextCatalyst), minWidthPx: 140, manualMaxWidthPx: 1200, fillWeight: 1.65 }] : []),
    ];
    const councilControlsStock = stocks.find(stock => stock.id === councilControlsStockId);
    const councilControlsKey = councilControlsStock ? councilControlsStock.symbol || councilControlsStock.name : '';
    const councilControlsRunId = String(councilRunIds[councilControlsKey] || councilControlsStock?.councilRunId || '').trim();

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
<>
    {councilControlsStock && <CouncilControlsDialog key={councilControlsStock.id}
        stock={councilControlsStock} hasAnalysis={hasCouncilImportedAnalysis(councilControlsStock)}
        ticker={councilResolveTickerContext(councilControlsStock)}
        template={getCouncilTemplateForAssetClass(councilControlsStock.primaryAssetClass) || councilControlsStock.templateId || 'Default template'}
        inputDate={toDateInputValue(councilControlsStock.councilSourceInputAt)}
        runId={councilControlsRunId} runLabel={String(councilControlsStock.councilRunLabel || '').trim()}
        error={councilError[councilControlsKey]} attachment={councilSupplementaryFiles[councilControlsKey] || null}
        runsOpen={Boolean(councilRunPickerOpen[councilControlsKey])} runsLoading={Boolean(councilRunOptionsLoading[councilControlsKey])}
        busy={Boolean(councilRunning[councilControlsKey])}
        runs={(councilRunOptions[councilControlsKey] || []).map(run => ({ id: String(run?.id || '').trim(), label: buildCouncilRunOptionLabel(run) }))}
        onClose={() => setCouncilControlsStockId(null)} onReturnFocus={() => councilControlsTriggerRef.current?.focus()}
        onFieldUpdate={handleFieldUpdate} onAttach={file => setCouncilSupplementaryFileForKey(councilControlsKey, file)}
        onRun={() => { setCouncilControlsStockId(null); void runCouncilForStock(councilControlsStock); }}
        onLoadLatest={() => loadLatestCouncilRun(councilControlsStock)} onClear={() => clearCouncilImportedAnalysis(councilControlsStock)}
        onToggleRuns={() => toggleCouncilRunPicker(councilControlsStock)} onLoadRun={id => loadCouncilRunById(councilControlsStock, id)}
        onOpenLab={() => openCouncilRunsManager(councilControlsStock, councilControlsRunId)} />}
    <style>{`
        .analysis-column-reset {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            min-height: 32px;
            margin-top: 6px;
            padding: 6px 8px;
            border-top: 1px solid var(--border);
            color: var(--muted-foreground);
            cursor: pointer;
        }
        .analysis-column-reset:hover {
            background: var(--muted);
        }
        .analysis-grid {
            table-layout: fixed;
            border-color: var(--border);
            background: var(--background);
            color: var(--foreground);
            font-family: system-ui;
        }
        .analysis-grid th,
        .analysis-grid td {
            border-color: var(--border);
            overflow: hidden;
            vertical-align: middle;
        }
        .analysis-grid tbody tr {
            border-color: var(--border);
        }
        .analysis-grid th {
            height: 32px;
            padding: 0 4px;
            background: color-mix(in oklab, var(--card) 94%, var(--background));
            color: color-mix(in oklab, var(--foreground) 88%, var(--muted-foreground));
            font-size: 10px;
            font-weight: 500;
            letter-spacing: 0.025em;
            line-height: 1;
            white-space: nowrap;
            text-transform: uppercase;
        }
        .analysis-grid .analysis-empty {
            color: color-mix(in srgb, var(--muted-foreground) 72%, transparent);
        }
        .analysis-grid .analysis-score-empty {
            display: inline-flex;
            width: 100%;
            align-items: center;
            justify-content: center;
            color: color-mix(in srgb, var(--muted-foreground) 58%, transparent);
            font-weight: 600;
            text-align: center;
        }
        .analysis-grid .analysis-model-button {
            display: inline-flex;
            min-width: 2.1rem;
            height: 1.45rem;
            align-items: center;
            justify-content: center;
            border-radius: 5px;
            border: 1px solid transparent;
            font-family: var(--font-mono);
            font-size: 11px;
            font-weight: 700;
            line-height: 1;
            color: var(--analysis-text-strong);
        }
        .analysis-grid .analysis-model-button.has-score {
            color: var(--analysis-text-strong);
        }
        .analysis-grid .analysis-model-button.is-empty {
            color: color-mix(in srgb, var(--muted-foreground) 55%, transparent);
        }
        .analysis-grid .analysis-rating-badge {
            display: inline-flex;
            min-width: 2.25rem;
            height: auto;
            align-items: center;
            justify-content: center;
            border: 0;
            background: transparent;
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 700;
            line-height: 1.05;
            font-variant-numeric: tabular-nums;
        }
        .analysis-grid td.analysis-popover-cell {
            position: relative;
            overflow: visible;
        }
        .analysis-grid td.analysis-name-cell {
            overflow: visible;
        }
        .analysis-grid .analysis-cell-clip {
            display: block;
            max-width: 100%;
            max-height: 1.15rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            line-height: 1.15rem;
        }
        .analysis-grid .analysis-stock-type-icon {
            flex-shrink: 0;
            opacity: 0.70;
        }
        .analysis-grid .analysis-watchlist-indicator {
            display: inline-flex;
            flex: 0 0 auto;
        }
        .analysis-grid .analysis-stock-type-icon.is-watch { color: #a78bfa; }
        .analysis-grid .analysis-stock-type-icon.is-etf { color: #60a5fa; }
        .analysis-grid .analysis-security-type-toggle {
            display: inline-flex;
            flex-shrink: 0;
            align-items: center;
            justify-content: center;
            width: 0.85rem;
            height: 0.85rem;
            padding: 0;
            border: 0;
            background: transparent;
            color: var(--muted-foreground);
            opacity: 0;
            transition: color 140ms ease, opacity 140ms ease;
        }
        .analysis-grid .analysis-stock-row:hover .analysis-security-type-toggle,
        .analysis-grid .analysis-security-type-toggle:focus-visible,
        .analysis-grid .analysis-security-type-toggle.is-etf {
            opacity: 0.72;
        }
        .analysis-grid .analysis-security-type-toggle.is-etf {
            color: #60a5fa;
        }
        .analysis-grid .analysis-security-type-toggle.is-non-allocating {
            color: var(--foreground);
            opacity: 1;
        }
        .analysis-grid .analysis-security-type-toggle:hover {
            color: #7dd3fc;
            opacity: 1;
        }
        .analysis-grid .analysis-security-type-toggle.is-archive {
            width: 18px;
            height: 18px;
            border-radius: 3px;
            cursor: pointer;
        }
        .analysis-grid .analysis-security-type-toggle.is-archive:hover,
        .analysis-grid .analysis-security-type-toggle.is-archive:focus-visible {
            color: var(--foreground);
            background: var(--muted);
            opacity: 1;
        }
        .analysis-grid .analysis-security-type-toggle.is-archive:disabled {
            cursor: wait;
            opacity: 0.3;
        }
        .analysis-grid .analysis-archive-error {
            display: block;
            padding-top: 3px;
            color: var(--destructive);
            font-size: 11px;
            line-height: 16px;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        @media (pointer: coarse) {
            .analysis-grid .analysis-security-type-toggle.is-archive {
                width: 24px;
                height: 24px;
            }
        }
        /* In/Out is a quiet text toggle: included reads as normal text, excluded is muted. */
        .analysis-grid .analysis-model-toggle {
            display: inline-flex;
            min-width: 2.5rem;
            min-height: 24px;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: 3px;
            background: transparent;
            padding: 0 0.4rem;
            font-size: 12px;
            font-weight: 500;
            line-height: 1;
            transition: background-color 120ms ease, color 120ms ease;
        }
        .analysis-grid .analysis-model-toggle.is-included {
            color: var(--foreground);
        }
        .analysis-grid .analysis-model-toggle.is-excluded {
            color: var(--muted-foreground);
            font-weight: 400;
        }
        .analysis-grid .analysis-model-toggle:hover,
        .analysis-grid .analysis-model-toggle:focus-visible {
            background: color-mix(in srgb, var(--foreground) 7%, transparent);
            color: var(--foreground);
        }
        .analysis-grid .analysis-name-cell {
            position: relative;
        }
        .analysis-grid .analysis-name-header {
            position: relative;
            overflow: visible;
        }
        .analysis-grid .analysis-ticker-pin-control {
            position: absolute;
            left: 0.35rem;
            top: 50%;
            z-index: 4;
            display: inline-flex;
            width: 1.35rem;
            height: 1.35rem;
            align-items: center;
            justify-content: center;
            border: 1px solid transparent;
            border-radius: 4px;
            color: var(--muted-foreground);
            opacity: 0.55;
            transform: translateY(-50%);
            transition:
                border-color 140ms ease,
                background-color 140ms ease,
                color 140ms ease,
                opacity 140ms ease;
        }
        .analysis-grid .analysis-name-header:hover .analysis-ticker-pin-control,
        .analysis-grid .analysis-ticker-pin-control:focus-visible,
        .analysis-grid .analysis-ticker-pin-control.is-pinned {
            opacity: 1;
        }
        .analysis-grid .analysis-ticker-pin-control:hover,
        .analysis-grid .analysis-ticker-pin-control:focus-visible {
            border-color: color-mix(in srgb, var(--primary) 44%, transparent);
            background: color-mix(in srgb, var(--primary) 10%, transparent);
            color: var(--foreground);
            outline: none;
        }
        .analysis-grid .analysis-ticker-pin-control.is-pinned {
            border-color: color-mix(in srgb, var(--primary) 52%, transparent);
            background: color-mix(in srgb, var(--primary) 16%, transparent);
            color: var(--primary);
        }
        .analysis-grid .analysis-ticker-hover-trigger,
        .analysis-grid .analysis-name-ticker-hover-zone {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            z-index: 2;
            width: 20%;
            min-width: 2.35rem;
            max-width: 4.85rem;
            cursor: ew-resize;
        }
        .analysis-grid .analysis-name-ticker-hover-zone {
            z-index: 3;
        }
        .analysis-grid.is-ticker-rail-open .analysis-name-ticker-hover-zone {
            pointer-events: none;
        }
        .analysis-grid .analysis-ticker-hover-trigger::after {
            content: '';
            position: absolute;
            left: 0.35rem;
            top: 50%;
            width: 2px;
            height: 1.2rem;
            border-radius: 999px;
            background: color-mix(in srgb, var(--primary) 56%, var(--foreground) 18%);
            opacity: 0;
            transform: translateY(-50%);
            transition: opacity 160ms ease;
        }
        .analysis-grid:has(.analysis-ticker-hover-trigger:hover) .analysis-ticker-hover-trigger::after,
        .analysis-grid .analysis-name-header:hover .analysis-ticker-hover-trigger::after,
        .analysis-grid.is-ticker-rail-open .analysis-ticker-hover-trigger::after {
            opacity: 0.78;
        }
        .analysis-grid .analysis-name-stack {
            min-width: 0;
        }
        .analysis-grid .analysis-name-primary {
            display: flex;
            align-items: center;
            gap: 0.45rem;
            min-width: 0;
        }
        .analysis-grid .analysis-name-content {
            display: inline-flex;
            min-width: 0;
            align-items: center;
            gap: 0.25rem;
        }
        .analysis-grid .analysis-company-name {
            color: var(--analysis-text-strong);
            font-family: system-ui;
            font-size: 11px;
            font-weight: 400;
            letter-spacing: 0.04em;
        }
        .analysis-grid .analysis-connection-lane {
            display: inline-flex;
            width: 0.7rem;
            align-items: center;
            justify-content: end;
        }
        .analysis-grid .analysis-connection-lane > div {
            margin-right: 0;
        }
        .analysis-grid .analysis-ticker-rail {
            display: inline-flex;
            flex: 0 0 auto;
            width: 0;
            min-width: 0;
            margin-left: -0.35rem;
            align-items: center;
            gap: 0.25rem;
            overflow: hidden;
            opacity: 0;
            pointer-events: none;
            transform: translateX(-0.6rem);
            transition:
                width 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
                margin-left 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
                opacity 150ms ease,
                transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .analysis-grid:has(.analysis-ticker-hover-trigger:hover) .analysis-ticker-rail,
        .analysis-grid .analysis-name-cell:has(.analysis-name-ticker-hover-zone:hover) .analysis-ticker-rail,
        .analysis-grid.is-ticker-rail-open .analysis-ticker-rail,
        .analysis-grid .analysis-ticker-rail:focus-within,
        .analysis-grid .analysis-ticker-rail.is-editing {
            width: 4rem;
            margin-left: 0;
            opacity: 1;
            pointer-events: auto;
            transform: translateX(0);
        }
        .analysis-grid .analysis-ticker-total {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.02em;
            flex-shrink: 0;
        }
        .analysis-grid .analysis-row-ticker {
            color: var(--analysis-ticker-text) !important;
            font-family: var(--font-mono);
            font-size: 11.5px !important;
            font-weight: 700 !important;
            letter-spacing: 0.02em !important;
            text-align: left;
        }
        .analysis-grid .analysis-ticker-cell {
            display: flex;
            width: 4.85rem;
            min-width: 4.85rem;
            align-items: center;
            gap: 0.32rem;
        }
        .analysis-grid .analysis-tag-lane {
            display: inline-flex;
            min-width: 0;
            align-items: center;
            justify-content: flex-start;
            gap: 0.16rem;
            overflow: hidden;
        }
        .analysis-grid .analysis-inline-badge {
            flex: 0 0 auto;
            border-radius: 3px;
            border: 1px solid transparent;
            padding: 0.03rem 0.22rem;
            font-size: 8px;
            font-weight: 700;
            line-height: 1.05;
            letter-spacing: 0.025em;
        }
        .analysis-grid .analysis-inline-badge.is-watch {
            border-color: color-mix(in srgb, #a78bfa 58%, transparent);
            background: color-mix(in srgb, #a78bfa 10%, transparent);
            color: color-mix(in srgb, #c4b5fd 82%, var(--foreground) 18%);
        }
        .analysis-grid .analysis-inline-badge.is-ext {
            border-color: color-mix(in srgb, var(--signal-warn) 52%, transparent);
            background: color-mix(in srgb, var(--signal-warn) 10%, transparent);
            color: color-mix(in srgb, #f4c95d 78%, var(--foreground) 22%);
        }
        .analysis-grid .analysis-inline-badge.is-etf {
            border-color: color-mix(in srgb, #ec4899 50%, transparent);
            background: color-mix(in srgb, #ec4899 10%, transparent);
            color: color-mix(in srgb, #f9a8d4 78%, var(--foreground) 22%);
        }
        .analysis-grid .analysis-asset-class-button {
            color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
            font-size: 11px;
        }
        .analysis-grid .analysis-asset-class-button:hover,
        .analysis-grid .analysis-asset-class-button:focus {
            color: var(--foreground);
        }
        .analysis-grid .analysis-asset-class-button.is-unassigned {
            color: color-mix(in srgb, var(--primary) 74%, var(--foreground) 26%);
            font-weight: 700;
        }
        .analysis-grid .analysis-inline-editor {
            position: absolute;
            left: 0.75rem;
            top: calc(100% + 0.15rem);
            z-index: 80;
            display: flex;
            align-items: center;
            gap: 0.45rem;
            min-width: 18rem;
            max-width: min(34rem, calc(100vw - 2rem));
            border: 1px solid var(--analysis-editor-border);
            background: var(--analysis-editor-bg);
            color: var(--analysis-editor-text);
            box-shadow: 0 8px 22px var(--analysis-editor-shadow);
            padding: 0.5rem;
        }
        .analysis-grid .analysis-inline-editor.analysis-inline-editor-name {
            width: 26rem;
        }
        .analysis-grid .analysis-inline-editor.analysis-inline-editor-ticker {
            width: 22rem;
        }
        .analysis-grid .analysis-inline-field {
            display: flex;
            min-width: 0;
            flex: 1 1 0;
            flex-direction: column;
            gap: 0.2rem;
        }
        .analysis-grid .analysis-inline-field-label {
            color: var(--muted-foreground);
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.08em;
            line-height: 1;
            text-transform: uppercase;
        }
        .analysis-grid .analysis-inline-actions {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: flex-end;
            gap: 0.25rem;
            padding-top: 0.85rem;
        }
        .analysis-grid .analysis-inline-editor input {
            height: 1.7rem;
            border: 1px solid var(--analysis-editor-border);
            background: var(--background);
            color: var(--foreground);
            padding: 0 0.45rem;
            outline: none;
        }
        .analysis-grid .analysis-inline-editor input:focus {
            border-color: var(--primary);
        }
        .analysis-grid .analysis-inline-editor button {
            height: 1.7rem;
            min-width: 1.7rem;
            border: 1px solid var(--analysis-editor-border);
            background: var(--card);
            padding: 0 0.3rem;
        }
        .analysis-grid {
            --analysis-hierarchy-row-height: 2.55rem;
            --analysis-security-row-height: 28px;
            --analysis-security-indent: clamp(2rem, 2.5vw, 3rem);
        }
        .analysis-grid .analysis-section-row td,
        .analysis-grid .analysis-asset-row td,
        .analysis-grid .analysis-group-row td {
            height: var(--analysis-hierarchy-row-height);
            overflow: visible;
            border-top: 1px solid var(--analysis-hierarchy-border);
            border-bottom: 1px solid var(--analysis-hierarchy-border);
        }
        .analysis-grid .analysis-hierarchy-content {
            height: var(--analysis-hierarchy-row-height);
        }
        .analysis-grid .analysis-section-stats {
            margin-inline-end: 1.5rem;
        }
        .analysis-grid .analysis-section-row td {
            background: var(--background);
        }
        .analysis-grid .analysis-asset-row td {
            background: var(--analysis-hierarchy-asset-bg);
        }
        .analysis-grid .analysis-group-row td {
            background: var(--analysis-hierarchy-group-bg);
        }
        .analysis-grid .analysis-section-row:hover td,
        .analysis-grid .analysis-asset-row:hover td,
        .analysis-grid .analysis-group-row:hover td {
            background: var(--analysis-hierarchy-hover-bg);
        }
        .analysis-grid .analysis-hierarchy-label {
            color: var(--foreground);
            font-family: sans-serif;
            font-size: 1.4rem;
            font-weight: 200;
            letter-spacing: 0;
            text-transform: lowercase;
        }
        .analysis-grid tbody tr.analysis-stock-row td.analysis-model-score-cell {
            background-color: color-mix(in srgb, var(--analysis-ratings-cell-bg) 58%, transparent);
            padding-left: 0.25rem;
            padding-right: 0.25rem;
        }
        .analysis-grid thead th.analysis-model-score-header {
            background: var(--analysis-ratings-header-bg);
        }
        .analysis-grid .analysis-notes-toggle {
            display: inline-flex;
            height: 1.3rem;
            align-items: center;
            border: 1px solid color-mix(in srgb, var(--analysis-grid-border) 78%, transparent);
            border-radius: 3px;
            background: color-mix(in srgb, var(--card) 76%, transparent);
            color: color-mix(in srgb, var(--analysis-header-text) 78%, transparent);
            padding: 0 0.38rem;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .analysis-grid .analysis-notes-toggle:hover {
            color: var(--analysis-header-text);
            border-color: color-mix(in srgb, var(--primary) 42%, var(--analysis-grid-border));
        }
        .analysis-grid thead {
            top: 0 !important;
        }
        .analysis-grid .analysis-stock-row {
            height: var(--analysis-security-row-height);
            min-height: var(--analysis-security-row-height);
            background: var(--analysis-stock-row-bg);
            cursor: pointer;
        }
        .analysis-grid .analysis-stock-row td {
            height: var(--analysis-security-row-height);
            padding-top: 0;
            padding-bottom: 0;
        }
        .analysis-grid .analysis-stock-row .analysis-name-primary {
            padding-left: var(--analysis-security-indent);
        }
        .analysis-grid .analysis-stock-row .analysis-name-ticker-hover-zone {
            width: var(--analysis-security-indent);
            min-width: 0;
            max-width: none;
        }
        .analysis-grid .analysis-stock-row:hover,
        .analysis-grid .analysis-stock-row.is-expanded {
            background: var(--analysis-stock-row-hover-bg);
        }
        .analysis-grid .analysis-stock-row.is-watchlist,
        .analysis-grid .analysis-stock-row.is-etf,
        .analysis-grid .analysis-stock-row.is-watchlist.is-etf {
            background: var(--analysis-stock-row-bg);
        }
        .analysis-grid .analysis-stock-row.is-etf {
            box-shadow: inset 0px 0px 5px 1px
                color-mix(in srgb, var(--info) 18%, transparent);
            border-radius: 6px;
        }
        html[data-theme='terminal-dark'] .analysis-grid .analysis-section-row td {
            background: lch(8.17 8.68 255.3 / 0.4);
        }
        .analysis-grid:not(.is-watchlist-highlight) .analysis-stock-row.is-watchlist:hover,
        .analysis-grid:not(.is-watchlist-highlight) .analysis-stock-row.is-watchlist.is-expanded {
            background: var(--analysis-stock-row-hover-bg);
        }
        .analysis-grid.is-watchlist-highlight .analysis-stock-row.is-watchlist {
            background: color-mix(in srgb, #a78bfa 12%, var(--analysis-stock-row-bg));
        }
        .analysis-grid.is-watchlist-highlight .analysis-stock-row.is-watchlist td:first-child {
            box-shadow: inset 2px 0 0 rgba(196, 181, 253, 0.74);
        }
        .analysis-grid.is-watchlist-highlight .analysis-stock-row.is-watchlist:hover,
        .analysis-grid.is-watchlist-highlight .analysis-stock-row.is-watchlist.is-expanded {
            background: color-mix(in srgb, #a78bfa 16%, var(--analysis-stock-row-hover-bg));
        }
        .analysis-grid .analysis-row-expander {
            display: inline-flex;
            width: 1rem;
            height: 1rem;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            border: 0;
            background: transparent;
            color: var(--muted-foreground);
            font-size: 12px;
            line-height: 1;
        }
        .analysis-grid .analysis-row-expander:hover {
            color: var(--foreground);
        }
        .analysis-grid .analysis-row-expander-placeholder {
            display: inline-flex;
            width: 1rem;
            height: 1rem;
            flex: 0 0 auto;
        }
        .analysis-grid .analysis-name-stack {
            display: flex;
            min-width: 0;
            flex-direction: column;
            gap: 0;
        }
        .analysis-grid .analysis-name-primary {
            align-items: center;
            gap: 0.35rem;
        }
        .analysis-grid .analysis-name-content {
            gap: 0.38rem;
        }
        .analysis-grid .analysis-exchange-tag {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            border-radius: 4px;
            max-width: 0;
            overflow: hidden;
            border: 1px solid transparent;
            background: transparent;
            color: var(--muted-foreground);
            padding: 0;
            font-family: var(--font-mono);
            font-size: 8px;
            font-weight: 600;
            letter-spacing: 0;
            line-height: 1.15;
            opacity: 0;
            transform: translateX(-0.2rem);
            transition:
                max-width 160ms ease,
                opacity 120ms ease,
                padding 160ms ease,
                transform 160ms ease,
                border-color 160ms ease,
                background-color 160ms ease;
            white-space: nowrap;
        }
        .analysis-grid .analysis-stock-row:hover .analysis-exchange-tag.is-assigned,
        .analysis-grid .analysis-exchange-tag.is-assigned:focus-visible {
            max-width: 3.25rem;
            border-color: color-mix(in srgb, var(--border) 72%, transparent);
            background: color-mix(in srgb, var(--secondary) 70%, transparent);
            padding: 0.07rem 0.24rem;
            opacity: 0.8;
            transform: translateX(0);
        }
        .analysis-grid .analysis-company-identity {
            position: relative;
            display: inline-flex;
            align-items: center;
            flex: 0 1 auto;
            min-width: 0;
        }
        .analysis-grid .analysis-company-identity.has-exchange-warning {
            padding-right: 10px;
        }
        .analysis-grid .analysis-exchange-warning {
            position: absolute;
            top: -5px;
            right: -2px;
            display: grid;
            place-items: center;
            width: 16px;
            height: 16px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: transparent;
            cursor: pointer;
        }
        .analysis-grid .analysis-exchange-warning > span {
            display: grid;
            place-items: center;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--destructive);
            color: var(--background);
            font: 700 9px/1 system-ui;
            box-shadow: 0 0 4px color-mix(in srgb, var(--destructive) 35%, transparent);
        }
        .analysis-grid .analysis-exchange-warning:hover,
        .analysis-grid .analysis-exchange-warning:focus-visible {
            outline: 1px solid var(--destructive);
            outline-offset: 1px;
        }
        .analysis-grid .analysis-company-name {
            color: var(--foreground);
            font-family: system-ui;
            font-size: 13px;
            font-weight: 400;
            min-width: 0;
            flex: 0 1 auto;
            letter-spacing: 0;
            line-height: 1.1;
        }
        .analysis-grid .analysis-score-cell {
            background: transparent;
        }
        .analysis-grid .analysis-score-summary {
            display: flex;
            position: relative;
            width: 100%;
            height: 100%;
            min-width: 0;
            align-items: center;
            gap: 0;
            border: 0;
            background: transparent;
            color: var(--foreground);
            padding-bottom: 0.34rem;
        }
        .analysis-grid .analysis-score-inline {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding-left: 3px;
            width: 94%;
            min-width: 0;
        }
        .analysis-grid.is-score-alignment-left .analysis-score-inline {
            justify-content: flex-start;
        }
        .analysis-grid.is-score-alignment-center .analysis-score-inline {
            justify-content: center;
        }
        .analysis-grid .analysis-score-inline.is-empty {
            justify-content: center;
        }
        .analysis-grid .analysis-score-number {
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            color: var(--foreground);
        }
        .analysis-grid .analysis-score-bar {
            position: absolute;
            left: 0.18rem;
            right: 0.18rem;
            bottom: 0.18rem;
            display: block;
            height: 2px;
            overflow: hidden;
            border-radius: 2px;
            background: var(--secondary);
        }
        .analysis-grid .analysis-score-state-early .analysis-score-bar {
            outline: 1px solid var(--border);
            background: transparent;
        }
        .analysis-grid .analysis-score-state-early .analysis-score-bar-fill {
            background-image: repeating-linear-gradient(
                90deg,
                transparent 0,
                transparent 2px,
                color-mix(in srgb, var(--background) 75%, transparent) 2px,
                color-mix(in srgb, var(--background) 75%, transparent) 5px
            );
        }
        .analysis-grid .analysis-score-state-provisional .analysis-score-bar-fill {
            background-image: repeating-linear-gradient(
                45deg,
                rgba(255,255,255,0.20) 0,
                rgba(255,255,255,0.20) 4px,
                transparent 4px,
                transparent 8px
            );
        }
        .analysis-grid .analysis-score-bar-fill {
            display: block;
            height: 100%;
            border-radius: inherit;
        }
        .analysis-grid .analysis-council-cell {
            background: transparent;
        }
        .analysis-grid .analysis-council-trigger {
            display: inline-flex;
            min-width: 3.1rem;
            min-height: 1.35rem;
            align-items: center;
            justify-content: center;
            border-radius: 5px;
            border: 1px solid var(--secondary);
            background: transparent;
            padding: 0.12rem 0.42rem;
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 600;
            line-height: 1;
        }
        .analysis-grid .analysis-council-trigger.has-score {
            border-color: transparent;
            color: var(--foreground);
        }
        .analysis-grid .analysis-council-trigger.is-empty {
            border-color: var(--border);
            color: var(--muted-foreground);
        }
        .analysis-grid .analysis-council-trigger.has-error {
            border-color: color-mix(in srgb, var(--signal-sell) 50%, var(--border));
        }
        .analysis-grid .analysis-council-trigger:hover {
            border-color: rgba(63, 185, 80, 0.45);
            color: var(--signal-buy);
        }
        .analysis-grid .analysis-council-trigger.has-score:hover {
            border-color: transparent;
        }
        .analysis-grid .analysis-target-weight-cell {
            position: relative;
            text-align: right;
        }
        /* One value per cell; the share bar is an underline, like the score bars,
           so it never adds a second line to the row. */
        .analysis-grid .analysis-target-weight {
            display: block;
            width: 100%;
        }
        .analysis-grid .analysis-target-number {
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            color: var(--foreground);
        }
        .analysis-grid .analysis-target-bar {
            position: absolute;
            left: 0.18rem;
            right: 0.18rem;
            bottom: 0.18rem;
            display: block;
            height: 2px;
            overflow: hidden;
            border-radius: 2px;
            background: color-mix(in srgb, var(--secondary) 76%, transparent);
        }
        .analysis-grid .analysis-target-bar span {
            display: block;
            height: 100%;
            border-radius: inherit;
        }
        .analysis-grid .analysis-target-off {
            color: var(--muted-foreground);
            font-size: 11px;
        }
        .analysis-grid .analysis-council-stale {
            color: var(--signal-sell);
            font-size: 11px;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        .analysis-grid .analysis-upside-display {
            display: inline-grid;
            min-width: 4rem;
            place-items: center;
        }
        .analysis-grid .analysis-upside-target,
        .analysis-grid .analysis-upside-percent {
            grid-area: 1 / 1;
            font-family: var(--font-mono);
            font-size: 12px;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        .analysis-grid .analysis-upside-target {
            color: var(--foreground);
        }
        .analysis-grid .analysis-upside-percent {
            font-size: 11px;
            font-weight: 700;
            opacity: 0;
        }
        .analysis-grid .analysis-upside-percent--buy {
            color: var(--signal-buy) !important;
        }
        .analysis-grid .analysis-upside-percent--warn {
            color: var(--signal-warn) !important;
        }
        .analysis-grid .analysis-upside-percent--sell {
            color: var(--signal-sell) !important;
        }
        .analysis-grid .analysis-upside-percent--muted {
            color: var(--muted-foreground) !important;
        }
        .analysis-grid td.analysis-upside-cell:hover .analysis-upside-target {
            opacity: 0;
        }
        .analysis-grid td.analysis-upside-cell:hover .analysis-upside-percent {
            opacity: 1;
        }
        .analysis-grid .analysis-momentum-display {
            display: inline-grid;
            min-width: 3.8rem;
            place-items: center;
        }
        .analysis-grid .analysis-momentum-return,
        .analysis-grid .analysis-momentum-modifier {
            grid-area: 1 / 1;
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            transition: opacity 140ms ease, transform 140ms ease;
            white-space: nowrap;
        }
        .analysis-grid .analysis-momentum-modifier {
            color: var(--foreground);
            opacity: 0;
            transform: translateY(0.18rem);
        }
        .analysis-grid .analysis-momentum-display.is-etf .analysis-momentum-return {
            opacity: 0.9;
        }
        .analysis-grid td:hover .analysis-momentum-return {
            opacity: 0;
            transform: translateY(-0.18rem);
        }
        .analysis-grid td:hover .analysis-momentum-display.is-etf .analysis-momentum-return {
            opacity: 0.9;
            transform: none;
        }
        .analysis-grid td:hover .analysis-momentum-modifier {
            opacity: 1;
            transform: translateY(0);
        }
        /* ── Anchored-dollar display (classBudgetsApplied = true) ── */
        .analysis-grid .analysis-target-dollar {
            font-family: var(--font-mono);
            font-size: 11px;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            color: var(--foreground);
            line-height: 1.15;
            letter-spacing: -0.01em;
        }
        .analysis-grid .analysis-target-subrow {
            display: flex;
            align-items: center;
            gap: 3px;
            width: 100%;
        }
        .analysis-grid .analysis-target-pct-muted {
            font-family: var(--font-mono);
            font-size: 9.5px;
            font-variant-numeric: tabular-nums;
            color: var(--muted-foreground);
            white-space: nowrap;
            flex-shrink: 0;
            line-height: 1;
        }
        /* No-budget state: render % but visually de-emphasised */
        .analysis-grid .analysis-target-unbudgeted {
            opacity: 0.4;
        }
        .analysis-grid .analysis-target-bar--dim {
            opacity: 0.35;
        }
        .analysis-grid .analysis-signal {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.3rem;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.02em;
            line-height: 1;
        }
        .analysis-grid .analysis-signal-icon {
            font-size: 15px;
            font-weight: 500;
            line-height: 1;
        }
        .analysis-grid .analysis-router-drift {
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        .analysis-grid .analysis-expanded-row > td {
            border-bottom: 1px solid var(--border);
            background: var(--background);
            overflow: visible;
            border-top: 1px solid var(--border);
        }
        .analysis-run-popover {
            --analysis-run-actions-height: 36px;
            position: fixed;
            z-index: 9999;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: min(34rem, calc(100vw - 24px));
            max-height: calc(100dvh - 24px);
            overflow-y: auto;
            border: 1px solid var(--border);
            border-radius: 7px;
            background: var(--card);
            box-shadow: 0 16px 40px rgba(0,0,0,0.5);
            padding: 0.85rem;
        }
        .analysis-run-popover-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 0.7rem;
        }
        .analysis-run-popover-title {
            color: var(--foreground);
            font-size: 13px;
            font-weight: 700;
        }
        .analysis-run-popover-meta {
            margin-top: 0.12rem;
            color: var(--muted-foreground);
            font-size: 11px;
        }
        .analysis-run-popover-close {
            border: 0;
            background: transparent;
            color: var(--muted-foreground);
            font-size: 16px;
            line-height: 1;
        }
        .analysis-run-header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .analysis-run-template-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 30px;
            padding: 5px 8px;
            border: 1px solid var(--border);
            border-radius: 5px;
            color: var(--primary);
            font-size: 12px;
            cursor: pointer;
        }
        .analysis-run-template-toggle:hover,
        .analysis-run-template-toggle[aria-pressed="true"] {
            border-color: var(--primary);
            background: color-mix(in srgb, var(--primary) 10%, transparent);
        }
        .analysis-run-template-toggle:focus-visible {
            outline: 2px solid var(--primary);
            outline-offset: 2px;
        }
        .analysis-run-body {
            display: flex;
            flex-direction: column;
            height: min(24rem, calc(100dvh - 11rem));
            overflow-y: auto;
        }
        .analysis-run-body > .analysis-run-fields,
        .analysis-run-body > .analysis-run-date-row {
            flex-shrink: 0;
        }
        .analysis-run-body > .analysis-run-source {
            flex: 1;
            min-height: 110px;
        }
        .analysis-run-body > .analysis-run-source textarea {
            flex: 1;
            min-height: 80px;
        }
        .analysis-run-fields {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.55rem;
        }
        .analysis-run-fields label,
        .analysis-run-date-row label,
        .analysis-run-source {
            display: flex;
            min-width: 0;
            flex-direction: column;
            gap: 0.28rem;
        }
        .analysis-run-fields span,
        .analysis-run-date-row span,
        .analysis-run-source span {
            color: var(--muted-foreground);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }
        .analysis-run-fields input,
        .analysis-run-date-row input,
        .analysis-run-source textarea {
            min-width: 0;
            border: 1px solid var(--border);
            border-radius: 5px;
            background: var(--background);
            color: var(--foreground);
            padding: 0.52rem 0.6rem;
            font-family: var(--font-mono);
            font-size: 13px;
            outline: none;
        }
        .analysis-run-source textarea {
            resize: vertical;
            font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 12px;
            line-height: 1.45;
        }
        .analysis-run-date-row {
            display: flex;
            align-items: flex-end;
            gap: 0.55rem;
            margin-top: 0.65rem;
        }
        .analysis-run-date-row label {
            width: 12rem;
        }
        .analysis-run-date-row button {
            height: 2.15rem;
            border: 1px solid var(--border);
            border-radius: 5px;
            color: var(--muted-foreground);
            padding: 0 0.65rem;
            font-size: 11px;
            font-weight: 700;
        }
        .analysis-run-source {
            margin-top: 0.65rem;
        }
        .analysis-run-actions {
            display: grid;
            grid-template-columns: auto 1fr auto auto;
            align-items: center;
            gap: 0.5rem;
            margin-top: 0.7rem;
            height: var(--analysis-run-actions-height);
        }
        .analysis-run-actions button {
            min-height: 30px;
            border-radius: 5px;
            padding: 0.44rem 0.7rem;
            font-size: 11px;
            font-weight: 700;
        }
        .analysis-run-actions .is-primary {
            border: 1px solid rgba(63,185,80,0.55);
            background: rgba(63,185,80,0.14);
            color: var(--signal-buy);
        }
        .analysis-run-actions .is-secondary {
            border: 1px solid var(--border);
            color: var(--muted-foreground);
        }
        @media (max-width: 820px) {
            .analysis-run-popover {
                --analysis-run-actions-height: 68px;
            }
            .analysis-run-fields {
                grid-template-columns: 1fr;
            }
            .analysis-run-actions {
                grid-template-columns: 1fr 1fr;
            }
            .analysis-run-actions span {
                display: none;
            }
        }
    `}</style>
    <ResizableGrid<AnalysisGridColumnKey>
        columns={analysisGridBaseColumns}
        widthScope="analysis"
        storageKey="terminal-analysis-column-widths-v1"
        columnNames={analysisColumnNames}
        onPanelWidthChange={setAnalysisGridPanelWidth}
        containerClassName="analysis-grid-scroll h-full min-h-0 overflow-auto px-3 pb-3 pt-0"
        headerClassName="sticky top-0 z-10"
        tableClassName={[
            'analysis-grid w-full table-fixed text-xs border-collapse',
            ratingsExpanded ? 'ratings-expanded' : '',
            tickerRevealEnabled && (tickerRailOpen || analysisTickerPinned)
                ? 'is-ticker-rail-open'
                : '',
            watchlistHighlightEnabled ? 'is-watchlist-highlight' : '',
            `is-score-alignment-${analysisScoreAlignment}`,
        ].filter(Boolean).join(' ')}
        renderHeader={(_columns, controls) => (
            <tr className="analysis-column-header text-foreground border-b border-border/30">
                <th data-column-key="name"
                    className="analysis-name-header text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    aria-sort={
                        sortColumn === 'NAME' && sortDirection
                            ? sortDirection === 'desc'
                                ? 'descending'
                                : 'ascending'
                            : 'none'
                    }
                    onMouseLeave={() => setTickerRailOpen(false)}
                    onPointerLeave={() => setTickerRailOpen(false)}
                >
                    {tickerRevealEnabled && (
                        <>
                            <span
                                className="analysis-ticker-hover-trigger"
                                title="Reveal tickers"
                                aria-hidden="true"
                                onClick={() => setTickerRailOpen(true)}
                                onMouseEnter={() => setTickerRailOpen(true)}
                                onMouseMove={() => setTickerRailOpen(true)}
                                onPointerEnter={() => setTickerRailOpen(true)}
                                onPointerMove={() => setTickerRailOpen(true)}
                            />
                            <button
                                type="button"
                                className={`analysis-ticker-pin-control ${
                                    analysisTickerPinned ? 'is-pinned' : ''
                                }`}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setAnalysisTickerPinned((pinned) => !pinned);
                                }}
                                aria-label={
                                    analysisTickerPinned
                                        ? 'Unpin tickers'
                                        : 'Pin tickers open'
                                }
                                aria-pressed={analysisTickerPinned}
                                title={
                                    analysisTickerPinned
                                        ? 'Unpin tickers'
                                        : 'Pin tickers open'
                                }
                            >
                                <Pin size={11} aria-hidden="true" />
                            </button>
                        </>
                    )}
                    <div className="flex items-center justify-center gap-2">
                        <div
                            ref={columnMenuRef}
                            className="relative inline-flex items-center"
                        >
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    const rect =
                                        event.currentTarget.getBoundingClientRect();
                                    setColumnMenuPosition({
                                        top:
                                            rect.bottom + 6,
                                        left: Math.max(
                                            8,
                                            rect.left,
                                        ),
                                    });
                                    setShowColumnMenu(
                                        (value) => !value,
                                    );
                                }}
                                className="text-muted-foreground hover:text-foreground text-[10px]"
                                title="Toggle columns"
                                aria-label="Choose visible Analysis columns"
                                aria-haspopup="dialog"
                                aria-expanded={showColumnMenu}
                                aria-controls="analysis-column-menu"
                            >
                                ☰
                            </button>
                            {showColumnMenu && (
                                <div
                                    id="analysis-column-menu"
                                    ref={columnMenuPanelRef}
                                    className="fixed z-[1000] min-w-[170px] rounded border border-border bg-card p-2 text-left shadow-lg"
                                    style={{
                                        top: `${columnMenuPosition.top}px`,
                                        left: `${columnMenuPosition.left}px`,
                                    }}
                                    role="dialog"
                                    aria-label="Choose visible Analysis columns"
                                >
                                    <div className="max-h-[320px] space-y-1 overflow-auto pr-1 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                        {analysisColumnMenuItems.map(
                                            (item) => (
                                                <label
                                                    key={
                                                        item.key
                                                    }
                                                    className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-muted/20"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={analysisColumnVisible(
                                                            item.key,
                                                        )}
                                                        onChange={() =>
                                                            toggleAnalysisColumn(
                                                                item.key,
                                                            )
                                                        }
                                                        className="cursor-pointer"
                                                    />
                                                    <span>
                                                        {
                                                            item.label
                                                        }
                                                    </span>
                                                </label>
                                            ),
                                        )}
                                    </div>
                                    <button type="button" className="analysis-column-reset"
                                        onClick={() => {
                                            controls.resetColumnWidths();
                                            setShowColumnMenu(false);
                                        }}>
                                        <RotateCcw size={14} aria-hidden="true" />
                                        Reset column widths
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                            onClick={() => handleSort('NAME')}
                            aria-label={`Name: ${
                                sortColumn === 'NAME' && sortDirection
                                    ? `sorted ${sortDirection === 'desc' ? 'descending' : 'ascending'}`
                                    : 'sort descending'
                            }`}
                        >
                            <span>NAME</span>
                            {sortColumn === 'NAME' &&
                                (sortDirection === 'desc'
                                    ? '↓'
                                    : '↑')}
                        </button>
                        {!ratingsExpanded &&
                            (analysisColumnVisible('thesis') ||
                                analysisColumnVisible('nextCatalyst')) && (
                                <button
                                    type="button"
                                    className="analysis-notes-toggle"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setNotesExpanded((value) => !value);
                                    }}
                                    title={
                                        notesExpanded
                                            ? 'Collapse notes columns'
                                            : 'Show thesis and catalyst columns'
                                    }
                                >
                                    Notes {notesExpanded ? '-' : '+'}
                                </button>
                        )}
                    </div>
                    {controls.resizeHandle('name')}
                </th>
                {analysisColumnVisible('assetClass') && (
                <AnalysisColumnHeader
                    columnKey="assetClass" resizeHandle={controls.resizeHandle('assetClass')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="ASSET_CLASS"
                    onSort={handleSort}
                >
                    ASSET CLASS
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('price') && (
                <AnalysisColumnHeader
                    columnKey="price" resizeHandle={controls.resizeHandle('price')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="PRICE"
                    onSort={handleSort}
                    title="Sort by current price"
                >
                    PRICE
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('avgPt') && (
                <AnalysisColumnHeader
                    columnKey="avgPt" resizeHandle={controls.resizeHandle('avgPt')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="UPSIDE"
                    onSort={handleSort}
                    title="Sort by upside percentage"
                >
                    UPSIDE
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('performance12m') && (
                <AnalysisColumnHeader
                    columnKey="performance12m" resizeHandle={controls.resizeHandle('performance12m')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="PERFORMANCE_12M"
                    onSort={handleSort}
                >
                    12M %
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('quality') && (
                <AnalysisColumnHeader
                    columnKey="quality" resizeHandle={controls.resizeHandle('quality')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="QUALITY"
                    onSort={handleSort}
                    title="Mean quality across completed model runs"
                >
                    QUALITY
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('value') && (
                <AnalysisColumnHeader
                    columnKey="value" resizeHandle={controls.resizeHandle('value')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="VALUE_SCORE"
                    onSort={handleSort}
                    title="Mean value across completed model runs"
                >
                    VALUE
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('total') && (
                <AnalysisColumnHeader
                    columnKey="total" resizeHandle={controls.resizeHandle('total')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="TOTAL"
                    onSort={handleSort}
                    title="Average Quality and Value score across completed model runs"
                >
                    TOTAL
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('council') && (
                <AnalysisColumnHeader
                    columnKey="council" resizeHandle={controls.resizeHandle('council')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="COUNCIL"
                    onSort={handleSort}
                    title="Council composite score"
                >
                    COUNCIL
                </AnalysisColumnHeader>
                )}
                {ratingsExpanded && (
                    <>
                        {analysisColumnVisible('gemini') && (
                        <AnalysisColumnHeader
                            columnKey="gemini" resizeHandle={controls.resizeHandle('gemini')}
                            className="analysis-model-score-header text-center pb-2 font-medium tracking-wide border-r border-border/30"
                            sortColumn={sortColumn}
                            sortDirection={sortDirection}
                            sortKey="GEMINI"
                            onSort={handleSort}
                            title="Gemini"
                        >
                            GEMINI
                        </AnalysisColumnHeader>
                        )}
                        {analysisColumnVisible('perplexity') && (
                        <AnalysisColumnHeader
                            columnKey="perplexity" resizeHandle={controls.resizeHandle('perplexity')}
                            className="analysis-model-score-header text-center pb-2 font-medium tracking-wide border-r border-border/30"
                            sortColumn={sortColumn}
                            sortDirection={sortDirection}
                            sortKey="PERPLEXITY"
                            onSort={handleSort}
                            title="Perplexity"
                        >
                            PERPLEXITY
                        </AnalysisColumnHeader>
                        )}
                        {analysisColumnVisible('gpt') && (
                        <AnalysisColumnHeader
                            columnKey="gpt" resizeHandle={controls.resizeHandle('gpt')}
                            className="analysis-model-score-header text-center pb-2 font-medium tracking-wide border-r border-border/30"
                            sortColumn={sortColumn}
                            sortDirection={sortDirection}
                            sortKey="GPT"
                            onSort={handleSort}
                            title="GPT"
                        >
                            GPT
                        </AnalysisColumnHeader>
                        )}
                        {analysisColumnVisible('claude') && (
                        <AnalysisColumnHeader
                            columnKey="claude" resizeHandle={controls.resizeHandle('claude')}
                            className="analysis-model-score-header text-center pb-2 font-medium tracking-wide border-r border-border/30"
                            sortColumn={sortColumn}
                            sortDirection={sortDirection}
                            sortKey="CLAUDE"
                            onSort={handleSort}
                            title="Claude"
                        >
                            CLAUDE
                        </AnalysisColumnHeader>
                        )}
                        {analysisColumnVisible('tvPt') && (
                        <th data-column-key="tvPt" className="analysis-model-score-header text-center pb-2 font-medium tracking-wide border-r border-border/30">
                            TV PT
                            {controls.resizeHandle('tvPt')}
                        </th>
                        )}
                    </>
                )}
                {analysisColumnVisible('signal') && (
                <th data-column-key="signal" className="text-center pb-2 font-medium tracking-wide border-r border-border/30">
                    SIGNAL
                    {controls.resizeHandle('signal')}
                </th>
                )}
                {analysisColumnVisible('thesisDrift') && (
                <th data-column-key="thesisDrift"
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    title="Announcement-router thesis drift. It adjusts Target Weight only, never Total."
                >
                    THESIS Δ
                    {controls.resizeHandle('thesisDrift')}
                </th>
                )}
                {analysisColumnVisible('suggestedAllocation') && (
                <AnalysisColumnHeader
                    columnKey="suggestedAllocation" resizeHandle={controls.resizeHandle('suggestedAllocation')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="SUGGESTED_ALLOCATION"
                    onSort={handleSort}
                    title="Sort by suggested allocation"
                >
                    TARGET WT
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('classPercent') && (
                <th data-column-key="classPercent" className="text-center pb-2 font-medium tracking-wide border-r border-border/30">
                    CLASS %
                    {controls.resizeHandle('classPercent')}
                </th>
                )}
                {analysisColumnVisible('performance6m') && (
                <AnalysisColumnHeader
                    columnKey="performance6m" resizeHandle={controls.resizeHandle('performance6m')}
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    sortKey="PERFORMANCE_6M"
                    onSort={handleSort}
                    title="Six-month adjusted-close return for stocks and ETFs"
                >
                    MOM
                </AnalysisColumnHeader>
                )}
                {analysisColumnVisible('modelIncluded') && (
                <th data-column-key="modelIncluded"
                    className="text-center pb-2 font-medium tracking-wide border-r border-border/30"
                    title="Whether this security participates in target-weight sizing"
                >
                    ACTIVE
                    {controls.resizeHandle('modelIncluded')}
                </th>
                )}
                {analysisColumnVisible('chart') && (
                <th data-column-key="chart"
                    className={`text-center pb-2 font-medium tracking-wide ${
                        ratingsExpanded ? '' : 'border-r border-border/30'
                    }`}
                >
                    CHART
                    {controls.resizeHandle('chart')}
                </th>
                )}
                {!ratingsExpanded && notesExpanded && (
                    <>
                        {analysisColumnVisible('thesis') && (
                        <th data-column-key="thesis"
                            className="analysis-model-score-header text-left px-2 pb-2 font-medium tracking-wide border-r border-border/30"
                        >
                            THESIS
                            {controls.resizeHandle('thesis')}
                        </th>
                        )}
                        {analysisColumnVisible('nextCatalyst') && (
                        <th data-column-key="nextCatalyst"
                            className="analysis-model-score-header text-left px-2 pb-2 font-medium tracking-wide"
                        >
                            NEXT CATALYST
                            {controls.resizeHandle('nextCatalyst')}
                        </th>
                        )}
                    </>
                )}
            </tr>
        )}
    >
            {(() => {
                type AnalysisStock =
                    (typeof sortedStocks)[number];
                const targetWeightForStock = (stock: AnalysisStock) => {
                    if (!isStockEligibleForSizing(stock)) return -1;
                    return getAllocation(stock)?.percent ?? 0;
                };
                const analysisSourceStocks = showNonAllocatingInstruments
                    ? [...sortedStocks, ...nonAllocatingStocks]
                    : sortedStocks;
                const rankedAnalysisStocks = sortColumn
                    ? [...analysisSourceStocks]
                    : [...analysisSourceStocks].sort((a, b) => {
                        const weightDelta = targetWeightForStock(b) - targetWeightForStock(a);
                        if (Math.abs(weightDelta) > 0.001) return weightDelta;
                        const scoreDelta = (calculateAverageCompletedModelScore(b) ?? 0) - (calculateAverageCompletedModelScore(a) ?? 0);
                        if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
                        return (a.name || '').localeCompare(b.name || '');
                    });
                const analysisStocks = rankedAnalysisStocks.sort((a, b) => {
                    const aIsEtf = isAnalysisEtf(a);
                    const bIsEtf = isAnalysisEtf(b);
                    if (aIsEtf !== bIsEtf) return aIsEtf ? -1 : 1;
                    return 0;
                });
                const visibleAnalysisStocks = analysisStocks.filter(
                    (stock) =>
                        (!analysisEtfsHidden || !isAnalysisEtf(stock)) &&
                        (!analysisMissingExchangeOnly || !getAnalysisExchangeCode(stock)) &&
                        (!analysisMissingResearchOnly || hasMissingSizingResearch(stock)) &&
                        matchesAnalysisSearch(stock, analysisSearch),
                );
                const renderRow = (
                    stock: AnalysisStock,
                ) => {
                    const isEtf = isAnalysisEtf(stock);
                    const isNonAllocating = isNonAllocatingSecurityType(
                        stock.securityType,
                    );
                    const avgPT =
                        calculateAveragePriceTarget(stock);
                    const momentumModifier = calculateAnalysisMomentumModifier(
                        stock.performance6MPct,
                    );

                    // Calculate upside as (Avg PT - Price) / Price * 100
                    const upsidePercent =
                        avgPT > 0 && stock.price > 0
                            ? ((avgPT - stock.price) /
                                  stock.price) *
                              100
                            : 0;
                    const modelRuns = getAnalysisModelRuns(stock);
                    const qualityScore = calculateAverageCompletedModelField(stock, 'quality');
                    const valueScore = calculateAverageCompletedModelField(stock, 'value');
                    const modelCompletion = getAnalysisModelCompletion(stock);
                    const completionState = getAnalysisCompletionState(modelCompletion);
                    const targetAllocation = getAllocation(stock);
                    const routerSizing = backendAllocations.get(stock.id);
                    const routerScore = routerSizing?.router_score;
                    const routerMultiplier = routerSizing?.router_multiplier;
                    const exchangeCode = getAnalysisExchangeCode(stock);

                    const geminiScore = calculateAnalysisProviderScore(stock, 'gemini');
                    const gptScore = calculateAnalysisProviderScore(stock, 'gpt');
                    const perplexityScore = calculateAnalysisProviderScore(stock, 'perplexity');
                    const claudeScore = calculateAnalysisProviderScore(stock, 'claude');

                    const totalScore = calculateBaseRatingTotal(stock);
                    const completionCopy =
                        completionState === 'not-run'
                            ? ''
                            : completionState === 'early'
                              ? 'Early'
                              : completionState === 'provisional'
                                ? 'Provisional'
                                : 'Final';
                    const renderAggregateScoreCell = (score: number | null, metric: string) => {
                        if (isEtf) {
                            return (
                                <td
                                    className="analysis-score-cell px-2 border-r border-border/30"
                                    title="ETF: stock Quality and Value scoring does not apply."
                                >
                                    <span className="analysis-score-empty font-mono">-</span>
                                </td>
                            );
                        }
                        // Expand the useful scoring range: 30 maps to an empty
                        // bar and 100 to full width, without altering the score.
                        const scorePct =
                            score == null
                                ? 0
                                : Math.max(0, Math.min(100, ((score - 30) / 70) * 100));
                        return (
                            <td
                                className={`analysis-score-cell analysis-score-state-${completionState} px-2 border-r border-border/30`}
                                title={`${modelCompletion.completed}/${modelCompletion.total} model runs complete${completionCopy ? ` (${completionCopy})` : ''}`}
                            >
                                <button
                                    type="button"
                                    className="analysis-score-summary"
                                    aria-label={`${expandedAnalysisRowId === stock.id ? 'Collapse' : 'Expand'} research for ${stock.name} from ${metric}`}
                                    aria-expanded={expandedAnalysisRowId === stock.id}
                                    aria-controls={`analysis-research-${stock.id}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        expandedAnalysisTriggerRef.current = event.currentTarget;
                                        setExpandedAnalysisRowId((current) =>
                                            current === stock.id ? null : stock.id,
                                        );
                                    }}
                                >
                                    <span
                                        className={`analysis-score-inline${score == null ? ' is-empty' : ''}`}
                                    >
                                        {score == null ? (
                                            <span className="analysis-score-empty font-mono">-</span>
                                        ) : (
                                            <span
                                                className="analysis-score-number"
                                                style={{ color: scoreColor(score) }}
                                            >
                                                {formatAnalysisScore(score)}
                                            </span>
                                        )}
                                    </span>
                                    {score != null && (
                                        <span className="analysis-score-bar" aria-hidden="true">
                                            <span
                                                className="analysis-score-bar-fill"
                                                style={{
                                                    width: `${scorePct}%`,
                                                    backgroundColor: scoreBarColor(score),
                                                }}
                                            />
                                        </span>
                                    )}
                                </button>
                            </td>
                        );
                    };
                    return (
                        <React.Fragment key={stock.id}>
                            <tr
                                className={`analysis-stock-row group border-b${stock.isWatchlist && !stock.isExternal ? ' is-watchlist' : ''}${getStockRegimes(stock).includes('ETF') ? ' is-etf' : ''}${expandedAnalysisRowId === stock.id ? ' is-expanded' : ''}`}
                                tabIndex={isEtf ? undefined : !analysisColumnVisible('quality') && !analysisColumnVisible('value') ? 0 : -1}
                                onKeyDown={event => {
                                    if (isEtf || event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                                    event.preventDefault();
                                    expandedAnalysisTriggerRef.current = event.currentTarget;
                                    setExpandedAnalysisRowId(current => current === stock.id ? null : stock.id);
                                }}
                                onClickCapture={() => useContextPanelStore.getState().selectSecurity(`${stock.prefix || ''}${stock.symbol}`)}
                                onClick={(event) => {
                                    if (isEtf) return;
                                    const target = event.target as HTMLElement | null;
                                    if (
                                        target?.closest(
                                            'button,a,input,textarea,label,[data-inline-edit-root="true"],[data-analysis-row-interactive="true"]',
                                        )
                                    ) {
                                        return;
                                    }
                                    expandedAnalysisTriggerRef.current = event.currentTarget;
                                    setExpandedAnalysisRowId((current) =>
                                        current === stock.id ? null : stock.id,
                                    );
                                }}
                            >
                                <td
                                    className="analysis-name-cell px-2 border-r border-border/30"
                                    style={{
                                        maxWidth: 'none',
                                    }}
                                    onMouseLeave={() => setTickerRailOpen(false)}
                                    onPointerLeave={() => setTickerRailOpen(false)}
                                >
                                    {tickerRevealEnabled && (
                                        <span
                                            className="analysis-name-ticker-hover-zone"
                                            title="Reveal ticker"
                                            aria-hidden="true"
                                            onClick={() => setTickerRailOpen(true)}
                                            onMouseEnter={() => setTickerRailOpen(true)}
                                            onMouseMove={() => setTickerRailOpen(true)}
                                            onPointerEnter={() => setTickerRailOpen(true)}
                                            onPointerMove={() => setTickerRailOpen(true)}
                                        />
                                    )}
                                    <div className="analysis-name-stack">
                                        <div className="analysis-name-primary">
                                            {hasCouncilResearchPanelContent(stock) ? (
                                                <button
                                                    type="button"
                                                    className="analysis-row-expander"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setShowResearchPanel((prev) => ({
                                                            ...prev,
                                                            [stock.symbol || stock.name]: !prev[
                                                                stock.symbol || stock.name
                                                            ],
                                                        }));
                                                    }}
                                                    title={
                                                        showResearchPanel[
                                                            stock.symbol || stock.name
                                                        ]
                                                            ? 'Collapse research panel'
                                                            : 'Expand research panel'
                                                    }
                                                >
                                                    {showResearchPanel[
                                                        stock.symbol || stock.name
                                                    ]
                                                        ? '▼'
                                                        : '▶'}
                                                </button>
                                            ) : (
                                                <span
                                                    className="analysis-row-expander-placeholder"
                                                    aria-hidden="true"
                                                />
                                            )}
                                            <span className="analysis-connection-lane">
                                                {stock.symbol ? (
                                                    <AlertStatusIndicator
                                                        ticker={`${stock.prefix || ''}${stock.symbol}`}
                                                        mode="analysis"
                                                        securityType={stock.securityType}
                                                        outperformBenchmark={monitoringBenchmarks
                                                            ? monitoringBenchmarks.get(stock.primaryAssetClass?.trim().toUpperCase() || '') ?? null
                                                            : undefined}
                                                    />
                                                ) : (
                                                    <div
                                                        className="inline-flex items-center justify-center"
                                                        title="No ticker"
                                                    >
                                                        <div
                                                            className="bg-muted/50"
                                                            style={
                                                                analysisAlertOvalStyle
                                                            }
                                                        />
                                                    </div>
                                                )}
                                            </span>
                                            {tickerRevealEnabled && (
                                                <span
                                                    className={`analysis-ticker-rail ${
                                                        showTickerEdit[stock.id]
                                                            ? 'is-editing'
                                                            : ''
                                                    }`}
                                                >
                                                    <span className="analysis-ticker-cell">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                toggleTickerEdit(
                                                                    stock.id,
                                                                )
                                                            }
                                                            className={`analysis-row-ticker min-w-0 cursor-pointer truncate hover:text-primary ${
                                                                stock.symbol
                                                                    ? ''
                                                                    : 'text-muted-foreground/40'
                                                            }`}
                                                            title={
                                                                stock.symbol
                                                                    ? 'Click to edit ticker'
                                                                    : 'Click to add ticker'
                                                            }
                                                        >
                                                            {stock.symbol ||
                                                                'add'}
                                                        </button>
                                                        {stock.isExternal && (
                                                            <span className="analysis-inline-badge is-ext">
                                                                EXT
                                                            </span>
                                                        )}
                                                    </span>
                                                </span>
                                            )}
                                            <span className="analysis-name-content flex-1">
                                                <span className={`analysis-company-identity${exchangeCode ? '' : ' has-exchange-warning'}`}>
                                                <button
                                                    onClick={() =>
                                                        toggleNameEdit(
                                                            stock.id,
                                                        )
                                                    }
                                                    className="analysis-company-name hover:text-primary text-left truncate cursor-pointer"
                                                    title={
                                                        exchangeCode
                                                            ? `${stock.name} · ${exchangeCode} · ${stock.symbol || 'No ticker'}`
                                                            : `${stock.name} · Exchange assignment is required`
                                                    }
                                                >
                                                    {stock.name}
                                                </button>
                                                {!exchangeCode && <button
                                                    type="button"
                                                    className="analysis-exchange-warning"
                                                    aria-label={`Set exchange for ${stock.name}`}
                                                    title="Exchange missing. Click to set."
                                                    onClick={(e) => { e.stopPropagation(); togglePrefixEdit(stock.id); }}
                                                ><span aria-hidden="true">!</span></button>}
                                                </span>
                                                {stock.isWatchlist && !stock.isExternal && (
                                                    <span className="analysis-watchlist-indicator" title="Watchlist">
                                                        <Eye className="analysis-stock-type-icon is-watch" size={11} aria-hidden="true" />
                                                    </span>
                                                )}
                                                {isNonAllocating && (
                                                    <button
                                                        type="button"
                                                        className="analysis-security-type-toggle is-non-allocating"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            toggleNonAllocatingInstrument(
                                                                stock,
                                                            );
                                                        }}
                                                        disabled={
                                                            securityTypeUpdating[stock.id] || nonAllocatingUpdating[stock.id]
                                                        }
                                                        aria-label="Return instrument to strategy"
                                                        title="Return to strategy"
                                                    >
                                                        <RotateCcw size={11} aria-hidden="true" />
                                                    </button>
                                                )}
                                                {!isNonAllocating && <button
                                                    type="button"
                                                    className={`analysis-security-type-toggle ${
                                                        isEtf ? 'is-etf' : ''
                                                    }`}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void toggleAnalysisEtf(stock);
                                                    }}
                                                    disabled={securityTypeUpdating[stock.id] || nonAllocatingUpdating[stock.id]}
                                                    aria-label={
                                                        isEtf
                                                            ? 'Remove ETF flag'
                                                            : 'Mark as ETF'
                                                    }
                                                    aria-pressed={isEtf}
                                                    title={
                                                        isEtf
                                                            ? 'Remove ETF flag'
                                                            : 'Mark as ETF'
                                                    }
                                                >
                                                    <TrendingUp size={11} aria-hidden="true" />
                                                </button>}
                                                {!isNonAllocating && <button
                                                    type="button"
                                                    className="analysis-security-type-toggle is-archive"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        toggleNonAllocatingInstrument(stock);
                                                    }}
                                                    disabled={securityTypeUpdating[stock.id] || nonAllocatingUpdating[stock.id]}
                                                    aria-label={`Archive ${stock.name}`}
                                                    title="Archive from strategy"
                                                >
                                                    <Archive size={11} aria-hidden="true" />
                                                </button>}
                                                {exchangeCode && <button
                                                    type="button"
                                                    className="analysis-exchange-tag is-assigned cursor-pointer hover:text-primary"
                                                    aria-label={`Edit exchange for ${stock.name}`}
                                                    title={`Exchange: ${exchangeCode}. Click to edit.`}
                                                    onClick={(e) => { e.stopPropagation(); togglePrefixEdit(stock.id); }}
                                                >
                                                    {exchangeCode}
                                                </button>}
                                                {!isNonAllocating && <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        startBuyFlow(stock);
                                                    }}
                                                    className="shrink-0 rounded-[3px] border border-primary/35 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-100"
                                                    title="Open buy ledger"
                                                >
                                                    Buy
                                                </button>}
                                            </span>
                                        </div>
                                        {nonAllocatingErrors[stock.id] && <span className="analysis-archive-error" role="alert">{nonAllocatingErrors[stock.id]}</span>}
                                        {showTickerEdit[stock.id] && (
                                            <div
                                                className="analysis-inline-editor analysis-inline-editor-ticker text-xs"
                                                data-inline-edit-root="true"
                                            >
                                                <label className="analysis-inline-field">
                                                    <span className="analysis-inline-field-label">
                                                        Exchange
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={prefixInput}
                                                        onChange={(e) =>
                                                            setPrefixInput(
                                                                e.target.value.toUpperCase(),
                                                            )
                                                        }
                                                        className="w-full font-mono uppercase"
                                                        placeholder="ASX"
                                                    />
                                                </label>
                                                <label className="analysis-inline-field">
                                                    <span className="analysis-inline-field-label">
                                                        Ticker
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={tickerInput}
                                                        onChange={(e) =>
                                                            setTickerInput(
                                                                e.target.value.toUpperCase(),
                                                            )
                                                        }
                                                        className="w-full font-mono uppercase"
                                                        placeholder="BML"
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter')
                                                                handleTickerSave(stock);
                                                            if (e.key === 'Escape')
                                                                handleTickerCancel(stock.id);
                                                        }}
                                                    />
                                                </label>
                                                <div className="analysis-inline-actions">
                                                    <button
                                                        onClick={() => handleTickerSave(stock)}
                                                        className="text-primary hover:text-primary/80"
                                                    >
                                                        ✓
                                                    </button>
                                                    <button
                                                        onClick={() => handleTickerCancel(stock.id)}
                                                        className="text-destructive hover:text-destructive"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {/* Exchange prefix edit */}
                                        {showPrefixEdit[stock.id] && (
                                            <div
                                                className="analysis-inline-editor analysis-inline-editor-ticker text-xs"
                                                data-inline-edit-root="true"
                                            >
                                                <label className="analysis-inline-field">
                                                    <span className="analysis-inline-field-label">Exchange</span>
                                                    <input
                                                        type="text"
                                                        value={prefixInput}
                                                        onChange={(e) => setPrefixInput(e.target.value.toUpperCase())}
                                                        className="w-full font-mono uppercase"
                                                        placeholder="ASX"
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handlePrefixSave(stock);
                                                            if (e.key === 'Escape') handlePrefixCancel(stock.id);
                                                        }}
                                                    />
                                                </label>
                                                <div className="analysis-inline-actions">
                                                    <button aria-label="Save exchange" onClick={() => handlePrefixSave(stock)} className="text-primary hover:text-primary/80">✓</button>
                                                    <button aria-label="Cancel exchange edit" onClick={() => handlePrefixCancel(stock.id)} className="text-destructive hover:text-destructive">✕</button>
                                                </div>
                                            </div>
                                        )}
                                        {/* Name edit — watchlist and external items */}
                                        {showNameEdit[
                                            stock.id
                                        ] && (
                                            <div
                                                className="analysis-inline-editor analysis-inline-editor-name flex-col items-stretch text-xs"
                                                data-inline-edit-root="true"
                                            >
                                                <div className="flex items-start gap-2">
                                                    <label className="analysis-inline-field">
                                                        <span className="analysis-inline-field-label">
                                                            Name
                                                        </span>
                                                        <input
                                                            type="text"
                                                            value={
                                                                nameInputs[
                                                                    stock
                                                                        .id
                                                                ] ||
                                                                ''
                                                            }
                                                            onChange={(
                                                                e,
                                                            ) =>
                                                                setNameInputs(
                                                                    (
                                                                        prev,
                                                                    ) => ({
                                                                        ...prev,
                                                                        [stock.id]:
                                                                            e
                                                                                .target
                                                                                .value,
                                                                    }),
                                                                )
                                                            }
                                                            disabled={
                                                                !!nameSaving[
                                                                    stock
                                                                        .id
                                                                ]
                                                            }
                                                            className="w-full"
                                                            placeholder="Company name"
                                                            autoFocus
                                                            onKeyDown={(
                                                                e,
                                                            ) => {
                                                                if (
                                                                    e.key ===
                                                                    'Enter'
                                                                )
                                                                    handleNameSave(
                                                                        stock,
                                                                    );
                                                                if (
                                                                    e.key ===
                                                                    'Escape'
                                                                )
                                                                    handleNameCancel(
                                                                        stock.id,
                                                                    );
                                                            }}
                                                        />
                                                    </label>
                                                    <div className="analysis-inline-actions">
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                !!nameSaving[
                                                                    stock
                                                                        .id
                                                                ]
                                                            }
                                                            onClick={() =>
                                                                handleNameSave(
                                                                    stock,
                                                                )
                                                            }
                                                            className="text-primary hover:text-primary/80 px-1 disabled:opacity-40"
                                                        >
                                                            {nameSaving[
                                                                stock
                                                                    .id
                                                            ]
                                                                ? '…'
                                                                : '✓'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                !!nameSaving[
                                                                    stock
                                                                        .id
                                                                ]
                                                            }
                                                            onClick={() =>
                                                                handleNameCancel(
                                                                    stock.id,
                                                                )
                                                            }
                                                            className="text-destructive hover:text-destructive px-1 disabled:opacity-40"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                </div>
                                                {nameErrors[
                                                    stock.id
                                                ] && (
                                                    <div className="max-w-[170px] text-[10px] leading-tight text-destructive">
                                                        {
                                                            nameErrors[
                                                                stock
                                                                    .id
                                                            ]
                                                        }
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleExternalToggle(
                                                            stock,
                                                        )
                                                    }
                                                    className="w-fit border px-2 py-1 text-left font-mono text-[10px] transition-colors"
                                                    style={
                                                        stock.isExternal
                                                            ? {
                                                                  color: 'var(--signal-warn)',
                                                                  borderColor:
                                                                      'var(--signal-warn)',
                                                                  backgroundColor:
                                                                      'rgba(212,160,23,0.12)',
                                                              }
                                                            : {
                                                                  color: 'var(--muted-foreground)',
                                                                  borderColor:
                                                                      'var(--analysis-editor-border)',
                                                                  backgroundColor:
                                                                      'transparent',
                                                              }
                                                    }
                                                >
                                                    {stock.isExternal
                                                        ? 'External holding'
                                                        : 'Mark external'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </td>

                                {/* ASSET CLASS Column */}
                                {analysisColumnVisible('assetClass') && (
                                <td className="analysis-popover-cell px-2 border-r border-border/30">
                                    <div className="relative min-w-0">
                                        <button
                                            onClick={(e) =>
                                                toggleAssetClassDropdown(
                                                    stock.id,
                                                    e,
                                                )
                                            }
                                            className={`analysis-asset-class-button block w-full min-w-0 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border border-transparent px-1 py-0.5 text-left hover:border-border hover:bg-muted/30 focus:border-border focus:bg-muted/20 focus:outline-none ${
                                                getStockAssetClassCode(stock) === 'UNASSIGNED'
                                                    ? 'is-unassigned'
                                                    : ''
                                            }`}
                                        >
                                            {getStockAssetClassCode(
                                                stock,
                                            ) !==
                                            'UNASSIGNED' ? (
                                                <span className="block max-w-full truncate font-mono">
                                                    {formatAssetClassLabel(
                                                        getStockAssetClassCode(
                                                            stock,
                                                        ),
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="block max-w-full truncate">
                                                    + Assign
                                                </span>
                                            )}
                                        </button>
                                        {showAssetClassDropdown[
                                            stock.id
                                        ] && (
                                            <>
                                                <div
                                                    className="fixed inset-0 z-10"
                                                    onClick={(
                                                        e,
                                                    ) => {
                                                        e.stopPropagation();
                                                        setShowAssetClassDropdown(
                                                            {},
                                                        );
                                                        setAssetClassSearch(
                                                            '',
                                                        );
                                                    }}
                                                />
                                                <div
                                                    className={`absolute left-0 z-50 min-w-[190px] border border-border bg-popover text-popover-foreground shadow-xl ${
                                                        dropdownPosition[
                                                            `asset-class-${stock.id}`
                                                        ] ===
                                                        'above'
                                                            ? 'bottom-full mb-1'
                                                            : 'top-full mt-1'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between border-b border-border/50 px-2 py-1.5">
                                                        <input
                                                            autoFocus
                                                            value={
                                                                assetClassSearch
                                                            }
                                                            onChange={(
                                                                e,
                                                            ) =>
                                                                setAssetClassSearch(
                                                                    e
                                                                        .target
                                                                        .value,
                                                                )
                                                            }
                                                            onClick={(
                                                                e,
                                                            ) =>
                                                                e.stopPropagation()
                                                            }
                                                            onKeyDown={(
                                                                e,
                                                            ) => {
                                                                if (
                                                                    e.key ===
                                                                    'Escape'
                                                                ) {
                                                                    e.preventDefault();
                                                                    setShowAssetClassDropdown(
                                                                        {},
                                                                    );
                                                                    setAssetClassSearch(
                                                                        '',
                                                                    );
                                                                    return;
                                                                }
                                                                if (
                                                                    e.key ===
                                                                        'Enter' &&
                                                                    filteredAnalysisAssetClassOptions[0]
                                                                ) {
                                                                    e.preventDefault();
                                                                    handleAssetClassUpdate(
                                                                        stock,
                                                                        filteredAnalysisAssetClassOptions[0],
                                                                    );
                                                                }
                                                            }}
                                                            placeholder="ASSET CLASS"
                                                            className="min-w-0 flex-1 bg-transparent text-[10px] font-bold uppercase tracking-wide text-foreground outline-none placeholder:text-muted-foreground"
                                                        />
                                                        <button
                                                            onClick={(
                                                                e,
                                                            ) => {
                                                                e.stopPropagation();
                                                                setShowAssetClassDropdown(
                                                                    {},
                                                                );
                                                                setAssetClassSearch(
                                                                    '',
                                                                );
                                                            }}
                                                            className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                    <div className="max-h-96 space-y-0.5 overflow-y-auto p-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleAssetClassUpdate(
                                                                    stock,
                                                                    null,
                                                                )
                                                            }
                                                            className="flex w-full cursor-pointer items-center justify-between px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                                                        >
                                                            <span>
                                                                Clear
                                                            </span>
                                                            {getStockAssetClassCode(
                                                                stock,
                                                            ) ===
                                                                'UNASSIGNED' && (
                                                                <span>
                                                                    ✓
                                                                </span>
                                                            )}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                Boolean(
                                                                    assetClassClassifying[
                                                                        stock
                                                                            .id
                                                                    ],
                                                                )
                                                            }
                                                            onClick={() =>
                                                                handleAssetClassClassify(
                                                                    stock,
                                                                )
                                                            }
                                                            className="flex w-full cursor-pointer items-center justify-between px-2 py-1.5 text-left text-xs text-primary hover:bg-muted/30 disabled:cursor-wait disabled:opacity-60"
                                                        >
                                                            <span>
                                                                {assetClassClassifying[
                                                                    stock
                                                                        .id
                                                                ]
                                                                    ? 'Auto-assigning...'
                                                                    : 'Auto-assign'}
                                                            </span>
                                                        </button>
                                                        {assetClassClassifyError[
                                                            stock.id
                                                        ] && (
                                                            <div className="px-2 py-1 text-[10px] leading-snug text-destructive">
                                                                {
                                                                    assetClassClassifyError[
                                                                        stock
                                                                            .id
                                                                    ]
                                                                }
                                                            </div>
                                                        )}
                                                        {filteredAnalysisAssetClassOptions.map(
                                                            (
                                                                assetClassCode,
                                                            ) => {
                                                                const isSelected =
                                                                    getStockAssetClassCode(
                                                                        stock,
                                                                    ) ===
                                                                    assetClassCode;

                                                                return (
                                                                    <button
                                                                        key={
                                                                            assetClassCode
                                                                        }
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleAssetClassUpdate(
                                                                                stock,
                                                                                assetClassCode,
                                                                            )
                                                                        }
                                                                        className="flex w-full cursor-pointer items-center justify-between px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted/30"
                                                                    >
                                                                        <span className="font-mono">
                                                                            {formatAssetClassLabel(
                                                                                assetClassCode,
                                                                            )}
                                                                        </span>
                                                                        {isSelected && (
                                                                            <span className="text-primary">
                                                                                ✓
                                                                            </span>
                                                                        )}
                                                                    </button>
                                                                );
                                                            },
                                                        )}
                                                        {filteredAnalysisAssetClassOptions.length ===
                                                            0 && (
                                                            <div className="px-2 py-2 text-xs text-muted-foreground">
                                                                No matching asset class
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </td>
                                )}

                                {analysisColumnVisible('price') && (
                                <td className="text-center px-2 font-mono text-foreground border-r border-border/30">
                                    $
                                    {(
                                        stock.price || 0
                                    ).toFixed(2)}
                                </td>
                                )}

                                {/* Average target at rest; upside percentage on hover. */}
                                {analysisColumnVisible('avgPt') && (
                                <td
                                    className="analysis-upside-cell text-center px-2 border-r border-border/30"
                                    title={
                                        !isEtf && avgPT > 0 && stock.price > 0
                                            ? `Average target $${avgPT < 1 ? avgPT.toFixed(3) : avgPT.toFixed(2)} · ${upsidePercent >= 0 ? '+' : ''}${upsidePercent.toFixed(1)}% upside`
                                            : undefined
                                    }
                                >
                                    {!isEtf && avgPT > 0 ? (
                                        <span className="analysis-upside-display">
                                            <span className="analysis-upside-target">
                                                ${avgPT < 1 ? avgPT.toFixed(3) : avgPT.toFixed(2)}
                                            </span>
                                            {stock.price > 0 && (
                                                <span
                                                    className={`analysis-upside-percent analysis-upside-percent--${targetUpsideTone(upsidePercent)}`}
                                                >
                                                    {upsidePercent >= 0 ? '+' : ''}{upsidePercent.toFixed(1)}%
                                                </span>
                                            )}
                                        </span>
                                    ) : (
                                        <span className="analysis-score-empty font-mono">-</span>
                                    )}
                                </td>
                                )}

                                {analysisColumnVisible('performance12m') && (
                                <td
                                    className={`text-right px-2 font-mono border-r border-border/30 ${analysisPerformanceToneClass(
                                        stock.performance12MPct,
                                    )} ${stalePerformanceClass(stock.performanceAsOf)}`}
                                    title={
                                        stock.performanceAsOf
                                            ? `Adjusted close return to ${stock.performanceAsOf}${isStalePerformance(stock.performanceAsOf) ? ' (stale — >5 days old)' : ''}`
                                            : 'Insufficient adjusted price history'
                                    }
                                >
                                    {(() => {
                                        const performance = isEtf
                                            ? '-'
                                            : formatAnalysisPerformancePct(
                                                  stock.performance12MPct,
                                              );
                                        return performance === '-' ? (
                                            <span className="analysis-score-empty font-mono">-</span>
                                        ) : (
                                            performance
                                        );
                                    })()}
                                </td>
                                )}
                                {analysisColumnVisible('quality') &&
                                    renderAggregateScoreCell(qualityScore, 'Quality')}
                                {analysisColumnVisible('value') &&
                                    renderAggregateScoreCell(valueScore, 'Value')}
                                {analysisColumnVisible('total') && (
                                <td
                                    className={`text-center px-2 border-r border-border/30 analysis-score-state-${completionState}`}
                                    title={
                                        isEtf
                                            ? 'ETF: stock ratings total does not apply.'
                                            : `${modelCompletion.completed}/${modelCompletion.total} model runs complete${completionCopy ? ` (${completionCopy})` : ''}. Momentum is applied only to Target Weight.`
                                    }
                                >
                                    {!isEtf && totalScore > 0 ? (
                                        <span
                                            className="font-mono text-xs font-semibold"
                                            style={{ color: scoreColor(totalScore) }}
                                        >
                                            {totalScore.toFixed(1)}
                                        </span>
                                    ) : (
                                        <span className="analysis-score-empty font-mono">-</span>
                                    )}
                                </td>
                                )}
                                {analysisColumnVisible('council') && (
                                <td className="analysis-council-cell analysis-popover-cell text-center px-1 border-r border-border/30">
                                    {isEtf ? (
                                        <span
                                            className="analysis-score-empty font-mono"
                                            title="ETF: Council scoring does not apply."
                                        >
                                            -
                                        </span>
                                    ) : renderCouncilControls(stock)}
                                </td>
                                )}

                                {ratingsExpanded && (
                                    <>
                                        {/* GEMINI Column */}
                                        <td className="analysis-model-score-cell text-center px-2 border-r border-border/30">
                                            <div className="flex flex-col items-center gap-1">
                                                <button
                                                    disabled={isEtf}
                                                    onClick={(e) => {
                                                        if (isEtf) return;
                                                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                        setModelPopover(prev =>
                                                            prev?.model === 'gemini' && prev.stock.symbol === stock.symbol
                                                                ? null
                                                                : { model: 'gemini', stock, top: r.bottom + 4, left: r.left + r.width / 2 }
                                                        );
                                                    }}
                                                    className={`analysis-model-button cursor-pointer hover:text-primary ${
                                                        isEtf || (!stock.geminiQuality && !stock.geminiValue)
                                                            ? 'is-empty'
                                                            : 'has-score'
                                                    }`}
                                                    title="Open Gemini score, source text, and input date"
                                                >
                                                    {isEtf ? '-' : geminiScore?.toFixed(1) ?? '-'}
                                                </button>
                                                {!isEtf && <ModelSourceStamp
                                                    inputAt={stock.geminiWebuiInputAt}
                                                    hasModelValues={Boolean(
                                                        stock.geminiQuality ||
                                                            stock.geminiValue ||
                                                            stock.geminiPT ||
                                                            stock.geminiWebuiOutput,
                                                    )}
                                                />}
                                            </div>
                                        </td>

                                        {/* PERPLEXITY Column */}
                                        <td className="analysis-model-score-cell text-center px-2 border-r border-border/30">
                                            <div className="flex flex-col items-center gap-1">
                                                <button
                                                    disabled={isEtf}
                                                    onClick={(e) => {
                                                        if (isEtf) return;
                                                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                        setModelPopover(prev =>
                                                            prev?.model === 'perplexity' && prev.stock.symbol === stock.symbol
                                                                ? null
                                                                : { model: 'perplexity', stock, top: r.bottom + 4, left: r.left + r.width / 2 }
                                                        );
                                                    }}
                                                    className={`analysis-model-button cursor-pointer hover:text-primary ${
                                                        isEtf || (!stock.perplexityQuality && !stock.perplexityValue)
                                                            ? 'is-empty'
                                                            : 'has-score'
                                                    }`}
                                                    title="Open Perplexity score, source text, and input date"
                                                >
                                                    {isEtf ? '-' : perplexityScore?.toFixed(1) ?? '-'}
                                                </button>
                                                {!isEtf && <ModelSourceStamp
                                                    inputAt={stock.perplexityWebuiInputAt}
                                                    hasModelValues={Boolean(
                                                        stock.perplexityQuality ||
                                                            stock.perplexityValue ||
                                                            stock.perplexityPT ||
                                                            stock.perplexityWebuiOutput,
                                                    )}
                                                />}
                                            </div>
                                        </td>

                                        {/* GPT Column */}
                                        <td className="analysis-model-score-cell text-center px-2 border-r border-border/30">
                                            <div className="flex flex-col items-center gap-1">
                                                <button
                                                    disabled={isEtf}
                                                    onClick={(e) => {
                                                        if (isEtf) return;
                                                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                        setModelPopover(prev =>
                                                            prev?.model === 'gpt' && prev.stock.symbol === stock.symbol
                                                                ? null
                                                                : { model: 'gpt', stock, top: r.bottom + 4, left: r.left + r.width / 2 }
                                                        );
                                                    }}
                                                    className={`analysis-model-button cursor-pointer hover:text-primary ${
                                                        isEtf || (!stock.gptQuality && !stock.gptValue)
                                                            ? 'is-empty'
                                                            : 'has-score'
                                                    }`}
                                                    title="Open GPT score, source text, and input date"
                                                >
                                                    {isEtf ? '-' : gptScore?.toFixed(1) ?? '-'}
                                                </button>
                                                {!isEtf && <ModelSourceStamp
                                                    inputAt={stock.gptWebuiInputAt}
                                                    hasModelValues={Boolean(
                                                        stock.gptQuality ||
                                                            stock.gptValue ||
                                                            stock.gptPT ||
                                                            stock.gptWebuiOutput,
                                                    )}
                                                />}
                                            </div>
                                        </td>

                                        {/* CLAUDE Column */}
                                        <td className="analysis-model-score-cell text-center px-2 border-r border-border/30">
                                            <div className="flex flex-col items-center gap-1">
                                                <button
                                                    disabled={isEtf}
                                                    onClick={(e) => {
                                                        if (isEtf) return;
                                                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                        setModelPopover(prev =>
                                                            prev?.model === 'claude' && prev.stock.symbol === stock.symbol
                                                                ? null
                                                                : { model: 'claude', stock, top: r.bottom + 4, left: r.left + r.width / 2 }
                                                        );
                                                    }}
                                                    className={`analysis-model-button cursor-pointer hover:text-primary ${
                                                        isEtf || (!stock.claudeQuality && !stock.claudeValue)
                                                            ? 'is-empty'
                                                            : 'has-score'
                                                    }`}
                                                    title="Open Claude score, source text, and input date"
                                                >
                                                    {isEtf ? '-' : claudeScore?.toFixed(1) ?? '-'}
                                                </button>
                                                {!isEtf && <ModelSourceStamp
                                                    inputAt={stock.claudeWebuiInputAt}
                                                    hasModelValues={Boolean(
                                                        stock.claudeQuality ||
                                                            stock.claudeValue ||
                                                            stock.claudePT ||
                                                            stock.claudeWebuiOutput,
                                                    )}
                                                />}
                                            </div>
                                        </td>

                                       {/* TV PT Column */}
                                        <td className="analysis-model-score-cell text-right px-2 border-r border-border/30">
                                            {isEtf ? (
                                                <span
                                                    className="analysis-score-empty font-mono"
                                                    title="ETF: stock price targets do not apply."
                                                >
                                                    -
                                                </span>
                                            ) : showTvPtEdit[
                                                stock.id
                                            ] ? (
                                                <input
                                                    key={`tv-pt-${stock.id}-${stock.analystPT}`}
                                                    type="number"
                                                    defaultValue={
                                                        stock.analystPT &&
                                                        stock.analystPT >
                                                            0
                                                            ? stock.analystPT
                                                            : ''
                                                    }
                                                    onBlur={(
                                                        e,
                                                    ) => {
                                                        handleFieldUpdate(
                                                            stock.id,
                                                            'analystPT',
                                                            parseFloat(
                                                                e
                                                                    .target
                                                                    .value,
                                                            ) ||
                                                                0,
                                                        );
                                                        setShowTvPtEdit(
                                                            (
                                                                prev,
                                                            ) => ({
                                                                ...prev,
                                                                [stock.id]:
                                                                    false,
                                                            }),
                                                        );
                                                    }}
                                                    onFocus={(
                                                        e,
                                                    ) =>
                                                        e.target.select()
                                                    }
                                                    onKeyDown={(
                                                        e,
                                                    ) => {
                                                        if (
                                                            e.key ===
                                                            'Enter'
                                                        ) {
                                                            e.currentTarget.blur();
                                                        }
                                                        if (
                                                            e.key ===
                                                            'Escape'
                                                        ) {
                                                            setShowTvPtEdit(
                                                                (
                                                                    prev,
                                                                ) => ({
                                                                    ...prev,
                                                                    [stock.id]:
                                                                        false,
                                                                }),
                                                            );
                                                        }
                                                    }}
                                                    className="w-full bg-background text-foreground text-right px-1 py-0.5 font-mono outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    min="0"
                                                    step="0.001"
                                                    placeholder="0"
                                                    autoFocus
                                                    aria-label={`TV PT for ${stock.name}`}
                                                />
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setShowTvPtEdit(
                                                            (
                                                                prev,
                                                            ) => ({
                                                                ...prev,
                                                                [stock.id]:
                                                                    true,
                                                            }),
                                                        )
                                                    }
                                                    className={`w-full text-right font-mono ${
                                                        stock.analystPT &&
                                                        stock.analystPT >
                                                            0
                                                            ? 'text-foreground hover:text-primary'
                                                            : 'text-muted-foreground hover:text-primary'
                                                    }`}
                                                    title="Edit TV PT"
                                                >
                                                    {stock.analystPT &&
                                                    stock.analystPT >
                                                        0
                                                        ? `$${stock.analystPT.toFixed(
                                                              3,
                                                          )}`
                                                        : '-'}
                                                </button>
                                            )}
                                        </td>
                                    </>
                                )}

                                {/* SIG Column */}
                                {analysisColumnVisible('signal') && (
                                <td className="text-center px-2 border-r border-border/30">
                                    {(() => {
                                        const positionState = stock.symbol
                                            ? securityPositions[stock.id]
                                            : null;

                                        if (!positionState) {
                                            return (
                                                <span className="analysis-score-empty font-mono">-</span>
                                            );
                                        }

                                        const isHold = !isEtf && avgPT > 0 && upsidePercent < 20;

                                        if (isHold) {
                                            return (
                                                <span className="analysis-signal" style={{ color: 'var(--signal-warn)' }}>
                                                    <span className="analysis-signal-icon">→</span>
                                                    <span>Hold</span>
                                                </span>
                                            );
                                        }

                                        return positionState === 'BUY' ? (
                                            <span className="analysis-signal" style={{ color: 'var(--signal-buy)' }}>
                                                <span className="analysis-signal-icon">↑</span>
                                                <span>Buy</span>
                                            </span>
                                        ) : (
                                            <span className="analysis-signal" style={{ color: 'var(--signal-sell)' }}>
                                                <span className="analysis-signal-icon">↓</span>
                                                <span>Sell</span>
                                            </span>
                                        );
                                    })()}
                                </td>
                                )}

                                {analysisColumnVisible('thesisDrift') && (
                                <td className="text-center px-2 border-r border-border/30">
                                    {!isEtf && typeof routerScore === 'number' && Number.isFinite(routerScore) ? (
                                        (() => {
                                            const multiplier =
                                                typeof routerMultiplier === 'number' &&
                                                Number.isFinite(routerMultiplier)
                                                    ? routerMultiplier
                                                    : 1;
                                            const adjustmentPct =
                                                (multiplier - 1) * 100;
                                            const tone =
                                                routerScore > 0
                                                    ? 'var(--signal-buy)'
                                                    : routerScore < 0
                                                      ? 'var(--signal-sell)'
                                                      : 'var(--muted-foreground)';
                                            const displayScore = `${
                                                routerScore > 0 ? '+' : ''
                                            }${routerScore.toFixed(1)}`;
                                            const displayAdjustment = `${
                                                adjustmentPct > 0 ? '+' : ''
                                            }${adjustmentPct.toFixed(0)}%`;
                                            return (
                                                <span
                                                    className="analysis-router-drift"
                                                    style={{ color: tone }}
                                                    title={
                                                        totalScore > 0
                                                            ? `Announcement-router thesis drift ${displayScore}. This changes Target Weight by ${displayAdjustment}, but does not change Total.`
                                                            : `Announcement-router thesis drift ${displayScore}. A completed model Total is required before it can affect Target Weight.`
                                                    }
                                                >
                                                    {displayScore}
                                                </span>
                                            );
                                        })()
                                    ) : (
                                        <span
                                            className="analysis-score-empty font-mono"
                                            title="No announcement-router thesis drift is available."
                                        >
                                            -
                                        </span>
                                    )}
                                </td>
                                )}

                                {/* Target Weight Column */}
                                {analysisColumnVisible('suggestedAllocation') && (
                                <td className="analysis-target-weight-cell px-2 border-r border-border/30">
                                    {(() => {
                                        if (isEtf) {
                                            return <span className="analysis-score-empty font-mono">-</span>;
                                        }
                                        if (!isStockIncludedInSizing(stock)) {
                                            return (
                                                <span className="analysis-target-off">inactive</span>
                                            );
                                        }
                                        const allocation = targetAllocation;
                                        if (!allocation || allocation.percent === 0) {
                                            return (
                                                <span className="analysis-score-empty font-mono">-</span>
                                            );
                                        }
                                        const barPct = Math.max(
                                            0,
                                            Math.min(100, allocation.percent),
                                        );
                                        const barColor = targetWeightColor();
                                        const anchoredDollar = classBudgetsApplied && allocation.dollar > 0;
                                        const unbudgeted = classBudgetsApplied && allocation.dollar === 0;
                                        // One value per cell: the class share, matching Positions' Ideal wt.
                                        // The anchored dollar amount stays available on hover.
                                        const title = anchoredDollar
                                            ? `${allocation.percent.toFixed(1)}% of the class · ${formatTargetDollar(allocation.dollar)} anchored target`
                                            : unbudgeted
                                              ? `${allocation.percent.toFixed(1)}% of the class · no approved class budget`
                                              : `${allocation.percent.toFixed(1)}% target weight`;
                                        return (
                                            <span className="analysis-target-weight" title={title}>
                                                <span className={`analysis-target-number${unbudgeted ? ' analysis-target-unbudgeted' : ''}`}>
                                                    {allocation.percent.toFixed(1)}%
                                                </span>
                                                <span className={`analysis-target-bar${unbudgeted ? ' analysis-target-bar--dim' : ''}`} aria-hidden="true">
                                                    <span style={{ width: `${barPct}%`, backgroundColor: barColor }} />
                                                </span>
                                            </span>
                                        );
                                    })()}
                                </td>
                                )}

                                {/* Class % Column */}
                                {analysisColumnVisible('classPercent') && (
                                <td className="text-right px-2 border-r border-border/30">
                                    {(() => {
                                        if (isEtf) {
                                            return <span className="analysis-score-empty font-mono">-</span>;
                                        }
                                        const classPercent =
                                            getClassPercentForStock(
                                                stock,
                                            );
                                        if (
                                            classPercent ===
                                                null ||
                                            !Number.isFinite(
                                                classPercent,
                                            )
                                        ) {
                                            return (
                                                <span className="analysis-score-empty font-mono">
                                                    -
                                                </span>
                                            );
                                        }
                                        return (
                                            <span className="font-mono text-foreground">
                                                {classPercent.toFixed(
                                                    1,
                                                )}
                                                %
                                            </span>
                                        );
                                    })()}
                                </td>
                                )}

                                {/* Both instrument types use 6M returns; only stocks have a sizing modifier. */}
                                {analysisColumnVisible('performance6m') && (
                                <td
                                    className="text-center px-2 font-mono border-r border-border/30"
                                    title={
                                        momentumModifier == null
                                            ? 'Insufficient adjusted price history for a six-month return'
                                            : `6M adjusted-close return ${formatAnalysisPerformancePct(stock.performance6MPct)}${stock.performanceAsOf ? ` to ${stock.performanceAsOf}` : ''}${isStalePerformance(stock.performanceAsOf) ? ' (stale — >5 days old)' : ''}. ${isEtf ? 'ETF ranking uses its separate 80/240-session model; no stock sizing modifier applies.' : totalScore > 0 ? `Sizing modifier +${momentumModifier.toFixed(1)}; it does not change Total.` : 'A completed model Total is required before this can affect Target Weight.'}`
                                    }
                                >
                                    {momentumModifier == null ? (
                                        <span className="analysis-score-empty font-mono">-</span>
                                    ) : (
                                    <span className={`analysis-momentum-display${isEtf ? ' is-etf' : ''}`}>
                                        <span
                                            className="analysis-momentum-return"
                                            style={{
                                                color: signColor(stock.performance6MPct),
                                                opacity: isEtf ? undefined : 0.8,
                                            }}
                                        >
                                            {formatAnalysisPerformancePct(
                                                stock.performance6MPct,
                                            )}
                                        </span>
                                        {!isEtf && momentumModifier != null && (
                                            <span className="analysis-momentum-modifier">
                                                +{momentumModifier.toFixed(1)}
                                            </span>
                                        )}
                                    </span>
                                    )}
                                </td>
                                )}

                                {/* Model Universe Column */}
                                {analysisColumnVisible('modelIncluded') && (
                                <td className="text-center px-2 border-r border-border/30">
                                    {(() => {
                                        if (isEtf) {
                                            return (
                                                <span
                                                    className="analysis-score-empty font-mono"
                                                    title="ETF: excluded from stock target-weight sizing."
                                                >
                                                    -
                                                </span>
                                            );
                                        }
                                        const included = isStockIncludedInSizing(stock);
                                        return (
                                            <button
                                                type="button"
                                                className={`analysis-model-toggle ${
                                                    included ? 'is-included' : 'is-excluded'
                                                }`}
                                                title={
                                                    included
                                                        ? 'Active in target-weight sizing'
                                                        : 'Inactive in target-weight sizing'
                                                }
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleBulkFieldUpdate(stock.id, {
                                                        includeInSizing: !included,
                                                    });
                                                }}
                                            >
                                                {included ? 'In' : 'Out'}
                                            </button>
                                        );
                                    })()}
                                </td>
                                )}

                                {/* CHART Column */}
                                {analysisColumnVisible('chart') && (
                                <td className="text-center px-2 border-r border-border/30">
                                    {stock.symbol ? (
                                        <a
                                            href={`https://www.tradingview.com/chart/?symbol=${stock.prefix}${stock.symbol}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center"
                                            title="Open chart"
                                            aria-label={`Open ${stock.prefix}${stock.symbol} chart in TradingView`}
                                        >
                                            <ArrowUpRight size={13} aria-hidden="true" />
                                        </a>
                                    ) : (
                                        <span className="analysis-score-empty font-mono">
                                            -
                                        </span>
                                    )}
                                </td>
                                )}

                                {/* THESIS Column (hidden when ratings expanded) */}
                                {!ratingsExpanded && notesExpanded && analysisColumnVisible('thesis') && (
                                    <td className="px-2 border-r border-border/30">
                                        {stock.thesis ? (
                                            <span
                                                className="analysis-cell-clip text-xs text-muted-foreground"
                                                title={stock.thesis}
                                            >
                                                {stock.thesis}
                                            </span>
                                        ) : (
                                            <span className="analysis-score-empty font-mono">
                                                -
                                            </span>
                                        )}
                                    </td>
                                )}

                                {/* NEXT CATALYST Column (hidden when ratings expanded) */}
                                {!ratingsExpanded && notesExpanded && analysisColumnVisible('nextCatalyst') && (
                                    <td className="h-[31px] max-h-[31px] px-2 align-middle overflow-hidden">
                                        {(() => {
                                            const next =
                                                analysisNextCatalystByStockId.get(
                                                    stock.id,
                                                );
                                            if (!next) {
                                                return (
                                                    <span className="analysis-score-empty font-mono">
                                                        -
                                                    </span>
                                                );
                                            }
                                            return (
                                                <div
                                                    className="analysis-cell-clip text-xs"
                                                    title={
                                                        next.title
                                                    }
                                                >
                                                    <span
                                                        className={
                                                            next.impactColor
                                                        }
                                                    >
                                                        {
                                                            next.name
                                                        }
                                                    </span>
                                                    <span className="text-muted-foreground ml-1 text-[10px]">
                                                        {
                                                            next.period
                                                        }
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                    </td>
                                )}
                            </tr>
                            {expandedAnalysisRowId === stock.id && !isEtf && (
                                <tr className="analysis-expanded-row">
                                    <td colSpan={100} className="p-0">
                                        <AnalysisRowResearch
                                            stock={stock}
                                            models={modelRuns}
                                            completed={modelCompletion.completed}
                                            completion={completionCopy}
                                            panelWidth={analysisGridPanelWidth}
                                            averageTarget={avgPT}
                                            upside={avgPT > 0 && stock.price > 0 ? upsidePercent : null}
                                            upsideColor={targetUpsideColor(upsidePercent)}
                                            suggestedWeight={targetAllocation?.percent != null
                                                ? `${targetAllocation.percent.toFixed(1)}%`
                                                : isStockIncludedInSizing(stock) ? '\u2014' : 'Inactive'}
                                            councilControls={renderCouncilControls(stock, 'expanded')}
                                            onClose={closeAnalysisResearch}
                                            onEditModel={(key, trigger) => {
                                                openAnalysisRunEditor(stock, key, trigger);
                                            }}
                                        />
                                    </td>
                                </tr>
                            )}
                            {/* Research Panel (expandable) */}
                            {showResearchPanel[
                                stock.symbol || stock.name
                            ] &&
                                hasCouncilResearchPanelContent(
                                    stock,
                                ) && (
                                    <tr>
                                        <td
                                            colSpan={100}
                                            className="p-0"
                                        >
                                            <ResearchPanel
                                                stock={
                                                    stock
                                                }
                                                onUpdate={(
                                                    field,
                                                    value,
                                                ) =>
                                                    handleFieldUpdate(
                                                        stock.id,
                                                        field,
                                                        value,
                                                    )
                                                }
                                                onBulkUpdate={(
                                                    updates,
                                                ) =>
                                                    handleBulkFieldUpdate(
                                                        stock.id,
                                                        updates,
                                                    )
                                                }
                                                councilRunId={
                                                    councilRunIds[
                                                        stock.symbol ||
                                                            stock.name
                                                    ] ||
                                                    stock.councilRunId ||
                                                    ''
                                                }
                                                onClearCouncilImport={() =>
                                                    clearCouncilImportedAnalysis(
                                                        stock,
                                                    )
                                                }
                                            />
                                        </td>
                                    </tr>
                                )}
                        </React.Fragment>
                    );
                }; // end renderRow

                const analysisMaterialCodes = new Set([
                    'GOLD',
                    'SILVER',
                    'COPPER',
                    'BASEMETALS',
                    'LITHIUM',
                    'URANIUM',
                    'REE',
                    'RAREEARTHS',
                    'IRON',
                    'IRONORE',
                    'ALUMINIUM',
                    'COAL',
                    'NICKEL',
                    'MINING',
                    'MATERIALS',
                ]);

                const toggleAnalysisRow = (key: string) => {
                    setAnalysisCollapsedRows((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                    }));
                };

                const isAnalysisRowCollapsed = (
                    key: string,
                ) => Boolean(analysisCollapsedRows[key]);

                const getAnalysisLocation = (
                    stock: AnalysisStock,
                ): {
                    assetKey: string;
                    assetLabel: string;
                    groupKey: string;
                    groupLabel: string;
                } => {
                    const stockCode =
                        getStockAssetClassCode(stock);
                    const normalized =
                        normalizeAssetClassCode(stockCode);
                    const stockLabel =
                        formatAssetClassLabel(normalized);
                    if (
                        analysisMaterialCodes.has(
                            normalized,
                        ) &&
                        normalized !== 'MATERIALS'
                    ) {
                        return {
                            assetKey: 'MATERIALS',
                            assetLabel: 'MATERIALS',
                            groupKey: normalized,
                            groupLabel: stockLabel,
                        };
                    }

                    if (
                        [
                            'PHARMA',
                            'BIOTECH',
                            'MEDTECH',
                            'MEDICALDEVICES',
                        ].includes(normalized)
                    ) {
                        return {
                            assetKey: 'HEALTHCARE',
                            assetLabel: 'HEALTHCARE',
                            groupKey: normalized,
                            groupLabel: stockLabel,
                        };
                    }

                    if (
                        [
                            'DATACENTRES',
                            'DATACENTERS',
                            'SOFTWARE',
                        ].includes(normalized)
                    ) {
                        return {
                            assetKey: 'TECHNOLOGY',
                            assetLabel: 'TECHNOLOGY',
                            groupKey: normalized,
                            groupLabel: stockLabel,
                        };
                    }

                    const assetLabel =
                        normalized === 'UNASSIGNED'
                            ? 'UNASSIGNED'
                            : stockLabel;

                    return {
                        assetKey: normalized,
                        assetLabel,
                        groupKey: `${normalized}:DIRECT`,
                        groupLabel:
                            normalized === 'UNASSIGNED'
                                ? 'UNASSIGNED'
                                : 'DIRECT',
                    };
                };

                const getAnalysisSortOrder = (
                    assetLabel: string,
                    assetKey: string,
                ) => {
                    const normalized =
                        normalizeAssetClassCode(assetLabel);
                    const setting =
                        getAssetClassSetting(normalized);
                    if (setting) return setting.display_order;
                    const fallbackOrder =
                        [
                            'MATERIALS',
                            'ENERGY',
                            'HEALTHCARE',
                            'PHARMA',
                            'STAPLES',
                            'INSURANCE',
                            'TECHNOLOGY',
                            'SEMICONDUCTORS',
                            'DEFENCE',
                            'ETF',
                            'EQUITY',
                            'UNASSIGNED',
                        ].indexOf(normalized);
                    if (fallbackOrder >= 0)
                        return 1000 + fallbackOrder;
                    return assetKey.startsWith('group:')
                        ? 500
                        : 2000;
                };

                const renderAnalysisHierarchyRow = ({
                    collapseKey,
                    assetClassKey,
                    label,
                    stocksForStats,
                    depth,
                    variant,
                    focusKey,
                }: {
                    collapseKey: string;
                    assetClassKey: string;
                    label: string;
                    stocksForStats: AnalysisStock[];
                    depth: 0 | 1 | 2;
                    variant: 'section' | 'asset' | 'group';
                    focusKey?: string;
                }) => {
                    const isCollapsed =
                        isAnalysisRowCollapsed(collapseKey);
                    const performance = getAnalysisGroupPerformance(stocksForStats);
                    const performanceStale = performance.coveredCount > 0 && (
                        performance.undatedCount > 0 || isStalePerformance(performance.oldestAsOf)
                    );
                    const performanceTitle = [
                        `Equal-weight average of six-month adjusted-close returns for ${performance.coveredCount} of ${performance.totalCount} securities in this Analysis group (holdings and watchlist).`,
                        'Missing returns are excluded, not treated as zero. This is not portfolio P/L or a sector index.',
                        performance.oldestAsOf ? `Oldest price data: ${performance.oldestAsOf.slice(0, 10)}.` : '',
                        performanceStale ? 'Some price data is over five days old or has no valid date.' : '',
                    ].filter(Boolean).join(' ');
                    const variantClass =
                        variant === 'section'
                            ? 'analysis-section-row'
                            : variant === 'asset'
                              ? 'analysis-asset-row'
                              : 'analysis-group-row';
                    // Grouping keys are normalised; icon preferences retain canonical class codes.
                    const appearanceCode = positionRowClassKey(
                        assetClassMap.get(assetClassKey)?.code ||
                        getAssetClassSetting(assetClassKey)?.key ||
                        stocksForStats.find(stock => normalizeAssetClassCode(stock.primaryAssetClass) === assetClassKey)?.primaryAssetClass ||
                        assetClassKey,
                    );
                    const hierarchyAssetCodes = Array.from(
                        new Set(
                            stocksForStats.map((stock) =>
                                normalizeAssetClassCode(
                                    getStockAssetClassCode(stock),
                                ),
                            ),
                        ),
                    );
                    const commodityThemeCode =
                        hierarchyAssetCodes.length === 1 &&
                        (hierarchyAssetCodes[0] === 'PHYSICAL_GOLD' ||
                            hierarchyAssetCodes[0] === 'GOLD_MINERS')
                            ? 'GOLD'
                            : null;
                    const commodityThemePath =
                        hierarchyAssetCodes[0] === 'PHYSICAL_GOLD'
                            ? 'direct'
                            : hierarchyAssetCodes[0] === 'GOLD_MINERS'
                              ? 'equity'
                              : undefined;
                    const isFocusedAssetClass =
                        focusKey !== undefined &&
                        focusedAnalysisAssetClass?.key === focusKey;
                    const hierarchyInset = depth === 0 ? '0.75rem' : depth === 1 ? '1.4rem' : '2.1rem';

                    return (
                        <tr
                            key={collapseKey}
                            className={`${variantClass} ${appearanceStyles.row} ${appearanceStyles.analysisRow} group cursor-pointer select-none`}
                            data-analysis-class={appearanceCode}
                            style={{ '--row-accent': assetClassColor(appearanceCode) } as React.CSSProperties}
                            onClickCapture={(event) => {
                                if (event.target instanceof Element && event.target.closest('[data-icon-slot], [role="dialog"]')) return;
                                if (hierarchyAssetCodes.length === 1) useContextPanelStore.getState().selectClass(hierarchyAssetCodes[0]);
                            }}
                            onClick={() =>
                                toggleAnalysisRow(
                                    collapseKey,
                                )
                            }
                        >
                            <td
                                colSpan={100}
                                className="py-0 pr-4"
                                style={{ paddingLeft: hierarchyInset }}
                            >
                                <div
                                    className="analysis-hierarchy-content flex items-center gap-[10px]"
                                    style={{
                                        position: 'sticky', left: hierarchyInset, maxWidth: '100%',
                                        width: analysisGridPanelWidth > 0
                                            ? `calc(${analysisGridPanelWidth}px - ${hierarchyInset} - 8px)` : undefined,
                                    }}
                                >
                                    <PositionRowIconPicker
                                        code={appearanceCode}
                                        label={label}
                                        expanded={!isCollapsed}
                                        onToggle={() => toggleAnalysisRow(collapseKey)}
                                    />
                                    <span className="analysis-hierarchy-label truncate">
                                        {label}
                                    </span>
                                    {commodityThemeCode ? (
                                        <CommodityThemePathIndicator
                                            themeCode={commodityThemeCode}
                                            path={commodityThemePath}
                                        />
                                    ) : null}
                                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                        <div className="analysis-section-stats flex items-center gap-2 whitespace-nowrap text-[12px] leading-[18px]"
                                            title={performanceTitle}>
                                            <span className={`font-mono text-[14px] font-medium tabular-nums ${analysisPerformanceToneClass(performance.averagePct)}`}>
                                                {performance.averagePct === null ? '\u2014' : formatAnalysisPerformancePct(performance.averagePct)}
                                            </span>
                                            {performanceStale && <span className="text-muted-foreground">Stale</span>}
                                        </div>
                                        {focusKey !== undefined && (
                                            <button
                                                type="button"
                                                data-testid={`analysis-focus-asset-${focusKey}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setFocusedAnalysisAssetClass((current) =>
                                                        current?.key === focusKey
                                                            ? null
                                                            : {
                                                                  key: focusKey,
                                                                  label,
                                                              },
                                                    );
                                                    if (!isFocusedAssetClass) {
                                                        setAnalysisCollapsedRows((current) => {
                                                            const next = { ...current };
                                                            delete next[collapseKey];
                                                            return next;
                                                        });
                                                    }
                                                }}
                                                className={`grid h-[18px] w-[18px] place-items-center rounded-[2px] border p-0 leading-none transition-[opacity,color,background-color,border-color] duration-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                                                    isFocusedAssetClass
                                                        ? 'border-primary/40 bg-primary/10 text-primary opacity-100'
                                                        : 'border-transparent text-muted-foreground/70 opacity-100 hover:border-border/70 hover:bg-muted/20 hover:text-foreground'
                                                }`}
                                                aria-label={
                                                    isFocusedAssetClass
                                                        ? 'Show all asset classes'
                                                        : `Focus ${label}`
                                                }
                                                aria-pressed={isFocusedAssetClass}
                                                title={
                                                    isFocusedAssetClass
                                                        ? 'Show all asset classes'
                                                        : `Focus ${label}`
                                                }
                                            >
                                                <Focus className="block" size={12} strokeWidth={2.25} aria-hidden="true" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </td>
                        </tr>
                    );
                };

                const renderAnalysisBook = (
                    sectionStocks: AnalysisStock[],
                ) => {
                    if (sectionStocks.length === 0)
                        return null;

                    type AnalysisGroupBucket = {
                        label: string;
                        stocks: AnalysisStock[];
                    };
                    type AnalysisAssetBucket = {
                        label: string;
                        stocks: AnalysisStock[];
                        directStocks: AnalysisStock[];
                        groups: Map<
                            string,
                            AnalysisGroupBucket
                        >;
                    };

                    const directMaterialCodes = new Set([
                        'MATERIALS',
                        'MINING',
                    ]);
                    const pinEtfsToTop = (
                        items: AnalysisStock[],
                    ) =>
                        items
                            .map((stock, index) => ({
                                stock,
                                index,
                                isEtf:
                                    getStockRegimes(stock).includes(
                                        'ETF',
                                    ),
                            }))
                            .sort((a, b) => {
                                if (a.isEtf !== b.isEtf)
                                    return a.isEtf ? -1 : 1;
                                return a.index - b.index;
                            })
                            .map(({ stock }) => stock);

                    const assetBuckets = new Map<
                        string,
                        AnalysisAssetBucket
                    >();

                    sectionStocks.forEach((stock) => {
                        const location =
                            getAnalysisLocation(stock);
                        const normalized =
                            normalizeAssetClassCode(
                                getStockAssetClassCode(
                                    stock,
                                ),
                            );
                        const isMaterial =
                            analysisMaterialCodes.has(
                                normalized,
                            );
                        const assetKey = isMaterial
                            ? 'MATERIALS'
                            : location.assetKey;
                        const assetLabel = isMaterial
                            ? 'MATERIALS'
                            : location.assetLabel;
                        const isDirect =
                            isMaterial
                                ? directMaterialCodes.has(
                                      normalized,
                                  )
                                : [
                                      'DIRECT',
                                      'UNASSIGNED',
                                  ].includes(
                                      location.groupLabel.toUpperCase(),
                                  );
                        let assetBucket = assetBuckets.get(
                            assetKey,
                        );
                        if (!assetBucket) {
                            assetBucket = {
                                label: assetLabel,
                                stocks: [],
                                directStocks: [],
                                groups: new Map(),
                            };
                        }
                        assetBucket.stocks.push(stock);

                        if (isDirect) {
                            assetBucket.directStocks.push(stock);
                        } else {
                            const groupKey = isMaterial
                                ? normalized
                                : location.groupKey;
                            const groupLabel = isMaterial
                                ? formatAssetClassLabel(
                                      normalized,
                                  )
                                : location.groupLabel;
                            let groupBucket =
                                assetBucket.groups.get(
                                    groupKey,
                                );
                            if (!groupBucket) {
                                groupBucket = {
                                    label: groupLabel,
                                    stocks: [],
                                };
                            }
                            groupBucket.stocks.push(stock);
                            assetBucket.groups.set(
                                groupKey,
                                groupBucket,
                            );
                        }

                        assetBuckets.set(
                            assetKey,
                            assetBucket,
                        );
                    });

                    const assetEntries = Array.from(
                        assetBuckets.entries(),
                    ).sort((a, b) => {
                        const aOrder =
                            getAnalysisSortOrder(
                                a[1].label,
                                a[0],
                            );
                        const bOrder =
                            getAnalysisSortOrder(
                                b[1].label,
                                b[0],
                            );
                        if (aOrder !== bOrder)
                            return aOrder - bOrder;
                        return a[1].label.localeCompare(
                            b[1].label,
                        );
                    });

                    const displayedAssetEntries = focusedAnalysisAssetClass
                        ? assetEntries.filter(
                              ([assetKey]) =>
                                  assetKey === focusedAnalysisAssetClass.key,
                          )
                        : assetEntries;

                    return (
                        <>
                            {displayedAssetEntries.map(
                                ([
                                    assetKey,
                                    assetBucket,
                                ]) => {
                                    const assetCollapseKey = `analysis:asset:${assetKey}`;
                                    const assetCollapsed =
                                        isAnalysisRowCollapsed(
                                            assetCollapseKey,
                                        );
                                    const groupEntries =
                                        Array.from(
                                            assetBucket.groups.entries(),
                                        ).sort((a, b) =>
                                            a[1].label.localeCompare(
                                                b[1].label,
                                            ),
                                        );

                                    return (
                                        <React.Fragment
                                            key={
                                                assetCollapseKey
                                            }
                                        >
                                            {renderAnalysisHierarchyRow(
                                                {
                                                    collapseKey:
                                                        assetCollapseKey,
                                                    assetClassKey: assetKey,
                                                    label: assetBucket.label,
                                                    stocksForStats:
                                                        assetBucket.stocks,
                                                    depth: 0,
                                                    variant:
                                                        'section',
                                                    focusKey: assetKey,
                                                },
                                            )}
                                            {!assetCollapsed &&
                                                pinEtfsToTop(
                                                    assetBucket.directStocks,
                                                ).map((stock) =>
                                                    renderRow(
                                                        stock,
                                                    ),
                                                )}
                                            {!assetCollapsed &&
                                                groupEntries.map(
                                                    ([
                                                        groupKey,
                                                        groupBucket,
                                                    ]) => {
                                                        const groupCollapseKey = `analysis:asset:${assetKey}:group:${groupKey}`;
                                                        const groupCollapsed =
                                                            isAnalysisRowCollapsed(
                                                                groupCollapseKey,
                                                            );
                                                        return (
                                                            <React.Fragment
                                                                key={
                                                                    groupCollapseKey
                                                                }
                                                            >
                                                                {renderAnalysisHierarchyRow(
                                                                    {
                                                                        collapseKey:
                                                                            groupCollapseKey,
                                                                        assetClassKey: groupKey,
                                                                        label: groupBucket.label,
                                                                        stocksForStats:
                                                                            groupBucket.stocks,
                                                                        depth: 1,
                                                                        variant:
                                                                            'group',
                                                                    },
                                                                )}
                                                                {!groupCollapsed &&
                                                                    pinEtfsToTop(
                                                                        groupBucket.stocks,
                                                                    ).map(
                                                                        (
                                                                            stock,
                                                                        ) =>
                                                                            renderRow(
                                                                                stock,
                                                                            ),
                                                                    )}
                                                            </React.Fragment>
                                                        );
                                                    },
                                                )}
                                        </React.Fragment>
                                    );
                                },
                            )}
                        </>
                    );
                };

                return (
                    <>
                        {visibleAnalysisStocks.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={analysisGridBaseColumns.length}
                                    className="h-20 px-3 text-center text-xs text-muted-foreground"
                                >
                                    No securities match this Analysis view.
                                </td>
                            </tr>
                        ) : analysisGroupMode === 'sector' ? (
                            renderAnalysisBook(visibleAnalysisStocks)
                        ) : (
                            visibleAnalysisStocks.map((stock) => renderRow(stock))
                        )}
                    </>
                );
            })()}
    </ResizableGrid>
{analysisRunEditor && (() => {
    const def = ANALYSIS_EXPECTED_MODELS.find(m => m.key === analysisRunEditor.modelKey);
    const stock = stocks.find(item => item.id === analysisRunEditor.stockId);
    if (!def) return null;
    return <Dialog.Root open onOpenChange={open => { if (!open) cancelAnalysisRunEditor(); }}>
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[9998]" style={{ background: 'rgba(0,0,0,0.2)' }} />
            <Dialog.Content
                className="analysis-run-popover"
                data-analysis-row-interactive="true"
                onOpenAutoFocus={event => { event.preventDefault(); analysisRunQualityInputRef.current?.focus(); }}
                onCloseAutoFocus={event => event.preventDefault()}
            >
                <div className="analysis-run-popover-header">
                    <div>
                        <Dialog.Title className="analysis-run-popover-title">{def.label} run</Dialog.Title>
                        <Dialog.Description className="analysis-run-popover-meta">{analysisRunEditor.stockName}</Dialog.Description>
                    </div>
                    <div className="analysis-run-header-actions">
                    {stock && <button type="button" ref={analysisRunTemplateTriggerRef} className="analysis-run-template-toggle"
                        aria-pressed={analysisRunTemplateOpen} onClick={() => setAnalysisRunTemplateOpen(value => !value)}>
                        <FileText size={14} aria-hidden="true" />Template
                    </button>}
                    <button
                        type="button"
                        onClick={cancelAnalysisRunEditor}
                        className="analysis-run-popover-close"
                        aria-label="Close model run editor"
                    >
                        ×
                    </button>
                    </div>
                </div>
                {analysisRunTemplateOpen && stock ? <AnalysisRunTemplate key={stock.id} stock={stock} onBack={() => {
                    setAnalysisRunTemplateOpen(false);
                    requestAnimationFrame(() => analysisRunTemplateTriggerRef.current?.focus());
                }} /> : <>
                <div className="analysis-run-body">
                <div className="analysis-run-fields">
                    <label>
                        <span>Quality</span>
                        <input
                            ref={analysisRunQualityInputRef}
                            type="number"
                            value={analysisRunDraft.quality}
                            onChange={(e) => updateAnalysisRunDraft('quality', e.target.value)}
                            step="0.1"
                            min="0"
                            max="100"
                        />
                    </label>
                    <label>
                        <span>Value</span>
                        <input type="number" value={analysisRunDraft.value} onChange={(e) => updateAnalysisRunDraft('value', e.target.value)} step="0.1" min="0" max="100" />
                    </label>
                    <label>
                        <span>Price target</span>
                        <input type="number" value={analysisRunDraft.priceTarget} onChange={(e) => updateAnalysisRunDraft('priceTarget', e.target.value)} step="0.001" min="0" />
                    </label>
                </div>
                <div className="analysis-run-date-row">
                    <label>
                        <span>Run date</span>
                        <input type="date" value={analysisRunDraft.inputAt} onChange={(e) => updateAnalysisRunDraft('inputAt', e.target.value)} />
                    </label>
                    <button type="button" onClick={() => updateAnalysisRunDraft('inputAt', new Date().toISOString().slice(0, 10))}>Today</button>
                </div>
                <label className="analysis-run-source">
                    <span>Source text</span>
                    <textarea aria-label="Source text" value={analysisRunDraft.sourceText} onChange={(e) => updateAnalysisRunDraft('sourceText', e.target.value)} rows={5} placeholder="Paste the model output here" />
                </label>
                </div>
                <div className="analysis-run-actions">
                    <button type="button" onClick={autoFillAnalysisRunDraft} className="is-secondary">Auto-fill Q/V/PT</button>
                    <span />
                    <button type="button" onClick={cancelAnalysisRunEditor} className="is-secondary">Cancel</button>
                    <button type="button" onClick={saveAnalysisRunEditor} className="is-primary">Save run</button>
                </div>
                </>}
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
})()}
{typeof window !== 'undefined' && modelPopover && createPortal(
    <>
        <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setModelPopover(null)}
        />
        <div
            className="fixed z-[9999] w-72 rounded-md border border-border/70 bg-background/95 p-3 text-left shadow-xl"
            style={{ top: modelPopover.top, left: modelPopover.left, transform: 'translateX(-50%)' }}
            role="dialog"
            aria-label={`${
                modelPopover.model === 'gemini' ? 'Gemini'
                : modelPopover.model === 'perplexity' ? 'Perplexity'
                : modelPopover.model === 'gpt' ? 'GPT'
                : 'Claude'
            } score details for ${modelPopover.stock.name}`}
        >
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-foreground">
                    {modelPopover.model === 'gemini' ? 'Gemini'
                     : modelPopover.model === 'perplexity' ? 'Perplexity'
                     : modelPopover.model === 'gpt' ? 'GPT'
                     : 'Claude'}
                </span>
                <button
                    type="button"
                    onClick={() => setModelPopover(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Close model score details"
                >
                    ×
                </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <label className="text-[9px] text-muted-foreground">
                    Q
                    <input
                        type="number"
                        value={(modelPopover.model === 'gemini' ? modelPopover.stock.geminiQuality
                              : modelPopover.model === 'perplexity' ? modelPopover.stock.perplexityQuality
                              : modelPopover.model === 'gpt' ? modelPopover.stock.gptQuality
                              : modelPopover.stock.claudeQuality) || ''}
                        onChange={(e) =>
                            handleFieldUpdate(
                                modelPopover.stock.id,
                                modelPopover.model === 'gemini' ? 'geminiQuality'
                                : modelPopover.model === 'perplexity' ? 'perplexityQuality'
                                : modelPopover.model === 'gpt' ? 'gptQuality'
                                : 'claudeQuality',
                                parseFloat(e.target.value) || 0,
                            )
                        }
                        onFocus={(e) => e.target.select()}
                        className="mt-1 w-full border border-border/40 bg-background px-1 py-0.5 text-right text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        step="0.1"
                        placeholder="0"
                    />
                </label>
                <label className="text-[9px] text-muted-foreground">
                    V
                    <input
                        type="number"
                        value={(modelPopover.model === 'gemini' ? modelPopover.stock.geminiValue
                              : modelPopover.model === 'perplexity' ? modelPopover.stock.perplexityValue
                              : modelPopover.model === 'gpt' ? modelPopover.stock.gptValue
                              : modelPopover.stock.claudeValue) || ''}
                        onChange={(e) =>
                            handleFieldUpdate(
                                modelPopover.stock.id,
                                modelPopover.model === 'gemini' ? 'geminiValue'
                                : modelPopover.model === 'perplexity' ? 'perplexityValue'
                                : modelPopover.model === 'gpt' ? 'gptValue'
                                : 'claudeValue',
                                parseFloat(e.target.value) || 0,
                            )
                        }
                        onFocus={(e) => e.target.select()}
                        className="mt-1 w-full border border-border/40 bg-background px-1 py-0.5 text-right text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        step="0.1"
                        placeholder="0"
                    />
                </label>
                <label className="text-[9px] text-muted-foreground">
                    PT
                    <input
                        key={modelPopover.model === 'gemini' ? `gem-pt-${modelPopover.stock.id}-${modelPopover.stock.geminiPT}`
                           : modelPopover.model === 'perplexity' ? `pplx-pt-${modelPopover.stock.id}-${modelPopover.stock.perplexityPT}`
                           : modelPopover.model === 'gpt' ? `gpt-pt-${modelPopover.stock.id}-${modelPopover.stock.gptPT}`
                           : `cld-pt-${modelPopover.stock.id}-${modelPopover.stock.claudePT}`}
                        type="number"
                        defaultValue={(modelPopover.model === 'gemini' ? modelPopover.stock.geminiPT
                                     : modelPopover.model === 'perplexity' ? modelPopover.stock.perplexityPT
                                     : modelPopover.model === 'gpt' ? modelPopover.stock.gptPT
                                     : modelPopover.stock.claudePT) || ''}
                        onBlur={(e) =>
                            handleFieldUpdate(
                                modelPopover.stock.id,
                                modelPopover.model === 'gemini' ? 'geminiPT'
                                : modelPopover.model === 'perplexity' ? 'perplexityPT'
                                : modelPopover.model === 'gpt' ? 'gptPT'
                                : 'claudePT',
                                parseFloat(e.target.value) || 0,
                            )
                        }
                        onFocus={(e) => e.target.select()}
                        className="mt-1 w-full border border-border/40 bg-background px-1 py-0.5 text-right text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        step="0.001"
                        placeholder="0"
                    />
                </label>
            </div>
            <ModelSourceCapture
                stockId={modelPopover.stock.id}
                output={modelPopover.model === 'gemini' ? modelPopover.stock.geminiWebuiOutput
                      : modelPopover.model === 'perplexity' ? modelPopover.stock.perplexityWebuiOutput
                      : modelPopover.model === 'gpt' ? modelPopover.stock.gptWebuiOutput
                      : modelPopover.stock.claudeWebuiOutput}
                outputField={modelPopover.model === 'gemini' ? 'geminiWebuiOutput'
                           : modelPopover.model === 'perplexity' ? 'perplexityWebuiOutput'
                           : modelPopover.model === 'gpt' ? 'gptWebuiOutput'
                           : 'claudeWebuiOutput'}
                inputAt={modelPopover.model === 'gemini' ? modelPopover.stock.geminiWebuiInputAt
                       : modelPopover.model === 'perplexity' ? modelPopover.stock.perplexityWebuiInputAt
                       : modelPopover.model === 'gpt' ? modelPopover.stock.gptWebuiInputAt
                       : modelPopover.stock.claudeWebuiInputAt}
                inputAtField={modelPopover.model === 'gemini' ? 'geminiWebuiInputAt'
                            : modelPopover.model === 'perplexity' ? 'perplexityWebuiInputAt'
                            : modelPopover.model === 'gpt' ? 'gptWebuiInputAt'
                            : 'claudeWebuiInputAt'}
                onFieldUpdate={handleFieldUpdate}
            />
        </div>
    </>,
    document.body
)}
</>
    );
}
