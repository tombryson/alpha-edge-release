package main

import (
	"database/sql"
	"math"
	"testing"
)

func TestCalculateCoreMomentumTarget(t *testing.T) {
	tests := []struct {
		name           string
		baseValue      float64
		modelWeight    float64
		neutralWeight  float64
		influencePct   float64
		hasModelWeight bool
		wantAdjustment float64
		wantTarget     float64
	}{
		{
			name:           "missing model leaves Core base unchanged",
			baseValue:      5000,
			neutralWeight:  10,
			influencePct:   50,
			hasModelWeight: false,
			wantTarget:     5000,
		},
		{
			name:           "neutral model weight leaves Core base unchanged",
			baseValue:      5000,
			modelWeight:    10,
			neutralWeight:  10,
			influencePct:   50,
			hasModelWeight: true,
			wantTarget:     5000,
		},
		{
			name:           "upper relative weight is bounded before influence",
			baseValue:      5000,
			modelWeight:    20,
			neutralWeight:  10,
			influencePct:   50,
			hasModelWeight: true,
			wantAdjustment: 1250,
			wantTarget:     6250,
		},
		{
			name:           "zero selected weight reduces but preserves Core base",
			baseValue:      5000,
			modelWeight:    0,
			neutralWeight:  10,
			influencePct:   50,
			hasModelWeight: true,
			wantAdjustment: -1250,
			wantTarget:     3750,
		},
		{
			name:           "influence is capped at one hundred percent",
			baseValue:      5000,
			modelWeight:    20,
			neutralWeight:  10,
			influencePct:   250,
			hasModelWeight: true,
			wantAdjustment: 2500,
			wantTarget:     7500,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adjustment, target := calculateCoreMomentumTarget(
				test.baseValue,
				test.modelWeight,
				test.neutralWeight,
				test.influencePct,
				test.hasModelWeight,
			)
			if math.Abs(adjustment-test.wantAdjustment) > 0.001 {
				t.Fatalf("adjustment = %.2f, want %.2f", adjustment, test.wantAdjustment)
			}
			if math.Abs(target-test.wantTarget) > 0.001 {
				t.Fatalf("target = %.2f, want %.2f", target, test.wantTarget)
			}
		})
	}
}

func TestLegacyMomentumTickerSetExcludesOperationalETFRows(t *testing.T) {
	allocations := []etfAllocationDBRow{
		{Ticker: "NUCL", AllocationPercent: 5.7},
		{Ticker: "WREE", AllocationPercent: 0},
	}

	tickers := etfMomentumModelTickerSet("LEGACY_COMPATIBILITY", allocations)
	if !tickers["NUCL"] {
		t.Fatal("NUCL should remain in the legacy 15-member momentum universe")
	}
	if tickers["WREE"] {
		t.Fatal("operational ETF row WREE must not dilute the legacy momentum universe")
	}
	if len(tickers) != len(etfMomentumLegacyUniverse) {
		t.Fatalf("legacy ticker set has %d members, want %d", len(tickers), len(etfMomentumLegacyUniverse))
	}
}

func TestResolveConfiguredCoreTickerRequiresExplicitPolicy(t *testing.T) {
	mappings := map[string]etfMappingDBRow{
		"SLVR": {
			Ticker:     "SLVR",
			AssetClass: "SILVER_MINERS",
			Active:     true,
		},
	}

	ticker, source := resolveConfiguredCoreTicker(
		"SILVER_MINERS",
		etfCorePolicyDBRow{},
		false,
		mappings,
	)
	if ticker != "" || source != "" {
		t.Fatalf("unconfigured sole candidate resolved as Core: ticker=%q source=%q", ticker, source)
	}

	ticker, source = resolveConfiguredCoreTicker(
		"SILVER_MINERS",
		etfCorePolicyDBRow{CoreTicker: "SLVR"},
		true,
		mappings,
	)
	if ticker != "SLVR" || source != "CONFIGURED" {
		t.Fatalf("configured Core not resolved: ticker=%q source=%q", ticker, source)
	}
}

func TestResolveConfiguredCoreTickerRejectsInvalidMapping(t *testing.T) {
	mappings := map[string]etfMappingDBRow{
		"SLVR": {
			Ticker:     "SLVR",
			AssetClass: "GOLD_MINERS",
			Active:     true,
		},
	}

	ticker, source := resolveConfiguredCoreTicker(
		"SILVER_MINERS",
		etfCorePolicyDBRow{CoreTicker: "SLVR"},
		true,
		mappings,
	)
	if ticker != "" || source != "" {
		t.Fatalf("mismatched Core mapping resolved: ticker=%q source=%q", ticker, source)
	}
}

func TestLoadETFActualValuesRejectsBlankTickerZombie(t *testing.T) {
	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	db = testDB
	defer func() {
		db = previousDB
		testDB.Close()
	}()

	if _, err := db.Exec(`
		CREATE TABLE account_statements (
			id INTEGER PRIMARY KEY,
			statement_date DATETIME
		);
		CREATE TABLE statement_holdings (
			statement_id INTEGER,
			details TEXT,
			value_aud REAL,
			security_id INTEGER
		);
		CREATE TABLE company_mappings (
			company_name TEXT,
			ticker TEXT
		);
		CREATE TABLE etf_allocations (
			ticker TEXT
		);
		CREATE TABLE stock_analysis (
			ticker TEXT,
			security_type TEXT,
			security_id INTEGER
		);

		INSERT INTO account_statements (id, statement_date) VALUES (1, CURRENT_TIMESTAMP);
		INSERT INTO statement_holdings (statement_id, details, value_aud, security_id)
		VALUES
			(1, 'Blank mapped holding', 436, 1),
			(1, 'Defiance ETF', 465, 2);
		INSERT INTO company_mappings (company_name, ticker)
		VALUES
			('Blank mapped holding', ''),
			('Defiance ETF', 'JEDI');
		INSERT INTO stock_analysis (ticker, security_type, security_id)
		VALUES
			('', 'ETF', 1),
			('BATS:JEDI', 'ETF', 2);
	`); err != nil {
		t.Fatalf("create ETF actual-value fixture: %v", err)
	}

	actuals, err := loadETFActualValues()
	if err != nil {
		t.Fatalf("load ETF actual values: %v", err)
	}
	if _, found := actuals[""]; found {
		t.Fatalf("blank ticker holding leaked into ETF actual values: %#v", actuals)
	}
	if got := actuals["JEDI"]; math.Abs(got-465) > 0.001 {
		t.Fatalf("JEDI actual value = %.2f, want 465", got)
	}
}
