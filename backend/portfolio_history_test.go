package main

import (
	"context"
	"database/sql"
	"testing"
)

func setupPortfolioHistoryTestDB(t *testing.T) func() {
	t.Helper()
	previousDB := db
	testDB, err := sql.Open("sqlite3", "file:portfolio_history_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatalf("open portfolio history test db: %v", err)
	}
	testDB.SetMaxOpenConns(4)
	db = testDB

	_, err = db.Exec(`
		CREATE TABLE portfolio_rebalance_plans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			status TEXT NOT NULL,
			driver TEXT NOT NULL,
			title TEXT,
			notes TEXT,
			memo_job_id TEXT,
			source_snapshot_id INTEGER,
			created_at DATETIME,
			updated_at DATETIME,
			completed_at DATETIME,
			approved_at DATETIME
		);
		CREATE TABLE portfolio_rebalance_plan_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			plan_id INTEGER NOT NULL,
			asset_class TEXT NOT NULL,
			display_name TEXT NOT NULL,
			display_order INTEGER,
			governed_by_q1 BOOLEAN,
			current_weight_pct REAL,
			target_weight_pct REAL,
			recorded_move_value REAL,
			note TEXT
		);
		CREATE TABLE portfolio_mix_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			status TEXT NOT NULL,
			reason TEXT,
			source_rebalance_plan_id INTEGER,
			notes TEXT,
			approved_at DATETIME,
			created_at DATETIME
		);
		CREATE TABLE portfolio_mix_snapshot_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			snapshot_id INTEGER NOT NULL,
			asset_class TEXT NOT NULL,
			display_name TEXT NOT NULL,
			display_order INTEGER,
			governed_by_q1 BOOLEAN,
			weight_pct REAL
		);
		CREATE TABLE portfolio_daily_snapshots (
			statement_id INTEGER PRIMARY KEY,
			observed_at DATETIME NOT NULL,
			total_value_aud REAL NOT NULL,
			invested_value_aud REAL NOT NULL,
			statement_cash_aud REAL NOT NULL,
			sleeve_cash_aud REAL NOT NULL,
			residual_cash_aud REAL NOT NULL,
			holdings_count INTEGER NOT NULL,
			source TEXT
		);
		CREATE TABLE asset_class_daily_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			statement_id INTEGER NOT NULL,
			observed_at DATETIME NOT NULL,
			asset_class TEXT NOT NULL,
			display_name TEXT NOT NULL,
			invested_value_aud REAL NOT NULL,
			cash_value_aud REAL NOT NULL,
			total_value_aud REAL NOT NULL,
			portfolio_weight_pct REAL NOT NULL,
			source TEXT
		);
	`)
	if err != nil {
		db = previousDB
		testDB.Close()
		t.Fatalf("create portfolio history tables: %v", err)
	}
	if err := ensurePortfolioMemoSchema(); err != nil {
		db = previousDB
		testDB.Close()
		t.Fatalf("create portfolio memo tables: %v", err)
	}

	return func() {
		db = previousDB
		testDB.Close()
	}
}

func TestLoadPortfolioHistoryLinksMemoTargetShapeAndActual(t *testing.T) {
	cleanup := setupPortfolioHistoryTestDB(t)
	defer cleanup()

	_, err := persistPortfolioMemoRun(context.Background(), portfolioMemoPersistRequest{
		MemoJobID:         "memo-history-1",
		RunID:             "run-history-1",
		Status:            "succeeded",
		AnalysisDate:      "2026-08-20T08:00:00Z",
		PrimaryTheme:      "Resource leadership",
		ExecutiveSummary:  "Increase exposure to resource producers.",
		AssetClassTargets: []map[string]interface{}{{"asset_class": "GOLD_MINERS", "display_name": "Gold Miners", "target_pct": 25.0}},
	})
	if err != nil {
		t.Fatalf("persist memo: %v", err)
	}

	result, err := db.Exec(`
		INSERT INTO portfolio_rebalance_plans (
			status, driver, title, notes, memo_job_id, created_at, updated_at, completed_at, approved_at
		) VALUES ('APPROVED', 'MEMO', 'August target', 'Accepted after review', 'memo-history-1',
			'2026-08-20 09:00:00', '2026-08-21 10:00:00', '2026-08-21 09:00:00', '2026-08-21 10:00:00')
	`)
	if err != nil {
		t.Fatalf("insert plan: %v", err)
	}
	planID, _ := result.LastInsertId()
	if _, err := db.Exec(`
		INSERT INTO portfolio_rebalance_plan_rows (
			plan_id, asset_class, display_name, display_order, governed_by_q1,
			current_weight_pct, target_weight_pct, recorded_move_value, note
		) VALUES (?, 'GOLD_MINERS', 'Gold Miners', 1, 1, 20, 25, 500, '')
	`, planID); err != nil {
		t.Fatalf("insert plan row: %v", err)
	}

	snapshotResult, err := db.Exec(`
		INSERT INTO portfolio_mix_snapshots (
			status, reason, source_rebalance_plan_id, notes, approved_at, created_at
		) VALUES ('APPROVED', 'MEMO', ?, 'Approved August target', '2026-08-21 10:00:00', '2026-08-21 10:00:00')
	`, planID)
	if err != nil {
		t.Fatalf("insert snapshot: %v", err)
	}
	snapshotID, _ := snapshotResult.LastInsertId()
	if _, err := db.Exec(`
		INSERT INTO portfolio_mix_snapshot_rows (
			snapshot_id, asset_class, display_name, display_order, governed_by_q1, weight_pct
		) VALUES (?, 'GOLD_MINERS', 'Gold Miners', 1, 1, 25)
	`, snapshotID); err != nil {
		t.Fatalf("insert snapshot row: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO portfolio_daily_snapshots (
			statement_id, observed_at, total_value_aud, invested_value_aud,
			statement_cash_aud, sleeve_cash_aud, residual_cash_aud, holdings_count, source
		) VALUES (41, '2026-08-19 08:00:00', 100000, 90000, 10000, 0, 10000, 8, 'STATEMENT')
	`); err != nil {
		t.Fatalf("insert actual snapshot: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO asset_class_daily_snapshots (
			statement_id, observed_at, asset_class, display_name, invested_value_aud,
			cash_value_aud, total_value_aud, portfolio_weight_pct, source
		) VALUES (41, '2026-08-19 08:00:00', 'GOLD_MINERS', 'Gold Miners', 25000, 0, 25000, 25, 'STATEMENT')
	`); err != nil {
		t.Fatalf("insert actual class row: %v", err)
	}

	entries, err := loadPortfolioHistory(context.Background(), 20)
	if err != nil {
		t.Fatalf("load portfolio history: %v", err)
	}
	if len(entries) != 4 {
		t.Fatalf("entries = %d, want 4: %#v", len(entries), entries)
	}

	var memoEntry, targetEntry, shapeEntry, actualEntry *portfolioHistoryEntry
	for i := range entries {
		switch entries[i].Kind {
		case "memo":
			memoEntry = &entries[i]
		case "target":
			targetEntry = &entries[i]
		case "shape":
			shapeEntry = &entries[i]
		case "actual":
			actualEntry = &entries[i]
		}
	}
	if memoEntry == nil || memoEntry.PlanID == nil || *memoEntry.PlanID != planID {
		t.Fatalf("memo linkage = %#v, want plan %d", memoEntry, planID)
	}
	if len(memoEntry.Rows) != 1 || memoEntry.Rows[0].WeightPct != 25 {
		t.Fatalf("memo rows = %#v, want 25%% gold", memoEntry.Rows)
	}
	if memoEntry.TotalValue == nil || *memoEntry.TotalValue != 100000 || memoEntry.ValueBasisAt == "" {
		t.Fatalf("memo value basis = %#v / %q, want $100,000 historical basis", memoEntry.TotalValue, memoEntry.ValueBasisAt)
	}
	for _, entry := range []*portfolioHistoryEntry{targetEntry, shapeEntry} {
		if entry == nil || entry.MemoJobID != "memo-history-1" {
			t.Fatalf("source memo linkage missing: %#v", entry)
		}
		if entry == nil || entry.TotalValue == nil || *entry.TotalValue != 100000 || entry.ValueBasisAt == "" {
			t.Fatalf("historical value basis = %#v, want $100,000 basis on target and shape", entry)
		}
	}
	if actualEntry == nil || len(actualEntry.Rows) != 2 {
		t.Fatalf("actual entry = %#v, want asset class plus cash", actualEntry)
	}
	if actualEntry.Rows[1].AssetClass != "CASH" || actualEntry.Rows[1].WeightPct != 10 {
		t.Fatalf("actual cash row = %#v, want 10%%", actualEntry.Rows[1])
	}
	page, err := loadPortfolioShapeHistory(context.Background(), 1, 0)
	if err != nil || len(page.Entries) != 1 || page.Entries[0].MemoJobID != "memo-history-1" {
		t.Fatalf("paginated approval lost memo provenance: %#v, %v", page, err)
	}
}

func TestPortfolioHistoryDoesNotInferManualApprovalMemo(t *testing.T) {
	cleanup := setupPortfolioHistoryTestDB(t)
	defer cleanup()
	job, err := portfolioHistoryMemoForPlan(context.Background(), nil)
	if err != nil || job != "" {
		t.Fatalf("manual approval must not acquire a memo: %q, %v", job, err)
	}
}
