package portfoliomix

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func setupSnapshotStoreTestDB(t *testing.T) *sql.DB {
	t.Helper()

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	_, err = db.Exec(`
		CREATE TABLE portfolio_mix_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			status TEXT NOT NULL,
			reason TEXT,
			source_rebalance_plan_id INTEGER,
			notes TEXT,
			approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE portfolio_mix_snapshot_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			snapshot_id INTEGER NOT NULL,
			asset_class TEXT NOT NULL,
			display_name TEXT NOT NULL,
			display_order INTEGER NOT NULL,
			governed_by_q1 BOOLEAN NOT NULL,
			weight_pct REAL NOT NULL
		);
	`)
	if err != nil {
		t.Fatalf("create schema: %v", err)
	}
	return db
}

func TestStoreLoadLatestApprovedEmpty(t *testing.T) {
	store := Store{DB: setupSnapshotStoreTestDB(t)}

	snapshot, rows, err := store.LoadLatestApproved(context.Background())
	if err != nil {
		t.Fatalf("LoadLatestApproved: %v", err)
	}
	if snapshot != nil {
		t.Fatalf("snapshot = %#v, want nil", snapshot)
	}
	if len(rows) != 0 {
		t.Fatalf("rows len = %d, want 0", len(rows))
	}
}

func TestStoreCreateApprovedSupersedesExistingAndSkipsNegativeRows(t *testing.T) {
	db := setupSnapshotStoreTestDB(t)
	store := Store{DB: db}
	ctx := context.Background()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	sourceID := int64(42)
	first, firstRows, err := store.CreateApprovedTx(ctx, tx, CreateSnapshotInput{
		Reason:       "",
		SourcePlanID: &sourceID,
		Notes:        " initial ",
		Rows: []Row{
			{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", DisplayOrder: 10, GovernedByQ1: true, WeightPct: 22.1},
			{AssetClass: "BAD", DisplayName: "Bad", DisplayOrder: 99, WeightPct: -1},
		},
	})
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit first: %v", err)
	}
	if first.Reason != "DISCRETIONARY" || first.Notes != "initial" || first.SourceRebalancePlanID == nil || *first.SourceRebalancePlanID != sourceID {
		t.Fatalf("first snapshot = %#v", first)
	}
	if len(firstRows) != 1 || firstRows[0].AssetClass != "GOLD_MINERS" {
		t.Fatalf("first rows = %#v, want one GOLD_MINERS row", firstRows)
	}
	store.Now = func() time.Time { return NextApprovalAt(*first.ApprovedAt) }

	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin second tx: %v", err)
	}
	second, rows, err := store.CreateApprovedTx(ctx, tx, CreateSnapshotInput{
		Reason: "MANUAL",
		Rows: []Row{
			{AssetClass: "PHARMA_BIOTECH", DisplayName: "Pharma & Biotech", DisplayOrder: 20, WeightPct: 13.5},
			{AssetClass: "CASH", DisplayName: "Cash/Reserve", DisplayOrder: 999, WeightPct: 5},
		},
	})
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit second: %v", err)
	}
	if second.ID == first.ID {
		t.Fatalf("second id = first id = %d", second.ID)
	}
	if len(rows) != 2 || rows[0].AssetClass != "PHARMA_BIOTECH" || rows[1].AssetClass != "CASH" {
		t.Fatalf("second rows = %#v", rows)
	}

	var oldStatus string
	if err := db.QueryRow(`SELECT status FROM portfolio_mix_snapshots WHERE id = ?`, first.ID).Scan(&oldStatus); err != nil {
		t.Fatalf("load old status: %v", err)
	}
	if oldStatus != "SUPERSEDED" {
		t.Fatalf("old status = %q, want SUPERSEDED", oldStatus)
	}

	latest, latestRows, err := store.LoadLatestApproved(ctx)
	if err != nil {
		t.Fatalf("LoadLatestApproved: %v", err)
	}
	if latest.ID != second.ID || len(latestRows) != 2 {
		t.Fatalf("latest = %#v rows=%#v, want second snapshot", latest, latestRows)
	}
}
