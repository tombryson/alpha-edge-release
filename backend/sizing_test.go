package main

import (
	"math"
	"testing"
)

func TestSizingAvgPT(t *testing.T) {
	s := SizingStockInput{GeminiPT: 4.0, GptPT: 6.0}
	got := sizingAvgPT(s)
	if got != 5.0 {
		t.Fatalf("avgPT: want 5.0, got %v", got)
	}
}

func TestSizingAvgPTIgnoresZeroAndNegative(t *testing.T) {
	s := SizingStockInput{GeminiPT: 0, GptPT: -1, CouncilPT: 10.0}
	got := sizingAvgPT(s)
	if got != 10.0 {
		t.Fatalf("avgPT should ignore zero/negative, want 10.0, got %v", got)
	}
}

func TestSizingAvgPTIgnoresLegacyGrokPT(t *testing.T) {
	s := SizingStockInput{GrokPT: 99.0, GeminiPT: 1.0, GptPT: 3.0}
	got := sizingAvgPT(s)
	if got != 2.0 {
		t.Fatalf("avgPT should ignore legacy Grok PT, want 2.0, got %v", got)
	}
}

func TestSizingAvgPTNoPTs(t *testing.T) {
	s := SizingStockInput{}
	if sizingAvgPT(s) != 0 {
		t.Fatal("no PTs should return 0")
	}
}

func TestSizingUpsidePct(t *testing.T) {
	s := SizingStockInput{GeminiPT: 1.10, CurrentPrice: 1.00}
	got := sizingUpsidePct(s)
	if math.Abs(got-10.0) > 0.001 {
		t.Fatalf("upside: want 10.0, got %v", got)
	}
}

func TestSizingUpsidePctNoPrice(t *testing.T) {
	s := SizingStockInput{GeminiPT: 5.0, CurrentPrice: 0}
	if sizingUpsidePct(s) != 0 {
		t.Fatal("zero price should return 0 upside")
	}
}

func TestSizingBaseRatingIgnoresCouncilComposite(t *testing.T) {
	s := SizingStockInput{CouncilQuality: 8, CouncilValue: 8, CouncilPT: 10}
	got := sizingBaseRating(s)
	if got != 0 {
		t.Fatalf("base rating should ignore council-only composite, got %v", got)
	}
}

func TestSizingBaseRatingMixedProviders(t *testing.T) {
	// completed: gemini=(6+4)/2=5, gpt=(8+8)/2=8. Perplexity lacks PT.
	// Council is displayed separately and does not enter the model-run mean.
	s := SizingStockInput{
		GeminiQuality: 6, GeminiValue: 4, GeminiPT: 1.2,
		GptQuality: 8, GptValue: 8, GptPT: 2.0,
		PerplexityQuality: 10, PerplexityValue: 10,
		CouncilQuality: 10, CouncilValue: 10,
	}
	got := sizingBaseRating(s)
	want := 6.5
	if math.Abs(got-want) > 0.001 {
		t.Fatalf("base rating: want %v, got %v", want, got)
	}
}

func TestSizingBaseRatingNoScores(t *testing.T) {
	s := SizingStockInput{}
	if sizingBaseRating(s) != 0 {
		t.Fatal("no scores should return 0")
	}
}

func TestSizingPerformanceScore(t *testing.T) {
	cases := []struct {
		pct  float64
		want float64
	}{
		{0, 2.5},    // midpoint
		{40, 5.0},   // cap positive
		{-40, 0.0},  // cap negative
		{20, 3.75},  // halfway positive
		{-20, 1.25}, // halfway negative
	}
	for _, tc := range cases {
		p := tc.pct
		got := sizingPerformanceScore(&p)
		if got == nil || math.Abs(*got-tc.want) > 0.001 {
			t.Errorf("perf(%v): want %v, got %v", tc.pct, tc.want, got)
		}
	}
}

func TestSizingPerformanceScoreNil(t *testing.T) {
	if sizingPerformanceScore(nil) != nil {
		t.Fatal("nil input should return nil")
	}
}

func TestSizingCompositeRequiresCompletedModelScore(t *testing.T) {
	performance := 20.0
	composite, performanceScore := sizingCompositeScore(SizingStockInput{
		Performance6MPct: &performance,
	})
	if composite != 0 {
		t.Fatalf("momentum-only stock should have no composite score, got %v", composite)
	}
	if performanceScore == nil || math.Abs(*performanceScore-3.75) > 0.001 {
		t.Fatalf("performance modifier should remain observable, got %v", performanceScore)
	}

	resp := CalculateAllocations(SizingRequest{
		Stocks: []SizingStockInput{{
			ID:               1,
			Ticker:           "ASX:AAA",
			Performance6MPct: &performance,
		}},
		TotalPortfolioValue: 100000,
	})
	if resp.Results[0].AllocationPct != 0 {
		t.Fatalf("momentum-only stock should receive no allocation, got %v%%", resp.Results[0].AllocationPct)
	}
	if resp.Results[0].EligibleForTargetWeight {
		t.Fatal("momentum-only stock should not be eligible for a target weight")
	}

	apiTargetOnly := CalculateAllocations(SizingRequest{
		Stocks: []SizingStockInput{{
			ID:           2,
			Ticker:       "ASX:API",
			AnalystPT:    15,
			CurrentPrice: 10,
		}},
		TotalPortfolioValue: 100000,
	})
	if apiTargetOnly.Results[0].UpsidePct != 50 {
		t.Fatalf("API target should still expose upside, got %v%%", apiTargetOnly.Results[0].UpsidePct)
	}
	if apiTargetOnly.Results[0].AllocationPct != 0 || apiTargetOnly.Results[0].EligibleForTargetWeight {
		t.Fatal("API target without a completed model run must not receive a target weight")
	}
}

func TestSizingRouterMultiplier(t *testing.T) {
	cases := []struct {
		score *float64
		want  float64
	}{
		{nil, 1.0},
		{ptr(0.0), 1.0},
		{ptr(5.0), 1.15},
		{ptr(-5.0), 0.85},
		{ptr(10.0), 1.15}, // clamped at 5
		{ptr(-10.0), 0.85},
		{ptr(3.0), 1.09},
	}
	for _, tc := range cases {
		got := sizingRouterMultiplier(tc.score)
		if math.Abs(got-tc.want) > 0.001 {
			t.Errorf("routerMult(%v): want %v, got %v", tc.score, tc.want, got)
		}
	}
}

func TestCalculateAllocationsBasic(t *testing.T) {
	// Two stocks with equal scores and equal upside — should split 50/50.
	s1 := SizingStockInput{ID: 1, Ticker: "ASX:AAA", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.10, CurrentPrice: 1.0}
	s2 := SizingStockInput{ID: 2, Ticker: "ASX:BBB", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.10, CurrentPrice: 1.0}
	req := SizingRequest{
		Stocks:              []SizingStockInput{s1, s2},
		TotalPortfolioValue: 100000,
	}
	resp := CalculateAllocations(req)
	if len(resp.Results) != 2 {
		t.Fatalf("want 2 results, got %d", len(resp.Results))
	}
	for _, r := range resp.Results {
		if math.Abs(r.AllocationPct-50.0) > 0.001 {
			t.Errorf("equal stocks should split 50/50, got %v%%", r.AllocationPct)
		}
	}
}

func TestCalculateAllocationsUpsideFloor(t *testing.T) {
	cases := []struct {
		name string
		pt   float64
		want float64
	}{
		{"minus_99_percent", 1, 0},
		{"minus_60_percent", 40, 0},
		{"below_boundary", 79.99, 0},
		{"at_boundary", 80, 0},
		{"above_boundary", 80.01, 0.0016},
		{"minus_10_percent", 90, 1600},
		{"zero_upside", 100, 6400},
		{"plus_20_percent", 120, 25600},
		{"plus_100_percent", 200, 230400},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := CalculateAllocations(SizingRequest{
				Stocks: []SizingStockInput{{
					ID: 1, GeminiQuality: 80, GeminiValue: 80,
					GeminiPT: tc.pt, CurrentPrice: 100,
				}},
				TotalPortfolioValue: 100000,
			})
			got := resp.Results[0]
			if math.IsNaN(got.RawWeight) || math.Abs(got.RawWeight-tc.want) > 1e-8 {
				t.Fatalf("raw weight = %v, want %v", got.RawWeight, tc.want)
			}
			if tc.want == 0 && (got.AllocationPct != 0 || got.AllocationDollar != 0) {
				t.Fatalf("zero-weight stock received an allocation: %+v", got)
			}
		})
	}
}

func TestCalculateAllocationsDownsideCannotRegainWeightThroughRouter(t *testing.T) {
	resp := CalculateAllocations(SizingRequest{
		Stocks: []SizingStockInput{
			{ID: 1, Ticker: "ASX:BASE", AssetClass: "GOLD_MINERS", GeminiQuality: 80, GeminiValue: 80, GeminiPT: 100, CurrentPrice: 100},
			{ID: 2, Ticker: "ASX:DOWN", AssetClass: "GOLD_MINERS", GeminiQuality: 80, GeminiValue: 80, GeminiPT: 40, CurrentPrice: 100},
		},
		ClassBudgets: []ClassBudget{{AssetClass: "GOLD_MINERS", StockBudget: 10000}},
		RouterScores: map[string]float64{"ASX:BASE": -5, "ASX:DOWN": 5},
	})
	if got := resp.Results[0]; got.AllocationPct != 100 || got.AllocationDollar != 10000 {
		t.Fatalf("remaining positive-weight stock should receive the class budget: %+v", got)
	}
	if got := resp.Results[1]; got.RawWeight != 0 || got.EffectiveWeight != 0 || got.AllocationPct != 0 || got.AllocationDollar != 0 {
		t.Fatalf("negative upside must not regain allocation through the router: %+v", got)
	}
}

func TestCalculateAllocationsAllDownsideClassLeavesBudgetUnallocated(t *testing.T) {
	resp := CalculateAllocations(SizingRequest{
		Stocks: []SizingStockInput{
			{ID: 1, AssetClass: "GOLD_MINERS", GeminiQuality: 80, GeminiValue: 80, GeminiPT: 40, CurrentPrice: 100},
			{ID: 2, AssetClass: "GOLD_MINERS", GeminiQuality: 80, GeminiValue: 80, GeminiPT: 80, CurrentPrice: 100},
			{ID: 3, AssetClass: "PHARMA_BIOTECH", GeminiQuality: 80, GeminiValue: 80, GeminiPT: 100, CurrentPrice: 100},
		},
		ClassBudgets: []ClassBudget{
			{AssetClass: "GOLD_MINERS", StockBudget: 10000},
			{AssetClass: "PHARMA_BIOTECH", StockBudget: 5000},
		},
	})
	for _, got := range resp.Results[:2] {
		if got.AllocationPct != 0 || got.AllocationDollar != 0 {
			t.Fatalf("zero-weight class must remain unallocated: %+v", got)
		}
	}
	if got := resp.Results[2]; got.AllocationPct != 100 || got.AllocationDollar != 5000 {
		t.Fatalf("another class must not absorb the unallocated budget: %+v", got)
	}
}

func TestCalculateAllocationsRouterModifier(t *testing.T) {
	// Two equal stocks; one gets router score +5 → its effective weight is 15% higher.
	s1 := SizingStockInput{ID: 1, Ticker: "ASX:AAA", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.10, CurrentPrice: 1.0}
	s2 := SizingStockInput{ID: 2, Ticker: "ASX:BBB", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.10, CurrentPrice: 1.0}

	score := 5.0
	req := SizingRequest{
		Stocks:              []SizingStockInput{s1, s2},
		TotalPortfolioValue: 100000,
		RouterScores:        map[string]float64{"ASX:AAA": score},
	}
	resp := CalculateAllocations(req)

	// s1 weight = base * 1.15, s2 weight = base * 1.0
	// s1 pct = 1.15 / 2.15 * 100 ≈ 53.49
	want1 := 1.15 / 2.15 * 100
	want2 := 1.0 / 2.15 * 100
	r1 := resp.Results[0]
	r2 := resp.Results[1]
	if math.Abs(r1.AllocationPct-want1) > 0.01 {
		t.Errorf("s1 alloc: want %.4f, got %.4f", want1, r1.AllocationPct)
	}
	if math.Abs(r2.AllocationPct-want2) > 0.01 {
		t.Errorf("s2 alloc: want %.4f, got %.4f", want2, r2.AllocationPct)
	}
	if !resp.RouterScoresApplied {
		t.Error("RouterScoresApplied should be true")
	}
}

func TestCalculateAllocationsNoRouterScores(t *testing.T) {
	s := SizingStockInput{ID: 1, Ticker: "ASX:AAA", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 2.0, CurrentPrice: 1.0}
	req := SizingRequest{Stocks: []SizingStockInput{s}, TotalPortfolioValue: 50000}
	resp := CalculateAllocations(req)
	if resp.RouterScoresApplied {
		t.Error("RouterScoresApplied should be false when no scores provided")
	}
	if len(resp.Results) != 1 || math.Abs(resp.Results[0].AllocationPct-100.0) > 0.001 {
		t.Error("single stock should be 100%")
	}
}

func TestCalculateAllocationsZeroScores(t *testing.T) {
	// All zero scores → all weights 0 → all allocations 0 (no divide by zero).
	s := SizingStockInput{ID: 1, Ticker: "ASX:AAA"}
	req := SizingRequest{Stocks: []SizingStockInput{s}, TotalPortfolioValue: 100000}
	resp := CalculateAllocations(req)
	if resp.Results[0].AllocationPct != 0 {
		t.Error("zero scores should produce 0 allocation, not panic")
	}
}

func TestCalculateAllocationsEmptyStocks(t *testing.T) {
	req := SizingRequest{TotalPortfolioValue: 100000}
	resp := CalculateAllocations(req)
	if len(resp.Results) != 0 {
		t.Error("empty stocks should return empty results")
	}
}

func TestCalculateAllocationsDollarAmounts(t *testing.T) {
	s := SizingStockInput{ID: 1, Ticker: "ASX:AAA", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.5, CurrentPrice: 1.0}
	req := SizingRequest{Stocks: []SizingStockInput{s}, TotalPortfolioValue: 200000}
	resp := CalculateAllocations(req)
	r := resp.Results[0]
	if math.Abs(r.AllocationPct-100.0) > 0.001 {
		t.Errorf("single stock should be 100%%, got %v", r.AllocationPct)
	}
	if math.Abs(r.AllocationDollar-200000) > 0.01 {
		t.Errorf("dollar amount should equal portfolio value, got %v", r.AllocationDollar)
	}
}

func TestCalculateAllocationsPerClass(t *testing.T) {
	// Two gold miners + one pharma. Within each class the pair should split
	// 50/50; the two classes must not compete against each other.
	g1 := SizingStockInput{ID: 1, Ticker: "ASX:G1", AssetClass: "GOLD_MINERS", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.10, CurrentPrice: 1.0}
	g2 := SizingStockInput{ID: 2, Ticker: "ASX:G2", AssetClass: "GOLD_MINERS", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.10, CurrentPrice: 1.0}
	p1 := SizingStockInput{ID: 3, Ticker: "ASX:P1", AssetClass: "PHARMA_BIOTECH", GeminiQuality: 7, GeminiValue: 7, GeminiPT: 2.00, CurrentPrice: 1.0}
	req := SizingRequest{
		Stocks:              []SizingStockInput{g1, g2, p1},
		TotalPortfolioValue: 100000,
	}
	resp := CalculateAllocations(req)
	if len(resp.Results) != 3 {
		t.Fatalf("want 3 results, got %d", len(resp.Results))
	}
	byTicker := map[string]SizingResult{}
	for _, r := range resp.Results {
		byTicker[r.Ticker] = r
	}
	// Gold miners split 50/50 within their class.
	if math.Abs(byTicker["ASX:G1"].AllocationPct-50.0) > 0.001 {
		t.Errorf("G1 should be 50%% within class, got %.4f", byTicker["ASX:G1"].AllocationPct)
	}
	if math.Abs(byTicker["ASX:G2"].AllocationPct-50.0) > 0.001 {
		t.Errorf("G2 should be 50%% within class, got %.4f", byTicker["ASX:G2"].AllocationPct)
	}
	// Pharma is the only stock in its class → 100%.
	if math.Abs(byTicker["ASX:P1"].AllocationPct-100.0) > 0.001 {
		t.Errorf("P1 should be 100%% within its class, got %.4f", byTicker["ASX:P1"].AllocationPct)
	}
}

func TestCalculateAllocationsClassBudgets(t *testing.T) {
	// One gold miner with a $10,000 class stock budget → dollar = $10,000.
	g1 := SizingStockInput{ID: 1, Ticker: "ASX:G1", AssetClass: "GOLD_MINERS", GeminiQuality: 5, GeminiValue: 5, GeminiPT: 1.10, CurrentPrice: 1.0}
	req := SizingRequest{
		Stocks:              []SizingStockInput{g1},
		TotalPortfolioValue: 100000,
		ClassBudgets:        []ClassBudget{{AssetClass: "GOLD_MINERS", StockBudget: 10000}},
	}
	resp := CalculateAllocations(req)
	if !resp.ClassBudgetsApplied {
		t.Error("ClassBudgetsApplied should be true")
	}
	r := resp.Results[0]
	if math.Abs(r.AllocationPct-100.0) > 0.001 {
		t.Errorf("single stock should be 100%% within class, got %.4f", r.AllocationPct)
	}
	if math.Abs(r.AllocationDollar-10000) > 0.01 {
		t.Errorf("dollar should equal class stock budget $10000, got %.2f", r.AllocationDollar)
	}
}

// ptr is a helper to get a pointer to a float64 literal.
func ptr(v float64) *float64 { return &v }
