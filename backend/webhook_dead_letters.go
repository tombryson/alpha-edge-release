package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// Webhook dead-letter queue.
//
// Failed durable receipts and legacy failures share the existing review UI.
// Unresolved rows are retained until retried successfully or dismissed.

type WebhookDeadLetter struct {
	ID            int64   `json:"id"`
	WebhookName   string  `json:"webhook_name"`
	RequestURL    string  `json:"request_url"`
	Payload       string  `json:"payload"`
	Error         string  `json:"error"`
	HTTPStatus    int     `json:"http_status"`
	RetryCount    int     `json:"retry_count"`
	LastRetriedAt *string `json:"last_retried_at"`
	CreatedAt     string  `json:"created_at"`
	ResolvedAt    *string `json:"resolved_at"`
	Resolution    *string `json:"resolution"`
}

// redactWebhookSecret strips the auth secret before persistence so credentials
// never land in the database. Retries dispatch directly to the sync processor
// and bypass authMiddleware, so the secret is not needed again.
func redactWebhookSecret(payload []byte) string {
	var probe map[string]interface{}
	if err := json.Unmarshal(payload, &probe); err != nil {
		return string(payload)
	}
	if _, ok := probe["secret"]; !ok {
		return string(payload)
	}
	delete(probe, "secret")
	cleaned, err := json.Marshal(probe)
	if err != nil {
		return string(payload)
	}
	return string(cleaned)
}

func insertWebhookDeadLetter(webhookName, requestURL string, payload []byte, errMsg string, httpStatus int) {
	if parsed, err := url.Parse(requestURL); err == nil {
		requestURL = parsed.EscapedPath()
	}
	_, err := db.Exec(`
		INSERT INTO webhook_dead_letters (webhook_name, request_url, payload, error, http_status)
		VALUES (?, ?, ?, ?, ?)`,
		webhookName, requestURL, redactWebhookSecret(payload), errMsg, httpStatus,
	)
	if err != nil {
		// Last line of defence: if even the dead-letter insert fails, make the
		// log entry impossible to miss.
		log.Printf("[WEBHOOK][CRITICAL] failed to record dead letter for %s: %v", webhookName, err)
	}
}

// webhookProcessors maps webhook names (as passed to
// acknowledgeAndProcessWebhook) to their synchronous processors. Var so tests
// can substitute stubs.
var webhookProcessors = map[string]func(http.ResponseWriter, *http.Request){
	"tradingview":        tradingViewWebhookSync,
	"regime":             regimeWebhookSync,
	"etf_rebalance":      etfRebalanceWebhookSync,
	"theme_confirmation": themeConfirmationWebhookSync,
}

func scanWebhookDeadLetter(scan func(dest ...interface{}) error) (WebhookDeadLetter, error) {
	var dl WebhookDeadLetter
	err := scan(&dl.ID, &dl.WebhookName, &dl.RequestURL, &dl.Payload, &dl.Error,
		&dl.HTTPStatus, &dl.RetryCount, &dl.LastRetriedAt, &dl.CreatedAt, &dl.ResolvedAt, &dl.Resolution)
	return dl, err
}

const webhookDeadLetterColumns = `id, webhook_name, request_url, payload, error,
	http_status, retry_count, last_retried_at, created_at, resolved_at, resolution`

// GET /api/webhook-dead-letters?include_resolved=true
func getWebhookDeadLetters(w http.ResponseWriter, r *http.Request) {
	includeResolved := r.URL.Query().Get("include_resolved") == "true"

	query := `SELECT ` + webhookDeadLetterColumns + ` FROM webhook_dead_letters`
	if !includeResolved {
		query += ` WHERE resolved_at IS NULL`
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT 200`

	rows, err := db.Query(query)
	if err != nil {
		http.Error(w, "Failed to load dead letters", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	deadLetters := []WebhookDeadLetter{}
	for rows.Next() {
		dl, err := scanWebhookDeadLetter(rows.Scan)
		if err != nil {
			http.Error(w, "Failed to read dead letters", http.StatusInternalServerError)
			return
		}
		deadLetters = append(deadLetters, dl)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Failed to read dead letters", http.StatusInternalServerError)
		return
	}

	var unresolvedCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM webhook_dead_letters WHERE resolved_at IS NULL`).Scan(&unresolvedCount); err != nil {
		http.Error(w, "Failed to count dead letters", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"dead_letters":     deadLetters,
		"unresolved_count": unresolvedCount,
	})
}

func loadUnresolvedDeadLetter(id int64) (WebhookDeadLetter, error) {
	row := db.QueryRow(`SELECT `+webhookDeadLetterColumns+` FROM webhook_dead_letters WHERE id = ? AND resolved_at IS NULL`, id)
	return scanWebhookDeadLetter(row.Scan)
}

// POST /api/webhook-dead-letters/{id}/retry
//
// Re-dispatches the stored payload synchronously to the original processor.
// Success resolves the row as 'retried'; failure increments retry_count and
// records the latest error, keeping the row visible.
func retryWebhookDeadLetterHandler(w http.ResponseWriter, r *http.Request) {
	webhookProcessingMu.Lock()
	defer webhookProcessingMu.Unlock()
	id, err := strconv.ParseInt(mux.Vars(r)["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid id", http.StatusBadRequest)
		return
	}

	dl, err := loadUnresolvedDeadLetter(id)
	if err != nil {
		http.Error(w, "Dead letter not found or already resolved", http.StatusNotFound)
		return
	}

	if handled, status, err := retryWebhookReceipt(id); handled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "retry_failed", "error": err.Error()})
		} else {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "retried", "http_status": 200})
		}
		return
	}
	processor, ok := webhookProcessors[dl.WebhookName]
	if !ok {
		http.Error(w, fmt.Sprintf("No processor registered for webhook %q", dl.WebhookName), http.StatusUnprocessableEntity)
		return
	}

	status, responseBody := http.StatusUnprocessableEntity, "Stored signal age cannot be verified. Review and obtain current source evidence."
	received, knownAge := parseDatabaseTime(dl.CreatedAt)
	_, _, _, _, eventTime, envelopeErr := webhookEnvelope([]byte(dl.Payload), dl.WebhookName)
	if knownAge && envelopeErr == nil && time.Since(received) <= webhookAutomaticReplayAge && (eventTime == nil || time.Since(time.UnixMilli(*eventTime)) <= webhookAutomaticReplayAge) {
		status, responseBody = replayDeadLetter(processor, dl)
	} else if knownAge && envelopeErr == nil {
		responseBody = "Signal is more than 24 hours old. Review and dismiss it; obtain current source evidence instead of replaying it."
	}

	if status < http.StatusBadRequest {
		_, err = db.Exec(`
			UPDATE webhook_dead_letters
			SET resolved_at = CURRENT_TIMESTAMP, resolution = 'retried',
			    retry_count = retry_count + 1, last_retried_at = CURRENT_TIMESTAMP
			WHERE id = ?`, id)
		if err != nil {
			http.Error(w, "Retry succeeded but failed to update dead letter", http.StatusInternalServerError)
			return
		}
		log.Printf("[WEBHOOK] dead letter %d (%s) retried successfully (HTTP %d)", id, dl.WebhookName, status)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "retried", "http_status": status})
		return
	}

	if _, err := db.Exec(`
		UPDATE webhook_dead_letters
		SET retry_count = retry_count + 1, last_retried_at = CURRENT_TIMESTAMP, error = ?
		WHERE id = ?`, strings.TrimSpace(responseBody), id); err != nil {
		log.Printf("[WEBHOOK] failed to record retry failure for dead letter %d: %v", id, err)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnprocessableEntity)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "retry_failed",
		"http_status": status,
		"error":       strings.TrimSpace(responseBody),
	})
}

func replayDeadLetter(processor func(http.ResponseWriter, *http.Request), dl WebhookDeadLetter) (int, string) {
	requestURL := dl.RequestURL
	if requestURL == "" {
		requestURL = "/"
	}
	started := time.Now()
	status, body := invokeWebhookProcessor(processor, requestURL, dl.Payload)
	log.Printf("[WEBHOOK] dead letter %d replay finished HTTP %d in %s", dl.ID, status, time.Since(started))
	return status, body
}

// POST /api/webhook-dead-letters/{id}/dismiss
func dismissWebhookDeadLetterHandler(w http.ResponseWriter, r *http.Request) {
	webhookProcessingMu.Lock()
	defer webhookProcessingMu.Unlock()
	id, err := strconv.ParseInt(mux.Vars(r)["id"], 10, 64)
	if err != nil {
		http.Error(w, "Invalid id", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Failed to dismiss dead letter", 500)
		return
	}
	defer tx.Rollback()
	result, err := tx.Exec(`
		UPDATE webhook_dead_letters
		SET resolved_at = CURRENT_TIMESTAMP, resolution = 'dismissed'
		WHERE id = ? AND resolved_at IS NULL`, id)
	if err != nil {
		http.Error(w, "Failed to dismiss dead letter", http.StatusInternalServerError)
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		http.Error(w, "Dead letter not found or already resolved", http.StatusNotFound)
		return
	}
	if _, err := tx.Exec(`UPDATE webhook_inbox SET status='DISMISSED',completed_at=? WHERE dead_letter_id=?`, time.Now().UnixMilli(), id); err != nil {
		http.Error(w, "Failed to resolve inbox receipt", 500)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit dismissal", 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "dismissed"})
}
