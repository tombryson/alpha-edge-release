package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func TestStatementRevisionReadsAreProtectedAndBounded(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	setTestAuth(t, "revision-token", "revision-secret", false)
	router := newRouter()
	for _, path := range []string{"/api/backup-status", "/api/statements/1/revisions", "/api/statements/1/revisions/1"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatalf("unprotected read %s: %d", path, w.Code)
		}
	}
	importTestSend(t, importTestPayload(), 201)
	actionUnitsExec(t, `WITH RECURSIVE n(x) AS (VALUES(2) UNION ALL SELECT x+1 FROM n WHERE x<105)
		INSERT INTO statement_revisions(statement_id,revision,source,snapshot_json)
		SELECT 1,x,'import','{}' FROM n`)
	for _, page := range []struct{ before, count, first int }{{0, 100, 105}, {6, 5, 5}} {
		path := "/api/statements/1/revisions"
		if page.before > 0 {
			path += fmt.Sprintf("?before=%d", page.before)
		}
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer revision-token")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		var body struct{ Revisions []struct{ Revision int } }
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &body) != nil || len(body.Revisions) != page.count || body.Revisions[0].Revision != page.first {
			t.Fatalf("bad revision page: %s", w.Body.String())
		}
	}
}

func TestStatementRevisionsPreserveCorrectionsAndDeduplicateRepeat(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO company_mappings(company_name,ticker,exchange_prefix) VALUES('Unit Test','UNIT','ASX')`)
	p := importTestPayload()
	var first struct {
		StatementID int64 `json:"statement_id"`
		RevisionID  int64 `json:"revision_id"`
	}
	if err := json.Unmarshal(importTestSend(t, p, 201).Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	importTestSend(t, p, 201)
	p["account"].(map[string]interface{})["cash_aud"] = 200
	p["holdings"].([]interface{})[0].(map[string]interface{})["value_aud"] = 900
	importTestSend(t, p, 201)
	var count int
	var original, current float64
	if err := db.QueryRow(`SELECT COUNT(*) FROM statement_revisions`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT json_extract(snapshot_json, '$.holdings[0].value_aud') FROM statement_revisions WHERE id = ?`, first.RevisionID).Scan(&original); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT value_aud FROM statement_holdings WHERE statement_id = ?`, first.StatementID).Scan(&current); err != nil {
		t.Fatal(err)
	}
	if count != 2 || original != 1000 || current != 900 {
		t.Fatalf("evidence/projection mismatch: %d %v %v", count, original, current)
	}
	actionUnitsExec(t, `UPDATE security_identities SET ticker='RENAMED' WHERE ticker='UNIT'`)
	var originalTicker string
	if err := db.QueryRow(`SELECT json_extract(snapshot_json,'$.holdings[0].ticker') FROM statement_revisions WHERE id=?`, first.RevisionID).Scan(&originalTicker); err != nil || originalTicker != "UNIT" {
		t.Fatalf("historical identity changed with live mapping: %q %v", originalTicker, err)
	}
	for _, query := range []string{`UPDATE statement_revisions SET source='legacy_snapshot'`, `DELETE FROM statement_revisions`} {
		if _, err := db.Exec(query); err == nil {
			t.Fatalf("immutable evidence allowed %s", query)
		}
	}
	request := mux.SetURLVars(httptest.NewRequest("GET", "/", nil), map[string]string{"id": "1", "revision": "1"})
	response := httptest.NewRecorder()
	getStatementRevision(response, request)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var detail struct {
		Source   string
		Accepted json.RawMessage `json:"accepted_payload"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil || detail.Source != "import" || len(detail.Accepted) == 0 {
		t.Fatalf("bad revision detail: %s", response.Body.String())
	}
}

func TestLegacyStatementRevisionIsExplicitlySnapshot(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	actionUnitsExec(t, `INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud) VALUES ('IG','2026-09-01',1100,1100)`)
	importTestSend(t, importTestPayload(), 201)
	var source string
	var noPayload bool
	var oldCash float64
	if err := db.QueryRow(`SELECT source, accepted_payload_json IS NULL, json_extract(snapshot_json, '$.account.cash_aud') FROM statement_revisions WHERE revision = 1`).Scan(&source, &noPayload, &oldCash); err != nil {
		t.Fatal(err)
	}
	if source != "legacy_snapshot" || !noPayload || oldCash != 1100 {
		t.Fatalf("legacy evidence misrepresented: %s %v %v", source, noPayload, oldCash)
	}
}
