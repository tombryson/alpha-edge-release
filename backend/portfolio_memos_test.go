package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func TestPortfolioMemoRunPersistenceUpsertsLatest(t *testing.T) {
	cleanup := setupNewsNarrativeTestDB(t)
	defer cleanup()

	if err := ensurePortfolioMemoSchema(); err != nil {
		t.Fatalf("create portfolio memo tables: %v", err)
	}

	memo, err := persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:         "portfolio_job_1",
		RunID:             "run_1",
		Mode:              "DEEP",
		Status:            "succeeded",
		Model:             "council-test",
		AnalysisDate:      "2026-06-09",
		PrimaryTheme:      "Inflationary late-cycle expansion",
		ExecutiveSummary:  "Energy and gold remain core macro allocations.",
		AssetClassTargets: []map[string]interface{}{{"asset_class": "ENERGY_PRODUCERS", "target_pct": 30}},
	})
	if err != nil {
		t.Fatalf("persist portfolio memo: %v", err)
	}
	if memo.MemoJobID != "portfolio_job_1" || memo.PrimaryTheme != "Inflationary late-cycle expansion" {
		t.Fatalf("memo = %#v, want persisted summary", memo)
	}
	if len(memo.AssetClassTargets) != 1 {
		t.Fatalf("asset targets = %#v, want one target", memo.AssetClassTargets)
	}

	memo, err = persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:        "portfolio_job_1",
		RunID:            "run_2",
		Mode:             "DEEP",
		Status:           "succeeded",
		Model:            "council-test",
		AnalysisDate:     "2026-06-10",
		PrimaryTheme:     "Oil shock tail risk",
		ExecutiveSummary: "Updated macro allocation memo.",
	})
	if err != nil {
		t.Fatalf("upsert portfolio memo: %v", err)
	}
	if memo.RunID != "run_2" || memo.PrimaryTheme != "Oil shock tail risk" {
		t.Fatalf("upserted memo = %#v, want latest values", memo)
	}

	latest, err := loadLatestPortfolioMemoRun(context.Background())
	if err != nil {
		t.Fatalf("load latest memo: %v", err)
	}
	if latest.MemoJobID != "portfolio_job_1" || latest.RunID != "run_2" {
		t.Fatalf("latest memo = %#v, want upserted memo", latest)
	}
}

func TestPortfolioMemoHTTPHandlers(t *testing.T) {
	cleanup := setupNewsNarrativeTestDB(t)
	defer cleanup()

	payload := []byte(`{
		"memo_job_id": "portfolio_job_http",
		"run_id": "run_http",
		"mode": "DEEP",
		"status": "succeeded",
		"model": "council-test",
		"analysis_date": "2026-06-09",
		"primary_theme": "Inflation-aware positioning",
		"executive_summary": "Portfolio memo summary for news grounding.",
		"asset_class_targets": [{"asset_class":"GOLD_MINERS","target_pct":22}]
	}`)

	saveRequest := httptest.NewRequest(http.MethodPost, "/api/portfolio-memos", bytes.NewReader(payload))
	saveRecorder := httptest.NewRecorder()
	savePortfolioMemoRun(saveRecorder, saveRequest)
	if saveRecorder.Code != http.StatusOK {
		t.Fatalf("save status = %d body=%s, want 200", saveRecorder.Code, saveRecorder.Body.String())
	}
	var saveResponse portfolioMemoResponse
	if err := json.Unmarshal(saveRecorder.Body.Bytes(), &saveResponse); err != nil {
		t.Fatalf("decode save response: %v", err)
	}
	if saveResponse.Memo == nil || saveResponse.Memo.MemoJobID != "portfolio_job_http" {
		t.Fatalf("save response = %#v, want saved memo", saveResponse)
	}

	getRequest := httptest.NewRequest(http.MethodGet, "/api/portfolio-memos/latest", nil)
	getRecorder := httptest.NewRecorder()
	getLatestPortfolioMemoRun(getRecorder, getRequest)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("latest status = %d body=%s, want 200", getRecorder.Code, getRecorder.Body.String())
	}
	var getResponse portfolioMemoResponse
	if err := json.Unmarshal(getRecorder.Body.Bytes(), &getResponse); err != nil {
		t.Fatalf("decode latest response: %v", err)
	}
	if getResponse.Memo == nil || getResponse.Memo.PrimaryTheme != "Inflation-aware positioning" {
		t.Fatalf("latest response = %#v, want saved memo", getResponse)
	}

	historyRequest := httptest.NewRequest(http.MethodGet, "/api/portfolio-memos/portfolio_job_http", nil)
	historyRequest = mux.SetURLVars(historyRequest, map[string]string{"jobId": "portfolio_job_http"})
	historyRecorder := httptest.NewRecorder()
	getPortfolioMemoRunByJobID(historyRecorder, historyRequest)
	if historyRecorder.Code != http.StatusOK {
		t.Fatalf("historical status = %d body=%s, want 200", historyRecorder.Code, historyRecorder.Body.String())
	}
	var historyResponse portfolioMemoResponse
	if err := json.Unmarshal(historyRecorder.Body.Bytes(), &historyResponse); err != nil {
		t.Fatalf("decode historical response: %v", err)
	}
	if historyResponse.Memo == nil || historyResponse.Memo.RunID != "run_http" {
		t.Fatalf("historical response = %#v, want saved run", historyResponse)
	}

	badRequest := httptest.NewRequest(http.MethodPost, "/api/portfolio-memos", bytes.NewReader([]byte(`{"run_id":"missing_job"}`)))
	badRecorder := httptest.NewRecorder()
	savePortfolioMemoRun(badRecorder, badRequest)
	if badRecorder.Code != http.StatusBadRequest {
		t.Fatalf("bad save status = %d, want 400", badRecorder.Code)
	}
}
