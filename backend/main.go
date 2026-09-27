package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	var err error
	loadAuthConfig()
	requireAuthConfig()
	if err := configureOwnerAccess(); err != nil {
		log.Fatal("Owner access configuration: ", err)
	}

	// Use environment variable for database path (for Fly.io volume)
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./trading.db"
	}

	// SQLite on Fly is volume-backed and can see short writer contention during rapid UI actions.
	// Receipts and processing markers must survive an abrupt machine restart after ACK.
	db, err = sql.Open("sqlite3", dbPath+"?_busy_timeout=15000&_journal_mode=WAL&_synchronous=FULL")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(0)

	backupDir := os.Getenv("DB_BACKUP_DIR")
	if backupDir == "" {
		backupDir = filepath.Join(filepath.Dir(dbPath), "backups")
	}
	upgradeContext, cancelUpgrade := context.WithTimeout(context.Background(), 2*time.Minute)
	err = initializeDatabase(upgradeContext, backupDir)
	cancelUpgrade()
	if err != nil {
		log.Fatal(err)
	}
	if err := initWebhookInbox(); err != nil {
		log.Fatal("Cannot initialise durable webhook inbox: ", err)
	}

	loadCORSConfig()

	router := newRouter()
	schedulerContext, stopSchedulers := context.WithCancel(context.Background())
	defer stopSchedulers()
	startDataRefreshAutomation(schedulerContext)
	startWebhookInboxWorker(schedulerContext)
	startSourceResearchWorker(schedulerContext)
	startWeightPolicyWorker(schedulerContext)
	startBackupScheduler(schedulerContext, dbPath)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("[ALPHA EDGE] Backend server running on :%s", port)
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	log.Fatal(server.ListenAndServe())
}
