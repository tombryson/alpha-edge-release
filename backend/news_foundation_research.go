package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

const maxNewsFoundationResearchTasks = 18

type newsFoundationResearchTask struct {
	ID           int64    `json:"id,omitempty"`
	MemoJobID    string   `json:"memo_job_id,omitempty"`
	Lane         string   `json:"lane"`
	Timeframe    string   `json:"timeframe"`
	Query        string   `json:"query"`
	Priority     int      `json:"priority"`
	AssetClasses []string `json:"asset_classes"`
	Tags         []string `json:"tags"`
}

type newsFoundationCluster struct {
	CanonicalKey   string   `json:"canonical_key"`
	Timeframe      string   `json:"timeframe"`
	Title          string   `json:"title"`
	AbsorbedTitles []string `json:"absorbed_titles"`
	AssetClasses   []string `json:"asset_classes"`
	Tags           []string `json:"tags"`
}

func ensureNewsFoundationResearchSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS news_foundation_research_tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL,
			lane TEXT NOT NULL,
			timeframe TEXT NOT NULL DEFAULT '1Y',
			query TEXT NOT NULL DEFAULT '',
			priority INTEGER NOT NULL DEFAULT 0,
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_news_foundation_research_tasks_memo
			ON news_foundation_research_tasks(memo_job_id, priority, id);

		CREATE TABLE IF NOT EXISTS news_foundation_clusters (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL,
			canonical_key TEXT NOT NULL,
			timeframe TEXT NOT NULL DEFAULT '1Y',
			title TEXT NOT NULL DEFAULT '',
			absorbed_titles_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(memo_job_id, canonical_key, timeframe)
		);

		CREATE INDEX IF NOT EXISTS idx_news_foundation_clusters_memo
			ON news_foundation_clusters(memo_job_id, timeframe, canonical_key);
	`)
	return err
}

func buildNewsFoundationResearchTasks(memo *portfolioMemoRun, candidates []newsFoundationCandidate) []newsFoundationResearchTask {
	tasks := []newsFoundationResearchTask{
		{
			Lane:      "macro_cycle",
			Timeframe: "1Y",
			Query:     "last 12 months inflation, growth, rates, liquidity, credit spreads, recession risk, and central-bank policy implications for portfolio allocation",
			Priority:  10,
			Tags:      []string{"macro", "rates", "credit", "inflation"},
		},
		{
			Lane:      "commodities_energy",
			Timeframe: "1Y",
			Query:     "last 12 months oil, gas, gold, copper, uranium, and critical minerals price leadership, supply shocks, inventory stress, and demand trends",
			Priority:  20,
			Tags:      []string{"commodities", "energy", "gold", "critical-minerals"},
		},
		{
			Lane:      "geopolitics_defence",
			Timeframe: "1Y",
			Query:     "last 12 months geopolitical fragmentation, conflict risk, defence spending, sanctions, tariffs, shipping disruption, and real-asset hedge demand",
			Priority:  30,
			Tags:      []string{"geopolitics", "defence", "supply-chain"},
		},
		{
			Lane:      "technology_ai",
			Timeframe: "1Y",
			Query:     "last 12 months AI capex, semiconductor demand, hyperscaler spending, data centre infrastructure, earnings leadership, and technology market breadth",
			Priority:  40,
			Tags:      []string{"ai", "technology", "semiconductors"},
		},
		{
			Lane:      "regional_relative_growth",
			Timeframe: "1Y",
			Query:     "last 12 months US, China, emerging market, Australia, and developed-market relative growth, policy support, earnings revisions, and equity leadership",
			Priority:  50,
			Tags:      []string{"regional", "china", "emerging-markets"},
		},
	}

	// Dynamic per-position lanes: add a targeted lane for each asset class
	// where current portfolio weight exceeds 5%. This focuses the research on
	// positions that materially affect NAV rather than generic coverage.
	seenClasses := map[string]bool{}
	portfolioWeightMap := loadNewsPortfolioWeightMap()
	type weightedClass struct {
		code   string
		weight float64
	}
	var heavyPositions []weightedClass
	for code, weight := range portfolioWeightMap {
		if weight >= 5.0 {
			heavyPositions = append(heavyPositions, weightedClass{code: code, weight: weight})
		}
	}
	sort.SliceStable(heavyPositions, func(i, j int) bool {
		return heavyPositions[i].weight > heavyPositions[j].weight
	})
	for i, pos := range heavyPositions {
		if i >= 8 {
			break
		}
		lane := "position_" + strings.ToLower(pos.code)
		humanName := humanReadableAssetClassForResearch(pos.code)
		query := fmt.Sprintf(
			"last 12 months supply/demand dynamics, price drivers, geopolitical risk, regulatory developments, and key invalidation events for %s (currently %.1f%% of portfolio)",
			humanName, pos.weight,
		)
		tasks = append(tasks, newsFoundationResearchTask{
			Lane:         lane,
			Timeframe:    "1Y",
			Query:        query,
			Priority:     55 + i,
			AssetClasses: []string{pos.code},
			Tags:         []string{"portfolio-position", "high-weight"},
		})
		seenClasses[pos.code] = true
	}

	for _, candidate := range candidates {
		for _, class := range candidate.AssetClasses {
			class = normalizePrimaryAssetClass(class)
			if class == "" || seenClasses[class] {
				continue
			}
			seenClasses[class] = true
			tasks = append(tasks, newsFoundationResearchTask{
				Lane:         "asset_class_" + strings.ToLower(class),
				Timeframe:    "1Y",
				Query:        fmt.Sprintf("last 12 months news, performance, earnings, risks, and invalidation evidence for %s as a portfolio asset class", humanReadableAssetClassForResearch(class)),
				Priority:     100 + len(tasks),
				AssetClasses: []string{class},
				Tags:         []string{"asset-class"},
			})
		}
	}

	for i, candidate := range candidates {
		if i >= 8 {
			break
		}
		tasks = append(tasks, newsFoundationResearchTask{
			Lane:         "memo_candidate",
			Timeframe:    normaliseNewsTimeframe(candidate.Timeframe),
			Query:        strings.TrimSpace(candidate.Claim),
			Priority:     200 + i,
			AssetClasses: candidate.AssetClasses,
			Tags:         append([]string{"memo-prior"}, candidate.Tags...),
		})
	}

	if memo != nil {
		for _, target := range memo.AssetClassTargets {
			code := assetClassCodeFromMemoTarget(target)
			if code == "" || seenClasses[code] {
				continue
			}
			seenClasses[code] = true
			tasks = append(tasks, newsFoundationResearchTask{
				Lane:         "portfolio_target_" + strings.ToLower(code),
				Timeframe:    "1Y",
				Query:        fmt.Sprintf("last 12 months evidence for or against allocating portfolio capital to %s", humanReadableAssetClassForResearch(code)),
				Priority:     300 + len(tasks),
				AssetClasses: []string{code},
				Tags:         []string{"portfolio-target"},
			})
		}
	}

	return normaliseNewsFoundationResearchTasks(tasks)
}

func normaliseNewsFoundationResearchTasks(tasks []newsFoundationResearchTask) []newsFoundationResearchTask {
	seen := map[string]bool{}
	result := []newsFoundationResearchTask{}
	for _, task := range tasks {
		task.Lane = strings.TrimSpace(task.Lane)
		task.Timeframe = normaliseNewsTimeframe(task.Timeframe)
		task.Query = strings.TrimSpace(task.Query)
		task.AssetClasses = normaliseNewsFoundationAssetClasses(task.AssetClasses)
		task.Tags = cleanStringList(task.Tags, 8)
		if task.Lane == "" || task.Query == "" {
			continue
		}
		key := strings.ToLower(task.Lane + "|" + task.Timeframe + "|" + task.Query)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, task)
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Priority == result[j].Priority {
			return result[i].Lane < result[j].Lane
		}
		return result[i].Priority < result[j].Priority
	})
	if len(result) > maxNewsFoundationResearchTasks {
		result = result[:maxNewsFoundationResearchTasks]
	}
	return result
}

func persistNewsFoundationResearchTasks(ctx context.Context, memoJobID string, tasks []newsFoundationResearchTask) error {
	if err := ensureNewsFoundationResearchSchema(); err != nil {
		return err
	}
	memoJobID = strings.TrimSpace(memoJobID)
	if memoJobID == "" {
		return fmt.Errorf("memo_job_id is required for foundation research tasks")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_foundation_research_tasks WHERE memo_job_id = ?`, memoJobID); err != nil {
		return err
	}
	for _, task := range normaliseNewsFoundationResearchTasks(tasks) {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO news_foundation_research_tasks (
				memo_job_id, lane, timeframe, query, priority, asset_classes_json, tags_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, memoJobID, task.Lane, task.Timeframe, task.Query, task.Priority, mustJSON(task.AssetClasses), mustJSON(task.Tags)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func aggregateNewsFoundationPayload(payload *newsNarrativeModelPayload) []newsFoundationCluster {
	if payload == nil {
		return nil
	}
	updates, clusters := aggregateNewsFoundationThesisUpdates(payload.ThesisUpdates)
	payload.ThesisUpdates = updates
	return clusters
}

func aggregateNewsFoundationThesisUpdates(updates []newsNarrativeModelUpdate) ([]newsNarrativeModelUpdate, []newsFoundationCluster) {
	type aggregate struct {
		update newsNarrativeModelUpdate
		titles []string
		key    string
	}
	ordered := []string{}
	byKey := map[string]*aggregate{}
	for _, update := range updates {
		update.Title = strings.TrimSpace(update.Title)
		update.Timeframe = normaliseNewsTimeframe(update.Timeframe)
		if update.Title == "" {
			continue
		}
		key := newsFoundationCanonicalThemeKey(update)
		compoundKey := update.Timeframe + "|" + key
		existing, ok := byKey[compoundKey]
		if !ok {
			ordered = append(ordered, compoundKey)
			byKey[compoundKey] = &aggregate{
				update: update,
				titles: []string{update.Title},
				key:    key,
			}
			continue
		}
		existing.update = mergeNewsFoundationUpdate(existing.update, update)
		existing.titles = cleanStringList(append(existing.titles, update.Title), 20)
	}

	result := make([]newsNarrativeModelUpdate, 0, len(ordered))
	clusters := make([]newsFoundationCluster, 0, len(ordered))
	for _, compoundKey := range ordered {
		aggregate := byKey[compoundKey]
		result = append(result, aggregate.update)
		clusters = append(clusters, newsFoundationCluster{
			CanonicalKey:   aggregate.key,
			Timeframe:      aggregate.update.Timeframe,
			Title:          aggregate.update.Title,
			AbsorbedTitles: aggregate.titles,
			AssetClasses:   aggregate.update.AssetClasses,
			Tags:           aggregate.update.Tags,
		})
	}
	return result, clusters
}

func mergeNewsFoundationUpdate(base newsNarrativeModelUpdate, next newsNarrativeModelUpdate) newsNarrativeModelUpdate {
	if next.Conviction > base.Conviction {
		base.Title = preferNewsFoundationTitle(base.Title, next.Title)
		base.Conviction = next.Conviction
		if strings.TrimSpace(next.Summary) != "" {
			base.Summary = next.Summary
		}
	}
	if absFloat(next.ConvictionDelta) > absFloat(base.ConvictionDelta) {
		base.ConvictionDelta = next.ConvictionDelta
	}
	base.Status = mergeNewsFoundationStatus(base.Status, next.Status)
	base.Relationship = mergeNewsFoundationRelationship(base.Relationship, next.Relationship)
	base.Evidence = mergeNewsText(base.Evidence, next.Evidence, 700)
	base.SupportingEvidence = mergeNewsText(base.SupportingEvidence, next.SupportingEvidence, 900)
	base.OpposingEvidence = mergeNewsText(base.OpposingEvidence, next.OpposingEvidence, 700)
	if strings.TrimSpace(base.InvalidationTrigger) == "" {
		base.InvalidationTrigger = strings.TrimSpace(next.InvalidationTrigger)
	}
	base.SourceExcerpt = mergeNewsText(base.SourceExcerpt, next.SourceExcerpt, 600)
	base.Sources = cleanStringList(append(base.Sources, next.Sources...), 8)
	base.AssetClasses = normaliseNewsFoundationAssetClasses(append(base.AssetClasses, next.AssetClasses...))
	base.Tags = cleanStringList(append(base.Tags, next.Tags...), 12)
	return base
}

func persistNewsFoundationClusters(ctx context.Context, memoJobID string, clusters []newsFoundationCluster) error {
	if err := ensureNewsFoundationResearchSchema(); err != nil {
		return err
	}
	memoJobID = strings.TrimSpace(memoJobID)
	if memoJobID == "" {
		return nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_foundation_clusters WHERE memo_job_id = ?`, memoJobID); err != nil {
		return err
	}
	for _, cluster := range clusters {
		if strings.TrimSpace(cluster.CanonicalKey) == "" || strings.TrimSpace(cluster.Title) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO news_foundation_clusters (
				memo_job_id, canonical_key, timeframe, title, absorbed_titles_json,
				asset_classes_json, tags_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(memo_job_id, canonical_key, timeframe) DO UPDATE SET
				title = excluded.title,
				absorbed_titles_json = excluded.absorbed_titles_json,
				asset_classes_json = excluded.asset_classes_json,
				tags_json = excluded.tags_json
		`, memoJobID, cluster.CanonicalKey, normaliseNewsTimeframe(cluster.Timeframe), cluster.Title,
			mustJSON(cluster.AbsorbedTitles), mustJSON(cluster.AssetClasses), mustJSON(cluster.Tags)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func buildNewsFoundationResearchPlanForPrompt(tasks []newsFoundationResearchTask) string {
	tasks = normaliseNewsFoundationResearchTasks(tasks)
	if len(tasks) == 0 {
		return "- no explicit lanes"
	}
	lines := make([]string, 0, len(tasks))
	for _, task := range tasks {
		classText := "all portfolio classes"
		if len(task.AssetClasses) > 0 {
			classText = strings.Join(task.AssetClasses, ", ")
		}
		lines = append(lines, fmt.Sprintf("- [%s/%s] %s | classes: %s | query: %s", task.Timeframe, task.Lane, strings.Join(task.Tags, ","), classText, task.Query))
	}
	return strings.Join(lines, "\n")
}

func newsFoundationCanonicalThemeKey(update newsNarrativeModelUpdate) string {
	text := strings.ToLower(strings.Join([]string{
		update.Title,
		update.Summary,
		update.Evidence,
		strings.Join(update.Tags, " "),
	}, " "))
	text = strings.ReplaceAll(text, "&", " and ")
	text = strings.ReplaceAll(text, "_", " ")
	switch {
	case containsAny(text, "artificial intelligence", " ai ", "ai-", "semiconductor", "semiconductors", "datacentre", "data centre", "hyperscaler", "capex", "infrastructure supercycle", "technology leadership", "earnings leadership"):
		return "ai_technology_leadership"
	case containsAny(text, "geopolitical", "fragmentation", "defence", "defense", "war", "conflict", "sanction", "tariff") && containsAny(text, "gold", "real asset", "safe haven", "energy", "oil", "defence", "defense"):
		return "geopolitical_real_asset_premium"
	case containsAny(text, "critical mineral", "rare earth", "copper", "base metal", "china restriction", "export restriction", "tariff", "commodity cycle"):
		return "critical_minerals_supply_cycle"
	case containsAny(text, "inflation", "higher-for-longer", "rate", "rates", "fed", "central bank", "treasury", "duration", "credit spread", "liquidity"):
		return "inflation_rates_credit_cycle"
	case containsAny(text, "oil", "gas", "opec", "lng", "energy producer", "energy producers", "energy supply"):
		return "energy_oil_supply_cycle"
	case containsAny(text, "china", "em equities", "emerging market", "developed market", "dm equities", "us resilience"):
		return "regional_growth_divergence"
	default:
		return "title_" + newsThesisSlug(update.Title, "")
	}
}

func assetClassCodeFromMemoTarget(target map[string]interface{}) string {
	for _, key := range []string{"asset_class", "assetClass", "asset_class_code", "assetClassCode", "code", "class"} {
		value, ok := target[key]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			code := normalizePrimaryAssetClass(text)
			if code != "" {
				return code
			}
		}
	}
	return ""
}

func humanReadableAssetClassForResearch(code string) string {
	code = normalizePrimaryAssetClass(code)
	for _, class := range loadAssetClasses() {
		if normalizePrimaryAssetClass(class.Code) == code && strings.TrimSpace(class.DisplayName) != "" {
			return class.DisplayName
		}
	}
	return strings.Title(strings.ToLower(strings.ReplaceAll(code, "_", " ")))
}

func mergeNewsFoundationStatus(a string, b string) string {
	a = normaliseNewsStatus(a)
	b = normaliseNewsStatus(b)
	order := map[string]int{"ACTIVE": 4, "WATCH": 3, "RESOLVED": 2, "REJECTED": 1}
	if order[b] > order[a] {
		return b
	}
	return a
}

func mergeNewsFoundationRelationship(a string, b string) string {
	a = normaliseNewsRelationship(a)
	b = normaliseNewsRelationship(b)
	order := map[string]int{"CHALLENGES": 6, "MODIFIES": 5, "CONFIRMS": 4, "SUPPORTS": 3, "NEW": 2, "RESOLVES": 1}
	if order[b] > order[a] {
		return b
	}
	return a
}

func preferNewsFoundationTitle(a string, b string) string {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	if len(b) < len(a)-12 {
		return b
	}
	return a
}

func mergeNewsText(a string, b string, limit int) string {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" {
		return truncatePromptText(b, limit)
	}
	if b == "" || strings.Contains(strings.ToLower(a), strings.ToLower(b)) {
		return truncatePromptText(a, limit)
	}
	merged := a + " " + b
	return truncatePromptText(merged, limit)
}

func containsAny(text string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(text, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}
