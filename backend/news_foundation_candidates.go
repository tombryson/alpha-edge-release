package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

const maxNewsFoundationCandidates = 20

type newsFoundationCandidate struct {
	ID                  int64    `json:"id,omitempty"`
	MemoJobID           string   `json:"memo_job_id,omitempty"`
	Title               string   `json:"title"`
	Timeframe           string   `json:"timeframe"`
	Claim               string   `json:"claim"`
	Reasoning           string   `json:"reasoning"`
	SourceSection       string   `json:"source_section"`
	SourceExcerpt       string   `json:"source_excerpt"`
	Status              string   `json:"status,omitempty"`
	Conviction          float64  `json:"conviction,omitempty"`
	SupportingEvidence  string   `json:"supporting_evidence,omitempty"`
	OpposingEvidence    string   `json:"opposing_evidence,omitempty"`
	InvalidationTrigger string   `json:"invalidation_trigger,omitempty"`
	Sources             []string `json:"sources,omitempty"`
	AssetClasses        []string `json:"asset_classes"`
	Tags                []string `json:"tags"`
	CreatedAt           string   `json:"created_at,omitempty"`
	UpdatedAt           string   `json:"updated_at,omitempty"`
}

type newsFoundationCandidatePayload struct {
	Candidates []newsFoundationCandidate `json:"candidates"`
}

func ensureNewsFoundationCandidateSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS news_foundation_candidates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL,
			title TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			claim TEXT NOT NULL DEFAULT '',
			reasoning TEXT NOT NULL DEFAULT '',
			source_section TEXT NOT NULL DEFAULT '',
			source_excerpt TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			conviction REAL NOT NULL DEFAULT 0,
			supporting_evidence TEXT NOT NULL DEFAULT '',
			opposing_evidence TEXT NOT NULL DEFAULT '',
			invalidation_trigger TEXT NOT NULL DEFAULT '',
			sources_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE UNIQUE INDEX IF NOT EXISTS idx_news_foundation_candidates_memo_slug
			ON news_foundation_candidates(memo_job_id, title, timeframe);
		CREATE INDEX IF NOT EXISTS idx_news_foundation_candidates_memo
			ON news_foundation_candidates(memo_job_id, updated_at DESC);
	`)
	if err != nil {
		return err
	}
	_, _ = db.Exec(`ALTER TABLE news_foundation_candidates ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`)
	_, _ = db.Exec(`ALTER TABLE news_foundation_candidates ADD COLUMN conviction REAL NOT NULL DEFAULT 0`)
	_, _ = db.Exec(`ALTER TABLE news_foundation_candidates ADD COLUMN supporting_evidence TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_foundation_candidates ADD COLUMN opposing_evidence TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_foundation_candidates ADD COLUMN invalidation_trigger TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE news_foundation_candidates ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]'`)
	return ensureNewsFoundationResearchSchema()
}

func callXAIMemoSeededFoundation(ctx context.Context, sourceMemoJobID string, model string) (newsNarrativeModelPayload, string, string, error) {
	if err := ensurePortfolioMemoSchema(); err != nil {
		return newsNarrativeModelPayload{}, "", model, err
	}
	if err := ensureNewsFoundationCandidateSchema(); err != nil {
		return newsNarrativeModelPayload{}, "", model, err
	}

	memo, err := loadPortfolioMemoRunByJobID(ctx, sourceMemoJobID)
	if err != nil {
		return newsNarrativeModelPayload{}, "", model, fmt.Errorf("portfolio memo %s not found", sourceMemoJobID)
	}

	assetClassLines := loadAssetClassLinesForNewsPrompt()
	today := time.Now().Format("2 January 2006")

	candidates, extractionRaw, err := callXAIMemoCandidateExtraction(ctx, model, today, assetClassLines, memo)
	if err != nil {
		return newsNarrativeModelPayload{}, extractionRaw, model, err
	}
	if len(candidates) == 0 {
		return newsNarrativeModelPayload{}, extractionRaw, model, fmt.Errorf("portfolio memo produced no foundation candidates")
	}
	if err := persistNewsFoundationCandidates(ctx, memo.MemoJobID, candidates); err != nil {
		return newsNarrativeModelPayload{}, extractionRaw, model, err
	}

	researchTasks := buildNewsFoundationResearchTasks(memo, candidates)
	if err := persistNewsFoundationResearchTasks(ctx, memo.MemoJobID, researchTasks); err != nil {
		return newsNarrativeModelPayload{}, extractionRaw, model, err
	}

	payload, validationRaw, err := callXAIMemoCandidateValidation(ctx, model, today, assetClassLines, candidates, researchTasks)
	if err != nil {
		return newsNarrativeModelPayload{}, combineFoundationRaw(extractionRaw, validationRaw), model, err
	}
	enrichValidatedUpdatesFromCandidates(&payload, candidates)
	normaliseNewsNarrativePayload(&payload)
	clusters := aggregateNewsFoundationPayload(&payload)
	normaliseNewsNarrativePayload(&payload)
	if len(payload.ThesisUpdates) == 0 {
		return newsNarrativeModelPayload{}, combineFoundationRaw(extractionRaw, validationRaw), model, fmt.Errorf("memo candidate validation produced no thesis updates")
	}
	if err := persistNewsFoundationClusters(ctx, memo.MemoJobID, clusters); err != nil {
		return newsNarrativeModelPayload{}, combineFoundationRaw(extractionRaw, validationRaw), model, err
	}

	return payload, combineFoundationRaw(extractionRaw, validationRaw), model, nil
}

func callXAIMemoCandidateExtraction(ctx context.Context, model string, today string, assetClassLines string, memo *portfolioMemoRun) ([]newsFoundationCandidate, string, error) {
	prompt := buildNewsMemoCandidateExtractionPrompt(today, assetClassLines, memo)
	text, err := callXAIResponsesText(ctx, model, prompt, 3600, false)
	if err != nil {
		return nil, text, err
	}
	var payload newsFoundationCandidatePayload
	if err := json.Unmarshal([]byte(cleanJSONText(text)), &payload); err != nil {
		return nil, text, fmt.Errorf("failed to parse memo candidate JSON: %w", err)
	}
	return normaliseNewsFoundationCandidates(payload.Candidates), text, nil
}

func callXAIMemoCandidateValidation(ctx context.Context, model string, today string, assetClassLines string, candidates []newsFoundationCandidate, researchTasks []newsFoundationResearchTask) (newsNarrativeModelPayload, string, error) {
	prompt := buildNewsMemoCandidateValidationPrompt(today, assetClassLines, candidates, researchTasks)
	text, err := callXAIResponsesText(ctx, model, prompt, 7200, true)
	if err != nil {
		return newsNarrativeModelPayload{}, text, err
	}
	var payload newsNarrativeModelPayload
	if err := json.Unmarshal([]byte(cleanJSONText(text)), &payload); err != nil {
		return newsNarrativeModelPayload{}, text, fmt.Errorf("failed to parse memo validation JSON: %w", err)
	}
	return payload, text, nil
}

func callXAIResponsesText(ctx context.Context, model string, prompt string, maxOutputTokens int, useWebSearch bool) (string, error) {
	apiKey := strings.TrimSpace(os.Getenv("XAI_API_KEY"))
	if apiKey == "" {
		return "", fmt.Errorf("XAI_API_KEY not configured")
	}
	input := map[string]interface{}{
		"model": model,
		"input": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"store":             false,
		"max_output_tokens": maxOutputTokens,
	}
	if useWebSearch {
		input["tools"] = []map[string]string{{"type": "web_search"}}
	}
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}

	requestCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, "POST", newsXAIResponsesURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := newsXAIHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("xAI request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("xAI API error %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	text := extractXAIResponseText(raw)
	if text == "" {
		return "", fmt.Errorf("empty xAI response")
	}
	return text, nil
}

func buildNewsMemoCandidateExtractionPrompt(today string, assetClassLines string, memo *portfolioMemoRun) string {
	return fmt.Sprintf(`You are extracting durable macro thesis candidates for Alpha Edge as of %s.

Do not use web search for this step. Parse only the portfolio memo below. Your job is to convert the memo into structured candidate claims that can later be validated with web search.

Extract 10 to 20 serious thesis candidates where the memo implies a durable market view. Include:
- regime claims
- inflation, rates, liquidity, credit, and oil-shock assumptions
- energy, gold, commodity, defence, AI, technology, fixed income, cash, and broad equity claims where present
- rejected alternatives where they matter
- invalidation triggers if the memo implies them

Allowed timeframes: 1M, 6M, 1Y. Use 1D or 1W only if the memo is explicitly short-term.
Use only canonical asset-class codes from the vocabulary.

Portfolio asset class vocabulary:
%s

Portfolio memo:
%s

Return JSON only:
{
  "candidates": [
    {
      "title": "stable short title",
      "timeframe": "1Y",
      "claim": "one precise claim to validate",
      "reasoning": "why the memo implies this",
      "source_section": "executive_summary|analyst_memo|chairman_memo|asset_class_targets",
      "source_excerpt": "short exact-ish memo excerpt or close paraphrase",
      "invalidation_trigger": "what would weaken or falsify this claim",
      "asset_classes": ["ENERGY_PRODUCERS"],
      "tags": ["inflation", "energy"]
    }
  ]
}`, today, assetClassLines, buildPortfolioMemoContextForNewsPrompt(memo))
}

func buildNewsMemoCandidateValidationPrompt(today string, assetClassLines string, candidates []newsFoundationCandidate, researchTasks []newsFoundationResearchTask) string {
	return fmt.Sprintf(`You are validating Alpha Edge portfolio-memo thesis candidates with web search as of %s.

Use web search across the last 12 months. Validate each candidate against current evidence. Do not simply repeat the memo.

This is a foundation research pass, not a generic news feed. First cover the research lanes below. Then return one canonical thesis per actual macro theme. Do not return separate theses for different phrasings of the same theme. For example, AI capex, AI earnings, AI infrastructure, semiconductor demand, and technology leadership are one thesis family unless the evidence clearly separates them.

For each returned thesis decide whether it is ACTIVE, WATCH, RESOLVED, or REJECTED, and whether the current evidence SUPPORTS, CHALLENGES, MODIFIES, CONFIRMS, RESOLVES, or creates a NEW thesis.
Aim for 10 to 20 serious theses when the research justifies them. Include both supporting and opposing evidence where available. Every thesis must have a specific invalidation trigger.

Portfolio asset class vocabulary:
%s

Candidate claims:
%s

Research lanes to cover before writing the ledger:
%s

Return JSON only:
{
  "daily_summary": "one compact foundation summary paragraph",
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
      "headline": "market evidence headline",
      "summary": "evidence summary",
      "timeframe": "1Y",
      "impact_score": 0.8,
      "sources": ["Reuters"],
      "asset_classes": ["ENERGY_PRODUCERS"],
      "tags": ["oil", "inflation"]
    }
  ],
  "thesis_updates": [
    {
      "title": "stable thesis title",
      "timeframe": "1Y",
      "status": "ACTIVE",
      "relationship": "CONFIRMS",
      "conviction": 0.72,
      "conviction_delta": 0.05,
      "summary": "validated thesis wording",
      "evidence": "latest net evidence and why it matters",
      "supporting_evidence": "supporting evidence from the last 12 months",
      "opposing_evidence": "opposing or weakening evidence, or empty string",
      "invalidation_trigger": "specific condition that would weaken or resolve the thesis",
      "source_excerpt": "memo source excerpt that produced this candidate",
      "sources": ["Reuters", "Bloomberg"],
      "asset_classes": ["ENERGY_PRODUCERS"],
      "tags": ["oil", "inflation"]
    }
  ]
}`, today, assetClassLines, mustJSON(candidates), buildNewsFoundationResearchPlanForPrompt(researchTasks))
}

func normaliseNewsFoundationCandidates(candidates []newsFoundationCandidate) []newsFoundationCandidate {
	seen := map[string]bool{}
	result := []newsFoundationCandidate{}
	for _, candidate := range candidates {
		candidate.Title = strings.TrimSpace(candidate.Title)
		candidate.Timeframe = normaliseNewsTimeframe(candidate.Timeframe)
		candidate.Claim = strings.TrimSpace(candidate.Claim)
		candidate.Reasoning = strings.TrimSpace(candidate.Reasoning)
		candidate.SourceSection = strings.TrimSpace(candidate.SourceSection)
		candidate.SourceExcerpt = strings.TrimSpace(candidate.SourceExcerpt)
		candidate.InvalidationTrigger = strings.TrimSpace(candidate.InvalidationTrigger)
		candidate.Status = normaliseNewsStatus(candidate.Status)
		candidate.Conviction = clamp01(candidate.Conviction)
		candidate.SupportingEvidence = strings.TrimSpace(candidate.SupportingEvidence)
		candidate.OpposingEvidence = strings.TrimSpace(candidate.OpposingEvidence)
		candidate.Sources = cleanStringList(candidate.Sources, 4)
		candidate.AssetClasses = normaliseNewsFoundationAssetClasses(candidate.AssetClasses)
		candidate.Tags = cleanStringList(candidate.Tags, 8)
		if candidate.Title == "" || candidate.Claim == "" {
			continue
		}
		key := newsThesisSlug(candidate.Title, candidate.Timeframe)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, candidate)
		if len(result) >= maxNewsFoundationCandidates {
			break
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		return newsFoundationCandidateRank(result[i]) < newsFoundationCandidateRank(result[j])
	})
	return result
}

func normaliseNewsFoundationAssetClasses(values []string) []string {
	validCodes := loadNewsFoundationAssetClassCodes()
	result := []string{}
	for _, value := range values {
		code := normalizePrimaryAssetClass(value)
		if code != "" && validCodes[code] {
			result = append(result, code)
		}
	}
	return cleanStringList(result, 8)
}

func loadNewsFoundationAssetClassCodes() map[string]bool {
	validCodes := map[string]bool{}
	if sqliteTableExists("asset_classes") {
		rows, err := db.Query(`
			SELECT code
			FROM asset_classes
			WHERE active = 1
			  AND allow_target_weight = 1
		`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var code string
				if err := rows.Scan(&code); err != nil {
					continue
				}
				normalized := normalizePrimaryAssetClass(code)
				if normalized != "" {
					validCodes[normalized] = true
				}
			}
		}
	}
	if len(validCodes) > 0 {
		return validCodes
	}
	for _, assetClass := range defaultAssetClassSettings {
		if !assetClass.Active || !assetClass.AllowTargetWeight {
			continue
		}
		code := normalizePrimaryAssetClass(assetClass.Code)
		if code != "" {
			validCodes[code] = true
		}
	}
	return validCodes
}

func newsFoundationCandidateRank(candidate newsFoundationCandidate) int {
	switch candidate.Timeframe {
	case "1Y":
		return 0
	case "6M":
		return 1
	case "1M":
		return 2
	case "1W":
		return 3
	default:
		return 4
	}
}

func persistNewsFoundationCandidates(ctx context.Context, memoJobID string, candidates []newsFoundationCandidate) error {
	if err := ensureNewsFoundationCandidateSchema(); err != nil {
		return err
	}
	memoJobID = strings.TrimSpace(memoJobID)
	if memoJobID == "" {
		return fmt.Errorf("memo_job_id is required for foundation candidates")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, candidate := range normaliseNewsFoundationCandidates(candidates) {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO news_foundation_candidates (
				memo_job_id, title, timeframe, claim, reasoning, source_section,
				source_excerpt, status, conviction, supporting_evidence, opposing_evidence,
				invalidation_trigger, sources_json, asset_classes_json, tags_json, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(memo_job_id, title, timeframe) DO UPDATE SET
				claim = excluded.claim,
				reasoning = excluded.reasoning,
				source_section = excluded.source_section,
				source_excerpt = excluded.source_excerpt,
				status = excluded.status,
				conviction = excluded.conviction,
				supporting_evidence = excluded.supporting_evidence,
				opposing_evidence = excluded.opposing_evidence,
				invalidation_trigger = excluded.invalidation_trigger,
				sources_json = excluded.sources_json,
				asset_classes_json = excluded.asset_classes_json,
				tags_json = excluded.tags_json,
				updated_at = CURRENT_TIMESTAMP
		`, memoJobID, candidate.Title, candidate.Timeframe, candidate.Claim, candidate.Reasoning,
			candidate.SourceSection, candidate.SourceExcerpt, candidate.Status, candidate.Conviction,
			candidate.SupportingEvidence, candidate.OpposingEvidence, candidate.InvalidationTrigger,
			mustJSON(candidate.Sources), mustJSON(candidate.AssetClasses), mustJSON(candidate.Tags)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func enrichValidatedUpdatesFromCandidates(payload *newsNarrativeModelPayload, candidates []newsFoundationCandidate) {
	candidateByKey := map[string]newsFoundationCandidate{}
	candidateByTheme := map[string]newsFoundationCandidate{}
	for _, candidate := range candidates {
		candidateByKey[newsThesisSlug(candidate.Title, candidate.Timeframe)] = candidate
		themeKey := candidate.Timeframe + "|" + newsFoundationCanonicalThemeKey(newsNarrativeModelUpdate{
			Title:        candidate.Title,
			Timeframe:    candidate.Timeframe,
			Summary:      candidate.Claim,
			Evidence:     candidate.Reasoning,
			AssetClasses: candidate.AssetClasses,
			Tags:         candidate.Tags,
		})
		if _, exists := candidateByTheme[themeKey]; !exists {
			candidateByTheme[themeKey] = candidate
		}
	}
	for i := range payload.ThesisUpdates {
		update := &payload.ThesisUpdates[i]
		key := newsThesisSlug(update.Title, normaliseNewsTimeframe(update.Timeframe))
		candidate, ok := candidateByKey[key]
		if !ok {
			themeKey := normaliseNewsTimeframe(update.Timeframe) + "|" + newsFoundationCanonicalThemeKey(*update)
			candidate, ok = candidateByTheme[themeKey]
			if !ok {
				continue
			}
		}
		if strings.TrimSpace(update.SourceExcerpt) == "" {
			update.SourceExcerpt = candidate.SourceExcerpt
		}
		if strings.TrimSpace(update.InvalidationTrigger) == "" {
			update.InvalidationTrigger = candidate.InvalidationTrigger
		}
		if len(update.AssetClasses) == 0 {
			update.AssetClasses = candidate.AssetClasses
		}
		if len(update.Tags) == 0 {
			update.Tags = candidate.Tags
		}
	}
}

func combineFoundationRaw(extractionRaw string, validationRaw string) string {
	return mustJSON(map[string]string{
		"candidate_extraction": extractionRaw,
		"candidate_validation": validationRaw,
	})
}
