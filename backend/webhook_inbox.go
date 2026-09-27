package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"
)

const webhookReceiptRetention = 7 * 24 * time.Hour
const webhookAutomaticReplayAge = 24 * time.Hour

var webhookInboxWake = make(chan struct{}, 1)
var webhookAdmissionMu sync.Mutex
var webhookProcessingMu sync.Mutex

func initWebhookInbox() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS webhook_inbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		webhook_name TEXT NOT NULL,
		request_path TEXT NOT NULL,
		payload TEXT NOT NULL,
		payload_hash TEXT NOT NULL,
		event_key TEXT,
		stream_key TEXT NOT NULL,
		event_time INTEGER,
		status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','PROCESSED','FAILED','DISMISSED')),
		received_at INTEGER NOT NULL,
		completed_at INTEGER,
		dead_letter_id INTEGER UNIQUE,
		UNIQUE(webhook_name,event_key)
	);
	CREATE INDEX IF NOT EXISTS webhook_inbox_pending ON webhook_inbox(status,id);
	CREATE INDEX IF NOT EXISTS webhook_inbox_hash ON webhook_inbox(webhook_name,payload_hash,received_at);
	CREATE INDEX IF NOT EXISTS webhook_inbox_stream ON webhook_inbox(stream_key,event_time,status);
	CREATE INDEX IF NOT EXISTS webhook_inbox_cleanup ON webhook_inbox(status,completed_at);`)
	if err == nil {
		_, err = db.Exec(`UPDATE webhook_dead_letters SET request_url=substr(request_url,1,instr(request_url,'?')-1) WHERE instr(request_url,'?')>0`)
	}
	return err
}

type webhookReceipt struct {
	ID                                  int64
	Name, Path, Payload, Stream, Status string
	Received                            int64
	EventTime                           sql.NullInt64
	DeadLetterID                        sql.NullInt64
}

const webhookReceiptColumns = `id,webhook_name,request_path,payload,stream_key,status,received_at,event_time,dead_letter_id`

func scanWebhookReceipt(row interface{ Scan(...interface{}) error }) (webhookReceipt, error) {
	var receipt webhookReceipt
	err := row.Scan(&receipt.ID, &receipt.Name, &receipt.Path, &receipt.Payload, &receipt.Stream, &receipt.Status, &receipt.Received, &receipt.EventTime, &receipt.DeadLetterID)
	return receipt, err
}

// Canonicalise JSON without float rounding, and never persist transport credentials.
func webhookEnvelope(body []byte, name string) (string, string, string, string, *int64, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var envelope map[string]interface{}
	if err := decoder.Decode(&envelope); err != nil {
		return "", "", "", "", nil, err
	}
	if envelope == nil {
		return "", "", "", "", nil, fmt.Errorf("expected a JSON object")
	}
	if err := decoder.Decode(new(interface{})); err != io.EOF {
		return "", "", "", "", nil, fmt.Errorf("expected one JSON object")
	}
	delete(envelope, "secret")
	clean, err := json.Marshal(envelope)
	if err != nil {
		return "", "", "", "", nil, err
	}
	get := func(key string) string {
		if v, ok := envelope[key].(string); ok {
			return strings.TrimSpace(v)
		}
		return ""
	}
	var eventTime *int64
	for _, key := range []string{"bar_closed_at", "timestamp", "time"} {
		if value := get(key); value != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
				n := parsed.UnixMilli()
				eventTime = &n
				break
			}
		}
	}
	if eventTime == nil && name == "etf_rebalance" {
		if parsed, err := time.Parse("2006-01-02", get("rebalance_date")); err == nil {
			n := parsed.UnixMilli()
			eventTime = &n
		}
	}
	nested := func(parent, key string) string {
		if row, ok := envelope[parent].(map[string]interface{}); ok {
			if value, ok := row[key].(string); ok {
				return normalizeCommodityThemeSymbol(value)
			}
		}
		return ""
	}
	streamJSON, _ := json.Marshal([]interface{}{name, normalizeCommodityThemeSymbol(get("ticker")), normalizeAlertScript(get("script")), get("timeframe"), strings.ToUpper(get("theme")), strings.ToUpper(get("stage")), strings.ToUpper(get("scope")), nested("security", "ticker"), nested("source", "kind"), nested("source", "symbol"), nested("source", "numerator"), nested("source", "denominator"), get("detector")})
	stream := fmt.Sprintf("%x", sha256.Sum256(streamJSON))
	hash := fmt.Sprintf("%x", sha256.Sum256(clean))
	key := get("event_id")
	if key != "" {
		key = "id:" + key
	} else if eventTime != nil {
		key = "bar:" + hash
	}
	return string(clean), hash, key, stream, eventTime, nil
}

func enqueueWebhook(name, path string, body []byte, now time.Time) (int64, bool, int, error) {
	payload, hash, key, stream, eventTime, err := webhookEnvelope(body, name)
	if err != nil {
		return 0, false, 400, err
	}
	if _, ok := webhookProcessors[name]; !ok {
		return 0, false, 400, fmt.Errorf("unregistered webhook type")
	}
	webhookAdmissionMu.Lock()
	defer webhookAdmissionMu.Unlock()
	tx, err := db.Begin()
	if err != nil {
		return 0, false, 503, err
	}
	defer tx.Rollback()
	var id int64
	var priorHash string
	if key != "" {
		err = tx.QueryRow(`SELECT id,payload_hash FROM webhook_inbox WHERE webhook_name=? AND event_key=?`, name, key).Scan(&id, &priorHash)
	} else {
		// Legacy packets have no event identity; suppress bursts, not future legitimate repeats.
		err = tx.QueryRow(`SELECT id,payload_hash FROM webhook_inbox WHERE stream_key=? AND received_at>=? ORDER BY id DESC LIMIT 1`, stream, now.Add(-time.Minute).UnixMilli()).Scan(&id, &priorHash)
		if err == nil && priorHash != hash {
			err = sql.ErrNoRows
		}
	}
	if err == nil {
		if priorHash != hash {
			return 0, false, 409, fmt.Errorf("event_id was already used for a different payload")
		}
		return id, true, 200, nil
	}
	if err != sql.ErrNoRows {
		return 0, false, 503, err
	}
	result, err := tx.Exec(`INSERT INTO webhook_inbox(webhook_name,request_path,payload,payload_hash,event_key,stream_key,event_time,received_at) VALUES(?,?,?,?,NULLIF(?,''),?,?,?)`, name, path, payload, hash, key, stream, eventTime, now.UnixMilli())
	if err != nil {
		return 0, false, 503, err
	}
	id, err = result.LastInsertId()
	if err != nil {
		return 0, false, 503, err
	}
	if err := tx.Commit(); err != nil {
		return 0, false, 503, err
	}
	return id, false, 200, nil
}

// The caller holds webhookProcessingMu. Inbox and failure UI must change together.
func failWebhookReceipt(receipt webhookReceipt, message string, status int) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	deadID := receipt.DeadLetterID.Int64
	if !receipt.DeadLetterID.Valid {
		result, err := tx.Exec(`INSERT INTO webhook_dead_letters(webhook_name,request_url,payload,error,http_status) VALUES(?,?,?,?,?)`, receipt.Name, receipt.Path, receipt.Payload, message, status)
		if err != nil {
			return err
		}
		deadID, err = result.LastInsertId()
		if err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(`UPDATE webhook_dead_letters SET error=?,http_status=?,resolved_at=NULL,resolution=NULL WHERE id=?`, message, status, deadID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE webhook_inbox SET status='FAILED',completed_at=NULL,dead_letter_id=? WHERE id=?`, deadID, receipt.ID); err != nil {
		return err
	}
	return tx.Commit()
}

func completeWebhookReceipt(receipt webhookReceipt, now time.Time) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE webhook_inbox SET status='PROCESSED',completed_at=? WHERE id=?`, now.UnixMilli(), receipt.ID); err != nil {
		return err
	}
	if receipt.DeadLetterID.Valid {
		if _, err := tx.Exec(`UPDATE webhook_dead_letters SET resolved_at=CURRENT_TIMESTAMP,resolution='retried' WHERE id=?`, receipt.DeadLetterID.Int64); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func executeWebhookReceipt(receipt webhookReceipt, now time.Time) error {
	// A late transport delivery must not manufacture a fresh three-day trading instruction.
	if now.UnixMilli()-receipt.Received > webhookAutomaticReplayAge.Milliseconds() || (receipt.EventTime.Valid && now.UnixMilli()-receipt.EventTime.Int64 > webhookAutomaticReplayAge.Milliseconds()) {
		return failWebhookReceipt(receipt, "Signal is more than 24 hours old. Review the current source and dismiss this receipt; reconnect or send a current signal if needed.", 422)
	}
	if receipt.EventTime.Valid {
		var newer bool
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM webhook_inbox WHERE stream_key=? AND status='PROCESSED' AND event_time>? AND id!=?)`, receipt.Stream, receipt.EventTime.Int64, receipt.ID).Scan(&newer); err != nil {
			return err
		}
		if newer {
			return failWebhookReceipt(receipt, "A newer event from this source has already been processed. Review and dismiss this superseded signal.", 409)
		}
	}
	processor, ok := webhookProcessors[receipt.Name]
	if !ok {
		return failWebhookReceipt(receipt, "No processor registered for this signal.", 422)
	}
	if _, err := db.Exec(`UPDATE webhook_inbox SET status='PROCESSING' WHERE id=?`, receipt.ID); err != nil {
		return err
	}
	status, body := invokeWebhookProcessor(processor, receipt.Path, receipt.Payload)
	if status >= 400 {
		return failWebhookReceipt(receipt, body, status)
	}
	return completeWebhookReceipt(receipt, now)
}

func invokeWebhookProcessor(processor func(http.ResponseWriter, *http.Request), path, payload string) (status int, body string) {
	defer func() {
		if recovered := recover(); recovered != nil {
			status = 500
			body = fmt.Sprintf("Processing interrupted by panic: %v. Check current state before retrying.", recovered)
		}
	}()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	processor(recorder, req)
	return recorder.Code, strings.TrimSpace(recorder.Body.String())
}

// Recovery never blindly replays a handler that may already have written an action.
func recoverWebhookReceipts() error {
	rows, err := db.Query(`SELECT ` + webhookReceiptColumns + ` FROM webhook_inbox WHERE status='PROCESSING' ORDER BY id`)
	if err != nil {
		return err
	}
	var receipts []webhookReceipt
	for rows.Next() {
		receipt, err := scanWebhookReceipt(rows)
		if err != nil {
			rows.Close()
			return err
		}
		receipts = append(receipts, receipt)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, receipt := range receipts {
		if err := failWebhookReceipt(receipt, "Processing was interrupted before completion was recorded. Check current state before Retry; some effects may already exist.", 500); err != nil {
			return err
		}
	}
	return nil
}

func processNextWebhook(now time.Time) (bool, error) {
	webhookProcessingMu.Lock()
	defer webhookProcessingMu.Unlock()
	if err := recoverWebhookReceipts(); err != nil {
		return false, err
	}
	receipt, err := scanWebhookReceipt(db.QueryRow(`SELECT ` + webhookReceiptColumns + ` FROM webhook_inbox WHERE status='PENDING' ORDER BY id LIMIT 1`))
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, executeWebhookReceipt(receipt, now)
}

func cleanupWebhookReceipts(now time.Time) error {
	webhookProcessingMu.Lock()
	defer webhookProcessingMu.Unlock()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	cutoff := now.Add(-webhookReceiptRetention)
	if _, err := tx.Exec(`DELETE FROM webhook_inbox WHERE status IN ('PROCESSED','DISMISSED') AND completed_at<?`, cutoff.UnixMilli()); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM webhook_dead_letters WHERE resolved_at IS NOT NULL AND datetime(resolved_at)<datetime(?) AND NOT EXISTS(SELECT 1 FROM webhook_inbox WHERE dead_letter_id=webhook_dead_letters.id)`, cutoff.UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	return tx.Commit()
}

func startWebhookInboxWorker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		var lastCleanup time.Time
		for {
			if ctx.Err() != nil {
				return
			}
			if time.Since(lastCleanup) >= time.Hour {
				if err := cleanupWebhookReceipts(time.Now()); err != nil {
					log.Printf("[WEBHOOK] inbox cleanup failed: %v", err)
				} else {
					lastCleanup = time.Now()
				}
			}
			for i := 0; i < 25 && ctx.Err() == nil; i++ {
				worked, err := processNextWebhook(time.Now())
				if err != nil {
					log.Printf("[WEBHOOK] inbox worker failed: %v", err)
					break
				}
				if !worked {
					break
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-webhookInboxWake:
			}
		}
	}()
}

// Called with the processing lock held, so Retry and the worker cannot race.
func retryWebhookReceipt(deadLetterID int64) (bool, int, error) {
	receipt, err := scanWebhookReceipt(db.QueryRow(`SELECT `+webhookReceiptColumns+` FROM webhook_inbox WHERE dead_letter_id=?`, deadLetterID))
	if err == sql.ErrNoRows {
		return false, 0, nil
	}
	if err != nil {
		return true, 500, err
	}
	if receipt.Status != "FAILED" {
		return true, 409, fmt.Errorf("signal is already processing or resolved")
	}
	if _, err := db.Exec(`UPDATE webhook_dead_letters SET retry_count=retry_count+1,last_retried_at=CURRENT_TIMESTAMP WHERE id=?`, deadLetterID); err != nil {
		return true, 500, err
	}
	if err := executeWebhookReceipt(receipt, time.Now()); err != nil {
		return true, 500, err
	}
	var status, message string
	if err := db.QueryRow(`SELECT i.status,d.error FROM webhook_inbox i JOIN webhook_dead_letters d ON d.id=i.dead_letter_id WHERE i.id=?`, receipt.ID).Scan(&status, &message); err != nil {
		return true, 500, err
	}
	if status != "PROCESSED" {
		return true, 422, fmt.Errorf("%s", message)
	}
	return true, 200, nil
}
