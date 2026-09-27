package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

type newsRun struct {
	ID                 int64             `json:"id"`
	RunDate            string            `json:"run_date"`
	Mode               string            `json:"mode"`
	Status             string            `json:"status"`
	Model              string            `json:"model"`
	SourceType         string            `json:"source_type"`
	SourceID           string            `json:"source_id"`
	FoundationCohortID int64             `json:"foundation_cohort_id,omitempty"`
	DailySummary       string            `json:"daily_summary"`
	MarketContext      newsMarketContext `json:"market_context"`
	ErrorMessage       string            `json:"error_message,omitempty"`
	CreatedAt          string            `json:"created_at"`
	UpdatedAt          string            `json:"updated_at"`
}

type newsMarketContext struct {
	TopThemes12M       []string `json:"top_themes_12m"`
	TopPerformers12M   []string `json:"top_performers_12m"`
	WorstPerformers12M []string `json:"worst_performers_12m"`
	NewsThemes1M       []string `json:"news_themes_1m"`
	TopPerformers1M    []string `json:"top_performers_1m"`
	WorstPerformers1M  []string `json:"worst_performers_1m"`
}

type newsItem struct {
	ID           int64    `json:"id"`
	RunID        int64    `json:"run_id"`
	Headline     string   `json:"headline"`
	Summary      string   `json:"summary"`
	Timeframe    string   `json:"timeframe"`
	Sentiment    string   `json:"sentiment"`
	ImpactScore  float64  `json:"impact_score"`
	Sources      []string `json:"sources"`
	AssetClasses []string `json:"asset_classes"`
	Tags         []string `json:"tags"`
	CreatedAt    string   `json:"created_at"`
}

type newsThesis struct {
	ID                     int64    `json:"id"`
	Slug                   string   `json:"slug"`
	FoundationCohortID     int64    `json:"foundation_cohort_id,omitempty"`
	Title                  string   `json:"title"`
	Timeframe              string   `json:"timeframe"`
	Status                 string   `json:"status"`
	Conviction             float64  `json:"conviction"`
	RelevanceScore         float64  `json:"relevance_score"`
	Summary                string   `json:"summary"`
	AssetClasses           []string `json:"asset_classes"`
	Tags                   []string `json:"tags"`
	SourceType             string   `json:"source_type"`
	SourceID               string   `json:"source_id"`
	SourceExcerpt          string   `json:"source_excerpt"`
	SupportingEvidence     string   `json:"supporting_evidence"`
	OpposingEvidence       string   `json:"opposing_evidence"`
	InvalidationTrigger    string   `json:"invalidation_trigger"`
	InvalidationCheckDueAt string   `json:"invalidation_check_due_at,omitempty"`
	StaleInvalidation      bool     `json:"stale_invalidation"`
	CreatedAt              string   `json:"created_at"`
	UpdatedAt              string   `json:"updated_at"`
	LastUpdatedAt          string   `json:"last_updated_at"`
	ResolvedAt             string   `json:"resolved_at,omitempty"`
}

type newsThesisUpdate struct {
	ID              int64    `json:"id"`
	ThesisID        int64    `json:"thesis_id"`
	RunID           int64    `json:"run_id"`
	Relationship    string   `json:"relationship"`
	Sentiment       string   `json:"sentiment"`
	Evidence        string   `json:"evidence"`
	ConvictionDelta float64  `json:"conviction_delta"`
	Sources         []string `json:"sources"`
	CreatedAt       string   `json:"created_at"`
}

type newsThesisConvictionPoint struct {
	RunID      int64   `json:"run_id"`
	Conviction float64 `json:"conviction"`
	RecordedAt string  `json:"recorded_at"`
}

type newsBriefResponse struct {
	Run              *newsRun              `json:"run"`
	FoundationRun    *newsRun              `json:"foundation_run"`
	FoundationCohort *newsFoundationCohort `json:"foundation_cohort,omitempty"`
	FoundationJob    *newsFoundationJob    `json:"foundation_job,omitempty"`
	DailyJob         *newsDailyJob         `json:"daily_job,omitempty"`
	Items            []newsItem            `json:"items"`
	Theses           []newsThesis          `json:"theses"`
	Updates          []newsThesisUpdate    `json:"updates"`
}

type newsRunRequest struct {
	Mode            string `json:"mode"`
	SourceMemoJobID string `json:"source_memo_job_id"`
}

var (
	newsXAIResponsesURL = "https://api.x.ai/v1/responses"
	newsXAIHTTPClient   = http.DefaultClient
)

type newsNarrativeModelPayload struct {
	DailySummary  string                     `json:"daily_summary"`
	MarketContext newsMarketContext          `json:"market_context"`
	NewsItems     []newsNarrativeModelItem   `json:"news_items"`
	ThesisUpdates []newsNarrativeModelUpdate `json:"thesis_updates"`
}

type newsNarrativeModelItem struct {
	Headline     string   `json:"headline"`
	Summary      string   `json:"summary"`
	Timeframe    string   `json:"timeframe"`
	Sentiment    string   `json:"sentiment"`
	ImpactScore  float64  `json:"impact_score"`
	Sources      []string `json:"sources"`
	AssetClasses []string `json:"asset_classes"`
	Tags         []string `json:"tags"`
}

type newsNarrativeModelUpdate struct {
	Slug                string   `json:"slug,omitempty"`
	Title               string   `json:"title"`
	Timeframe           string   `json:"timeframe"`
	Status              string   `json:"status"`
	Relationship        string   `json:"relationship"`
	Sentiment           string   `json:"sentiment"`
	Conviction          float64  `json:"conviction"`
	ConvictionDelta     float64  `json:"conviction_delta"`
	Summary             string   `json:"summary"`
	Evidence            string   `json:"evidence"`
	SupportingEvidence  string   `json:"supporting_evidence"`
	OpposingEvidence    string   `json:"opposing_evidence"`
	InvalidationTrigger string   `json:"invalidation_trigger"`
	SourceExcerpt       string   `json:"source_excerpt"`
	Sources             []string `json:"sources"`
	AssetClasses        []string `json:"asset_classes"`
	Tags                []string `json:"tags"`
}

func ensureNewsNarrativeSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS news_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_date DATE NOT NULL,
			mode TEXT NOT NULL DEFAULT 'DAILY',
			status TEXT NOT NULL DEFAULT 'COMPLETED',
			model TEXT NOT NULL DEFAULT '',
			daily_summary TEXT NOT NULL DEFAULT '',
			market_context_json TEXT NOT NULL DEFAULT '{}',
			raw_response_json TEXT NOT NULL DEFAULT '{}',
			error_message TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_news_runs_date ON news_runs(run_date DESC, created_at DESC);
		CREATE TABLE IF NOT EXISTS news_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL,
			headline TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			timeframe TEXT NOT NULL DEFAULT '1D',
			impact_score REAL NOT NULL DEFAULT 0,
			sources_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (run_id) REFERENCES news_runs(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_news_items_run ON news_items(run_id);
		CREATE INDEX IF NOT EXISTS idx_news_items_timeframe ON news_items(timeframe, impact_score DESC);

		CREATE TABLE IF NOT EXISTS news_theses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			slug TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			conviction REAL NOT NULL DEFAULT 0.5,
			summary TEXT NOT NULL DEFAULT '',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			source_type TEXT NOT NULL DEFAULT '',
			source_id TEXT NOT NULL DEFAULT '',
			source_excerpt TEXT NOT NULL DEFAULT '',
			supporting_evidence TEXT NOT NULL DEFAULT '',
			opposing_evidence TEXT NOT NULL DEFAULT '',
			invalidation_trigger TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			resolved_at DATETIME
		);

		CREATE INDEX IF NOT EXISTS idx_news_theses_status_timeframe ON news_theses(status, timeframe, last_updated_at DESC);

		CREATE TABLE IF NOT EXISTS news_thesis_updates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			thesis_id INTEGER NOT NULL,
			run_id INTEGER NOT NULL,
			relationship TEXT NOT NULL DEFAULT 'MODIFIES',
			evidence TEXT NOT NULL DEFAULT '',
			conviction_delta REAL NOT NULL DEFAULT 0,
			sources_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (thesis_id) REFERENCES news_theses(id) ON DELETE CASCADE,
			FOREIGN KEY (run_id) REFERENCES news_runs(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_news_thesis_updates_run ON news_thesis_updates(run_id);
		CREATE INDEX IF NOT EXISTS idx_news_thesis_updates_thesis ON news_thesis_updates(thesis_id, created_at DESC);
	`)
	if err != nil {
		return err
	}
	_, _ = db.Exec(`ALTER TABLE news_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'DAILY'`)
	_, _ = db.Exec(`ALTER TABLE news_runs ADD COLUMN source_type TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_runs ADD COLUMN source_id TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_runs ADD COLUMN foundation_cohort_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_news_runs_mode ON news_runs(mode, status, created_at DESC)`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN source_type TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN source_id TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN foundation_cohort_id INTEGER NOT NULL DEFAULT 0`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN source_excerpt TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN supporting_evidence TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN opposing_evidence TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN invalidation_trigger TEXT NOT NULL DEFAULT ''`)
	// conviction history — one row per thesis per run
	_, _ = db.Exec(`
		CREATE TABLE IF NOT EXISTS news_thesis_conviction_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			thesis_id INTEGER NOT NULL,
			run_id INTEGER NOT NULL,
			conviction REAL NOT NULL,
			relationship TEXT NOT NULL DEFAULT '',
			recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (thesis_id) REFERENCES news_theses(id) ON DELETE CASCADE
		)
	`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_news_thesis_conviction_history_thesis ON news_thesis_conviction_history(thesis_id, recorded_at ASC)`)
	_, _ = db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_news_thesis_conviction_history_thesis_run ON news_thesis_conviction_history(thesis_id, run_id)`)

	// sentiment on items and updates
	_, _ = db.Exec(`ALTER TABLE news_items ADD COLUMN sentiment TEXT NOT NULL DEFAULT 'NEUTRAL'`)
	_, _ = db.Exec(`ALTER TABLE news_thesis_updates ADD COLUMN sentiment TEXT NOT NULL DEFAULT 'NEUTRAL'`)

	// thesis enhancements
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN slug TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN relevance_score REAL NOT NULL DEFAULT 0`)
	_, _ = db.Exec(`ALTER TABLE news_theses ADD COLUMN invalidation_check_due_at DATETIME`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_news_theses_invalidation ON news_theses(invalidation_check_due_at) WHERE invalidation_check_due_at IS NOT NULL`)

	// back-fill slug column for existing theses
	if rows, err := db.Query(`SELECT id, title, timeframe FROM news_theses WHERE slug = '' OR slug IS NULL`); err == nil {
		type thesisSlugRow struct {
			id        int64
			title     string
			timeframe string
		}
		var toFix []thesisSlugRow
		for rows.Next() {
			var r thesisSlugRow
			if scanErr := rows.Scan(&r.id, &r.title, &r.timeframe); scanErr == nil {
				toFix = append(toFix, r)
			}
		}
		rows.Close()
		for _, r := range toFix {
			_, _ = db.Exec(`UPDATE news_theses SET slug = ? WHERE id = ?`, newsThesisSlug(r.title, r.timeframe), r.id)
		}
	}

	if err := ensureNewsFoundationCandidateSchema(); err != nil {
		return err
	}
	if err := ensureNewsFoundationJobSchema(); err != nil {
		return err
	}
	if err := ensureNewsDailyJobSchema(); err != nil {
		return err
	}
	return nil
}

func getNewsBrief(w http.ResponseWriter, r *http.Request) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		http.Error(w, "failed to initialise news tables", http.StatusInternalServerError)
		return
	}

	response, err := loadNewsBriefResponse(r.Context())
	if err != nil {
		http.Error(w, "failed to load news brief", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func runNewsBrief(w http.ResponseWriter, r *http.Request) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		http.Error(w, "failed to initialise news tables", http.StatusInternalServerError)
		return
	}

	request := parseNewsRunRequest(r)
	mode := normaliseNewsRunMode(request.Mode)
	payload, rawText, model, err := callXAINewsNarrative(r.Context(), mode, request.SourceMemoJobID)
	if err != nil {
		recordFailedNewsRun(mode, model, err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	sourceType := ""
	sourceID := ""
	if strings.TrimSpace(request.SourceMemoJobID) != "" {
		sourceType = "PORTFOLIO_MEMO"
		sourceID = strings.TrimSpace(request.SourceMemoJobID)
	}
	runID, err := persistNewsNarrativePayloadWithSource(mode, payload, rawText, model, sourceType, sourceID)
	if err != nil {
		http.Error(w, "failed to persist news brief", http.StatusInternalServerError)
		return
	}

	response, err := loadNewsBriefResponseForRun(r.Context(), runID)
	if err != nil {
		http.Error(w, "failed to load persisted news brief", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func parseNewsRunMode(r *http.Request) string {
	return normaliseNewsRunMode(parseNewsRunRequest(r).Mode)
}

func parseNewsRunRequest(r *http.Request) newsRunRequest {
	var request newsRunRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&request)
	}
	request.Mode = normaliseNewsRunMode(request.Mode)
	request.SourceMemoJobID = strings.TrimSpace(request.SourceMemoJobID)
	return request
}

func normaliseNewsRunMode(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "BOOTSTRAP", "FOUNDATION":
		return "BOOTSTRAP"
	default:
		return "DAILY"
	}
}

func callXAINewsNarrative(ctx context.Context, mode string, sourceMemoJobID string) (newsNarrativeModelPayload, string, string, error) {
	apiKey := strings.TrimSpace(os.Getenv("XAI_API_KEY"))
	if apiKey == "" {
		return newsNarrativeModelPayload{}, "", "", fmt.Errorf("XAI_API_KEY not configured")
	}

	model := strings.TrimSpace(os.Getenv("XAI_NEWS_MODEL"))
	if model == "" {
		model = "grok-4.3"
	}

	if normaliseNewsRunMode(mode) == "BOOTSTRAP" && strings.TrimSpace(sourceMemoJobID) != "" {
		return callXAIMemoSeededFoundation(ctx, strings.TrimSpace(sourceMemoJobID), model)
	}

	prompt, err := buildNewsNarrativePromptWithSource(ctx, mode, sourceMemoJobID)
	if err != nil {
		return newsNarrativeModelPayload{}, "", model, err
	}
	maxOutputTokens := 4000
	if normaliseNewsRunMode(mode) == "BOOTSTRAP" {
		maxOutputTokens = 10000
	}
	reqBody := map[string]interface{}{
		"model": model,
		"input": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"tools": []map[string]string{
			{"type": "web_search"},
		},
		"store":             false,
		"max_output_tokens": maxOutputTokens,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return newsNarrativeModelPayload{}, "", model, err
	}

	requestTimeout := 60 * time.Second
	if normaliseNewsRunMode(mode) == "BOOTSTRAP" {
		requestTimeout = 120 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, "POST", newsXAIResponsesURL, bytes.NewReader(body))
	if err != nil {
		return newsNarrativeModelPayload{}, "", model, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := newsXAIHTTPClient.Do(req)
	if err != nil {
		return newsNarrativeModelPayload{}, "", model, fmt.Errorf("xAI request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return newsNarrativeModelPayload{}, "", model, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newsNarrativeModelPayload{}, "", model, fmt.Errorf("xAI API error %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	text := extractXAIResponseText(raw)
	if text == "" {
		return newsNarrativeModelPayload{}, "", model, fmt.Errorf("empty news response")
	}

	var payload newsNarrativeModelPayload
	if err := json.Unmarshal([]byte(cleanJSONText(text)), &payload); err != nil {
		return newsNarrativeModelPayload{}, text, model, fmt.Errorf("failed to parse news JSON: %w", err)
	}
	normaliseNewsNarrativePayload(&payload)
	if normaliseNewsRunMode(mode) == "BOOTSTRAP" && strings.TrimSpace(sourceMemoJobID) == "" {
		aggregateNewsFoundationPayload(&payload)
		normaliseNewsNarrativePayload(&payload)
		repairRaw, repairErr := repairGenericNewsBootstrapPayload(ctx, model, &payload)
		if repairErr != nil {
			return newsNarrativeModelPayload{}, text, model, repairErr
		}
		if strings.TrimSpace(repairRaw) != "" {
			text = combineNewsBootstrapRaw(text, repairRaw)
		}
	}
	return payload, text, model, nil
}

func buildNewsNarrativePrompt(mode string) string {
	prompt, _ := buildNewsNarrativePromptWithSource(context.Background(), mode, "")
	return prompt
}

func buildNewsNarrativePromptWithSource(ctx context.Context, mode string, sourceMemoJobID string) (string, error) {
	mode = normaliseNewsRunMode(mode)
	assetClassLines := loadAssetClassLinesForNewsPrompt()
	today := time.Now().Format("2 January 2006")
	if mode == "BOOTSTRAP" {
		sourceMemoJobID = strings.TrimSpace(sourceMemoJobID)
		if sourceMemoJobID == "" {
			return buildNewsBootstrapPrompt(today, assetClassLines), nil
		}
		if err := ensurePortfolioMemoSchema(); err != nil {
			return "", err
		}
		memo, err := loadPortfolioMemoRunByJobID(ctx, sourceMemoJobID)
		if err != nil {
			return "", fmt.Errorf("portfolio memo %s not found", sourceMemoJobID)
		}
		return buildNewsMemoCandidateExtractionPrompt(today, assetClassLines, memo), nil
	}
	portfolioWeights := loadNewsPortfolioWeightsForPrompt()
	priorItems := loadPriorRunItemsForPrompt(ctx)
	return buildNewsDailyPrompt(today, loadActiveNewsThesesForPrompt(), assetClassLines, portfolioWeights, priorItems), nil
}

func buildNewsBootstrapPrompt(today string, assetClassLines string) string {
	return fmt.Sprintf(`You are the macro narrative engine for Alpha Edge, a professional portfolio application.

Use web search to build the first foundation map as of %s.

This is a bootstrap run, not a daily news brief. Build the long-horizon thesis map that future daily briefs will maintain:
- top macro, geopolitical, commodity, sector, liquidity, rates, and industry themes over the last 12 months
- top and worst performers over the last 12 months and last month
- persistent thesis objects that matter for portfolio positioning
- thesis IDs are not required, but titles must be stable enough to upsert on later runs
- include near-term themes only when they connect to the long-horizon map

Allowed timeframes: 1D, 1W, 1M, 6M, 1Y.
Allowed thesis statuses: ACTIVE, WATCH, RESOLVED, REJECTED.
Allowed relationships: NEW, SUPPORTS, CHALLENGES, MODIFIES, CONFIRMS, RESOLVES.
Use relationship NEW for foundation theses unless a thesis is already clearly resolved.
Return 8 to 12 thesis updates. Do not return fewer than 5 validated thesis updates.
Use at most 12 news items.
Keep wording specific and financial. Do not invent sources. Return JSON only, no markdown.

Portfolio asset class vocabulary:
%s

JSON shape:
{
  "daily_summary": "one compact paragraph",
  "market_context": {
    "top_themes_12m": ["..."],
    "top_performers_12m": ["..."],
    "worst_performers_12m": ["..."],
    "news_themes_1m": ["..."],
    "top_performers_1m": ["..."],
    "worst_performers_1m": ["..."]
  },
  "news_items": [
    {
      "headline": "...",
      "summary": "...",
      "timeframe": "1D",
      "impact_score": 0.0,
      "sources": ["Reuters"],
      "asset_classes": ["GOLD_MINERS"],
      "tags": ["rates", "gold"]
    }
  ],
  "thesis_updates": [
    {
      "title": "short thesis title",
      "timeframe": "6M",
      "status": "ACTIVE",
      "relationship": "SUPPORTS",
      "conviction": 0.65,
      "conviction_delta": 0.05,
      "summary": "current thesis wording",
      "evidence": "what changed today",
      "sources": ["Reuters"],
      "asset_classes": ["GOLD_MINERS"],
      "tags": ["gold", "real rates"]
    }
  ]
}`, today, assetClassLines)
}

func repairGenericNewsBootstrapPayload(ctx context.Context, model string, payload *newsNarrativeModelPayload) (string, error) {
	minTheses := minNewsFoundationThesisCount("")
	if payload == nil || len(newsFoundationUpdatesBySlug(*payload)) >= minTheses {
		return "", nil
	}

	today := time.Now().Format("2 January 2006")
	prompt := buildNewsBootstrapRepairPrompt(today, loadAssetClassLinesForNewsPrompt(), *payload, minTheses)
	text, err := callXAIResponsesText(ctx, model, prompt, 6000, true)
	if err != nil {
		return text, fmt.Errorf("foundation repair pass failed after thin bootstrap response: %w", err)
	}

	var supplement newsNarrativeModelPayload
	if err := json.Unmarshal([]byte(cleanJSONText(text)), &supplement); err != nil {
		return text, fmt.Errorf("failed to parse foundation repair JSON: %w", err)
	}
	normaliseNewsNarrativePayload(&supplement)
	payload.NewsItems = append(payload.NewsItems, supplement.NewsItems...)
	payload.ThesisUpdates = append(payload.ThesisUpdates, supplement.ThesisUpdates...)
	aggregateNewsFoundationPayload(payload)
	normaliseNewsNarrativePayload(payload)
	return text, nil
}

func buildNewsBootstrapRepairPrompt(today string, assetClassLines string, payload newsNarrativeModelPayload, minTheses int) string {
	return fmt.Sprintf(`You are repairing a thin Alpha Edge foundation news run as of %s.

The first web-search response produced too few validated thesis objects. Use web search and return only missing thesis objects that complete a serious foundation ledger. Do not repeat, rename, or paraphrase existing thesis titles. Cover distinct macro themes such as rates, inflation, credit, liquidity, geopolitics, commodities, energy, gold, technology, defence, fixed income, cash, broad equity, and regional growth only where evidence justifies them.

Existing response:
%s

Portfolio asset class vocabulary:
%s

Return enough additional thesis_updates so the combined ledger has at least %d validated theses. Each returned thesis must have specific evidence, supporting_evidence or evidence, an invalidation_trigger, sources, and canonical asset_classes. Return JSON only:
{
  "daily_summary": "",
  "market_context": {
    "top_themes_12m": [],
    "top_performers_12m": [],
    "worst_performers_12m": [],
    "news_themes_1m": [],
    "top_performers_1m": [],
    "worst_performers_1m": []
  },
  "news_items": [],
  "thesis_updates": [
    {
      "title": "stable thesis title",
      "timeframe": "1Y",
      "status": "ACTIVE",
      "relationship": "NEW",
      "sentiment": "NEUTRAL",
      "conviction": 0.65,
      "conviction_delta": 0.0,
      "summary": "current thesis wording",
      "evidence": "specific validated evidence and why it matters",
      "supporting_evidence": "supporting evidence from the last 12 months",
      "opposing_evidence": "opposing evidence or empty string",
      "invalidation_trigger": "specific condition that would weaken or resolve this thesis",
      "sources": ["Reuters"],
      "asset_classes": ["GOLD_MINERS"],
      "tags": ["rates", "gold"]
    }
  ]
}`, today, mustJSON(payload), assetClassLines, minTheses)
}

func combineNewsBootstrapRaw(initialRaw string, repairRaw string) string {
	return mustJSON(map[string]string{
		"bootstrap_initial": initialRaw,
		"bootstrap_repair":  repairRaw,
	})
}

func buildNewsDailyPrompt(today string, activeTheses string, assetClassLines string, portfolioWeights string, priorItems string) string {
	priorItemsBlock := ""
	if priorItems != "" && priorItems != "- none" {
		priorItemsBlock = fmt.Sprintf(`
Previously covered items (do not repeat unless materially developed):
%s
`, priorItems)
	}
	return fmt.Sprintf(`You are the macro narrative engine for Alpha Edge, a professional portfolio application.

Use web search to gather fresh market-moving information as of %s.

This is a daily maintenance run. Do not rediscover the whole market from scratch. Use the current active thesis ledger and decide whether new evidence supports, weakens, modifies, confirms, resolves, or creates theses. Prioritise themes that affect the portfolio's largest positions.

Rules:
- When updating an existing thesis, copy its slug verbatim into the "slug" field. Do not change the slug.
- Only omit the slug field for genuinely new theses (relationship = NEW).
- Do not create a new thesis for a rephrasing of an existing one — update it instead.
- Allowed timeframes: 1D, 1W, 1M, 6M, 1Y.
- Allowed thesis statuses: ACTIVE, WATCH, RESOLVED, REJECTED.
- Allowed relationships: NEW, SUPPORTS, CHALLENGES, MODIFIES, CONFIRMS, RESOLVES.
- Allowed sentiments: BULLISH, BEARISH, NEUTRAL.
- Use at most 12 thesis updates.
- Use at most 14 news items.
- Keep wording specific and financial. Do not invent sources. Return JSON only, no markdown.
%s
Current portfolio exposure (weight your coverage accordingly):
%s

Current active theses (use the slug verbatim when updating):
%s

Portfolio asset class vocabulary:
%s

JSON shape:
{
  "daily_summary": "one compact paragraph",
  "market_context": {
    "top_themes_12m": ["..."],
    "top_performers_12m": ["..."],
    "worst_performers_12m": ["..."],
    "news_themes_1m": ["..."],
    "top_performers_1m": ["..."],
    "worst_performers_1m": ["..."]
  },
  "news_items": [
    {
      "headline": "...",
      "summary": "...",
      "timeframe": "1D",
      "sentiment": "BULLISH",
      "impact_score": 0.0,
      "sources": ["Reuters"],
      "asset_classes": ["GOLD"],
      "tags": ["rates", "gold"]
    }
  ],
  "thesis_updates": [
    {
      "slug": "existing-thesis-slug-1y",
      "title": "short thesis title",
      "timeframe": "6M",
      "status": "ACTIVE",
      "relationship": "SUPPORTS",
      "sentiment": "BULLISH",
      "conviction": 0.65,
      "conviction_delta": 0.05,
      "summary": "current thesis wording",
      "evidence": "what changed today and why it matters",
      "supporting_evidence": "evidence that strengthens the thesis",
      "opposing_evidence": "evidence that weakens or challenges the thesis",
      "invalidation_trigger": "specific condition that would resolve or reject this thesis",
      "sources": ["Reuters"],
      "asset_classes": ["GOLD"],
      "tags": ["gold", "real rates"]
    }
  ]
}`, today, priorItemsBlock, portfolioWeights, activeTheses, assetClassLines)
}

func loadActiveNewsThesesForPrompt() string {
	if !sqliteTableExists("news_theses") {
		return "- none"
	}
	// Load all ACTIVE/WATCH theses; keep all 1Y theses regardless of age, then
	// fill remaining slots with the most recently updated shorter-horizon theses.
	rows, err := db.Query(`
		SELECT COALESCE(slug, ''), title, timeframe, status, conviction, summary
		FROM news_theses
		WHERE status IN ('ACTIVE', 'WATCH')
		ORDER BY
			CASE WHEN timeframe = '1Y' THEN 0 ELSE 1 END ASC,
			last_updated_at DESC
		LIMIT 40
	`)
	if err != nil {
		return "- none"
	}
	defer rows.Close()

	lines := []string{}
	for rows.Next() {
		var slug, title, timeframe, status, summary string
		var conviction float64
		if err := rows.Scan(&slug, &title, &timeframe, &status, &conviction, &summary); err != nil {
			continue
		}
		slugPart := ""
		if slug != "" {
			slugPart = fmt.Sprintf(" | slug: %s", slug)
		}
		lines = append(lines, fmt.Sprintf("- [%s/%s %.0f%%%s] %s: %s",
			timeframe, status, conviction*100, slugPart, title, summary))
	}
	if len(lines) == 0 {
		return "- none"
	}
	return strings.Join(lines, "\n")
}

// loadNewsPortfolioWeightsForPrompt returns the current portfolio mix as a
// formatted block suitable for injection into LLM prompts.
func loadNewsPortfolioWeightsForPrompt() string {
	if !sqliteTableExists("portfolio_mix_snapshots") {
		return "- portfolio exposure data unavailable"
	}
	// Use the latest approved portfolio mix rows
	type mixRow struct {
		assetClass  string
		displayName string
		currentPct  float64
		targetPct   float64
	}
	rows, err := db.Query(`
		SELECT pmr.asset_class, COALESCE(pmr.display_name, pmr.asset_class), pmr.current_weight_pct, pmr.target_weight_pct
		FROM portfolio_mix_rows pmr
		JOIN portfolio_mix_snapshots pms ON pms.id = pmr.snapshot_id
		WHERE pms.status = 'APPROVED'
		  AND pmr.current_weight_pct > 0
		ORDER BY pmr.current_weight_pct DESC
		LIMIT 20
	`)
	if err != nil {
		return "- portfolio exposure data unavailable"
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var r mixRow
		if err := rows.Scan(&r.assetClass, &r.displayName, &r.currentPct, &r.targetPct); err != nil {
			continue
		}
		lines = append(lines, fmt.Sprintf("- %s (%s): %.1f%% current / %.1f%% target",
			r.assetClass, r.displayName, r.currentPct, r.targetPct))
	}
	if len(lines) == 0 {
		return "- portfolio exposure data unavailable"
	}
	return strings.Join(lines, "\n")
}

// loadPriorRunItemsForPrompt returns headlines from the previous DAILY run so
// the model does not recycle the same news on consecutive days.
func loadPriorRunItemsForPrompt(ctx context.Context) string {
	if !sqliteTableExists("news_runs") || !sqliteTableExists("news_items") {
		return "- none"
	}
	var priorRunID int64
	err := db.QueryRowContext(ctx, `
		SELECT id FROM news_runs
		WHERE mode = 'DAILY' AND status = 'COMPLETED'
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&priorRunID)
	if err != nil {
		return "- none"
	}
	rows, err := db.QueryContext(ctx, `
		SELECT headline, timeframe, COALESCE(asset_classes_json, '[]')
		FROM news_items
		WHERE run_id = ?
		ORDER BY impact_score DESC
		LIMIT 8
	`, priorRunID)
	if err != nil {
		return "- none"
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var headline, timeframe, classesJSON string
		if err := rows.Scan(&headline, &timeframe, &classesJSON); err != nil {
			continue
		}
		classes := parseJSONStringArray(classesJSON)
		classPart := ""
		if len(classes) > 0 {
			classPart = " (" + strings.Join(classes[:min(len(classes), 2)], ", ") + ")"
		}
		lines = append(lines, fmt.Sprintf("- [%s] %s%s", timeframe, headline, classPart))
	}
	if len(lines) == 0 {
		return "- none"
	}
	return strings.Join(lines, "\n")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func loadAssetClassLinesForNewsPrompt() string {
	classes := loadAssetClasses()
	lines := make([]string, 0, len(classes))
	for _, class := range classes {
		if !class.Active || !class.AllowTargetWeight {
			continue
		}
		code := normalizePrimaryAssetClass(class.Code)
		if code == "" {
			continue
		}
		label := strings.TrimSpace(class.DisplayName)
		if label == "" {
			label = code
		}
		lines = append(lines, fmt.Sprintf("- %s: %s", code, label))
	}
	sort.Strings(lines)
	if len(lines) == 0 {
		return "- none"
	}
	return strings.Join(lines, "\n")
}

func persistNewsNarrativePayload(mode string, payload newsNarrativeModelPayload, rawText string, model string) (int64, error) {
	return persistNewsNarrativePayloadWithSource(mode, payload, rawText, model, "", "")
}

func persistNewsNarrativePayloadWithSource(mode string, payload newsNarrativeModelPayload, rawText string, model string, sourceType string, sourceID string) (int64, error) {
	return persistNewsNarrativePayloadWithCohort(mode, payload, rawText, model, sourceType, sourceID, 0)
}

func persistNewsNarrativePayloadWithCohort(mode string, payload newsNarrativeModelPayload, rawText string, model string, sourceType string, sourceID string, foundationCohortID int64) (int64, error) {
	mode = normaliseNewsRunMode(mode)
	marketContextJSON := mustJSON(payload.MarketContext)

	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`
		INSERT INTO news_runs (run_date, mode, status, model, source_type, source_id, foundation_cohort_id, daily_summary, market_context_json, raw_response_json, updated_at)
		VALUES (DATE('now'), ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, mode, model, strings.TrimSpace(sourceType), strings.TrimSpace(sourceID), foundationCohortID, payload.DailySummary, marketContextJSON, rawText)
	if err != nil {
		return 0, err
	}
	runID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}

	for _, item := range payload.NewsItems {
		if strings.TrimSpace(item.Headline) == "" {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO news_items (run_id, headline, summary, timeframe, sentiment, impact_score, sources_json, asset_classes_json, tags_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, runID, item.Headline, item.Summary, item.Timeframe, item.Sentiment, item.ImpactScore, mustJSON(item.Sources), mustJSON(item.AssetClasses), mustJSON(item.Tags)); err != nil {
			return 0, err
		}
	}

	// Load portfolio weights for relevance scoring
	portfolioWeightMap := loadNewsPortfolioWeightMap()

	for _, update := range payload.ThesisUpdates {
		if strings.TrimSpace(update.Title) == "" {
			continue
		}
		// Prefer model-provided slug (for updates to existing theses); derive for new ones
		slug := strings.TrimSpace(update.Slug)
		if slug == "" {
			slug = newsThesisSlug(update.Title, update.Timeframe)
		}

		// Compute relevance score: sum of portfolio weights for asset classes in this thesis
		relevanceScore := computeThesisRelevanceScore(update.AssetClasses, portfolioWeightMap)

		// Determine invalidation check due date (7 days from now if trigger is set)
		invalidationDue := ""
		if strings.TrimSpace(update.InvalidationTrigger) != "" {
			invalidationDue = time.Now().AddDate(0, 0, 7).Format("2006-01-02T15:04:05Z")
		}

		if _, err := tx.Exec(`
			INSERT INTO news_theses (
				slug, title, timeframe, status, conviction, summary, foundation_cohort_id,
				relevance_score, asset_classes_json, tags_json, source_type, source_id, source_excerpt,
				supporting_evidence, opposing_evidence, invalidation_trigger, invalidation_check_due_at,
				updated_at, last_updated_at, resolved_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
			        CASE WHEN ? IN ('RESOLVED', 'REJECTED') THEN CURRENT_TIMESTAMP ELSE NULL END)
			ON CONFLICT(slug) DO UPDATE SET
				title = excluded.title,
				timeframe = excluded.timeframe,
				status = excluded.status,
				conviction = excluded.conviction,
				summary = excluded.summary,
				relevance_score = excluded.relevance_score,
				foundation_cohort_id = CASE WHEN excluded.foundation_cohort_id > 0 THEN excluded.foundation_cohort_id ELSE news_theses.foundation_cohort_id END,
				asset_classes_json = excluded.asset_classes_json,
				tags_json = excluded.tags_json,
				source_type = CASE WHEN excluded.source_type != '' THEN excluded.source_type ELSE news_theses.source_type END,
				source_id = CASE WHEN excluded.source_id != '' THEN excluded.source_id ELSE news_theses.source_id END,
				source_excerpt = CASE WHEN excluded.source_excerpt != '' THEN excluded.source_excerpt ELSE news_theses.source_excerpt END,
				supporting_evidence = CASE WHEN excluded.supporting_evidence != '' THEN excluded.supporting_evidence ELSE news_theses.supporting_evidence END,
				opposing_evidence = CASE WHEN excluded.opposing_evidence != '' THEN excluded.opposing_evidence ELSE news_theses.opposing_evidence END,
				invalidation_trigger = CASE WHEN excluded.invalidation_trigger != '' THEN excluded.invalidation_trigger ELSE news_theses.invalidation_trigger END,
				invalidation_check_due_at = CASE WHEN excluded.invalidation_check_due_at IS NOT NULL THEN excluded.invalidation_check_due_at ELSE news_theses.invalidation_check_due_at END,
				updated_at = CURRENT_TIMESTAMP,
				last_updated_at = CURRENT_TIMESTAMP,
				resolved_at = CASE
					WHEN excluded.status IN ('RESOLVED', 'REJECTED') THEN COALESCE(news_theses.resolved_at, CURRENT_TIMESTAMP)
					WHEN news_theses.status IN ('RESOLVED', 'REJECTED') AND excluded.status IN ('ACTIVE', 'WATCH') THEN NULL
					ELSE news_theses.resolved_at
				END
		`, slug, update.Title, update.Timeframe, update.Status, update.Conviction, update.Summary, foundationCohortID,
			relevanceScore, mustJSON(update.AssetClasses), mustJSON(update.Tags),
			strings.TrimSpace(sourceType), strings.TrimSpace(sourceID),
			strings.TrimSpace(update.SourceExcerpt), strings.TrimSpace(update.SupportingEvidence),
			strings.TrimSpace(update.OpposingEvidence), strings.TrimSpace(update.InvalidationTrigger),
			invalidationDue, update.Status); err != nil {
			return 0, err
		}

		var thesisID int64
		if err := tx.QueryRow(`SELECT id FROM news_theses WHERE slug = ?`, slug).Scan(&thesisID); err != nil {
			return 0, err
		}

		if _, err := tx.Exec(`
			INSERT INTO news_thesis_updates (thesis_id, run_id, relationship, sentiment, evidence, conviction_delta, sources_json)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, thesisID, runID, update.Relationship, update.Sentiment, update.Evidence, update.ConvictionDelta, mustJSON(update.Sources)); err != nil {
			return 0, err
		}

		// Record conviction history (ignore duplicate for same run)
		_, _ = tx.Exec(`
			INSERT OR IGNORE INTO news_thesis_conviction_history (thesis_id, run_id, conviction, relationship)
			VALUES (?, ?, ?, ?)
		`, thesisID, runID, update.Conviction, update.Relationship)
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return runID, nil
}

func recordFailedNewsRun(mode string, model string, runErr error) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		return
	}
	mode = normaliseNewsRunMode(mode)
	if model == "" {
		model = strings.TrimSpace(os.Getenv("XAI_NEWS_MODEL"))
	}
	_, _ = db.Exec(`
		INSERT INTO news_runs (run_date, mode, status, model, error_message, updated_at)
		VALUES (DATE('now'), ?, 'FAILED', ?, ?, CURRENT_TIMESTAMP)
	`, mode, model, runErr.Error())
}

func loadNewsBriefResponse(ctx context.Context) (newsBriefResponse, error) {
	var runID int64
	err := db.QueryRowContext(ctx, `
		SELECT id
		FROM news_runs
		WHERE status = 'COMPLETED'
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&runID)
	if err == sql.ErrNoRows {
		theses, thesesErr := loadNewsTheses(ctx)
		if thesesErr != nil {
			return newsBriefResponse{}, thesesErr
		}
		foundationRun := loadLatestNewsRunByMode(ctx, "BOOTSTRAP")
		return newsBriefResponse{
			FoundationRun:    foundationRun,
			FoundationCohort: loadActiveNewsFoundationCohort(ctx),
			FoundationJob:    loadLatestNewsFoundationJob(ctx),
			DailyJob:         loadLatestNewsDailyJob(ctx),
			Items:            []newsItem{},
			Theses:           theses,
			Updates:          []newsThesisUpdate{},
		}, nil
	}
	if err != nil {
		return newsBriefResponse{}, err
	}
	return loadNewsBriefResponseForRun(ctx, runID)
}

func loadNewsBriefResponseForRun(ctx context.Context, runID int64) (newsBriefResponse, error) {
	run, err := loadNewsRun(ctx, runID)
	if err != nil {
		return newsBriefResponse{}, err
	}
	items, err := loadNewsItems(ctx, runID)
	if err != nil {
		return newsBriefResponse{}, err
	}
	theses, err := loadNewsTheses(ctx)
	if err != nil {
		return newsBriefResponse{}, err
	}
	updates, err := loadNewsThesisUpdates(ctx, runID)
	if err != nil {
		return newsBriefResponse{}, err
	}
	return newsBriefResponse{
		Run:              &run,
		FoundationRun:    loadLatestNewsRunByMode(ctx, "BOOTSTRAP"),
		FoundationCohort: loadActiveNewsFoundationCohort(ctx),
		FoundationJob:    loadLatestNewsFoundationJob(ctx),
		DailyJob:         loadLatestNewsDailyJob(ctx),
		Items:            items,
		Theses:           theses,
		Updates:          updates,
	}, nil
}

func loadLatestNewsRunByMode(ctx context.Context, mode string) *newsRun {
	var runID int64
	err := db.QueryRowContext(ctx, `
		SELECT id
		FROM news_runs
		WHERE mode = ? AND status = 'COMPLETED'
		ORDER BY created_at DESC
		LIMIT 1
	`, normaliseNewsRunMode(mode)).Scan(&runID)
	if err != nil {
		return nil
	}
	run, err := loadNewsRun(ctx, runID)
	if err != nil {
		return nil
	}
	return &run
}

func loadNewsRun(ctx context.Context, runID int64) (newsRun, error) {
	var run newsRun
	var marketContextJSON string
	err := db.QueryRowContext(ctx, `
		SELECT id, run_date, mode, status, model, COALESCE(source_type, ''), COALESCE(source_id, ''), COALESCE(foundation_cohort_id, 0), daily_summary, market_context_json,
		       error_message, created_at, updated_at
		FROM news_runs
		WHERE id = ?
	`, runID).Scan(&run.ID, &run.RunDate, &run.Mode, &run.Status, &run.Model, &run.SourceType, &run.SourceID, &run.FoundationCohortID, &run.DailySummary,
		&marketContextJSON, &run.ErrorMessage, &run.CreatedAt, &run.UpdatedAt)
	if err != nil {
		return newsRun{}, err
	}
	_ = json.Unmarshal([]byte(marketContextJSON), &run.MarketContext)
	return run, nil
}

func loadNewsItems(ctx context.Context, runID int64) ([]newsItem, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, run_id, headline, summary, timeframe, COALESCE(sentiment, 'NEUTRAL'), impact_score,
		       sources_json, asset_classes_json, tags_json, created_at
		FROM news_items
		WHERE run_id = ?
		ORDER BY impact_score DESC, id ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []newsItem{}
	for rows.Next() {
		var item newsItem
		var sourcesJSON, assetClassesJSON, tagsJSON string
		if err := rows.Scan(&item.ID, &item.RunID, &item.Headline, &item.Summary,
			&item.Timeframe, &item.Sentiment, &item.ImpactScore, &sourcesJSON, &assetClassesJSON,
			&tagsJSON, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Sources = parseJSONStringArray(sourcesJSON)
		item.AssetClasses = parseJSONStringArray(assetClassesJSON)
		item.Tags = parseJSONStringArray(tagsJSON)
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadNewsPortfolioWeightMap() map[string]float64 {
	weights := map[string]float64{}
	if !sqliteTableExists("portfolio_mix_rows") || !sqliteTableExists("portfolio_mix_snapshots") {
		return weights
	}
	rows, err := db.Query(`
		SELECT pmr.asset_class, pmr.current_weight_pct
		FROM portfolio_mix_rows pmr
		JOIN portfolio_mix_snapshots pms ON pms.id = pmr.snapshot_id
		WHERE pms.status = 'APPROVED' AND pmr.current_weight_pct > 0
	`)
	if err != nil {
		return weights
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var pct float64
		if err := rows.Scan(&code, &pct); err != nil {
			continue
		}
		weights[strings.ToUpper(strings.TrimSpace(code))] = pct
	}
	return weights
}

func computeThesisRelevanceScore(assetClasses []string, weights map[string]float64) float64 {
	if len(weights) == 0 {
		return 0
	}
	var score float64
	for _, ac := range assetClasses {
		code := strings.ToUpper(strings.TrimSpace(ac))
		if w, ok := weights[code]; ok {
			score += w
		}
	}
	return score
}

func loadNewsTheses(ctx context.Context) ([]newsThesis, error) {
	args := []interface{}{}
	whereClause := `WHERE status != 'SUPERSEDED'`
	if activeCohort := loadActiveNewsFoundationCohort(ctx); activeCohort != nil {
		whereClause = `WHERE status != 'SUPERSEDED' AND (COALESCE(foundation_cohort_id, 0) = 0 OR foundation_cohort_id = ?)`
		args = append(args, activeCohort.ID)
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, COALESCE(slug, ''), COALESCE(foundation_cohort_id, 0),
		       title, timeframe, status, conviction, COALESCE(relevance_score, 0), summary,
		       asset_classes_json, tags_json,
		       COALESCE(source_type, ''), COALESCE(source_id, ''), COALESCE(source_excerpt, ''),
		       COALESCE(supporting_evidence, ''), COALESCE(opposing_evidence, ''),
		       COALESCE(invalidation_trigger, ''), COALESCE(invalidation_check_due_at, ''),
		       created_at, updated_at,
		       last_updated_at, COALESCE(resolved_at, '')
		FROM news_theses
		`+whereClause+`
		ORDER BY
			CASE timeframe
				WHEN '1Y' THEN 1
				WHEN '6M' THEN 2
				WHEN '1M' THEN 3
				WHEN '1W' THEN 4
				WHEN '1D' THEN 5
				ELSE 6
			END,
			COALESCE(relevance_score, 0) DESC,
			last_updated_at DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	now := time.Now()
	theses := []newsThesis{}
	for rows.Next() {
		var thesis newsThesis
		var assetClassesJSON, tagsJSON string
		if err := rows.Scan(
			&thesis.ID, &thesis.Slug, &thesis.FoundationCohortID,
			&thesis.Title, &thesis.Timeframe, &thesis.Status, &thesis.Conviction, &thesis.RelevanceScore, &thesis.Summary,
			&assetClassesJSON, &tagsJSON,
			&thesis.SourceType, &thesis.SourceID, &thesis.SourceExcerpt,
			&thesis.SupportingEvidence, &thesis.OpposingEvidence, &thesis.InvalidationTrigger,
			&thesis.InvalidationCheckDueAt,
			&thesis.CreatedAt, &thesis.UpdatedAt, &thesis.LastUpdatedAt, &thesis.ResolvedAt,
		); err != nil {
			return nil, err
		}
		thesis.AssetClasses = parseJSONStringArray(assetClassesJSON)
		thesis.Tags = parseJSONStringArray(tagsJSON)
		// Flag as stale if invalidation check is overdue
		if thesis.InvalidationCheckDueAt != "" && thesis.InvalidationTrigger != "" {
			if t, err := time.Parse(time.RFC3339, thesis.InvalidationCheckDueAt); err == nil {
				thesis.StaleInvalidation = now.After(t)
			}
		}
		theses = append(theses, thesis)
	}
	return theses, rows.Err()
}

func loadNewsThesisUpdates(ctx context.Context, runID int64) ([]newsThesisUpdate, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, thesis_id, run_id, relationship, COALESCE(sentiment, 'NEUTRAL'),
		       evidence, conviction_delta, sources_json, created_at
		FROM news_thesis_updates
		WHERE run_id = ?
		ORDER BY id ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	updates := []newsThesisUpdate{}
	for rows.Next() {
		var update newsThesisUpdate
		var sourcesJSON string
		if err := rows.Scan(&update.ID, &update.ThesisID, &update.RunID, &update.Relationship,
			&update.Sentiment, &update.Evidence, &update.ConvictionDelta, &sourcesJSON, &update.CreatedAt); err != nil {
			return nil, err
		}
		update.Sources = parseJSONStringArray(sourcesJSON)
		updates = append(updates, update)
	}
	return updates, rows.Err()
}

// loadAllThesisUpdates returns all updates for the full thesis ledger (all runs),
// used for history timelines in the thesis detail drawer.
func loadAllThesisUpdates(ctx context.Context, thesisID int64) ([]newsThesisUpdate, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, thesis_id, run_id, relationship, COALESCE(sentiment, 'NEUTRAL'),
		       evidence, conviction_delta, sources_json, created_at
		FROM news_thesis_updates
		WHERE thesis_id = ?
		ORDER BY created_at DESC
		LIMIT 30
	`, thesisID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	updates := []newsThesisUpdate{}
	for rows.Next() {
		var update newsThesisUpdate
		var sourcesJSON string
		if err := rows.Scan(&update.ID, &update.ThesisID, &update.RunID, &update.Relationship,
			&update.Sentiment, &update.Evidence, &update.ConvictionDelta, &sourcesJSON, &update.CreatedAt); err != nil {
			return nil, err
		}
		update.Sources = parseJSONStringArray(sourcesJSON)
		updates = append(updates, update)
	}
	return updates, rows.Err()
}

// loadThesisConvictionHistory returns the conviction trajectory for a single thesis.
func loadThesisConvictionHistory(ctx context.Context, thesisID int64) ([]newsThesisConvictionPoint, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT run_id, conviction, recorded_at
		FROM news_thesis_conviction_history
		WHERE thesis_id = ?
		ORDER BY recorded_at ASC
		LIMIT 20
	`, thesisID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pts []newsThesisConvictionPoint
	for rows.Next() {
		var pt newsThesisConvictionPoint
		if err := rows.Scan(&pt.RunID, &pt.Conviction, &pt.RecordedAt); err != nil {
			return nil, err
		}
		pts = append(pts, pt)
	}
	return pts, rows.Err()
}

func normaliseNewsNarrativePayload(payload *newsNarrativeModelPayload) {
	payload.DailySummary = strings.TrimSpace(payload.DailySummary)
	for i := range payload.NewsItems {
		item := &payload.NewsItems[i]
		item.Headline = strings.TrimSpace(item.Headline)
		item.Summary = strings.TrimSpace(item.Summary)
		item.Timeframe = normaliseNewsTimeframe(item.Timeframe)
		item.Sentiment = normaliseNewsSentiment(item.Sentiment)
		item.ImpactScore = clamp01(item.ImpactScore)
		item.Sources = cleanStringList(item.Sources, 4)
		item.AssetClasses = normaliseNewsAssetClassesFuzzy(item.AssetClasses)
		item.Tags = cleanStringList(item.Tags, 8)
	}
	for i := range payload.ThesisUpdates {
		update := &payload.ThesisUpdates[i]
		update.Slug = strings.TrimSpace(update.Slug)
		update.Title = strings.TrimSpace(update.Title)
		update.Timeframe = normaliseNewsTimeframe(update.Timeframe)
		update.Status = normaliseNewsStatus(update.Status)
		update.Relationship = normaliseNewsRelationship(update.Relationship)
		update.Sentiment = normaliseNewsSentiment(update.Sentiment)
		update.Conviction = clamp01(update.Conviction)
		update.ConvictionDelta = clampRange(update.ConvictionDelta, -1, 1)
		update.Summary = strings.TrimSpace(update.Summary)
		update.Evidence = strings.TrimSpace(update.Evidence)
		update.SupportingEvidence = strings.TrimSpace(update.SupportingEvidence)
		update.OpposingEvidence = strings.TrimSpace(update.OpposingEvidence)
		update.InvalidationTrigger = strings.TrimSpace(update.InvalidationTrigger)
		update.SourceExcerpt = strings.TrimSpace(update.SourceExcerpt)
		update.Sources = cleanStringList(update.Sources, 4)
		update.AssetClasses = normaliseNewsAssetClassesFuzzy(update.AssetClasses)
		update.Tags = cleanStringList(update.Tags, 8)
	}
}

func normaliseNewsSentiment(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "BULLISH", "POSITIVE":
		return "BULLISH"
	case "BEARISH", "NEGATIVE":
		return "BEARISH"
	default:
		return "NEUTRAL"
	}
}

func normaliseNewsTimeframe(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "1D", "DAY", "ONE_DAY":
		return "1D"
	case "1W", "WEEK", "ONE_WEEK":
		return "1W"
	case "1M", "MONTH", "ONE_MONTH":
		return "1M"
	case "6M", "SIX_MONTHS", "SIX_MONTH":
		return "6M"
	case "1Y", "YEAR", "ONE_YEAR", "12M":
		return "1Y"
	default:
		return "1D"
	}
}

func normaliseNewsStatus(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "ACTIVE", "WATCH", "RESOLVED", "REJECTED":
		return strings.ToUpper(strings.TrimSpace(value))
	default:
		return "ACTIVE"
	}
}

func normaliseNewsRelationship(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "NEW", "SUPPORTS", "CHALLENGES", "MODIFIES", "CONFIRMS", "RESOLVES":
		return strings.ToUpper(strings.TrimSpace(value))
	default:
		return "MODIFIES"
	}
}

func normaliseNewsAssetClasses(values []string) []string {
	return normaliseNewsAssetClassesFuzzy(values)
}

// normaliseNewsAssetClassesFuzzy validates asset class codes returned by the
// model, applying fuzzy fallback matching against display names so that codes
// like "ENERGY" resolve to "ENERGY_PRODUCERS" instead of being silently dropped.
func normaliseNewsAssetClassesFuzzy(values []string) []string {
	validCodes := loadValidNewsAssetClassCodes()
	displayNameIndex := loadNewsAssetClassDisplayNameIndex()
	result := []string{}
	for _, value := range values {
		// Primary: exact normalisation
		code := normalizePrimaryAssetClass(value)
		if code != "" && (validCodes == nil || validCodes[code]) {
			result = append(result, code)
			continue
		}
		// Fallback: case-insensitive prefix match against display names
		normalized := strings.ToUpper(strings.TrimSpace(value))
		if resolved, ok := displayNameIndex[normalized]; ok {
			result = append(result, resolved)
			continue
		}
		// Partial prefix scan
		for displayKey, resolvedCode := range displayNameIndex {
			if strings.HasPrefix(displayKey, normalized) || strings.HasPrefix(normalized, displayKey) {
				result = append(result, resolvedCode)
				break
			}
		}
	}
	return cleanStringList(result, 8)
}

func loadNewsAssetClassDisplayNameIndex() map[string]string {
	index := map[string]string{}
	if !sqliteTableExists("asset_classes") {
		return index
	}
	rows, err := db.Query(`SELECT code, display_name FROM asset_classes WHERE active = 1 AND allow_target_weight = 1`)
	if err != nil {
		return index
	}
	defer rows.Close()
	for rows.Next() {
		var code, display string
		if err := rows.Scan(&code, &display); err != nil {
			continue
		}
		normalized := normalizePrimaryAssetClass(code)
		if normalized == "" {
			continue
		}
		index[strings.ToUpper(strings.TrimSpace(display))] = normalized
		// Also index the raw code upper-cased for partial matches
		index[strings.ToUpper(strings.TrimSpace(code))] = normalized
	}
	return index
}

func loadValidNewsAssetClassCodes() map[string]bool {
	if !sqliteTableExists("asset_classes") {
		return nil
	}
	rows, err := db.Query(`
		SELECT code
		FROM asset_classes
		WHERE active = 1
		  AND allow_target_weight = 1
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	codes := map[string]bool{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			continue
		}
		normalized := normalizePrimaryAssetClass(code)
		if normalized != "" {
			codes[normalized] = true
		}
	}
	if len(codes) == 0 {
		return nil
	}
	return codes
}

func newsThesisSlug(title string, timeframe string) string {
	base := strings.ToLower(strings.TrimSpace(timeframe + "-" + title))
	re := regexp.MustCompile(`[^a-z0-9]+`)
	base = strings.Trim(re.ReplaceAllString(base, "-"), "-")
	if base == "" {
		return fmt.Sprintf("thesis-%d", time.Now().UnixNano())
	}
	if len(base) > 120 {
		return strings.Trim(base[:120], "-")
	}
	return base
}

func mustJSON(value interface{}) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "null"
	}
	return string(raw)
}

func parseJSONStringArray(raw string) []string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}
	return cleanStringList(values, 40)
}

func cleanStringList(values []string, limit int) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
		if limit > 0 && len(result) >= limit {
			break
		}
	}
	return result
}

func clamp01(value float64) float64 {
	return clampRange(value, 0, 1)
}

func clampRange(value float64, min float64, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
