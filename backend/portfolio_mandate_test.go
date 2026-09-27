package main

import (
	"testing"
)

// seedApprovedShape writes an approved portfolio mix — the mandate.
func seedApprovedShape(t *testing.T, weights map[string]float64) {
	t.Helper()
	result, err := db.Exec(`INSERT INTO portfolio_mix_snapshots (status, reason) VALUES ('APPROVED', 'TEST')`)
	if err != nil {
		t.Fatalf("seed approved shape: %v", err)
	}
	snapshotID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("read snapshot id: %v", err)
	}
	for class, weight := range weights {
		if _, err := db.Exec(`
			INSERT INTO portfolio_mix_snapshot_rows (snapshot_id, asset_class, display_name, weight_pct)
			VALUES (?, ?, ?, ?)
		`, snapshotID, class, class, weight); err != nil {
			t.Fatalf("seed shape row %s: %v", class, err)
		}
	}
}

func seedMandateSecurity(t *testing.T, name, ticker, class, securityType string) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, primary_asset_class, security_type)
		VALUES (?, ?, ?, ?)
	`, ticker, name, class, securityType); err != nil {
		t.Fatalf("seed security %s: %v", name, err)
	}
}

func seedMandateHolding(t *testing.T, statementID int64, name string, value float64) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO statement_holdings (
			statement_id, details, quantity, cost_aud, current_price,
			value_aud, gain_loss_aud, gain_loss_pct, market_value
		) VALUES (?, ?, 100, ?, 5, ?, 0, 0, ?)
	`, statementID, name, value, value, value); err != nil {
		t.Fatalf("seed holding %s: %v", name, err)
	}
}

func seedMandateStatement(t *testing.T) int64 {
	t.Helper()
	result, err := db.Exec(`
		INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
		VALUES ('Mandate Test', '2026-09-01T00:00:00Z', 100000, 0)
	`)
	if err != nil {
		t.Fatalf("seed statement: %v", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("read statement id: %v", err)
	}
	return id
}

func stateOf(report MandateReport, ticker string) string {
	for _, row := range report.OffMandate {
		if row.Ticker == ticker {
			return row.State
		}
	}
	for _, row := range report.Researched {
		if row.Ticker == ticker {
			return row.State
		}
	}
	return ""
}

// The four states, in one fixture, for a stock and a fund alike — the mandate
// binds both (model §8.1).
func TestMandateStatesAreSeparated(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	statementID := seedMandateStatement(t)
	seedApprovedShape(t, map[string]float64{
		"GOLD_MINERS":    20,
		"SEMICONDUCTORS": 5,
		"URANIUM_MINERS": 3, // funded, nothing classed into it
	})

	// Funded and held.
	seedMandateSecurity(t, "Gold Miner Co", "GOLDCO", "GOLD_MINERS", "STOCK")
	seedMandateHolding(t, statementID, "Gold Miner Co", 5000)

	// Off-mandate: classed outside the shape, and held. A fund.
	seedMandateSecurity(t, "Procure Space", "UFO", "CIVIL_AEROSPACE", "ETF")
	seedMandateHolding(t, statementID, "Procure Space", 557)

	// Off-mandate: same state, but a stock — the mandate binds both.
	seedMandateSecurity(t, "Aero Parts Ltd", "AERO", "CIVIL_AEROSPACE", "STOCK")
	seedMandateHolding(t, statementID, "Aero Parts Ltd", 1200)

	// Researched, not mandated: classed outside the shape, not held.
	seedMandateSecurity(t, "Lithium Hopeful", "LITH", "LITHIUM_MINERS", "STOCK")

	report, err := buildMandateReport()
	if err != nil {
		t.Fatalf("build mandate report: %v", err)
	}
	if !report.HasApprovedShape {
		t.Fatal("an approved shape was seeded but not detected")
	}

	if got := stateOf(report, "UFO"); got != MandateStateOffMandate {
		t.Errorf("held fund outside the mandate: state = %q, want OFF_MANDATE", got)
	}
	if got := stateOf(report, "AERO"); got != MandateStateOffMandate {
		t.Errorf("held stock outside the mandate: state = %q, want OFF_MANDATE — the mandate binds stocks too", got)
	}
	if got := stateOf(report, "LITH"); got != MandateStateResearched {
		t.Errorf("unheld security outside the mandate: state = %q, want RESEARCHED_NOT_MANDATED", got)
	}
	if stateOf(report, "GOLDCO") != "" {
		t.Error("a funded security must not appear in either exception list")
	}
	if report.Counts[MandateStateFunded] != 1 {
		t.Errorf("funded count = %d, want 1", report.Counts[MandateStateFunded])
	}

	unexpressed := map[string]bool{}
	for _, class := range report.Unexpressed {
		unexpressed[class.AssetClass] = true
	}
	if !unexpressed["URANIUM_MINERS"] {
		t.Error("a funded class with nothing classed into it should be UNEXPRESSED")
	}
	if unexpressed["GOLD_MINERS"] {
		t.Error("a funded class with a security in it is not unexpressed")
	}
}

// Off-mandate money counts toward exposure and is reported separately, so the
// gap between actual and target is explained rather than mysterious (model §8.2).
func TestOffMandateValueIsCountedAndReported(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	statementID := seedMandateStatement(t)
	seedApprovedShape(t, map[string]float64{"GOLD_MINERS": 20})

	seedMandateSecurity(t, "Gold Miner Co", "GOLDCO", "GOLD_MINERS", "STOCK")
	seedMandateHolding(t, statementID, "Gold Miner Co", 3000)
	seedMandateSecurity(t, "Procure Space", "UFO", "CIVIL_AEROSPACE", "ETF")
	seedMandateHolding(t, statementID, "Procure Space", 1000)

	report, err := buildMandateReport()
	if err != nil {
		t.Fatalf("build mandate report: %v", err)
	}

	if report.PortfolioValue != 4000 {
		t.Errorf("portfolio value = %.0f, want 4000 — off-mandate money still counts", report.PortfolioValue)
	}
	if report.OffMandateValue != 1000 {
		t.Errorf("off-mandate value = %.0f, want 1000", report.OffMandateValue)
	}
	if report.OffMandatePct < 24.9 || report.OffMandatePct > 25.1 {
		t.Errorf("off-mandate pct = %.2f, want 25", report.OffMandatePct)
	}
}

// The off-mandate report is read for size. Biggest exposure first.
func TestOffMandateReportIsOrderedByValue(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	statementID := seedMandateStatement(t)
	seedApprovedShape(t, map[string]float64{"GOLD_MINERS": 20})
	seedMandateSecurity(t, "Small Off", "SMALL", "CIVIL_AEROSPACE", "STOCK")
	seedMandateHolding(t, statementID, "Small Off", 100)
	seedMandateSecurity(t, "Large Off", "LARGE", "CIVIL_AEROSPACE", "STOCK")
	seedMandateHolding(t, statementID, "Large Off", 9000)

	report, err := buildMandateReport()
	if err != nil {
		t.Fatalf("build mandate report: %v", err)
	}
	if len(report.OffMandate) != 2 || report.OffMandate[0].Ticker != "LARGE" {
		t.Fatalf("off-mandate order = %+v, want LARGE first", report.OffMandate)
	}
}

// With no approved shape there is no mandate, so nothing can be judged against
// it. The report says so rather than declaring the whole book off-mandate.
func TestNoApprovedShapeMeansNoJudgement(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	statementID := seedMandateStatement(t)
	seedMandateSecurity(t, "Procure Space", "UFO", "CIVIL_AEROSPACE", "ETF")
	seedMandateHolding(t, statementID, "Procure Space", 557)

	report, err := buildMandateReport()
	if err != nil {
		t.Fatalf("build mandate report: %v", err)
	}
	if report.HasApprovedShape {
		t.Fatal("no shape was seeded but one was reported")
	}
	if len(report.OffMandate) != 0 {
		t.Errorf("without a mandate nothing is off-mandate, got %+v", report.OffMandate)
	}
}

// Classification is never constrained — the picker reports mandate status so the
// consequence is visible, and that is all (model §2).
func TestAssetClassesCarryMandateStatus(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	seedApprovedShape(t, map[string]float64{"GOLD_MINERS": 20})

	mandate, hasShape, err := loadMandateClasses()
	if err != nil {
		t.Fatalf("load mandate classes: %v", err)
	}
	if !hasShape {
		t.Fatal("approved shape not detected")
	}
	if _, ok := mandate["GOLD_MINERS"]; !ok {
		t.Error("a funded class is missing from the mandate")
	}
	if _, ok := mandate["CIVIL_AEROSPACE"]; ok {
		t.Error("an unfunded class must not be in the mandate")
	}
}
