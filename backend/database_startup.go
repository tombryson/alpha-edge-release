package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync/atomic"

	"trading-backend/internal/database"
)

var managedSchema atomic.Pointer[sql.DB]

func databaseSchemaManaged() bool { return db != nil && managedSchema.Load() == db }

func initializeDatabase(ctx context.Context, backupDir string) error {
	plan, err := database.Migrate(ctx, db, database.Options{BackupDir: backupDir})
	if err != nil {
		return fmt.Errorf("database upgrade refused: %w", err)
	}
	managedSchema.Store(db)
	log.Printf("[DATABASE] Schema checked: previous version %d, applied %d migration(s), fresh=%t", plan.CurrentVersion, len(plan.Pending), plan.Fresh)
	return nil
}

// Existing isolated unit-test fixtures use this no-argument entry point.
func initDB() {
	if err := initializeDatabase(context.Background(), ""); err != nil {
		panic(err)
	}
}
