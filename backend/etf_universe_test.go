package main

import (
	"context"
	"testing"
)

// seedETFUniverseFixture creates a statement, an approved shape with one class,
// and the company mapping needed for statement holdings to resolve.
func seedETFUniverseFixture(t *testing.T) int64 {
	t.Helper()

	result, err := db.Exec(`
		INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
		VALUES ('ETF Universe Test', '2026-08-10T00:00:00Z', 100000, 5000)
	`)
	if err != nil {
		t.Fatalf("seed statement: %v", err)
	}
	statementID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("read statement id: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO asset_class_config (code, display_name, cash_reserve, active)
		VALUES ('GOLD_MINERS', 'Gold Miners', 0, 1)
		ON CONFLICT(code) DO UPDATE SET display_name = excluded.display_name, active = 1
	`); err != nil {
		t.Fatalf("seed asset class: %v", err)
	}

	snapshot, err := db.Exec(`INSERT INTO portfolio_mix_snapshots (status, reason) VALUES ('APPROVED', 'TEST')`)
	if err != nil {
		t.Fatalf("seed mix snapshot: %v", err)
	}
	snapshotID, err := snapshot.LastInsertId()
	if err != nil {
		t.Fatalf("read snapshot id: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO portfolio_mix_snapshot_rows (snapshot_id, asset_class, display_name, weight_pct)
		VALUES (?, 'GOLD_MINERS', 'Gold Miners', 20)
	`, snapshotID); err != nil {
		t.Fatalf("seed snapshot row: %v", err)
	}
	return statementID
}

// seedETFAnalysisRow classes a fund. Passing an empty assetClass leaves it
// unclassed. Neither state admits it to the ledger on its own — see §2 of the
// model doc: a class is a hint, not a membership door.
func seedETFAnalysisRow(t *testing.T, ticker, assetClass string) {
	t.Helper()
	symbol := canonicalSecurityTickerKey(ticker)
	if assetClass == "" {
		if _, err := db.Exec(`
			INSERT INTO stock_analysis (ticker, name, security_type)
			VALUES (?, ?, 'ETF')
		`, ticker, symbol+" Fund"); err != nil {
			t.Fatalf("seed unmapped ETF %s: %v", ticker, err)
		}
		return
	}
	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, security_type, primary_asset_class)
		VALUES (?, ?, 'ETF', ?)
	`, ticker, symbol+" Fund", assetClass); err != nil {
		t.Fatalf("seed mapped ETF %s: %v", ticker, err)
	}
}

// seedETFCorePolicy records the deliberate decision that a fund expresses a class.
// Today that record is asset_class_etf_policies; it is what the (class, fund)
// mapping table will replace.
func seedETFCorePolicy(t *testing.T, assetClass, ticker string, ratioPct float64) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO asset_class_etf_policies (asset_class, core_ticker, core_ratio_pct)
		VALUES (?, ?, ?)
		ON CONFLICT(asset_class) DO UPDATE SET
			core_ticker = excluded.core_ticker,
			core_ratio_pct = excluded.core_ratio_pct
	`, assetClass, ticker, ratioPct); err != nil {
		t.Fatalf("seed core policy %s/%s: %v", assetClass, ticker, err)
	}
}

func seedETFStatementHolding(t *testing.T, statementID int64, ticker string, value float64) {
	t.Helper()
	symbol := canonicalSecurityTickerKey(ticker)
	if _, err := db.Exec(`
		INSERT INTO company_mappings (ticker, company_name, exchange_prefix)
		VALUES (?, ?, 'ASX:')
	`, symbol, symbol+" Fund"); err != nil {
		t.Fatalf("seed company mapping %s: %v", ticker, err)
	}
	if _, err := db.Exec(`
		INSERT INTO statement_holdings (
			statement_id, details, quantity, cost_aud, current_price,
			value_aud, gain_loss_aud, gain_loss_pct, market_value
		) VALUES (?, ?, 100, ?, 5, ?, 0, 0, ?)
	`, statementID, symbol+" Fund", value, value, value); err != nil {
		t.Fatalf("seed statement holding %s: %v", ticker, err)
	}
	// Statement imports also reconcile the active holdings ledger, which now
	// supplies occupied capital to both ETF and stock budget calculations.
	actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES (?, ?, 100, 5, ?, 1)`, symbol, symbol+" Fund", value)
}

func ledgerTickers(t *testing.T) map[string]bool {
	t.Helper()
	ledger, err := buildETFAllocationLedger(context.Background())
	if err != nil {
		t.Fatalf("build ledger: %v", err)
	}
	present := map[string]bool{}
	for _, row := range ledger.Rows {
		present[row.Ticker] = true
	}
	return present
}

// A legacy TradingView weight is not a portfolio decision and must no longer
// admit a fund to the universe.
func TestLegacyMomentumWeightDoesNotAdmitAFund(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()
	seedETFUniverseFixture(t)

	if _, err := db.Exec(`
		INSERT INTO etf_allocations (ticker, allocation_percent, base_weight, tactical_status)
		VALUES ('LEGACY', 12.5, 12.5, 'BUY')
	`); err != nil {
		t.Fatalf("seed legacy weight: %v", err)
	}

	if ledgerTickers(t)["LEGACY"] {
		t.Fatal("a fund with only a legacy TradingView weight was admitted to the ledger")
	}
}

// Money in the book cannot be invisible. A held fund with no class earns a row
// AND a gap-report entry: the row because the capital is real, the gap entry
// because no stated intent put it there.
func TestHeldButUnmappedFundIsBothARowAndAGap(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()
	statementID := seedETFUniverseFixture(t)

	seedETFAnalysisRow(t, "ASX:ESPO", "")
	seedETFStatementHolding(t, statementID, "ASX:ESPO", 2140)

	if !ledgerTickers(t)["ESPO"] {
		t.Fatal("a held fund was dropped from the ledger for having no asset class")
	}

	unmapped, err := loadUnmappedHeldETFs()
	if err != nil {
		t.Fatalf("load unmapped holdings: %v", err)
	}
	found := false
	for _, entry := range unmapped {
		if entry.Ticker == "ESPO" {
			found = true
		}
	}
	if !found {
		t.Fatalf("unmapped held fund missing from the gap report, got %+v", unmapped)
	}
}

// The regression that falsified the model doc's premise. primary_asset_class is
// analysis metadata written for every ETF ever researched, so a class alone must
// never admit a fund — otherwise the whole research universe becomes ledger rows.
// A classed fund that is neither selected nor held is a candidate.
func TestClassAloneDoesNotAdmitAFund(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()
	seedETFUniverseFixture(t)

	seedETFAnalysisRow(t, "ASX:GDX", "GOLD_MINERS")

	if ledgerTickers(t)["GDX"] {
		t.Fatal("a classed but unselected, unheld fund was admitted to the ledger")
	}
}

// A selected fund earns a row whatever it holds. Selected and at zero is the class
// expressed in intent and unexpressed in fact, the state most worth seeing.
func TestSelectedFundEarnsARowEvenWhenUnheld(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()
	seedETFUniverseFixture(t)

	seedETFAnalysisRow(t, "ASX:GDX", "GOLD_MINERS")
	seedETFCorePolicy(t, "GOLD_MINERS", "GDX", 50)

	if !ledgerTickers(t)["GDX"] {
		t.Fatal("a selected fund with no holding was dropped from the ledger")
	}
}

func TestShortlistRoundTripAndMappedFlag(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()
	seedETFUniverseFixture(t)

	if _, err := db.Exec(`
		INSERT INTO etf_shortlist (ticker, display_name, note, asset_class_hint)
		VALUES ('NUCL', 'Sprott Uranium Miners', 'candidate for an energy sleeve', 'GOLD_MINERS')
	`); err != nil {
		t.Fatalf("seed shortlist: %v", err)
	}

	entries, err := loadETFShortlist()
	if err != nil {
		t.Fatalf("load shortlist: %v", err)
	}
	if len(entries) != 1 || entries[0].Ticker != "NUCL" {
		t.Fatalf("shortlist = %+v, want one NUCL entry", entries)
	}
	if entries[0].Mapped {
		t.Fatal("an unmapped shortlist entry was flagged as mapped")
	}
	if ledgerTickers(t)["NUCL"] {
		t.Fatal("a shortlist entry was given a ledger row — the shortlist carries no target")
	}

	// Adopting the candidate classes it; the shortlist row becomes redundant and
	// says so rather than vanishing.
	seedETFAnalysisRow(t, "ASX:NUCL", "GOLD_MINERS")
	entries, err = loadETFShortlist()
	if err != nil {
		t.Fatalf("reload shortlist: %v", err)
	}
	if !entries[0].Mapped {
		t.Fatal("shortlist entry was not flagged as mapped after being adopted")
	}
	if ledgerTickers(t)["NUCL"] {
		t.Fatal("classing a candidate alone put it in the ledger")
	}

	// Selecting it is the deliberate act that admits it.
	seedETFCorePolicy(t, "GOLD_MINERS", "NUCL", 50)
	if !ledgerTickers(t)["NUCL"] {
		t.Fatal("an adopted and selected candidate did not enter the ledger")
	}
}

// The ledger and the watchlist partition the classed universe: a fund is in one
// or the other, never both and never neither. This is what stops a research
// universe from becoming ledger rows while still keeping it visible.
func TestClassedFundsSplitBetweenLedgerAndCandidates(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()
	statementID := seedETFUniverseFixture(t)

	seedETFAnalysisRow(t, "ASX:GDX", "GOLD_MINERS")  // selected below
	seedETFAnalysisRow(t, "ASX:GDXJ", "GOLD_MINERS") // classed only
	seedETFAnalysisRow(t, "ASX:NST", "GOLD_MINERS")  // classed, but held
	seedETFStatementHolding(t, statementID, "ASX:NST", 1500)
	seedETFCorePolicy(t, "GOLD_MINERS", "GDX", 50)

	ledger, err := buildETFAllocationLedger(context.Background())
	if err != nil {
		t.Fatalf("build ledger: %v", err)
	}

	inLedger := map[string]bool{}
	for _, row := range ledger.Rows {
		inLedger[row.Ticker] = true
	}
	inCandidates := map[string]bool{}
	for _, candidate := range ledger.Candidates {
		inCandidates[candidate.Ticker] = true
	}

	for _, ticker := range []string{"GDX", "NST"} {
		if !inLedger[ticker] {
			t.Errorf("%s should be a ledger row", ticker)
		}
		if inCandidates[ticker] {
			t.Errorf("%s is a ledger row and must not also be a candidate", ticker)
		}
	}
	if !inCandidates["GDXJ"] {
		t.Error("a classed, unselected, unheld fund should be a candidate")
	}
	if inLedger["GDXJ"] {
		t.Error("a classed, unselected, unheld fund must not be a ledger row")
	}
}
