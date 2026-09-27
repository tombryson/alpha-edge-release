package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func seedManagedFund(t *testing.T) {
	t.Helper()
	actionUnitsExec(t, `INSERT INTO stock_analysis(ticker, name, security_type, primary_asset_class) VALUES ('ASX:MODE', 'Mode Test Fund', 'ETF', 'GOLD_MINERS')`)
	actionUnitsExec(t, `INSERT INTO holdings(ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('MODE', 'Mode Test Fund', 100, 10, 1000, 1)`)
	actionUnitsExec(t, `INSERT INTO etf_allocations(ticker, allocation_percent, base_weight, tactical_status) VALUES ('MODE', 12, 12, 'BUY')`)
	actionUnitsExec(t, `INSERT INTO asset_class_etf_policies(asset_class, core_ticker, core_ratio_pct, momentum_influence_pct) VALUES ('GOLD_MINERS', 'MODE', 50, 50)`)
}

func changeManagement(t *testing.T, mode, previous, direction string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"mode": mode, "previous_mode": previous, "initial_state": direction})
	r := mux.SetURLVars(httptest.NewRequest(http.MethodPut, "/api/etf/management/ASX:MODE", bytes.NewReader(body)), map[string]string{"ticker": "ASX:MODE"})
	w := httptest.NewRecorder()
	updateETFManagementProfile(w, r)
	return w
}

func setupManagedConnection(t *testing.T, script, direction string, want int) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"ticker": "ASX:MODE", "script": script, "position_state": direction})
	w := httptest.NewRecorder()
	setupActiveAlert(w, httptest.NewRequest(http.MethodPost, "/api/alerts/active/setup", bytes.NewReader(body)))
	if w.Code != want {
		t.Fatalf("setup %s = %d: %s", script, w.Code, w.Body.String())
	}
}

func assertManagementEligibility(t *testing.T, want string) {
	t.Helper()
	allocations := map[string]etfAllocationDBRow{"MODE": {Ticker: "MODE", AllocationPercent: 12, BaseWeight: 12, TacticalStatus: "BUY"}}
	modes, err := applyETFManagementStates(db, allocations)
	if err != nil {
		t.Fatal(err)
	}
	if modes["MODE"] == "" || allocations["MODE"].TacticalStatus != want || allocations["MODE"].AllocationPercent != 12 {
		t.Fatalf("mode/eligibility/weight = %v %+v", modes, allocations["MODE"])
	}
}

func managedWebhook(t *testing.T, script, signal, cdf string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"ticker": "ASX:MODE", "script": script, "signal": signal, "cdf_state": cdf})
	w := httptest.NewRecorder()
	tradingViewWebhookSync(w, httptest.NewRequest(http.MethodPost, "/api/webhook/tradingview", bytes.NewReader(body)))
	if w.Code != 200 {
		t.Fatalf("webhook %s %s = %d: %s", script, signal, w.Code, w.Body.String())
	}
	return w
}

func TestETFManagementSwitchPreservesAllocationAndRetiresOldActions(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedManagedFund(t)
	setupManagedConnection(t, "etf_tms", "BUY", 200)
	old := insertSecurityActionTestAlert(t, "MODE", "ADD")
	actionUnitsExec(t, `UPDATE alerts SET source = 'etf_tms' WHERE id = ?`, old)
	w := changeManagement(t, "tms", "etf_tms", "BUY")
	if w.Code != 200 {
		t.Fatalf("switch = %d: %s", w.Code, w.Body.String())
	}
	var kind string
	var ratio, influence, weight float64
	var connections, audit int
	if err := db.QueryRow(`SELECT security_type FROM stock_analysis WHERE ticker = 'ASX:MODE'`).Scan(&kind); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT core_ratio_pct, momentum_influence_pct FROM asset_class_etf_policies WHERE asset_class = 'GOLD_MINERS'`).Scan(&ratio, &influence); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT allocation_percent FROM etf_allocations WHERE ticker = 'MODE'`).Scan(&weight); err != nil {
		t.Fatal(err)
	}
	if kind != "ETF" || ratio != 50 || influence != 50 || weight != 12 {
		t.Fatalf("allocation changed: %s %v %v %v", kind, ratio, influence, weight)
	}
	db.QueryRow(`SELECT COUNT(*) FROM active_alerts WHERE ticker = 'ASX:MODE'`).Scan(&connections)
	db.QueryRow(`SELECT COUNT(*) FROM etf_management_changes WHERE ticker = 'MODE'`).Scan(&audit)
	_, status, _ := actionForAlertID(t, old)
	if connections != 0 || audit != 1 || status != "NOT_APPLICABLE" {
		t.Fatalf("cleanup = connections %d audit %d action %s", connections, audit, status)
	}
	assertManagementEligibility(t, "SELL")
	setupManagedConnection(t, "etf_tms", "BUY", 409)
	setupManagedConnection(t, "cdf", "BUY", 200)
	assertManagementEligibility(t, "SELL")
	// CDF owns first entry; requiring TMS before a holding exists would deadlock it.
	actionUnitsExec(t, `UPDATE holdings SET is_active = 0 WHERE ticker = 'MODE'`)
	assertManagementEligibility(t, "BUY")
	actionUnitsExec(t, `UPDATE holdings SET is_active = 1 WHERE ticker = 'MODE'`)
	assertManagementEligibility(t, "SELL")
	setupManagedConnection(t, "tms", "", 200)
	assertManagementEligibility(t, "BUY")
}

func TestETFManagementRejectsInvalidStaleAndPendingSwitches(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedManagedFund(t)
	for _, tc := range []struct {
		mode, previous, state string
		code                  int
	}{{"stock", "etf_tms", "BUY", 400}, {"tms", "etf_tms", "", 400}, {"tms", "tms", "BUY", 409}} {
		if w := changeManagement(t, tc.mode, tc.previous, tc.state); w.Code != tc.code {
			t.Fatalf("invalid switch = %d: %s", w.Code, w.Body.String())
		}
	}
	a := insertSecurityActionTestAlert(t, "MODE", "SELL")
	for _, status := range []string{"AWAITING_STATEMENT", "VARIANCE"} {
		actionUnitsExec(t, `UPDATE security_actions SET status = ? WHERE alert_id = ?`, status, a)
		if w := changeManagement(t, "tms", "etf_tms", "BUY"); w.Code != 409 {
			t.Fatalf("pending switch = %d: %s", w.Code, w.Body.String())
		}
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM etf_management_profiles`).Scan(&count)
	if count != 0 {
		t.Fatal("rejected switch wrote a profile")
	}
}

func TestETFManagementRollbackAndNoOp(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedManagedFund(t)
	setupManagedConnection(t, "etf_tms", "BUY", 200)
	if w := changeManagement(t, "etf_tms", "etf_tms", "SELL"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var direction string
	if err := db.QueryRow(`SELECT position_state FROM security_positions WHERE ticker = 'MODE'`).Scan(&direction); err != nil {
		t.Fatal(err)
	}
	if direction != "BUY" {
		t.Fatal("same-mode save reset the lifecycle")
	}
	actionUnitsExec(t, `CREATE TRIGGER reject_management_audit BEFORE INSERT ON etf_management_changes BEGIN SELECT RAISE(ABORT, 'test failure'); END`)
	if w := changeManagement(t, "tms", "etf_tms", "SELL"); w.Code != 500 {
		t.Fatalf("switch = %d: %s", w.Code, w.Body.String())
	}
	var profiles, connections int
	if err := db.QueryRow(`SELECT COUNT(*) FROM etf_management_profiles`).Scan(&profiles); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM active_alerts WHERE ticker = 'ASX:MODE'`).Scan(&connections); err != nil {
		t.Fatal(err)
	}
	if profiles != 0 || connections != 1 {
		t.Fatalf("rollback profiles %d connections %d", profiles, connections)
	}
}

func TestETFManagementTMSStopReentryAndOldScriptIsolation(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedManagedFund(t)
	if w := changeManagement(t, "tms", "etf_tms", "BUY"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	managedWebhook(t, "tms", "SELL", "BUY") // Not yet connected: no mutation.
	setupManagedConnection(t, "cdf", "BUY", 200)
	setupManagedConnection(t, "tms", "", 200)
	managedWebhook(t, "etf_tms", "SELL", "")
	assertManagementEligibility(t, "BUY")
	managedWebhook(t, "tms", "SELL", "BUY")
	assertManagementEligibility(t, "SELL")
	var alertType string
	var waiting bool
	db.QueryRow(`SELECT alert_type FROM alerts WHERE ticker = 'MODE' ORDER BY id DESC LIMIT 1`).Scan(&alertType)
	db.QueryRow(`SELECT stopped_waiting_reentry FROM security_positions WHERE ticker = 'MODE'`).Scan(&waiting)
	if alertType != "SELL_50" || !waiting {
		t.Fatalf("stop = %s waiting %t", alertType, waiting)
	}
	managedWebhook(t, "tms", "REENTRY", "")
	assertManagementEligibility(t, "BUY")
	managedWebhook(t, "tms", "SELL", "SELL")
	assertManagementEligibility(t, "SELL")
	db.QueryRow(`SELECT stopped_waiting_reentry FROM security_positions WHERE ticker = 'MODE'`).Scan(&waiting)
	if waiting {
		t.Fatal("bearish CDF stop must not await oscillator re-entry")
	}
	managedWebhook(t, "tms", "REENTRY", "")
	assertManagementEligibility(t, "SELL")
	if w := changeManagement(t, "etf_tms", "tms", "BUY"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	setupManagedConnection(t, "etf_tms", "BUY", 200)
	managedWebhook(t, "tms", "SELL", "BUY")
	assertManagementEligibility(t, "BUY")
	managedWebhook(t, "etf_tms", "SELL", "")
	assertManagementEligibility(t, "SELL")
	db.QueryRow(`SELECT alert_type FROM alerts WHERE ticker = 'MODE' ORDER BY id DESC LIMIT 1`).Scan(&alertType)
	if alertType != "SELL" {
		t.Fatalf("ETF sell = %s", alertType)
	}
}
