package main

import (
	"database/sql"
	"testing"
)

func setupOverlayReadOnlyTestDB(t *testing.T) {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	testDB.SetMaxOpenConns(1)

	_, err = testDB.Exec(`
		CREATE TABLE overlay_signal_state (
			id INTEGER PRIMARY KEY CHECK(id = 1),
			current_q1_exposure_pct REAL NOT NULL DEFAULT 100,
			last_applied_q1_exposure_pct REAL NOT NULL DEFAULT 100,
			spy_q1_exposure_pct REAL DEFAULT 100,
			xao_q1_exposure_pct REAL DEFAULT 100,
			governing_source TEXT DEFAULT 'SPY',
			last_signal_changed_at DATETIME,
			last_applied_at DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE overlay_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			from_q1_exposure_pct REAL,
			to_q1_exposure_pct REAL,
			status TEXT,
			stage1_applied_at DATETIME,
			baseline_accepted_at DATETIME,
			notes TEXT
		);
	`)
	if err != nil {
		t.Fatalf("create test tables: %v", err)
	}

	db = testDB
	t.Cleanup(func() {
		db = previousDB
		testDB.Close()
	})
}

// The read-only loader must not initialise a missing state row — that is the
// contract that keeps GET /api/portfolio-overlay-summary side-effect free.
func TestReadOnlyLoadDoesNotInitMissingRow(t *testing.T) {
	setupOverlayReadOnlyTestDB(t)

	state, err := loadOverlaySignalStateReadOnly(78, 78, 78, "SPY")
	if err != nil {
		t.Fatalf("read-only load: %v", err)
	}
	if state.CurrentQ1ExposurePct != 78 || state.LastAppliedQ1ExposurePct != 100 {
		t.Fatalf("unexpected default state: %+v", state)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM overlay_signal_state`).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("read-only load must not insert a state row, found %d", count)
	}
}

// A drifted "implicit self-baseline" state (current == last_applied < 100
// with no accepted event) triggers a repair write in loadOrInit. The
// read-only loader must return it untouched and leave the row unmodified.
func TestReadOnlyLoadDoesNotRepairDriftedState(t *testing.T) {
	setupOverlayReadOnlyTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO overlay_signal_state (
			id, current_q1_exposure_pct, last_applied_q1_exposure_pct,
			spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source
		) VALUES (1, 78, 78, 78, 78, 'SPY')`); err != nil {
		t.Fatalf("seed state: %v", err)
	}

	state, err := loadOverlaySignalStateReadOnly(78, 78, 78, "SPY")
	if err != nil {
		t.Fatalf("read-only load: %v", err)
	}
	if state.LastAppliedQ1ExposurePct != 78 {
		t.Fatalf("read-only load altered returned state: %+v", state)
	}

	var lastApplied float64
	if err := db.QueryRow(`SELECT last_applied_q1_exposure_pct FROM overlay_signal_state WHERE id = 1`).Scan(&lastApplied); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if lastApplied != 78 {
		t.Fatalf("read-only load wrote to the state row: last_applied=%v", lastApplied)
	}

	// Contrast: loadOrInit DOES repair this drift (sanity check that the
	// fixture actually represents the repairable condition).
	repaired, _, err := loadOrInitOverlaySignalState(78, 78, 78, "SPY")
	if err != nil {
		t.Fatalf("loadOrInit: %v", err)
	}
	if repaired.LastAppliedQ1ExposurePct != 100 {
		t.Fatalf("expected loadOrInit to repair self-baseline, got %+v", repaired)
	}
}
