package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func setupNewsNarrativeAssetClassTestDB(t *testing.T) func() {
	t.Helper()

	cleanup := setupAssetClassesTestDB(t)
	if err := ensureNewsNarrativeSchema(); err != nil {
		cleanup()
		t.Fatalf("create news narrative tables: %v", err)
	}
	return cleanup
}

func findNewsThesis(t *testing.T, theses []newsThesis, title string) newsThesis {
	t.Helper()

	for _, thesis := range theses {
		if thesis.Title == title {
			return thesis
		}
	}
	t.Fatalf("missing thesis %q in %#v", title, theses)
	return newsThesis{}
}

func TestNewsNarrativeLifecycleFromFoundationToResolvedTheses(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()

	foundation := newsNarrativeModelPayload{
		DailySummary: "Foundation map identifies gold and oil as the main 12-month macro narratives.",
		MarketContext: newsMarketContext{
			TopThemes12M:       []string{"Real-rate pressure", "Energy supply risk"},
			TopPerformers12M:   []string{"Gold miners"},
			WorstPerformers12M: []string{"Long-duration software"},
		},
		NewsItems: []newsNarrativeModelItem{
			{
				Headline:     "Gold miners lead the 12-month commodity complex",
				Summary:      "Real rates and central-bank demand supported the sector.",
				Timeframe:    "1Y",
				ImpactScore:  0.9,
				Sources:      []string{"Reuters"},
				AssetClasses: []string{"Gold Miners"},
				Tags:         []string{"gold", "rates"},
			},
		},
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:           "Gold miners benefit from easing real rates",
				Timeframe:       "6M",
				Status:          "ACTIVE",
				Relationship:    "NEW",
				Conviction:      0.72,
				ConvictionDelta: 0,
				Summary:         "Gold miners benefit while real yields fall.",
				Evidence:        "Foundation pass established the long-horizon thesis.",
				Sources:         []string{"Reuters"},
				AssetClasses:    []string{"GOLD_MINERS"},
				Tags:            []string{"gold"},
			},
			{
				Title:           "Oil supply risk supports energy producers",
				Timeframe:       "1M",
				Status:          "WATCH",
				Relationship:    "NEW",
				Conviction:      0.48,
				ConvictionDelta: 0,
				Summary:         "Energy producers remain sensitive to geopolitical supply risk.",
				Evidence:        "Foundation pass established a watch thesis.",
				Sources:         []string{"Bloomberg"},
				AssetClasses:    []string{"Energy Producers"},
				Tags:            []string{"oil"},
			},
		},
	}
	normaliseNewsNarrativePayload(&foundation)
	foundationRunID, err := persistNewsNarrativePayload("BOOTSTRAP", foundation, `{"fixture":"foundation"}`, "grok-test")
	if err != nil {
		t.Fatalf("persist foundation payload: %v", err)
	}

	daily := newsNarrativeModelPayload{
		DailySummary: "Daily evidence challenged gold, resolved oil supply risk, and created a semiconductor thesis.",
		MarketContext: newsMarketContext{
			NewsThemes1M:      []string{"Rates repricing", "AI capex"},
			TopPerformers1M:   []string{"Semiconductors"},
			WorstPerformers1M: []string{"Gold miners"},
		},
		NewsItems: []newsNarrativeModelItem{
			{
				Headline:     "Bond yields rise after stronger US data",
				Summary:      "Higher yields challenged the gold-miner thesis.",
				Timeframe:    "1D",
				ImpactScore:  0.7,
				Sources:      []string{"Reuters"},
				AssetClasses: []string{"Gold Miners"},
				Tags:         []string{"rates"},
			},
		},
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:           "Gold miners benefit from easing real rates",
				Timeframe:       "6M",
				Status:          "ACTIVE",
				Relationship:    "CHALLENGES",
				Conviction:      0.53,
				ConvictionDelta: -0.19,
				Summary:         "Gold remains positive, but the real-rate tailwind weakened.",
				Evidence:        "Yields rose and gold miners lagged.",
				Sources:         []string{"Reuters"},
				AssetClasses:    []string{"Gold Miners"},
				Tags:            []string{"gold", "rates"},
			},
			{
				Title:           "Oil supply risk supports energy producers",
				Timeframe:       "1M",
				Status:          "RESOLVED",
				Relationship:    "RESOLVES",
				Conviction:      0.18,
				ConvictionDelta: -0.3,
				Summary:         "The near-term oil supply risk faded.",
				Evidence:        "Peace talks reduced the risk premium.",
				Sources:         []string{"Bloomberg"},
				AssetClasses:    []string{"Energy Producers"},
				Tags:            []string{"oil"},
			},
			{
				Title:           "AI capex supports semiconductors",
				Timeframe:       "6M",
				Status:          "ACTIVE",
				Relationship:    "NEW",
				Conviction:      0.66,
				ConvictionDelta: 0.08,
				Summary:         "AI capex remains a positive sector driver.",
				Evidence:        "Large-cap earnings guidance supported chip demand.",
				Sources:         []string{"Company reports"},
				AssetClasses:    []string{"Semiconductors"},
				Tags:            []string{"ai", "chips"},
			},
		},
	}
	normaliseNewsNarrativePayload(&daily)
	dailyRunID, err := persistNewsNarrativePayload("daily", daily, `{"fixture":"daily"}`, "grok-test")
	if err != nil {
		t.Fatalf("persist daily payload: %v", err)
	}

	response, err := loadNewsBriefResponseForRun(context.Background(), dailyRunID)
	if err != nil {
		t.Fatalf("load daily response: %v", err)
	}
	if response.Run == nil || response.Run.Mode != "DAILY" {
		t.Fatalf("run = %#v, want DAILY", response.Run)
	}
	if response.FoundationRun == nil || response.FoundationRun.ID != foundationRunID {
		t.Fatalf("foundation run = %#v, want run %d", response.FoundationRun, foundationRunID)
	}
	if len(response.Theses) != 3 {
		t.Fatalf("thesis count = %d, want 3: %#v", len(response.Theses), response.Theses)
	}
	if len(response.Updates) != 3 {
		t.Fatalf("update count = %d, want 3: %#v", len(response.Updates), response.Updates)
	}

	gold := findNewsThesis(t, response.Theses, "Gold miners benefit from easing real rates")
	if gold.Status != "ACTIVE" || gold.Conviction != 0.53 || gold.Summary != "Gold remains positive, but the real-rate tailwind weakened." {
		t.Fatalf("gold thesis = %#v, want challenged active thesis", gold)
	}
	oil := findNewsThesis(t, response.Theses, "Oil supply risk supports energy producers")
	if oil.Status != "RESOLVED" || oil.ResolvedAt == "" {
		t.Fatalf("oil thesis = %#v, want resolved thesis with resolved_at", oil)
	}
	semis := findNewsThesis(t, response.Theses, "AI capex supports semiconductors")
	if semis.Status != "ACTIVE" || semis.Conviction != 0.66 {
		t.Fatalf("semiconductor thesis = %#v, want new active thesis", semis)
	}

	activeLedger := loadActiveNewsThesesForPrompt()
	if !strings.Contains(activeLedger, "Gold miners benefit from easing real rates") {
		t.Fatalf("active ledger does not include active gold thesis: %s", activeLedger)
	}
	if !strings.Contains(activeLedger, "AI capex supports semiconductors") {
		t.Fatalf("active ledger does not include active semiconductor thesis: %s", activeLedger)
	}
	if strings.Contains(activeLedger, "Oil supply risk supports energy producers") {
		t.Fatalf("active ledger includes resolved oil thesis: %s", activeLedger)
	}
}

func TestNewsNarrativeRelationshipDirectionsArePreserved(t *testing.T) {
	cleanup := setupNewsNarrativeTestDB(t)
	defer cleanup()

	relationships := []string{"NEW", "SUPPORTS", "CHALLENGES", "MODIFIES", "CONFIRMS", "RESOLVES"}
	payload := newsNarrativeModelPayload{DailySummary: "Relationship direction fixture."}
	for _, relationship := range relationships {
		status := "ACTIVE"
		if relationship == "RESOLVES" {
			status = "RESOLVED"
		}
		payload.ThesisUpdates = append(payload.ThesisUpdates, newsNarrativeModelUpdate{
			Title:           "Direction " + relationship,
			Timeframe:       "1M",
			Status:          status,
			Relationship:    relationship,
			Conviction:      0.5,
			ConvictionDelta: 0,
			Summary:         "Fixture thesis for " + relationship,
			Evidence:        "Fixture evidence for " + relationship,
		})
	}
	normaliseNewsNarrativePayload(&payload)
	runID, err := persistNewsNarrativePayload("BOOTSTRAP", payload, `{"fixture":"directions"}`, "grok-test")
	if err != nil {
		t.Fatalf("persist relationship payload: %v", err)
	}

	response, err := loadNewsBriefResponseForRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("load response: %v", err)
	}
	seen := map[string]bool{}
	for _, update := range response.Updates {
		seen[update.Relationship] = true
	}
	for _, relationship := range relationships {
		if !seen[relationship] {
			t.Fatalf("missing relationship %s in %#v", relationship, response.Updates)
		}
	}
}

func TestNewsNarrativePayloadNormalisationAndAssetClassValidation(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()

	payload := newsNarrativeModelPayload{
		DailySummary: "  Noisy model fixture.  ",
		NewsItems: []newsNarrativeModelItem{
			{
				Headline:     "  Noisy item  ",
				Timeframe:    "six_months",
				ImpactScore:  7.5,
				Sources:      []string{"Reuters", "Reuters", "", "Bloomberg", "AFR", "FT", "WSJ"},
				AssetClasses: []string{"gold miners", "Rare Earths & Critical Minerals", "not a real class"},
				Tags:         []string{"rates", "rates", "gold", "miners", "risk", "macro", "commodities", "signal", "overflow"},
			},
		},
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:           "  Noisy thesis  ",
				Timeframe:       "year",
				Status:          "completed",
				Relationship:    "directionless",
				Conviction:      -0.5,
				ConvictionDelta: 8,
				Summary:         "  Trimmed summary  ",
				Evidence:        "  Trimmed evidence  ",
				Sources:         []string{"Reuters", "Reuters", "Bloomberg", "AFR", "FT"},
				AssetClasses:    []string{"semis", "fake lane"},
				Tags:            []string{"ai", "ai"},
			},
		},
	}
	normaliseNewsNarrativePayload(&payload)

	item := payload.NewsItems[0]
	if payload.DailySummary != "Noisy model fixture." || item.Headline != "Noisy item" {
		t.Fatalf("string trimming failed: %#v", payload)
	}
	if item.Timeframe != "6M" || item.ImpactScore != 1 {
		t.Fatalf("item timeframe/impact = %s/%v, want 6M/1", item.Timeframe, item.ImpactScore)
	}
	if strings.Join(item.Sources, ",") != "Reuters,Bloomberg,AFR,FT" {
		t.Fatalf("sources = %#v, want de-duped first four", item.Sources)
	}
	if strings.Join(item.AssetClasses, ",") != "GOLD_MINERS,RARE_EARTHS_CRITICAL_MINERALS" {
		t.Fatalf("asset classes = %#v, want canonical valid classes only", item.AssetClasses)
	}
	if len(item.Tags) != 8 {
		t.Fatalf("tags = %#v, want capped to 8 unique tags", item.Tags)
	}

	update := payload.ThesisUpdates[0]
	if update.Title != "Noisy thesis" || update.Timeframe != "1Y" {
		t.Fatalf("update title/timeframe = %q/%q, want trimmed 1Y", update.Title, update.Timeframe)
	}
	if update.Status != "ACTIVE" || update.Relationship != "MODIFIES" {
		t.Fatalf("update status/relationship = %s/%s, want ACTIVE/MODIFIES", update.Status, update.Relationship)
	}
	if update.Conviction != 0 || update.ConvictionDelta != 1 {
		t.Fatalf("update conviction/delta = %v/%v, want 0/1", update.Conviction, update.ConvictionDelta)
	}
	if strings.Join(update.AssetClasses, ",") != "SEMICONDUCTORS" {
		t.Fatalf("update asset classes = %#v, want SEMICONDUCTORS only", update.AssetClasses)
	}
}

func TestNewsNarrativePromptsSeparateFoundationFromDailyLedger(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()

	payload := newsNarrativeModelPayload{
		DailySummary: "Foundation prompt fixture.",
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:        "Active gold thesis",
				Timeframe:    "6M",
				Status:       "ACTIVE",
				Relationship: "NEW",
				Conviction:   0.6,
				Summary:      "This active thesis should be injected into daily prompts.",
			},
			{
				Title:        "Resolved oil thesis",
				Timeframe:    "1M",
				Status:       "RESOLVED",
				Relationship: "RESOLVES",
				Conviction:   0.2,
				Summary:      "This resolved thesis should not be injected into daily prompts.",
			},
		},
	}
	normaliseNewsNarrativePayload(&payload)
	if _, err := persistNewsNarrativePayload("BOOTSTRAP", payload, `{"fixture":"prompt"}`, "grok-test"); err != nil {
		t.Fatalf("persist prompt payload: %v", err)
	}

	bootstrapPrompt := buildNewsNarrativePrompt("foundation")
	if !strings.Contains(bootstrapPrompt, "first foundation map") {
		t.Fatalf("bootstrap prompt missing foundation wording: %s", bootstrapPrompt)
	}
	if strings.Contains(bootstrapPrompt, "Active gold thesis") {
		t.Fatalf("bootstrap prompt should not inject active ledger: %s", bootstrapPrompt)
	}

	dailyPrompt := buildNewsNarrativePrompt("daily")
	if !strings.Contains(dailyPrompt, "daily maintenance run") || !strings.Contains(dailyPrompt, "Do not rediscover the whole market from scratch") {
		t.Fatalf("daily prompt missing maintenance wording: %s", dailyPrompt)
	}
	if !strings.Contains(dailyPrompt, "Active gold thesis") {
		t.Fatalf("daily prompt missing active thesis ledger: %s", dailyPrompt)
	}
	if strings.Contains(dailyPrompt, "Resolved oil thesis") {
		t.Fatalf("daily prompt includes resolved thesis: %s", dailyPrompt)
	}
	if !strings.Contains(dailyPrompt, "GOLD_MINERS: Gold Miners") {
		t.Fatalf("daily prompt missing canonical asset-class vocabulary: %s", dailyPrompt)
	}
}

func TestNewsNarrativeFoundationPromptCanUsePortfolioMemoSource(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()

	if err := ensurePortfolioMemoSchema(); err != nil {
		t.Fatalf("create portfolio memo tables: %v", err)
	}
	if _, err := persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:            "portfolio_job_macro",
		RunID:                "council_run_macro",
		Mode:                 "DEEP",
		Status:               "succeeded",
		Model:                "council-test",
		PrimaryTheme:         "Inflationary late-cycle expansion",
		ExecutiveSummary:     "The memo favours energy producers, gold miners, cash, and fixed income ballast.",
		AnalystMemoMarkdown:  "Energy and gold exposure are the dominant inflation-aware sleeves.",
		ChairmanMemoMarkdown: "Rejects a conventional disinflationary 60/40 posture.",
		AssetClassTargets: []map[string]interface{}{
			{"asset_class": "ENERGY_PRODUCERS", "target_pct": 30.0},
			{"asset_class": "GOLD_MINERS", "target_pct": 22.0},
		},
	}); err != nil {
		t.Fatalf("persist portfolio memo source: %v", err)
	}

	prompt, err := buildNewsNarrativePromptWithSource(context.Background(), "foundation", "portfolio_job_macro")
	if err != nil {
		t.Fatalf("build memo-seeded foundation prompt: %v", err)
	}
	for _, want := range []string{
		"Do not use web search",
		"Extract 10 to 20 serious thesis candidates",
		"Inflationary late-cycle expansion",
		"Energy and gold exposure",
		"ENERGY_PRODUCERS",
		"GOLD_MINERS",
		"invalidation_trigger",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("memo-seeded prompt missing %q: %s", want, prompt)
		}
	}

	payload := newsNarrativeModelPayload{
		DailySummary: "Memo-seeded foundation run.",
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:               "Inflationary late-cycle expansion favours energy and gold",
				Timeframe:           "1Y",
				Status:              "ACTIVE",
				Relationship:        "CONFIRMS",
				Conviction:          0.75,
				Summary:             "Energy and gold remain favoured in an inflation-aware portfolio.",
				Evidence:            "Oil and gold leadership validated the memo thesis.",
				SupportingEvidence:  "Energy prices and gold both remained elevated.",
				OpposingEvidence:    "Disinflation would weaken this thesis.",
				InvalidationTrigger: "Oil below trend and real yields falling without gold strength.",
				SourceExcerpt:       "The memo favours energy producers, gold miners, cash, and fixed income ballast.",
				AssetClasses:        []string{"ENERGY_PRODUCERS", "GOLD_MINERS"},
			},
		},
	}
	normaliseNewsNarrativePayload(&payload)
	runID, err := persistNewsNarrativePayloadWithSource("BOOTSTRAP", payload, `{"fixture":"memo"}`, "grok-test", "PORTFOLIO_MEMO", "portfolio_job_macro")
	if err != nil {
		t.Fatalf("persist sourced foundation run: %v", err)
	}
	run, err := loadNewsRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("load sourced news run: %v", err)
	}
	if run.SourceType != "PORTFOLIO_MEMO" || run.SourceID != "portfolio_job_macro" {
		t.Fatalf("run source = %s/%s, want portfolio memo source", run.SourceType, run.SourceID)
	}

	response, err := loadNewsBriefResponseForRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("load sourced response: %v", err)
	}
	thesis := findNewsThesis(t, response.Theses, "Inflationary late-cycle expansion favours energy and gold")
	if thesis.SourceType != "PORTFOLIO_MEMO" || thesis.SourceID != "portfolio_job_macro" {
		t.Fatalf("thesis source = %s/%s, want memo provenance", thesis.SourceType, thesis.SourceID)
	}
	if thesis.SourceExcerpt == "" || thesis.SupportingEvidence == "" || thesis.OpposingEvidence == "" || thesis.InvalidationTrigger == "" {
		t.Fatalf("thesis missing validation provenance fields: %#v", thesis)
	}
}

func TestNewsFoundationCandidatesNormalisePersistAndDedupe(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()

	input := []newsFoundationCandidate{
		{
			Title:               "  Energy leadership persists  ",
			Timeframe:           "year",
			Claim:               "Energy remains a leadership sleeve.",
			Reasoning:           "Memo overweighted energy.",
			SourceSection:       "executive_summary",
			SourceExcerpt:       "core energy exposure",
			InvalidationTrigger: "Oil breaks lower.",
			AssetClasses:        []string{"energy producers", "fake"},
			Tags:                []string{"oil", "oil", "inflation"},
		},
		{
			Title:        "Energy leadership persists",
			Timeframe:    "1Y",
			Claim:        "Duplicate should be removed.",
			AssetClasses: []string{"ENERGY_PRODUCERS"},
		},
		{
			Title:        "No claim candidate",
			Timeframe:    "6M",
			Claim:        "",
			AssetClasses: []string{"GOLD_MINERS"},
		},
		{
			Title:        "Gold retains crisis premium",
			Timeframe:    "6M",
			Claim:        "Gold retains a crisis premium.",
			AssetClasses: []string{"Gold Miners"},
			Tags:         []string{"gold"},
		},
	}

	normalised := normaliseNewsFoundationCandidates(input)
	if len(normalised) != 2 {
		t.Fatalf("normalised candidate count = %d, want 2: %#v", len(normalised), normalised)
	}
	if normalised[0].Title != "Energy leadership persists" || normalised[0].Timeframe != "1Y" {
		t.Fatalf("first candidate = %#v, want 1Y energy candidate", normalised[0])
	}
	if strings.Join(normalised[0].AssetClasses, ",") != "ENERGY_PRODUCERS" {
		t.Fatalf("asset classes = %#v, want canonical energy only", normalised[0].AssetClasses)
	}

	if err := persistNewsFoundationCandidates(context.Background(), "memo_candidates", input); err != nil {
		t.Fatalf("persist foundation candidates: %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM news_foundation_candidates WHERE memo_job_id = 'memo_candidates'`).Scan(&count); err != nil {
		t.Fatalf("count persisted candidates: %v", err)
	}
	if count != 2 {
		t.Fatalf("persisted candidate count = %d, want 2", count)
	}
	var assetClassesJSON string
	if err := db.QueryRow(`SELECT asset_classes_json FROM news_foundation_candidates WHERE title = 'Energy leadership persists'`).Scan(&assetClassesJSON); err != nil {
		t.Fatalf("load persisted candidate asset classes: %v", err)
	}
	if assetClassesJSON != `["ENERGY_PRODUCERS"]` {
		t.Fatalf("asset class json = %s, want ENERGY_PRODUCERS", assetClassesJSON)
	}
}

func TestNewsFoundationAggregationCollapsesSemanticDuplicates(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()

	input := []newsNarrativeModelUpdate{
		{
			Title:              "AI capex sustains Technology sector leadership",
			Timeframe:          "1Y",
			Status:             "ACTIVE",
			Relationship:       "NEW",
			Conviction:         0.85,
			Summary:            "Hyperscaler capex supports technology leadership.",
			Evidence:           "Semiconductor demand remains resilient.",
			SupportingEvidence: "AI infrastructure spending stayed elevated.",
			Sources:            []string{"Reuters"},
			AssetClasses:       []string{"SEMICONDUCTORS"},
			Tags:               []string{"ai", "capex"},
		},
		{
			Title:              "AI infrastructure supercycle drives sustained Tech outperformance",
			Timeframe:          "1Y",
			Status:             "ACTIVE",
			Relationship:       "CONFIRMS",
			Conviction:         0.8,
			Summary:            "Data-centre spending keeps the AI trade intact.",
			Evidence:           "Hyperscaler spending supports semiconductors.",
			SupportingEvidence: "Earnings leadership broadened through the AI chain.",
			Sources:            []string{"Bloomberg"},
			AssetClasses:       []string{"TECHNOLOGY_PLATFORMS"},
			Tags:               []string{"ai", "semiconductors"},
		},
		{
			Title:              "Critical minerals supply risks from China restrictions and tariffs",
			Timeframe:          "1Y",
			Status:             "ACTIVE",
			Relationship:       "NEW",
			Conviction:         0.7,
			Summary:            "Export controls support critical-mineral scarcity premia.",
			Evidence:           "China restrictions tightened rare-earth supply chains.",
			SupportingEvidence: "Tariffs and export controls raised supply risk.",
			Sources:            []string{"Reuters"},
			AssetClasses:       []string{"RARE_EARTHS_CRITICAL_MINERALS"},
			Tags:               []string{"china", "critical-minerals"},
		},
	}

	output, clusters := aggregateNewsFoundationThesisUpdates(input)
	if len(output) != 2 {
		t.Fatalf("aggregated thesis count = %d, want 2: %#v", len(output), output)
	}
	if len(clusters) != 2 {
		t.Fatalf("cluster count = %d, want 2: %#v", len(clusters), clusters)
	}
	if clusters[0].CanonicalKey != "ai_technology_leadership" {
		t.Fatalf("first cluster key = %q, want ai_technology_leadership", clusters[0].CanonicalKey)
	}
	if len(clusters[0].AbsorbedTitles) != 2 {
		t.Fatalf("AI cluster absorbed titles = %#v, want two AI variants", clusters[0].AbsorbedTitles)
	}
	if strings.Join(output[0].Sources, ",") != "Reuters,Bloomberg" {
		t.Fatalf("merged sources = %#v, want both sources", output[0].Sources)
	}
	if strings.Join(output[0].AssetClasses, ",") != "SEMICONDUCTORS,TECHNOLOGY_PLATFORMS" {
		t.Fatalf("merged asset classes = %#v, want both technology classes", output[0].AssetClasses)
	}
	if clusters[1].CanonicalKey != "critical_minerals_supply_cycle" {
		t.Fatalf("second cluster key = %q, want critical minerals family", clusters[1].CanonicalKey)
	}
}

func TestNewsNarrativeFailedRunDoesNotReplaceCompletedBrief(t *testing.T) {
	cleanup := setupNewsNarrativeTestDB(t)
	defer cleanup()

	payload := newsNarrativeModelPayload{
		DailySummary: "Completed daily brief should remain visible after a failed run.",
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:        "Visible thesis",
				Timeframe:    "1D",
				Status:       "ACTIVE",
				Relationship: "NEW",
				Conviction:   0.5,
				Summary:      "The completed thesis remains visible.",
			},
		},
	}
	normaliseNewsNarrativePayload(&payload)
	runID, err := persistNewsNarrativePayload("DAILY", payload, `{"fixture":"completed"}`, "grok-test")
	if err != nil {
		t.Fatalf("persist completed payload: %v", err)
	}
	recordFailedNewsRun("daily", "grok-test", errNewsNarrativeFixture("mock xAI outage"))

	response, err := loadNewsBriefResponse(context.Background())
	if err != nil {
		t.Fatalf("load news brief: %v", err)
	}
	if response.Run == nil || response.Run.ID != runID || response.Run.Status != "COMPLETED" {
		t.Fatalf("response run = %#v, want previous completed run %d", response.Run, runID)
	}

	var failedCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM news_runs WHERE status = 'FAILED' AND error_message = 'mock xAI outage'`).Scan(&failedCount); err != nil {
		t.Fatalf("count failed runs: %v", err)
	}
	if failedCount != 1 {
		t.Fatalf("failed count = %d, want 1", failedCount)
	}
}

func TestNewsRunModeParsing(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{name: "empty", body: "", want: "DAILY"},
		{name: "daily", body: `{"mode":"daily"}`, want: "DAILY"},
		{name: "bootstrap", body: `{"mode":"bootstrap"}`, want: "BOOTSTRAP"},
		{name: "foundation alias", body: `{"mode":"foundation"}`, want: "BOOTSTRAP"},
		{name: "bad json", body: `{`, want: "DAILY"},
		{name: "unknown", body: `{"mode":"weekly"}`, want: "DAILY"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/api/news/run", strings.NewReader(tc.body))
			if got := parseNewsRunMode(request); got != tc.want {
				t.Fatalf("parseNewsRunMode(%q) = %q, want %q", tc.body, got, tc.want)
			}
		})
	}
}

func TestNewsRunRequestParsingKeepsMemoSource(t *testing.T) {
	request := httptest.NewRequest("POST", "/api/news/run", strings.NewReader(`{"mode":"foundation","source_memo_job_id":" memo_123 "}`))
	parsed := parseNewsRunRequest(request)
	if parsed.Mode != "BOOTSTRAP" || parsed.SourceMemoJobID != "memo_123" {
		t.Fatalf("parsed request = %#v, want bootstrap memo source", parsed)
	}
}

func TestNewsRunMemoSeededFoundationHTTPFlow(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()
	t.Setenv("XAI_API_KEY", "test-xai-key")
	t.Setenv("XAI_NEWS_MODEL", "grok-test")

	if err := ensurePortfolioMemoSchema(); err != nil {
		t.Fatalf("create memo table: %v", err)
	}
	if _, err := persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:         "memo_seeded_http",
		RunID:             "portfolio_run_1",
		Mode:              "DEEP",
		Status:            "succeeded",
		Model:             "council-test",
		AnalysisDate:      "2026-06-09",
		PrimaryTheme:      "Inflationary late-cycle expansion",
		ExecutiveSummary:  "Energy producers and gold miners remain leadership sleeves with oil-shock tail risk.",
		AssetClassTargets: []map[string]interface{}{{"asset_class": "ENERGY_PRODUCERS", "target_pct": 30}, {"asset_class": "GOLD_MINERS", "target_pct": 22}},
	}); err != nil {
		t.Fatalf("persist memo: %v", err)
	}

	var extractionCalled bool
	var validationCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode xAI request: %v", err)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-xai-key" {
			t.Fatalf("authorization header = %q, want bearer test key", got)
		}
		_, hasTools := body["tools"]
		if !hasTools {
			extractionCalled = true
			if maxTokens := body["max_output_tokens"]; maxTokens != float64(3600) {
				t.Fatalf("extraction max_output_tokens = %#v, want 3600", maxTokens)
			}
			writeXAITextResponse(w, `{
				"candidates": [
					{
						"title": "Energy and gold remain leadership sleeves",
						"timeframe": "1Y",
						"claim": "Energy producers and gold miners remain favoured in an inflationary late-cycle expansion.",
						"reasoning": "The portfolio memo explicitly overweighted energy and gold.",
						"source_section": "executive_summary",
						"source_excerpt": "Energy producers and gold miners remain leadership sleeves.",
						"invalidation_trigger": "Oil and gold break below long-term support.",
						"asset_classes": ["ENERGY_PRODUCERS", "fake"],
						"tags": ["inflation", "oil", "gold"]
					}
				]
			}`)
			return
		}
		validationCalled = true
		if maxTokens := body["max_output_tokens"]; maxTokens != float64(7200) {
			t.Fatalf("validation max_output_tokens = %#v, want 7200", maxTokens)
		}
		requestJSON := mustJSON(body)
		if !strings.Contains(requestJSON, "Energy and gold remain leadership sleeves") {
			t.Fatalf("validation request did not include candidate: %s", requestJSON)
		}
		if !strings.Contains(requestJSON, "Research lanes to cover") || !strings.Contains(requestJSON, "technology_ai") {
			t.Fatalf("validation request did not include research plan: %s", requestJSON)
		}
		writeXAITextResponse(w, `{
			"daily_summary": "Memo-seeded foundation validated energy and gold leadership.",
			"market_context": {
				"top_themes_12m": ["Inflationary late-cycle expansion"],
				"top_performers_12m": ["Energy Producers", "Gold Miners"],
				"worst_performers_12m": ["Duration bonds"],
				"news_themes_1m": ["Oil shock risk"],
				"top_performers_1m": ["Energy Producers"],
				"worst_performers_1m": ["Physical Gold"]
			},
			"news_items": [
				{
					"headline": "Oil and gold leadership persists",
					"summary": "Recent evidence supports inflation-aware sleeves.",
					"timeframe": "1Y",
					"impact_score": 0.82,
					"sources": ["Reuters"],
					"asset_classes": ["ENERGY_PRODUCERS", "GOLD_MINERS"],
					"tags": ["inflation"]
				}
			],
			"thesis_updates": [
				{
					"title": "Energy and gold remain leadership sleeves",
					"timeframe": "1Y",
					"status": "ACTIVE",
					"relationship": "CONFIRMS",
					"conviction": 0.81,
					"conviction_delta": 0.08,
					"summary": "Energy and gold retain leadership characteristics.",
					"evidence": "Web evidence confirms the memo thesis.",
					"supporting_evidence": "Oil remains firm and gold demand persists.",
					"opposing_evidence": "Lower inflation would weaken the view.",
					"invalidation_trigger": "Oil and gold break below long-term support.",
					"source_excerpt": "Energy producers and gold miners remain leadership sleeves.",
					"sources": ["Reuters"],
					"asset_classes": ["ENERGY_PRODUCERS", "GOLD_MINERS"],
					"tags": ["inflation", "gold"]
				}
			]
		}`)
	}))
	defer server.Close()
	restoreNewsXAITestTransport(server)
	defer restoreNewsXAITestTransport(nil)

	request := httptest.NewRequest(http.MethodPost, "/api/news/run", strings.NewReader(`{"mode":"foundation","source_memo_job_id":"memo_seeded_http"}`))
	recorder := httptest.NewRecorder()
	runNewsBrief(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("run status = %d body=%s, want 200", recorder.Code, recorder.Body.String())
	}
	if !extractionCalled || !validationCalled {
		t.Fatalf("xAI calls extraction=%v validation=%v, want both", extractionCalled, validationCalled)
	}

	var response newsBriefResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode news response: %v", err)
	}
	if response.Run == nil || response.Run.Mode != "BOOTSTRAP" || response.Run.SourceType != "PORTFOLIO_MEMO" || response.Run.SourceID != "memo_seeded_http" {
		t.Fatalf("run response = %#v, want memo-seeded bootstrap provenance", response.Run)
	}
	thesis := findNewsThesis(t, response.Theses, "Energy and gold remain leadership sleeves")
	if thesis.SourceType != "PORTFOLIO_MEMO" || thesis.SourceID != "memo_seeded_http" {
		t.Fatalf("thesis source = %s/%s, want memo provenance", thesis.SourceType, thesis.SourceID)
	}
	if thesis.SourceExcerpt == "" || thesis.SupportingEvidence == "" || thesis.OpposingEvidence == "" || thesis.InvalidationTrigger == "" {
		t.Fatalf("thesis missing validation fields: %#v", thesis)
	}

	var candidateCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM news_foundation_candidates WHERE memo_job_id = ?`, "memo_seeded_http").Scan(&candidateCount); err != nil {
		t.Fatalf("count candidates: %v", err)
	}
	if candidateCount != 1 {
		t.Fatalf("candidate count = %d, want 1", candidateCount)
	}
	var candidateAssetClasses string
	if err := db.QueryRow(`SELECT asset_classes_json FROM news_foundation_candidates WHERE memo_job_id = ?`, "memo_seeded_http").Scan(&candidateAssetClasses); err != nil {
		t.Fatalf("load candidate asset classes: %v", err)
	}
	if candidateAssetClasses != `["ENERGY_PRODUCERS"]` {
		t.Fatalf("candidate asset classes = %s, want canonical filtered ENERGY_PRODUCERS", candidateAssetClasses)
	}
	var taskCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM news_foundation_research_tasks WHERE memo_job_id = ?`, "memo_seeded_http").Scan(&taskCount); err != nil {
		t.Fatalf("count research tasks: %v", err)
	}
	if taskCount < 5 {
		t.Fatalf("research task count = %d, want macro fan-out tasks", taskCount)
	}
	var clusterCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM news_foundation_clusters WHERE memo_job_id = ?`, "memo_seeded_http").Scan(&clusterCount); err != nil {
		t.Fatalf("count clusters: %v", err)
	}
	if clusterCount != 1 {
		t.Fatalf("cluster count = %d, want one validated thesis cluster", clusterCount)
	}
}

func TestNewsRunMemoSeededValidationFailureRecordsFailedRunOnly(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()
	t.Setenv("XAI_API_KEY", "test-xai-key")
	t.Setenv("XAI_NEWS_MODEL", "grok-test")

	if err := ensurePortfolioMemoSchema(); err != nil {
		t.Fatalf("create memo table: %v", err)
	}
	completed := newsNarrativeModelPayload{
		DailySummary: "Last good foundation.",
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:        "Existing gold thesis",
				Timeframe:    "1Y",
				Status:       "ACTIVE",
				Relationship: "NEW",
				Conviction:   0.7,
				Summary:      "Existing saved thesis.",
				Evidence:     "Prior foundation evidence.",
				AssetClasses: []string{"GOLD_MINERS"},
			},
		},
	}
	normaliseNewsNarrativePayload(&completed)
	completedRunID, err := persistNewsNarrativePayload("BOOTSTRAP", completed, `{"fixture":"last-good"}`, "grok-test")
	if err != nil {
		t.Fatalf("persist completed run: %v", err)
	}
	if _, err := persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:        "memo_validation_fails",
		RunID:            "portfolio_run_fail",
		Status:           "succeeded",
		ExecutiveSummary: "Energy producers remain favoured.",
	}); err != nil {
		t.Fatalf("persist memo: %v", err)
	}

	var callCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount += 1
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode xAI request: %v", err)
		}
		_, hasTools := body["tools"]
		if !hasTools {
			writeXAITextResponse(w, `{
				"candidates": [
					{
						"title": "Energy remains favoured",
						"timeframe": "1Y",
						"claim": "Energy remains favoured.",
						"asset_classes": ["ENERGY_PRODUCERS"]
					}
				]
			}`)
			return
		}
		http.Error(w, "validation outage", http.StatusInternalServerError)
	}))
	defer server.Close()
	restoreNewsXAITestTransport(server)
	defer restoreNewsXAITestTransport(nil)

	request := httptest.NewRequest(http.MethodPost, "/api/news/run", strings.NewReader(`{"mode":"bootstrap","source_memo_job_id":"memo_validation_fails"}`))
	recorder := httptest.NewRecorder()
	runNewsBrief(recorder, request)
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("run status = %d body=%s, want 502", recorder.Code, recorder.Body.String())
	}
	if callCount != 2 {
		t.Fatalf("xAI call count = %d, want extraction plus validation", callCount)
	}

	response, err := loadNewsBriefResponse(context.Background())
	if err != nil {
		t.Fatalf("load latest brief: %v", err)
	}
	if response.Run == nil || response.Run.ID != completedRunID {
		t.Fatalf("latest completed run = %#v, want last good run %d", response.Run, completedRunID)
	}
	var failedCount int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM news_runs
		WHERE status = 'FAILED'
		  AND mode = 'BOOTSTRAP'
		  AND error_message LIKE '%xAI API error 500%'
	`).Scan(&failedCount); err != nil {
		t.Fatalf("count failed runs: %v", err)
	}
	if failedCount != 1 {
		t.Fatalf("failed run count = %d, want 1", failedCount)
	}
}

func TestNewsFoundationJobPromotesActiveCohort(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()
	t.Setenv("XAI_API_KEY", "test-xai-key")
	t.Setenv("XAI_NEWS_MODEL", "grok-test")

	if err := ensurePortfolioMemoSchema(); err != nil {
		t.Fatalf("create memo table: %v", err)
	}
	if _, err := persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:        "memo_job_promotes",
		RunID:            "portfolio_run_promotes",
		Status:           "succeeded",
		ExecutiveSummary: "Energy, gold, semiconductors, fixed income, and broad equity drive the macro map.",
	}); err != nil {
		t.Fatalf("persist memo: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode xAI request: %v", err)
		}
		if _, hasTools := body["tools"]; hasTools {
			writeXAITextResponse(w, buildNewsFoundationValidationFixture(8))
			return
		}
		writeXAITextResponse(w, buildNewsFoundationCandidateFixture(8))
	}))
	defer server.Close()
	restoreNewsXAITestTransport(server)
	defer restoreNewsXAITestTransport(nil)

	job, err := createNewsFoundationJob(context.Background(), "memo_job_promotes")
	if err != nil {
		t.Fatalf("create foundation job: %v", err)
	}
	runNewsFoundationJob(job.ID)

	completed, err := loadNewsFoundationJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load completed job: %v", err)
	}
	if completed.Status != "SUCCEEDED" || completed.FoundationCohortID == 0 || completed.RunID == 0 {
		t.Fatalf("completed job = %#v, want promoted cohort and run", completed)
	}

	response, err := loadNewsBriefResponse(context.Background())
	if err != nil {
		t.Fatalf("load brief: %v", err)
	}
	if response.FoundationCohort == nil || response.FoundationCohort.ID != completed.FoundationCohortID {
		t.Fatalf("foundation cohort = %#v, want active cohort %d", response.FoundationCohort, completed.FoundationCohortID)
	}
	if len(response.Theses) != 8 {
		t.Fatalf("visible thesis count = %d, want 8", len(response.Theses))
	}
	for _, thesis := range response.Theses {
		if thesis.FoundationCohortID != completed.FoundationCohortID {
			t.Fatalf("thesis %q cohort = %d, want %d", thesis.Title, thesis.FoundationCohortID, completed.FoundationCohortID)
		}
	}
}

func TestNewsFoundationJobRepairsThinGenericBootstrap(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()
	t.Setenv("XAI_API_KEY", "test-xai-key")
	t.Setenv("XAI_NEWS_MODEL", "grok-test")

	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode xAI request: %v", err)
		}
		input := fmt.Sprint(body["input"])
		if strings.Contains(input, "repairing a thin Alpha Edge foundation news run") {
			writeXAITextResponse(w, buildNewsFoundationValidationFixture(5))
			return
		}
		writeXAITextResponse(w, buildNewsFoundationValidationFixture(4))
	}))
	defer server.Close()
	restoreNewsXAITestTransport(server)
	defer restoreNewsXAITestTransport(nil)

	job, err := createNewsFoundationJob(context.Background(), "")
	if err != nil {
		t.Fatalf("create foundation job: %v", err)
	}
	runNewsFoundationJob(job.ID)

	completed, err := loadNewsFoundationJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load completed job: %v", err)
	}
	if completed.Status != "SUCCEEDED" || completed.ThesisCount != 5 {
		t.Fatalf("completed job = %#v, want repaired success with 5 theses", completed)
	}
	if callCount != 2 {
		t.Fatalf("xAI call count = %d, want initial bootstrap plus repair pass", callCount)
	}
}

func TestNewsFoundationJobFailureDoesNotReplaceActiveCohort(t *testing.T) {
	cleanup := setupNewsNarrativeAssetClassTestDB(t)
	defer cleanup()
	t.Setenv("XAI_API_KEY", "test-xai-key")
	t.Setenv("XAI_NEWS_MODEL", "grok-test")

	if err := ensurePortfolioMemoSchema(); err != nil {
		t.Fatalf("create memo table: %v", err)
	}
	if _, err := persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:        "memo_job_fails_quality",
		RunID:            "portfolio_run_quality",
		Status:           "succeeded",
		ExecutiveSummary: "Thin memo fixture.",
	}); err != nil {
		t.Fatalf("persist memo: %v", err)
	}

	seedJob := &newsFoundationJob{
		ID:              "seed_job",
		SourceType:      "PORTFOLIO_MEMO",
		SourceID:        "seed_memo",
		SourceMemoJobID: "seed_memo",
	}
	seedPayload := buildNewsFoundationModelFixture(8)
	quality := newsFoundationQuality{Score: 0.9, ThesisCount: 8, CandidateCount: 8}
	activeCohortID, _, err := promoteNewsFoundationCohort(context.Background(), seedJob, seedPayload, `{"fixture":"seed"}`, "grok-test", quality)
	if err != nil {
		t.Fatalf("seed active cohort: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode xAI request: %v", err)
		}
		if _, hasTools := body["tools"]; hasTools {
			writeXAITextResponse(w, buildNewsFoundationValidationFixture(1))
			return
		}
		writeXAITextResponse(w, buildNewsFoundationCandidateFixture(1))
	}))
	defer server.Close()
	restoreNewsXAITestTransport(server)
	defer restoreNewsXAITestTransport(nil)

	job, err := createNewsFoundationJob(context.Background(), "memo_job_fails_quality")
	if err != nil {
		t.Fatalf("create foundation job: %v", err)
	}
	runNewsFoundationJob(job.ID)

	failed, err := loadNewsFoundationJob(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("load failed job: %v", err)
	}
	if failed.Status != "FAILED" || !strings.Contains(failed.ErrorMessage, "quality gate") {
		t.Fatalf("failed job = %#v, want quality-gate failure", failed)
	}
	active := loadActiveNewsFoundationCohort(context.Background())
	if active == nil || active.ID != activeCohortID {
		t.Fatalf("active cohort = %#v, want original cohort %d", active, activeCohortID)
	}
}

func buildNewsFoundationCandidateFixture(count int) string {
	candidates := make([]map[string]interface{}, 0, count)
	for i := 0; i < count; i++ {
		class := "ENERGY_PRODUCERS"
		if i%2 == 1 {
			class = "GOLD_MINERS"
		}
		candidates = append(candidates, map[string]interface{}{
			"title":                fmt.Sprintf("Foundation thesis %02d", i+1),
			"timeframe":            "1Y",
			"claim":                fmt.Sprintf("Durable macro claim %02d remains active.", i+1),
			"reasoning":            "The portfolio memo implies this as a strategic premise.",
			"source_section":       "executive_summary",
			"source_excerpt":       "Energy, gold, semiconductors, fixed income, and broad equity drive the macro map.",
			"invalidation_trigger": "The supporting macro data reverses.",
			"asset_classes":        []string{class},
			"tags":                 []string{"fixture"},
		})
	}
	return mustJSON(map[string]interface{}{"candidates": candidates})
}

func buildNewsFoundationValidationFixture(count int) string {
	payload := buildNewsFoundationModelFixture(count)
	return mustJSON(payload)
}

func buildNewsFoundationModelFixture(count int) newsNarrativeModelPayload {
	payload := newsNarrativeModelPayload{
		DailySummary: "Validated memo-seeded foundation fixture.",
		MarketContext: newsMarketContext{
			TopThemes12M:       []string{"Inflationary late-cycle expansion"},
			TopPerformers12M:   []string{"Energy Producers", "Gold Miners"},
			WorstPerformers12M: []string{"Duration bonds"},
			NewsThemes1M:       []string{"Oil shock risk"},
			TopPerformers1M:    []string{"Energy Producers"},
			WorstPerformers1M:  []string{"Physical Gold"},
		},
		NewsItems: []newsNarrativeModelItem{
			{
				Headline:     "Macro fixture evidence supports leadership sleeves",
				Summary:      "Fixture evidence maps to the foundation theses.",
				Timeframe:    "1Y",
				ImpactScore:  0.8,
				Sources:      []string{"Reuters"},
				AssetClasses: []string{"ENERGY_PRODUCERS"},
				Tags:         []string{"fixture"},
			},
		},
	}
	for i := 0; i < count; i++ {
		class := "ENERGY_PRODUCERS"
		if i%2 == 1 {
			class = "GOLD_MINERS"
		}
		payload.ThesisUpdates = append(payload.ThesisUpdates, newsNarrativeModelUpdate{
			Title:               fmt.Sprintf("Foundation thesis %02d", i+1),
			Timeframe:           "1Y",
			Status:              "ACTIVE",
			Relationship:        "CONFIRMS",
			Conviction:          0.65 + float64(i%3)*0.05,
			ConvictionDelta:     0.03,
			Summary:             fmt.Sprintf("Validated foundation thesis %02d.", i+1),
			Evidence:            "Current evidence supports the thesis.",
			SupportingEvidence:  "Supporting evidence from the last 12 months is present.",
			OpposingEvidence:    "Opposing evidence is limited in this fixture.",
			InvalidationTrigger: "The supporting macro data reverses.",
			SourceExcerpt:       "Energy, gold, semiconductors, fixed income, and broad equity drive the macro map.",
			Sources:             []string{"Reuters", "Bloomberg"},
			AssetClasses:        []string{class},
			Tags:                []string{"fixture"},
		})
	}
	normaliseNewsNarrativePayload(&payload)
	return payload
}

type errNewsNarrativeFixture string

func (err errNewsNarrativeFixture) Error() string {
	return string(err)
}

func writeXAITextResponse(w http.ResponseWriter, text string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"output": []map[string]interface{}{
			{
				"content": []map[string]string{
					{"type": "output_text", "text": text},
				},
			},
		},
	})
}

func restoreNewsXAITestTransport(server *httptest.Server) {
	if server == nil {
		newsXAIResponsesURL = "https://api.x.ai/v1/responses"
		newsXAIHTTPClient = http.DefaultClient
		return
	}
	newsXAIResponsesURL = server.URL
	newsXAIHTTPClient = server.Client()
}
