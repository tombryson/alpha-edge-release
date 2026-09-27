package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCDFSetupRequiresInitialState(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/alerts/active/setup",
		bytes.NewBufferString(`{"ticker":"ASX:AEVT","script":"cdf"}`),
	)
	response := httptest.NewRecorder()
	setupActiveAlert(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("missing-state setup status = %d: %s", response.Code, response.Body.String())
	}

	var activeAlertCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM active_alerts`).Scan(&activeAlertCount); err != nil {
		t.Fatalf("count active alerts: %v", err)
	}
	if activeAlertCount != 0 {
		t.Fatalf("missing-state setup registered %d active alerts, want none", activeAlertCount)
	}
}
