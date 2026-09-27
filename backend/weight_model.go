package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
	"time"
)

const weightPolicyVersion = "ideal-weight-v1"

type weightPolicyMode struct {
	Enabled bool `json:"enabled"`
	Epoch   int  `json:"epoch"`
}

type weightReference struct {
	ID                   int               `json:"id"`
	Ticker               string            `json:"ticker"`
	AssetClass           string            `json:"asset_class"`
	Role                 string            `json:"role"`
	Held                 float64           `json:"held"`
	Ideal                float64           `json:"ideal"`
	ClassBudget          float64           `json:"class_budget"`
	Percent              float64           `json:"percent"`
	Coverage             float64           `json:"coverage"`
	Reduction            float64           `json:"reduction"`
	Remaining            float64           `json:"remaining"`
	Available            bool              `json:"available"`
	Reason               string            `json:"reason,omitempty"`
	ResearchMissing      int               `json:"research_missing"`
	ObservedDate         string            `json:"observed_date"`
	StatementID          int64             `json:"statement_id"`
	StatementFingerprint string            `json:"statement_fingerprint"`
	PortfolioValue       float64           `json:"portfolio_value"`
	Fresh                bool              `json:"fresh"`
	Suppressed           bool              `json:"suppressed,omitempty"`
	SourceDates          map[string]string `json:"source_dates,omitempty"`
	Inputs               json.RawMessage   `json:"inputs,omitempty"`
}

func readWeightPolicy(reader actionQueryReader) (weightPolicyMode, error) {
	var mode weightPolicyMode
	err := reader.QueryRow(`SELECT enabled, epoch FROM weight_policy WHERE id = 1`).Scan(&mode.Enabled, &mode.Epoch)
	return mode, err
}

// Display and enforcement use the same persisted research, not browser-supplied targets.
func weightReferencesFrom(reader deploymentReader, capacities map[string]deploymentClassCapacity, candidate string) (map[string]weightReference, error) {
	var statementID int64
	var observedDate string
	var portfolioValue float64
	err := reader.QueryRow(`SELECT id, date(statement_date), total_value_aud FROM account_statements ORDER BY statement_date DESC, id DESC LIMIT 1`).Scan(&statementID, &observedDate, &portfolioValue)
	if err != nil {
		return nil, err
	}
	date, dateErr := time.Parse("2006-01-02", observedDate)
	// Allow a weekend/market holiday, but never treat an old statement as today's observation.
	fresh := dateErr == nil && time.Since(date) >= -24*time.Hour && time.Since(date) <= 4*24*time.Hour
	fingerprint, err := weightStatementFingerprint(reader, statementID)
	if err != nil {
		return nil, err
	}
	rows, err := reader.Query(`SELECT id, COALESCE(ticker,''), name, COALESCE(primary_asset_class,''), COALESCE(security_type,''),
		COALESCE(is_external,0), COALESCE(gemini_quality,0), COALESCE(gemini_value,0), COALESCE(gpt_quality,0), COALESCE(gpt_value,0),
		COALESCE(perplexity_quality,0), COALESCE(perplexity_value,0), COALESCE(claude_quality,0), COALESCE(claude_value,0),
		COALESCE(council_quality,0), COALESCE(council_value,0), COALESCE(gemini_pt,0), COALESCE(gpt_pt,0), COALESCE(deer_flow_pt,0),
		COALESCE(perplexity_pt,0), COALESCE(claude_pt,0), COALESCE(council_pt,0), COALESCE(tipranks_pt,0), COALESCE(analyst_pt,0), COALESCE(current_price,0),
		json_object('analysis_row_updated_at',updated_at,'gemini_source_at',gemini_webui_input_at,'gpt_source_at',gpt_webui_input_at,
		'perplexity_source_at',perplexity_webui_input_at,'claude_source_at',claude_webui_input_at,'council_source_at',council_source_input_at)
		FROM stock_analysis ORDER BY updated_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	type researchRow struct {
		input      SizingStockInput
		name, role string
		external   bool
		dates      map[string]string
	}
	research := []researchRow{}
	identities := map[string]int{}
	for rows.Next() {
		var r researchRow
		s := &r.input
		var dates string
		if err = rows.Scan(&s.ID, &s.Ticker, &r.name, &s.AssetClass, &r.role, &r.external, &s.GeminiQuality, &s.GeminiValue, &s.GptQuality, &s.GptValue,
			&s.PerplexityQuality, &s.PerplexityValue, &s.ClaudeQuality, &s.ClaudeValue, &s.CouncilQuality, &s.CouncilValue, &s.GeminiPT, &s.GptPT,
			&s.DeerFlowPT, &s.PerplexityPT, &s.ClaudePT, &s.CouncilPT, &s.TipRanksPT, &s.AnalystPT, &s.CurrentPrice, &dates); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal([]byte(dates), &r.dates); err != nil {
			rows.Close()
			return nil, err
		}
		identities[securityActionTicker(s.Ticker)]++
		research = append(research, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = reader.Query(`SELECT COALESCE(NULLIF(h.ticker,''),m.ticker,''), COALESCE(MAX(h.company_name),''), COALESCE(SUM(h.value_aud),0), COALESCE(SUM(h.quantity),0), COUNT(*)
		FROM holdings h LEFT JOIN company_mappings m ON m.company_name=h.company_name WHERE h.is_active=1 GROUP BY COALESCE(NULLIF(h.ticker,''),m.ticker,'')`)
	if err != nil {
		return nil, err
	}
	type holding struct {
		name         string
		value, units float64
		count        int
	}
	holdings := map[string]holding{}
	for rows.Next() {
		var t string
		var h holding
		if err = rows.Scan(&t, &h.name, &h.value, &h.units, &h.count); err != nil {
			rows.Close()
			return nil, err
		}
		key := securityActionTicker(t)
		previous := holdings[key]
		h.value += previous.value
		h.units += previous.units
		h.count += previous.count
		holdings[key] = h
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	metrics, err := readAnalysisPerformanceMetrics(context.Background(), reader)
	if err != nil {
		return nil, err
	}
	groupClasses := loadGroupDerivedAssetClasses(context.Background())
	classes := loadAssetClasses()
	router, routerOK := weightRouterScores(reader)
	refs := map[string]weightReference{}
	inputs := []SizingStockInput{}
	missing := map[string]int{}
	unknownClassMissing := 0
	for ticker, h := range holdings {
		if identities[ticker] > 0 || (h.value <= 0 && h.units <= 0) || isNonAllocatingInstrumentName(h.name) {
			continue
		}
		group := groupClasses[strings.TrimSpace(h.name)]
		if group == "" {
			group = groupClasses[canonicalCompanyNameKey(h.name)]
		}
		class := resolveAuthoritativeAssetClassFromAssetClasses(group, "", ticker, h.name, classes)
		if class != "" && class != "UNASSIGNED" {
			missing[class]++
		} else {
			unknownClassMissing++
		}
	}
	for _, r := range research {
		s := r.input
		ticker := securityActionTicker(s.Ticker)
		h := holdings[ticker]
		if ticker == "" || r.external || isNonAllocatingSecurityType(r.role) || isNonAllocatingInstrumentName(r.name) || (h.units <= 0 && h.value <= 0 && ticker != securityActionTicker(candidate)) {
			continue
		}
		group := groupClasses[strings.TrimSpace(r.name)]
		if group == "" {
			group = groupClasses[canonicalCompanyNameKey(r.name)]
		}
		s.AssetClass = resolveAuthoritativeAssetClassFromAssetClasses(group, s.AssetClass, canonicalSecurityTickerKey(s.Ticker), r.name, classes)
		capacity := capacities[s.AssetClass]
		ref := weightReference{ID: s.ID, Ticker: strings.ToUpper(s.Ticker), AssetClass: s.AssetClass, Role: "STOCK", Held: h.value, ClassBudget: capacity.ApprovedTarget,
			ObservedDate: observedDate, StatementID: statementID, StatementFingerprint: fingerprint, PortfolioValue: portfolioValue, Fresh: fresh, SourceDates: r.dates}
		if identities[ticker] != 1 || h.count > 1 {
			ref.Reason = "Resolve duplicate security identities"
			refs[ticker] = ref
			missing[s.AssetClass]++
			continue
		}
		if fund, ok := capacity.ETFs[ticker]; ok || strings.EqualFold(r.role, "ETF") {
			ref.Role = "ETF"
			if ok && fund.IsCore {
				ref.Role = "CORE_ETF"
				ref.Ideal = fund.EffectiveTargetValue
				ref.Available = capacity.ApprovedTarget > 0
			}
			if !ref.Available {
				ref.Reason = "No Core ETF target"
			}
			policy := loadETFAllocationPolicyFrom(reader)
			var publication string
			if policy.MomentumSource == "INTERNAL_PUBLISHED" {
				err = reader.QueryRow(`SELECT published_at FROM etf_momentum_runs WHERE status='COMPLETE' AND published_at IS NOT NULL ORDER BY published_at DESC,id DESC LIMIT 1`).Scan(&publication)
			} else {
				err = reader.QueryRow(`SELECT last_updated FROM etf_allocations WHERE UPPER(ticker)=UPPER(?)`, fund.Ticker).Scan(&publication)
			}
			if err != nil && err != sql.ErrNoRows {
				return nil, err
			}
			ref.SourceDates["etf_allocation_published_or_updated_at"] = publication
			ref.Inputs, err = json.Marshal(map[string]any{"fund": fund, "policy": policy})
			if err != nil {
				return nil, err
			}
			refs[ticker] = ref
			continue
		}
		prefix, symbol := splitFullTicker(s.Ticker)
		if metric, ok := metrics[performanceKey(symbol, prefix)]; ok {
			ref.SourceDates["stock_momentum_as_of"] = metric.asOf
			s.Performance6MPct = metric.sixMonthPct
			if metricDate, e := time.Parse("2006-01-02", metric.asOf); e != nil || time.Since(metricDate) > 4*24*time.Hour {
				ref.Fresh = false
			}
		}
		if sizingBaseRating(s) <= 0 || s.CurrentPrice <= 0 {
			ref.Reason = "Research incomplete"
			missing[s.AssetClass]++
		} else if capacity.ApprovedTarget <= 0 {
			ref.Reason = "No approved class budget"
		} else {
			ref.Available = true
		}
		refs[ticker] = ref
		inputs = append(inputs, s)
	}
	budgets := []ClassBudget{}
	for class, c := range capacities {
		budgets = append(budgets, ClassBudget{AssetClass: class, StockBudget: directStockBudget(c.ApprovedTarget, c.EffectiveETF, c.ActualETF)})
	}
	request := SizingRequest{Stocks: inputs, ClassBudgets: budgets, TotalPortfolioValue: portfolioValue, RouterScores: router}
	classInputs := map[string]json.RawMessage{}
	for _, budget := range budgets {
		classRequest := SizingRequest{TotalPortfolioValue: portfolioValue, ClassBudgets: []ClassBudget{budget}, RouterScores: router}
		for _, input := range inputs {
			if input.AssetClass == budget.AssetClass {
				classRequest.Stocks = append(classRequest.Stocks, input)
			}
		}
		classInputs[budget.AssetClass], err = json.Marshal(classRequest)
		if err != nil {
			return nil, err
		}
	}
	for _, result := range CalculateAllocations(request).Results {
		ticker := securityActionTicker(result.Ticker)
		ref := refs[ticker]
		ref.Ideal = result.AllocationDollar
		ref.Inputs = classInputs[ref.AssetClass]
		refs[ticker] = ref
	}
	for ticker, ref := range refs {
		if ref.Role == "STOCK" {
			ref.ResearchMissing = missing[ref.AssetClass] + unknownClassMissing
			if ref.ResearchMissing > 0 {
				// A partial denominator must not produce a displayed or actionable stock target.
				ref.Available = false
				ref.Ideal = 0
				if ref.Reason == "" || ref.Reason == "Research incomplete" {
					ref.Reason = fmt.Sprintf("Incomplete class research (%d). Review Analysis data issues.", ref.ResearchMissing)
				}
			}
		}
		if !routerOK && ref.Role == "STOCK" {
			ref.Available = false
			ref.Fresh = false
			ref.Reason = "Announcement evidence unavailable"
		}
		if ref.ClassBudget > 0 {
			ref.Percent = 100 * ref.Ideal / ref.ClassBudget
		}
		if ref.Ideal > 0 {
			ref.Coverage = ref.Held / ref.Ideal
		}
		destination := 1.25
		if ref.Role == "CORE_ETF" {
			destination = 1
		}
		if ref.Available {
			ref.Remaining = destination * ref.Ideal
			ref.Reduction = math.Max(0, ref.Held-ref.Remaining)
		}
		refs[ticker] = ref
	}
	return refs, nil
}

func weightRouterScores(reader actionQueryReader) (map[string]float64, bool) {
	// The modifier is optional when no integration is configured. A configured
	// integration failing is different: never silently drop its sizing effect.
	if strings.TrimSpace(os.Getenv("COUNCIL_API_TOKEN")) == "" {
		return nil, true
	}
	var raw, fetched string
	if err := reader.QueryRow(`SELECT scores_json, fetched_at FROM weight_router_cache WHERE id=1`).Scan(&raw, &fetched); err != nil {
		return nil, false
	}
	stamp, err := time.Parse(time.RFC3339, fetched)
	if err != nil || time.Since(stamp) > 15*time.Minute {
		return nil, false
	}
	var scores map[string]float64
	if json.Unmarshal([]byte(raw), &scores) != nil {
		return nil, false
	}
	return scores, true
}

func weightQualifies(ref weightReference) bool {
	threshold := 1.5
	if ref.Role == "CORE_ETF" {
		threshold = 1.25
	}
	return ref.Available && ref.Fresh && ref.ResearchMissing == 0 && ref.Role != "ETF" && finitePositive(ref.Ideal) &&
		ref.Coverage+1e-9 >= threshold && ref.Reduction+0.005 >= math.Max(100, ref.PortfolioValue*0.0025)
}

func weightTargetFrom(reader deploymentReader, ticker string, capacity deploymentClassCapacity) (float64, float64, error) {
	refs, err := weightReferencesFrom(reader, map[string]deploymentClassCapacity{capacity.AssetClass: capacity}, ticker)
	if err != nil {
		return 0, 0, err
	}
	ref, ok := refs[securityActionTicker(ticker)]
	if !ok || !ref.Available || !ref.Fresh {
		return 0, 0, nil
	}
	return ref.Ideal, math.Max(0, ref.Ideal-ref.Held), nil
}
