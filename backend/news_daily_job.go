package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type newsDailyJob struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Stage        string `json:"stage"`
	StageMessage string `json:"stage_message"`
	ProgressPct  int    `json:"progress_pct"`
	RunID        int64  `json:"run_id,omitempty"`
	Model        string `json:"model"`
	ErrorMessage string `json:"error_message,omitempty"`
	CreatedAt    string `json:"created_at"`
	StartedAt    string `json:"started_at,omitempty"`
	FinishedAt   string `json:"finished_at,omitempty"`
	UpdatedAt    string `json:"updated_at"`
}

// ── Schema ────────────────────────────────────────────────────────────────────

func ensureNewsDailyJobSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS news_daily_jobs (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'QUEUED',
			stage TEXT NOT NULL DEFAULT 'queued',
			stage_message TEXT NOT NULL DEFAULT '',
			progress_pct INTEGER NOT NULL DEFAULT 0,
			run_id INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			started_at DATETIME,
			finished_at DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_news_daily_jobs_status
			ON news_daily_jobs(status, created_at DESC);
	`)
	return err
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func createNewsDailyJobHandler(w http.ResponseWriter, r *http.Request) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		http.Error(w, "failed to initialise news tables", http.StatusInternalServerError)
		return
	}

	job, err := createNewsDailyJob(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	go runNewsDailyJob(job.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(job)
}

func getNewsDailyJobHandler(w http.ResponseWriter, r *http.Request) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		http.Error(w, "failed to initialise news tables", http.StatusInternalServerError)
		return
	}
	jobID := strings.TrimSpace(mux.Vars(r)["id"])
	job, err := loadNewsDailyJob(r.Context(), jobID)
	if err == sql.ErrNoRows {
		http.Error(w, "daily job not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to load daily job", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

// ── Job lifecycle ─────────────────────────────────────────────────────────────

func createNewsDailyJob(ctx context.Context) (*newsDailyJob, error) {
	jobID := fmt.Sprintf("news_daily_%d", time.Now().UnixNano())
	_, err := db.ExecContext(ctx, `
		INSERT INTO news_daily_jobs (
			id, status, stage, stage_message, progress_pct, updated_at
		)
		VALUES (?, 'QUEUED', 'queued', 'Daily run queued', 1, CURRENT_TIMESTAMP)
	`, jobID)
	if err != nil {
		return nil, err
	}
	return loadNewsDailyJob(ctx, jobID)
}

func runNewsDailyJob(jobID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	_ = runNewsDailyJobWithContext(ctx, jobID)
}

func runNewsDailyJobWithContext(ctx context.Context, jobID string) error {

	model := strings.TrimSpace(os.Getenv("XAI_NEWS_MODEL"))
	if model == "" {
		model = "grok-4.3"
	}

	if _, err := db.ExecContext(ctx, `
		UPDATE news_daily_jobs
		SET model = ?, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, model, jobID); err != nil {
		return err
	}

	_ = updateNewsDailyJobStage(ctx, jobID, "RUNNING", "running", "Running daily narrative pass via xAI", 20)

	payload, rawText, actualModel, err := callXAINewsNarrative(ctx, "DAILY", "")
	if err != nil {
		failNewsDailyJob(ctx, jobID, model, err)
		return err
	}

	_ = updateNewsDailyJobStage(ctx, jobID, "RUNNING", "persisting", "Persisting daily results", 80)

	runID, err := persistNewsNarrativePayloadWithCohort("DAILY", payload, rawText, actualModel, "DAILY_RUN", jobID, 0)
	if err != nil {
		failNewsDailyJob(ctx, jobID, actualModel, err)
		return err
	}

	_, err = db.ExecContext(ctx, `
		UPDATE news_daily_jobs
		SET status = 'SUCCEEDED',
		    stage = 'completed',
		    stage_message = 'Daily narrative pass complete',
		    progress_pct = 100,
		    run_id = ?,
		    model = ?,
		    finished_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, runID, actualModel, jobID)
	return err
}

func updateNewsDailyJobStage(ctx context.Context, jobID string, status string, stage string, message string, progress int) error {
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	_, err := db.ExecContext(ctx, `
		UPDATE news_daily_jobs
		SET status = ?, stage = ?, stage_message = ?, progress_pct = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, stage, message, progress, jobID)
	return err
}

func failNewsDailyJob(ctx context.Context, jobID string, model string, err error) {
	if err == nil {
		return
	}
	_, _ = db.ExecContext(ctx, `
		UPDATE news_daily_jobs
		SET status = 'FAILED',
		    stage = 'failed',
		    stage_message = 'Daily run failed',
		    error_message = ?,
		    model = ?,
		    finished_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, err.Error(), model, jobID)
}

func loadNewsDailyJob(ctx context.Context, jobID string) (*newsDailyJob, error) {
	jobID = strings.TrimSpace(jobID)
	var job newsDailyJob
	err := db.QueryRowContext(ctx, `
		SELECT id, status, stage, stage_message, progress_pct, run_id,
		       model, error_message, created_at,
		       COALESCE(started_at, ''), COALESCE(finished_at, ''), updated_at
		FROM news_daily_jobs
		WHERE id = ?
	`, jobID).Scan(
		&job.ID, &job.Status, &job.Stage, &job.StageMessage, &job.ProgressPct, &job.RunID,
		&job.Model, &job.ErrorMessage, &job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func loadLatestNewsDailyJob(ctx context.Context) *newsDailyJob {
	var jobID string
	err := db.QueryRowContext(ctx, `
		SELECT id FROM news_daily_jobs ORDER BY created_at DESC LIMIT 1
	`).Scan(&jobID)
	if err != nil {
		return nil
	}
	job, err := loadNewsDailyJob(ctx, jobID)
	if err != nil {
		return nil
	}
	return job
}
