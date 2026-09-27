package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
)

// ---------------------------------------------------------------------------
// Sizing engine — per-asset-class Target Weight calculation.
//
// Formula summary (per class):
//   avgPT            = mean of all positive PT inputs
//   upsidePct        = (avgPT - price) / price * 100          (0 if no PT or price)
//   baseRating       = mean of completed model scores (Q, V, and PT present)
//   performanceScore = 2.5 + clamp(perf6M, -40, 40) / 40 * 2.5
//   composite        = baseRating + performanceScore           (baseRating if no perf)
//   upsideMultiplier = max(0, 1 + upsidePct/20)
//   weight           = (composite * upsideMultiplier)²
//   routerMult       = 1 + clamp(routerScore, -5, 5) * 0.03   (±15% at ±5)
//   effectiveWeight  = weight * routerMult
//   target_weight_pct = effectiveWeight / sum(class_effective_weights) * 100
//
// Anchored dollar allocation cascade (when ClassBudgets provided):
//   class_stock_budget = max(class_budget - max(effective_ETF_target, held_ETFs), 0)
//   allocation_dollar  = class_stock_budget * (target_weight_pct / 100)
// These are live research suggestions, never approved security targets.
// ---------------------------------------------------------------------------

// SizingStockInput is one stock's inputs to the sizing calculation.
type SizingStockInput struct {
	ID     int    `json:"id"`
	Ticker string `json:"ticker"`
	// AssetClass is the canonical asset class code (e.g. "GOLD_MINERS").
	// When provided, allocation percentages are computed within each class
	// independently. Stocks without an asset class are grouped together.
	AssetClass        string   `json:"asset_class,omitempty"`
	GeminiQuality     float64  `json:"gemini_quality"`
	GeminiValue       float64  `json:"gemini_value"`
	GptQuality        float64  `json:"gpt_quality"`
	GptValue          float64  `json:"gpt_value"`
	PerplexityQuality float64  `json:"perplexity_quality"`
	PerplexityValue   float64  `json:"perplexity_value"`
	ClaudeQuality     float64  `json:"claude_quality"`
	ClaudeValue       float64  `json:"claude_value"`
	CouncilQuality    float64  `json:"council_quality"`
	CouncilValue      float64  `json:"council_value"`
	GrokPT            float64  `json:"grok_pt"`
	GeminiPT          float64  `json:"gemini_pt"`
	GptPT             float64  `json:"gpt_pt"`
	DeerFlowPT        float64  `json:"deer_flow_pt"`
	PerplexityPT      float64  `json:"perplexity_pt"`
	ClaudePT          float64  `json:"claude_pt"`
	CouncilPT         float64  `json:"council_pt"`
	TipRanksPT        float64  `json:"tipranks_pt"`
	AnalystPT         float64  `json:"analyst_pt"`
	CurrentPrice      float64  `json:"current_price"`
	Performance6MPct  *float64 `json:"performance_6m_pct"`
}

// ClassBudget carries the advisory stock budget after the approved shape and
// ETF implementation. Purchase-time risk and cash checks remain separate.
type ClassBudget struct {
	// AssetClass is the canonical asset class code.
	AssetClass string `json:"asset_class"`
	// ClassBudget requests anchored advice. The HTTP handler replaces its value
	// with the approved class target and resolves occupied ETF capacity.
	ClassBudget float64 `json:"class_budget,omitempty"`
	// StockBudget is the dollar amount available for individual stock allocation
	// in this class. It remains accepted for compatibility with non-HTTP tests
	// and older clients, but current clients should send ClassBudget.
	StockBudget float64 `json:"stock_budget"`
}

// SizingRequest is the POST body for /api/sizing/allocations.
type SizingRequest struct {
	Stocks              []SizingStockInput `json:"stocks"`
	TotalPortfolioValue float64            `json:"total_portfolio_value"`
	// ClassBudgets requests anchored advice from the approved shape and ETF split.
	// Q3/Q4 and cash permission are evaluated separately when projecting purchases.
	// When omitted, allocation_dollar falls back to universe-level percentage
	// of TotalPortfolioValue (legacy behaviour).
	ClassBudgets []ClassBudget `json:"class_budgets,omitempty"`
	// RouterScores maps ticker (e.g. "ASX:VMM") to the latest cumulative
	// announcement-router validated score from llm-council.
	// Optional — omit or send null to compute allocations without router modifier.
	RouterScores      map[string]float64 `json:"router_scores,omitempty"`
	classBudgetSource string
}

// SizingResult is the allocation output for one stock.
type SizingResult struct {
	ID         int     `json:"id"`
	Ticker     string  `json:"ticker"`
	AssetClass string  `json:"asset_class,omitempty"`
	BaseRating float64 `json:"base_rating"`
	// EligibleForTargetWeight distinguishes a researched model total from a
	// price target, momentum, Council, or router signal alone.
	EligibleForTargetWeight bool     `json:"eligible_for_target_weight"`
	PerformanceScore        *float64 `json:"performance_score,omitempty"`
	CompositeScore          float64  `json:"composite_score"`
	AvgPT                   float64  `json:"avg_pt"`
	UpsidePct               float64  `json:"upside_pct"`
	RouterScore             *float64 `json:"router_score,omitempty"`
	RouterMultiplier        float64  `json:"router_multiplier"`
	RawWeight               float64  `json:"raw_weight"`
	EffectiveWeight         float64  `json:"effective_weight"`
	// AllocationPct is the stock's share within its asset class (0–100).
	AllocationPct float64 `json:"allocation_pct"`
	// AllocationDollar is the anchored dollar amount when ClassBudgets were
	// provided; otherwise it is AllocationPct % of TotalPortfolioValue.
	AllocationDollar float64 `json:"allocation_dollar"`
}

// SizingResponse is the full response from /api/sizing/allocations.
type SizingResponse struct {
	Results             []SizingResult `json:"results"`
	TotalPortfolioValue float64        `json:"total_portfolio_value"`
	RouterScoresApplied bool           `json:"router_scores_applied"`
	// ClassBudgetsApplied is true when per-class budgets were used for dollar amounts.
	ClassBudgetsApplied bool   `json:"class_budgets_applied"`
	ClassBudgetSource   string `json:"class_budget_source"`
	AdvisoryOnly        bool   `json:"advisory_only"`
}

func resolveAuthoritativeSizingBudgets(ctx context.Context, req *SizingRequest) error {
	hasClassTargets := false
	for _, budget := range req.ClassBudgets {
		if budget.ClassBudget > 0 {
			hasClassTargets = true
			break
		}
	}
	if !hasClassTargets {
		req.classBudgetSource = "CLIENT_STOCK_BUDGET"
		return nil
	}

	ledger, err := buildETFAllocationLedger(ctx)
	if err != nil {
		return err
	}
	classes := make(map[string]ETFAllocationClassSummary, len(ledger.Classes))
	for _, class := range ledger.Classes {
		classes[class.AssetClass] = class
	}
	for i := range req.ClassBudgets {
		budget := &req.ClassBudgets[i]
		budget.AssetClass = normalizePrimaryAssetClass(budget.AssetClass)
		class := classes[budget.AssetClass]
		budget.ClassBudget = class.ClassTargetValue
		budget.StockBudget = class.StockCapacityValue
	}
	req.TotalPortfolioValue = ledger.Summary.PortfolioValue
	req.classBudgetSource = "APPROVED_CLASS_MINUS_ETF_TARGET_OR_HELD"
	return nil
}

// clamp returns v clamped to [lo, hi].
func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

// sizingProviderScore mirrors the frontend providerScore helper.
func sizingProviderScore(quality, value float64) float64 {
	return (quality + value) / 2
}

func sizingCompletedProviderScore(quality, value, priceTarget float64) (float64, bool) {
	if quality <= 0 || value <= 0 || priceTarget <= 0 {
		return 0, false
	}
	return sizingProviderScore(quality, value), true
}

// sizingAvgPT returns the mean of all positive PT inputs, 0 if none.
func sizingAvgPT(s SizingStockInput) float64 {
	pts := []float64{
		s.GeminiPT, s.GptPT, s.DeerFlowPT,
		s.PerplexityPT, s.ClaudePT, s.CouncilPT, s.TipRanksPT, s.AnalystPT,
	}
	sum, n := 0.0, 0
	for _, pt := range pts {
		if pt > 0 {
			sum += pt
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

// sizingUpsidePct returns (avgPT - price) / price * 100, 0 if no PT or price.
func sizingUpsidePct(s SizingStockInput) float64 {
	avg := sizingAvgPT(s)
	if avg > 0 && s.CurrentPrice > 0 {
		return ((avg - s.CurrentPrice) / s.CurrentPrice) * 100
	}
	return 0
}

// sizingBaseRating returns the mean completed model score.
func sizingBaseRating(s SizingStockInput) float64 {
	candidates := []struct {
		quality float64
		value   float64
		pt      float64
	}{
		{s.GeminiQuality, s.GeminiValue, s.GeminiPT},
		{s.PerplexityQuality, s.PerplexityValue, s.PerplexityPT},
		{s.GptQuality, s.GptValue, s.GptPT},
		{s.ClaudeQuality, s.ClaudeValue, s.ClaudePT},
	}
	sum, n := 0.0, 0
	for _, candidate := range candidates {
		if sc, ok := sizingCompletedProviderScore(candidate.quality, candidate.value, candidate.pt); ok {
			sum += sc
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

// sizingPerformanceScore converts 6M price performance to a 0–5 additive score.
func sizingPerformanceScore(pct *float64) *float64 {
	if pct == nil {
		return nil
	}
	clamped := clamp(*pct, -40, 40)
	score := 2.5 + (clamped/40)*2.5
	return &score
}

// sizingCompositeScore returns (composite, performanceScore).
func sizingCompositeScore(s SizingStockInput) (float64, *float64) {
	base := sizingBaseRating(s)
	perf := sizingPerformanceScore(s.Performance6MPct)
	// Performance is a modifier to a completed model score, never a score by itself.
	if base <= 0 {
		return 0, perf
	}
	if perf == nil {
		return base, nil
	}
	return base + *perf, perf
}

// sizingRouterMultiplier returns the weight multiplier for a router score.
func sizingRouterMultiplier(routerScore *float64) float64 {
	if routerScore == nil {
		return 1.0
	}
	return 1.0 + clamp(*routerScore, -5, 5)*0.03
}

// CalculateAllocations is the pure sizing function.
// It is exported for testing and can be called without an HTTP context.
//
// When stocks include AssetClass values, allocation percentages are computed
// within each class independently (per-class normalisation). When ClassBudgets
// are also provided, allocation_dollar is anchored to real capital; otherwise
// it falls back to percentage of TotalPortfolioValue.
func CalculateAllocations(req SizingRequest) SizingResponse {
	type intermediate struct {
		input           SizingStockInput
		baseRating      float64
		perfScore       *float64
		composite       float64
		avgPT           float64
		upsidePct       float64
		routerScore     *float64
		routerMult      float64
		rawWeight       float64
		effectiveWeight float64
	}

	// Build class budget lookup.
	classBudgetMap := make(map[string]float64, len(req.ClassBudgets))
	for _, cb := range req.ClassBudgets {
		classBudgetMap[cb.AssetClass] = cb.StockBudget
	}
	classBudgetsApplied := len(req.ClassBudgets) > 0
	routerApplied := len(req.RouterScores) > 0

	// Compute per-stock intermediates.
	items := make([]intermediate, 0, len(req.Stocks))
	for _, s := range req.Stocks {
		composite, perfScore := sizingCompositeScore(s)
		avg := sizingAvgPT(s)
		upside := sizingUpsidePct(s)
		// Floor before squaring so worsening downside cannot regain weight.
		upsideMultiplier := math.Max(0, 1+upside/20)
		rawWeight := math.Pow(composite*upsideMultiplier, 2)

		var routerScore *float64
		if rs, ok := req.RouterScores[s.Ticker]; ok {
			routerScore = &rs
		}
		routerMult := sizingRouterMultiplier(routerScore)

		items = append(items, intermediate{
			input:           s,
			baseRating:      sizingBaseRating(s),
			perfScore:       perfScore,
			composite:       composite,
			avgPT:           avg,
			upsidePct:       upside,
			routerScore:     routerScore,
			routerMult:      routerMult,
			rawWeight:       rawWeight,
			effectiveWeight: rawWeight * routerMult,
		})
	}

	// Sum effective weights per asset class for normalisation.
	// Stocks with no AssetClass are placed in a synthetic "_UNCLASSIFIED" group
	// so they still get relative weights among themselves.
	classTotals := make(map[string]float64)
	for _, item := range items {
		key := item.input.AssetClass
		if key == "" {
			key = "_UNCLASSIFIED"
		}
		classTotals[key] += item.effectiveWeight
	}

	// Build results.
	results := make([]SizingResult, 0, len(items))
	for _, item := range items {
		classKey := item.input.AssetClass
		if classKey == "" {
			classKey = "_UNCLASSIFIED"
		}

		allocPct := 0.0
		if classTotals[classKey] > 0 {
			allocPct = (item.effectiveWeight / classTotals[classKey]) * 100
		}

		// Dollar amount: anchored to class budget when available, otherwise
		// fall back to universe-level percentage of total portfolio value.
		allocDollar := 0.0
		if classBudgetsApplied {
			if budget, ok := classBudgetMap[item.input.AssetClass]; ok {
				allocDollar = (allocPct / 100) * budget
			}
			// If no budget provided for this class, allocDollar stays 0
			// (signals to frontend that cash has not been assigned to this class yet).
		} else {
			allocDollar = (allocPct / 100) * req.TotalPortfolioValue
		}

		results = append(results, SizingResult{
			ID:                      item.input.ID,
			Ticker:                  item.input.Ticker,
			AssetClass:              item.input.AssetClass,
			BaseRating:              item.baseRating,
			EligibleForTargetWeight: item.baseRating > 0,
			PerformanceScore:        item.perfScore,
			CompositeScore:          item.composite,
			AvgPT:                   item.avgPT,
			UpsidePct:               item.upsidePct,
			RouterScore:             item.routerScore,
			RouterMultiplier:        item.routerMult,
			RawWeight:               item.rawWeight,
			EffectiveWeight:         item.effectiveWeight,
			AllocationPct:           allocPct,
			AllocationDollar:        allocDollar,
		})
	}

	return SizingResponse{
		AdvisoryOnly:        true,
		Results:             results,
		TotalPortfolioValue: req.TotalPortfolioValue,
		RouterScoresApplied: routerApplied,
		ClassBudgetsApplied: classBudgetsApplied,
		ClassBudgetSource:   req.classBudgetSource,
	}
}

// sizingAllocationsHandler handles POST /api/sizing/allocations.
func sizingAllocationsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SizingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := resolveAuthoritativeSizingBudgets(r.Context(), &req); err != nil {
		http.Error(w, "failed to resolve ETF-adjusted class budgets", http.StatusInternalServerError)
		return
	}

	resp := CalculateAllocations(req)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}
