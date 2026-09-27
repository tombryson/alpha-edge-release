package main

import (
	"context"
	"math"
	"testing"
	"time"
)

func syntheticETFMomentumPoints(start time.Time, dailyStep float64) []etfMomentumPricePoint {
	points := make([]etfMomentumPricePoint, 0, etfMomentumMinimumHistoryBars)
	for index := 0; index < etfMomentumMinimumHistoryBars; index++ {
		points = append(points, etfMomentumPricePoint{
			Date:  start.AddDate(0, 0, index),
			Close: 100 + dailyStep*float64(index),
		})
	}
	return points
}

func pineWebhookNumber(value float64) float64 {
	return math.Round(value*100) / 100
}

func TestCalculatePineParityRowsPreservesLegacySelectionRules(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	inputs := make([]etfMomentumCalculationInput, 0, len(etfMomentumLegacyUniverse))
	for index, seed := range etfMomentumLegacyUniverse {
		inputs = append(inputs, etfMomentumCalculationInput{
			Member: etfMomentumUniverseMember{DisplayTicker: seed.DisplayTicker},
			Points: syntheticETFMomentumPoints(start, 0.1*float64(index+1)),
		})
	}

	results := calculatePineParityRows(inputs)
	if len(results) != len(etfMomentumLegacyUniverse) {
		t.Fatalf("result count = %d, want %d", len(results), len(etfMomentumLegacyUniverse))
	}

	var totalWeight float64
	positiveWeights := 0
	for _, result := range results {
		if result.Status != "READY" {
			t.Fatalf("%s status = %s, want READY (%s)", result.Member.DisplayTicker, result.Status, result.Diagnostic)
		}
		if result.Return80Pct == nil || result.Momentum240Pct == nil || result.Volatility240 == nil || result.Score == nil || result.Rank == nil || result.FinalWeightPct == nil {
			t.Fatalf("%s missing a completed parity metric", result.Member.DisplayTicker)
		}
		totalWeight += *result.FinalWeightPct
		if *result.FinalWeightPct > 0 {
			positiveWeights++
		}
	}
	if math.Abs(totalWeight-100) > 0.000001 {
		t.Fatalf("final weights sum to %.10f, want 100", totalWeight)
	}
	if positiveWeights < 10 {
		t.Fatalf("positive holdings = %d, want at least the legacy 10-holding floor", positiveWeights)
	}

	// The final seed has the steepest synthetic trend, so it should rank first.
	if got := *results[len(results)-1].Rank; got != 1 {
		t.Fatalf("%s rank = %d, want 1", results[len(results)-1].Member.DisplayTicker, got)
	}
	if got, want := *results[len(results)-1].Return80Pct, (460.0-340.0)/340.0*100; math.Abs(got-want) > 0.000001 {
		t.Fatalf("return_80 = %.10f, want %.10f", got, want)
	}
}

func TestPineParityRunPersistsUniverseAndMatchesTradingViewReference(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	ctx := context.Background()
	members, err := loadETFMomentumUniverseMembers(ctx)
	if err != nil {
		t.Fatalf("load ETF momentum universe: %v", err)
	}
	if len(members) != len(etfMomentumLegacyUniverse) {
		t.Fatalf("universe members = %d, want %d", len(members), len(etfMomentumLegacyUniverse))
	}
	for _, member := range members {
		if member.SecurityID == 0 {
			t.Fatalf("%s has no durable security identity", member.DisplayTicker)
		}
	}

	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	asOf := start.AddDate(0, 0, etfMomentumMinimumHistoryBars-1)
	for index, member := range members {
		for _, point := range syntheticETFMomentumPoints(start, 0.1*float64(index+1)) {
			if _, err := db.Exec(`
				INSERT INTO security_price_daily (
					ticker, exchange_prefix, yahoo_symbol, observed_date, close_price,
					adjusted_close_price, currency, source
				) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?)
			`, member.DisplayTicker, member.ExchangePrefix, member.ProviderSymbol,
				point.Date.Format("2006-01-02"), point.Close, point.Close, etfMomentumYahooSource); err != nil {
				t.Fatalf("seed %s %s: %v", member.DisplayTicker, point.Date.Format("2006-01-02"), err)
			}
		}
	}

	runID, err := runETFMomentumParity(ctx, asOf)
	if err != nil {
		t.Fatalf("run parity: %v", err)
	}
	run, err := loadETFMomentumRun(ctx, runID)
	if err != nil || run == nil {
		t.Fatalf("load parity run: %v", err)
	}
	if run.Status != "COMPLETE" || run.ReadyMembers != len(members) {
		t.Fatalf("run = %#v, want complete 15-member parity result", run)
	}

	// A shadow run must not manufacture a live target or allocation.
	var liveAllocationRows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM etf_allocations`).Scan(&liveAllocationRows); err != nil {
		t.Fatalf("count live ETF allocations: %v", err)
	}
	if liveAllocationRows != 0 {
		t.Fatalf("shadow parity run wrote %d live ETF allocation rows", liveAllocationRows)
	}

	result, err := db.Exec(`
		INSERT INTO etf_momentum_tradingview_snapshots (universe_code, as_of_date)
		VALUES (?, ?)
	`, etfMomentumLegacyUniverseCode, asOf.Format("2006-01-02"))
	if err != nil {
		t.Fatalf("create TradingView snapshot: %v", err)
	}
	snapshotID, _ := result.LastInsertId()
	for _, row := range run.Rows {
		if row.Rank == nil || row.Return80Pct == nil || row.FinalWeightPct == nil {
			t.Fatalf("completed row %s has incomplete values", row.Ticker)
		}
		if _, err := db.Exec(`
			INSERT INTO etf_momentum_tradingview_snapshot_rows (
				snapshot_id, ticker, return_80_pct, momentum_240_pct, decay_pct,
				sharpe_proxy, score, rank_value, allocation_pct
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, snapshotID, row.Ticker, pineWebhookNumber(*row.Return80Pct),
			pineWebhookNumber(*row.Momentum240Pct), pineWebhookNumber(*row.Decay*100),
			pineWebhookNumber(*row.SharpeProxy), pineWebhookNumber(*row.Score), *row.Rank,
			pineWebhookNumber(*row.FinalWeightPct)); err != nil {
			t.Fatalf("seed TradingView snapshot for %s: %v", row.Ticker, err)
		}
	}

	reference, err := latestETFMomentumTradingViewReference(ctx)
	if err != nil || reference == nil {
		t.Fatalf("load TradingView reference: %v", err)
	}
	if reference.ComparisonStatus != "MATCH" {
		t.Fatalf("comparison status = %q, want MATCH (%s)", reference.ComparisonStatus, reference.ComparisonSummary)
	}
	if len(reference.Rows) != len(members) {
		t.Fatalf("comparison rows = %d, want %d", len(reference.Rows), len(members))
	}
}

func TestCompareETFMomentumReferenceUsesAllocationDriftTolerance(t *testing.T) {
	intPtr := func(value int) *int { return &value }
	floatPtr := func(value float64) *float64 { return &value }
	tests := []struct {
		name               string
		allocationDeltaPct float64
		wantStatus         string
		wantAction         bool
	}{
		{name: "exact formula output matches", allocationDeltaPct: 0, wantStatus: "MATCH"},
		{name: "drift inside band is accepted", allocationDeltaPct: 1.77, wantStatus: "ACCEPTABLE_DRIFT"},
		{name: "drift at boundary is accepted", allocationDeltaPct: 2.0, wantStatus: "ACCEPTABLE_DRIFT"},
		{name: "positive breach requires action", allocationDeltaPct: 2.01, wantStatus: "ACTION_REQUIRED", wantAction: true},
		{name: "negative breach requires action", allocationDeltaPct: -2.01, wantStatus: "ACTION_REQUIRED", wantAction: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			reference := &ETFMomentumTradingViewReferenceResponse{
				Rows: []ETFMomentumTradingViewReferenceRowResponse{{
					Ticker:         "LSF",
					Return80Pct:    16.2,
					Momentum240Pct: 15.5,
					DecayPct:       62.5,
					SharpeProxy:    4.52,
					Score:          8.81,
					Rank:           1,
					AllocationPct:  17.9,
				}},
			}
			run := &ETFMomentumRunResponse{
				ID: 42,
				Rows: []ETFMomentumRunRowResponse{{
					Ticker:         "LSF",
					Return80Pct:    floatPtr(16.2),
					Momentum240Pct: floatPtr(15.5),
					Decay:          floatPtr(0.625),
					SharpeProxy:    floatPtr(4.52),
					Score:          floatPtr(8.81),
					Rank:           intPtr(1),
					FinalWeightPct: floatPtr(17.9 + test.allocationDeltaPct),
				}},
			}

			compareETFMomentumReference(reference, run)

			if reference.ComparisonStatus != test.wantStatus {
				t.Fatalf("reference status = %q, want %q", reference.ComparisonStatus, test.wantStatus)
			}
			if reference.Rows[0].ComparisonStatus != test.wantStatus {
				t.Fatalf("row status = %q, want %q", reference.Rows[0].ComparisonStatus, test.wantStatus)
			}
			if reference.Rows[0].ActionRequired != test.wantAction {
				t.Fatalf("action required = %t, want %t", reference.Rows[0].ActionRequired, test.wantAction)
			}
			wantCount := 0
			if test.wantAction {
				wantCount = 1
			}
			if reference.ActionRequiredCount != wantCount {
				t.Fatalf("action count = %d, want %d", reference.ActionRequiredCount, wantCount)
			}
		})
	}
}

func TestInternalMomentumAllocationUsesPublishedRunOnly(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	members, err := loadETFMomentumUniverseMembers(context.Background())
	if err != nil || len(members) == 0 {
		t.Fatalf("load ETF momentum universe: %v", err)
	}
	member := members[0]
	insertRun := func(asOf string, weight float64, published bool) int64 {
		publishedAt := interface{}(nil)
		if published {
			publishedAt = asOf + " 12:00:00"
		}
		result, insertErr := db.Exec(`
			INSERT INTO etf_momentum_runs (
				universe_code, algorithm_version, as_of_date, price_basis, provider,
				parameters_json, expected_members, ready_members, status,
				data_fresh_through, published_at, publication_reason
			) VALUES (?, ?, ?, 'RAW_CLOSE', ?, '{}', 15, 15, 'COMPLETE', ?, ?, ?)
		`, etfMomentumLegacyUniverseCode, etfMomentumPineParityV1, asOf,
			etfMomentumYahooSource, asOf, publishedAt, "TEST")
		if insertErr != nil {
			t.Fatalf("insert run: %v", insertErr)
		}
		runID, _ := result.LastInsertId()
		if _, insertErr = db.Exec(`
			INSERT INTO etf_momentum_run_rows (
				run_id, universe_member_id, security_id, display_ticker, display_name,
				tradingview_symbol, provider_symbol, final_weight_pct, status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'READY')
		`, runID, member.ID, member.SecurityID, member.DisplayTicker, member.DisplayName,
			member.TradingViewSymbol, member.ProviderSymbol, weight); insertErr != nil {
			t.Fatalf("insert run row: %v", insertErr)
		}
		return runID
	}

	publishedID := insertRun("2026-01-02", 25, true)
	newerUnpublishedID := insertRun("2026-01-03", 75, false)
	if newerUnpublishedID <= publishedID {
		t.Fatal("test setup did not create a newer run")
	}

	rows, err := loadETFAllocationRowsForSource("INTERNAL_PUBLISHED")
	if err != nil {
		t.Fatalf("load published allocation rows: %v", err)
	}
	if len(rows) != 1 || math.Abs(rows[0].AllocationPercent-25) > 0.000001 {
		t.Fatalf("allocation rows = %#v, want published 25%% weight", rows)
	}
}

func TestEightyTradingDayPublicationBoundary(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	members, err := loadETFMomentumUniverseMembers(context.Background())
	if err != nil || len(members) == 0 {
		t.Fatalf("load ETF momentum universe: %v", err)
	}
	member := members[0]
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for index := 1; index <= 80; index++ {
		date := start.AddDate(0, 0, index)
		if _, err := db.Exec(`
			INSERT INTO security_price_daily (
				ticker, exchange_prefix, yahoo_symbol, observed_date, close_price,
				adjusted_close_price, currency, source
			) VALUES (?, ?, ?, ?, 100, 100, 'USD', ?)
		`, member.DisplayTicker, member.ExchangePrefix, member.ProviderSymbol,
			date.Format("2006-01-02"), etfMomentumYahooSource); err != nil {
			t.Fatalf("seed trading session %d: %v", index, err)
		}
	}
	publishedDate := start.Format("2006-01-02")
	published := &ETFMomentumRunResponse{
		Status:           "COMPLETE",
		DataFreshThrough: &publishedDate,
	}

	date79 := start.AddDate(0, 0, 79).Format("2006-01-02")
	candidate79 := &ETFMomentumRunResponse{Status: "COMPLETE", DataFreshThrough: &date79}
	due, _, sessions, err := etfMomentumPublicationDue(
		context.Background(), etfMomentumCadenceEightyTradingDays, published, candidate79,
	)
	if err != nil || due || sessions != 79 {
		t.Fatalf("79-session decision = due:%t sessions:%d err:%v", due, sessions, err)
	}

	date80 := start.AddDate(0, 0, 80).Format("2006-01-02")
	candidate80 := &ETFMomentumRunResponse{Status: "COMPLETE", DataFreshThrough: &date80}
	due, reason, sessions, err := etfMomentumPublicationDue(
		context.Background(), etfMomentumCadenceEightyTradingDays, published, candidate80,
	)
	if err != nil || !due || sessions != 80 || reason != "EIGHTY_TRADING_DAY_CADENCE" {
		t.Fatalf("80-session decision = due:%t reason:%q sessions:%d err:%v", due, reason, sessions, err)
	}
}

func TestCurrentETFMomentumFreshnessUsesOldestUniverseMember(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	members, err := loadETFMomentumUniverseMembers(context.Background())
	if err != nil || len(members) == 0 {
		t.Fatalf("load ETF momentum universe: %v", err)
	}
	for index, member := range members {
		date := "2026-08-26"
		if index == len(members)-1 {
			date = "2026-08-25"
		}
		if _, err := db.Exec(`
			INSERT INTO security_price_daily (
				ticker, exchange_prefix, yahoo_symbol, observed_date, close_price,
				adjusted_close_price, currency, source
			) VALUES (?, ?, ?, ?, 100, 100, 'USD', ?)
		`, member.DisplayTicker, member.ExchangePrefix, member.ProviderSymbol,
			date, etfMomentumYahooSource); err != nil {
			t.Fatalf("seed freshness for %s: %v", member.DisplayTicker, err)
		}
	}

	freshThrough, err := currentETFMomentumDataFreshThrough(context.Background())
	if err != nil || freshThrough == nil || *freshThrough != "2026-08-25" {
		t.Fatalf("fresh through = %v, err = %v; want 2026-08-25", freshThrough, err)
	}
}

func TestETFMomentumAutomationRunsOncePerUTCDate(t *testing.T) {
	config := etfMomentumAutomationConfig{Enabled: true, DailyUTCHour: 10}
	now := time.Date(2026, 8, 27, 10, 30, 0, 0, time.UTC)
	if !etfMomentumAutomationDue(now, config, nil, nil) {
		t.Fatal("cycle should be due after the configured UTC hour")
	}
	tooRecent := now.Add(-time.Hour)
	if etfMomentumAutomationDue(now, config, &tooRecent, nil) {
		t.Fatal("cycle should back off after a recent attempt")
	}
	success := now.Add(-10 * time.Minute)
	if etfMomentumAutomationDue(now, config, nil, &success) {
		t.Fatal("cycle should not run twice on the same UTC date")
	}
}
