package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Cash-only tests use a complete, connected mandate. Gate tests explicitly
// remove or change one input, rather than accidentally relying on fail-open.
func seedDeploymentPermissions(t *testing.T) {
	t.Helper()
	actionUnitsExec(t, `INSERT INTO portfolio_mix_snapshots (id, status) VALUES (900, 'APPROVED')`)
	actionUnitsExec(t, `INSERT INTO portfolio_mix_snapshot_rows (snapshot_id, asset_class, display_name, weight_pct)
		VALUES (900, 'GOLD_MINERS', 'Gold miners', 100)`)
	actionUnitsExec(t, `INSERT OR REPLACE INTO equity_sizing (source_ticker, target_equity_pct) VALUES ('SPX', 100)`)
	actionUnitsExec(t, `INSERT OR REPLACE INTO q4_crisis_state (id, active) VALUES (1, 0)`)
	actionUnitsExec(t, `INSERT OR IGNORE INTO active_alerts (ticker, script) VALUES ('SP:SPX', 'q3d'), ('Q4D', 'q4d')`)
	actionUnitsExec(t, `UPDATE asset_class_config SET q3_throttle_factor = 1, q4d_liquidity_factor = 1 WHERE code = 'GOLD_MINERS'`)
	seedDeploymentMarketEvent(t, "EQUITY_RELATIVE", "", "BUY")
}

func seedDeploymentSecurityFeeds(t *testing.T, ticker string) {
	t.Helper()
	actionUnitsExec(t, `INSERT OR IGNORE INTO active_alerts (ticker, script) VALUES (?, 'cdf'), (?, 'tms')`, ticker, ticker)
	actionUnitsExec(t, `INSERT OR IGNORE INTO security_positions (ticker, position_state) VALUES (?, 'BUY')`, securityActionTicker(ticker))
	seedDeploymentMarketEvent(t, "SECURITY_OUTPERFORM", ticker, "BUY")
}

func seedDeploymentMarketEvent(t *testing.T, key, ticker, signal string) {
	t.Helper()
	stages, err := loadCommodityThemeStageConfigs(context.Background(), "GOLD")
	if err != nil {
		t.Fatal(err)
	}
	for _, stage := range stages {
		if stage.Key != key {
			continue
		}
		source := resolvedCommodityThemeSource(stage, &resolvedCommodityThemeSecurity{Ticker: ticker})
		connection, err := commodityThemeConnectionTicker(source)
		if err != nil {
			t.Fatal(err)
		}
		actionUnitsExec(t, `INSERT OR IGNORE INTO active_alerts (ticker, script) VALUES (?, 'cdf')`, connection)
		data, _ := json.Marshal(source)
		actionUnitsExec(t, `INSERT INTO commodity_theme_events (event_key, theme_code, stage_key, scope, security_ticker,
			signal, script, signal_version, source_json) VALUES (?, 'GOLD', ?, ?, ?, ?, 'cdf', 'cdf.relative.v1', ?)`,
			fmt.Sprintf("test-%s-%s-%s", key, ticker, signal), key, stage.Scope, ticker, signal, string(data))
		return
	}
	t.Fatalf("missing test stage %s", key)
}

func assertDeploymentState(t *testing.T, alert int, want string) {
	t.Helper()
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	state, amount, _, _ := deploymentProjectionForAlert(t, alert)
	if state != want || want != deploymentStateFunded && amount != 0 {
		var instruction string
		_ = db.QueryRow(`SELECT instruction FROM security_actions WHERE alert_id = ?`, alert).Scan(&instruction)
		t.Fatalf("state %s amount %v, want %s: %s", state, amount, want, instruction)
	}
}

func TestDeploymentGateMatrix(t *testing.T) {
	for _, tc := range []struct{ name, sql, want, alertType string }{
		{"connected", `SELECT 1`, deploymentStateFunded, "ADD"},
		{"stock sell", `UPDATE security_positions SET position_state = 'SELL'`, deploymentStateCDFBlocked, "ADD"},
		{"reentry sell", `UPDATE security_positions SET position_state = 'SELL'`, deploymentStateFunded, "REENTRY"},
		{"reentry disconnected", `DELETE FROM active_alerts WHERE script = 'cdf' AND ticker = 'ASX:AEVT'`, "FEED_DISCONNECTED", "REENTRY"},
		{"saved buy disconnected", `DELETE FROM active_alerts WHERE script = 'cdf' AND ticker = 'ASX:AEVT'`, "FEED_DISCONNECTED", "ADD"},
		{"TMS disconnected", `DELETE FROM active_alerts WHERE script = 'tms'`, "FEED_DISCONNECTED", "ADD"},
		{"unknown stock", `DELETE FROM security_positions`, "TREND_UNKNOWN", "ADD"},
		{"equity bear reentry", `UPDATE commodity_theme_events SET signal = 'SELL' WHERE stage_key = 'EQUITY_RELATIVE'`, "MARKET_BLOCKED", "REENTRY"},
		{"equity unknown", `DELETE FROM commodity_theme_events WHERE stage_key = 'EQUITY_RELATIVE'`, "TREND_UNKNOWN", "ADD"},
		{"outperform bear remains evidence", `UPDATE commodity_theme_events SET signal = 'SELL' WHERE stage_key = 'SECURITY_OUTPERFORM'`, deploymentStateFunded, "ADD"},
		{"outperform disconnected", `DELETE FROM active_alerts WHERE ticker LIKE 'ASX:AEVT/%'`, "FEED_DISCONNECTED", "ADD"},
		{"renamed equity pair", `UPDATE commodity_theme_stages SET source_numerator = 'AMEX:NEW' WHERE theme_code = 'GOLD' AND stage_key = 'EQUITY_RELATIVE'`, "FEED_DISCONNECTED", "ADD"},
		{"Q4 active", `UPDATE q4_crisis_state SET active = 1`, "Q4_BLOCKED", "ADD"},
		{"legacy Q4 active", `INSERT INTO equity_sizing(source_ticker, target_equity_pct) VALUES ('Q4D', 10)`, "Q4_BLOCKED", "REENTRY"},
		{"Q4 disconnected", `DELETE FROM active_alerts WHERE script = 'q4d'`, "FEED_DISCONNECTED", "ADD"},
		{"Q4 unknown", `DELETE FROM q4_crisis_state`, "RISK_UNKNOWN", "ADD"},
		{"Q3 missing", `DELETE FROM equity_sizing`, "RISK_UNKNOWN", "ADD"},
		{"Q3 zero", `UPDATE equity_sizing SET target_equity_pct = 0`, "CAPACITY_REACHED", "ADD"},
		{"Q3 disconnected", `DELETE FROM active_alerts WHERE script = 'q3d'`, "RISK_UNKNOWN", "ADD"},
		{"no approved shape", `DELETE FROM portfolio_mix_snapshot_rows`, deploymentStateTargetUnavailable, "ADD"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			seedDeploymentTicketClass(t, 500)
			seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 500)
			actionUnitsExec(t, tc.sql)
			alert := insertSecurityActionTestAlert(t, "ASX:AEVT", tc.alertType)
			assertDeploymentState(t, alert, tc.want)
		})
	}
}

func TestDeploymentPhysicalSignalDoesNotGateProducersAndAliasesWork(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 500)
	seedDeploymentMarketEvent(t, "COMMODITY", "", "SELL")
	actionUnitsExec(t, `UPDATE active_alerts SET ticker = REPLACE(REPLACE(ticker, 'AMEX:', 'BATS:'), 'ASX:', 'ASX_DLY:')`)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, deploymentStateFunded)
}

func TestDeploymentQ3WorkingBudgetAndPendingPurchases(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 350)
	actionUnitsExec(t, `UPDATE portfolio_mix_snapshot_rows SET weight_pct = 10`)
	actionUnitsExec(t, `UPDATE equity_sizing SET target_equity_pct = 50 WHERE source_ticker = 'SPX'`)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, deploymentStateFunded)
	_, _, before, _ := deploymentProjectionForAlert(t, alert)
	if before != 150 {
		t.Fatalf("Q3 10%% to 5%% headroom = %v, want 150", before)
	}
	id, _, _ := actionForAlertID(t, alert)
	if w := fundingTestExecute(id, `{"units":50}`); w.Code != http.StatusConflict {
		t.Fatalf("oversized purchase: %d %s", w.Code, w.Body.String())
	}
	if w := fundingTestExecute(id, `{}`); w.Code != http.StatusOK {
		t.Fatalf("purchase: %d %s", w.Code, w.Body.String())
	}
	next := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, next, deploymentStateBelowMinimum)
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active = 1`)
	assertDeploymentState(t, next, "Q4_BLOCKED")
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active = 0`)
	assertDeploymentState(t, next, deploymentStateBelowMinimum)
	actionUnitsExec(t, `UPDATE equity_sizing SET target_equity_pct = 75 WHERE source_ticker = 'SPX'`)
	assertDeploymentState(t, next, deploymentStateFunded)
	var weight, reserve, cash float64
	if err := db.QueryRow(`SELECT weight_pct FROM portfolio_mix_snapshot_rows`).Scan(&weight); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT cash_reserve FROM asset_class_config WHERE code = 'GOLD_MINERS'`).Scan(&reserve); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT cash_aud FROM account_statements`).Scan(&cash); err != nil {
		t.Fatal(err)
	}
	if weight != 10 || reserve != 500 || cash != 500 {
		t.Fatalf("budget projection changed approved shape or cash: %v %v %v", weight, reserve, cash)
	}
}

func TestDeploymentBudgetSensitivity(t *testing.T) {
	for _, tc := range []struct{ q3, sensitivity, want float64 }{{50, 1, .5}, {50, .5, .75}, {50, .1, .95}, {50, 0, 1}, {75, 1, .75}, {-1, 1, 0}} {
		if got := deploymentBudgetFactor(tc.q3, tc.sensitivity); math.Abs(got-tc.want) > 1e-9 {
			t.Fatalf("%+v got %v", tc, got)
		}
	}
}

func TestDeploymentExecutionRechecksGateInTransaction(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	alert, id := fundingTestAction(t, "ASX:AEVT")
	assertDeploymentState(t, alert, deploymentStateFunded)
	action, err := loadOpenSecurityAction(id)
	if err != nil {
		t.Fatal(err)
	}
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active = 1`)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := validateDeploymentExecution(tx, action, nil); err == nil || !strings.Contains(err.Error(), "Q4") {
		t.Fatalf("stale permission accepted: %v", err)
	}
}

func TestDeploymentExceptionRequiresEvidenceAndPreservesBrokerTruth(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	_, id := fundingTestAction(t, "ASX:AEVT")
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active = 1`)
	for _, body := range []string{`{}`, `{"exception_reason":"Already traded"}`, `{"units":10,"cash_value":600}`, `{"units":10,"cash_value":-1,"exception_reason":"Already traded"}`} {
		w := fundingTestExecute(id, body)
		if w.Code != http.StatusBadRequest && w.Code != http.StatusConflict {
			t.Fatalf("accepted invalid exception: %s %d", body, w.Code)
		}
	}
	w := fundingTestExecute(id, `{"units":10,"cash_value":600,"exception_reason":"Order filled before I checked Q4"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("exception: %d %s", w.Code, w.Body.String())
	}
	var status, reason, snapshot, method string
	if err := db.QueryRow(`SELECT status, execution_exception_reason, execution_policy_snapshot, reconciliation_method FROM security_actions WHERE id = ?`, id).Scan(&status, &reason, &snapshot, &method); err != nil {
		t.Fatal(err)
	}
	if status != securityActionAwaitingStatement || reason == "" || !strings.Contains(snapshot, "Q4_BLOCKED") || method != "REPORTED_UNITS" {
		t.Fatalf("missing exception evidence: %s %s %s %s", status, reason, snapshot, method)
	}
	f, err := loadDeploymentFunding(db)
	if err != nil || f.Committed != 600 || f.available() != 0 {
		t.Fatalf("exception cash not reserved: %+v %v", f, err)
	}
	var units, value float64
	if err := db.QueryRow(`SELECT quantity, value_aud FROM holdings WHERE ticker = 'AEVT'`).Scan(&units, &value); err != nil {
		t.Fatal(err)
	}
	if units != 100 || value != 500 {
		t.Fatalf("broker holding mutated: %v %v", units, value)
	}
	if w := fundingTestExecute(id, `{"units":10,"cash_value":600,"exception_reason":"Duplicate"}`); w.Code != http.StatusConflict {
		t.Fatalf("duplicate exception accepted: %d", w.Code)
	}
	w = httptest.NewRecorder()
	getSecurityActions(w, httptest.NewRequest(http.MethodGet, "/?ticker=AEVT&includeHistory=true", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "execution_exception_reason") || !strings.Contains(w.Body.String(), "600") {
		t.Fatalf("exception not exposed: %s", w.Body.String())
	}
}

func TestDeploymentExceptionKeepsExitOutstandingAndReconcilesUnits(t *testing.T) {
	for _, quantity := range []int{100, 110} {
		t.Run(fmt.Sprint(quantity), func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			seedDeploymentTicketClass(t, 500)
			_, buyID := fundingTestAction(t, "ASX:AEVT")
			exitAlert := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL")
			if w := fundingTestExecute(buyID, `{"units":10,"cash_value":100,"exception_reason":"Filled despite pending exit"}`); w.Code != http.StatusOK {
				t.Fatalf("blocked exception: %d %s", w.Code, w.Body.String())
			}
			_, status, _ := actionForAlertID(t, exitAlert)
			if status != securityActionOpen {
				t.Fatalf("exception resolved exit: %s", status)
			}
			statement := actionUnitsExec(t, `INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
				VALUES ('Policy Test', '2026-08-11', 10000, 400)`)
			actionUnitsExec(t, `INSERT INTO statement_holdings (statement_id, details, quantity, cost_aud, current_price, value_aud, gain_loss_aud, gain_loss_pct, market_value)
				VALUES (?, 'AEVT Holdings', ?, 500, 3, 330, 0, 0, 330)`, statement, quantity)
			reconcileSecurityActionsAfterStatement(statement, 2)
			if err := db.QueryRow(`SELECT status FROM security_actions WHERE id = ?`, buyID).Scan(&status); err != nil {
				t.Fatal(err)
			}
			want := securityActionConfirmed
			if quantity == 100 {
				want = securityActionVariance
			}
			if status != want {
				t.Fatalf("quantity %d status %s want %s", quantity, status, want)
			}
		})
	}
}

func TestDeploymentQ4ExemptClassAndPhysicalGate(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 500)
	actionUnitsExec(t, `UPDATE asset_class_config SET q4d_liquidity_factor = 0 WHERE code = 'GOLD_MINERS'`)
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active = 1`)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, deploymentStateFunded)
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active = 0`)
	seedDeploymentMarketEvent(t, "COMMODITY", "", "SELL")
	risk, err := loadDeploymentRisk(db)
	if err != nil {
		t.Fatal(err)
	}
	permission, err := deploymentSecurityPermission(db, "ASX:AEVT", "ADD", "tms", "PHYSICAL_GOLD", risk)
	if err != nil || permission.State != "MARKET_BLOCKED" {
		t.Fatalf("physical class not gated: %+v %v", permission, err)
	}
}

func TestDeploymentNewPairNeedsNewDirectionAndOldBarsCannotUnlock(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 500)
	actionUnitsExec(t, `UPDATE commodity_theme_stages SET source_numerator = 'AMEX:NEW' WHERE theme_code = 'GOLD' AND stage_key = 'EQUITY_RELATIVE'`)
	actionUnitsExec(t, `INSERT INTO active_alerts (ticker, script) VALUES ('BATS:NEW/AMEX:GLD', 'cdf')`)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, "TREND_UNKNOWN")
	seedDeploymentMarketEvent(t, "EQUITY_RELATIVE", "", "SELL")
	actionUnitsExec(t, `UPDATE commodity_theme_events SET bar_closed_at = '2026-09-08' WHERE signal = 'SELL'`)
	assertDeploymentState(t, alert, "MARKET_BLOCKED")
}

func TestDeploymentClassBudgetIncludesETFs(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 300)
	seedDeploymentTicketSecurity(t, "ASX:FUND", 0, 250)
	actionUnitsExec(t, `UPDATE stock_analysis SET security_type = 'ETF' WHERE ticker = 'ASX:FUND'`)
	actionUnitsExec(t, `UPDATE portfolio_mix_snapshot_rows SET weight_pct = 10`)
	actionUnitsExec(t, `UPDATE equity_sizing SET target_equity_pct = 50`)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, "CAPACITY_REACHED")
}
