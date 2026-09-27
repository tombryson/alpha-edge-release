package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func seedAnnouncementSecurity(t *testing.T, ticker, name string, held bool) int64 {
	t.Helper()
	id := exchangeSQL(t, `INSERT INTO stock_analysis(ticker,name,is_watchlist,include_in_sizing) VALUES(?,?,1,0)`, ticker, name)
	securityID, err := ensureAnalysisSecurityIdentity(int(id), ticker, name, "test")
	if err != nil {
		t.Fatal(err)
	}
	if held {
		prefix, symbol := splitSecurityTicker("", ticker)
		exchangeSQL(t, `INSERT INTO holdings(company_name,ticker,exchange_prefix,security_id,quantity,value_aud) VALUES(?,?,?,?,10,100)`, name, symbol, prefix, securityID)
	}
	return securityID
}

func announcementRows(t *testing.T) []announcementSubscription {
	t.Helper()
	w := httptest.NewRecorder()
	getAnnouncementSubscriptions(w, httptest.NewRequest("GET", "/api/announcement-subscriptions", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result struct{ Items []announcementSubscription }
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Items
}

func announcementPatch(t *testing.T, updates []map[string]any, status int) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"items": updates})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	updateAnnouncementSubscriptions(w, httptest.NewRequest("PATCH", "/api/announcement-subscriptions", bytes.NewReader(body)))
	if w.Code != status {
		t.Fatalf("expected %d got %d: %s", status, w.Code, w.Body.String())
	}
}

func announcementUpdate(row announcementSubscription, configured bool) map[string]any {
	return map[string]any{"kind": row.Kind, "id": row.ID, "ticker": row.Ticker, "exchange_prefix": row.ExchangePrefix,
		"provider": "HOTCOPPER", "configured": configured}
}

func TestAnnouncementSubscriptionsUniverseAndBulkConfirmation(t *testing.T) {
	defer setupAnalysisTestDB(t)()
	gold := seedAnnouncementSecurity(t, "ASX:GOLD", "Gold Fund", true)
	seedAnnouncementSecurity(t, "NASDAQ:AAPL", "Apple", false)
	seedAnnouncementSecurity(t, "ASX:RIGHT", "Entitlement", true)
	exchangeSQL(t, `UPDATE stock_analysis SET security_type='NON_ALLOCATING' WHERE ticker='ASX:RIGHT'`)
	exchangeSQL(t, `INSERT INTO holdings(company_name,ticker,exchange_prefix,quantity,value_aud) VALUES('New broker stock','NEW','ASX:',2,20)`)
	rows := announcementRows(t)
	if len(rows) != 3 {
		t.Fatalf("expected held/watchlist/imported without duplicate or excluded: %+v", rows)
	}
	updates := []map[string]any{}
	for _, row := range rows {
		if row.Configured || row.ConfirmedAt != "" || row.Provider != "" {
			t.Fatalf("invented prior subscription: %+v", row)
		}
		update := announcementUpdate(row, true)
		if row.ExchangePrefix == "NASDAQ:" {
			update["provider"] = "SEEKING_ALPHA"
		}
		updates = append(updates, update)
	}
	announcementPatch(t, updates, 200)
	confirmed := announcementRows(t)
	for _, row := range confirmed {
		if !row.Configured || row.ConfirmedAt == "" || row.SecurityID == 0 {
			t.Fatalf("not persisted: %+v", row)
		}
	}
	// Import replaces a holding row, but the stable security retains confirmation.
	exchangeSQL(t, `DELETE FROM holdings WHERE security_id=?`, gold)
	exchangeSQL(t, `INSERT INTO holdings(company_name,ticker,exchange_prefix,security_id,quantity,value_aud) VALUES('Gold Fund renamed','GOLD','ASX:',?,8,80)`, gold)
	initDB()
	for _, row := range announcementRows(t) {
		if !row.Configured {
			t.Fatalf("restart/import lost confirmation: %+v", row)
		}
	}
	var alertCount int
	if err := db.QueryRow(`SELECT count(*) FROM alerts`).Scan(&alertCount); err != nil || alertCount != 0 {
		t.Fatalf("setup created trade alerts: %d %v", alertCount, err)
	}
}

func TestAnnouncementSubscriptionsIdentityChangeResetAndAtomicConflict(t *testing.T) {
	defer setupAnalysisTestDB(t)()
	seedAnnouncementSecurity(t, "ASX:AAA", "Alpha", false)
	seedAnnouncementSecurity(t, "ASX:BBB", "Beta", false)
	rows := announcementRows(t)
	announcementPatch(t, []map[string]any{announcementUpdate(rows[0], true), announcementUpdate(rows[1], true)}, 200)
	first := announcementRows(t)[0]
	announcementPatch(t, []map[string]any{announcementUpdate(first, true)}, 200)
	if announcementRows(t)[0].ConfirmedAt != first.ConfirmedAt {
		t.Fatal("repeat confirmation changed evidence date")
	}
	exchangeSQL(t, `UPDATE stock_analysis SET ticker='ASX:BBB2' WHERE name='Beta'`)
	rows = announcementRows(t)
	if rows[1].Configured || !rows[1].NeedsRecheck {
		t.Fatal("changed ticker retained confirmation")
	}
	bad := announcementUpdate(rows[1], true)
	bad["ticker"] = "BBB"
	announcementPatch(t, []map[string]any{announcementUpdate(rows[0], false), bad}, 409)
	if !announcementRows(t)[0].Configured {
		t.Fatal("conflicting batch partially saved")
	}
	announcementPatch(t, []map[string]any{announcementUpdate(rows[1], true)}, 200)
	announcementPatch(t, []map[string]any{announcementUpdate(rows[0], false)}, 200)
	rows = announcementRows(t)
	if rows[0].Configured || rows[0].ConfirmedAt != "" || rows[0].Provider != "HOTCOPPER" || !rows[1].Configured {
		t.Fatalf("reset/reconfirmation failed: %+v", rows)
	}
	exchangeSQL(t, `UPDATE stock_analysis SET ticker='NYSE:BBB2' WHERE name='Beta'`)
	if row := announcementRows(t)[1]; row.Configured || !row.NeedsRecheck {
		t.Fatal("exchange change retained confirmation")
	}
}

func TestAnnouncementSubscriptionsValidationAndReadOnlyProjection(t *testing.T) {
	defer setupAnalysisTestDB(t)()
	seedAnnouncementSecurity(t, "MISSING", "Missing exchange", false)
	row := announcementRows(t)[0]
	announcementPatch(t, []map[string]any{announcementUpdate(row, true)}, 400)
	bad := announcementUpdate(row, false)
	bad["provider"] = "INVALID"
	announcementPatch(t, []map[string]any{bad}, 400)
	bad = announcementUpdate(row, false)
	delete(bad, "configured")
	announcementPatch(t, []map[string]any{bad}, 400)
	update := announcementUpdate(row, false)
	announcementPatch(t, []map[string]any{update, update}, 400)
	announcementPatch(t, nil, 400)
	var before, after int
	if err := db.QueryRow("SELECT total_changes()").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := readAnnouncementSubscriptions(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT total_changes()").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("GET mutated the database")
	}
	w := httptest.NewRecorder()
	updateAnnouncementSubscriptions(w, httptest.NewRequest(http.MethodPatch, "/api/announcement-subscriptions", bytes.NewBufferString(`{"items":[]} {}`)))
	if w.Code != 400 {
		t.Fatal("accepted invalid payload")
	}
}

func TestAnnouncementSubscriptionsResolveUnlinkedCopiesAndRequireAuth(t *testing.T) {
	defer setupAnalysisTestDB(t)()
	seedAnnouncementSecurity(t, "ASX:AAA", "Alpha", false)
	exchangeSQL(t, `INSERT INTO holdings(company_name,ticker,exchange_prefix,quantity,value_aud) VALUES('Alpha','AAA','ASX:',10,100)`)
	rows := announcementRows(t)
	if len(rows) != 1 || rows[0].SecurityID == 0 || rows[0].Kind != "holding" {
		t.Fatalf("unlinked holding did not resolve to analysis identity: %+v", rows)
	}
	announcementPatch(t, []map[string]any{announcementUpdate(rows[0], true)}, 200)
	if rows = announcementRows(t); len(rows) != 1 || !rows[0].Configured {
		t.Fatalf("duplicate or missing saved setup: %+v", rows)
	}
	setTestAuth(t, "announcement-test-token", "test-secret", false)
	router := newRouter()
	for _, method := range []string{"GET", "PATCH"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(method, "/api/announcement-subscriptions", nil))
		if w.Code != 401 {
			t.Fatalf("%s accepted unauthenticated access: %d", method, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "/api/announcement-subscriptions", nil)
	r.Header.Set("Authorization", "Bearer announcement-test-token")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}
