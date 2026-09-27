package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func inboxTestProcessor(t *testing.T, processor func(http.ResponseWriter, *http.Request)) {
	t.Helper()
	prior := webhookProcessors["tradingview"]
	webhookProcessors["tradingview"] = processor
	t.Cleanup(func() { webhookProcessors["tradingview"] = prior })
}

func inboxTestEnqueue(t *testing.T, payload string, now time.Time) int64 {
	t.Helper()
	id, _, status, err := enqueueWebhook("tradingview", "/api/webhook/tradingview", []byte(payload), now)
	if err != nil {
		t.Fatalf("enqueue %d: %v", status, err)
	}
	return id
}

func inboxTestStatus(t *testing.T, id int64) string {
	t.Helper()
	var status string
	if err := db.QueryRow(`SELECT status FROM webhook_inbox WHERE id=?`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func TestWebhookInboxPersistsBeforeAcknowledging(t *testing.T) {
	setupDeadLetterTestDB(t)
	calls := 0
	inboxTestProcessor(t, func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(200) })
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/webhook/tradingview?secret=url-secret", strings.NewReader(`{"event_id":"one","ticker":"UNIT","secret":"body-secret"}`))
	r.Header.Set("Authorization", "Bearer header-secret")
	acknowledgeAndProcessWebhook(w, r, "tradingview")
	var response struct {
		ReceiptID int64 `json:"receipt_id"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil || response.ReceiptID == 0 {
		t.Fatal(w.Code, w.Body.String())
	}
	if calls != 0 || inboxTestStatus(t, response.ReceiptID) != "PENDING" {
		t.Fatal("processing started before durable acceptance")
	}
	var path, payload string
	if err := db.QueryRow(`SELECT request_path,payload FROM webhook_inbox`).Scan(&path, &payload); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(path+payload, "secret") || strings.Contains(path, "?") {
		t.Fatal("credentials persisted")
	}
	if worked, err := processNextWebhook(time.Now()); !worked || err != nil {
		t.Fatal(worked, err)
	}
	if calls != 1 || inboxTestStatus(t, response.ReceiptID) != "PROCESSED" {
		t.Fatal("pending receipt did not resume")
	}
}

func TestWebhookInboxReopensPersistedPendingReceipt(t *testing.T) {
	setupDeadLetterTestDB(t)
	inboxTestProcessor(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	id := inboxTestEnqueue(t, `{"event_id":"restart"}`, time.Now())
	path := filepath.Join(t.TempDir(), "restart.db")
	if _, err := db.Exec(`VACUUM INTO ?`, path); err != nil {
		t.Fatal(err)
	}
	prior := db
	reopened, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	db = reopened
	defer func() { db = prior; reopened.Close() }()
	if err := initWebhookInbox(); err != nil {
		t.Fatal(err)
	}
	if _, err := processNextWebhook(time.Now()); err != nil {
		t.Fatal(err)
	}
	if inboxTestStatus(t, id) != "PROCESSED" {
		t.Fatal("durable pending work did not resume")
	}
}

func TestWebhookInboxStorageFailureDoesNotAcknowledge(t *testing.T) {
	setupDeadLetterTestDB(t)
	if _, err := db.Exec(`CREATE TRIGGER fail_inbox BEFORE INSERT ON webhook_inbox BEGIN SELECT RAISE(ABORT,'unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	acknowledgeAndProcessWebhook(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"ticker":"UNIT"}`)), "tradingview")
	if w.Code != 503 {
		t.Fatalf("accepted without persistence: %d", w.Code)
	}
	for _, body := range []string{`null`, `{}`, `{} {}`, `[]`} {
		w = httptest.NewRecorder()
		acknowledgeAndProcessWebhook(w, httptest.NewRequest("POST", "/", strings.NewReader(body)), "tradingview")
		if body == `{}` {
			if w.Code != 503 {
				t.Fatal(w.Code)
			}
		} else if w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
}

func TestWebhookInboxDuplicatesAndLegacyRepeat(t *testing.T) {
	setupDeadLetterTestDB(t)
	now := time.Now()
	first := inboxTestEnqueue(t, `{"event_id":"one","signal":"BUY","secret":"a"}`, now)
	id, duplicate, _, err := enqueueWebhook("tradingview", "/", []byte(`{"signal":"BUY","secret":"b","event_id":"one"}`), now.Add(time.Hour))
	if err != nil || !duplicate || id != first {
		t.Fatal(id, duplicate, err)
	}
	_, _, status, err := enqueueWebhook("tradingview", "/", []byte(`{"event_id":"one","signal":"SELL"}`), now)
	if status != 409 || err == nil {
		t.Fatal("reused event identity accepted")
	}
	legacy := inboxTestEnqueue(t, `{"ticker":"UNIT","signal":"SELL"}`, now)
	id, duplicate, _, err = enqueueWebhook("tradingview", "/", []byte(`{"signal":"SELL","ticker":"UNIT"}`), now.Add(30*time.Second))
	if err != nil || !duplicate || id != legacy {
		t.Fatal("burst not deduplicated")
	}
	id = inboxTestEnqueue(t, `{"ticker":"UNIT","signal":"SELL"}`, now.Add(2*time.Minute))
	if id == legacy {
		t.Fatal("legitimate later legacy signal suppressed")
	}
	inboxTestEnqueue(t, `{"ticker":"UNIT","signal":"BUY"}`, now.Add(121*time.Second))
	returned := inboxTestEnqueue(t, `{"ticker":"UNIT","signal":"SELL"}`, now.Add(122*time.Second))
	if returned == id {
		t.Fatal("SELL after intervening BUY incorrectly suppressed")
	}
}

func TestWebhookInboxConcurrentDeliveryCreatesOneReceipt(t *testing.T) {
	setupDeadLetterTestDB(t)
	var wg sync.WaitGroup
	errors := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _, err := enqueueWebhook("tradingview", "/", []byte(`{"event_id":"concurrent"}`), time.Now())
			errors <- err
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM webhook_inbox`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal(count)
	}
}

func TestWebhookInboxInterruptedProcessingNeedsReview(t *testing.T) {
	setupDeadLetterTestDB(t)
	calls := 0
	inboxTestProcessor(t, func(w http.ResponseWriter, r *http.Request) { calls++ })
	id := inboxTestEnqueue(t, `{"event_id":"interrupted"}`, time.Now())
	if _, err := db.Exec(`UPDATE webhook_inbox SET status='PROCESSING' WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := processNextWebhook(time.Now()); err != nil {
		t.Fatal(err)
	}
	if calls != 0 || inboxTestStatus(t, id) != "FAILED" {
		t.Fatal("uncertain processing blindly replayed")
	}
	var message string
	if err := db.QueryRow(`SELECT error FROM webhook_dead_letters`).Scan(&message); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(message, "some effects may already exist") {
		t.Fatal(message)
	}
}

func TestWebhookInboxCompletionWriteFailureDoesNotReexecute(t *testing.T) {
	setupDeadLetterTestDB(t)
	calls := 0
	inboxTestProcessor(t, func(w http.ResponseWriter, r *http.Request) { calls++ })
	id := inboxTestEnqueue(t, `{"event_id":"completion"}`, time.Now())
	if _, err := db.Exec(`CREATE TRIGGER fail_completion BEFORE UPDATE ON webhook_inbox WHEN NEW.status='PROCESSED' BEGIN SELECT RAISE(ABORT,'completion failed'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := processNextWebhook(time.Now()); err == nil {
		t.Fatal("write error swallowed")
	}
	if _, err := processNextWebhook(time.Now()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || inboxTestStatus(t, id) != "FAILED" {
		t.Fatal("already executed processor replayed")
	}
}

func TestWebhookInboxRetryAndDismissUseExistingUI(t *testing.T) {
	setupDeadLetterTestDB(t)
	calls := 0
	inboxTestProcessor(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			http.Error(w, "retry me", 500)
		}
	})
	id := inboxTestEnqueue(t, `{"event_id":"retry"}`, time.Now())
	if _, err := processNextWebhook(time.Now()); err != nil {
		t.Fatal(err)
	}
	var deadID int64
	if err := db.QueryRow(`SELECT dead_letter_id FROM webhook_inbox WHERE id=?`, id).Scan(&deadID); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(w, httptest.NewRequest("POST", fmt.Sprintf("/api/webhook-dead-letters/%d/retry", deadID), nil))
	if w.Code != 200 || calls != 2 || inboxTestStatus(t, id) != "PROCESSED" {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(w, httptest.NewRequest("POST", fmt.Sprintf("/api/webhook-dead-letters/%d/retry", deadID), nil))
	if w.Code != 404 || calls != 2 {
		t.Fatal("resolved receipt replayed")
	}
	inboxTestProcessor(t, func(w http.ResponseWriter, r *http.Request) { panic("test panic") })
	id = inboxTestEnqueue(t, `{"event_id":"panic"}`, time.Now())
	if _, err := processNextWebhook(time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT dead_letter_id FROM webhook_inbox WHERE id=?`, id).Scan(&deadID); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	deadLetterRouter().ServeHTTP(w, httptest.NewRequest("POST", fmt.Sprintf("/api/webhook-dead-letters/%d/dismiss", deadID), nil))
	if w.Code != 200 || inboxTestStatus(t, id) != "DISMISSED" {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestWebhookInboxStaleAndOutOfOrderEventsDoNotExecute(t *testing.T) {
	setupDeadLetterTestDB(t)
	now := time.Now()
	calls := 0
	inboxTestProcessor(t, func(w http.ResponseWriter, r *http.Request) { calls++ })
	newer := fmt.Sprintf(`{"ticker":"UNIT","script":"cdf","bar_closed_at":%q,"signal":"BUY"}`, now.Add(-time.Hour).UTC().Format(time.RFC3339))
	inboxTestEnqueue(t, newer, now)
	if _, err := processNextWebhook(now); err != nil {
		t.Fatal(err)
	}
	for _, age := range []time.Duration{2 * time.Hour, 48 * time.Hour} {
		payload := fmt.Sprintf(`{"ticker":"UNIT","script":"cdf","bar_closed_at":%q,"signal":"SELL"}`, now.Add(-age).UTC().Format(time.RFC3339))
		id := inboxTestEnqueue(t, payload, now)
		if _, err := processNextWebhook(now); err != nil {
			t.Fatal(err)
		}
		if inboxTestStatus(t, id) != "FAILED" {
			t.Fatal("obsolete signal accepted")
		}
	}
	id := inboxTestEnqueue(t, `{"event_id":"old-pending"}`, now.Add(-48*time.Hour))
	if _, err := processNextWebhook(now); err != nil {
		t.Fatal(err)
	}
	if inboxTestStatus(t, id) != "FAILED" || calls != 1 {
		t.Fatal("old backlog executed")
	}
}

func TestWebhookInboxSevenDayRetentionPreservesUnresolvedAndHistory(t *testing.T) {
	setupDeadLetterTestDB(t)
	now := time.Now()
	if _, err := db.Exec(`CREATE TABLE alerts(id INTEGER);INSERT INTO alerts VALUES(1)`); err != nil {
		t.Fatal(err)
	}
	ids := map[string]int64{}
	for _, status := range []string{"PROCESSED", "DISMISSED", "FAILED", "PENDING", "PROCESSING"} {
		id := inboxTestEnqueue(t, fmt.Sprintf(`{"event_id":%q}`, status), now.Add(-14*24*time.Hour))
		ids[status] = id
		if _, err := db.Exec(`UPDATE webhook_inbox SET status=?,completed_at=? WHERE id=?`, status, now.Add(-8*24*time.Hour).UnixMilli(), id); err != nil {
			t.Fatal(err)
		}
	}
	insertWebhookDeadLetter("tradingview", "/", []byte(`{}`), "unresolved", 500)
	insertWebhookDeadLetter("tradingview", "/", []byte(`{}`), "resolved", 500)
	if _, err := db.Exec(`UPDATE webhook_dead_letters SET resolved_at=datetime('now','-8 days'),resolution='dismissed' WHERE error='resolved'`); err != nil {
		t.Fatal(err)
	}
	if err := cleanupWebhookReceipts(now); err != nil {
		t.Fatal(err)
	}
	var receipts, dead, alerts int
	if err := db.QueryRow(`SELECT COUNT(*) FROM webhook_inbox`).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM webhook_dead_letters`).Scan(&dead); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM alerts`).Scan(&alerts); err != nil {
		t.Fatal(err)
	}
	if receipts != 3 || dead != 1 || alerts != 1 {
		t.Fatal(receipts, dead, alerts)
	}
	for _, status := range []string{"FAILED", "PENDING", "PROCESSING"} {
		if inboxTestStatus(t, ids[status]) != status {
			t.Fatal(status)
		}
	}
}
