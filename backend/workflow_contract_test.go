package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Exercise the authenticated router, durable inbox and real SQLite read models.
// Only the external sender and broker are simulated; no live services are called.
func TestWorkflowContractSignalExecutionRestartAndCorrectedStatement(t *testing.T) {
	original := db
	path := filepath.Join(t.TempDir(), "workflow.db")
	open := func() {
		var err error
		db, err = sql.Open("sqlite3", path+"?_busy_timeout=15000&_journal_mode=WAL&_synchronous=FULL")
		if err != nil {
			t.Fatal(err)
		}
		initDB()
	}
	open()
	t.Cleanup(func() { db.Close(); db = original })
	setTestAuth(t, "workflow-token", "workflow-secret", false)
	router := newRouter()
	var captures []map[string]interface{}
	t.Cleanup(func() {
		if directory := os.Getenv("ALPHA_EDGE_CONTRACT_CAPTURE_DIR"); directory != "" {
			raw, err := json.Marshal(captures)
			if err != nil {
				t.Error(err)
				return
			}
			if err := os.WriteFile(filepath.Join(directory, "workflow.json"), raw, 0600); err != nil {
				t.Error(err)
			}
		}
	})
	request := func(method, path string, body interface{}, code int) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer workflow-token")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != code {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, w.Code, code, w.Body.String())
		}
		captures = append(captures, map[string]interface{}{"method": method, "path": path, "request": json.RawMessage(raw), "status": w.Code, "content_type": w.Header().Get("Content-Type"), "response": w.Body.String()})
		return w
	}
	restart := func() {
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
		open()
		router = newRouter()
	}
	seedDeploymentPermissions(t)
	actionUnitsExec(t, `UPDATE asset_class_config SET cash_reserve=500 WHERE code='GOLD_MINERS'`)
	actionUnitsExec(t, `INSERT INTO company_mappings(company_name,ticker,exchange_prefix) VALUES ('Unit Test','UNIT','ASX')`)
	payload := importTestPayload()
	payload["account"].(map[string]interface{})["cash_aud"] = 500
	payload["account"].(map[string]interface{})["total_value_aud"] = 1500
	request("POST", "/api/statements/import", payload, 201)
	request("GET", "/api/backup-status", nil, 200)
	request("GET", "/api/statements/1/revisions", nil, 200)
	request("GET", "/api/statements/1/revisions/1", nil, 200)
	actionUnitsExec(t, `INSERT INTO stock_analysis(name,ticker,primary_asset_class,include_in_sizing,security_type,allocation) VALUES ('Unit Test','ASX:UNIT','GOLD_MINERS',1,'STOCK',100)`)
	seedDeploymentSecurityFeeds(t, "ASX:UNIT")
	signal := map[string]interface{}{"event_id": "workflow-enter", "ticker": "ASX:UNIT", "script": "tms", "signal": "ADD", "timeframe": "1D", "price": 10}
	ack := request("POST", "/api/webhook/tradingview", signal, 200)
	var receipt struct {
		ID        int64 `json:"receipt_id"`
		Duplicate bool  `json:"duplicate"`
	}
	if err := json.Unmarshal(ack.Body.Bytes(), &receipt); err != nil || receipt.ID == 0 || receipt.Duplicate {
		t.Fatal(ack.Body.String())
	}
	if inboxTestStatus(t, receipt.ID) != "PENDING" {
		t.Fatal("ack must precede processing")
	}
	restart()
	if worked, err := processNextWebhook(time.Now()); !worked || err != nil {
		t.Fatal(worked, err)
	}
	if inboxTestStatus(t, receipt.ID) != "PROCESSED" {
		t.Fatal("pending receipt not processed after restart")
	}
	duplicate := request("POST", "/api/webhook/tradingview", signal, 200)
	var repeat struct {
		ID        int64 `json:"receipt_id"`
		Duplicate bool  `json:"duplicate"`
	}
	if err := json.Unmarshal(duplicate.Body.Bytes(), &repeat); err != nil {
		t.Fatal(err)
	}
	if repeat.ID != receipt.ID || !repeat.Duplicate {
		t.Fatal("duplicate produced a new receipt")
	}
	conflictingSignal := map[string]interface{}{"event_id": "workflow-enter", "ticker": "ASX:UNIT", "script": "tms", "signal": "SELL", "timeframe": "1D", "price": 10}
	request("POST", "/api/webhook/tradingview", conflictingSignal, 409)
	list := request("GET", "/api/security-actions?ticker=UNIT&includeHistory=true", nil, 200)
	var actions []SecurityAction
	if err := json.Unmarshal(list.Body.Bytes(), &actions); err != nil || len(actions) != 1 {
		t.Fatal(list.Body.String())
	}
	action := actions[0]
	if action.DeploymentState != deploymentStateFunded || action.InstructionValue <= 0 {
		t.Fatalf("not permitted: %+v", action)
	}
	executionPath := fmt.Sprintf("/api/security-actions/%d/record-execution", action.ID)
	request("POST", executionPath, map[string]interface{}{"units": 0}, 400)
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active=1 WHERE id=1`)
	request("POST", executionPath, map[string]interface{}{"units": 10}, 409)
	actionUnitsExec(t, `UPDATE q4_crisis_state SET active=0 WHERE id=1`)
	request("POST", executionPath, map[string]interface{}{"units": 10, "notes": "broker fill"}, 200)
	request("POST", executionPath, map[string]interface{}{"units": 10}, 409)
	assertStatus := func(want string) {
		t.Helper()
		w := request("GET", "/api/security-actions?ticker=UNIT&includeHistory=true", nil, 200)
		var rows []SecurityAction
		if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil || len(rows) != 1 || rows[0].Status != want {
			t.Fatalf("want %s: %s", want, w.Body.String())
		}
	}
	assertStatus(securityActionAwaitingStatement)
	var originalSnapshot string
	if err := db.QueryRow(`SELECT execution_snapshot_json FROM security_actions WHERE id=?`, action.ID).Scan(&originalSnapshot); err != nil {
		t.Fatal(err)
	}
	var before float64
	if err := db.QueryRow(`SELECT quantity FROM holdings WHERE ticker='UNIT'`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if before != 100 {
		t.Fatal("recording execution changed broker holdings")
	}
	restart()
	assertStatus(securityActionAwaitingStatement)
	account := payload["account"].(map[string]interface{})
	holding := payload["holdings"].([]interface{})[0].(map[string]interface{})
	// Correcting the execution-day book is not next-day evidence.
	account["cash_aud"], holding["quantity"], holding["value_aud"] = 400, 110, 1100
	request("POST", "/api/statements/import", payload, 201)
	assertStatus(securityActionAwaitingStatement)
	account["statement_date"] = "2026-09-02T00:00:00Z"
	request("POST", "/api/statements/import", payload, 201)
	assertStatus(securityActionConfirmed)
	account["total_value_aud"] = 9000
	request("POST", "/api/statements/import", payload, 400)
	assertStatus(securityActionConfirmed)
	account["total_value_aud"] = 1500
	// A corrected matching statement must invalidate confirmation if units disappear.
	account["cash_aud"], holding["quantity"], holding["value_aud"] = 500, 100, 1000
	request("POST", "/api/statements/import", payload, 201)
	assertStatus(securityActionVariance)
	restart()
	assertStatus(securityActionVariance)
	account["cash_aud"], holding["quantity"], holding["value_aud"] = 400, 110, 1100
	request("POST", "/api/statements/import", payload, 201)
	assertStatus(securityActionConfirmed)
	request("POST", "/api/statements/import", payload, 201)
	assertStatus(securityActionConfirmed)
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM decisions WHERE alert_id=?`, action.AlertID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("%d decisions for one execution", count)
	}
	var finalSnapshot string
	if err := db.QueryRow(`SELECT execution_snapshot_json FROM security_actions WHERE id=?`, action.ID).Scan(&finalSnapshot); err != nil || finalSnapshot != originalSnapshot {
		t.Fatalf("correction changed execution baseline: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM account_statements`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("corrections created another statement day: count=%d, error=%v", count, err)
	}
	request("POST", "/api/webhook/tradingview", signal, 200)
	assertStatus(securityActionConfirmed)
	request("GET", "/api/data-freshness", nil, 200)
	request("GET", "/api/weight-policy", nil, 200)
	request("PATCH", "/api/weight-policy", map[string]interface{}{"enabled": true, "epoch": 0}, 200)
	request("PATCH", "/api/weight-policy", map[string]interface{}{"enabled": false, "epoch": 0}, 409)
	request("PATCH", "/api/weight-policy", map[string]interface{}{"enabled": false, "epoch": 1}, 200)
	assertStatus(securityActionConfirmed)
	seedWatchlistCandidate(t, "ASX:WATCH")
	request("GET", "/api/watchlist/opportunities", nil, 200)
}
