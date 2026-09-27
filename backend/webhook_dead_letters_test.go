package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

func setupDeadLetterTestDB(t *testing.T) {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	// Every pooled connection to ":memory:" gets its OWN empty database; the
	// async dead-letter insert runs on a goroutine and may draw a fresh
	// connection. One connection = one shared in-memory DB.
	testDB.SetMaxOpenConns(1)

	_, err = testDB.Exec(`
		CREATE TABLE webhook_dead_letters (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			webhook_name TEXT NOT NULL,
			request_url TEXT NOT NULL DEFAULT '/',
			payload TEXT NOT NULL,
			error TEXT NOT NULL,
			http_status INTEGER NOT NULL DEFAULT 0,
			retry_count INTEGER NOT NULL DEFAULT 0,
			last_retried_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			resolved_at DATETIME,
			resolution TEXT CHECK(resolution IN ('retried','dismissed'))
		)`)
	if err != nil {
		t.Fatalf("create test table: %v", err)
	}

	db = testDB
	if err := initWebhookInbox(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db = previousDB
		testDB.Close()
	})
}

func deadLetterRouter() *mux.Router {
	router := mux.NewRouter()
	router.HandleFunc("/api/webhook-dead-letters", getWebhookDeadLetters).Methods("GET")
	router.HandleFunc("/api/webhook-dead-letters/{id}/retry", retryWebhookDeadLetterHandler).Methods("POST")
	router.HandleFunc("/api/webhook-dead-letters/{id}/dismiss", dismissWebhookDeadLetterHandler).Methods("POST")
	return router
}

func TestInsertRedactsSecret(t *testing.T) {
	setupDeadLetterTestDB(t)

	insertWebhookDeadLetter("tradingview", "/api/webhook/tradingview",
		[]byte(`{"ticker":"BHP","signal":"SELL","secret":"super-secret"}`), "boom", 500)

	var payload string
	if err := db.QueryRow(`SELECT payload FROM webhook_dead_letters`).Scan(&payload); err != nil {
		t.Fatalf("read payload: %v", err)
	}
	if strings.Contains(payload, "super-secret") || strings.Contains(payload, "secret") {
		t.Fatalf("secret not redacted from stored payload: %s", payload)
	}
	if !strings.Contains(payload, "BHP") || !strings.Contains(payload, "SELL") {
		t.Fatalf("payload content lost during redaction: %s", payload)
	}
}

func TestListUnresolvedAndCount(t *testing.T) {
	setupDeadLetterTestDB(t)

	insertWebhookDeadLetter("tradingview", "/", []byte(`{"a":1}`), "err one", 500)
	insertWebhookDeadLetter("regime", "/", []byte(`{"b":2}`), "err two", 422)
	if _, err := db.Exec(`UPDATE webhook_dead_letters SET resolved_at = CURRENT_TIMESTAMP, resolution = 'dismissed' WHERE webhook_name = 'regime'`); err != nil {
		t.Fatalf("resolve row: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/webhook-dead-letters", nil)
	rec := httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		DeadLetters     []WebhookDeadLetter `json:"dead_letters"`
		UnresolvedCount int                 `json:"unresolved_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.DeadLetters) != 1 || resp.UnresolvedCount != 1 {
		t.Fatalf("expected 1 unresolved row, got %d rows count=%d", len(resp.DeadLetters), resp.UnresolvedCount)
	}
	if resp.DeadLetters[0].WebhookName != "tradingview" {
		t.Fatalf("unexpected row: %+v", resp.DeadLetters[0])
	}

	// include_resolved=true returns both
	req = httptest.NewRequest(http.MethodGet, "/api/webhook-dead-letters?include_resolved=true", nil)
	rec = httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(rec, req)
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.DeadLetters) != 2 {
		t.Fatalf("expected 2 rows with include_resolved, got %d", len(resp.DeadLetters))
	}
}

func TestRetrySuccessResolvesRow(t *testing.T) {
	setupDeadLetterTestDB(t)

	var receivedBody string
	prev := webhookProcessors
	webhookProcessors = map[string]func(http.ResponseWriter, *http.Request){
		"tradingview": func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			receivedBody = string(body)
			w.WriteHeader(http.StatusOK)
		},
	}
	t.Cleanup(func() { webhookProcessors = prev })

	insertWebhookDeadLetter("tradingview", "/api/webhook/tradingview", []byte(`{"ticker":"BHP"}`), "first failure", 500)

	req := httptest.NewRequest(http.MethodPost, "/api/webhook-dead-letters/1/retry", nil)
	rec := httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if receivedBody != `{"ticker":"BHP"}` {
		t.Fatalf("processor did not receive stored payload: %q", receivedBody)
	}

	var resolution string
	var retryCount int
	if err := db.QueryRow(`SELECT resolution, retry_count FROM webhook_dead_letters WHERE id = 1`).Scan(&resolution, &retryCount); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if resolution != "retried" || retryCount != 1 {
		t.Fatalf("expected resolution=retried retry_count=1, got %s/%d", resolution, retryCount)
	}
}

func TestRetryFailureKeepsRowAndRecordsError(t *testing.T) {
	setupDeadLetterTestDB(t)

	prev := webhookProcessors
	webhookProcessors = map[string]func(http.ResponseWriter, *http.Request){
		"tradingview": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "still broken", http.StatusInternalServerError)
		},
	}
	t.Cleanup(func() { webhookProcessors = prev })

	insertWebhookDeadLetter("tradingview", "/", []byte(`{"ticker":"BHP"}`), "first failure", 500)

	req := httptest.NewRequest(http.MethodPost, "/api/webhook-dead-letters/1/retry", nil)
	rec := httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", rec.Code)
	}

	var resolvedAt *string
	var errMsg string
	var retryCount int
	if err := db.QueryRow(`SELECT resolved_at, error, retry_count FROM webhook_dead_letters WHERE id = 1`).Scan(&resolvedAt, &errMsg, &retryCount); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if resolvedAt != nil {
		t.Fatal("failed retry must not resolve the row")
	}
	if errMsg != "still broken" || retryCount != 1 {
		t.Fatalf("expected updated error and retry_count=1, got %q/%d", errMsg, retryCount)
	}
}

func TestRetryUnknownProcessorRejected(t *testing.T) {
	setupDeadLetterTestDB(t)

	insertWebhookDeadLetter("nonexistent", "/", []byte(`{}`), "boom", 500)
	req := httptest.NewRequest(http.MethodPost, "/api/webhook-dead-letters/1/retry", nil)
	rec := httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for unknown processor, got %d", rec.Code)
	}
}

func TestDismiss(t *testing.T) {
	setupDeadLetterTestDB(t)

	insertWebhookDeadLetter("tradingview", "/", []byte(`{}`), "boom", 500)

	req := httptest.NewRequest(http.MethodPost, "/api/webhook-dead-letters/1/dismiss", nil)
	rec := httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	// Second dismiss is a 404 (already resolved).
	req = httptest.NewRequest(http.MethodPost, "/api/webhook-dead-letters/1/dismiss", nil)
	rec = httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on double dismiss, got %d", rec.Code)
	}
}

func TestAsyncFailureCapturedAsDeadLetter(t *testing.T) {
	setupDeadLetterTestDB(t)

	failingProcessor := func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "processing exploded", http.StatusInternalServerError)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/webhook/tradingview",
		strings.NewReader(`{"ticker":"BHP","signal":"SELL","secret":"shh"}`))
	rec := httptest.NewRecorder()

	previous := webhookProcessors["tradingview"]
	webhookProcessors["tradingview"] = failingProcessor
	t.Cleanup(func() { webhookProcessors["tradingview"] = previous })
	acknowledgeAndProcessWebhook(rec, req, "tradingview")
	if _, err := processNextWebhook(time.Now()); err != nil {
		t.Fatal(err)
	}

	// ACK must still be 200 (TradingView contract).
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 ACK, got %d", rec.Code)
	}

	// Insert happens after the processor returns; poll briefly.
	var count int
	var payload, errMsg string
	for i := 0; i < 50; i++ {
		_ = db.QueryRow(`SELECT COUNT(*) FROM webhook_dead_letters`).Scan(&count)
		if count > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if count != 1 {
		t.Fatalf("expected 1 dead letter captured, got %d", count)
	}
	if err := db.QueryRow(`SELECT payload, error FROM webhook_dead_letters`).Scan(&payload, &errMsg); err != nil {
		t.Fatalf("read dead letter: %v", err)
	}
	if strings.Contains(payload, "shh") {
		t.Fatalf("secret leaked into dead letter payload: %s", payload)
	}
	if !strings.Contains(errMsg, "processing exploded") {
		t.Fatalf("error not captured: %q", errMsg)
	}
}
