package portfoliorebalance

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	schema := `
		CREATE TABLE portfolio_rebalance_plans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			status TEXT NOT NULL DEFAULT 'OPEN',
			driver TEXT NOT NULL DEFAULT 'DISCRETIONARY',
			title TEXT,
			notes TEXT,
			memo_job_id TEXT,
			source_snapshot_id INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			completed_at DATETIME,
			approved_at DATETIME
		);
		CREATE TABLE portfolio_rebalance_plan_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			plan_id INTEGER NOT NULL,
			asset_class TEXT NOT NULL,
			display_name TEXT NOT NULL,
			display_order INTEGER DEFAULT 999,
			governed_by_q1 BOOLEAN DEFAULT 0,
			current_weight_pct REAL DEFAULT 0,
			target_weight_pct REAL DEFAULT 0,
			recorded_move_value REAL DEFAULT 0,
			note TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(plan_id, asset_class)
		);
	`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	return db
}

func TestStoreLoadCurrentEmpty(t *testing.T) {
	store := Store{DB: newTestDB(t)}
	plan, err := store.LoadCurrent(context.Background())
	if err != nil {
		t.Fatalf("LoadCurrent: %v", err)
	}
	if plan != nil {
		t.Fatalf("expected no current plan, got %#v", plan)
	}
}

func TestStoreCreateOpenSupersedesAndLoadsMaterialPlan(t *testing.T) {
	db := newTestDB(t)
	store := Store{DB: db}
	ctx := context.Background()
	sourceSnapshotID := int64(42)

	first, err := store.CreateOpen(ctx, CreateInput{
		Driver:           "memo",
		Title:            "Old target",
		SourceSnapshotID: &sourceSnapshotID,
		Rows: []PlanRow{
			{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", DisplayOrder: 10, CurrentWeightPct: 20, TargetWeightPct: 30, RecordedMoveValue: -5, Note: " old note "},
		},
	})
	if err != nil {
		t.Fatalf("CreateOpen first: %v", err)
	}
	if first == nil {
		t.Fatalf("expected first plan")
	}

	second, err := store.CreateOpen(ctx, CreateInput{
		Driver: "manual",
		Title:  " New target ",
		Notes:  " notes ",
		Rows: []PlanRow{
			{AssetClass: "SILVER_MINERS", DisplayName: "Silver Miners", DisplayOrder: 20, GovernedByQ1: true, CurrentWeightPct: 8, TargetWeightPct: 12, RecordedMoveValue: 150},
			{AssetClass: "", DisplayName: "Ignored", CurrentWeightPct: 1, TargetWeightPct: 2},
		},
	})
	if err != nil {
		t.Fatalf("CreateOpen second: %v", err)
	}
	if second == nil {
		t.Fatalf("expected second plan")
	}
	if second.ID == first.ID {
		t.Fatalf("expected a new plan id")
	}
	if second.Driver != "MANUAL" {
		t.Fatalf("driver = %q, want MANUAL", second.Driver)
	}
	if second.Title != "New target" || second.Notes != "notes" {
		t.Fatalf("title/notes not trimmed: %#v", second)
	}
	if second.SourceSnapshotID != nil {
		t.Fatalf("unexpected source snapshot id: %v", *second.SourceSnapshotID)
	}
	if len(second.Rows) != 1 {
		t.Fatalf("rows len = %d, want 1", len(second.Rows))
	}
	row := second.Rows[0]
	if row.AssetClass != "SILVER_MINERS" || row.DeltaWeightPct != 4 || !row.GovernedByQ1 || row.RecordedMoveValue != 150 {
		t.Fatalf("unexpected row: %#v", row)
	}

	var oldStatus string
	if err := db.QueryRow(`SELECT status FROM portfolio_rebalance_plans WHERE id = ?`, first.ID).Scan(&oldStatus); err != nil {
		t.Fatalf("old status query: %v", err)
	}
	if oldStatus != "SUPERSEDED" {
		t.Fatalf("old status = %q, want SUPERSEDED", oldStatus)
	}
}

func TestStoreCompleteMarkPartialAndApprove(t *testing.T) {
	db := newTestDB(t)
	store := Store{DB: db}
	ctx := context.Background()

	plan, err := store.CreateOpen(ctx, CreateInput{
		Driver: "manual",
		Rows: []PlanRow{
			{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", CurrentWeightPct: 20, TargetWeightPct: 30},
		},
	})
	if err != nil {
		t.Fatalf("CreateOpen: %v", err)
	}

	if err := store.Complete(ctx, plan.ID, []PlanRow{{AssetClass: "GOLD_MINERS", RecordedMoveValue: 250, Note: " done "}}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	loaded, err := store.LoadByID(ctx, plan.ID)
	if err != nil {
		t.Fatalf("LoadByID completed: %v", err)
	}
	if loaded.Status != "COMPLETED" || loaded.CompletedAt == nil {
		t.Fatalf("completed plan not marked: %#v", loaded)
	}
	if loaded.Rows[0].RecordedMoveValue != 250 || loaded.Rows[0].Note != "done" {
		t.Fatalf("row update not saved: %#v", loaded.Rows[0])
	}

	if err := store.MarkPartial(ctx, plan.ID); err != nil {
		t.Fatalf("MarkPartial: %v", err)
	}
	loaded, err = store.LoadByID(ctx, plan.ID)
	if err != nil {
		t.Fatalf("LoadByID partial: %v", err)
	}
	if loaded.Status != "PARTIAL" || loaded.CompletedAt != nil {
		t.Fatalf("partial plan not reopened: %#v", loaded)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin approve tx: %v", err)
	}
	if err := store.ApproveTx(ctx, tx, plan.ID); err != nil {
		t.Fatalf("ApproveTx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit approve tx: %v", err)
	}
	loaded, err = store.LoadByID(ctx, plan.ID)
	if err != nil {
		t.Fatalf("LoadByID approved: %v", err)
	}
	if loaded.Status != "APPROVED" || loaded.ApprovedAt == nil {
		t.Fatalf("approved plan not marked: %#v", loaded)
	}
}
