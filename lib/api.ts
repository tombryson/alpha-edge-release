import { submitCouncilJob } from './council-submission';
import { getAccessMode, getSessionCSRF, isSessionReady } from './access-mode';
import type { DataFreshnessResponse } from './data-freshness';
import { createSharedAPIReads } from './shared-api-reads';
import type { AnnouncementSubscription, AnnouncementSetupUpdate } from './announcement-subscriptions';
import type { SourceResearchCatalogue, SourceResearchJob, SourceResearchRequest } from './source-research';
import { INVESTMENT_PLAY_PREFIX, readInvestmentPlayLibrary, type SavedInvestmentPlay } from './portfolio-investment-plays';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';
const sharedReads = createSharedAPIReads();

export type ExchangeAssignmentTarget = { kind: 'holding' | 'analysis'; id: number };
export type ExchangeAssignmentResult = ExchangeAssignmentTarget & {
    name: string;
    ticker: string;
    status: 'assigned' | 'review' | 'skipped';
    reason?: string;
    exchange_prefix: string;
    source: string;
};

// --- API authentication ----------------------------------------------------
// Owner mode uses same-origin HttpOnly sessions. Legacy mode still supports an
// explicitly entered token; credentials are never baked into browser bundles.

const API_TOKEN_STORAGE_KEY = 'alpha-edge-api-token';
const API_TOKEN_FALLBACK_REJECTED_KEY = 'alpha-edge-api-token-fallback-rejected';

export function getApiToken(): string {
    if (getAccessMode() !== 'legacy') return '';
    if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(API_TOKEN_STORAGE_KEY);
        if (stored && stored.trim()) return stored.trim();
        if (window.sessionStorage.getItem(API_TOKEN_FALLBACK_REJECTED_KEY) === '1') {
            return '';
        }
    }
    return '';
}

export function hasApiAccess(): boolean {
    return getAccessMode() === 'legacy' ? Boolean(getApiToken()) : isSessionReady();
}

export function setApiToken(token: string): void {
    if (typeof window === 'undefined') return;
    sharedReads.invalidate();
    window.localStorage.setItem(API_TOKEN_STORAGE_KEY, token.trim());
    window.sessionStorage.removeItem(API_TOKEN_FALLBACK_REJECTED_KEY);
}

export function clearApiToken(): void {
    if (typeof window === 'undefined') return;
    sharedReads.invalidate();
    window.localStorage.removeItem(API_TOKEN_STORAGE_KEY);
    window.sessionStorage.setItem(API_TOKEN_FALLBACK_REJECTED_KEY, '1');
}

/** Fired on any 401 so the token gate can prompt for (re-)entry. */
export const API_UNAUTHORIZED_EVENT = 'alpha-edge:unauthorized';

let lastUnauthorizedEventAt = 0;

function isBackendApiRequest(input: RequestInfo | URL): boolean {
    const target =
        typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
    if (target.startsWith(API_BASE_URL)) return true;
    if (typeof window === 'undefined') return false;
    const url = new URL(target, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/council/');
}

function notifyUnauthorized(): void {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    if (now - lastUnauthorizedEventAt < 5000) return;
    lastUnauthorizedEventAt = now;
    window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT));
}

/** Drop-in replacement for fetch() that attaches the bearer token and
 *  broadcasts an event when the backend rejects our credentials. */
export async function apiFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
): Promise<Response> {
    const modern = getAccessMode() !== 'legacy';
    if (modern && typeof input === 'string' && input.startsWith(API_BASE_URL + '/')) {
        input = '/api/terminal' + input.slice(API_BASE_URL.length);
    }
    const headers = new Headers(init.headers);
    const token = getApiToken();
    if (!modern && !token && typeof window !== 'undefined' && isBackendApiRequest(input)) {
        notifyUnauthorized();
        return new Response(JSON.stringify({ error: 'API token required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (modern) {
        headers.delete('Authorization');
        if (getSessionCSRF()) headers.set('X-CSRF-Token', getSessionCSRF());
    }
    const options: RequestInit = { ...init, headers, ...(modern ? { credentials: 'same-origin', cache: 'no-store' } as const : {}) };
    const response = typeof window === 'undefined'
        ? await fetch(input, options)
        : await sharedReads.fetch(input, options, signal => fetch(input, signal ? { ...options, signal } : options), API_BASE_URL);
    if (response.status === 401 && typeof window !== 'undefined' && (modern || isBackendApiRequest(input))) {
        clearApiToken();
        sharedReads.invalidate();
        notifyUnauthorized();
    }
    return response;
}
// ---------------------------------------------------------------------------

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJsonSafe(response: Response): Promise<any> {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

async function fetchJsonWithRetry(
    input: RequestInfo | URL,
    init: RequestInit = {},
    options: { retries?: number; timeoutMs?: number } = {},
): Promise<{ response: Response; body: any }> {
    const retries = Math.max(0, options.retries ?? 2);
    const timeoutMs = Math.max(1000, options.timeoutMs ?? 25000);
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await apiFetch(input, {
                ...init,
                signal: controller.signal,
            });
            clearTimeout(timeout);
            const body = await readJsonSafe(response);
            if (response.ok) {
                return { response, body };
            }
            const shouldRetry =
                RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < retries;
            if (!shouldRetry) {
                return { response, body };
            }
            await sleep(500 * (attempt + 1));
            continue;
        } catch (error) {
            clearTimeout(timeout);
            lastError = error;
            if (attempt >= retries) break;
            await sleep(500 * (attempt + 1));
        }
    }
    if (lastError instanceof Error) {
        if (lastError.name === 'AbortError') {
            throw new Error('Request timed out while waiting for the server');
        }
        throw lastError;
    }
    throw new Error('Network request failed');
}

export interface AlertResponse {
    id: number;
    ticker: string;
    alert_type: string;
    strength: string;
    expiry_date?: string;
    exchange_prefix: string;
    created_at: string;
    is_active: boolean;
    source?: string; // 'cdf' | 'tms'/'atr_oscillator' | 'regime' | 'unknown'
    affected_positions?: string | null;
    alert_price?: number | null;
    current_price?: number | null;
    move_pct?: number | null;
    resolved_reason?: string;
    resolved_note?: string;
}

export type SecurityActionStatus =
    | 'OPEN'
    | 'BLOCKED'
    | 'AWAITING_STATEMENT'
    | 'CONFIRMED'
    | 'VARIANCE'
    | 'IGNORED'
    | 'EXPIRED'
    | 'OVERRIDDEN'
    | 'NOT_APPLICABLE';

export type DeploymentTicketState =
    | 'FUNDED'
    | 'CDF_BLOCKED'
    | 'Q4_BLOCKED'
    | 'RISK_UNKNOWN'
    | 'FEED_DISCONNECTED'
    | 'TREND_UNKNOWN'
    | 'MARKET_BLOCKED'
    | 'CAPACITY_REACHED'
    | 'WEIGHT_LIMIT'
    | 'TARGET_UNAVAILABLE'
    | 'INSUFFICIENT_FUNDS'
    | 'BELOW_MINIMUM';

export interface SecurityActionResponse {
    id: number;
    alert_id: number;
    ticker: string;
    alert_type: string;
    strength?: string;
    timeframe?: string;
    source?: string;
    scope: 'SECURITY' | 'ASSET_CLASS' | 'PORTFOLIO';
    asset_class_code?: string;
    affected_tickers?: string[];
    source_event_key?: string;
    intent: 'DEPLOY' | 'REDUCE' | 'EXIT' | 'REVIEW';
    instruction_basis: string;
    instruction: string;
    priority: number;
    status: SecurityActionStatus;
    blocked_by_action_id?: number;
    blocked_by_instruction?: string;
    holding_quantity_snapshot: number;
    holding_value_snapshot: number;
    holding_price_snapshot: number;
    deployment_state?: DeploymentTicketState;
    deployment_policy_version?: string;
    instruction_value?: number;
    target_value?: number;
    target_shortfall_value?: number;
    class_funding_before?: number;
    class_funding_after?: number;
    execution_reported_at?: string;
    execution_note?: string;
    execution_units?: number;
    execution_cash_value?: number;
    execution_exception_reason?: string;
    execution_policy_snapshot?: string;
    can_record_purchase_exception?: boolean;
    reconciliation_method?: string;
    is_external?: boolean;
    override_reason?: string;
    next_review_at?: string;
    reconciled_statement_id?: number;
    reconciled_at?: string;
    created_at: string;
    updated_at: string;
    queue_count: number;
    is_primary: boolean;
    weight_evidence?: WeightReference;
    closed_reason?: string;
}

export interface WeightReference {
    id: number;
    ticker: string;
    asset_class: string;
    role: 'STOCK' | 'CORE_ETF' | 'ETF' | 'CLASS';
    held: number;
    ideal: number;
    percent: number;
    coverage: number;
    reduction: number;
    remaining: number;
    available: boolean;
    fresh: boolean;
    reason?: string;
    research_missing: number;
    observed_date: string;
    statement_id: number;
    portfolio_value: number;
}

export interface WeightPolicyResponse {
    enabled: boolean;
    epoch: number;
    version: string;
    targets: WeightReference[];
    error?: string;
    read_only?: boolean;
}

export interface ActiveAlertResponse {
    id: number;
    ticker: string;
    script: string;
    created_at: string;
}

// DEPRECATED: SecurityResponse (use statement_holdings instead)

export interface DecisionRequest {
    alert_id?: number;
    decision: 'BUY' | 'SELL' | 'SELL_50' | 'SELL_DOWN' | 'ADD' | 'TRIM' | 'IGNORE' | 'REBALANCE_DISMISS' | 'CASH_ALLOCATION' | 'ACCEPT';
    notes?: string;
    position_pct_after?: number;
    units?: number;
}

export interface DecisionResponse {
    id: number;
    alert_id: number;
    decision: string;
    notes: string;
    position_pct_after: number | null;
    created_at: string;
    ticker: string;
    alert_type: string;
}

export interface PortfolioResponse {
    total_value: number;
    cash_on_hand: number;
    exposure: number;
    profit_loss: number;
    profit_loss_percent: number;
}

export interface StatementHolding {
    id: number;
    statement_id: number;
    details: string;
    quantity: number;
    cost_aud: number;
    current_price: number;
    value_aud: number;
    gain_loss_aud: number;
    gain_loss_pct: number;
    currency: string;
    market_value: number;
    cash_reserve: number;
    ticker: string | null;
    exchange_prefix: string | null;
    template_id: string | null;
    created_at: string;
}

export interface AccountStatement {
    id: number;
    account_name: string;
    statement_date: string;
    total_value_aud: number;
    cash_aud: number;
    usd_value: number;
    usd_aud: number;
    gbp_value: number;
    gbp_aud: number;
    aud_value: number;
    created_at: string;
}

export interface LatestStatementResponse {
    statement: AccountStatement;
    holdings: StatementHolding[];
}

export interface PortfolioPerformancePoint {
    statement_id: number;
    observed_at: string;
    total_value_aud: number;
    invested_value_aud: number;
    statement_cash_aud: number;
    sleeve_cash_aud: number;
    residual_cash_aud: number;
    holdings_count: number;
    source: string;
}

export interface AssetClassPerformancePoint {
    statement_id: number;
    observed_at: string;
    asset_class: string;
    display_name: string;
    invested_value_aud: number;
    cash_value_aud: number;
    total_value_aud: number;
    portfolio_weight_pct: number;
    source: string;
}

export interface SecurityPerformancePoint {
    statement_id: number;
    observed_at: string;
    ticker: string;
    exchange_prefix: string;
    name: string;
    asset_class: string;
    quantity: number;
    price: number;
    market_value_aud: number;
    portfolio_weight_pct: number;
    currency: string;
    source: string;
}

export interface PerformanceEvent {
    id: string;
    event_type: string;
    occurred_at: string;
    title: string;
    scope: string;
    ticker?: string;
    asset_class?: string;
    source?: string;
    severity?: string;
    statement_id?: number;
    value_aud?: number;
    pct_value?: number;
    metadata?: Record<string, unknown>;
}

export interface SecurityPerformanceDirection {
    ticker: string;
    name: string;
    asset_class: string;
    observed_at: string;
    previous_at?: string;
    price: number;
    previous_price: number;
    change: number;
    change_pct: number;
    direction: 'up' | 'down' | 'flat' | string;
}

export interface NewsMarketContext {
    top_themes_12m: string[];
    top_performers_12m: string[];
    worst_performers_12m: string[];
    news_themes_1m: string[];
    top_performers_1m: string[];
    worst_performers_1m: string[];
}

export interface NewsRun {
    id: number;
    run_date: string;
    mode: string;
    status: string;
    model: string;
    source_type: string;
    source_id: string;
    foundation_cohort_id?: number;
    daily_summary: string;
    market_context: NewsMarketContext;
    error_message?: string;
    created_at: string;
    updated_at: string;
}

export interface NewsFoundationCohort {
    id: number;
    status: string;
    source_type: string;
    source_id: string;
    source_memo_job_id: string;
    run_id?: number;
    model: string;
    quality_score: number;
    thesis_count: number;
    candidate_count: number;
    created_at: string;
    activated_at?: string;
    superseded_at?: string;
    updated_at: string;
}

export interface NewsFoundationJob {
    id: string;
    status: string;
    stage: string;
    stage_message: string;
    progress_pct: number;
    mode: string;
    source_type: string;
    source_id: string;
    source_memo_job_id: string;
    foundation_cohort_id?: number;
    run_id?: number;
    model: string;
    quality_score: number;
    thesis_count: number;
    candidate_count: number;
    error_message?: string;
    created_at: string;
    started_at?: string;
    finished_at?: string;
    updated_at: string;
}

export interface NewsItem {
    id: number;
    run_id: number;
    headline: string;
    summary: string;
    timeframe: string;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    impact_score: number;
    sources: string[];
    asset_classes: string[];
    tags: string[];
    created_at: string;
}

export interface NewsThesis {
    id: number;
    slug: string;
    foundation_cohort_id?: number;
    title: string;
    timeframe: string;
    status: string;
    conviction: number;
    relevance_score: number;
    summary: string;
    asset_classes: string[];
    tags: string[];
    source_type: string;
    source_id: string;
    source_excerpt: string;
    supporting_evidence: string;
    opposing_evidence: string;
    invalidation_trigger: string;
    invalidation_check_due_at?: string;
    stale_invalidation: boolean;
    created_at: string;
    updated_at: string;
    last_updated_at: string;
    resolved_at?: string;
}

export interface NewsThesisUpdate {
    id: number;
    thesis_id: number;
    run_id: number;
    relationship: string;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    evidence: string;
    conviction_delta: number;
    sources: string[];
    created_at: string;
}

export interface NewsThesisConvictionPoint {
    run_id: number;
    conviction: number;
    recorded_at: string;
}

export interface NewsThesisDetail {
    thesis: NewsThesis;
    updates: NewsThesisUpdate[];
    conviction_history: NewsThesisConvictionPoint[];
}

export interface NewsDailyJob {
    id: string;
    status: string;
    stage: string;
    stage_message: string;
    progress_pct: number;
    run_id?: number;
    model: string;
    error_message?: string;
    created_at: string;
    started_at?: string;
    finished_at?: string;
    updated_at: string;
}

export interface NewsMarketContextHistoryEntry {
    run_id: number;
    run_date: string;
    mode: string;
    context: NewsMarketContext;
    created_at: string;
}

export interface NewsDeduplicateResponse {
    merged: number;
    absorbed_slugs: string[];
}

export interface PatchNewsThesisRequest {
    title?: string;
    status?: string;
    conviction?: number;
    summary?: string;
    invalidation_trigger?: string;
    supporting_evidence?: string;
    opposing_evidence?: string;
    asset_classes?: string[];
}

export interface NewsBriefResponse {
    run: NewsRun | null;
    foundation_run: NewsRun | null;
    foundation_cohort?: NewsFoundationCohort | null;
    foundation_job?: NewsFoundationJob | null;
    daily_job?: NewsDailyJob | null;
    items: NewsItem[];
    theses: NewsThesis[];
    updates: NewsThesisUpdate[];
}

export interface PortfolioMemoRun {
    id: number;
    memo_job_id: string;
    run_id: string;
    mode: string;
    status: string;
    model: string;
    analysis_date: string;
    primary_theme: string;
    secondary_theme: string;
    overall_conviction: string;
    executive_summary: string;
    analyst_memo_markdown: string;
    chairman_memo_markdown: string;
    asset_class_targets: Array<Record<string, unknown>>;
    created_at: string;
    updated_at: string;
}

export interface PortfolioMemoPersistPayload {
    memo_job_id: string;
    run_id?: string;
    mode?: string;
    status?: string;
    model?: string;
    analysis_date?: string;
    primary_theme?: string;
    secondary_theme?: string;
    overall_conviction?: string;
    executive_summary?: string;
    analyst_memo_markdown?: string;
    chairman_memo_markdown?: string;
    asset_class_targets?: Array<Record<string, unknown>>;
    raw_result?: Record<string, unknown>;
}

export interface PortfolioMemoResponse {
    memo: PortfolioMemoRun | null;
}

export interface PortfolioHistoryAllocationRow {
    asset_class: string;
    display_name: string;
    display_order: number;
    weight_pct: number;
}

export interface PortfolioHistoryMemoSummary {
    id: number;
    memo_job_id: string;
    run_id: string;
    status: string;
    analysis_date: string;
    primary_theme: string;
    secondary_theme: string;
    overall_conviction: string;
    executive_summary: string;
}

export type PortfolioHistoryKind = 'memo' | 'target' | 'shape' | 'actual';

export interface PortfolioHistoryEntry {
    id: string;
    kind: PortfolioHistoryKind;
    occurred_at: string;
    status: string;
    title: string;
    subtitle?: string;
    source: string;
    memo_job_id?: string;
    plan_id?: number | null;
    snapshot_id?: number | null;
    source_snapshot_id?: number | null;
    statement_id?: number | null;
    total_value?: number | null;
    value_basis_at?: string;
    rows: PortfolioHistoryAllocationRow[];
    memo?: PortfolioHistoryMemoSummary | null;
}

export interface PortfolioHistoryResponse {
    entries: PortfolioHistoryEntry[];
    kind?: 'shape';
    next_before_id?: number;
}

export class SourceResearchAPIError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

// Paid submissions are never automatically retried. Callers retain the request ID
// across uncertain outcomes and only repeat it after an explicit user action.
async function sourceResearchFetch(path: string, init: RequestInit = {}): Promise<any> {
    const response = await apiFetch(`${API_BASE_URL}/source-research${path}`, {
        ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const fallback = response.status === 404 && path === '/templates'
            ? 'Source research is not available on this backend yet.'
            : 'Source research is unavailable. Reload its saved runs before submitting again.';
        throw new SourceResearchAPIError(typeof body?.error === 'string' ? body.error : fallback, response.status);
    }
    if (!body) throw new Error('The research response was unreadable. Check the saved request before submitting again.');
    return body;
}

export const api = {
    getWatchlistOpportunities: async (): Promise<import('./watchlist-opportunities').WatchlistAssessment> => {
        const res = await apiFetch(`${API_BASE_URL}/watchlist/opportunities`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Watchlist assessment unavailable');
        return res.json();
    },
    getWeightPolicy: async (): Promise<WeightPolicyResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/weight-policy`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Weight management could not be loaded');
        return res.json();
    },
    updateWeightPolicy: async (enabled: boolean, epoch: number): Promise<WeightPolicyResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/weight-policy`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, epoch }) });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async getSourceResearchTemplates(signal?: AbortSignal): Promise<SourceResearchCatalogue> {
        return sourceResearchFetch('/templates', { signal });
    },
    async getSourceResearchJobs(analysisId: number, signal?: AbortSignal): Promise<SourceResearchJob[]> {
        return sourceResearchFetch(`/jobs?analysis_id=${analysisId}`, { signal });
    },
    async getSourceResearchJob(id: string, signal?: AbortSignal): Promise<SourceResearchJob> {
        return sourceResearchFetch(`/jobs/${encodeURIComponent(id)}`, { signal });
    },
    async createSourceResearchJob(input: SourceResearchRequest): Promise<SourceResearchJob> {
        return sourceResearchFetch('/jobs', { method: 'POST', body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
    },
    async recoverSourceResearchJob(id: string, providerRunId: string): Promise<void> {
        await sourceResearchFetch(`/jobs/${encodeURIComponent(id)}/recover`, { method: 'POST', body: JSON.stringify({ provider_run_id: providerRunId }), signal: AbortSignal.timeout(40000) });
    },
    getDataFreshness: async (): Promise<DataFreshnessResponse> => {
        const response = await apiFetch(`${API_BASE_URL}/data-freshness`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Failed to check data freshness');
        return response.json();
    },
    getPortfolioInvestmentBrief: async (): Promise<import('./portfolio-investment-brief').PortfolioInvestmentBrief> => {
        const { readInvestmentBrief } = await import('./portfolio-investment-brief');
        const response = await apiFetch(`${API_BASE_URL}/settings`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Saved investment brief could not be loaded.');
        return readInvestmentBrief(await response.json());
    },
    savePortfolioInvestmentBrief: async (brief: import('./portfolio-investment-brief').PortfolioInvestmentBrief): Promise<void> => {
        const { PORTFOLIO_BRIEF_KEY, prepareInvestmentBrief } = await import('./portfolio-investment-brief');
        const value = JSON.stringify(prepareInvestmentBrief(brief));
        const response = await apiFetch(`${API_BASE_URL}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [PORTFOLIO_BRIEF_KEY]: value }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Your investment brief has not been saved.');
        const result = await response.json();
        if (result.status !== 'success' || result.updated?.[PORTFOLIO_BRIEF_KEY] !== value) throw new Error('The server did not confirm saving your investment brief.');
    },
    getInvestmentPlays: async (): Promise<SavedInvestmentPlay[]> => {
        const response = await apiFetch(`${API_BASE_URL}/settings`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Saved investment plays could not be loaded.');
        const settings = await response.json();
        if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('Saved investment plays could not be loaded.');
        return readInvestmentPlayLibrary(settings);
    },
    saveInvestmentPlays: async (updates: Record<string, string>): Promise<void> => {
        if (Object.keys(updates).some(key => !key.startsWith(INVESTMENT_PLAY_PREFIX))) throw new Error('Invalid investment play update.');
        const response = await apiFetch(`${API_BASE_URL}/settings`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Your investment plays have not been saved. Please retry.');
        const result = await response.json();
        if (result.status !== 'success' || Object.entries(updates).some(([key, value]) => result.updated?.[key] !== value)) {
            throw new Error('The server did not confirm saving your investment plays. Please retry.');
        }
    },
    getClassColourSettings: async (): Promise<Record<string, string>> => {
        const response = await apiFetch(`${API_BASE_URL}/settings`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Saved class colours could not be loaded.');
        const settings = await response.json();
        if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('Saved class colours could not be loaded.');
        return settings;
    },
    saveClassColour: async (code: string, colour: string): Promise<string> => {
        const key = `asset_class_colour:${code}`;
        const response = await apiFetch(`${API_BASE_URL}/settings`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: colour }), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('The colour could not be saved. Your previous colour is unchanged here.');
        const result = await response.json();
        if (result.status !== 'success' || typeof result.updated?.[key] !== 'string') throw new Error('The server did not confirm this colour. Reload the colours before retrying.');
        return result.updated[key];
    },
    // Alerts
    getAlerts: async (includeHistory = false): Promise<AlertResponse[]> => {
        const url = includeHistory
            ? `${API_BASE_URL}/alerts?includeHistory=true`
            : `${API_BASE_URL}/alerts`;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error('Failed to fetch alerts');
        return res.json();
    },

    createAlert: async (alert: {
        ticker: string;
        alert_type: string;
        strength: string;
        expiry_date?: string;
    }): Promise<AlertResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(alert),
        });
        if (!res.ok) throw new Error('Failed to create alert');
        return res.json();
    },

    dismissAlert: async (alertId: number): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/alerts/${alertId}/dismiss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('Failed to dismiss alert');
    },

    getSecurityActions: async (options?: {
        ticker?: string;
        includeHistory?: boolean;
    }): Promise<SecurityActionResponse[]> => {
        const params = new URLSearchParams();
        if (options?.ticker) params.set('ticker', options.ticker);
        if (options?.includeHistory) params.set('includeHistory', 'true');
        const suffix = params.size ? `?${params.toString()}` : '';
        const res = await apiFetch(`${API_BASE_URL}/security-actions${suffix}`);
        if (!res.ok) throw new Error('Failed to fetch security actions');
        return res.json();
    },

    recordSecurityActionExecution: async (
        actionId: number,
        notes = '',
        units?: number,
        exception?: { exception_reason: string; cash_value: number },
        expectedInstructionValue?: number,
    ): Promise<{ status: SecurityActionStatus }> => {
        const res = await apiFetch(
            `${API_BASE_URL}/security-actions/${actionId}/record-execution`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes, units, ...exception, expected_instruction_value: expectedInstructionValue }),
            },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    ignoreSecurityAction: async (
        actionId: number,
    ): Promise<{ status: SecurityActionStatus }> => {
        const res = await apiFetch(
            `${API_BASE_URL}/security-actions/${actionId}/ignore`,
            { method: 'POST' },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    overrideSecurityActionExit: async (
        actionId: number,
        reason: string,
        nextReviewAt?: string,
    ): Promise<{ status: SecurityActionStatus }> => {
        const res = await apiFetch(
            `${API_BASE_URL}/security-actions/${actionId}/override-exit`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reason,
                    ...(nextReviewAt ? { next_review_at: nextReviewAt } : {}),
                }),
            },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    getActiveAlerts: async (): Promise<ActiveAlertResponse[]> => {
        const res = await apiFetch(`${API_BASE_URL}/alerts/active`);
        if (!res.ok) throw new Error('Failed to fetch active alerts');
        const data = await res.json();
        // Ensure we always return an array, never null
        return Array.isArray(data) ? data : [];
    },

    setupActiveAlert: async (payload: {
        ticker: string;
        script: string;
        position_state?: 'BUY' | 'SELL';
        analyst_price_target?: number;
        company_name?: string;
    }): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/alerts/active/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to setup active alert');
    },

    removeActiveAlert: async (payload: {
        id?: number;
        ticker: string;
        script: string;
    }): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/alerts/active/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to remove active alert');
    },

    setAnalysisSecurityType: async (payload: {
        analysis_id?: number;
        name: string;
        ticker: string;
        primary_asset_class: string | null;
        security_type: string;
    }): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/security-type`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to set security type');
    },

    getUnmappedAlerts: async (): Promise<UnmappedAlert[]> => {
        const res = await apiFetch(`${API_BASE_URL}/alerts/unmapped`);
        if (!res.ok) throw new Error('Failed to fetch unmapped alerts');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    resolveAlertMapping: async (
        alertId: number,
        payload: {
            company_name: string;
            ticker: string;
            exchange_prefix?: string;
            add_to_watchlist?: boolean;
            asset_class?: string;
            template_id?: string;
        }
    ): Promise<{ status: string; message: string }> => {
        const res = await apiFetch(`${API_BASE_URL}/alerts/${alertId}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to resolve alert mapping');
        return res.json();
    },

    streamAlerts: (
        onAlert: (alert: AlertResponse) => void,
        onError?: (error: Error) => void,
    ) => {
        if (getAccessMode() === 'demo') return () => {};
        let eventSource: EventSource | null = null;
        let retryCount = 0;
        const maxRetries = 3;
        let isClosed = false;

        const connect = () => {
            if (isClosed || retryCount >= maxRetries) {
                return;
            }

            try {
                // EventSource cannot send headers; the backend accepts the
                // token as a query param on this route only.
                const streamToken = getApiToken();
                const streamUrl = getAccessMode() === 'owner' ? '/api/terminal/alerts/stream' : streamToken
                    ? `${API_BASE_URL}/alerts/stream?token=${encodeURIComponent(streamToken)}`
                    : `${API_BASE_URL}/alerts/stream`;
                eventSource = new EventSource(streamUrl);

                eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type !== 'connected') {
                            onAlert(data);
                        }
                        retryCount = 0; // Reset retry count on successful message
                    } catch (error) {
                        console.error(
                            '[ALPHA EDGE] Failed to parse SSE message:',
                            error,
                        );
                    }
                };

                eventSource.onerror = () => {
                    eventSource?.close();
                    retryCount++;

                    // Don't retry immediately, just gracefully degrade
                    if (onError && retryCount === 1) {
                        onError(
                            new Error(
                                'SSE connection failed - using polling mode',
                            ),
                        );
                    }
                };

                eventSource.onopen = () => {
                    retryCount = 0;
                };
            } catch {
                // EventSource is unavailable; the caller's polling continues.
            }
        };

        connect();

        return () => {
            isClosed = true;
            eventSource?.close();
        };
    },

    // DEPRECATED: getSecurities, updateSecurity (use statement_holdings instead)

    // Decisions
    getDecisions: async (limit = 500): Promise<DecisionResponse[]> => {
        const res = await apiFetch(`${API_BASE_URL}/decisions?limit=${limit}`);
        if (!res.ok) throw new Error('Failed to fetch decisions');
        return res.json();
    },

    createDecision: async (decision: DecisionRequest): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/decisions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(decision),
        });
        if (!res.ok) {
            const errorText = await res.text();
            console.error('[ALPHA EDGE] Decision creation failed:', res.status, errorText);
            throw new Error(`Failed to create decision: ${res.status} ${errorText}`);
        }
    },

    // Portfolio
    getPortfolio: async (): Promise<PortfolioResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/portfolio`);
        if (!res.ok) {
            throw new Error(`Failed to fetch portfolio: ${res.status} ${res.statusText}`);
        }
        return res.json();
    },

    // Statements & Holdings
    getLatestStatement: async (): Promise<LatestStatementResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/statements/latest`);
        if (!res.ok) {
            // Fallback: try getting statement by ID
            const statementsRes = await apiFetch(`${API_BASE_URL}/statements`);
            if (!statementsRes.ok) {
                throw new Error('Failed to fetch statements');
            }
            const statements = await statementsRes.json();
            if (
                !statements ||
                !Array.isArray(statements) ||
                statements.length === 0
            ) {
                throw new Error('No statements found');
            }

            // Get the most recent statement
            const latestId = statements[0].id;
            const detailRes = await apiFetch(
                `${API_BASE_URL}/statements/${latestId}`,
            );
            if (!detailRes.ok) {
                throw new Error('Failed to fetch statement detail');
            }
            return detailRes.json();
        }
        return res.json();
    },

    getPortfolioPerformance: async (): Promise<PortfolioPerformancePoint[]> => {
        const res = await apiFetch(`${API_BASE_URL}/performance/portfolio`);
        if (!res.ok) throw new Error('Failed to fetch portfolio performance');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    getAssetClassPerformance: async (): Promise<AssetClassPerformancePoint[]> => {
        const res = await apiFetch(`${API_BASE_URL}/performance/asset-classes`);
        if (!res.ok) throw new Error('Failed to fetch asset class performance');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    getSecurityPerformance: async (
        ticker: string,
    ): Promise<SecurityPerformancePoint[]> => {
        const res = await apiFetch(
            `${API_BASE_URL}/performance/security/${encodeURIComponent(ticker)}`,
        );
        if (!res.ok) throw new Error('Failed to fetch security performance');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    getPerformanceEvents: async (limit = 500): Promise<PerformanceEvent[]> => {
        const res = await apiFetch(`${API_BASE_URL}/performance/events?limit=${limit}`);
        if (!res.ok) throw new Error('Failed to fetch performance events');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    getSecurityPerformanceDirections: async (): Promise<
        SecurityPerformanceDirection[]
    > => {
        const res = await apiFetch(`${API_BASE_URL}/performance/security-directions`);
        if (!res.ok) throw new Error('Failed to fetch security directions');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    getNewsBrief: async (): Promise<NewsBriefResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/news/brief`);
        if (!res.ok) throw new Error('Failed to fetch news brief');
        return res.json();
    },

    runNewsBrief: async (
        mode: 'bootstrap' | 'daily' = 'daily',
        options: { sourceMemoJobId?: string } = {},
    ): Promise<NewsBriefResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/news/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode,
                source_memo_job_id: options.sourceMemoJobId || '',
            }),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to run news brief');
        }
        return res.json();
    },

    createNewsFoundationJob: async (
        options: { sourceMemoJobId?: string } = {},
    ): Promise<NewsFoundationJob> => {
        const res = await apiFetch(`${API_BASE_URL}/news/foundation-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_memo_job_id: options.sourceMemoJobId || '',
            }),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to start foundation job');
        }
        return res.json();
    },

    getNewsFoundationJob: async (jobId: string): Promise<NewsFoundationJob> => {
        const res = await apiFetch(`${API_BASE_URL}/news/foundation-jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to fetch foundation job');
        }
        return res.json();
    },

    // Async daily run job
    createNewsDailyJob: async (): Promise<NewsDailyJob> => {
        const res = await apiFetch(`${API_BASE_URL}/news/daily-jobs`, { method: 'POST' });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to start daily job');
        }
        return res.json();
    },

    getNewsDailyJob: async (jobId: string): Promise<NewsDailyJob> => {
        const res = await apiFetch(`${API_BASE_URL}/news/daily-jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to fetch daily job');
        }
        return res.json();
    },

    // Thesis management
    getNewsThesisDetail: async (thesisId: number): Promise<NewsThesisDetail> => {
        const res = await apiFetch(`${API_BASE_URL}/news/theses/${thesisId}`);
        if (!res.ok) throw new Error('Failed to fetch thesis detail');
        return res.json();
    },

    patchNewsThesis: async (thesisId: number, patch: PatchNewsThesisRequest): Promise<NewsThesis> => {
        const res = await apiFetch(`${API_BASE_URL}/news/theses/${thesisId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to update thesis');
        }
        if (res.status === 204) return {} as NewsThesis;
        return res.json();
    },

    deleteNewsThesis: async (thesisId: number): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/news/theses/${thesisId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to dismiss thesis');
    },

    getNewsThesisUpdates: async (thesisId: number): Promise<NewsThesisUpdate[]> => {
        const res = await apiFetch(`${API_BASE_URL}/news/theses/${thesisId}/updates`);
        if (!res.ok) throw new Error('Failed to fetch thesis updates');
        return res.json();
    },

    getNewsThesisConvictionHistory: async (thesisId: number): Promise<NewsThesisConvictionPoint[]> => {
        const res = await apiFetch(`${API_BASE_URL}/news/theses/${thesisId}/conviction-history`);
        if (!res.ok) throw new Error('Failed to fetch conviction history');
        return res.json();
    },

    markInvalidationChecked: async (thesisId: number): Promise<void> => {
        const res = await apiFetch(
            `${API_BASE_URL}/news/theses/${thesisId}/mark-invalidation-checked`,
            { method: 'POST' },
        );
        if (!res.ok) throw new Error('Failed to mark invalidation checked');
    },

    deduplicateNewsTheses: async (): Promise<NewsDeduplicateResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/news/deduplicate`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to deduplicate theses');
        return res.json();
    },

    getNewsMarketContextHistory: async (limit = 10): Promise<NewsMarketContextHistoryEntry[]> => {
        const res = await apiFetch(`${API_BASE_URL}/news/market-context-history?limit=${limit}`);
        if (!res.ok) throw new Error('Failed to fetch market context history');
        return res.json();
    },

    getLatestPortfolioMemo: async (): Promise<PortfolioMemoResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/portfolio-memos/latest`);
        if (!res.ok) throw new Error('Failed to fetch latest portfolio memo');
        return res.json();
    },

    getPortfolioMemo: async (jobId: string): Promise<PortfolioMemoResponse> => {
        const res = await apiFetch(
            `${API_BASE_URL}/portfolio-memos/${encodeURIComponent(jobId)}`,
        );
        if (!res.ok) throw new Error('Failed to fetch portfolio memo');
        return res.json();
    },

    getPortfolioHistory: async (limit = 120): Promise<PortfolioHistoryResponse> => {
        const res = await apiFetch(
            `${API_BASE_URL}/portfolio-history?limit=${Math.max(1, Math.min(250, limit))}`,
        );
        if (!res.ok) throw new Error('Failed to fetch portfolio history');
        return res.json();
    },

    getPortfolioShapeHistory: async (beforeId?: number): Promise<PortfolioHistoryResponse> => {
        const query = new URLSearchParams({ kind: 'shape', limit: '100' });
        if (beforeId !== undefined) query.set('before_id', String(beforeId));
        const res = await apiFetch(`${API_BASE_URL}/portfolio-history?${query}`);
        if (!res.ok) throw new Error('Failed to load approved shape history');
        return res.json();
    },

    savePortfolioMemo: async (payload: PortfolioMemoPersistPayload): Promise<PortfolioMemoResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/portfolio-memos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to save portfolio memo');
        }
        return res.json();
    },

    // Stock Analysis
    getAllAnalysis: async (): Promise<StockAnalysisResponse[]> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis`);
        if (!res.ok) throw new Error('Failed to fetch analysis data');
        return res.json();
    },

    refreshAnalysisPerformance: async (): Promise<{
        updated_tickers: number;
        points_upserted: number;
        errors: string[];
    }> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/performance/refresh`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to refresh analysis performance');
        return res.json();
    },

    upsertAnalysis: async (
        analysis: StockAnalysisRequest,
    ): Promise<StockAnalysisResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(analysis),
        });
        if (!res.ok) throw new Error('Failed to save analysis');
        return res.json();
    },

    updateAnalysis: async (
        id: number,
        analysis: Partial<StockAnalysisRequest>,
    ): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(analysis),
        });
        if (!res.ok) throw new Error('Failed to update analysis');
    },

    deleteAnalysis: async (id: number): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/${id}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete analysis');
    },

    refreshWatchlistPrices: async (): Promise<{
        updated: number;
        errors: string[];
        open_reviews: number;
        new_reviews: number;
    }> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/refresh-prices`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to refresh prices');
        return res.json();
    },

    getListingReviews: async (): Promise<ListingReview[]> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/listing-reviews`);
        if (!res.ok) throw new Error('Failed to fetch listing reviews');
        return res.json();
    },

    getAnnouncementSubscriptions: async (): Promise<{ items: AnnouncementSubscription[] }> => {
        const res = await apiFetch(`${API_BASE_URL}/announcement-subscriptions`);
        if (!res.ok) throw new Error('Announcement setup could not be loaded');
        const data = await res.json();
        if (!Array.isArray(data.items)) throw new Error('Announcement setup could not be loaded');
        return data;
    },
    updateAnnouncementSubscriptions: async (items: AnnouncementSetupUpdate[]): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/announcement-subscriptions`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
        });
        if (!res.ok) {
            const content = res.headers.get('content-type') || '';
            const error = content.includes('application/json') ? (await res.json()).error : await res.text();
            throw new Error(error || 'Announcement setup could not be saved');
        }
    },

    // LLM Council (Fly) proxy
    createCouncilAnalysisJob: async (
        payload: CouncilJobCreateRequest,
        supplementaryFile?: File | null,
    ): Promise<CouncilAnalysisJobResponse> => {
        const hasSupplementaryFile = typeof File !== 'undefined' && supplementaryFile instanceof File;
        const requestInit: RequestInit = hasSupplementaryFile
            ? (() => {
                const form = new FormData();
                Object.entries(payload || {}).forEach(([key, value]) => {
                    if (value === undefined || value === null || value === '') return;
                    form.append(key, String(value));
                });
                form.append('supplementary_file', supplementaryFile);
                return {
                    method: 'POST',
                    body: form,
                };
            })()
            : {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
            };
        return submitCouncilJob(apiFetch, requestInit, 45000, `${payload.job_type || 'stock'}:${payload.ticker || 'portfolio'}`);
    },

    getCouncilAnalysisJob: async (jobId: string): Promise<CouncilAnalysisJobResponse> => {
        const { response: res, body } = await fetchJsonWithRetry(
            `/api/council/jobs/${encodeURIComponent(jobId)}`,
            { method: 'GET' },
            { retries: 3, timeoutMs: 20000 }
        );
        if (!res.ok) {
            const detail = body?.detail ? `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}` : '';
            throw new Error(`Failed to load council job${detail}`);
        }
        return body;
    },

    getCouncilAnalysisResult: async (jobId: string): Promise<CouncilAnalysisResultResponse> => {
        const { response: res, body } = await fetchJsonWithRetry(
            `/api/council/jobs/${encodeURIComponent(jobId)}/result`,
            { method: 'GET' },
            { retries: 2, timeoutMs: 30000 }
        );
        if (!res.ok) {
            const detail = body?.detail ? `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}` : '';
            throw new Error(`Failed to load council job result${detail}`);
        }
        return body;
    },

    getLatestCouncilRunByTicker: async (ticker: string): Promise<CouncilLatestRunResponse> => {
        const { response: res, body } = await fetchJsonWithRetry(
            `/api/council/runs/latest?ticker=${encodeURIComponent(ticker)}`,
            { method: 'GET' },
            { retries: 2, timeoutMs: 30000 }
        );
        if (!res.ok) {
            if (res.status === 404) {
                throw new Error(`No saved council run for ${ticker}`);
            }
            const detail = body?.detail ? `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}` : '';
            throw new Error(`Failed to load latest council run${detail}`);
        }
        return body;
    },

    getCouncilRunsByTicker: async (ticker: string, limit = 20): Promise<CouncilRunListResponse> => {
        const { response: res, body } = await fetchJsonWithRetry(
            `/api/council/runs?ticker=${encodeURIComponent(ticker)}&limit=${encodeURIComponent(String(Math.max(1, limit)))}`,
            { method: 'GET' },
            { retries: 2, timeoutMs: 30000 }
        );
        if (!res.ok) {
            if (res.status === 404) {
                return { runs: [] };
            }
            const detail = body?.detail ? `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}` : '';
            throw new Error(`Failed to load council runs${detail}`);
        }
        return {
            runs: Array.isArray(body?.runs) ? body.runs : [],
        };
    },

    getCouncilRunById: async (runId: string): Promise<CouncilRunByIdResponse> => {
        const { response: res, body } = await fetchJsonWithRetry(
            `/api/council/runs/${encodeURIComponent(runId)}`,
            { method: 'GET' },
            { retries: 2, timeoutMs: 30000 }
        );
        if (!res.ok) {
            if (res.status === 404) {
                throw new Error(`Council run not found: ${runId}`);
            }
            const detail = body?.detail ? `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}` : '';
            throw new Error(`Failed to load council run${detail}`);
        }
        return body;
    },

    // Ticker enrichment
    autoAssignExchanges: async (items: ExchangeAssignmentTarget[]): Promise<{ results: ExchangeAssignmentResult[] }> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/exchanges/auto-assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
            signal: AbortSignal.timeout(45000),
        });
        if (!res.ok) {
            if (res.status === 404) throw new Error('Auto-assign is not available on this backend yet. Deploy the matching backend first.');
            throw new Error((await res.text()).trim() || 'Could not assign exchanges');
        }
        return res.json();
    },

    enrichTickers: async (): Promise<{
        message: string;
        count: number;
        total: number;
    }> => {
        const res = await apiFetch(`${API_BASE_URL}/enrich/tickers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('Failed to enrich tickers');
        return res.json();
    },

    // Company mappings
    renameAnalysis: async (analysisId: number, newName: string): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/${analysisId}/rename`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
        });
        if (!res.ok) {
            const detail = (await res.text()).trim();
            throw new Error(detail || 'Failed to rename');
        }
    },

    logContribution: async (analysisId: number): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/${analysisId}/contribute`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to log contribution');
    },

    contributeByName: async (name: string, ticker: string): Promise<{ id: number }> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/contribute-by-name`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, ticker }),
        });
        if (!res.ok) throw new Error('Failed to log contribution');
        return res.json();
    },

    updateTickerMapping: async (
        companyName: string,
        ticker: string,
        exchangePrefix: string,
        templateId?: string | null,
    ): Promise<void> => {
        const body: Record<string, string> = {
            company_name: companyName,
            ticker: ticker,
            exchange_prefix: exchangePrefix,
        };
        if (templateId) {
            body.template_id = templateId;
        }
        const res = await apiFetch(`${API_BASE_URL}/mappings/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([body]),
        });
        if (!res.ok) throw new Error('Failed to update ticker mapping');
    },

    // Holdings
    updateHoldingCash: async (
        id: number,
        cashReserve: number,
    ): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/holdings/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cash_reserve: cashReserve }),
        });
        if (!res.ok) throw new Error('Failed to update holding cash reserve');
    },

    // Security Positions
    getSecurityPositions: async (): Promise<SecurityPosition[]> => {
        const res = await apiFetch(`${API_BASE_URL}/positions`);
        if (!res.ok) throw new Error('Failed to fetch security positions');
        return res.json();
    },

    updateSecurityPosition: async (
        ticker: string,
        manual_override: boolean,
        position_state?: 'BUY' | 'SELL',
    ): Promise<void> => {
        const body: any = { manual_override };
        if (position_state) {
            body.position_state = position_state;
        }
        const res = await apiFetch(`${API_BASE_URL}/positions/${ticker}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to update security position');
    },

    // Stock Groups
    getStockGroups: async (): Promise<StockGroupsResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/groups`);
        if (!res.ok) throw new Error('Failed to fetch stock groups');
        return res.json();
    },

    saveStockGroups: async (
        groups: StockGroup[],
        assignments: StockGroupAssignment[],
    ): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups, assignments }),
        });
        if (!res.ok) {
            const errorText = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to save stock groups: ${res.status} ${res.statusText} - ${errorText}`);
        }
    },

    deleteStockGroup: async (groupId: string): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/groups/${groupId}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete stock group');
    },

    getAssetClasses: async (): Promise<AssetClass[]> => {
        const res = await apiFetch(`${API_BASE_URL}/asset-classes`);
        if (!res.ok) throw new Error('Failed to fetch asset classes');
        const data = await res.json();
        return Array.isArray(data)
            ? data.map((row) => ({
                  ...row,
                  class_type: row.class_type || 'ALLOCATION',
                  parent_code: row.parent_code || null,
                  analysis_eligible: row.analysis_eligible !== false,
                  instrument_scope: row.instrument_scope || 'BOTH',
                  risk_bucket: row.risk_bucket || row.quartile || '',
                  quartile: row.quartile || row.risk_bucket || '',
              }))
            : [];
    },

    createCustomAssetClass: async (payload: {
        display_name: string;
        quartile: string;
        instrument_scope?: string;
    }): Promise<AssetClass> => {
        const res = await apiFetch(`${API_BASE_URL}/asset-classes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to create custom asset class');
        }
        return res.json();
    },

    deleteCustomAssetClass: async (code: string): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/asset-classes/${encodeURIComponent(code)}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to delete custom asset class');
        }
    },

    // Sync Changes
    getSyncChanges: async (): Promise<SyncChange[]> => {
        const res = await apiFetch(`${API_BASE_URL}/sync/changes`);
        if (!res.ok) throw new Error('Failed to fetch sync changes');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    },

    acknowledgeSyncChanges: async (changeIds?: number[]): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/sync/changes/acknowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ change_ids: changeIds || [] }),
        });
        if (!res.ok) throw new Error('Failed to acknowledge sync changes');
    },

    getSyncHistory: async (): Promise<SyncHistory[]> => {
        const res = await apiFetch(`${API_BASE_URL}/sync/history`);
        if (!res.ok) throw new Error('Failed to fetch sync history');
        return res.json();
    },

    // Sync TradingView analyst price targets
    syncTradingViewData: async (): Promise<{
        message: string;
        updated: number;
        skipped: number;
        errors: number;
        total: number;
    }> => {
        const res = await apiFetch(`${API_BASE_URL}/sync/tradingview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('Failed to sync TradingView data');
        return res.json();
    },

    // ETF Management
    getETFPositions: async (): Promise<ETFPosition[]> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/positions`);
        if (!res.ok) throw new Error('Failed to fetch ETF positions');
        return res.json();
    },

    getETFAllocationLedger: async (): Promise<ETFAllocationLedgerResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/allocation-ledger`);
        if (!res.ok) throw new Error('Failed to fetch ETF allocation ledger');
        return res.json();
    },

    getETFMomentumWorkspace: async (): Promise<ETFMomentumWorkspaceResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/momentum`);
        if (!res.ok) throw new Error('Failed to fetch ETF momentum workspace');
        return res.json();
    },

    refreshETFMomentumPriceHistory: async (): Promise<ETFMomentumPriceRefreshResult> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/momentum/price-history/refresh`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to refresh ETF momentum price history');
        return res.json();
    },

    runETFMomentumParity: async (asOfDate?: string): Promise<ETFMomentumRunResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/momentum/runs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(asOfDate ? { as_of_date: asOfDate } : {}),
        });
        if (!res.ok) throw new Error('Failed to run ETF momentum parity');
        return res.json();
    },

    createETFMomentumTradingViewSnapshot: async (
        payload: ETFMomentumTradingViewSnapshotRequest,
    ): Promise<ETFMomentumTradingViewReferenceResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/momentum/tradingview-snapshots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text() || 'Failed to save TradingView snapshot');
        return res.json();
    },

    updateETFAssetClassMapping: async (
        ticker: string,
        payload: {
            asset_class?: string;
            display_name?: string;
            active?: boolean;
        }
    ): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/mappings/${encodeURIComponent(ticker)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update ETF asset class');
    },

    updateETFCorePolicy: async (
        assetClass: string,
        payload: {
            core_ticker?: string;
            core_ratio_pct?: number;
            momentum_influence_pct?: number;
        },
    ): Promise<ETFAllocationLedgerResponse> => {
        const res = await apiFetch(
            `${API_BASE_URL}/etf/core-policies/${encodeURIComponent(assetClass)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
        );
        if (!res.ok) throw new Error(await res.text() || 'Failed to update Core ETF policy');
        return res.json();
    },

    getETFManagementProfiles: async (): Promise<ETFManagementProfile[]> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/management`);
        if (!res.ok) throw new Error('Unable to load fund management modes');
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Invalid fund management response');
        return data;
    },

    updateETFManagement: async (ticker: string, payload: { mode: ETFManagementMode; previous_mode: ETFManagementMode; initial_state: 'BUY' | 'SELL' }): Promise<ETFManagementProfile> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/management/${encodeURIComponent(ticker)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text() || 'Unable to change management mode');
        return res.json();
    },

    updateETFPosition: async (
        ticker: string,
        update: {
            position_state?: 'BUY' | 'SELL';
            allocation_pct?: number;
            cash_allocated?: number;
            manual_override?: boolean;
        }
    ): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/positions/${ticker}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update),
        });
        if (!res.ok) throw new Error('Failed to update ETF position');
    },

    getActiveRebalance: async (): Promise<ETFRebalanceTarget[]> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/rebalance`);
        if (!res.ok) throw new Error('Failed to fetch active rebalance');
        return res.json();
    },

    dismissRebalance: async (sequenceNumber: number): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/etf/rebalance/${sequenceNumber}/dismiss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('Failed to dismiss rebalance');
    },

    // Regime Assignments
    getRegimeAssignments: async (): Promise<RegimeAssignment[]> => {
        const res = await apiFetch(`${API_BASE_URL}/regime-assignments`);
        if (!res.ok) throw new Error('Failed to fetch regime assignments');
        return res.json();
    },

    getRegimeProposedActions: async (): Promise<RegimeProposedActionsResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/regime/proposed-actions`);
        if (!res.ok) throw new Error('Failed to fetch regime proposed actions');
        return res.json();
    },

    applyRegimeImpacts: async (ids: number[], dismissIds: number[] = []): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/regime/apply-impacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, dismiss_ids: dismissIds }),
        });
        if (!res.ok) throw new Error('Failed to apply regime impacts');
    },

    getPortfolioOverlaySummary: async (): Promise<PortfolioOverlaySummaryResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/portfolio-overlay-summary`);
        if (!res.ok) throw new Error('Failed to fetch portfolio overlay summary');
        return res.json();
    },

    // Explicit signal-state reconciliation. The summary GET above is
    // read-only; all signal paths sync server-side at signal time, so this
    // is only needed as a recovery lever if overlay state ever drifts.
    syncPortfolioOverlay: async (): Promise<{
        status: string;
        effective_pct: number;
        governing_source: string;
        current_q1_exposure_pct: number;
        last_applied_q1_exposure_pct: number;
        pending_event_id?: number;
    }> => {
        const res = await apiFetch(`${API_BASE_URL}/portfolio-overlay/sync`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to sync portfolio overlay state');
        return res.json();
    },

    applyPortfolioOverlayStage1: async (payload?: {
        required_reduction_value?: number;
        recorded_reduction_value?: number;
        baseline_reserve_value?: number;
        expected_reserve_value?: number;
        sources?: Array<{
            holding_id?: number;
            stock_name: string;
            ticker?: string;
            asset_class: string;
            group_id?: string;
            group_label?: string;
            amount_sold: number;
        }>;
    }): Promise<{
        status: string;
        q1_exposure_pct?: number;
        last_applied_q1_exposure_pct?: number;
        event_id?: number | null;
        required_reduction_value?: number;
        recorded_reduction_value?: number;
        baseline_reserve_value?: number;
        expected_reserve_value?: number;
        cash_confirmation_status?: string;
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-overlay/apply-stage1`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || body?.message || 'Failed to apply Stage 1');
        }
        return body;
    },

    markPortfolioOverlayStage1Partial: async (): Promise<{
        status: string;
        event_id?: number;
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-overlay/mark-stage1-partial`,
            { method: 'POST' },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || body?.message || 'Failed to mark Stage 1 partial');
        }
        return body;
    },

    reopenPortfolioOverlayStage1: async (): Promise<{
        status: string;
        event_id?: number;
        q1_exposure_pct?: number;
        last_applied_q1_exposure_pct?: number;
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-overlay/reopen-stage1`,
            { method: 'POST' },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || body?.message || 'Failed to reopen Stage 1');
        }
        return body;
    },

    markPortfolioOverlaySignalReviewed: async (): Promise<{
        status: string;
        event_id?: number;
        q1_exposure_pct?: number;
        last_applied_q1_exposure_pct?: number;
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-overlay/mark-reviewed`,
            { method: 'POST' },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || body?.message || 'Failed to mark signal reviewed');
        }
        return body;
    },

    getPortfolioOverlayReconciliation: async (): Promise<PortfolioOverlayReconciliationResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/portfolio-overlay/reconciliation`);
        if (!res.ok) throw new Error('Failed to fetch portfolio overlay reconciliation');
        return res.json();
    },

    savePortfolioOverlayStage2: async (payload: {
        items: Array<{
            asset_class: string;
            target_pct: number | null;
        }>;
    }): Promise<{
        status: string;
        event_id?: number;
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-overlay/save-stage2`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || body?.message || 'Failed to save Stage 2');
        }
        return body;
    },

    completePortfolioOverlayStage2: async (): Promise<{
        status: string;
        event_id?: number;
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-overlay/complete-stage2`,
            { method: 'POST' },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || body?.message || 'Failed to complete Stage 2');
        }
        return body;
    },

    setPortfolioOverlayBaseline: async (): Promise<{
        status: string;
        q1_exposure_pct?: number;
        last_applied_q1_exposure_pct?: number;
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-overlay/set-baseline`,
            { method: 'POST' },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || body?.message || 'Failed to accept baseline');
        }
        return body;
    },

    getCurrentPortfolioMix: async (): Promise<PortfolioMixCurrentResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-mix/current`,
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to fetch current portfolio mix');
        }
        return body;
    },

    getApprovedPortfolioMix: async (): Promise<PortfolioMixSnapshotResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-mix/approved`,
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to fetch approved portfolio mix');
        }
        return body;
    },

    getPortfolioCyclePerformance: async (snapshotId: number): Promise<PortfolioCyclePerformance> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-mix/cycle-performance?snapshot_id=${snapshotId}`,
        );
        if (!response.ok) throw new Error(body?.error || 'Cycle performance unavailable');
        if (!Array.isArray(body?.classes) || !Array.isArray(body?.securities) || body?.cycle?.snapshot_id !== snapshotId) {
            throw new Error('Cycle performance unavailable for this approval');
        }
        return body;
    },

    getCommodityThemes: async (options: { includeSecurities?: boolean } = {}): Promise<CommodityThemesResponse> => {
        const query = options.includeSecurities ? '?include_securities=true' : '';
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/commodity-themes${query}`,
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to fetch commodity themes');
        }
        return body;
    },

    refreshCommodityThemePriceHistory: async (): Promise<{
        updated_sources: number;
        points_upserted: number;
        errors: string[];
    }> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/commodity-themes/price-history/refresh`,
            { method: 'POST' },
            { retries: 0, timeoutMs: 60000 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to refresh commodity price history');
        }
        return body;
    },

    getCommodityTheme: async (code: string): Promise<CommodityTheme> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/commodity-themes/${encodeURIComponent(code)}`,
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to fetch commodity theme');
        }
        return body;
    },

    updateCommodityThemeConfiguration: async (
        code: string,
        payload: CommodityThemeConfigurationPayload,
    ): Promise<CommodityTheme> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/commodity-themes/${encodeURIComponent(code)}/configuration`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to update market configuration');
        }
        return body;
    },

    createCommodityTheme: async (payload: CreateCommodityThemePayload): Promise<CommodityTheme> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/commodity-themes`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to add market');
        }
        return body;
    },

    deleteCommodityTheme: async (code: string): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/commodity-themes/${encodeURIComponent(code)}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            throw new Error(await res.text() || 'Failed to remove market');
        }
    },

    initialiseCommodityThemeFeed: async (payload: {
        theme: string;
        stage: 'COMMODITY' | 'EQUITY_RELATIVE' | 'SECURITY_OUTPERFORM';
        signal: 'BUY' | 'SELL';
        security?: { ticker: string };
    }): Promise<void> => {
        const res = await apiFetch(`${API_BASE_URL}/commodity-themes/initialise-feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text() || 'Failed to initialise commodity feed');
    },

    updateCommodityThemeDirectExpression: async (
        code: string,
        payload: {
            status: 'SIGNAL_ONLY' | 'APPROVED';
            instrument_label?: string;
            instrument_ticker?: string;
            instrument_kind?: string;
        },
    ): Promise<CommodityTheme> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/commodity-themes/${encodeURIComponent(code)}/direct-expression`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to update direct expression');
        }
        return body;
    },

    getPortfolioRiskHeaderState: async (): Promise<PortfolioRiskHeaderStateResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-risk/header-state`,
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to fetch portfolio risk header state');
        }
        return body;
    },

    approveCurrentPortfolioMix: async (payload: {
        reason?: string;
        notes?: string;
    } = {}): Promise<PortfolioMixSnapshotResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-mix/approve-current`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to approve current portfolio mix');
        }
        return body;
    },

    getCurrentPortfolioRebalance: async (): Promise<PortfolioRebalancePlanResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances/current`,
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to fetch current portfolio rebalance');
        }
        return body;
    },

    getCurrentPortfolioAdjustmentPlan: async (): Promise<AdjustmentPlanResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances/current/adjustment-plan`,
        );
        if (!response.ok) {
            throw new Error(
                body?.error || 'Failed to fetch current portfolio adjustment plan',
            );
        }
        return body;
    },

    getPortfolioAdjustmentPlan: async (
        id: number,
    ): Promise<AdjustmentPlanResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances/${id}/adjustment-plan`,
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to fetch portfolio adjustment plan');
        }
        return body;
    },

    createPortfolioRebalance: async (payload: {
        driver?: string;
        title?: string;
        notes?: string;
        memo_job_id?: string;
        rows: PortfolioRebalancePlanRow[];
    }): Promise<PortfolioRebalancePlanResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to create portfolio rebalance');
        }
        return body;
    },

    createPortfolioRebalanceFromMemo: async (payload: {
        title?: string;
        notes?: string;
        memo_job_id?: string;
        rows: PortfolioRebalancePlanRow[];
    }): Promise<PortfolioRebalancePlanResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances/from-memo`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to create memo rebalance');
        }
        return body;
    },

    markPortfolioRebalancePartial: async (
        id: number,
    ): Promise<PortfolioRebalancePlanResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances/${id}/mark-partial`,
            { method: 'POST' },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to mark rebalance partial');
        }
        return body;
    },

    completePortfolioRebalance: async (
        id: number,
        payload?: { rows?: PortfolioRebalancePlanRow[] },
    ): Promise<PortfolioRebalancePlanResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances/${id}/complete`,
            {
                method: 'POST',
                headers: payload
                    ? { 'Content-Type': 'application/json' }
                    : undefined,
                body: payload ? JSON.stringify(payload) : undefined,
            },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to complete rebalance');
        }
        return body;
    },

    approvePortfolioRebalance: async (
        id: number,
    ): Promise<PortfolioMixSnapshotResponse> => {
        const { response, body } = await fetchJsonWithRetry(
            `${API_BASE_URL}/portfolio-rebalances/${id}/approve`,
            { method: 'POST' },
            { retries: 0 },
        );
        if (!response.ok) {
            throw new Error(body?.error || 'Failed to approve rebalance');
        }
        return body;
    },

    getAssetClassConfig: async (): Promise<AssetClassConfig[]> => {
        const res = await apiFetch(`${API_BASE_URL}/asset-class-config`);
        if (!res.ok) throw new Error('Failed to fetch asset class config');
        return res.json();
    },

    updateAssetClassConfig: async (
        code: string,
        patch: Partial<AssetClassConfig>,
    ): Promise<AssetClassConfig> => {
        const res = await apiFetch(
            `${API_BASE_URL}/asset-class-config/${encodeURIComponent(code)}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            },
        );
        if (!res.ok) throw new Error('Failed to update asset class config');
        return res.json();
    },

    createCashMovement: async (payload: {
        asset_class_code: string;
        target_cash_reserve: number;
        source_type: CashMovementSourceType;
        note?: string;
    }): Promise<CashMovementResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/cash-movements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to record cash movement');
        }
        return res.json();
    },

    classifyAssetClass: async (payload: {
        company_name: string;
        ticker?: string | null;
        exchange_code?: string | null;
    }): Promise<AssetClassClassifierResponse> => {
        const res = await apiFetch(`${API_BASE_URL}/analysis/classify-asset-class`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(detail || 'Failed to classify asset class');
        }
        return res.json();
    },
};

export interface AssetClassClassifierResponse {
    asset_class: string;
    confidence: number;
    reason: string;
}

export interface ListingReview {
    id: number;
    security_id: number;
    analysis_id: number;
    name: string;
    ticker: string;
    review_type: 'NAME_CHANGE_CANDIDATE' | 'LISTING_UNAVAILABLE';
    provider: string;
    current_name: string;
    observed_name: string;
    current_ticker: string;
    observed_ticker: string;
    first_seen_at: string;
    last_seen_at: string;
    seen_count: number;
}

export interface StockAnalysisResponse {
    id: number;
    ticker: string | null;
    name: string;
    council_run_id: string | null;
    council_run_label: string | null;
    grok_quality: number;
    grok_value: number;
    gemini_quality: number;
    gemini_value: number;
    gpt_quality: number;
    gpt_value: number;
    deer_flow_quality: number;
    deer_flow_value: number;
    perplexity_quality: number;
    perplexity_value: number;
    claude_quality: number;
    claude_value: number;
    council_quality: number;
    council_value: number;
    grok_pt: number;
    gemini_pt: number;
    gpt_pt: number;
    deer_flow_pt: number;
    perplexity_pt: number;
    claude_pt: number;
    council_pt: number;
    gemini_webui_output?: string | null;
    gemini_webui_input_at?: string | null;
    perplexity_webui_output?: string | null;
    perplexity_webui_input_at?: string | null;
    gpt_webui_output?: string | null;
    gpt_webui_input_at?: string | null;
    claude_webui_output?: string | null;
    claude_webui_input_at?: string | null;
    council_source_output?: string | null;
    council_source_input_at?: string | null;
    current_price: number;
    tipranks_pt: number;
    analyst_pt: number;
    upside_24m: number;
    allocation: number;
    include_in_sizing?: boolean;
    performance_6m_pct?: number | null;
    performance_12m_pct?: number | null;
    performance_as_of?: string | null;
    performance_source?: string | null;
    market_cap: string | null;
    risk_profile: string | null;
    notes: string | null;
    thesis: string | null;
    bear_case_pt: number;
    base_case_pt: number;
    bull_case_pt: number;
    bear_probability: number;
    base_probability: number;
    bull_probability: number;
    catalysts: string | null;
    last_contributed_at: string | null;
    is_external: boolean;
    is_watchlist?: boolean;
    updated_at: string;
    created_at: string;
    primary_asset_class?: string | null;
    security_type?: string | null;
    overlay_sell_priority?: number | null;
}

export interface StockAnalysisRequest {
    ticker?: string | null;
    name: string;
    is_external?: boolean;
    council_run_id?: string | null;
    council_run_label?: string | null;
    grok_quality?: number;
    grok_value?: number;
    gemini_quality?: number;
    gemini_value?: number;
    gpt_quality?: number;
    gpt_value?: number;
    deer_flow_quality?: number;
    deer_flow_value?: number;
    perplexity_quality?: number;
    perplexity_value?: number;
    claude_quality?: number;
    claude_value?: number;
    council_quality?: number;
    council_value?: number;
    grok_pt?: number;
    gemini_pt?: number;
    gpt_pt?: number;
    deer_flow_pt?: number;
    perplexity_pt?: number;
    claude_pt?: number;
    council_pt?: number;
    gemini_webui_output?: string | null;
    gemini_webui_input_at?: string | null;
    perplexity_webui_output?: string | null;
    perplexity_webui_input_at?: string | null;
    gpt_webui_output?: string | null;
    gpt_webui_input_at?: string | null;
    claude_webui_output?: string | null;
    claude_webui_input_at?: string | null;
    council_source_output?: string | null;
    council_source_input_at?: string | null;
    tipranks_pt?: number;
    analyst_pt?: number;
    upside_24m?: number;
    allocation?: number;
    include_in_sizing?: boolean;
    market_cap?: string | null;
    risk_profile?: string | null;
    notes?: string | null;
    thesis?: string | null;
    bear_case_pt?: number;
    base_case_pt?: number;
    bull_case_pt?: number;
    bear_probability?: number;
    base_probability?: number;
    bull_probability?: number;
    catalysts?: string | null;
    is_watchlist?: boolean;
    primary_asset_class?: string | null;
    security_type?: string | null;
    overlay_sell_priority?: number | null;
}

export interface CouncilJobCreateRequest {
    job_type?: string;
    query?: string;
    ticker?: string;
    company_name?: string;
    template_id?: string | null;
    company_type?: string | null;
    exchange?: string | null;
    stage1_only?: boolean;
    stage2_revision_pass?: 'on' | 'off' | 'auto';
    secondary_chairman_model?: string;
    run_label?: string;
    diagnostic_mode?: boolean;
    label?: string;
    analysis_date?: string;
    is_synthetic?: boolean;
    reuse_recent_bundle?: boolean;
    reuse_supplementary_from_job_id?: string | null;
    supplementary_mode?: string | null;
    portfolio_positioning_mode?: string;
    portfolio_context?: Record<string, unknown>;
}

export interface CouncilAnalysisJobResponse {
    job_id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed';
    stage: string;
    stage_message: string;
    progress_pct: number;
    instance_id: string;
    created_at: string;
    started_at: string;
    finished_at: string;
    last_output_at: string;
    run_id: string;
    output_path: string;
    returncode: number | null;
    pid: number | null;
    error: string;
    stdout_tail: string;
    stderr_tail: string;
    request: Record<string, unknown>;
}

export interface CouncilReportPacket {
    contract: string;
    run_id: string;
    summary_fields: Record<string, any>;
    lab_payload: Record<string, any>;
    timeline_rows: Array<Record<string, any>>;
    memos: {
        analyst_memo_markdown?: string;
        chairman_memo_markdown?: string;
    };
}

export interface CouncilAnalysisResultResponse {
    job: CouncilAnalysisJobResponse;
    run: Record<string, any>;
    report_packet: CouncilReportPacket | null;
}

export interface CouncilLatestRunResponse {
    run_id: string;
    run_label: string;
    ticker: string;
    company_name: string;
    report_packet: CouncilReportPacket;
}

export interface CouncilRunListEntry {
    id: string;
    file?: string;
    label?: string;
    ticker?: string;
    company_name?: string;
    analysis_date?: string;
    updated_at?: string;
}

export interface CouncilRunListResponse {
    runs: CouncilRunListEntry[];
}

export interface CouncilRunByIdResponse {
    run_id: string;
    run_label: string;
    ticker: string;
    company_name: string;
    report_packet: CouncilReportPacket;
}

export interface SecurityPosition {
    id: number;
    ticker: string;
    position_state: 'BUY' | 'SELL';
    manual_override: boolean;
    last_updated: string;
    created_at: string;
}

export interface StockGroup {
    id: string;
    name: string;
    asset_class_code?: string | null;
    collapsed: boolean;
    order: number;
    parent_id?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface StockGroupAssignment {
    company_name: string;
    group_id: string;
    assigned_at?: string;
}

export interface StockGroupsResponse {
    groups: StockGroup[];
    assignments: StockGroupAssignment[];
}

export interface AssetClass {
    code: string;
    asset_class_code: string;
    display_name: string;
    class_type: string;
    parent_code?: string | null;
    allow_grouping: boolean;
    allow_target_weight: boolean;
    analysis_eligible: boolean;
    instrument_scope: string;
    risk_bucket?: string;
    quartile?: string;
    display_order: number;
    active: boolean;
}

export interface SyncChange {
    id: number;
    sync_id: number;
    change_type: 'ADDED' | 'UPDATED' | 'REMOVED';
    ticker: string;
    company_name: string;
    old_quantity?: number;
    new_quantity?: number;
    old_value?: number;
    new_value?: number;
    acknowledged: boolean;
    created_at: string;
}

export interface SyncHistory {
    id: number;
    sync_type: string;
    sync_status: 'success' | 'failed' | 'partial';
    total_changes: number;
    added_count: number;
    updated_count: number;
    removed_count: number;
    error_message?: string;
    synced_at: string;
}

export interface ETFPosition {
    id: number;
    ticker: string;
    position_state: 'BUY' | 'SELL';
    allocation_pct: number;
    cash_allocated: number;
    manual_override: boolean;
    last_updated: string;
    created_at: string;
}

export interface ETFRebalanceTarget {
    id: number;
    sequence_number: number;
    rebalance_date: string;
    ticker: string;
    rank?: number;
    return_60bar?: number;
    current_allocation: number;
    target_allocation: number;
    pending_delta?: number;
    status: 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'SUPERSEDED' | 'CANCELLED';
    weighted_portfolio_return?: number;
    created_at: string;
    expires_at?: string;
}

export type ETFManagementMode = 'etf_tms' | 'tms';
export interface ETFManagementProfile { ticker: string; mode: ETFManagementMode }

export interface ETFAllocationPolicy {
    suggested_exposure_pct: number;
    default_core_ratio_pct: number;
    momentum_influence_pct: number;
    momentum_source: 'LEGACY_COMPATIBILITY' | 'INTERNAL_PUBLISHED';
    /** @deprecated compatibility alias for suggested_exposure_pct */
    minimum_exposure_pct: number;
    /** @deprecated compatibility alias for default_core_ratio_pct */
    core_sleeve_ratio_pct: number;
}

export interface ETFAllocationLedgerSummary {
    portfolio_value: number;
    suggested_etf_value: number;
    suggested_exposure_pct: number;
    actual_exposure_pct: number;
    momentum_adjustment_value: number;
    recommended_target_value: number;
    effective_target_value: number;
    remaining_to_suggestion_value: number;
    minimum_etf_value: number;
    actual_etf_value: number;
    core_target_value: number;
    tactical_target_value: number;
    final_target_value: number;
    remaining_to_minimum_value: number;
    remaining_to_target_value: number;
    has_approved_shape: boolean;
}

export interface ETFAllocationClassSummary {
    asset_class: string;
    asset_class_name: string;
    class_target_value: number;
    core_ticker: string;
    core_selection_source: string;
    core_ratio_pct: number;
    momentum_influence_pct: number;
    core_base_value: number;
    momentum_adjustment_value: number;
    recommended_target_value: number;
    effective_target_value: number;
    effective_target_ratio_pct: number;
    actual_etf_value: number;
    target_delta_value: number;
    stock_capacity_value: number;
}

export interface ETFAllocationLedgerRow {
    management_mode?: ETFManagementMode;
    ticker: string;
    display_name: string;
    asset_class: string;
    asset_class_name: string;
    momentum_weight_pct: number;
    is_core: boolean;
    core_selection_source: string;
    core_ratio_pct: number;
    momentum_influence_pct: number;
    class_target_value: number;
    momentum_adjustment_value: number;
    recommended_target_value: number;
    effective_target_value: number;
    target_delta_value: number;
    book_target_pct: number;
    target_weight_pct: number;
    actual_value: number;
    core_target_value: number;
    tactical_target_value: number;
    final_target_value: number;
    core_actual_value: number;
    tactical_actual_value: number;
    excess_value: number;
    remaining_value: number;
    tactical_status: string;
    status: string;
    // The class is not an assignable sleeve at all.
    asset_class_unassignable?: boolean;
    // The class is valid but the approved shape carries no weight on it, so the
    // class target is $0 and nothing in it can be sized.
    class_not_in_shape?: boolean;
}

// A fund carrying an asset class that has neither been selected to express it
// nor bought. No target, no capital, never also a ledger row — watchlist only.
export interface ETFAllocationCandidate {
    ticker: string;
    display_name: string;
    asset_class: string;
    asset_class_name: string;
    momentum_weight_pct: number;
}

export interface ETFAllocationLedgerResponse {
    as_of: string;
    policy: ETFAllocationPolicy;
    summary: ETFAllocationLedgerSummary;
    classes: ETFAllocationClassSummary[];
    rows: ETFAllocationLedgerRow[];
    candidates?: ETFAllocationCandidate[];
}

export interface ETFMomentumPriceRefreshResult {
    updated_members: number;
    points_upserted: number;
    errors: string[];
}

export interface ETFMomentumRunRowResponse {
    ticker: string;
    display_name: string;
    tradingview_symbol: string;
    provider_symbol: string;
    price_date?: string;
    close_price?: number;
    data_points: number;
    return_80_pct?: number;
    momentum_240_pct?: number;
    volatility_240?: number;
    sharpe_proxy?: number;
    score?: number;
    rank?: number;
    decay?: number;
    raw_weight_pct?: number;
    capped_weight_pct?: number;
    final_weight_pct?: number;
    status: string;
    diagnostic?: string;
}

export interface ETFMomentumRunResponse {
    id: number;
    universe_code: string;
    algorithm_version: string;
    as_of_date: string;
    price_basis: string;
    provider: string;
    status: string;
    expected_members: number;
    ready_members: number;
    data_fresh_through?: string;
    comparison_status: string;
    created_at: string;
    published_at?: string;
    publication_reason?: string;
    rows: ETFMomentumRunRowResponse[];
}

export interface ETFMomentumAutomationStatus {
    enabled: boolean;
    daily_utc_hour: number;
    publish_cadence: 'MANUAL' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'EIGHTY_TRADING_DAYS';
    last_attempt_at?: string;
    last_success_at?: string;
    last_outcome: string;
    last_error?: string;
    published_run_id?: number;
    published_data_fresh_through?: string;
    trading_sessions_elapsed: number;
    trading_sessions_required: number;
}

export interface ETFMomentumTradingViewReferenceRowResponse {
    ticker: string;
    return_80_pct: number;
    momentum_240_pct: number;
    decay_pct: number;
    sharpe_proxy: number;
    score: number;
    rank: number;
    allocation_pct: number;
    internal_rank?: number;
    internal_return_80_pct?: number;
    internal_allocation_pct?: number;
    rank_delta?: number;
    return_80_delta_pct?: number;
    allocation_delta_pct?: number;
    comparison_status: string;
    action_required: boolean;
}

export interface ETFMomentumTradingViewSnapshotRequest {
    as_of_date: string;
    rows: Array<Pick<ETFMomentumTradingViewReferenceRowResponse,
        'ticker' | 'return_80_pct' | 'momentum_240_pct' | 'decay_pct' |
        'sharpe_proxy' | 'score' | 'rank' | 'allocation_pct'>>;
}

export interface ETFMomentumTradingViewReferenceResponse {
    id: number;
    source: string;
    rebalance_date: string;
    allocation_count: number;
    comparison_run_id?: number;
    comparison_status: string;
    comparison_summary?: string;
    allocation_drift_tolerance_pct: number;
    action_required_count: number;
    received_at: string;
    rows: ETFMomentumTradingViewReferenceRowResponse[];
}

export interface ETFMomentumWorkspaceResponse {
    universe_code: string;
    latest_run?: ETFMomentumRunResponse;
    published_run?: ETFMomentumRunResponse;
    automation: ETFMomentumAutomationStatus;
    latest_tradingview_reference?: ETFMomentumTradingViewReferenceResponse;
}

export interface RegimeAssignment {
    id: number;
    security_ticker: string;
    security_type: string;
    regime_ticker: string;
    created_at: string;
}

export interface RegimeProposedAction {
    id: number;
    regime_ticker: string;
    signal: string;
    ticker: string;
    security_type: string;
    action: string;
    target_position_pct: number;
    asset_classes_sell: string[];
    created_at: string;
}

export interface RegimeProposedActionsResponse {
    proposed_actions: RegimeProposedAction[];
    pending_count: number;
}

export interface AssetClassConfig {
    key: string;
    display_name: string;
    alert_label?: string | null;
    alert_color?: string | null;
    kind?: string | null;
    parent_code?: string | null;
    is_portfolio_sleeve?: boolean;
    is_system_bucket?: boolean;
    allow_grouping?: boolean;
    allow_target_weight?: boolean;
    sector?: string | null;
    overlay_eligible: boolean;
    display_order: number;
    q3_sell_priority?: number | null;
    q3_throttle_factor?: number | null;
    q4d_liquidity_factor?: number | null;
    q1_category: boolean;
    q3_beneficiary: boolean;
    regime_independent: boolean;
    q3_rating?: string | null;
    q3_logic?: string | null;
    stage2_target_pct?: number | null;
    cash_reserve: number;
    /** Fraction of the class capital budget allocated to individual stocks vs ETFs (0–1, default 0.75). */
    stock_allocation_ratio?: number | null;
    active: boolean;
}

export type CashMovementSourceType =
    | 'PORTFOLIO_CASH_TRANSFER'
    | 'STOCK_SALE'
    | 'EXTERNAL_CAPITAL';

export interface CashMovementRecord {
    id: number;
    asset_class_code: string;
    amount_delta: number;
    previous_cash_reserve: number;
    target_cash_reserve: number;
    source_type: CashMovementSourceType;
    note: string;
    status: 'PENDING' | 'CONFIRMED' | 'MISMATCH' | 'CANCELLED';
    created_at: string;
    confirmed_at?: string | null;
    statement_id?: number | null;
}

export interface CashMovementResponse {
    movement: CashMovementRecord;
    asset_class_config: AssetClassConfig;
}

export interface PortfolioMixRow {
    asset_class: string;
    display_name: string;
    display_order: number;
    governed_by_q1: boolean;
    weight_pct: number;
    invested_weight_pct: number;
    sleeve_cash_weight_pct: number;
    value: number;
    invested_value: number;
    sleeve_cash_value: number;
}

export interface PortfolioCashComponent {
    key: string;
    display_name: string;
    ticker?: string;
    value: number;
    weight_pct: number;
    display_order: number;
}

export interface PortfolioMixCurrentResponse {
    as_of: string;
    total_value: number;
    rows: PortfolioMixRow[];
    cash_components?: PortfolioCashComponent[];
}

export interface PortfolioMixSnapshotMeta {
    id: number;
    status: string;
    reason: string;
    source_rebalance_plan_id?: number | null;
    notes?: string;
    approved_at?: string | null;
    created_at?: string | null;
}

export interface PortfolioMixSnapshotResponse {
    snapshot: PortfolioMixSnapshotMeta | null;
    rows: PortfolioMixRow[];
    approval_policy?: { minimum_months: number; can_approve: boolean; next_allowed_at?: string };
}

export interface PortfolioCycleSecurityReturn {
    ticker: string;
    exchange: string;
    name: string;
    asset_class: string;
    opening_value_aud: number;
    return_pct: number | null;
    start_price_date?: string;
    end_price_date?: string;
    reason?: string;
}

export interface PortfolioCycleClassReturn {
    asset_class: string;
    return_pct: number | null;
    securities: number;
    covered: number;
    coverage_pct: number;
    reason?: string;
}

export interface PortfolioCyclePerformance {
    cycle: { snapshot_id: number; started_at: string; ended_at: string; closed: boolean } | null;
    baseline_at: string | null;
    method: string;
    classes: PortfolioCycleClassReturn[];
    securities: PortfolioCycleSecurityReturn[];
    best_performer: PortfolioCycleSecurityReturn | null;
    covered: number;
    reason?: string;
}

export type CommodityThemeStatus =
    | 'CONFIRMED'
    | 'PARTIAL'
    | 'BLOCKED'
    | 'WAITING'
    | 'DISCONNECTED';

export interface CommodityThemeSource {
    kind: string;
    symbol?: string;
    numerator?: string;
    denominator?: string;
    label?: string;
}

export interface CommodityThemeSourceConfiguration {
    label: string;
    symbol?: string;
    numerator?: string;
    denominator?: string;
}

export interface CommodityThemeConfigurationPayload {
    display_name: string;
    market_group: string;
    commodity: CommodityThemeSourceConfiguration;
    equity_relative: CommodityThemeSourceConfiguration;
}

export interface CreateCommodityThemePayload extends CommodityThemeConfigurationPayload {
    code: string;
    strategic_floor_asset_class_code: string;
    tactical_asset_class_code: string;
}

export interface CommodityThemeStage {
    key: string;
    order: number;
    scope: 'THEME' | 'SECURITY';
    label: string;
    status: CommodityThemeStatus;
    signal?: 'BUY' | 'SELL' | 'CONNECT';
    close?: number | null;
    return_60d_pct?: number | null;
    performance_as_of?: string | null;
    timeframe?: string;
    source: CommodityThemeSource;
    eligible_security_count?: number;
    blocked_security_count?: number;
    eligible_security_total?: number;
    last_confirmed_at?: string | null;
    last_event_at?: string | null;
}

export interface CommodityThemeAllocation {
    asset_class_code: string;
    target_value: number;
    actual_value: number;
}

export interface CommodityThemeClassCapital {
    asset_class_code: string;
    target_value: number;
    invested_value: number;
    sleeve_cash_value: number;
    capital_value: number;
    budget_approved: boolean;
}

export interface CommodityThemeDirectExpression {
    status: 'SIGNAL_ONLY' | 'APPROVED';
    instrument_label?: string;
    instrument_ticker?: string;
    instrument_kind?: string;
    existing_position_treatment: 'CLASS_DEFINED';
}

export interface CommodityThemeReview {
    key: 'DIRECT_VEHICLE_REVIEW' | 'EQUITY_CLASS_CASH_HELD';
    scope: 'DIRECT' | 'EQUITY';
    status: 'REVIEW' | 'HOLD';
    asset_class_code: string;
    label: string;
    detail: string;
}

export interface CommodityThemeTacticalAllocation {
    asset_class_code: string;
    maximum_value: number;
    permitted_value: number;
    actual_value: number;
    available_value: number;
    budget_approved: boolean;
}

export interface CommodityThemeSecurityEvent {
    signal: 'BUY' | 'SELL' | 'CONNECT';
    close?: number | null;
    source: CommodityThemeSource;
    script: string;
    timeframe: string;
    occurred_at?: string | null;
}

export interface CommodityThemeSecurity {
    security_id: number;
    ticker: string;
    name: string;
    include_in_sizing: boolean;
    stage_states: Record<string, CommodityThemeStatus>;
    latest_events: Record<string, CommodityThemeSecurityEvent | null>;
}

/** A producer ETF in the theme's equity class: its own CDF trend only, no Outperform. */
export interface CommodityThemeFund {
    security_id: number;
    ticker: string;
    name: string;
    trend_state: CommodityThemeStatus;
    trend_updated_at?: string | null;
}

export interface CommodityTheme {
    code: string;
    display_name: string;
    market_group?: string;
    status: CommodityThemeStatus;
    confirmation_count: number;
    confirmation_total: number;
    strategic_floor: CommodityThemeAllocation;
    tactical: CommodityThemeTacticalAllocation;
    direct_expression: CommodityThemeDirectExpression;
    direct_sleeve: CommodityThemeClassCapital;
    equity_sleeve: CommodityThemeClassCapital;
    reviews: CommodityThemeReview[];
    stages: CommodityThemeStage[];
    eligible_securities?: CommodityThemeSecurity[];
    producer_funds?: CommodityThemeFund[];
}

export interface CommodityThemesResponse {
    generated_at: string;
    themes: CommodityTheme[];
}

export interface PortfolioRiskHeaderQ3State {
    target_pct: number;
    source: string;
    active: boolean;
    spx_target_pct?: number | null;
    /** @deprecated Use spx_target_pct. */
    spy_target_pct?: number | null;
    xao_target_pct?: number | null;
    spx_last_updated?: string | null;
    /** @deprecated Use spx_last_updated. */
    spy_last_updated?: string | null;
    xao_last_updated?: string | null;
    last_signal_changed_at?: string | null;
    last_applied_pct?: number | null;
    last_applied_at?: string | null;
}

export interface PortfolioRiskHeaderQ4State {
    active: boolean;
    last_changed_at?: string | null;
    last_acknowledged_at?: string | null;
    reason: string;
    target_equity_pct: number;
    updated_at?: string | null;
}

export interface PortfolioRiskHeaderStateResponse {
    q3: PortfolioRiskHeaderQ3State | null;
    q4: PortfolioRiskHeaderQ4State | null;
    baseline_mix: PortfolioMixSnapshotResponse;
}

export interface PortfolioRebalancePlanRow {
    asset_class: string;
    display_name: string;
    display_order: number;
    governed_by_q1: boolean;
    current_weight_pct: number;
    target_weight_pct: number;
    delta_weight_pct: number;
    recorded_move_value?: number;
    note?: string;
}

export interface PortfolioRebalancePlan {
    id: number;
    status: 'OPEN' | 'PARTIAL' | 'COMPLETED' | 'APPROVED' | 'SUPERSEDED';
    driver: string;
    title?: string;
    notes?: string;
    memo_job_id?: string;
    source_snapshot_id?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
    completed_at?: string | null;
    approved_at?: string | null;
    rows: PortfolioRebalancePlanRow[];
}

export interface PortfolioRebalancePlanResponse {
    plan: PortfolioRebalancePlan | null;
}

export interface AdjustmentPlanRow {
    key: string;
    label: string;
    current_weight_pct: number;
    target_weight_pct: number;
    delta_weight_pct: number;
    current_value: number;
    target_value: number;
    delta_value: number;
    direction: 'increase' | 'decrease' | 'hold';
    required_value: number;
    recorded_value: number;
    remaining_value: number;
    status: string;
}

export interface AdjustmentImportCheck {
    key: string;
    label: string;
    expected_weight_pct: number;
    imported_weight_pct: number;
    variance_weight_pct: number;
    expected_value: number;
    imported_value: number;
    variance_value: number;
    status: 'MATCHED' | 'VARIANCE';
}

export interface AdjustmentImportValidation {
    passed: boolean;
    checked_rows: number;
    variance_rows: number;
    total_abs_variance_pct: number;
    total_abs_variance_value: number;
    tolerance_pct: number;
    tolerance_value: number;
    checks: AdjustmentImportCheck[];
}

export interface AdjustmentPlan {
    id: string;
    source_type: 'PORTFOLIO_TARGET' | 'Q3_SIGNAL' | 'Q4_SIGNAL' | 'MANUAL';
    source_id: number;
    source_status: string;
    title?: string;
    stage: 'review_target' | 'action_positions' | 'confirm_statement' | 'complete';
    status: string;
    total_value: number;
    required_decrease_value: number;
    recorded_decrease_value: number;
    remaining_decrease_value: number;
    required_increase_value: number;
    recorded_increase_value: number;
    remaining_increase_value: number;
    tolerance_value: number;
    ready_to_confirm: boolean;
    rows: AdjustmentPlanRow[];
    import_validation?: AdjustmentImportValidation | null;
    created_at?: string | null;
    updated_at?: string | null;
    completed_at?: string | null;
    approved_at?: string | null;
}

export interface AdjustmentPlanResponse {
    plan: AdjustmentPlan | null;
}

export interface UnmappedAlert {
    id: number;
    ticker: string;
    exchange_prefix: string;
    alert_type: string;
    strength: string | null;
    created_at: string;
}

export interface PortfolioOverlaySummaryResponse {
    total_portfolio_value?: number;
    total_invested?: number;
    total_cash?: number;
    effective_equity_pct?: number | null;
    overlay_multiplier?: number | null;
    spx_target_pct?: number | null;
    /** @deprecated Use spx_target_pct. */
    spy_target_pct?: number | null;
    xao_target_pct?: number | null;
    governing_source?: string | null;
    strategic_weight_source?: string | null;
    overlay_status?: 'REDUCE' | 'HEADROOM_AVAILABLE' | 'NO_DATA' | 'OK' | string | null;
    portfolio_value?: number;
    portfolio_cash_bucket_value?: number;
    portfolio_cash_bucket_pct?: number;
    actual_eligible_invested_pct?: number;
    actual_eligible_invested_value?: number;
    allowed_eligible_invested_pct?: number;
    allowed_eligible_invested_value?: number;
    required_de_risk_pct?: number;
    required_de_risk_value?: number;
    available_headroom_pct?: number;
    available_headroom_value?: number;
    total_tactical_cash_value?: number;
    total_tactical_cash_pct?: number;
    last_applied_q1_exposure_pct?: number;
    signal_adjustment_ratio?: number;
    active_event_id?: number | null;
    active_event_status?: string | null;
    active_event_governing_source?: string | null;
    active_event_triggered_at?: string | null;
    active_event_from_q1_exposure_pct?: number | null;
    active_event_to_q1_exposure_pct?: number | null;
    active_event_stage1_applied_at?: string | null;
    stage1_required_reduction_value?: number;
    stage1_recorded_reduction_value?: number;
    stage1_baseline_reserve_value?: number;
    stage1_expected_reserve_value?: number;
    stage1_import_baseline_at?: string | null;
    reserve_confirmed_at?: string | null;
    reserve_confirmed_value?: number | null;
    reserve_variance?: number | null;
    cash_confirmation_status?: string | null;
    can_apply_stage1?: boolean;
    can_complete_stage2?: boolean;
    can_accept_baseline?: boolean;
    last_signal_changed_at?: string | null;
    last_applied_at?: string | null;
    using_stage1_snapshot?: boolean;
    stage1_snapshot_at?: string | null;
    q4_crisis?: {
        active: boolean;
        last_changed_at?: string | null;
        last_acknowledged_at?: string | null;
        reason?: string | null;
        target_equity_pct?: number;
        updated_at?: string | null;
    };
    portfolio_risk?: {
        mode?: 'NORMAL' | 'Q3_THROTTLE' | 'Q4_CRISIS' | string;
        label?: string;
        priority?: number;
        target_pct?: number;
        target_kind?: 'NONE' | 'Q1_EXPOSURE' | 'MARKET_EXPOSURE' | string;
        active_reason?: string | null;
        inputs?: {
            q3?: {
                active?: boolean;
                spx_target_pct?: number | null;
                /** @deprecated Use spx_target_pct. */
                spy_target_pct?: number | null;
                xao_target_pct?: number | null;
                effective_target_pct?: number | null;
                governing_source?: string | null;
            };
            q4?: {
                active?: boolean;
                target_pct?: number;
                reason?: string | null;
                last_changed_at?: string | null;
                last_acknowledged_at?: string | null;
                updated_at?: string | null;
            };
        };
    };
    stage2_workflow?: {
        mode?: string;
        playbook_label?: string;
        event_status?: string;
        regime_cash_value?: number;
        regime_cash_pct?: number;
        allocated_pct?: number;
        allocated_value?: number;
        remaining_pct?: number;
        remaining_value?: number;
        items?: Array<{
            asset_class: string;
            display_name: string;
            display_order?: number;
            target_pct?: number;
            target_value?: number;
            default_target_pct?: number | null;
            current_invested_pct?: number;
            current_invested_value?: number;
            overlay_eligible?: boolean;
            q3_beneficiary?: boolean;
            regime_independent?: boolean;
            q3_rating?: string | null;
            q3_logic?: string | null;
        }>;
    };
    asset_classes: Array<{
        asset_class: string;
        display_name: string;
        overlay_eligible?: boolean;
        display_order?: number;
        strategic_weight_pct?: number;
        strategic_weight_source?: string;
        trigger_invested_pct?: number;
        trigger_invested_value?: number;
        trigger_tactical_cash_pct?: number;
        trigger_tactical_cash_value?: number;
        trigger_total_class_pct?: number;
        trigger_total_class_value?: number;
        allowed_invested_pct?: number;
        allowed_invested_value?: number;
        actual_invested_pct?: number;
        actual_invested_value?: number;
        tactical_cash_pct?: number;
        tactical_cash_value?: number;
        total_class_capital_pct?: number;
        total_class_capital_value?: number;
        delta_pct?: number;
        delta_value?: number;
        q3_sell_priority?: number | null;
        q3_throttle_factor?: number | null;
        q4d_liquidity_factor?: number | null;
        stage2_target_pct?: number | null;
        stage2_target_value?: number | null;
        stage1_recorded_reduction?: number;
        invested_value?: number;
        tactical_cash_value_legacy?: number;
        total_capital?: number;
        portfolio_weight_pct?: number;
        target_weight_pct?: number | null;
        governed_by_q1?: boolean;
    }>;
    settings?: Array<{
        key: string;
        display_name: string;
        overlay_eligible?: boolean;
        display_order?: number;
        q3_sell_priority?: number | null;
        q3_throttle_factor?: number | null;
        q4d_liquidity_factor?: number | null;
        q1_category?: boolean;
        q3_beneficiary?: boolean;
        regime_independent?: boolean;
        q3_rating?: string | null;
        q3_logic?: string | null;
        active?: boolean;
    }>;
    positions?: Array<{
        ticker: string;
        name: string;
        asset_class: string;
        value?: number;
        cash?: number;
        portfolio_pct?: number;
        q1_governed?: boolean;
    }>;
    updated_at?: string | null;
}

export interface PortfolioOverlayReconciliationResponse {
    event_id: number;
    event_status: string;
    cash_confirmation_status?: string | null;
    stage1_applied_at?: string | null;
    import_received?: boolean;
    source_status?: string;
    asset_class_status?: string;
    overall_status?: string;
    cash: {
        baseline_reserve_value: number;
        expected_reserve_value: number;
        imported_reserve_value: number;
        reserve_variance: number;
        status: string;
        confirmed_at?: string | null;
        latest_import_at?: string | null;
        tolerance?: number;
    };
    source_checks: Array<{
        id: number;
        holding_id?: number | null;
        stock_name: string;
        ticker: string;
        asset_class: string;
        group_id?: string;
        group_label?: string;
        before_value: number;
        expected_reduction: number;
        expected_after_value: number;
        imported_value: number;
        actual_reduction: number;
        variance: number;
        status: string;
    }>;
    asset_class_checks: Array<{
        asset_class: string;
        display_name: string;
        before_value: number;
        expected_reduction: number;
        expected_after_value: number;
        imported_value: number;
        actual_reduction: number;
        variance: number;
        status: string;
    }>;
}

// Maps Alpha Edge asset-class codes and legacy sleeve names to llm-council template ids.
export const REGIME_TO_TEMPLATE: Record<string, string> = {
    GOLD: 'gold_miner',
    GOLDMINERS: 'gold_miner',
    SILVER: 'silver_miner',
    SILVERMINERS: 'silver_miner',
    COPPER: 'copper_miner',
    COPPERMINERS: 'copper_miner',
    BASEMETALS: 'base_metals_miner',
    BASEMETALSMINERS: 'base_metals_miner',
    URANIUM: 'uranium_miner',
    URANIUMMINERS: 'uranium_miner',
    MATERIALS: 'diversified_miner',
    DIVERSIFIEDMINERS: 'diversified_miner',
    IRON: 'iron_ore_miner',
    IRONOREMINERS: 'iron_ore_miner',
    ALUMINIUM: 'bauxite_miner',
    REE: 'rare_earths_critical_minerals',
    RAREEARTHSCRITICALMINERALS: 'rare_earths_critical_minerals',
    LITHIUM: 'lithium_miner',
    LITHIUMMINERS: 'lithium_miner',
    MATERIALSCHEMICALS: 'chemicals_materials',
    STEELMETALSPROCESSING: 'steel_base_metals_processing',
    MININGSERVICES: 'mining_services',
    FORESTRYPAPERPACKAGING: 'forestry_paper_packaging',
    PHARMA: 'pharma_biotech',
    PHARMABIOTECH: 'pharma_biotech',
    HEALTHCARE: 'healthcare_services',
    HEALTHCARESERVICES: 'healthcare_services',
    MEDTECH: 'medtech',
    ENERGY: 'energy_oil_gas',
    ENERGYPRODUCERS: 'energy_oil_gas',
    BANKS: 'bank_financials',
    FINANCIALS: 'financials_bank_insurance',
    INSURANCE: 'insurance',
    STAPLES: 'consumer_staples',
    CONSUMERSTAPLES: 'consumer_staples',
    CONSUMERDISCRETIONARY: 'consumer_retail',
    GAMBLING: 'gambling',
    GAMING: 'gaming_interactive',
    GAMINGGAMBLING: 'gambling',
    TECHNOLOGY: 'technology_platforms',
    TECHNOLOGYPLATFORMS: 'technology_platforms',
    SOFTWARESAAS: 'software_saas',
    CRYPTODIGITALASSETS: 'crypto_digital_assets',
    DATACENTRES: 'datacentres',
    SEMICONDUCTORS: 'semiconductors',
    TELECOMMUNICATIONS: 'telecommunications',
    INDUSTRIALS: 'industrials',
    CONSTRUCTIONENGINEERING: 'construction_engineering',
    TRANSPORTLOGISTICS: 'transport_logistics',
    CIVILAEROSPACE: 'civil_aerospace',
    INFRASTRUCTURE: 'infrastructure',
    DEFENCE: 'defence',
    UTILITIES: 'utilities',
    REALESTATEREIT: 'real_estate_reit',
    FIXEDINCOME: 'fixed_income',
    BONDS: 'fixed_income',
    BROADEQUITY: 'general_equity',
    EQUITY: 'general_equity',
    AGRICULTUREAGRIBUSINESS: 'agriculture_agribusiness',
    EDUCATION: 'education',
    MEDIAPUBLISHING: 'media_publishing',
}

export function getCouncilTemplateForAssetClass(assetClass?: string | null): string | undefined {
    if (!assetClass) return undefined
    const key = assetClass.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    return REGIME_TO_TEMPLATE[key] ?? undefined
}

// ---------------------------------------------------------------------------
// Sizing engine types — mirror backend/sizing.go structs
// ---------------------------------------------------------------------------

export interface ClassBudget {
    asset_class: string;
    /** Requests anchored advice; the backend resolves the approved class and occupied ETF capacity. */
    class_budget: number;
    /** Legacy compatibility input. Current clients must not calculate this independently. */
    stock_budget?: number;
}

export interface SizingStockInput {
    id: number;
    ticker: string;
    /** Canonical asset class code — enables per-class normalisation in the sizing engine. */
    asset_class?: string;
    gemini_quality: number;
    gemini_value: number;
    gpt_quality: number;
    gpt_value: number;
    perplexity_quality: number;
    perplexity_value: number;
    claude_quality: number;
    claude_value: number;
    council_quality: number;
    council_value: number;
    grok_pt: number;
    gemini_pt: number;
    gpt_pt: number;
    deer_flow_pt: number;
    perplexity_pt: number;
    claude_pt: number;
    council_pt: number;
    tipranks_pt: number;
    analyst_pt: number;
    current_price: number;
    performance_6m_pct: number | null;
}

export interface SizingResult {
    id: number;
    ticker: string;
    asset_class?: string;
    base_rating: number;
    /** True only when at least one primary model run has Q, V, and its own PT. */
    eligible_for_target_weight?: boolean;
    performance_score?: number;
    composite_score: number;
    avg_pt: number;
    upside_pct: number;
    router_score?: number;
    router_multiplier: number;
    raw_weight: number;
    effective_weight: number;
    /** Percentage share within the stock's asset class (0–100). */
    allocation_pct: number;
    /** Anchored dollar amount when class_budgets were provided; otherwise pct × portfolio value. */
    allocation_dollar: number;
}

export interface SizingResponse {
    results: SizingResult[];
    total_portfolio_value: number;
    router_scores_applied: boolean;
    /** True when per-class budgets drove the dollar amounts (anchored mode). */
    class_budgets_applied: boolean;
    /** Identifies the budget source; current anchored advice includes held ETF capital. */
    class_budget_source: string;
    /** Live research output does not approve or change executable security targets. */
    advisory_only?: boolean;
}

// postSizingAllocations calls POST /api/sizing/allocations on the trading
// backend. routerScores and classBudgets are optional.
export async function postSizingAllocations(
    stocks: SizingStockInput[],
    totalPortfolioValue: number,
    routerScores?: Record<string, number>,
    classBudgets?: ClassBudget[],
): Promise<SizingResponse> {
    const res = await apiFetch(`${API_BASE_URL}/sizing/allocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            stocks,
            total_portfolio_value: totalPortfolioValue,
            router_scores: routerScores ?? {},
            ...(classBudgets && classBudgets.length > 0 ? { class_budgets: classBudgets } : {}),
        }),
    });
    if (!res.ok) throw new Error(`Sizing allocations request failed: ${res.status}`);
    return res.json();
}
