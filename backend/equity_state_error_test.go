package main

import (
	"context"
	"database/sql"
	"testing"
)

// DB failure and "detectors not connected" must be distinguishable: the first
// is an error, the second is the legitimate DISCONNECTED state (audit §1).
func TestEffectiveEquityStateDistinguishesDBFailureFromDisconnected(t *testing.T) {
	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	testDB.SetMaxOpenConns(1)
	db = testDB
	t.Cleanup(func() {
		db = previousDB
		testDB.Close()
	})

	// No equity_sizing table at all → query fails → must surface as error.
	_, _, _, governing, _, eqErr := getEffectiveEquityState(context.Background())
	if eqErr == nil {
		t.Fatal("expected error when equity_sizing query fails, got nil")
	}
	if governing != "DISCONNECTED" {
		t.Fatalf("expected DISCONNECTED fallback values with error, got %q", governing)
	}

	// Empty table → genuine disconnected state, NO error.
	if _, err := testDB.Exec(`CREATE TABLE equity_sizing (source_ticker TEXT PRIMARY KEY, target_equity_pct REAL, last_updated DATETIME)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	spy, xao, effective, governing, _, eqErr := getEffectiveEquityState(context.Background())
	if eqErr != nil {
		t.Fatalf("empty table is a valid disconnected state, got error: %v", eqErr)
	}
	if spy != -1 || xao != -1 || effective != -1 || governing != "DISCONNECTED" {
		t.Fatalf("expected -1/-1/-1/DISCONNECTED, got %v/%v/%v/%q", spy, xao, effective, governing)
	}

	// Populated table → normal resolution, no error.
	if _, err := testDB.Exec(`INSERT INTO equity_sizing (source_ticker, target_equity_pct) VALUES ('SPY', 78), ('XAO', 100)`); err != nil {
		t.Fatalf("seed rows: %v", err)
	}
	_, _, effective, governing, _, eqErr = getEffectiveEquityState(context.Background())
	if eqErr != nil {
		t.Fatalf("unexpected error: %v", eqErr)
	}
	if effective != 78 || governing != "SPY" {
		t.Fatalf("expected 78/SPY, got %v/%q", effective, governing)
	}
}
