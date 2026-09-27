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

type newsFoundationJob struct {
	ID                 string  `json:"id"`
	Status             string  `json:"status"`
	Stage              string  `json:"stage"`
	StageMessage       string  `json:"stage_message"`
	ProgressPct        int     `json:"progress_pct"`
	Mode               string  `json:"mode"`
	SourceType         string  `json:"source_type"`
	SourceID           string  `json:"source_id"`
	SourceMemoJobID    string  `json:"source_memo_job_id"`
	FoundationCohortID int64   `json:"foundation_cohort_id,omitempty"`
	RunID              int64   `json:"run_id,omitempty"`
	Model              string  `json:"model"`
	QualityScore       float64 `json:"quality_score"`
	ThesisCount        int     `json:"thesis_count"`
	CandidateCount     int     `json:"candidate_count"`
	ErrorMessage       string  `json:"error_message,omitempty"`
	CreatedAt          string  `json:"created_at"`
	StartedAt          string  `json:"started_at,omitempty"`
	FinishedAt         string  `json:"finished_at,omitempty"`
	UpdatedAt          string  `json:"updated_at"`
}

type newsFoundationCohort struct {
	ID              int64   `json:"id"`
	Status          string  `json:"status"`
	SourceType      string  `json:"source_type"`
	SourceID        string  `json:"source_id"`
	SourceMemoJobID string  `json:"source_memo_job_id"`
	RunID           int64   `json:"run_id,omitempty"`
	Model           string  `json:"model"`
	QualityScore    float64 `json:"quality_score"`
	ThesisCount     int     `json:"thesis_count"`
	CandidateCount  int     `json:"candidate_count"`
	CreatedAt       string  `json:"created_at"`
	ActivatedAt     string  `json:"activated_at,omitempty"`
	SupersededAt    string  `json:"superseded_at,omitempty"`
	UpdatedAt       string  `json:"updated_at"`
}

type newsFoundationJobRequest struct {
	SourceMemoJobID string `json:"source_memo_job_id"`
}

type newsFoundationQuality struct {
	Score          float64
	ThesisCount    int
	CandidateCount int
	Reasons        []string
}

func ensureNewsFoundationJobSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS news_foundation_jobs (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'QUEUED',
			stage TEXT NOT NULL DEFAULT 'queued',
			stage_message TEXT NOT NULL DEFAULT '',
			progress_pct INTEGER NOT NULL DEFAULT 0,
			mode TEXT NOT NULL DEFAULT 'BOOTSTRAP',
			source_type TEXT NOT NULL DEFAULT '',
			source_id TEXT NOT NULL DEFAULT '',
			source_memo_job_id TEXT NOT NULL DEFAULT '',
			foundation_cohort_id INTEGER NOT NULL DEFAULT 0,
			run_id INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			quality_score REAL NOT NULL DEFAULT 0,
			thesis_count INTEGER NOT NULL DEFAULT 0,
			candidate_count INTEGER NOT NULL DEFAULT 0,
			error_message TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			started_at DATETIME,
			finished_at DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_news_foundation_jobs_status
			ON news_foundation_jobs(status, created_at DESC);

		CREATE TABLE IF NOT EXISTS news_foundation_cohorts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			status TEXT NOT NULL DEFAULT 'BUILDING',
			source_type TEXT NOT NULL DEFAULT '',
			source_id TEXT NOT NULL DEFAULT '',
			source_memo_job_id TEXT NOT NULL DEFAULT '',
			run_id INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			quality_score REAL NOT NULL DEFAULT 0,
			thesis_count INTEGER NOT NULL DEFAULT 0,
			candidate_count INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			activated_at DATETIME,
			superseded_at DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_news_foundation_cohorts_status
			ON news_foundation_cohorts(status, updated_at DESC);

		CREATE TABLE IF NOT EXISTS news_foundation_cohort_theses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cohort_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			title TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			relationship TEXT NOT NULL DEFAULT 'MODIFIES',
			conviction REAL NOT NULL DEFAULT 0,
			conviction_delta REAL NOT NULL DEFAULT 0,
			summary TEXT NOT NULL DEFAULT '',
			evidence TEXT NOT NULL DEFAULT '',
			supporting_evidence TEXT NOT NULL DEFAULT '',
			opposing_evidence TEXT NOT NULL DEFAULT '',
			invalidation_trigger TEXT NOT NULL DEFAULT '',
			source_excerpt TEXT NOT NULL DEFAULT '',
			sources_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(cohort_id, slug)
		);

		CREATE INDEX IF NOT EXISTS idx_news_foundation_cohort_theses_cohort
			ON news_foundation_cohort_theses(cohort_id);
	`)
	if err != nil {
		return err
	}
	_, _ = db.Exec(`ALTER TABLE news_foundation_jobs ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0`)
	_, _ = db.Exec(`ALTER TABLE news_foundation_cohorts ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0`)
	return nil
}

func createNewsFoundationJobHandler(w http.ResponseWriter, r *http.Request) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		http.Error(w, "failed to initialise news tables", http.StatusInternalServerError)
		return
	}

	var request newsFoundationJobRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&request)
	}
	job, err := createNewsFoundationJob(r.Context(), strings.TrimSpace(request.SourceMemoJobID))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	go runNewsFoundationJob(job.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(job)
}

func getNewsFoundationJobHandler(w http.ResponseWriter, r *http.Request) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		http.Error(w, "failed to initialise news tables", http.StatusInternalServerError)
		return
	}
	jobID := strings.TrimSpace(mux.Vars(r)["id"])
	job, err := loadNewsFoundationJob(r.Context(), jobID)
	if err == sql.ErrNoRows {
		http.Error(w, "foundation job not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to load foundation job", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func createNewsFoundationJob(ctx context.Context, sourceMemoJobID string) (*newsFoundationJob, error) {
	jobID := fmt.Sprintf("news_foundation_%d", time.Now().UnixNano())
	sourceType := ""
	sourceID := ""
	if sourceMemoJobID != "" {
		sourceType = "PORTFOLIO_MEMO"
		sourceID = sourceMemoJobID
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO news_foundation_jobs (
			id, status, stage, stage_message, progress_pct, mode,
			source_type, source_id, source_memo_job_id, updated_at
		)
		VALUES (?, 'QUEUED', 'queued', 'Foundation job queued', 1, 'BOOTSTRAP', ?, ?, ?, CURRENT_TIMESTAMP)
	`, jobID, sourceType, sourceID, sourceMemoJobID)
	if err != nil {
		return nil, err
	}
	return loadNewsFoundationJob(ctx, jobID)
}

func runNewsFoundationJob(jobID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	job, err := loadNewsFoundationJob(ctx, jobID)
	if err != nil {
		return
	}
	if err := updateNewsFoundationJobStage(ctx, jobID, "RUNNING", "loading_source", "Loading portfolio memo and asset-class vocabulary", 8); err != nil {
		return
	}

	model := strings.TrimSpace(os.Getenv("XAI_NEWS_MODEL"))
	if model == "" {
		model = "grok-4.3"
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE news_foundation_jobs
		SET model = ?, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, model, jobID); err != nil {
		return
	}

	_ = updateNewsFoundationJobStage(ctx, jobID, "RUNNING", "extracting_candidates", "Extracting thesis candidates from the portfolio memo", 25)
	payload, rawText, model, err := callXAINewsNarrative(ctx, "BOOTSTRAP", job.SourceMemoJobID)
	if err != nil {
		failNewsFoundationJob(ctx, jobID, model, err)
		return
	}

	_ = updateNewsFoundationJobStage(ctx, jobID, "RUNNING", "quality_gate", "Checking foundation quality before promotion", 82)
	quality, err := assessNewsFoundationQuality(ctx, payload, job.SourceMemoJobID)
	if err != nil {
		failNewsFoundationJob(ctx, jobID, model, err)
		return
	}

	_ = updateNewsFoundationJobStage(ctx, jobID, "RUNNING", "promoting_cohort", "Promoting validated foundation ledger", 92)
	cohortID, runID, err := promoteNewsFoundationCohort(ctx, job, payload, rawText, model, quality)
	if err != nil {
		failNewsFoundationJob(ctx, jobID, model, err)
		return
	}

	_, _ = db.ExecContext(ctx, `
		UPDATE news_foundation_jobs
		SET status = 'SUCCEEDED',
		    stage = 'promoted',
		    stage_message = 'Foundation ledger promoted',
		    progress_pct = 100,
		    foundation_cohort_id = ?,
		    run_id = ?,
		    model = ?,
		    quality_score = ?,
		    thesis_count = ?,
		    candidate_count = ?,
		    finished_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, cohortID, runID, model, quality.Score, quality.ThesisCount, quality.CandidateCount, jobID)
}

func updateNewsFoundationJobStage(ctx context.Context, jobID string, status string, stage string, message string, progress int) error {
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	_, err := db.ExecContext(ctx, `
		UPDATE news_foundation_jobs
		SET status = ?, stage = ?, stage_message = ?, progress_pct = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, stage, message, progress, jobID)
	return err
}

func failNewsFoundationJob(ctx context.Context, jobID string, model string, err error) {
	if err == nil {
		return
	}
	_, _ = db.ExecContext(ctx, `
		UPDATE news_foundation_jobs
		SET status = 'FAILED',
		    stage = 'failed',
		    stage_message = 'Foundation job failed',
		    error_message = ?,
		    model = ?,
		    finished_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, err.Error(), model, jobID)
}

func assessNewsFoundationQuality(ctx context.Context, payload newsNarrativeModelPayload, sourceMemoJobID string) (newsFoundationQuality, error) {
	updatesBySlug := newsFoundationUpdatesBySlug(payload)
	assetClasses := map[string]bool{}
	qualifiedEvidence := 0
	for _, update := range updatesBySlug {
		for _, class := range update.AssetClasses {
			if strings.TrimSpace(class) != "" {
				assetClasses[class] = true
			}
		}
		if strings.TrimSpace(update.SupportingEvidence) != "" || strings.TrimSpace(update.Evidence) != "" {
			qualifiedEvidence++
		}
	}

	candidateCount := loadNewsFoundationCandidateCount(ctx, sourceMemoJobID)
	quality := newsFoundationQuality{
		ThesisCount:    len(updatesBySlug),
		CandidateCount: candidateCount,
		Reasons:        []string{},
	}

	minTheses := minNewsFoundationThesisCount(sourceMemoJobID)
	if quality.ThesisCount < minTheses {
		return quality, fmt.Errorf("foundation quality gate failed: expected at least %d validated theses, got %d", minTheses, quality.ThesisCount)
	}
	if len(assetClasses) < 2 {
		return quality, fmt.Errorf("foundation quality gate failed: expected at least 2 affected asset classes, got %d", len(assetClasses))
	}
	if qualifiedEvidence < minTheses/2 {
		return quality, fmt.Errorf("foundation quality gate failed: validated theses lack enough evidence")
	}

	score := 0.45 + float64(quality.ThesisCount)/40 + float64(len(assetClasses))/40 + float64(qualifiedEvidence)/50
	if score > 1 {
		score = 1
	}
	quality.Score = score
	return quality, nil
}

func minNewsFoundationThesisCount(sourceMemoJobID string) int {
	if strings.TrimSpace(sourceMemoJobID) != "" {
		return 8
	}
	return 5
}

func newsFoundationUpdatesBySlug(payload newsNarrativeModelPayload) map[string]newsNarrativeModelUpdate {
	updatesBySlug := map[string]newsNarrativeModelUpdate{}
	for _, update := range payload.ThesisUpdates {
		if strings.TrimSpace(update.Title) == "" {
			continue
		}
		updatesBySlug[newsThesisSlug(update.Title, update.Timeframe)] = update
	}
	return updatesBySlug
}

func loadNewsFoundationCandidateCount(ctx context.Context, memoJobID string) int {
	memoJobID = strings.TrimSpace(memoJobID)
	if memoJobID == "" {
		return 0
	}
	var count int
	_ = db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM news_foundation_candidates
		WHERE memo_job_id = ?
	`, memoJobID).Scan(&count)
	return count
}

func promoteNewsFoundationCohort(ctx context.Context, job *newsFoundationJob, payload newsNarrativeModelPayload, rawText string, model string, quality newsFoundationQuality) (int64, int64, error) {
	sourceType := job.SourceType
	sourceID := job.SourceID
	if sourceType == "" && job.SourceMemoJobID != "" {
		sourceType = "PORTFOLIO_MEMO"
		sourceID = job.SourceMemoJobID
	}

	cohortID, err := createNewsFoundationCohort(ctx, sourceType, sourceID, job.SourceMemoJobID, model, quality)
	if err != nil {
		return 0, 0, err
	}
	runID, err := persistNewsNarrativePayloadWithCohort("BOOTSTRAP", payload, rawText, model, sourceType, sourceID, cohortID)
	if err != nil {
		markNewsFoundationCohortFailed(ctx, cohortID)
		return 0, 0, err
	}
	if err := persistNewsFoundationCohortTheses(ctx, cohortID, payload); err != nil {
		markNewsFoundationCohortFailed(ctx, cohortID)
		return 0, 0, err
	}
	if err := activateNewsFoundationCohort(ctx, cohortID, runID, quality); err != nil {
		markNewsFoundationCohortFailed(ctx, cohortID)
		return 0, 0, err
	}
	return cohortID, runID, nil
}

func createNewsFoundationCohort(ctx context.Context, sourceType string, sourceID string, sourceMemoJobID string, model string, quality newsFoundationQuality) (int64, error) {
	result, err := db.ExecContext(ctx, `
		INSERT INTO news_foundation_cohorts (
			status, source_type, source_id, source_memo_job_id, model,
			quality_score, thesis_count, candidate_count, updated_at
		)
		VALUES ('BUILDING', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, sourceType, sourceID, sourceMemoJobID, model, quality.Score, quality.ThesisCount, quality.CandidateCount)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func activateNewsFoundationCohort(ctx context.Context, cohortID int64, runID int64, quality newsFoundationQuality) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE news_foundation_cohorts
		SET status = 'SUPERSEDED',
		    superseded_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE status = 'ACTIVE'
		  AND id != ?
	`, cohortID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE news_foundation_cohorts
		SET status = 'ACTIVE',
		    run_id = ?,
		    quality_score = ?,
		    thesis_count = ?,
		    candidate_count = ?,
		    activated_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, runID, quality.Score, quality.ThesisCount, quality.CandidateCount, cohortID); err != nil {
		return err
	}
	return tx.Commit()
}

func markNewsFoundationCohortFailed(ctx context.Context, cohortID int64) {
	_, _ = db.ExecContext(ctx, `
		UPDATE news_foundation_cohorts
		SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, cohortID)
}

func persistNewsFoundationCohortTheses(ctx context.Context, cohortID int64, payload newsNarrativeModelPayload) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_foundation_cohort_theses WHERE cohort_id = ?`, cohortID); err != nil {
		return err
	}
	for _, update := range payload.ThesisUpdates {
		if strings.TrimSpace(update.Title) == "" {
			continue
		}
		slug := newsThesisSlug(update.Title, update.Timeframe)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO news_foundation_cohort_theses (
				cohort_id, slug, title, timeframe, status, relationship,
				conviction, conviction_delta, summary, evidence,
				supporting_evidence, opposing_evidence, invalidation_trigger,
				source_excerpt, sources_json, asset_classes_json, tags_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, cohortID, slug, update.Title, update.Timeframe, update.Status, update.Relationship,
			update.Conviction, update.ConvictionDelta, update.Summary, update.Evidence,
			update.SupportingEvidence, update.OpposingEvidence, update.InvalidationTrigger,
			update.SourceExcerpt, mustJSON(update.Sources), mustJSON(update.AssetClasses), mustJSON(update.Tags)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func loadNewsFoundationJob(ctx context.Context, jobID string) (*newsFoundationJob, error) {
	jobID = strings.TrimSpace(jobID)
	var job newsFoundationJob
	err := db.QueryRowContext(ctx, `
		SELECT id, status, stage, stage_message, progress_pct, mode,
		       source_type, source_id, source_memo_job_id, foundation_cohort_id,
		       run_id, model, quality_score, thesis_count, candidate_count,
		       error_message, created_at, COALESCE(started_at, ''),
		       COALESCE(finished_at, ''), updated_at
		FROM news_foundation_jobs
		WHERE id = ?
	`, jobID).Scan(&job.ID, &job.Status, &job.Stage, &job.StageMessage, &job.ProgressPct, &job.Mode,
		&job.SourceType, &job.SourceID, &job.SourceMemoJobID, &job.FoundationCohortID,
		&job.RunID, &job.Model, &job.QualityScore, &job.ThesisCount, &job.CandidateCount,
		&job.ErrorMessage, &job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func loadLatestNewsFoundationJob(ctx context.Context) *newsFoundationJob {
	var jobID string
	err := db.QueryRowContext(ctx, `
		SELECT id
		FROM news_foundation_jobs
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&jobID)
	if err != nil {
		return nil
	}
	job, err := loadNewsFoundationJob(ctx, jobID)
	if err != nil {
		return nil
	}
	return job
}

func loadActiveNewsFoundationCohort(ctx context.Context) *newsFoundationCohort {
	var cohortID int64
	err := db.QueryRowContext(ctx, `
		SELECT id
		FROM news_foundation_cohorts
		WHERE status = 'ACTIVE'
		ORDER BY activated_at DESC, updated_at DESC
		LIMIT 1
	`).Scan(&cohortID)
	if err != nil {
		return nil
	}
	cohort, err := loadNewsFoundationCohort(ctx, cohortID)
	if err != nil {
		return nil
	}
	return cohort
}

func loadNewsFoundationCohort(ctx context.Context, cohortID int64) (*newsFoundationCohort, error) {
	var cohort newsFoundationCohort
	err := db.QueryRowContext(ctx, `
		SELECT id, status, source_type, source_id, source_memo_job_id, run_id,
		       model, quality_score, thesis_count, candidate_count, created_at,
		       COALESCE(activated_at, ''), COALESCE(superseded_at, ''), updated_at
		FROM news_foundation_cohorts
		WHERE id = ?
	`, cohortID).Scan(&cohort.ID, &cohort.Status, &cohort.SourceType, &cohort.SourceID,
		&cohort.SourceMemoJobID, &cohort.RunID, &cohort.Model, &cohort.QualityScore,
		&cohort.ThesisCount, &cohort.CandidateCount, &cohort.CreatedAt, &cohort.ActivatedAt,
		&cohort.SupersededAt, &cohort.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &cohort, nil
}
