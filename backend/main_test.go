package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gorilla/mux"
	_ "github.com/mattn/go-sqlite3"
)

func setupOverlaySignalStateTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

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
			status TEXT NOT NULL DEFAULT 'PENDING',
			from_q1_exposure_pct REAL NOT NULL,
			to_q1_exposure_pct REAL NOT NULL,
			adjustment_ratio REAL NOT NULL,
			governing_source TEXT,
			triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			stage1_applied_at DATETIME,
			stage1_required_reduction_value REAL DEFAULT 0,
			stage1_recorded_reduction_value REAL DEFAULT 0,
			stage1_baseline_reserve_value REAL DEFAULT 0,
			stage1_expected_reserve_value REAL DEFAULT 0,
			stage1_import_baseline_at DATETIME,
			reserve_confirmed_at DATETIME,
			reserve_confirmed_value REAL,
			reserve_variance REAL,
			cash_confirmation_status TEXT DEFAULT '',
			stage2_completed_at DATETIME,
			baseline_accepted_at DATETIME
		);

		CREATE TABLE overlay_event_classes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_id INTEGER NOT NULL,
			asset_class TEXT NOT NULL,
			overlay_eligible BOOLEAN DEFAULT 0,
			trigger_invested_value REAL DEFAULT 0,
			trigger_invested_pct REAL DEFAULT 0,
			trigger_tactical_cash_value REAL DEFAULT 0,
			trigger_total_class_capital_value REAL DEFAULT 0,
			target_invested_value REAL DEFAULT 0,
			target_invested_pct REAL DEFAULT 0,
			q3_sell_priority INTEGER,
			stage2_target_pct REAL,
			stage1_recorded_reduction_value REAL DEFAULT 0,
			UNIQUE(event_id, asset_class)
		);
	`)
	if err != nil {
		testDB.Close()
		t.Fatalf("create overlay_signal_state: %v", err)
	}

	db = testDB
	return func() {
		db = previousDB
		testDB.Close()
	}
}

func setupAlertLifecycleTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	_, err = testDB.Exec(`
		CREATE TABLE alerts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ticker TEXT NOT NULL,
			alert_type TEXT NOT NULL,
			expiry_date DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			is_active BOOLEAN DEFAULT 1,
			resolved_at DATETIME,
			resolved_reason TEXT,
			resolved_note TEXT
		);
	`)
	if err != nil {
		testDB.Close()
		t.Fatalf("create alerts table: %v", err)
	}

	db = testDB
	return func() {
		db = previousDB
		testDB.Close()
	}
}

func setupAssetClassesTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	_, err = testDB.Exec(`
		CREATE TABLE asset_classes (
			code TEXT PRIMARY KEY,
			asset_class_code TEXT NOT NULL,
			display_name TEXT NOT NULL,
			class_type TEXT DEFAULT 'ALLOCATION',
			parent_code TEXT,
			allow_grouping BOOLEAN DEFAULT 1,
			allow_target_weight BOOLEAN DEFAULT 1,
			display_order INTEGER DEFAULT 999,
			active BOOLEAN DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		testDB.Close()
		t.Fatalf("create asset_classes: %v", err)
	}

	db = testDB
	seedAssetClasses()
	return func() {
		db = previousDB
		testDB.Close()
	}
}

func setupNonAllocatingInstrumentTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	_, err = testDB.Exec(`
		CREATE TABLE stock_analysis (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ticker TEXT,
			name TEXT NOT NULL,
			allocation REAL DEFAULT 0,
			include_in_sizing BOOLEAN DEFAULT TRUE,
			primary_asset_class TEXT,
			security_type TEXT DEFAULT 'STOCK',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		testDB.Close()
		t.Fatalf("create stock_analysis: %v", err)
	}

	db = testDB
	return func() {
		db = previousDB
		testDB.Close()
	}
}

func setupAnalysisTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	db = testDB
	initDB()
	return func() {
		db = previousDB
		testDB.Close()
	}
}

func setupNewsNarrativeTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	db = testDB
	if err := ensureNewsNarrativeSchema(); err != nil {
		db = previousDB
		testDB.Close()
		t.Fatalf("create news narrative tables: %v", err)
	}

	return func() {
		db = previousDB
		testDB.Close()
	}
}

func setupStockGroupsConformanceTestDB(t *testing.T) func() {
	t.Helper()

	cleanup := setupAssetClassesTestDB(t)
	_, err := db.Exec(`
		CREATE TABLE stock_groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			asset_class_code TEXT,
			collapsed BOOLEAN DEFAULT 0,
			display_order INTEGER NOT NULL,
			parent_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE stock_group_assignments (
			company_name TEXT PRIMARY KEY,
			group_id TEXT NOT NULL,
			assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		cleanup()
		t.Fatalf("create stock group tables: %v", err)
	}
	return cleanup
}

func TestMigrateStockGroupAssetClassCodesDeletesNonConformingGroups(t *testing.T) {
	cleanup := setupStockGroupsConformanceTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO stock_groups (id, name, asset_class_code, display_order)
		VALUES
			('bad', 'Completely Custom Bucket', NULL, 1),
			('legacy-gold', 'Gold', NULL, 2),
			('bad-code', 'Bad Code', 'MADE_UP', 3);
		INSERT INTO stock_group_assignments (company_name, group_id)
		VALUES
			('Invalid Holding', 'bad'),
			('West Wits Mining Limited', 'legacy-gold'),
			('Another Invalid Holding', 'bad-code');
	`); err != nil {
		t.Fatalf("insert stock groups: %v", err)
	}

	migrateStockGroupAssetClassCodes()

	var groupCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM stock_groups`).Scan(&groupCount); err != nil {
		t.Fatalf("count groups: %v", err)
	}
	if groupCount != 1 {
		t.Fatalf("group count = %d, want only the conforming legacy group", groupCount)
	}

	var id, name, assetClassCode string
	if err := db.QueryRow(`SELECT id, name, asset_class_code FROM stock_groups`).Scan(&id, &name, &assetClassCode); err != nil {
		t.Fatalf("read remaining group: %v", err)
	}
	if id != "legacy-gold" || name != "Gold" || assetClassCode != "GOLD_MINERS" {
		t.Fatalf("remaining group = %q/%q/%q, want legacy-gold/Gold/GOLD_MINERS", id, name, assetClassCode)
	}

	var assignmentCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM stock_group_assignments`).Scan(&assignmentCount); err != nil {
		t.Fatalf("count assignments: %v", err)
	}
	if assignmentCount != 1 {
		t.Fatalf("assignment count = %d, want only conforming assignment", assignmentCount)
	}
}

func TestPersistNewsNarrativePayloadStoresBriefAndTheses(t *testing.T) {
	cleanup := setupNewsNarrativeTestDB(t)
	defer cleanup()

	payload := newsNarrativeModelPayload{
		DailySummary: "Rates held steady while gold miners led commodity-linked equities.",
		MarketContext: newsMarketContext{
			TopThemes12M:      []string{"AI capex cycle", "Gold strength"},
			TopPerformers1M:   []string{"Gold miners"},
			WorstPerformers1M: []string{"Long-duration software"},
		},
		NewsItems: []newsNarrativeModelItem{
			{
				Headline:     "Gold rises on real-rate pressure",
				Summary:      "Gold miners rallied as yields eased.",
				Timeframe:    "1D",
				ImpactScore:  0.8,
				Sources:      []string{"Reuters"},
				AssetClasses: []string{"GOLD_MINERS"},
				Tags:         []string{"gold", "rates"},
			},
		},
		ThesisUpdates: []newsNarrativeModelUpdate{
			{
				Title:           "Gold miners benefit from easing real rates",
				Timeframe:       "6M",
				Status:          "ACTIVE",
				Relationship:    "SUPPORTS",
				Conviction:      0.7,
				ConvictionDelta: 0.1,
				Summary:         "Gold miners keep benefiting when real rates ease.",
				Evidence:        "A fresh gold rally supported the existing thesis.",
				Sources:         []string{"Reuters"},
				AssetClasses:    []string{"GOLD_MINERS"},
				Tags:            []string{"gold"},
			},
		},
	}
	normaliseNewsNarrativePayload(&payload)

	runID, err := persistNewsNarrativePayload("BOOTSTRAP", payload, `{"daily_summary":"ok"}`, "grok-test")
	if err != nil {
		t.Fatalf("persist news payload: %v", err)
	}

	response, err := loadNewsBriefResponseForRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("load news response: %v", err)
	}
	if response.Run == nil || response.Run.DailySummary != payload.DailySummary {
		t.Fatalf("run summary = %#v, want persisted daily summary", response.Run)
	}
	if response.Run.Mode != "BOOTSTRAP" {
		t.Fatalf("run mode = %q, want BOOTSTRAP", response.Run.Mode)
	}
	if response.FoundationRun == nil || response.FoundationRun.ID != runID {
		t.Fatalf("foundation run = %#v, want bootstrap run %d", response.FoundationRun, runID)
	}
	if len(response.Items) != 1 || response.Items[0].Headline != "Gold rises on real-rate pressure" {
		t.Fatalf("items = %#v", response.Items)
	}
	if len(response.Theses) != 1 || response.Theses[0].Timeframe != "6M" || response.Theses[0].Conviction != 0.7 {
		t.Fatalf("theses = %#v", response.Theses)
	}
	if len(response.Updates) != 1 || response.Updates[0].Relationship != "SUPPORTS" {
		t.Fatalf("updates = %#v", response.Updates)
	}

	payload.DailySummary = "Daily update tested against the foundation thesis map."
	dailyRunID, err := persistNewsNarrativePayload("DAILY", payload, `{"daily_summary":"daily"}`, "grok-test")
	if err != nil {
		t.Fatalf("persist daily news payload: %v", err)
	}
	dailyResponse, err := loadNewsBriefResponseForRun(context.Background(), dailyRunID)
	if err != nil {
		t.Fatalf("load daily news response: %v", err)
	}
	if dailyResponse.Run == nil || dailyResponse.Run.Mode != "DAILY" {
		t.Fatalf("daily run = %#v, want DAILY run", dailyResponse.Run)
	}
	if dailyResponse.FoundationRun == nil || dailyResponse.FoundationRun.ID != runID {
		t.Fatalf("daily foundation run = %#v, want bootstrap run %d", dailyResponse.FoundationRun, runID)
	}
}

func TestSeedAssetClassesPreservesCustomClasses(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO asset_classes (
			code, asset_class_code, display_name, class_type,
			allow_grouping, allow_target_weight, analysis_eligible,
			instrument_scope, risk_bucket, display_order, active
		)
		VALUES ('CUSTOM_GLOBAL_THEMES', 'CUSTOM_GLOBAL_THEMES', 'Global Themes', 'CUSTOM',
			1, 1, 0, 'FUND', 'Q1_EXEMPT', 9000, 1)
	`); err != nil {
		t.Fatalf("insert custom asset class: %v", err)
	}

	seedAssetClasses()

	var active bool
	var analysisEligible bool
	var riskBucket string
	if err := db.QueryRow(`
		SELECT active, analysis_eligible, risk_bucket
		FROM asset_classes
		WHERE code = 'CUSTOM_GLOBAL_THEMES'
	`).Scan(&active, &analysisEligible, &riskBucket); err != nil {
		t.Fatalf("read custom asset class: %v", err)
	}
	if !active || analysisEligible || riskBucket != "Q1_EXEMPT" {
		t.Fatalf("custom class active/analysis/risk = %v/%v/%q, want true/false/Q1_EXEMPT", active, analysisEligible, riskBucket)
	}
}

func TestCreateCustomAssetClassRequiresQuartileAndDisablesAnalysis(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/asset-classes", bytes.NewBufferString(`{
		"display_name": "Global Thematic Funds",
		"quartile": "q1_exempt"
	}`))
	rr := httptest.NewRecorder()

	createCustomAssetClass(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var created AssetClass
	if err := json.NewDecoder(rr.Body).Decode(&created); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if created.Code != "CUSTOM_GLOBAL_THEMATIC_FUNDS" || created.ClassType != "CUSTOM" {
		t.Fatalf("created code/type = %q/%q", created.Code, created.ClassType)
	}
	if created.AnalysisEligible || created.InstrumentScope != "FUND" || created.RiskBucket != "Q1_EXEMPT" {
		t.Fatalf("created analysis/scope/risk = %v/%q/%q", created.AnalysisEligible, created.InstrumentScope, created.RiskBucket)
	}
}

func TestDeleteCustomAssetClassRemovesUnusedClass(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO asset_classes (
			code, asset_class_code, display_name, class_type,
			allow_grouping, allow_target_weight, analysis_eligible,
			instrument_scope, risk_bucket, display_order, active
		)
		VALUES ('CUSTOM_GLOBAL_THEMATIC_FUNDS', 'CUSTOM_GLOBAL_THEMATIC_FUNDS',
			'Global Thematic Funds', 'CUSTOM', 1, 1, 0, 'FUND', 'Q1_EXEMPT', 9000, 1)
	`); err != nil {
		t.Fatalf("insert custom asset class: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/asset-classes/CUSTOM_GLOBAL_THEMATIC_FUNDS", nil)
	req = mux.SetURLVars(req, map[string]string{"code": "CUSTOM_GLOBAL_THEMATIC_FUNDS"})
	w := httptest.NewRecorder()

	deleteCustomAssetClass(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM asset_classes WHERE code = 'CUSTOM_GLOBAL_THEMATIC_FUNDS'`).Scan(&count); err != nil {
		t.Fatalf("count deleted custom asset class: %v", err)
	}
	if count != 0 {
		t.Fatalf("custom asset class count = %d, want 0", count)
	}
}

func TestDeleteCustomAssetClassRejectsBuiltInClass(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodDelete, "/api/asset-classes/GOLD_MINERS", nil)
	req = mux.SetURLVars(req, map[string]string{"code": "GOLD_MINERS"})
	w := httptest.NewRecorder()

	deleteCustomAssetClass(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body = %s", w.Code, w.Body.String())
	}
}

func TestDeleteCustomAssetClassRejectsReferencedClass(t *testing.T) {
	cleanup := setupStockGroupsConformanceTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO asset_classes (
			code, asset_class_code, display_name, class_type,
			allow_grouping, allow_target_weight, analysis_eligible,
			instrument_scope, risk_bucket, display_order, active
		)
		VALUES ('CUSTOM_GLOBAL_THEMATIC_FUNDS', 'CUSTOM_GLOBAL_THEMATIC_FUNDS',
			'Global Thematic Funds', 'CUSTOM', 1, 1, 0, 'FUND', 'Q1_EXEMPT', 9000, 1);
		INSERT INTO stock_groups (id, name, asset_class_code, display_order)
		VALUES ('global-themes', 'Global Thematic Funds', 'CUSTOMGLOBALTHEMATICFUNDS', 1);
	`); err != nil {
		t.Fatalf("insert referenced custom asset class: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/asset-classes/CUSTOM_GLOBAL_THEMATIC_FUNDS", nil)
	req = mux.SetURLVars(req, map[string]string{"code": "CUSTOM_GLOBAL_THEMATIC_FUNDS"})
	w := httptest.NewRecorder()

	deleteCustomAssetClass(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body = %s", w.Code, w.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM asset_classes WHERE code = 'CUSTOM_GLOBAL_THEMATIC_FUNDS'`).Scan(&count); err != nil {
		t.Fatalf("count retained custom asset class: %v", err)
	}
	if count != 1 {
		t.Fatalf("custom asset class count = %d, want 1", count)
	}
}

func TestSaveStockGroupsAcceptsCustomAssetClassCode(t *testing.T) {
	cleanup := setupStockGroupsConformanceTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO asset_classes (
			code, asset_class_code, display_name, class_type,
			allow_grouping, allow_target_weight, analysis_eligible,
			instrument_scope, risk_bucket, display_order, active
		)
		VALUES ('CUSTOM_GLOBAL_THEMATIC_FUNDS', 'CUSTOM_GLOBAL_THEMATIC_FUNDS',
			'Global Thematic Funds', 'CUSTOM', 1, 1, 0, 'FUND', 'Q1_EXEMPT', 9000, 1)
	`); err != nil {
		t.Fatalf("insert custom asset class: %v", err)
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/groups",
		bytes.NewBufferString(`{"groups":[{"id":"custom-global-thematic-funds","name":"Global Thematic Funds","asset_class_code":"CUSTOM_GLOBAL_THEMATIC_FUNDS","collapsed":false,"order":1}],"assignments":[]}`),
	)
	w := httptest.NewRecorder()

	saveStockGroups(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM stock_groups
		WHERE id = 'custom-global-thematic-funds'
		  AND name = 'Global Thematic Funds'
		  AND asset_class_code = 'CUSTOM_GLOBAL_THEMATIC_FUNDS'
	`).Scan(&count); err != nil {
		t.Fatalf("count custom group: %v", err)
	}
	if count != 1 {
		t.Fatalf("custom group count = %d, want 1", count)
	}
}

func TestMigrateStockGroupAssetClassCodesAllowsDisplayParentGroups(t *testing.T) {
	cleanup := setupStockGroupsConformanceTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO stock_groups (id, name, asset_class_code, display_order, parent_id)
		VALUES
			('materials', 'Diversified Miners', 'DIVERSIFIED_MINERS', 1, NULL),
			('gold', 'Gold Miners', 'GOLD_MINERS', 1, 'materials'),
			('silver', 'Silver Miners', 'SILVER_MINERS', 2, 'materials');
	`); err != nil {
		t.Fatalf("insert stock groups: %v", err)
	}

	migrateStockGroupAssetClassCodes()

	var parentName, parentCode string
	if err := db.QueryRow(`SELECT name, COALESCE(asset_class_code, '') FROM stock_groups WHERE id = 'materials'`).Scan(&parentName, &parentCode); err != nil {
		t.Fatalf("read display parent: %v", err)
	}
	if parentName != "Materials" || parentCode != "" {
		t.Fatalf("display parent = %q/%q, want Materials with no asset_class_code", parentName, parentCode)
	}

	var leafCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM stock_groups WHERE parent_id = 'materials' AND asset_class_code IN ('GOLD_MINERS', 'SILVER_MINERS')`).Scan(&leafCount); err != nil {
		t.Fatalf("count leaf groups: %v", err)
	}
	if leafCount != 2 {
		t.Fatalf("leaf count = %d, want 2 canonical leaves", leafCount)
	}
}

func TestSaveStockGroupsRejectsInvalidWithoutDeletingExisting(t *testing.T) {
	cleanup := setupStockGroupsConformanceTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO stock_groups (id, name, asset_class_code, display_order)
		VALUES ('gold', 'Gold Miners', 'GOLD_MINERS', 1);
		INSERT INTO stock_group_assignments (company_name, group_id)
		VALUES ('West Wits Mining Limited', 'gold');
	`); err != nil {
		t.Fatalf("insert existing groups: %v", err)
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/groups",
		bytes.NewBufferString(`{"groups":[{"id":"bad","name":"Made Up Bucket","asset_class_code":"","collapsed":false,"order":1}],"assignments":[]}`),
	)
	w := httptest.NewRecorder()

	saveStockGroups(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", w.Code, w.Body.String())
	}

	var groupCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM stock_groups WHERE id = 'gold' AND asset_class_code = 'GOLD_MINERS'`).Scan(&groupCount); err != nil {
		t.Fatalf("read existing group: %v", err)
	}
	if groupCount != 1 {
		t.Fatalf("existing conforming group was deleted")
	}

	var assignmentCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM stock_group_assignments WHERE company_name = 'West Wits Mining Limited' AND group_id = 'gold'`).Scan(&assignmentCount); err != nil {
		t.Fatalf("read existing assignment: %v", err)
	}
	if assignmentCount != 1 {
		t.Fatalf("existing assignment was deleted")
	}
}

func TestNormalizeSecurityTypeRecognisesCVR(t *testing.T) {
	cases := []string{
		"CVR",
		"contingent value right",
		"Contingent Value Rights",
		"CONTINGENT_VALUE_RIGHTS",
	}
	for _, input := range cases {
		if got := normalizeSecurityType(input); got != "CVR" {
			t.Fatalf("normalizeSecurityType(%q) = %q, want CVR", input, got)
		}
	}
}

func TestNormalizeSecurityTypeRecognisesNonAllocating(t *testing.T) {
	for _, input := range []string{
		"NON_ALLOCATING",
		"non-allocating",
		"Non Allocating",
	} {
		if got := normalizeSecurityType(input); got != "NON_ALLOCATING" {
			t.Fatalf("normalizeSecurityType(%q) = %q, want NON_ALLOCATING", input, got)
		}
		if !isNonAllocatingSecurityType(input) {
			t.Fatalf("isNonAllocatingSecurityType(%q) = false, want true", input)
		}
	}
}

func TestSetAnalysisSecurityTypeExcludesNonAllocatingInstrument(t *testing.T) {
	cleanup := setupNonAllocatingInstrumentTestDB(t)
	defer cleanup()

	result, err := db.Exec(`
		INSERT INTO stock_analysis (name, allocation, primary_asset_class, security_type)
		VALUES ('Magnetic Resources NL (Taken Up) Merger', 4.5, 'GOLD_MINERS', 'STOCK')
	`)
	if err != nil {
		t.Fatalf("insert corporate action: %v", err)
	}
	analysisID, _ := result.LastInsertId()
	body := []byte(fmt.Sprintf(`{
		"analysis_id": %d,
		"name": "Magnetic Resources NL (Taken Up) Merger",
		"ticker": "",
		"security_type": "NON_ALLOCATING",
		"primary_asset_class": "GOLD_MINERS"
	}`, analysisID))
	req := httptest.NewRequest(http.MethodPost, "/api/analysis/security-type", bytes.NewReader(body))
	w := httptest.NewRecorder()
	setAnalysisSecurityType(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	var securityType string
	var primaryAssetClass sql.NullString
	var allocation float64
	var includeInSizing bool
	if err := db.QueryRow(`
		SELECT security_type, primary_asset_class, allocation, include_in_sizing
		FROM stock_analysis
		WHERE id = ?
	`, analysisID).Scan(&securityType, &primaryAssetClass, &allocation, &includeInSizing); err != nil {
		t.Fatalf("read corporate action: %v", err)
	}
	if securityType != "NON_ALLOCATING" || primaryAssetClass.Valid || allocation != 0 || includeInSizing {
		t.Fatalf(
			"excluded instrument = type %q, class %v, allocation %v, included %v",
			securityType,
			primaryAssetClass,
			allocation,
			includeInSizing,
		)
	}
}

func TestSetAnalysisSecurityTypeTargetsStableAnalysisID(t *testing.T) {
	cleanup := setupNonAllocatingInstrumentTestDB(t)
	defer cleanup()

	result, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, security_type, primary_asset_class)
		VALUES (NULL, 'Selected ETF', 'STOCK', 'DEFENCE')
	`)
	if err != nil {
		t.Fatalf("insert selected analysis row: %v", err)
	}
	selectedID, _ := result.LastInsertId()
	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, security_type, primary_asset_class)
		VALUES
			(NULL, 'Blank ticker stock', 'STOCK', 'SEMICONDUCTORS'),
			('', 'Blank ticker CVR', 'CVR', NULL)
	`); err != nil {
		t.Fatalf("insert unrelated analysis rows: %v", err)
	}

	body := []byte(fmt.Sprintf(`{
		"analysis_id": %d,
		"name": "Selected ETF",
		"ticker": "",
		"security_type": "ETF",
		"primary_asset_class": "DEFENCE"
	}`, selectedID))
	req := httptest.NewRequest(http.MethodPost, "/api/analysis/security-type", bytes.NewReader(body))
	w := httptest.NewRecorder()
	setAnalysisSecurityType(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	rows, err := db.Query(`SELECT name, security_type FROM stock_analysis ORDER BY id`)
	if err != nil {
		t.Fatalf("query analysis rows: %v", err)
	}
	defer rows.Close()
	want := map[string]string{
		"Selected ETF":       "ETF",
		"Blank ticker stock": "STOCK",
		"Blank ticker CVR":   "CVR",
	}
	for rows.Next() {
		var name, securityType string
		if err := rows.Scan(&name, &securityType); err != nil {
			t.Fatalf("scan analysis row: %v", err)
		}
		if securityType != want[name] {
			t.Fatalf("%s security_type = %q, want %q", name, securityType, want[name])
		}
	}
}

func TestNormalizeCDFStopState(t *testing.T) {
	cases := map[string]string{
		"BUY":          "BUY",
		"buy_zone":     "BUY",
		"in buy zone":  "BUY",
		"true":         "BUY",
		"SELL":         "SELL",
		"sell-zone":    "SELL",
		"in_sell_zone": "SELL",
		"false":        "SELL",
		"":             "",
		"unknown":      "",
	}

	for input, want := range cases {
		if got := normalizeCDFStopState(input); got != want {
			t.Fatalf("normalizeCDFStopState(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestAnalysisModelSourceFieldsRoundTrip(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	createBody := []byte(`{
		"ticker": "ASX:MSM",
		"name": "Model Source Minerals",
		"gemini_webui_output": "gemini source text",
		"gemini_webui_input_at": "2026-06-01",
		"perplexity_webui_output": "perplexity source text",
		"perplexity_webui_input_at": "2026-06-02",
		"gpt_webui_output": "gpt source text",
		"gpt_webui_input_at": "2026-06-03",
		"claude_webui_output": "claude source text",
		"claude_webui_input_at": "2026-06-04",
		"council_source_output": "council source text",
		"council_source_input_at": "2026-06-05"
	}`)
	createReq := httptest.NewRequest(http.MethodPost, "/api/analysis", bytes.NewReader(createBody))
	createRec := httptest.NewRecorder()
	upsertAnalysis(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("upsertAnalysis status = %d, body = %s", createRec.Code, createRec.Body.String())
	}

	var created StockAnalysis
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created analysis: %v", err)
	}
	if created.ID == 0 {
		t.Fatalf("created analysis id = 0")
	}

	patchBody := []byte(`{
		"gemini_webui_output": "updated gemini source",
		"gemini_webui_input_at": "2026-06-22",
		"council_source_output": "updated council source",
		"council_source_input_at": "2026-06-23"
	}`)
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/analysis/"+strconv.Itoa(created.ID), bytes.NewReader(patchBody))
	patchReq = mux.SetURLVars(patchReq, map[string]string{"id": strconv.Itoa(created.ID)})
	patchRec := httptest.NewRecorder()
	updateAnalysis(patchRec, patchReq)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("updateAnalysis status = %d, body = %s", patchRec.Code, patchRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/analysis", nil)
	getRec := httptest.NewRecorder()
	getAllAnalysis(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("getAllAnalysis status = %d, body = %s", getRec.Code, getRec.Body.String())
	}

	var analyses []StockAnalysis
	if err := json.NewDecoder(getRec.Body).Decode(&analyses); err != nil {
		t.Fatalf("decode analyses: %v", err)
	}
	var got *StockAnalysis
	for i := range analyses {
		if analyses[i].Name == "Model Source Minerals" {
			got = &analyses[i]
			break
		}
	}
	if got == nil {
		t.Fatalf("created analysis row not returned: %+v", analyses)
	}

	assertStringPtr := func(field string, got *string, want string) {
		t.Helper()
		if got == nil || *got != want {
			if got == nil {
				t.Fatalf("%s = nil, want %q", field, want)
			}
			t.Fatalf("%s = %q, want %q", field, *got, want)
		}
	}
	assertStringPtr("gemini_webui_output", got.GeminiWebUIOutput, "updated gemini source")
	assertStringPtr("gemini_webui_input_at", got.GeminiWebUIInputAt, "2026-06-22")
	assertStringPtr("perplexity_webui_output", got.PerplexityWebUIOutput, "perplexity source text")
	assertStringPtr("perplexity_webui_input_at", got.PerplexityWebUIInputAt, "2026-06-02")
	assertStringPtr("gpt_webui_output", got.GptWebUIOutput, "gpt source text")
	assertStringPtr("gpt_webui_input_at", got.GptWebUIInputAt, "2026-06-03")
	assertStringPtr("claude_webui_output", got.ClaudeWebUIOutput, "claude source text")
	assertStringPtr("claude_webui_input_at", got.ClaudeWebUIInputAt, "2026-06-04")
	assertStringPtr("council_source_output", got.CouncilSourceOutput, "updated council source")
	assertStringPtr("council_source_input_at", got.CouncilSourceInputAt, "2026-06-23")
}

func TestMigrateNonAllocatingInstrumentsClearsPortfolioClass(t *testing.T) {
	cleanup := setupNonAllocatingInstrumentTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, allocation, primary_asset_class, security_type)
		VALUES
			('US810CVR0196', 'scPharmaceuticals Inc Contingent Value Rights', 4.5, 'MISC', 'STOCK'),
			('WWI', 'West Wits Mining Limited', 3.0, 'GOLD_MINERS', 'STOCK')
	`); err != nil {
		t.Fatalf("insert stock_analysis: %v", err)
	}

	migrateNonAllocatingInstruments()

	var securityType string
	var primaryAssetClass sql.NullString
	var allocation float64
	if err := db.QueryRow(`
		SELECT security_type, primary_asset_class, allocation
		FROM stock_analysis
		WHERE name = 'scPharmaceuticals Inc Contingent Value Rights'
	`).Scan(&securityType, &primaryAssetClass, &allocation); err != nil {
		t.Fatalf("read cvr row: %v", err)
	}
	if securityType != "CVR" {
		t.Fatalf("security_type = %q, want CVR", securityType)
	}
	if primaryAssetClass.Valid {
		t.Fatalf("primary_asset_class = %q, want NULL", primaryAssetClass.String)
	}
	if allocation != 0 {
		t.Fatalf("allocation = %v, want 0", allocation)
	}

	if err := db.QueryRow(`
		SELECT security_type, primary_asset_class, allocation
		FROM stock_analysis
		WHERE ticker = 'WWI'
	`).Scan(&securityType, &primaryAssetClass, &allocation); err != nil {
		t.Fatalf("read regular row: %v", err)
	}
	if securityType != "STOCK" || !primaryAssetClass.Valid || primaryAssetClass.String != "GOLD_MINERS" || allocation != 3 {
		t.Fatalf("regular row changed unexpectedly: type=%q class=%v allocation=%v", securityType, primaryAssetClass, allocation)
	}
}

func TestNormalisePortfolioRebalanceRowsUsesAssetClasses(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	rows, err := normalisePortfolioRebalanceRows([]PortfolioRebalancePlanRow{
		{AssetClass: "GOLD", CurrentWeightPct: 10, TargetWeightPct: 12},
		{AssetClass: "PHARMA", CurrentWeightPct: 5, TargetWeightPct: 6},
		{AssetClass: "MISC", CurrentWeightPct: 1, TargetWeightPct: 1},
	})
	if err != nil {
		t.Fatalf("normalisePortfolioRebalanceRows: %v", err)
	}

	got := map[string]PortfolioRebalancePlanRow{}
	for _, row := range rows {
		got[row.AssetClass] = row
	}
	if _, ok := got["GOLD_MINERS"]; !ok {
		t.Fatalf("expected GOLD to resolve to GOLD_MINERS, got %#v", rows)
	}
	if _, ok := got["PHARMA_BIOTECH"]; !ok {
		t.Fatalf("expected PHARMA to resolve to PHARMA_BIOTECH, got %#v", rows)
	}
	if _, ok := got["UNASSIGNED"]; !ok {
		t.Fatalf("expected MISC to resolve to UNASSIGNED, got %#v", rows)
	}
}

func TestNormalisePortfolioRebalanceRowsRejectsUnknownSleeve(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	if _, err := normalisePortfolioRebalanceRows([]PortfolioRebalancePlanRow{
		{AssetClass: "NOT_A_REAL_SLEEVE", CurrentWeightPct: 0, TargetWeightPct: 0},
	}); err == nil {
		t.Fatalf("expected unknown sleeve to be rejected")
	}
}

func TestResolvePortfolioAssignmentClassUsesCanonicalSleeveCode(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	cases := map[string]string{
		"GOLD":         "GOLD_MINERS",
		"PHARMA":       "PHARMA_BIOTECH",
		"HEALTHCARE":   "HEALTHCARE_SERVICES",
		"EQUITY":       "BROAD_EQUITY",
		"ETF":          "BROAD_EQUITY",
		"FIXED_INCOME": "BONDS",
		"MISC":         "",
	}

	for input, want := range cases {
		got, ok := resolvePortfolioAssignmentClass(input)
		if !ok {
			t.Fatalf("resolvePortfolioAssignmentClass(%q) rejected, want %q", input, want)
		}
		if got != want {
			t.Fatalf("resolvePortfolioAssignmentClass(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestResolvePortfolioAssignmentClassRejectsUnknown(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	if got, ok := resolvePortfolioAssignmentClass("NOT_A_REAL_CLASS"); ok {
		t.Fatalf("unknown assignment resolved to %q, want rejection", got)
	}
}

func TestResolveExpiredAlertsMarksSystemOutcomeWithoutDecision(t *testing.T) {
	cleanup := setupAlertLifecycleTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO alerts (ticker, alert_type, expiry_date, is_active)
		VALUES
			('VBX', 'ADD', datetime('now', '-1 day'), 1),
			('CAY', 'TRIM', datetime('now', '+1 day'), 1),
			('WAF', 'ADD', datetime('now', '-2 day'), 0)
	`); err != nil {
		t.Fatalf("insert alerts: %v", err)
	}

	resolveExpiredAlerts()

	var active bool
	var reason, note string
	if err := db.QueryRow(`
		SELECT is_active, COALESCE(resolved_reason, ''), COALESCE(resolved_note, '')
		FROM alerts
		WHERE ticker = 'VBX'
	`).Scan(&active, &reason, &note); err != nil {
		t.Fatalf("read expired alert: %v", err)
	}
	if active {
		t.Fatalf("expired alert active = %v, want false", active)
	}
	if reason != "EXPIRED" {
		t.Fatalf("expired alert reason = %q, want EXPIRED", reason)
	}
	if note != "Signal expired without user action" {
		t.Fatalf("expired alert note = %q", note)
	}

	if err := db.QueryRow(`
		SELECT is_active, COALESCE(resolved_reason, '')
		FROM alerts
		WHERE ticker = 'CAY'
	`).Scan(&active, &reason); err != nil {
		t.Fatalf("read future alert: %v", err)
	}
	if !active || reason != "" {
		t.Fatalf("future alert active/reason = %v/%q, want true/empty", active, reason)
	}
}

func TestLoadOrInitOverlaySignalStateFirstSeenRiskOffDoesNotSelfBaseline(t *testing.T) {
	cleanup := setupOverlaySignalStateTestDB(t)
	defer cleanup()

	state, created, err := loadOrInitOverlaySignalState(50, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("loadOrInitOverlaySignalState: %v", err)
	}
	if !created {
		t.Fatalf("expected state to be created")
	}
	if state.CurrentQ1ExposurePct != 50 {
		t.Fatalf("current q1 exposure = %v, want 50", state.CurrentQ1ExposurePct)
	}
	if state.LastAppliedQ1ExposurePct != 100 {
		t.Fatalf("last applied q1 exposure = %v, want 100", state.LastAppliedQ1ExposurePct)
	}

	var current, lastApplied float64
	if err := db.QueryRow(`
		SELECT current_q1_exposure_pct, last_applied_q1_exposure_pct
		FROM overlay_signal_state
		WHERE id = 1
	`).Scan(&current, &lastApplied); err != nil {
		t.Fatalf("read persisted state: %v", err)
	}
	if current != 50 || lastApplied != 100 {
		t.Fatalf("persisted current/lastApplied = %v/%v, want 50/100", current, lastApplied)
	}
}

func TestBuildPortfolioTargetAdjustmentPlanUsesLiveCurrentWeights(t *testing.T) {
	plan := &PortfolioRebalancePlan{
		ID:     42,
		Status: "OPEN",
		Title:  "Memo target",
		Rows: []PortfolioRebalancePlanRow{
			{
				AssetClass:       "GOLD",
				DisplayName:      "Gold",
				CurrentWeightPct: 20,
				TargetWeightPct:  0,
			},
			{
				AssetClass:       "PHYSICALGOLD",
				DisplayName:      "Physical Gold",
				CurrentWeightPct: 20,
				TargetWeightPct:  9,
			},
		},
	}

	adjustment := buildPortfolioTargetAdjustmentPlan(plan, 1000, []PortfolioMixRow{
		{AssetClass: "GOLD", WeightPct: 20},
	})
	if adjustment == nil {
		t.Fatalf("expected adjustment plan")
	}
	if adjustment.RequiredDecreaseValue != 200 {
		t.Fatalf("required decrease = %v, want 200", adjustment.RequiredDecreaseValue)
	}
	if adjustment.RequiredIncreaseValue != 90 {
		t.Fatalf("required increase = %v, want 90", adjustment.RequiredIncreaseValue)
	}

	var physicalGold *AdjustmentPlanRow
	for i := range adjustment.Rows {
		if adjustment.Rows[i].Key == "PHYSICALGOLD" {
			physicalGold = &adjustment.Rows[i]
			break
		}
	}
	if physicalGold == nil {
		t.Fatalf("expected physical gold row")
	}
	if physicalGold.CurrentWeightPct != 0 {
		t.Fatalf("physical gold current weight = %v, want 0", physicalGold.CurrentWeightPct)
	}
	if physicalGold.Direction != "increase" {
		t.Fatalf("physical gold direction = %q, want increase", physicalGold.Direction)
	}
}

func TestBuildPortfolioTargetAdjustmentPlanMatchesCanonicalAssetClassAliases(t *testing.T) {
	cleanup := setupAssetClassesTestDB(t)
	defer cleanup()

	plan := &PortfolioRebalancePlan{
		ID:     43,
		Status: "OPEN",
		Title:  "Manual target",
		Rows: []PortfolioRebalancePlanRow{
			{
				AssetClass:       "GOLD",
				DisplayName:      "Gold Miners",
				CurrentWeightPct: 0,
				TargetWeightPct:  22.1,
			},
			{
				AssetClass:       "Pharma & Biotech",
				DisplayName:      "Pharma & Biotech",
				CurrentWeightPct: 0,
				TargetWeightPct:  13.5,
			},
		},
	}

	adjustment := buildPortfolioTargetAdjustmentPlan(plan, 100000, []PortfolioMixRow{
		{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", WeightPct: 22.1},
		{AssetClass: "PHARMA", DisplayName: "Pharma", WeightPct: 13.5},
	})
	if adjustment == nil {
		t.Fatalf("expected adjustment plan")
	}
	if adjustment.RequiredIncreaseValue != 0 {
		t.Fatalf("required increase = %v, want 0; rows=%#v", adjustment.RequiredIncreaseValue, adjustment.Rows)
	}
	if adjustment.RequiredDecreaseValue != 0 {
		t.Fatalf("required decrease = %v, want 0; rows=%#v", adjustment.RequiredDecreaseValue, adjustment.Rows)
	}
	for _, row := range adjustment.Rows {
		if row.Direction != "hold" {
			t.Fatalf("row %s direction = %q, want hold", row.Key, row.Direction)
		}
		if row.CurrentWeightPct != row.TargetWeightPct {
			t.Fatalf("row %s current/target = %v/%v, want equal", row.Key, row.CurrentWeightPct, row.TargetWeightPct)
		}
	}
}

func TestLoadOrInitOverlaySignalStateExistingStateIsPreserved(t *testing.T) {
	cleanup := setupOverlaySignalStateTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO overlay_signal_state (
			id, current_q1_exposure_pct, last_applied_q1_exposure_pct,
			spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source
		) VALUES (1, 35, 50, 35, 100, 'SPY')
	`); err != nil {
		t.Fatalf("insert existing state: %v", err)
	}

	state, created, err := loadOrInitOverlaySignalState(50, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("loadOrInitOverlaySignalState: %v", err)
	}
	if created {
		t.Fatalf("expected existing state to be loaded")
	}
	if state.CurrentQ1ExposurePct != 35 || state.LastAppliedQ1ExposurePct != 50 {
		t.Fatalf("loaded current/lastApplied = %v/%v, want 35/50", state.CurrentQ1ExposurePct, state.LastAppliedQ1ExposurePct)
	}
}

func TestLoadOrInitOverlaySignalStateRepairsLegacySelfBaselineWithoutAcceptedEvent(t *testing.T) {
	cleanup := setupOverlaySignalStateTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO overlay_signal_state (
			id, current_q1_exposure_pct, last_applied_q1_exposure_pct,
			spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source
		) VALUES (1, 50, 50, 50, 100, 'SPY')
	`); err != nil {
		t.Fatalf("insert legacy state: %v", err)
	}

	state, created, err := loadOrInitOverlaySignalState(50, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("loadOrInitOverlaySignalState: %v", err)
	}
	if created {
		t.Fatalf("expected existing state to be repaired, not created")
	}
	if state.CurrentQ1ExposurePct != 50 || state.LastAppliedQ1ExposurePct != 100 {
		t.Fatalf("repaired current/lastApplied = %v/%v, want 50/100", state.CurrentQ1ExposurePct, state.LastAppliedQ1ExposurePct)
	}
}

func TestLoadOrInitOverlaySignalStatePreservesAcceptedSelfBaseline(t *testing.T) {
	cleanup := setupOverlaySignalStateTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO overlay_signal_state (
			id, current_q1_exposure_pct, last_applied_q1_exposure_pct,
			spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source
		) VALUES (1, 50, 50, 50, 100, 'SPY')
	`); err != nil {
		t.Fatalf("insert accepted state: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO overlay_events (
			status, from_q1_exposure_pct, to_q1_exposure_pct,
			adjustment_ratio, governing_source, baseline_accepted_at
		) VALUES ('BASELINED', 100, 50, 0.5, 'SPY', CURRENT_TIMESTAMP)
	`); err != nil {
		t.Fatalf("insert accepted event: %v", err)
	}

	state, created, err := loadOrInitOverlaySignalState(50, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("loadOrInitOverlaySignalState: %v", err)
	}
	if created {
		t.Fatalf("expected existing state to be loaded")
	}
	if state.CurrentQ1ExposurePct != 50 || state.LastAppliedQ1ExposurePct != 50 {
		t.Fatalf("loaded current/lastApplied = %v/%v, want accepted 50/50", state.CurrentQ1ExposurePct, state.LastAppliedQ1ExposurePct)
	}
}

func TestCreateOverlayEventCutsLowPortfolioWeightQ1Exposure(t *testing.T) {
	cleanup := setupOverlaySignalStateTestDB(t)
	defer cleanup()

	ctx := &overlayPortfolioContext{
		StatementTotalValue: 100000,
		ClassSummaries: map[string]*PortfolioOverlayAssetClassSummary{
			"MATERIALS": {
				AssetClass:             "MATERIALS",
				DisplayName:            "Materials",
				OverlayEligible:        true,
				ActualInvestedValue:    10000,
				TotalClassCapitalValue: 10000,
			},
			"BONDS": {
				AssetClass:             "BONDS",
				DisplayName:            "Bonds",
				OverlayEligible:        false,
				ActualInvestedValue:    90000,
				TotalClassCapitalValue: 90000,
			},
		},
		AssetClassKeys: map[string]struct{}{
			"MATERIALS": {},
			"BONDS":     {},
		},
	}

	event, classes, err := createOverlayEventFromContext(ctx, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("createOverlayEventFromContext: %v", err)
	}
	if event == nil {
		t.Fatalf("expected event")
	}
	if event.FromQ1ExposurePct != 100 || event.ToQ1ExposurePct != 50 || event.AdjustmentRatio != 0.5 {
		t.Fatalf("event from/to/ratio = %v/%v/%v, want 100/50/0.5", event.FromQ1ExposurePct, event.ToQ1ExposurePct, event.AdjustmentRatio)
	}

	materials := classes["MATERIALS"]
	if materials.TriggerInvestedValue != 10000 {
		t.Fatalf("materials trigger invested = %v, want 10000", materials.TriggerInvestedValue)
	}
	if materials.TargetInvestedValue != 5000 {
		t.Fatalf("materials target invested = %v, want 5000", materials.TargetInvestedValue)
	}

	bonds := classes["BONDS"]
	if bonds.TargetInvestedValue != 85500 {
		t.Fatalf("bonds target invested = %v, want 85500 liquidity haircut", bonds.TargetInvestedValue)
	}
}

func TestCreateOverlayEventIsIdempotentForOpenTransition(t *testing.T) {
	cleanup := setupOverlaySignalStateTestDB(t)
	defer cleanup()

	ctx := &overlayPortfolioContext{
		StatementTotalValue: 100000,
		ClassSummaries: map[string]*PortfolioOverlayAssetClassSummary{
			"MATERIALS": {
				AssetClass:             "MATERIALS",
				DisplayName:            "Materials",
				OverlayEligible:        true,
				ActualInvestedValue:    10000,
				TotalClassCapitalValue: 10000,
			},
		},
		AssetClassKeys: map[string]struct{}{
			"MATERIALS": {},
		},
	}

	first, _, err := createOverlayEventFromContext(ctx, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("create first event: %v", err)
	}
	second, _, err := createOverlayEventFromContext(ctx, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("create repeated event: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("repeated transition created event %d, want existing event %d", second.ID, first.ID)
	}

	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM overlay_events
		WHERE status IN ('PENDING', 'PARTIAL')
		  AND from_q1_exposure_pct = 100
		  AND to_q1_exposure_pct = 50
		  AND governing_source = 'SPY'
	`).Scan(&count); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if count != 1 {
		t.Fatalf("open 100 -> 50 event count = %d, want 1", count)
	}
}

func TestEnsurePendingOverlayEventClassesRepairsStaleAndMissingRows(t *testing.T) {
	cleanup := setupOverlaySignalStateTestDB(t)
	defer cleanup()

	initialCtx := &overlayPortfolioContext{
		StatementTotalValue: 100000,
		ClassSummaries: map[string]*PortfolioOverlayAssetClassSummary{
			"MATERIALS": {
				AssetClass:             "MATERIALS",
				DisplayName:            "Materials",
				OverlayEligible:        true,
				ActualInvestedValue:    10000,
				TotalClassCapitalValue: 10000,
			},
		},
		AssetClassKeys: map[string]struct{}{
			"MATERIALS": {},
		},
	}

	event, classes, err := createOverlayEventFromContext(initialCtx, 100, 50, "SPY")
	if err != nil {
		t.Fatalf("create initial event: %v", err)
	}
	if _, exists := classes["TECHNOLOGY"]; exists {
		t.Fatalf("unexpected technology class in initial event")
	}
	staleMaterials := classes["MATERIALS"]
	staleMaterials.TargetInvestedValue = staleMaterials.TriggerInvestedValue
	staleMaterials.TargetInvestedPct = staleMaterials.TriggerInvestedPct
	classes["MATERIALS"] = staleMaterials
	if _, err := db.Exec(`
		UPDATE overlay_event_classes
		SET target_invested_value = trigger_invested_value,
		    target_invested_pct = trigger_invested_pct
		WHERE event_id = ? AND asset_class = 'MATERIALS'
	`, event.ID); err != nil {
		t.Fatalf("corrupt materials target: %v", err)
	}

	currentCtx := &overlayPortfolioContext{
		StatementTotalValue: 100000,
		ClassSummaries: map[string]*PortfolioOverlayAssetClassSummary{
			"MATERIALS": {
				AssetClass:             "MATERIALS",
				DisplayName:            "Materials",
				OverlayEligible:        true,
				ActualInvestedValue:    12000,
				TotalClassCapitalValue: 12000,
			},
			"TECHNOLOGY": {
				AssetClass:             "TECHNOLOGY",
				DisplayName:            "Technology",
				OverlayEligible:        true,
				ActualInvestedValue:    1000,
				TotalClassCapitalValue: 1000,
			},
		},
		AssetClassKeys: map[string]struct{}{
			"MATERIALS":  {},
			"TECHNOLOGY": {},
		},
	}

	repaired, err := ensurePendingOverlayEventClasses(currentCtx, event, classes)
	if err != nil {
		t.Fatalf("ensurePendingOverlayEventClasses: %v", err)
	}
	technology, exists := repaired["TECHNOLOGY"]
	if !exists {
		t.Fatalf("technology class was not repaired into pending event")
	}
	if technology.TriggerInvestedValue != 1000 {
		t.Fatalf("technology trigger invested = %v, want 1000", technology.TriggerInvestedValue)
	}
	if technology.TargetInvestedValue != 500 {
		t.Fatalf("technology target invested = %v, want 500", technology.TargetInvestedValue)
	}
	materials, exists := repaired["MATERIALS"]
	if !exists {
		t.Fatalf("materials class was dropped during repair")
	}
	if materials.TriggerInvestedValue != 10000 {
		t.Fatalf("materials trigger invested = %v, want original snapshot 10000", materials.TriggerInvestedValue)
	}
	if materials.TargetInvestedValue != 5000 {
		t.Fatalf("materials target invested = %v, want repaired snapshot target 5000", materials.TargetInvestedValue)
	}

	var storedTarget, storedMaterialsTarget float64
	if err := db.QueryRow(`
		SELECT target_invested_value
		FROM overlay_event_classes
		WHERE event_id = ? AND asset_class = 'TECHNOLOGY'
	`, event.ID).Scan(&storedTarget); err != nil {
		t.Fatalf("query repaired technology class: %v", err)
	}
	if storedTarget != 500 {
		t.Fatalf("stored technology target = %v, want 500", storedTarget)
	}
	if err := db.QueryRow(`
		SELECT target_invested_value
		FROM overlay_event_classes
		WHERE event_id = ? AND asset_class = 'MATERIALS'
	`, event.ID).Scan(&storedMaterialsTarget); err != nil {
		t.Fatalf("query repaired materials class: %v", err)
	}
	if storedMaterialsTarget != 5000 {
		t.Fatalf("stored materials target = %v, want repaired snapshot target 5000", storedMaterialsTarget)
	}
}
