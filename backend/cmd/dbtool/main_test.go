package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"trading-backend/internal/database"
)

func TestInvalidCommandsNeverCreateDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	for _, args := range [][]string{
		nil, {"unknown", "--db", path}, {"inspect"}, {"migrate", "--db", path},
		{"restore", "--db", path}, {"inspect", "--db", path, "--timeout", "0s"},
		{"inspect", "--db", path, "unexpected"},
	} {
		if err := run(args); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("created an unintended database")
	}
}

func TestCommandBackupRestoreAndReadOnlyPlan(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fixture.db")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := database.Migrate(context.Background(), db, database.Options{}); err != nil {
		t.Fatal(err)
	}
	backup, restored := filepath.Join(dir, "backup.db"), filepath.Join(dir, "restored.db")
	for _, args := range [][]string{
		{"inspect", "--db", path}, {"plan", "--db", path},
		{"backup", "--db", path, "--out", backup},
		{"restore", "--db", backup, "--out", restored},
		{"migrate", "--db", restored},
	} {
		if err := run(args); err != nil {
			t.Fatalf("%v: %v", args, err)
		}
	}
	if err := run([]string{"restore", "--db", backup, "--out", path}); err == nil {
		t.Fatal("restore overwrote existing database")
	}
}
