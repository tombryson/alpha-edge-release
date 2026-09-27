package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

type portfolioMemoRun struct {
	ID                   int64                    `json:"id"`
	MemoJobID            string                   `json:"memo_job_id"`
	RunID                string                   `json:"run_id"`
	Mode                 string                   `json:"mode"`
	Status               string                   `json:"status"`
	Model                string                   `json:"model"`
	AnalysisDate         string                   `json:"analysis_date"`
	PrimaryTheme         string                   `json:"primary_theme"`
	SecondaryTheme       string                   `json:"secondary_theme"`
	OverallConviction    string                   `json:"overall_conviction"`
	ExecutiveSummary     string                   `json:"executive_summary"`
	AnalystMemoMarkdown  string                   `json:"analyst_memo_markdown"`
	ChairmanMemoMarkdown string                   `json:"chairman_memo_markdown"`
	AssetClassTargets    []map[string]interface{} `json:"asset_class_targets"`
	CreatedAt            string                   `json:"created_at"`
	UpdatedAt            string                   `json:"updated_at"`
}

type portfolioMemoPersistRequest struct {
	MemoJobID            string                   `json:"memo_job_id"`
	RunID                string                   `json:"run_id"`
	Mode                 string                   `json:"mode"`
	Status               string                   `json:"status"`
	Model                string                   `json:"model"`
	AnalysisDate         string                   `json:"analysis_date"`
	PrimaryTheme         string                   `json:"primary_theme"`
	SecondaryTheme       string                   `json:"secondary_theme"`
	OverallConviction    string                   `json:"overall_conviction"`
	ExecutiveSummary     string                   `json:"executive_summary"`
	AnalystMemoMarkdown  string                   `json:"analyst_memo_markdown"`
	ChairmanMemoMarkdown string                   `json:"chairman_memo_markdown"`
	AssetClassTargets    []map[string]interface{} `json:"asset_class_targets"`
	RawResult            interface{}              `json:"raw_result"`
}

type portfolioMemoResponse struct {
	Memo *portfolioMemoRun `json:"memo"`
}

func ensurePortfolioMemoSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS portfolio_memo_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL UNIQUE,
			run_id TEXT NOT NULL DEFAULT '',
			mode TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			analysis_date TEXT NOT NULL DEFAULT '',
			primary_theme TEXT NOT NULL DEFAULT '',
			secondary_theme TEXT NOT NULL DEFAULT '',
			overall_conviction TEXT NOT NULL DEFAULT '',
			executive_summary TEXT NOT NULL DEFAULT '',
			analyst_memo_markdown TEXT NOT NULL DEFAULT '',
			chairman_memo_markdown TEXT NOT NULL DEFAULT '',
			asset_class_targets_json TEXT NOT NULL DEFAULT '[]',
			raw_result_json TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_portfolio_memo_runs_updated
			ON portfolio_memo_runs(updated_at DESC, id DESC);
	`)
	if err != nil {
		return err
	}
	_, _ = db.Exec(`ALTER TABLE portfolio_memo_runs ADD COLUMN model TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE portfolio_memo_runs ADD COLUMN raw_result_json TEXT NOT NULL DEFAULT '{}'`)
	return nil
}

func savePortfolioMemoRun(w http.ResponseWriter, r *http.Request) {
	if err := ensurePortfolioMemoSchema(); err != nil {
		http.Error(w, "failed to initialise portfolio memo tables", http.StatusInternalServerError)
		return
	}

	var request portfolioMemoPersistRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid portfolio memo payload", http.StatusBadRequest)
		return
	}

	memo, err := persistPortfolioMemoRun(r.Context(), request)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(portfolioMemoResponse{Memo: memo})
}

func getLatestPortfolioMemoRun(w http.ResponseWriter, r *http.Request) {
	if err := ensurePortfolioMemoSchema(); err != nil {
		http.Error(w, "failed to initialise portfolio memo tables", http.StatusInternalServerError)
		return
	}

	memo, err := loadLatestPortfolioMemoRun(r.Context())
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, "failed to load latest portfolio memo", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(portfolioMemoResponse{Memo: memo})
}

func getPortfolioMemoRunByJobID(w http.ResponseWriter, r *http.Request) {
	if err := ensurePortfolioMemoSchema(); err != nil {
		http.Error(w, "failed to initialise portfolio memo tables", http.StatusInternalServerError)
		return
	}

	jobID := strings.TrimSpace(mux.Vars(r)["jobId"])
	if jobID == "" {
		http.Error(w, "memo job id is required", http.StatusBadRequest)
		return
	}

	memo, err := loadPortfolioMemoRunByJobID(r.Context(), jobID)
	if err == sql.ErrNoRows {
		http.Error(w, "portfolio memo not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to load portfolio memo", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(portfolioMemoResponse{Memo: memo})
}

func persistPortfolioMemoRun(ctx context.Context, request portfolioMemoPersistRequest) (*portfolioMemoRun, error) {
	request.MemoJobID = strings.TrimSpace(request.MemoJobID)
	if request.MemoJobID == "" {
		return nil, errors.New("memo_job_id is required")
	}
	assetClassTargetsJSON := mustJSON(request.AssetClassTargets)
	rawResultJSON := "{}"
	if request.RawResult != nil {
		rawResultJSON = mustJSON(request.RawResult)
	}

	_, err := db.ExecContext(ctx, `
		INSERT INTO portfolio_memo_runs (
			memo_job_id, run_id, mode, status, model, analysis_date,
			primary_theme, secondary_theme, overall_conviction, executive_summary,
			analyst_memo_markdown, chairman_memo_markdown, asset_class_targets_json,
			raw_result_json, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(memo_job_id) DO UPDATE SET
			run_id = excluded.run_id,
			mode = excluded.mode,
			status = excluded.status,
			model = excluded.model,
			analysis_date = excluded.analysis_date,
			primary_theme = excluded.primary_theme,
			secondary_theme = excluded.secondary_theme,
			overall_conviction = excluded.overall_conviction,
			executive_summary = excluded.executive_summary,
			analyst_memo_markdown = excluded.analyst_memo_markdown,
			chairman_memo_markdown = excluded.chairman_memo_markdown,
			asset_class_targets_json = excluded.asset_class_targets_json,
			raw_result_json = excluded.raw_result_json,
			updated_at = CURRENT_TIMESTAMP
	`, request.MemoJobID, strings.TrimSpace(request.RunID), strings.TrimSpace(request.Mode),
		strings.TrimSpace(request.Status), strings.TrimSpace(request.Model), strings.TrimSpace(request.AnalysisDate),
		strings.TrimSpace(request.PrimaryTheme), strings.TrimSpace(request.SecondaryTheme),
		strings.TrimSpace(request.OverallConviction), strings.TrimSpace(request.ExecutiveSummary),
		strings.TrimSpace(request.AnalystMemoMarkdown), strings.TrimSpace(request.ChairmanMemoMarkdown),
		assetClassTargetsJSON, rawResultJSON)
	if err != nil {
		return nil, err
	}
	return loadPortfolioMemoRunByJobID(ctx, request.MemoJobID)
}

func loadLatestPortfolioMemoRun(ctx context.Context) (*portfolioMemoRun, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, memo_job_id, run_id, mode, status, model, analysis_date,
		       primary_theme, secondary_theme, overall_conviction, executive_summary,
		       analyst_memo_markdown, chairman_memo_markdown, asset_class_targets_json,
		       created_at, updated_at
		FROM portfolio_memo_runs
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
	`)
	return scanPortfolioMemoRun(row)
}

func loadPortfolioMemoRunByJobID(ctx context.Context, memoJobID string) (*portfolioMemoRun, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, memo_job_id, run_id, mode, status, model, analysis_date,
		       primary_theme, secondary_theme, overall_conviction, executive_summary,
		       analyst_memo_markdown, chairman_memo_markdown, asset_class_targets_json,
		       created_at, updated_at
		FROM portfolio_memo_runs
		WHERE memo_job_id = ?
	`, strings.TrimSpace(memoJobID))
	return scanPortfolioMemoRun(row)
}

type portfolioMemoScanner interface {
	Scan(dest ...interface{}) error
}

func scanPortfolioMemoRun(row portfolioMemoScanner) (*portfolioMemoRun, error) {
	var memo portfolioMemoRun
	var targetsJSON string
	if err := row.Scan(&memo.ID, &memo.MemoJobID, &memo.RunID, &memo.Mode, &memo.Status,
		&memo.Model, &memo.AnalysisDate, &memo.PrimaryTheme, &memo.SecondaryTheme,
		&memo.OverallConviction, &memo.ExecutiveSummary, &memo.AnalystMemoMarkdown,
		&memo.ChairmanMemoMarkdown, &targetsJSON, &memo.CreatedAt, &memo.UpdatedAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(targetsJSON), &memo.AssetClassTargets)
	if memo.AssetClassTargets == nil {
		memo.AssetClassTargets = []map[string]interface{}{}
	}
	return &memo, nil
}

func buildPortfolioMemoContextForNewsPrompt(memo *portfolioMemoRun) string {
	if memo == nil {
		return "- none"
	}
	sections := []string{
		"Memo job: " + memo.MemoJobID,
		"Council run: " + memo.RunID,
		"Analysis date: " + memo.AnalysisDate,
		"Primary theme: " + memo.PrimaryTheme,
		"Secondary theme: " + memo.SecondaryTheme,
		"Overall conviction: " + memo.OverallConviction,
		"Executive summary: " + memo.ExecutiveSummary,
		"Asset-class targets JSON: " + mustJSON(memo.AssetClassTargets),
		"Analyst memo: " + truncatePromptText(memo.AnalystMemoMarkdown, 5000),
		"Chairman memo: " + truncatePromptText(memo.ChairmanMemoMarkdown, 3500),
	}
	return strings.Join(sections, "\n")
}

func truncatePromptText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return strings.TrimSpace(value[:limit]) + "\n[truncated]"
}
