package main

import (
	"bytes"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gorilla/mux"
)

func setupSecurityIdentityTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	_, err = testDB.Exec(`
		CREATE TABLE holdings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			isin TEXT,
			ticker TEXT,
			company_name TEXT NOT NULL,
			exchange_prefix TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE statement_holdings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			details TEXT NOT NULL
		);
		CREATE TABLE stock_analysis (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ticker TEXT,
			name TEXT NOT NULL,
			council_run_id TEXT,
			is_watchlist BOOLEAN DEFAULT FALSE,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE company_mappings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			company_name TEXT NOT NULL UNIQUE,
			ticker TEXT NOT NULL,
			exchange_prefix TEXT NOT NULL DEFAULT '',
			template_id TEXT,
			enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE stock_group_assignments (
			company_name TEXT PRIMARY KEY,
			group_id TEXT NOT NULL,
			assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		testDB.Close()
		t.Fatalf("create identity test schema: %v", err)
	}

	db = testDB
	if err := ensureSecurityIdentitySchema(); err != nil {
		db = previousDB
		testDB.Close()
		t.Fatalf("initialize identity schema: %v", err)
	}

	return func() {
		db = previousDB
		testDB.Close()
	}
}

func TestSecurityIdentityPreservesAnalysisStateAcrossBrokerRename(t *testing.T) {
	cleanup := setupSecurityIdentityTestDB(t)
	defer cleanup()

	oldSecurity := securityIdentityCandidate{
		ISIN:           "AU0000000001",
		ExchangePrefix: "ASX:",
		Ticker:         "OLD",
		Name:           "Old Resources Limited",
	}

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin setup transaction: %v", err)
	}
	securityID, err := ensureSecurityIdentityTx(tx, oldSecurity, "broker_import", true)
	if err != nil {
		tx.Rollback()
		t.Fatalf("create old identity: %v", err)
	}
	_, err = tx.Exec(`
		INSERT INTO holdings (isin, ticker, company_name, exchange_prefix, security_id)
		VALUES (?, ?, ?, ?, ?)
	`, oldSecurity.ISIN, oldSecurity.Ticker, oldSecurity.Name, oldSecurity.ExchangePrefix, securityID)
	if err != nil {
		tx.Rollback()
		t.Fatalf("insert holding: %v", err)
	}
	_, err = tx.Exec(`
		INSERT INTO stock_analysis (ticker, name, council_run_id, security_id, is_watchlist)
		VALUES ('ASX:OLD', ?, 'council-42', ?, 0)
	`, oldSecurity.Name, securityID)
	if err != nil {
		tx.Rollback()
		t.Fatalf("insert analysis: %v", err)
	}
	_, err = tx.Exec(`
		INSERT INTO company_mappings (company_name, ticker, exchange_prefix, template_id, security_id)
		VALUES (?, 'OLD', 'ASX:', 'template-resources', ?)
	`, oldSecurity.Name, securityID)
	if err != nil {
		tx.Rollback()
		t.Fatalf("insert mapping: %v", err)
	}
	_, err = tx.Exec(`
		INSERT INTO stock_group_assignments (company_name, group_id, security_id)
		VALUES (?, 'resources', ?)
	`, oldSecurity.Name, securityID)
	if err != nil {
		tx.Rollback()
		t.Fatalf("insert group assignment: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit setup transaction: %v", err)
	}

	newSecurity := oldSecurity
	newSecurity.Name = "New Resources Limited"
	tx, err = db.Begin()
	if err != nil {
		t.Fatalf("begin rename transaction: %v", err)
	}
	resolvedSecurityID, err := ensureSecurityIdentityTx(tx, newSecurity, "broker_import", true)
	if err != nil {
		tx.Rollback()
		t.Fatalf("resolve renamed identity: %v", err)
	}
	if resolvedSecurityID != securityID {
		tx.Rollback()
		t.Fatalf("same ISIN created a new identity: got %d want %d", resolvedSecurityID, securityID)
	}
	if err := syncSecurityIdentityReferencesTx(tx, securityID, oldSecurity.Name, newSecurity); err != nil {
		tx.Rollback()
		t.Fatalf("synchronize renamed identity: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit rename transaction: %v", err)
	}

	var analysisName, councilRunID string
	var analysisSecurityID int64
	if err := db.QueryRow(`SELECT name, council_run_id, security_id FROM stock_analysis`).Scan(&analysisName, &councilRunID, &analysisSecurityID); err != nil {
		t.Fatalf("read analysis after rename: %v", err)
	}
	if analysisName != newSecurity.Name || councilRunID != "council-42" || analysisSecurityID != securityID {
		t.Fatalf("analysis state changed during rename: name=%q council=%q security=%d", analysisName, councilRunID, analysisSecurityID)
	}

	var templateID, groupID string
	var mappingSecurityID, groupSecurityID int64
	if err := db.QueryRow(`
		SELECT template_id, security_id
		FROM company_mappings
		WHERE company_name = ?
	`, newSecurity.Name).Scan(&templateID, &mappingSecurityID); err != nil {
		t.Fatalf("read renamed mapping: %v", err)
	}
	if err := db.QueryRow(`
		SELECT group_id, security_id
		FROM stock_group_assignments
		WHERE company_name = ?
	`, newSecurity.Name).Scan(&groupID, &groupSecurityID); err != nil {
		t.Fatalf("read renamed group assignment: %v", err)
	}
	if templateID != "template-resources" || mappingSecurityID != securityID {
		t.Fatalf("mapping state changed during rename: template=%q security=%d", templateID, mappingSecurityID)
	}
	if groupID != "resources" || groupSecurityID != securityID {
		t.Fatalf("group state changed during rename: group=%q security=%d", groupID, groupSecurityID)
	}

	var aliasCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM security_name_aliases WHERE security_id = ?`, securityID).Scan(&aliasCount); err != nil {
		t.Fatalf("count aliases: %v", err)
	}
	if aliasCount != 2 {
		t.Fatalf("alias history was not retained: got %d aliases want 2", aliasCount)
	}
}

func TestSecurityIdentityFallbackChecksISIN(t *testing.T) {
	for _, tc := range []struct {
		name, storedISIN, incomingISIN, ticker, nameOverride string
		conflict                                             bool
	}{
		{"ticker conflict", "AU0000000001", "AU0000000002", "ONE", "Different Company", true},
		{"alias conflict", "AU0000000001", "AU0000000002", "TWO", "Original Company", true},
		{"name only conflict", "AU0000000001", "AU0000000002", "", "Original Company", true},
		{"fill missing ISIN", "", "AU0000000002", "ONE", "Original Company", false},
		{"missing incoming ISIN", "AU0000000001", "", "ONE", "Original Company", false},
		{"normalized ISIN", "AU0000000001", " au0000000001 ", "ONE", "Original Company", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer setupSecurityIdentityTestDB(t)()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			id, err := ensureSecurityIdentityTx(tx, securityIdentityCandidate{
				ISIN: tc.storedISIN, ExchangePrefix: "ASX:", Ticker: "ONE", Name: "Original Company",
			}, "test", true)
			if err != nil {
				t.Fatal(err)
			}
			resolved, err := ensureSecurityIdentityTx(tx, securityIdentityCandidate{
				ISIN: tc.incomingISIN, ExchangePrefix: "ASX:", Ticker: tc.ticker, Name: tc.nameOverride,
			}, "test", true)
			if tc.conflict {
				if !errors.Is(err, errSecurityIdentityConflict) || resolved != 0 {
					t.Fatalf("expected identity conflict, got id=%d err=%v", resolved, err)
				}
				var canonical, isin string
				var aliasCount int
				if err := tx.QueryRow(`SELECT canonical_name, isin FROM security_identities WHERE id=?`, id).Scan(&canonical, &isin); err != nil {
					t.Fatal(err)
				}
				if err := tx.QueryRow(`SELECT COUNT(*) FROM security_name_aliases`).Scan(&aliasCount); err != nil {
					t.Fatal(err)
				}
				if canonical != "Original Company" || isin != tc.storedISIN || aliasCount != 1 {
					t.Fatal("conflicting fallback changed identity or aliases")
				}
			} else if err != nil || resolved != id {
				t.Fatalf("compatible fallback failed: id=%d want=%d err=%v", resolved, id, err)
			}
		})
	}
}

func TestSecurityIdentityLeavesAmbiguousHistoricalNamesUnlinked(t *testing.T) {
	cleanup := setupSecurityIdentityTestDB(t)
	defer cleanup()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin identity transaction: %v", err)
	}
	firstID, err := ensureSecurityIdentityTx(tx, securityIdentityCandidate{
		ISIN: "AU0000000002", ExchangePrefix: "ASX:", Ticker: "ONE", Name: "Shared Name Limited",
	}, "broker_import", true)
	if err != nil {
		tx.Rollback()
		t.Fatalf("create first identity: %v", err)
	}
	secondID, err := ensureSecurityIdentityTx(tx, securityIdentityCandidate{
		ISIN: "AU0000000003", ExchangePrefix: "ASX:", Ticker: "TWO", Name: "Another Company",
	}, "broker_import", true)
	if err != nil {
		tx.Rollback()
		t.Fatalf("create second identity: %v", err)
	}
	if err := addSecurityNameAliasTx(tx, secondID, "Shared Name Limited", "legacy_import"); err != nil {
		tx.Rollback()
		t.Fatalf("add ambiguous alias: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit identity transaction: %v", err)
	}

	if _, err := db.Exec(`INSERT INTO statement_holdings (details) VALUES ('Shared Name Limited')`); err != nil {
		t.Fatalf("insert historical holding: %v", err)
	}
	if err := backfillSecurityIdentityLinks(); err != nil {
		t.Fatalf("backfill historical identity links: %v", err)
	}

	var historicalSecurityID sql.NullInt64
	if err := db.QueryRow(`SELECT security_id FROM statement_holdings`).Scan(&historicalSecurityID); err != nil {
		t.Fatalf("read historical identity link: %v", err)
	}
	if historicalSecurityID.Valid {
		t.Fatalf("ambiguous historical name linked to security %d, expected no link (candidate IDs %d and %d)", historicalSecurityID.Int64, firstID, secondID)
	}
}

func TestManualAnalysisRenameKeepsBrokerHoldingNameAndRecordsAlias(t *testing.T) {
	cleanup := setupSecurityIdentityTestDB(t)
	defer cleanup()

	oldSecurity := securityIdentityCandidate{
		ISIN:           "AU0000000004",
		ExchangePrefix: "ASX:",
		Ticker:         "MNL",
		Name:           "Manual Name Limited",
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin setup transaction: %v", err)
	}
	securityID, err := ensureSecurityIdentityTx(tx, oldSecurity, "broker_import", true)
	if err != nil {
		tx.Rollback()
		t.Fatalf("create identity: %v", err)
	}
	result, err := tx.Exec(`
		INSERT INTO stock_analysis (ticker, name, security_id)
		VALUES ('ASX:MNL', ?, ?)
	`, oldSecurity.Name, securityID)
	if err != nil {
		tx.Rollback()
		t.Fatalf("insert analysis: %v", err)
	}
	analysisID, err := result.LastInsertId()
	if err != nil {
		tx.Rollback()
		t.Fatalf("read analysis id: %v", err)
	}
	_, err = tx.Exec(`
		INSERT INTO holdings (isin, ticker, company_name, exchange_prefix, security_id)
		VALUES (?, 'MNL', ?, 'ASX:', ?)
	`, oldSecurity.ISIN, oldSecurity.Name, securityID)
	if err != nil {
		tx.Rollback()
		t.Fatalf("insert holding: %v", err)
	}
	_, err = tx.Exec(`
		INSERT INTO stock_group_assignments (company_name, group_id, security_id)
		VALUES (?, 'resources', ?)
	`, oldSecurity.Name, securityID)
	if err != nil {
		tx.Rollback()
		t.Fatalf("insert group assignment: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit setup transaction: %v", err)
	}

	request := httptest.NewRequest(http.MethodPatch, "/api/analysis/1/rename", bytes.NewBufferString(`{"name":"My Research Label"}`))
	request = mux.SetURLVars(request, map[string]string{"id": strconv.FormatInt(analysisID, 10)})
	response := httptest.NewRecorder()
	renameAnalysis(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("rename response: got %d want %d body=%s", response.Code, http.StatusOK, response.Body.String())
	}

	var analysisName, holdingName string
	if err := db.QueryRow(`SELECT name FROM stock_analysis WHERE id = ?`, analysisID).Scan(&analysisName); err != nil {
		t.Fatalf("read renamed analysis: %v", err)
	}
	if err := db.QueryRow(`SELECT company_name FROM holdings WHERE security_id = ?`, securityID).Scan(&holdingName); err != nil {
		t.Fatalf("read broker holding: %v", err)
	}
	if analysisName != "My Research Label" {
		t.Fatalf("analysis name not updated: got %q", analysisName)
	}
	if holdingName != oldSecurity.Name {
		t.Fatalf("manual rename changed broker holding: got %q want %q", holdingName, oldSecurity.Name)
	}

	var aliasCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM security_name_aliases WHERE security_id = ?`, securityID).Scan(&aliasCount); err != nil {
		t.Fatalf("count rename aliases: %v", err)
	}
	if aliasCount != 2 {
		t.Fatalf("manual rename did not retain both names: got %d aliases want 2", aliasCount)
	}
}
