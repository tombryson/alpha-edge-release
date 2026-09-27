package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"trading-backend/internal/database"
)

type backupStatus struct {
	Enabled     bool      `json:"enabled"`
	State       string    `json:"state"`
	LastAttempt time.Time `json:"last_attempt,omitempty"`
	LastSuccess time.Time `json:"last_success,omitempty"`
	SnapshotID  string    `json:"snapshot_id,omitempty"`
	SHA256      string    `json:"sha256,omitempty"`
	Error       string    `json:"error,omitempty"`
}

func readBackupStatus() backupStatus {
	status := backupStatus{State: "disabled"}
	var raw string
	if db.QueryRow(`SELECT value FROM settings WHERE key='verified_backup_status'`).Scan(&raw) == nil {
		_ = json.Unmarshal([]byte(raw), &status)
	}
	status.Enabled = os.Getenv("ALPHA_EDGE_BACKUPS_ENABLED") == "true"
	if !status.Enabled {
		status.State = "disabled"
	}
	return status
}

func getBackupStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(readBackupStatus())
}

func saveBackupStatus(ctx context.Context, status backupStatus) error {
	raw, err := json.Marshal(status)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `INSERT INTO settings(key,value,updated_at) VALUES('verified_backup_status',?,CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, string(raw))
	return err
}

func runScheduledBackup(ctx context.Context, source string, now time.Time) {
	status := readBackupStatus()
	if !status.Enabled || now.Sub(status.LastSuccess) < 24*time.Hour || now.Sub(status.LastAttempt) < time.Hour {
		return
	}
	status.State, status.LastAttempt, status.Error = "running", now, ""
	// A replica cannot record the attempt. Do not back up a stale read-only replica.
	raw, err := json.Marshal(status)
	if err != nil {
		return
	}
	claim, err := db.ExecContext(ctx, `INSERT INTO settings(key,value,updated_at) VALUES('verified_backup_status',?,CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
		WHERE (json_extract(settings.value,'$.last_attempt') IS NULL OR julianday(?) - julianday(json_extract(settings.value,'$.last_attempt')) >= 1.0/24)
		AND (json_extract(settings.value,'$.last_success') IS NULL OR julianday(?) - julianday(json_extract(settings.value,'$.last_success')) >= 1)`, string(raw), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return
	}
	if rows, err := claim.RowsAffected(); err != nil || rows != 1 {
		return
	}
	config := database.RemoteBackupConfig{Repository: os.Getenv("RESTIC_REPOSITORY"), Namespace: os.Getenv("BACKUP_NAMESPACE")}
	result, err := database.BackupRemote(ctx, source, config)
	if err != nil {
		status.State, status.Error = "failed", err.Error()
		log.Printf("[BACKUP] Verified backup failed: %s", status.Error)
	} else {
		status.State, status.LastSuccess = "verified", time.Now().UTC()
		status.SnapshotID, status.SHA256 = result.SnapshotID, result.SHA256
		log.Printf("[BACKUP] Encrypted snapshot uploaded and restore verified: %s", result.SnapshotID)
	}
	// Publish failures even when the operation timed out; do not reset last success.
	writeContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := saveBackupStatus(writeContext, status); err != nil {
		log.Printf("[BACKUP] Cannot persist backup status")
	}
}

func startBackupScheduler(ctx context.Context, source string) {
	if os.Getenv("ALPHA_EDGE_BACKUPS_ENABLED") != "true" {
		return
	}
	go func() {
		run := func() {
			attempt, cancel := context.WithTimeout(ctx, 20*time.Minute)
			defer cancel()
			runScheduledBackup(attempt, source, time.Now().UTC())
		}
		run()
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}
