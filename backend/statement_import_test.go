package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func importTestPayload() map[string]interface{} {
	return map[string]interface{}{
		"account":  map[string]interface{}{"account_name": "IG", "statement_date": "2026-09-01T00:00:00Z", "total_value_aud": 1100, "cash_aud": 100},
		"holdings": []interface{}{map[string]interface{}{"details": "Unit Test", "isin": "AU000000UNIT", "quantity": 100, "currency": "AUD", "current_price": 10, "value_aud": 1000}},
	}
}

func importTestSend(t *testing.T, payload map[string]interface{}, want int) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	importStatement(w, httptest.NewRequest(http.MethodPost, "/api/statements/import", bytes.NewReader(raw)))
	if w.Code != want {
		t.Fatalf("status %d, want %d: %s", w.Code, want, w.Body.String())
	}
	return w
}

// Compare all affected rows, not just portfolio totals, after an aborted import.
func importTestState(t *testing.T) map[string]string {
	t.Helper()
	state := map[string]string{}
	for _, table := range []string{"holdings", "stock_analysis", "security_identities", "security_name_aliases", "account_statements", "statement_holdings", "statement_revisions", "sync_history", "sync_changes", "portfolio_daily_snapshots", "asset_class_daily_snapshots", "security_position_snapshots", "security_actions"} {
		rows, err := db.Query("SELECT * FROM " + table + " ORDER BY rowid")
		if err != nil {
			t.Fatal(err)
		}
		columns, err := rows.Columns()
		if err != nil {
			t.Fatal(err)
		}
		var records [][]interface{}
		for rows.Next() {
			values, dest := make([]interface{}, len(columns)), make([]interface{}, len(columns))
			for i := range values {
				dest[i] = &values[i]
			}
			if err := rows.Scan(dest...); err != nil {
				t.Fatal(err)
			}
			records = append(records, values)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		raw, err := json.Marshal(records)
		if err != nil {
			t.Fatal(err)
		}
		state[table] = string(raw)
	}
	return state
}

func TestStatementImportRejectsInvalidSnapshotsWithoutMutation(t *testing.T) {
	cases := []struct {
		name   string
		code   int
		change func(map[string]interface{}, map[string]interface{}, map[string]interface{})
	}{
		{"older", 409, func(p, a, h map[string]interface{}) { a["statement_date"] = "2026-08-31T00:00:00Z" }},
		{"wrong account", 409, func(p, a, h map[string]interface{}) { a["account_name"] = "CMC" }},
		{"future", 400, func(p, a, h map[string]interface{}) { a["statement_date"] = "2099-01-01T00:00:00Z" }},
		{"missing cash", 400, func(p, a, h map[string]interface{}) { delete(a, "cash_aud") }},
		{"missing quantity", 400, func(p, a, h map[string]interface{}) { delete(h, "quantity") }},
		{"missing value", 400, func(p, a, h map[string]interface{}) { delete(h, "value_aud") }},
		{"missing currency", 400, func(p, a, h map[string]interface{}) { delete(h, "currency") }},
		{"null holdings", 400, func(p, a, h map[string]interface{}) { p["holdings"] = nil }},
		{"missing holding", 400, func(p, a, h map[string]interface{}) { p["holdings"] = []interface{}{} }},
		{"wrong total", 400, func(p, a, h map[string]interface{}) { a["total_value_aud"] = 1500 }},
		{"zero account", 400, func(p, a, h map[string]interface{}) {
			a["total_value_aud"] = 0
			a["cash_aud"] = 0
			p["holdings"] = []interface{}{}
		}},
		{"negative quantity", 400, func(p, a, h map[string]interface{}) { h["quantity"] = -1 }},
		{"zero quantity nonzero value", 400, func(p, a, h map[string]interface{}) { h["quantity"] = 0 }},
		{"duplicate name", 400, func(p, a, h map[string]interface{}) {
			p["holdings"] = append(p["holdings"].([]interface{}), h)
			a["total_value_aud"] = 2100
		}},
		{"duplicate isin", 400, func(p, a, h map[string]interface{}) {
			p["holdings"] = append(p["holdings"].([]interface{}), map[string]interface{}{"details": "Alias", "isin": "AU000000UNIT", "quantity": 1, "value_aud": 0, "currency": "AUD"})
		}},
		{"conflicting isin", 409, func(p, a, h map[string]interface{}) { h["isin"] = "AU000000OTHER" }},
		{"missing fx", 400, func(p, a, h map[string]interface{}) { h["currency"] = "USD"; h["market_value_native"] = 600 }},
		{"conversion overflow", 400, func(p, a, h map[string]interface{}) {
			h["currency"] = "USD"
			h["market_value_native"] = 1e308
			a["usd_value"] = 1
			a["usd_aud"] = 1e308
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			p := importTestPayload()
			importTestSend(t, p, 201)
			before := importTestState(t)
			tc.change(p, p["account"].(map[string]interface{}), p["holdings"].([]interface{})[0].(map[string]interface{}))
			importTestSend(t, p, tc.code)
			if !reflect.DeepEqual(before, importTestState(t)) {
				t.Fatal("rejected import changed stored state")
			}
		})
	}
}

func TestStatementImportRejectsInvalidJSON(t *testing.T) {
	for _, raw := range []string{`{`, `null`, `{}`, `{"account": {}} {}`, `[]`} {
		w := httptest.NewRecorder()
		importStatement(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(raw)))
		if w.Code != 400 {
			t.Fatalf("%s: %d", raw, w.Code)
		}
	}
}

func TestStatementImportIdentityConflictAndCorrectedMapping(t *testing.T) {
	for _, fallback := range []string{"ticker", "alias"} {
		t.Run(fallback, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			actionUnitsExec(t, `INSERT INTO company_mappings (company_name,ticker,exchange_prefix) VALUES ('Unit Test','UNIT','ASX:')`)
			p := importTestPayload()
			importTestSend(t, p, http.StatusCreated)
			if fallback == "ticker" {
				actionUnitsExec(t, `INSERT INTO company_mappings (company_name,ticker,exchange_prefix) VALUES ('Other Resources','UNIT','ASX:')`)
			} else {
				actionUnitsExec(t, `INSERT INTO company_mappings (company_name,ticker,exchange_prefix) VALUES ('Other Resources','OTHER','ASX:')`)
				actionUnitsExec(t, `INSERT INTO security_name_aliases (security_id,name,normalized_name,source)
					SELECT id,'Other Resources','other resources','legacy' FROM security_identities WHERE isin='AU000000UNIT'`)
			}
			p["account"].(map[string]interface{})["statement_date"] = "2026-09-02T00:00:00Z"
			p["account"].(map[string]interface{})["total_value_aud"] = 1200
			p["holdings"] = append(p["holdings"].([]interface{}), map[string]interface{}{
				"details": "Other Resources", "isin": "AU00000OTHER", "quantity": 10,
				"currency": "AUD", "current_price": 10, "value_aud": 100,
			})
			before := importTestState(t)
			w := importTestSend(t, p, http.StatusConflict)
			if !strings.Contains(w.Body.String(), "security identity conflict") || !strings.Contains(w.Body.String(), "Other Resources") {
				t.Fatalf("conflict was not actionable: %s", w.Body.String())
			}
			if !reflect.DeepEqual(before, importTestState(t)) {
				t.Fatal("identity conflict did not roll back the complete import")
			}
			actionUnitsExec(t, `UPDATE company_mappings SET ticker='OTHER' WHERE company_name='Other Resources'`)
			actionUnitsExec(t, `DELETE FROM security_name_aliases WHERE normalized_name='other resources'`)
			importTestSend(t, p, http.StatusCreated)
			var distinct, active int
			if err := db.QueryRow(`SELECT COUNT(DISTINCT security_id), COUNT(*) FROM holdings WHERE is_active=1`).Scan(&distinct, &active); err != nil {
				t.Fatal(err)
			}
			if distinct != 2 || active != 2 {
				t.Fatalf("corrected import did not retain two separate holdings: identities=%d active=%d", distinct, active)
			}
		})
	}
}

func TestStatementImportMatchesIDsAndPreservesExternalHoldings(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO company_mappings (company_name, ticker, exchange_prefix) VALUES ('Unit Test', 'UNIT', 'ASX')`)
	p := importTestPayload()
	importTestSend(t, p, 201)
	actionUnitsExec(t, `UPDATE holdings SET cash_reserve = 35`)
	actionUnitsExec(t, `INSERT INTO holdings (company_name,ticker,quantity,value_aud,is_active) VALUES ('External', 'EXT', 20, 300, 1)`)
	actionUnitsExec(t, `INSERT INTO stock_analysis (name,ticker,is_external) VALUES ('External','ASX:EXT',1)`)
	a := p["account"].(map[string]interface{})
	h := p["holdings"].([]interface{})[0].(map[string]interface{})
	a["statement_date"] = "2026-09-02T00:00:00Z"
	delete(h, "isin")
	importTestSend(t, p, 201)
	var isin, ticker string
	var active int
	var reserve float64
	if err := db.QueryRow(`SELECT isin,ticker,CAST(is_active AS INTEGER),cash_reserve FROM holdings WHERE company_name='Unit Test'`).Scan(&isin, &ticker, &active, &reserve); err != nil {
		t.Fatal(err)
	}
	if isin != "AU000000UNIT" || ticker != "UNIT" || active != 1 || reserve != 35 {
		t.Fatalf("lost identity or holding: %s %s %d %f", isin, ticker, active, reserve)
	}
	h["isin"], h["details"] = isin, "Renamed Unit"
	a["statement_date"] = "2026-09-03T00:00:00Z"
	importTestSend(t, p, 201)
	if err := db.QueryRow(`SELECT COUNT(*) FROM holdings WHERE is_active=1`).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 2 {
		t.Fatalf("active holdings %d", active)
	}
	before := importTestState(t)
	h["details"], h["isin"] = "External", ""
	importTestSend(t, p, 409)
	if !reflect.DeepEqual(before, importTestState(t)) {
		t.Fatal("external conflict changed state")
	}
	// An explicit all-cash IG book must not close the external position.
	p["holdings"], a["cash_aud"] = []interface{}{}, 1100
	a["statement_date"] = "2026-09-04T00:00:00Z"
	importTestSend(t, p, 201)
	var name string
	if err := db.QueryRow(`SELECT company_name FROM holdings WHERE is_active=1`).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "External" {
		t.Fatalf("remaining holding: %s", name)
	}
}

func TestStatementImportNativeFXAndZeroValueRights(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	p := importTestPayload()
	a := p["account"].(map[string]interface{})
	a["usd_value"], a["usd_aud"], a["gbp_value"], a["gbp_aud"] = 400, 600, 100, 200
	a["total_value_aud"] = 900.25 // within the fixed AUD rounding allowance
	p["holdings"] = []interface{}{
		map[string]interface{}{"details": "US Fund", "quantity": 10, "currency": "USD", "market_value_native": 400, "cost_native": 300},
		map[string]interface{}{"details": "UK Fund", "quantity": 10, "currency": "GBP", "market_value_native": 100},
		map[string]interface{}{"details": "Zero Rights", "quantity": 100, "currency": "AUD", "market_value_native": 0},
	}
	importTestSend(t, p, 201)
	var value, cost float64
	if err := db.QueryRow(`SELECT value_aud,cost_aud FROM holdings WHERE company_name='US Fund'`).Scan(&value, &cost); err != nil {
		t.Fatal(err)
	}
	if value != 600 || cost != 450 {
		t.Fatalf("FX: value %f cost %f", value, cost)
	}
}

func TestStatementImportSameDayCorrectionWaitsForNextDay(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO company_mappings (company_name,ticker,exchange_prefix) VALUES ('Unit Test','UNIT','ASX')`)
	p := importTestPayload()
	importTestSend(t, p, 201)
	alert := insertSecurityActionTestAlert(t, "ASX:UNIT", "SELL_50")
	id, _, _ := actionForAlertID(t, alert)
	if w := actionUnitsRecord(t, id, `{"units":50}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	a := p["account"].(map[string]interface{})
	h := p["holdings"].([]interface{})[0].(map[string]interface{})
	a["statement_date"], a["cash_aud"] = "2026-09-01T23:00:00Z", 600
	h["quantity"], h["value_aud"] = 50, 500
	importTestSend(t, p, 201)
	_, status, _ := actionForAlertID(t, alert)
	if status != securityActionAwaitingStatement {
		t.Fatalf("same-day action: %s", status)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM account_statements`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("same-day correction created %d statements", count)
	}
	a["statement_date"] = "2026-09-02T00:00:00Z"
	importTestSend(t, p, 201)
	_, status, _ = actionForAlertID(t, alert)
	if status != securityActionConfirmed {
		t.Fatalf("next-day action: %s", status)
	}
}

func TestStatementImportRollsBackEveryRequiredWrite(t *testing.T) {
	for _, target := range []struct{ table, operation string }{
		{"sync_changes", "INSERT"}, {"sync_history", "UPDATE"}, {"statement_holdings", "DELETE"}, {"statement_holdings", "INSERT"}, {"portfolio_daily_snapshots", "INSERT"}, {"statement_revisions", "INSERT"},
	} {
		t.Run(target.table+target.operation, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			p := importTestPayload()
			importTestSend(t, p, 201)
			before := importTestState(t)
			actionUnitsExec(t, fmt.Sprintf(`CREATE TRIGGER fail_import BEFORE %s ON %s BEGIN SELECT RAISE(ABORT,'injected import failure'); END`, target.operation, target.table))
			p["account"].(map[string]interface{})["cash_aud"] = 200
			p["holdings"].([]interface{})[0].(map[string]interface{})["value_aud"] = 900
			importTestSend(t, p, 500)
			if !reflect.DeepEqual(before, importTestState(t)) {
				t.Fatal("failed write partially committed")
			}
		})
	}
}

func TestStatementImportCorrectsLegacyDateKey(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	statementID := actionUnitsExec(t, `INSERT INTO account_statements (account_name,statement_date,total_value_aud,cash_aud) VALUES ('IG','2026-09-01',1100,1100)`)
	p := importTestPayload()
	p["account"].(map[string]interface{})["account_name"] = " ig "
	w := importTestSend(t, p, 201)
	var result struct {
		StatementID int64 `json:"statement_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM account_statements`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if result.StatementID != statementID || count != 1 {
		t.Fatalf("correction changed statement identity: %d %d", result.StatementID, count)
	}
}

func TestStatementImportRejectsDuplicateStableIdentity(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	for _, name := range []string{"Unit Test", "Same Security"} {
		actionUnitsExec(t, `INSERT INTO company_mappings (company_name,ticker,exchange_prefix) VALUES (?,'UNIT','ASX')`, name)
	}
	p := importTestPayload()
	importTestSend(t, p, 201)
	before := importTestState(t)
	p["holdings"] = append(p["holdings"].([]interface{}), map[string]interface{}{"details": "Same Security", "quantity": 1, "currency": "AUD", "value_aud": 0})
	importTestSend(t, p, 409)
	if !reflect.DeepEqual(before, importTestState(t)) {
		t.Fatal("duplicate identity modified book")
	}
}

func TestStatementImportExternalStableIdentityConflict(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	p := importTestPayload()
	importTestSend(t, p, 201)
	actionUnitsExec(t, `INSERT INTO stock_analysis (name,security_id,is_external) SELECT 'External Alias',security_id,1 FROM holdings WHERE company_name='Unit Test'`)
	before := importTestState(t)
	p["holdings"].([]interface{})[0].(map[string]interface{})["details"] = "Renamed External"
	importTestSend(t, p, 409)
	if !reflect.DeepEqual(before, importTestState(t)) {
		t.Fatal("external rename modified book")
	}
}

func TestStatementImportReadAndAdditionFailuresRollback(t *testing.T) {
	for _, failure := range []string{"scan", "mapping", "addition"} {
		t.Run(failure, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			p := importTestPayload()
			importTestSend(t, p, 201)
			switch failure {
			case "scan":
				actionUnitsExec(t, `UPDATE holdings SET quantity='invalid'`)
			case "mapping":
				actionUnitsExec(t, `DROP TABLE company_mappings`)
			case "addition":
				actionUnitsExec(t, `CREATE TRIGGER fail_add BEFORE INSERT ON sync_changes WHEN NEW.change_type='ADDED' BEGIN SELECT RAISE(ABORT,'injected addition failure'); END`)
				p["holdings"] = append(p["holdings"].([]interface{}), map[string]interface{}{"details": "New Rights", "quantity": 1, "currency": "AUD", "value_aud": 0})
			}
			before := importTestState(t)
			importTestSend(t, p, 500)
			if !reflect.DeepEqual(before, importTestState(t)) {
				t.Fatal("import failed without complete rollback")
			}
		})
	}
}
