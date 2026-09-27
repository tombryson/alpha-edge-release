package portfoliomix

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestApprovalCalendarBoundary(t *testing.T) {
	for _, pair := range [][2]string{
		{"2026-06-03T23:14:04Z", "2026-10-03T23:14:04Z"},
		{"2026-10-31T10:00:00Z", "2027-02-28T10:00:00Z"},
		{"2027-10-31T10:00:00Z", "2028-02-29T10:00:00Z"},
		{"2026-05-31T10:00:00Z", "2026-09-30T10:00:00Z"},
	} {
		start, _ := time.Parse(time.RFC3339, pair[0])
		end, _ := time.Parse(time.RFC3339, pair[1])
		if got := NextApprovalAt(start); !got.Equal(end) {
			t.Fatalf("%s: got %s want %s", start, got, end)
		}
		if Policy(&start, end.Add(-time.Nanosecond)).CanApprove {
			t.Fatal("allowed before boundary")
		}
		if !Policy(&start, end).CanApprove {
			t.Fatal("blocked at boundary")
		}
	}
	if !Policy(nil, time.Now()).CanApprove {
		t.Fatal("first approval should be allowed")
	}
}

func TestApprovalLockPersistsAndDoesNotSupersede(t *testing.T) {
	db := setupSnapshotStoreTestDB(t)
	now := time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)
	store := Store{DB: db, Now: func() time.Time { return now }}
	ctx := context.Background()
	tx, _ := db.Begin()
	first, _, err := store.CreateApprovedTx(ctx, tx, CreateSnapshotInput{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	// New store instance represents a process restart; no in-memory lock or reason bypass.
	for _, reason := range []string{"DISCRETIONARY", "MEMO", "Q3", "Q4", ""} {
		restarted := Store{DB: db, Now: func() time.Time { return now.AddDate(0, 3, 0) }}
		tx, _ := db.Begin()
		_, _, err = restarted.CreateApprovedTx(ctx, tx, CreateSnapshotInput{Reason: reason})
		var locked *ApprovalLockedError
		if !errors.As(err, &locked) {
			t.Fatalf("expected lock for %s, got %v", reason, err)
		}
		tx.Rollback()
	}
	latest, _, err := store.LoadLatestApproved(ctx)
	if err != nil || latest.ID != first.ID {
		t.Fatalf("changed approval: %#v %v", latest, err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM portfolio_mix_snapshots").Scan(&count); err != nil || count != 1 {
		t.Fatalf("unexpected writes: %d %v", count, err)
	}
	now = NextApprovalAt(now)
	tx, _ = db.Begin()
	if _, _, err := store.CreateApprovedTx(ctx, tx, CreateSnapshotInput{}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var status string
	db.QueryRow("SELECT status FROM portfolio_mix_snapshots WHERE id = ?", first.ID).Scan(&status)
	if status != "SUPERSEDED" {
		t.Fatalf("unexpected status %s", status)
	}
}
