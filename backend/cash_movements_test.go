package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func setupCashMovementsTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	_, err = testDB.Exec(`
		CREATE TABLE asset_class_config (
			code TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			alert_label TEXT,
			alert_color TEXT,
			kind TEXT DEFAULT 'ASSET_CLASS',
			parent_code TEXT,
			is_portfolio_sleeve BOOLEAN DEFAULT 1,
			is_system_bucket BOOLEAN DEFAULT 0,
			allow_grouping BOOLEAN DEFAULT 1,
			allow_target_weight BOOLEAN DEFAULT 1,
			overlay_eligible BOOLEAN DEFAULT 1,
			display_order INTEGER DEFAULT 999,
			q3_sell_priority INTEGER,
			q1_category BOOLEAN DEFAULT 1,
			q3_beneficiary BOOLEAN DEFAULT 0,
			regime_independent BOOLEAN DEFAULT 0,
			q3_throttle_factor REAL,
			q4d_liquidity_factor REAL,
			q3_rating TEXT,
			q3_logic TEXT,
			stage2_target_pct REAL,
			sector TEXT,
			cash_reserve REAL DEFAULT 0,
			stock_allocation_ratio REAL NOT NULL DEFAULT 0.75,
			active BOOLEAN DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE cash_movements (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			asset_class_code TEXT NOT NULL,
			amount_delta REAL NOT NULL,
			previous_cash_reserve REAL NOT NULL DEFAULT 0,
			target_cash_reserve REAL NOT NULL DEFAULT 0,
			source_type TEXT NOT NULL CHECK(source_type IN ('PORTFOLIO_CASH_TRANSFER','STOCK_SALE','EXTERNAL_CAPITAL')),
			note TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','MISMATCH','CANCELLED')),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			confirmed_at DATETIME,
			statement_id INTEGER
		);

		CREATE TABLE decisions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			alert_id INTEGER,
			decision TEXT CHECK(decision IN ('BUY','SELL','SELL_50','SELL_DOWN','ADD','TRIM','IGNORE','REBALANCE_DISMISS','CASH_ALLOCATION')) NOT NULL,
			notes TEXT,
			position_pct_after REAL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		INSERT INTO asset_class_config (code, display_name, cash_reserve, q3_rating, q3_logic)
		VALUES ('GOLD_MINERS', 'Gold Miners', 250, '', '');
	`)
	if err != nil {
		testDB.Close()
		t.Fatalf("create test tables: %v", err)
	}

	db = testDB
	return func() {
		db = previousDB
		testDB.Close()
	}
}

func TestCreateCashMovementRecordsIntentAndUpdatesSleeveCash(t *testing.T) {
	cleanup := setupCashMovementsTestDB(t)
	defer cleanup()

	body := []byte(`{
		"asset_class_code": "gold_miners",
		"target_cash_reserve": 500,
		"source_type": "STOCK_SALE",
		"note": "Sold partial position"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/cash-movements", bytes.NewReader(body))
	res := httptest.NewRecorder()

	createCashMovement(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var payload createCashMovementResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.Movement.AssetClassCode != "GOLD_MINERS" {
		t.Fatalf("asset class = %q", payload.Movement.AssetClassCode)
	}
	if payload.Movement.SourceType != cashMovementSourceStockSale {
		t.Fatalf("source type = %q", payload.Movement.SourceType)
	}
	if payload.Movement.Status != cashMovementStatusPending {
		t.Fatalf("status = %q", payload.Movement.Status)
	}
	if payload.Movement.PreviousCashReserve != 250 || payload.Movement.TargetCashReserve != 500 || payload.Movement.AmountDelta != 250 {
		t.Fatalf("unexpected movement values: %+v", payload.Movement)
	}
	if payload.Config.CashReserve != 500 {
		t.Fatalf("config cash reserve = %f", payload.Config.CashReserve)
	}

	var storedCash float64
	if err := db.QueryRow(`SELECT cash_reserve FROM asset_class_config WHERE code = 'GOLD_MINERS'`).Scan(&storedCash); err != nil {
		t.Fatalf("read stored cash: %v", err)
	}
	if storedCash != 500 {
		t.Fatalf("stored cash = %f", storedCash)
	}

	var decision string
	var notes string
	if err := db.QueryRow(`SELECT decision, notes FROM decisions ORDER BY id DESC LIMIT 1`).Scan(&decision, &notes); err != nil {
		t.Fatalf("read decision: %v", err)
	}
	if decision != decisionCashAllocation {
		t.Fatalf("decision = %q", decision)
	}
	for _, expected := range []string{"Gold Miners", "Stock sale", "$250 -> $500", "$250", "Sold partial position"} {
		if !strings.Contains(notes, expected) {
			t.Fatalf("decision notes %q missing %q", notes, expected)
		}
	}
}

func TestCreateCashMovementRejectsManualCorrectionSource(t *testing.T) {
	cleanup := setupCashMovementsTestDB(t)
	defer cleanup()

	body := []byte(`{
		"asset_class_code": "GOLD_MINERS",
		"target_cash_reserve": 100,
		"source_type": "MANUAL_CORRECTION"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/cash-movements", bytes.NewReader(body))
	res := httptest.NewRecorder()

	createCashMovement(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
}
