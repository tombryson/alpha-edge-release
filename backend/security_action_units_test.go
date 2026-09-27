package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func actionUnitsExec(t *testing.T, query string, args ...interface{}) int64 {
	t.Helper()
	result, err := db.Exec(query, args...)
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func actionUnitsRecord(t *testing.T, id int, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	r = mux.SetURLVars(r, map[string]string{"id": stringInt(id)})
	w := httptest.NewRecorder()
	recordSecurityActionExecution(w, r)
	return w
}

func TestSecurityActionUnitTolerance(t *testing.T) {
	for _, tc := range []struct {
		name     string
		intent   string
		actual   float64
		reported bool
		want     bool
	}{
		{"estimated nine", "REDUCE", 91, false, true},
		{"estimated ten", "REDUCE", 90, false, true},
		{"estimated eleven", "REDUCE", 89, false, true},
		{"no movement", "REDUCE", 100, false, false},
		{"too small", "REDUCE", 99, false, false},
		{"too large", "REDUCE", 50, false, false},
		{"wrong direction", "REDUCE", 110, false, false},
		{"reported exact", "REDUCE", 90, true, true},
		{"reported mismatch", "REDUCE", 91, true, false},
		{"buy nine", "DEPLOY", 109, false, true},
		{"buy tiny", "DEPLOY", 101, false, false},
		{"buy excessive", "DEPLOY", 150, false, false},
		{"partial exit", "EXIT", 1, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := securityActionUnitsMatch(tc.intent, securityActionUnitSnapshot{Before: 100, Expected: 10}, tc.actual, tc.reported)
			if got != tc.want {
				t.Fatalf("match = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSecurityActionClassMatchesUnitsNotMarketValue(t *testing.T) {
	for _, tc := range []struct {
		name            string
		quantity, value float64
		want            string
	}{
		{"price falls without sale", 100, 500, securityActionVariance},
		{"sale while price rises", 80, 1200, securityActionConfirmed},
		{"sale inside tolerance", 82, 820, securityActionConfirmed},
		{"excessive sale", 40, 400, securityActionVariance},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('UNIT', 'Unit Test', 100, 10, 1000, 1)`)
			if err := projectCommodityThemeAssetClassAction("units-test", "GOLD", "GOLD_MINERS", []string{"UNIT"}, 1000); err != nil {
				t.Fatal(err)
			}
			var id int
			if err := db.QueryRow(`SELECT id FROM security_actions WHERE source_event_key = 'units-test'`).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if w := actionUnitsRecord(t, id, `{}`); w.Code != 200 {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			statement := actionUnitsExec(t, `INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud) VALUES ('IG', '2026-09-08', 1000, 0)`)
			actionUnitsExec(t, `INSERT INTO statement_holdings (statement_id, details, quantity, cost_aud, current_price, value_aud, gain_loss_aud, gain_loss_pct, market_value) VALUES (?, 'Unit Test', ?, 1000, 10, ?, 0, 0, ?)`, statement, tc.quantity, tc.value, tc.value)
			reconcileSecurityActionsAfterStatement(statement, 1)
			var status string
			if err := db.QueryRow(`SELECT status FROM security_actions WHERE id = ?`, id).Scan(&status); err != nil {
				t.Fatal(err)
			}
			if status != tc.want {
				t.Fatalf("status = %s, want %s", status, tc.want)
			}
		})
	}
}

func TestSecurityActionOptionalUnitsAndCurrentBaseline(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:UNIT", 20, 1000)
	alert := insertSecurityActionTestAlert(t, "ASX:UNIT", "SELL_50")
	id, _, _ := actionForAlertID(t, alert)
	// A prior action was statement-confirmed after this alert was created.
	actionUnitsExec(t, `UPDATE holdings SET quantity = 80, value_aud = 800 WHERE ticker = 'UNIT'`)
	for _, body := range []string{`{"units":0}`, `{"units":-1}`, `{"units":"ten"}`} {
		if w := actionUnitsRecord(t, id, body); w.Code != 400 {
			t.Fatalf("invalid units accepted: %s", body)
		}
	}
	if w := actionUnitsRecord(t, id, `{"units":39,"notes":"filled"}`); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var units float64
	var snapshotJSON, method string
	if err := db.QueryRow(`SELECT execution_units, execution_snapshot_json, reconciliation_method FROM security_actions WHERE id = ?`, id).Scan(&units, &snapshotJSON, &method); err != nil {
		t.Fatal(err)
	}
	var snapshots []securityActionUnitSnapshot
	if err := json.Unmarshal([]byte(snapshotJSON), &snapshots); err != nil {
		t.Fatal(err)
	}
	if units != 39 || method != "REPORTED_UNITS" || snapshots[0].Before != 80 || snapshots[0].Expected != 39 {
		t.Fatalf("incorrect capture: %s %s", method, snapshotJSON)
	}
	if w := actionUnitsRecord(t, id, `{}`); w.Code != http.StatusConflict {
		t.Fatal("duplicate execution accepted")
	}
	w := httptest.NewRecorder()
	getSecurityActions(w, httptest.NewRequest(http.MethodGet, "/?ticker=UNIT&includeHistory=true", nil))
	var actions []SecurityAction
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &actions) != nil || len(actions) != 1 {
		t.Fatalf("get action: %d %s", w.Code, w.Body.String())
	}
	if actions[0].ExecutionUnits == nil || *actions[0].ExecutionUnits != 39 || actions[0].ReconciliationMethod != "REPORTED_UNITS" {
		t.Fatalf("reported units missing from API: %s", w.Body.String())
	}
}

func TestSecurityActionIgnoresOldSameDayAndOtherBrokerStatements(t *testing.T) {
	for _, tc := range []struct{ account, date string }{
		{"IG", "2026-09-06"}, {"IG", "2026-09-07T23:00:00Z"}, {"CMC", "2026-09-08"},
	} {
		t.Run(tc.account+tc.date, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			actionUnitsExec(t, `INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud) VALUES ('IG', '2026-09-07', 1000, 0)`)
			actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('UNIT', 'Unit Test', 100, 10, 1000, 1)`)
			alert := insertSecurityActionTestAlert(t, "ASX:UNIT", "SELL_50")
			id, _, _ := actionForAlertID(t, alert)
			if w := actionUnitsRecord(t, id, `{}`); w.Code != 200 {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			statement := actionUnitsExec(t, `INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud) VALUES (?, ?, 1000, 0)`, tc.account, tc.date)
			reconcileSecurityActionsAfterStatement(statement, 2)
			_, status, _ := actionForAlertID(t, alert)
			if status != securityActionAwaitingStatement {
				t.Fatalf("ineligible statement changed status to %s", status)
			}
		})
	}
}

func TestSecurityActionLegacyDecisionCapturesUnits(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('UNIT', 'Unit Test', 100, 10, 1000, 1)`)
	alert := insertSecurityActionTestAlert(t, "ASX:UNIT", "SELL_DOWN")
	if err := syncLegacyDecisionIntoSecurityAction(alert, "SELL_DOWN", nil, nil); err != nil {
		t.Fatal(err)
	}
	var raw, method string
	if err := db.QueryRow(`SELECT execution_snapshot_json, reconciliation_method FROM security_actions WHERE alert_id = ?`, alert).Scan(&raw, &method); err != nil {
		t.Fatal(err)
	}
	var snapshots []securityActionUnitSnapshot
	if err := json.Unmarshal([]byte(raw), &snapshots); err != nil {
		t.Fatal(err)
	}
	if method != "ESTIMATED_UNITS" || len(snapshots) != 1 || snapshots[0].Expected != 20 {
		t.Fatalf("legacy decision not captured: %s %s", method, raw)
	}
}

func TestSecurityActionClassRequiresEachHolding(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	for _, ticker := range []string{"ONE", "TWO"} {
		actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active) VALUES (?, ?, 100, 10, 1000, 1)`, ticker, ticker)
	}
	if err := projectCommodityThemeAssetClassAction("each-test", "GOLD", "GOLD_MINERS", []string{"ONE", "TWO"}, 2000); err != nil {
		t.Fatal(err)
	}
	var id int
	if err := db.QueryRow(`SELECT id FROM security_actions WHERE source_event_key = 'each-test'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if w := actionUnitsRecord(t, id, `{"units":40}`); w.Code != 400 {
		t.Fatal("class accepted one ambiguous unit amount")
	}
	if w := actionUnitsRecord(t, id, `{}`); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	statement := actionUnitsExec(t, `INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud) VALUES ('IG', '2026-09-08', 1600, 0)`)
	// The aggregate is down 20%, but one holding was not sold at all.
	for ticker, quantity := range map[string]int{"ONE": 60, "TWO": 100} {
		actionUnitsExec(t, `INSERT INTO statement_holdings (statement_id, details, quantity, cost_aud, current_price, value_aud, gain_loss_aud, gain_loss_pct, market_value) VALUES (?, ?, ?, 1000, 10, ?, 0, 0, ?)`, statement, ticker, quantity, quantity*10, quantity*10)
	}
	reconcileSecurityActionsAfterStatement(statement, 1)
	var status string
	if err := db.QueryRow(`SELECT status FROM security_actions WHERE id = ?`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != securityActionVariance {
		t.Fatalf("aggregate incorrectly confirmed class: %s", status)
	}
}

func TestSecurityActionDeploymentEstimateUsesAUDValuePerShare(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('USD', 'Foreign Holding', 100, 5, 1000, 1)`)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	snapshots, err := captureSecurityActionUnits(tx, SecurityAction{Ticker: "USD", Scope: "SECURITY", Intent: "DEPLOY", InstructionValue: 100}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 || snapshots[0].Expected != 10 {
		t.Fatalf("used native quote instead of AUD price: %+v", snapshots)
	}
}

func TestSecurityActionTrimUsesExistingPercentages(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('UNIT', 'Unit Test', 100, 10, 1000, 1)`)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for strength, expected := range map[string]float64{"Strong": 20, "Weak": 5, "": 0} {
		snapshots, err := captureSecurityActionUnits(tx, SecurityAction{Ticker: "UNIT", Scope: "SECURITY", Intent: "REDUCE", AlertType: "TRIM", Strength: strength}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if snapshots[0].Expected != expected {
			t.Fatalf("%s: expected %v, got %v", strength, expected, snapshots[0].Expected)
		}
	}
}

func TestSecurityActionLegacyEndpointAcceptsOptionalUnits(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('UNIT', 'Unit Test', 100, 10, 1000, 1)`)
	alert := insertSecurityActionTestAlert(t, "ASX:UNIT", "SELL_DOWN")
	for _, units := range []float64{-1, 22} {
		body, err := json.Marshal(map[string]interface{}{"alert_id": alert, "decision": "SELL_DOWN", "units": units})
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		createDecision(w, httptest.NewRequest(http.MethodPost, "/api/decisions", bytes.NewReader(body)))
		if units < 0 {
			if w.Code != 400 {
				t.Fatalf("invalid units accepted: %d", w.Code)
			}
		} else if w.Code < 200 || w.Code >= 300 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
	var units float64
	var method string
	if err := db.QueryRow(`SELECT execution_units, reconciliation_method FROM security_actions WHERE alert_id = ?`, alert).Scan(&units, &method); err != nil {
		t.Fatal(err)
	}
	if units != 22 || method != "REPORTED_UNITS" {
		t.Fatalf("legacy endpoint lost units: %v %s", units, method)
	}
}

func TestSecurityActionExternalIsManualAndDoesNotCreateCash(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO stock_analysis (ticker, name, is_external) VALUES ('ASX:EXT', 'External Test', 1)`)
	alert := insertSecurityActionTestAlert(t, "ASX:EXT", "ADD")
	id, _, _ := actionForAlertID(t, alert)
	if w := actionUnitsRecord(t, id, `{"units":10}`); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var status, method string
	var statement sql.NullInt64
	if err := db.QueryRow(`SELECT status, reconciliation_method, reconciled_statement_id FROM security_actions WHERE id = ?`, id).Scan(&status, &method, &statement); err != nil {
		t.Fatal(err)
	}
	if status != securityActionConfirmed || method != "MANUAL_EXTERNAL" || statement.Valid {
		t.Fatalf("external action falsely awaiting/verified: %s %s %v", status, method, statement)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM account_statements`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("manual action created a cash statement")
	}
}

func TestSecurityActionMissingIdentityDoesNotProveExit(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	statement := actionUnitsExec(t, `INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud) VALUES ('IG', '2026-09-08', 0, 0)`)
	_, found, err := statementQuantityForAction(statement, securityActionUnitSnapshot{Ticker: "OLD", Name: "Old Name"})
	if err != nil || found {
		t.Fatalf("missing identity treated as zero: %v %v", found, err)
	}
	identity := actionUnitsExec(t, `INSERT INTO security_identities (ticker, exchange_prefix, canonical_name) VALUES ('OLD', 'ASX:', 'Old Name')`)
	quantity, found, err := statementQuantityForAction(statement, securityActionUnitSnapshot{SecurityID: identity, Name: "Old Name"})
	if err != nil || !found || quantity != 0 {
		t.Fatalf("resolved complete absence: %v %v %v", quantity, found, err)
	}
	actionUnitsExec(t, `INSERT INTO statement_holdings (statement_id, details, quantity, cost_aud, current_price, value_aud, gain_loss_aud, gain_loss_pct, market_value) VALUES (?, 'Unresolved new name', 10, 1, 1, 10, 0, 0, 10)`, statement)
	_, found, err = statementQuantityForAction(statement, securityActionUnitSnapshot{SecurityID: identity, Name: "Old Name"})
	if err != nil || found {
		t.Fatal("unresolved statement identity treated as exit")
	}
}
