package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

func seedWatchlistCandidate(t *testing.T, ticker string) {
	t.Helper()
	seedDeploymentTicketSecurity(t, ticker, 50, 0)
	actionUnitsExec(t, `UPDATE holdings SET quantity=0 WHERE ticker=?`, securityActionTicker(ticker))
	actionUnitsExec(t, `UPDATE stock_analysis SET is_watchlist=1,gemini_quality=70,gemini_value=70,gemini_pt=10,current_price=5 WHERE ticker=?`, ticker)
}

func watchlistItem(t *testing.T, ticker string) watchlistOpportunity {
	t.Helper()
	items, err := watchlistOpportunities(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Ticker == ticker {
			return item
		}
	}
	t.Fatalf("missing %s: %+v", ticker, items)
	return watchlistOpportunity{}
}

func TestWatchlistPreviewIsReadOnlyAndDoesNotDiluteHoldings(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	seedWatchlistCandidate(t, "ASX:OTHER")
	var changesBefore, changesAfter int
	db.QueryRow(`SELECT total_changes()`).Scan(&changesBefore)
	item := watchlistItem(t, "ASX:WATCH")
	other := watchlistItem(t, "ASX:OTHER")
	if item.State != "READY" || item.Entry != 100 || other.Entry != 100 {
		t.Fatalf("alternative entries: %+v %+v", item, other)
	}
	if item.IdealPct == nil || len(item.Peers) != 2 || *item.IdealPct < 33 || *item.IdealPct > 34 {
		t.Fatalf("prospective weights: %+v", item)
	}
	assertBudgetValue(t, "unchanged peer weight", item.Peers[0].Before, 50)
	assertBudgetValue(t, "class after", item.ClassAfter, 18)
	db.QueryRow(`SELECT total_changes()`).Scan(&changesAfter)
	if changesAfter != changesBefore {
		t.Fatalf("preview wrote to database: %d -> %d", changesBefore, changesAfter)
	}
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	refs, err := weightReferencesFrom(db, capacities, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := refs["WATCH"]; ok {
		t.Fatal("preview promoted candidate to held universe")
	}
	assertBudgetValue(t, "held allocation intact", refs["AEVT"].Ideal, 1000)
}

func TestWatchlistEligibilityGates(t *testing.T) {
	for _, tc := range []struct{ name, sql, state string }{
		{"eligible", "SELECT 1", "READY"},
		{"research missing", `UPDATE stock_analysis SET gemini_pt=0 WHERE ticker='ASX:WATCH'`, "RESEARCH"},
		{"held peer incomplete", `UPDATE stock_analysis SET gemini_pt=0 WHERE ticker='ASX:AEVT'`, "RESEARCH"},
		{"negative upside", `UPDATE stock_analysis SET gemini_pt=1 WHERE ticker='ASX:WATCH'`, "RESEARCH"},
		{"stale statement", `UPDATE account_statements SET statement_date='2020-01-01'`, "DATA"},
		{"sell", `UPDATE security_positions SET position_state='SELL' WHERE ticker='WATCH'`, "CDF_BLOCKED"},
		{"disconnected", `DELETE FROM active_alerts WHERE ticker='ASX:WATCH'`, "FEED_DISCONNECTED"},
		{"Q4", `UPDATE q4_crisis_state SET active=1`, "Q4_BLOCKED"},
		{"Q3 reduced below exposure", `UPDATE equity_sizing SET target_equity_pct=50 WHERE source_ticker='SPX'`, "CAPACITY"},
		{"class full", `UPDATE holdings SET value_aud=1800 WHERE ticker='AEVT'`, "CAPACITY"},
		{"no class cash", `UPDATE asset_class_config SET cash_reserve=0 WHERE code='GOLD_MINERS'`, "FUNDING"},
		{"no broker cash", `UPDATE account_statements SET cash_aud=0`, "FUNDING"},
		{"unknown risk", `DELETE FROM equity_sizing`, "RISK_UNKNOWN"},
		{"outperform bear is not a cap", `UPDATE commodity_theme_events SET signal='SELL' WHERE security_ticker='ASX:WATCH'`, "READY"},
		{"changed benchmark", `UPDATE commodity_theme_stages SET source_denominator='AMEX:NEW' WHERE stage_key='SECURITY_OUTPERFORM'`, "FEED_DISCONNECTED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			seedWeightPolicy(t)
			seedWatchlistCandidate(t, "ASX:WATCH")
			actionUnitsExec(t, tc.sql)
			item := watchlistItem(t, "ASX:WATCH")
			if item.State != tc.state {
				t.Fatalf("want %s: %+v", tc.state, item)
			}
			if tc.state != "READY" && item.Entry != 0 {
				t.Fatalf("blocked entry has money: %+v", item)
			}
		})
	}
}

func TestWatchlistOptionalIndividualCeiling(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_quality=1,gemini_value=1 WHERE ticker='ASX:WATCH'`)
	item := watchlistItem(t, "ASX:WATCH")
	if item.State != "READY" || item.Entry != 100 || item.IdealPct == nil || *item.IdealPct >= 5 {
		t.Fatalf("weight management Off must not impose individual ceiling: %+v", item)
	}
	actionUnitsExec(t, `UPDATE weight_policy SET enabled=1 WHERE id=1`)
	item = watchlistItem(t, "ASX:WATCH")
	if item.State != "WEIGHT_LIMIT" || item.Entry != 0 {
		t.Fatalf("weight management On must apply individual room: %+v", item)
	}
}

func TestWatchlistPreservesCoreETFReservation(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	t.Setenv("COUNCIL_API_TOKEN", "")
	seedClassBudgetCore(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	actionUnitsExec(t, `UPDATE account_statements SET statement_date=?`, time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02"))
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_quality=70,gemini_value=70,gemini_pt=10,current_price=5 WHERE ticker='ASX:AEVT'`)
	item := watchlistItem(t, "ASX:WATCH")
	if item.State != "READY" || item.IdealPct == nil {
		t.Fatalf("funded prospective stock: %+v", item)
	}
	assertBudgetValue(t, "stock receives half of remaining 68.75 percent", *item.IdealPct, 34.375)
	actionUnitsExec(t, `UPDATE holdings SET value_aud=6870 WHERE ticker='AEVT'`)
	item = watchlistItem(t, "ASX:WATCH")
	if item.State != "CAPACITY" || item.Entry != 0 {
		t.Fatalf("candidate spent cash reserved for the fund: %+v", item)
	}
}

func TestWatchlistNoBreakoutAfterTrendTurnsSell(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	insertSecurityActionTestAlert(t, "ASX:WATCH", "BREAKOUT")
	insertSecurityActionTestAlert(t, "ASX:WATCH", "BREAKOUT")
	items, err := watchlistOpportunities(context.Background())
	if err != nil || len(items) != 1 || items[0].Signal != "BREAKOUT" || items[0].ActionID == 0 {
		t.Fatalf("duplicate alerts must stay one opportunity: %+v %v", items, err)
	}
	actionUnitsExec(t, `UPDATE security_positions SET position_state='SELL' WHERE ticker='WATCH'`)
	item := watchlistItem(t, "ASX:WATCH")
	if item.Signal != "SELL" || item.State != "CDF_BLOCKED" || item.Entry != 0 {
		t.Fatalf("stale breakout must not override current Sell: %+v", item)
	}
}

func TestWatchlistHeldExternalAndArchivedNeverAppear(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	actionUnitsExec(t, `UPDATE stock_analysis SET is_watchlist=1 WHERE ticker='ASX:AEVT'`)
	seedWatchlistCandidate(t, "ASX:EXT")
	actionUnitsExec(t, `UPDATE stock_analysis SET is_external=1 WHERE ticker='ASX:EXT'`)
	seedWatchlistCandidate(t, "ASX:HIDDEN")
	actionUnitsExec(t, `UPDATE stock_analysis SET security_type='NON_ALLOCATING' WHERE ticker='ASX:HIDDEN'`)
	items, err := watchlistOpportunities(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Ticker != "ASX:WATCH" {
		t.Fatalf("wrong universe: %+v", items)
	}
	actionUnitsExec(t, `UPDATE holdings SET quantity=10,value_aud=50 WHERE ticker='WATCH'`)
	items, err = watchlistOpportunities(context.Background())
	if err != nil || len(items) != 0 {
		t.Fatalf("confirmed holding did not leave watchlist: %+v %v", items, err)
	}
}

func TestWatchlistPendingExecutionAndClassSlots(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	alert := insertSecurityActionTestAlert(t, "ASX:WATCH", "BUY")
	actionUnitsExec(t, `UPDATE security_actions SET status='AWAITING_STATEMENT',execution_cash_value=100 WHERE alert_id=?`, alert)
	if item := watchlistItem(t, "ASX:WATCH"); item.State != "PENDING" || item.Entry != 0 {
		t.Fatalf("pending entry repeated: %+v", item)
	}
	actionUnitsExec(t, `UPDATE security_actions SET status='IGNORED' WHERE alert_id=?`, alert)
	for i := 0; i < 8; i++ {
		ticker := fmt.Sprintf("ASX:HELD%d", i)
		seedDeploymentTicketSecurity(t, ticker, 1, 1)
		actionUnitsExec(t, `UPDATE stock_analysis SET gemini_quality=70,gemini_value=70,gemini_pt=10,current_price=5 WHERE ticker=?`, ticker)
	}
	if item := watchlistItem(t, "ASX:WATCH"); item.State != "CAPACITY" {
		t.Fatalf("eleventh stock allowed: %+v", item)
	}
}

func TestWatchlistFundingSubtractsOtherPendingBuys(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	alert := insertSecurityActionTestAlert(t, "ASX:BETA", "ADD")
	actionUnitsExec(t, `UPDATE security_actions SET status='AWAITING_STATEMENT',asset_class_code='GOLD_MINERS',execution_cash_value=280 WHERE alert_id=?`, alert)
	item := watchlistItem(t, "ASX:WATCH")
	if item.State != "CAPACITY" || item.Entry != 0 {
		t.Fatalf("pending spend reused: %+v", item)
	}
}

func TestWatchlistEndpointAndMissingDatabase(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedWatchlistCandidate(t, "ASX:WATCH")
	w := httptest.NewRecorder()
	getWatchlistOpportunities(w, httptest.NewRequest("GET", "/api/watchlist/opportunities", nil))
	var result struct {
		Items []watchlistOpportunity `json:"items"`
		AsOf  string                 `json:"as_of"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Items) != 1 || result.AsOf == "" {
		t.Fatalf("invalid response: %s", w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("preview must not be cached")
	}
	actionUnitsExec(t, `DROP TABLE active_alerts`)
	w = httptest.NewRecorder()
	getWatchlistOpportunities(w, httptest.NewRequest("GET", "/api/watchlist/opportunities", nil))
	if w.Code != 503 {
		t.Fatalf("missing data failed open: %d", w.Code)
	}
}
