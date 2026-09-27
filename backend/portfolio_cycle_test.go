package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"trading-backend/internal/portfoliomix"
	"trading-backend/internal/portfoliorebalance"
)

func cycleExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func seedCycleTest(t *testing.T) {
	t.Helper()
	t.Cleanup(setupPortfolioHistoryTestDB(t))
	cycleExec(t, `CREATE TABLE security_position_snapshots (id INTEGER PRIMARY KEY, statement_id INTEGER, observed_at DATETIME, ticker TEXT, exchange_prefix TEXT, name TEXT, asset_class TEXT, quantity REAL, market_value_aud REAL, source TEXT);
	CREATE TABLE security_price_daily (id INTEGER PRIMARY KEY, ticker TEXT, exchange_prefix TEXT, observed_date DATE, yahoo_symbol TEXT, currency TEXT, adjusted_close_price REAL, source TEXT);
	INSERT INTO portfolio_mix_snapshots(id,status,approved_at) VALUES (1,'SUPERSEDED','2026-01-15 09:00:00'),(2,'APPROVED','2026-05-15 09:00:00');
	INSERT INTO portfolio_mix_snapshot_rows(snapshot_id,asset_class,display_name,display_order,weight_pct) VALUES (1,'GOLD_MINERS','Gold',1,90),(1,'CASH','Cash',2,10),(2,'GOLD_MINERS','Gold',1,90),(2,'CASH','Cash',2,10);
	INSERT INTO portfolio_daily_snapshots VALUES (1,'2026-01-14 21:00:00',1000,900,100,0,0,2,'STATEMENT'),(2,'2026-05-14 21:00:00',1000,900,100,0,0,1,'STATEMENT');
	INSERT INTO security_position_snapshots VALUES
	(1,1,'2026-01-14 21:00:00','AAA','ASX:','Asset A','GOLD_MINERS',10,600,'STATEMENT'),
	(2,1,'2026-01-14 21:00:00','BBB','ASX:','Asset B','GOLD_MINERS',10,300,'STATEMENT'),
	(3,2,'2026-05-14 21:00:00','AAA','ASX:','Asset A','GOLD_MINERS',100,900,'STATEMENT');
	INSERT INTO security_price_daily(ticker,exchange_prefix,observed_date,yahoo_symbol,currency,adjusted_close_price,source) VALUES
	('AAA','ASX:','2026-01-14','AAA.AX','AUD',10,'YAHOO'),('BBB','ASX:','2026-01-14','BBB.AX','AUD',10,'YAHOO'),
	('AAA','ASX:','2026-05-14','AAA.AX','AUD',12,'YAHOO'),('BBB','ASX:','2026-05-14','BBB.AX','AUD',9,'YAHOO'),
	('AAA','ASX:','2026-05-15','AAA.AX','AUD',999,'YAHOO'),
	('AAA','ASX:','2026-09-17','AAA.AX','AUD',15,'YAHOO'),
	('AAA','NYSE:','2026-01-14','AAA','USD',90,'YAHOO'),('AAA','NYSE:','2026-05-14','AAA','USD',900,'YAHOO');`)
}

func cycleNow() time.Time { return time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC) }

func TestPortfolioCycleUsesOpeningBasketAndNoFuturePrices(t *testing.T) {
	seedCycleTest(t)
	result, err := loadPortfolioCycle(context.Background(), 1, cycleNow())
	if err != nil {
		t.Fatal(err)
	}
	if result.Cycle == nil || !result.Cycle.Closed || result.Cycle.EndedAt.Format("2006-01-02") != "2026-05-15" {
		t.Fatalf("wrong cycle: %+v", result.Cycle)
	}
	if len(result.Securities) != 2 || result.Classes[0].ReturnPct == nil || math.Abs(*result.Classes[0].ReturnPct-10) > 1e-8 {
		t.Fatalf("wrong opening-capital return (600*20 + 300*-10)/900: %+v", result)
	}
	if result.Classes[1].ReturnPct != nil {
		t.Fatal("cash must not fabricate a return")
	}
	if result.BestPerformer == nil || result.BestPerformer.Ticker != "AAA" || result.BestPerformer.EndPriceDate != "2026-05-14" {
		t.Fatalf("wrong winner: %+v", result.BestPerformer)
	}
	// B is no longer in the later statement, but remains in this cycle's cohort.
	if result.Securities[1].Ticker != "BBB" || result.Securities[1].ReturnPct == nil {
		t.Fatal("sold holding disappeared")
	}
	active, err := loadPortfolioCycle(context.Background(), 0, cycleNow())
	if err != nil {
		t.Fatal(err)
	}
	if active.Cycle.SnapshotID != 2 || active.Cycle.Closed || !active.Cycle.EndedAt.Equal(cycleNow()) || math.Abs(*active.Classes[0].ReturnPct-25) > 1e-8 {
		t.Fatalf("wrong active return: %+v", active)
	}
}

func TestPortfolioCycleWithholdsIncompleteReturnsAndWinner(t *testing.T) {
	seedCycleTest(t)
	cycleExec(t, "DELETE FROM security_price_daily WHERE ticker='BBB' AND observed_date='2026-05-14'")
	result, err := loadPortfolioCycle(context.Background(), 1, cycleNow())
	if err != nil {
		t.Fatal(err)
	}
	if result.Classes[0].ReturnPct != nil || result.Classes[0].Covered != 1 || math.Abs(result.Classes[0].CoveragePct-66.6666667) > 1e-5 || result.BestPerformer != nil {
		t.Fatalf("partial coverage treated as complete: %+v", result)
	}
}

func TestPortfolioCycleMissingBaselineAndCorrectedEvidence(t *testing.T) {
	seedCycleTest(t)
	cycleExec(t, "UPDATE portfolio_daily_snapshots SET observed_at='2025-12-01' WHERE statement_id=1")
	result, err := loadPortfolioCycle(context.Background(), 1, cycleNow())
	if err != nil || result.BaselineAt != nil || result.Classes[0].ReturnPct != nil || result.Reason == "" {
		t.Fatalf("missing baseline: %+v %v", result, err)
	}
	cycleExec(t, "UPDATE portfolio_daily_snapshots SET observed_at='2026-01-14' WHERE statement_id=1")
	cycleExec(t, "UPDATE security_position_snapshots SET market_value_aud=300 WHERE id=1")
	result, err = loadPortfolioCycle(context.Background(), 1, cycleNow())
	if err != nil || result.Classes[0].ReturnPct == nil || math.Abs(*result.Classes[0].ReturnPct-5) > 1e-8 {
		t.Fatalf("correction not reflected: %+v %v", result, err)
	}
}

func TestPortfolioCycleRejectsChangedSeriesAndInsufficientHistory(t *testing.T) {
	seedCycleTest(t)
	for _, update := range []string{
		"UPDATE security_price_daily SET currency='USD' WHERE ticker='AAA' AND observed_date='2026-05-14'",
		"UPDATE security_price_daily SET currency='AUD',yahoo_symbol='OTHER.AX' WHERE ticker='AAA' AND observed_date='2026-05-14'",
		"UPDATE security_price_daily SET yahoo_symbol='AAA.AX',adjusted_close_price=0 WHERE ticker='AAA' AND observed_date='2026-05-14'",
	} {
		cycleExec(t, update)
		result, err := loadPortfolioCycle(context.Background(), 1, cycleNow())
		if err != nil || result.Securities[0].ReturnPct != nil {
			t.Fatalf("accepted incompatible prices: %+v %v", result, err)
		}
	}
	cycleExec(t, "UPDATE portfolio_mix_snapshots SET approved_at='2026-01-15 09:00:00' WHERE id=2")
	result, err := loadPortfolioCycle(context.Background(), 1, cycleNow())
	if err != nil || result.Securities[0].ReturnPct != nil {
		t.Fatalf("same-day historical approvals created zero return: %+v %v", result, err)
	}
}

func TestPortfolioCycleAPIValidationAndNoWrites(t *testing.T) {
	seedCycleTest(t)
	for _, check := range []struct {
		query  string
		status int
	}{{"?snapshot_id=-1", 400}, {"?snapshot_id=x", 400}, {"?snapshot_id=999", 404}, {"?snapshot_id=1", 200}} {
		w := httptest.NewRecorder()
		getPortfolioCyclePerformance(w, httptest.NewRequest("GET", "/api/portfolio-mix/cycle-performance"+check.query, nil))
		if w.Code != check.status {
			t.Fatalf("%s: %d %s", check.query, w.Code, w.Body.String())
		}
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM portfolio_mix_snapshots").Scan(&count)
	if count != 2 {
		t.Fatal("GET changed approvals")
	}
	w := httptest.NewRecorder()
	writePortfolioApprovalError(w, &portfoliomix.ApprovalLockedError{NextAllowedAt: cycleNow()})
	var response map[string]any
	json.Unmarshal(w.Body.Bytes(), &response)
	if w.Code != 409 || response["code"] != "PORTFOLIO_CYCLE_LOCKED" || response["next_allowed_at"] == nil {
		t.Fatalf("bad policy response: %d %s", w.Code, w.Body.String())
	}
}

func TestPortfolioCycleBothApprovalPathsPreserveLockedState(t *testing.T) {
	for _, path := range []string{"current", "completed-plan"} {
		t.Run(path, func(t *testing.T) {
			t.Cleanup(setupSecurityActionTestDB(t))
			seedDeploymentTicketClass(t, 500)
			seedDeploymentTicketSecurity(t, "ASX:AAA", 100, 1500)
			cycleExec(t, "UPDATE portfolio_mix_snapshots SET approved_at = ? WHERE id = 900", time.Now().UTC())
			ctx, err := buildOverlayPortfolioContext(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			var rows []portfoliorebalance.PlanRow
			for _, row := range buildCurrentPortfolioMixRows(ctx) {
				rows = append(rows, portfoliorebalance.PlanRow{
					AssetClass: row.AssetClass, DisplayName: row.DisplayName, DisplayOrder: row.DisplayOrder,
					GovernedByQ1: row.GovernedByQ1, CurrentWeightPct: 0, TargetWeightPct: row.WeightPct,
				})
			}
			plan, err := portfolioRebalanceStore().CreateOpen(context.Background(), portfoliorebalance.CreateInput{Driver: "USER", Rows: rows})
			if err != nil || plan == nil {
				t.Fatalf("seed plan: %v", err)
			}
			status := "OPEN"
			w := httptest.NewRecorder()
			if path == "current" {
				approveCurrentPortfolioMix(w, httptest.NewRequest("POST", "/api/portfolio-mix/approve-current", strings.NewReader(`{"reason":"Q3"}`)))
			} else {
				status = "COMPLETED"
				cycleExec(t, "UPDATE portfolio_rebalance_plans SET status = ? WHERE id = ?", status, plan.ID)
				r := mux.SetURLVars(httptest.NewRequest("POST", "/api/portfolio-rebalance/approve", nil), map[string]string{"id": strconv.FormatInt(plan.ID, 10)})
				approvePortfolioRebalance(w, r)
			}
			if w.Code != 409 || !strings.Contains(w.Body.String(), "PORTFOLIO_CYCLE_LOCKED") {
				t.Fatalf("approval escaped lock: %d %s", w.Code, w.Body.String())
			}
			var count int
			if err := db.QueryRow("SELECT COUNT(*) FROM portfolio_mix_snapshots").Scan(&count); err != nil || count != 1 {
				t.Fatalf("approval records changed: %d %v", count, err)
			}
			var actual string
			if err := db.QueryRow("SELECT status FROM portfolio_mix_snapshots WHERE id = 900").Scan(&actual); err != nil || actual != "APPROVED" {
				t.Fatalf("existing approval superseded: %q %v", actual, err)
			}
			if err := db.QueryRow("SELECT status FROM portfolio_rebalance_plans WHERE id = ?", plan.ID).Scan(&actual); err != nil || actual != status {
				t.Fatalf("existing plan changed: %q %v", actual, err)
			}
		})
	}
}
