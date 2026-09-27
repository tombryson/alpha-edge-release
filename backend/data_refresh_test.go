package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDataRefreshDueHonoursCadenceAndRetryPolicy(t *testing.T) {
	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)

	if dataRefreshDue(now, true, 13, "DAILY", nil) {
		t.Fatal("refresh became due before its configured UTC hour")
	}
	if !dataRefreshDue(now, true, 10, "DAILY", nil) {
		t.Fatal("never-run daily refresh was not due")
	}
	if dataRefreshDue(now, false, 10, "DAILY", nil) {
		t.Fatal("disabled refresh became due")
	}

	sameDay := &dataRefreshRun{Status: dataRefreshStatusComplete, StartedAt: "2026-08-27 10:00:00"}
	if dataRefreshDue(now, true, 10, "DAILY", sameDay) {
		t.Fatal("completed daily refresh was scheduled twice on the same day")
	}

	partialTooRecent := &dataRefreshRun{Status: dataRefreshStatusPartial, StartedAt: "2026-08-27 11:00:01"}
	if dataRefreshDue(now, true, 10, "DAILY", partialTooRecent) {
		t.Fatal("partial refresh retried before the two-hour backoff")
	}
	partialReady := &dataRefreshRun{Status: dataRefreshStatusPartial, StartedAt: "2026-08-27 09:59:59"}
	if !dataRefreshDue(now, true, 10, "DAILY", partialReady) {
		t.Fatal("partial refresh did not retry after the two-hour backoff")
	}
	skippedReady := &dataRefreshRun{Status: dataRefreshStatusSkipped, StartedAt: "2026-08-27 09:59:59"}
	if !dataRefreshDue(now, true, 10, "DAILY", skippedReady) {
		t.Fatal("skipped refresh did not recheck prerequisites after the two-hour backoff")
	}

	weeklyTooRecent := &dataRefreshRun{Status: dataRefreshStatusComplete, StartedAt: "2026-08-21 12:00:01"}
	if dataRefreshDue(now, true, 10, "WEEKLY", weeklyTooRecent) {
		t.Fatal("weekly verification ran before seven days elapsed")
	}
	weeklyReady := &dataRefreshRun{Status: dataRefreshStatusComplete, StartedAt: "2026-08-20 11:59:59"}
	if !dataRefreshDue(now, true, 10, "WEEKLY", weeklyReady) {
		t.Fatal("weekly verification was not due after seven days")
	}
}

func TestDataRefreshLeaseAndLastGoodEvidencePersist(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	ctx := context.Background()
	now := time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC)
	runID, acquired, err := beginDataRefreshRun(ctx, dataRefreshAnalysisPriceHistory, "TEST", now)
	if err != nil || !acquired {
		t.Fatalf("acquire first refresh lease: acquired=%v err=%v", acquired, err)
	}
	if _, acquired, err := beginDataRefreshRun(ctx, dataRefreshAnalysisPriceHistory, "TEST", now.Add(time.Minute)); err != nil || acquired {
		t.Fatalf("duplicate refresh lease: acquired=%v err=%v", acquired, err)
	}

	freshThrough := "2026-08-26"
	if err := finishDataRefreshRun(ctx, runID, dataRefreshExecutionResult{
		DataFreshThrough: &freshThrough,
		ExpectedCount:    10,
		UpdatedCount:     10,
	}); err != nil {
		t.Fatalf("finish refresh: %v", err)
	}

	failedID, acquired, err := beginDataRefreshRun(ctx, dataRefreshAnalysisPriceHistory, "TEST", now.Add(3*time.Hour))
	if err != nil || !acquired {
		t.Fatalf("acquire later refresh lease: acquired=%v err=%v", acquired, err)
	}
	if err := finishDataRefreshRun(ctx, failedID, dataRefreshExecutionResult{
		ExpectedCount: 10,
		Errors:        []string{"provider unavailable"},
	}); err != nil {
		t.Fatalf("finish failed refresh: %v", err)
	}

	latest, err := loadLatestDataRefreshRun(ctx, dataRefreshAnalysisPriceHistory)
	if err != nil {
		t.Fatalf("load latest refresh: %v", err)
	}
	if latest == nil || latest.Status != dataRefreshStatusFailed {
		t.Fatalf("latest status = %#v, want FAILED", latest)
	}
	if latest.LastSuccessAt == nil || latest.DataFreshThrough == nil || *latest.DataFreshThrough != freshThrough {
		t.Fatalf("last-good evidence was not retained: %#v", latest)
	}
}

func TestRegimeReturnsGETOnlyReadsPersistedState(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	originalFetcher := regimeReturnsFetcher
	called := false
	regimeReturnsFetcher = func(context.Context, string) (map[string]float64, string, error) {
		called = true
		return nil, "", nil
	}
	defer func() { regimeReturnsFetcher = originalFetcher }()

	request := httptest.NewRequest("GET", "/api/regimes/returns", nil)
	response := httptest.NewRecorder()
	getRegimeReturns(response, request)

	if response.Code != 200 {
		t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
	}
	if called {
		t.Fatal("GET /api/regimes/returns called the Yahoo provider")
	}
	if got := response.Header().Get("X-Data-Freshness-Status"); got != dataRefreshStatusNeverRun {
		t.Fatalf("freshness status = %q, want %q", got, dataRefreshStatusNeverRun)
	}
}

func TestDataFreshnessEndpointReturnsOperationalFamilies(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	request := httptest.NewRequest("GET", "/api/data-freshness", nil)
	response := httptest.NewRecorder()
	getDataFreshness(response, request)
	if response.Code != 200 {
		t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
	}

	var payload dataFreshnessResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode freshness response: %v", err)
	}
	if len(payload.Datasets) != len(dataRefreshDatasetDefinitions) {
		t.Fatalf("dataset count = %d, want %d", len(payload.Datasets), len(dataRefreshDatasetDefinitions))
	}
	foundAnalysis := false
	foundStatements := false
	for _, dataset := range payload.Datasets {
		switch dataset.Dataset {
		case dataRefreshAnalysisPriceHistory:
			foundAnalysis = true
			if dataset.Status != dataRefreshStatusNeverRun || dataset.Source != "YAHOO" {
				t.Fatalf("analysis freshness = %#v", dataset)
			}
		case dataRefreshBrokerStatements:
			foundStatements = true
		}
	}
	if !foundAnalysis || !foundStatements {
		t.Fatalf("missing required datasets: analysis=%v statements=%v", foundAnalysis, foundStatements)
	}
}
