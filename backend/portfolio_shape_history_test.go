package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestPortfolioShapeHistoryPagesOnlyCompletedApprovals(t *testing.T) {
	cleanup := setupPortfolioHistoryTestDB(t)
	defer cleanup()
	for _, status := range []string{"SUPERSEDED", "DRAFT", "SUPERSEDED", "APPROVED"} {
		result, err := db.Exec(`INSERT INTO portfolio_mix_snapshots (status, approved_at, created_at)
            VALUES (?, '2026-06-01 10:00:00', '2026-06-01 10:00:00')`, status)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := result.LastInsertId()
		if _, err := db.Exec(`INSERT INTO portfolio_mix_snapshot_rows (snapshot_id, asset_class, display_name, display_order, governed_by_q1, weight_pct)
            VALUES (?, 'GOLD_MINERS', 'Gold Miners', 1, 1, 100)`, id); err != nil {
			t.Fatal(err)
		}
	}
	first, err := loadPortfolioShapeHistory(context.Background(), 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if first.Kind != "shape" || len(first.Entries) != 2 || first.NextBeforeID == nil || *first.NextBeforeID != 3 {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if *first.Entries[0].SnapshotID != 4 || first.Entries[0].Rows[0].WeightPct != 100 {
		t.Fatalf("unexpected snapshot data: %#v", first.Entries)
	}
	// A new approval must not shift or duplicate the already established cursor.
	if _, err := db.Exec(`INSERT INTO portfolio_mix_snapshots (status, approved_at, created_at)
        VALUES ('APPROVED', '2026-06-02 10:00:00', '2026-06-02 10:00:00')`); err != nil {
		t.Fatal(err)
	}
	second, err := loadPortfolioShapeHistory(context.Background(), 2, *first.NextBeforeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Entries) != 1 || second.NextBeforeID != nil || *second.Entries[0].SnapshotID != 1 {
		t.Fatalf("unexpected second page: %#v", second)
	}
	last, err := loadPortfolioShapeHistory(context.Background(), 2, 1)
	if err != nil || len(last.Entries) != 0 || last.NextBeforeID != nil {
		t.Fatalf("unexpected end: %#v %v", last, err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM portfolio_mix_snapshots").Scan(&count); err != nil || count != 5 {
		t.Fatalf("archive read changed records: count=%d err=%v", count, err)
	}
}

func TestPortfolioShapeHistoryHTTPValidationAndEmptyResponse(t *testing.T) {
	cleanup := setupPortfolioHistoryTestDB(t)
	defer cleanup()
	for _, query := range []string{"kind=actual", "kind=shape&before_id=oops", "kind=shape&before_id=-1", "kind=shape&before_id=0"} {
		response := httptest.NewRecorder()
		getPortfolioHistory(response, httptest.NewRequest("GET", "/api/portfolio-history?"+query, nil))
		if response.Code != 400 {
			t.Fatalf("%s returned %d", query, response.Code)
		}
	}
	response := httptest.NewRecorder()
	getPortfolioHistory(response, httptest.NewRequest("GET", "/api/portfolio-history?kind=shape&limit=999", nil))
	if response.Code != 200 {
		t.Fatalf("empty archive returned %d: %s", response.Code, response.Body)
	}
	var body portfolioHistoryResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Kind != "shape" || body.Entries == nil || len(body.Entries) != 0 {
		t.Fatalf("unexpected empty response: %#v", body)
	}
}
