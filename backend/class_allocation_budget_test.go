package main

import (
	"context"
	"math"
	"testing"
)

func assertBudgetValue(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > .001 {
		t.Fatalf("%s = %.4f, want %.4f", name, got, want)
	}
}

func seedClassBudgetCore(t *testing.T) {
	t.Helper()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 1000)
	actionUnitsExec(t, `INSERT OR REPLACE INTO settings (key, value) VALUES ('etf_momentum_source', 'LEGACY_COMPATIBILITY')`)
	actionUnitsExec(t, `INSERT INTO stock_analysis (ticker, name, allocation, primary_asset_class, security_type)
		VALUES ('SGDJ', 'Gold fund', 5, 'GOLD_MINERS', 'ETF')`)
	actionUnitsExec(t, `INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES ('SGDJ', 'Gold fund', 100, 10, 1000, 1)`)
	actionUnitsExec(t, `INSERT OR REPLACE INTO etf_allocations (ticker, allocation_percent, base_weight, tactical_status)
		VALUES ('SGDJ', 30, 30, 'BUY'), ('NUCL', 10, 10, 'BUY')`)
	actionUnitsExec(t, `INSERT INTO asset_class_etf_policies (asset_class, core_ticker, core_ratio_pct, momentum_influence_pct)
		VALUES ('GOLD_MINERS', 'SGDJ', 25, 50)`)
}

func TestClassBudgetSharedAcrossLedgerSizingAndPurchases(t *testing.T) {
	for _, tc := range []struct {
		name, change   string
		target, stocks float64
	}{
		{"automatic momentum retained", `SELECT 1`, 3125, 6875},
		{"Sell releases only unoccupied capacity", `UPDATE etf_allocations SET tactical_status = 'SELL' WHERE ticker = 'SGDJ'`, 0, 9000},
		{"overweight ETF still consumes capital", `UPDATE holdings SET value_aud = 4000 WHERE ticker = 'SGDJ'`, 3125, 6000},
		{"non-Core holding still consumes capital", `INSERT INTO stock_analysis (ticker, name, primary_asset_class, security_type) VALUES ('GDXJ', 'Other gold fund', 'GOLD_MINERS', 'ETF'); INSERT INTO holdings (ticker, company_name, value_aud, is_active) VALUES ('GDXJ', 'Other gold fund', 4000, 1)`, 3125, 5000},
		{"no Core does not reserve a quarter", `DELETE FROM asset_class_etf_policies`, 0, 9000},
		{"sold and deselected releases all", `DELETE FROM asset_class_etf_policies; UPDATE holdings SET is_active = 0 WHERE ticker = 'SGDJ'`, 0, 10000},
		{"no class mandate creates no capacity", `DELETE FROM portfolio_mix_snapshot_rows`, 0, 0},
		{"static stock ratio no longer drives split", `UPDATE asset_class_config SET stock_allocation_ratio = .01`, 3125, 6875},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			seedClassBudgetCore(t)
			actionUnitsExec(t, tc.change)
			ledger, err := buildETFAllocationLedger(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			for _, class := range ledger.Classes {
				if class.AssetClass != "GOLD_MINERS" {
					continue
				}
				assertBudgetValue(t, "effective ETF", class.EffectiveTargetValue, tc.target)
				assertBudgetValue(t, "ledger stock budget", class.StockCapacityValue, tc.stocks)
			}
			request := SizingRequest{TotalPortfolioValue: 999999, ClassBudgets: []ClassBudget{
				{AssetClass: "GOLD_MINERS", ClassBudget: 999999},
				{AssetClass: "OFF_MANDATE", ClassBudget: 999999},
			}}
			if err := resolveAuthoritativeSizingBudgets(context.Background(), &request); err != nil {
				t.Fatal(err)
			}
			assertBudgetValue(t, "advisory stock budget", request.ClassBudgets[0].StockBudget, tc.stocks)
			assertBudgetValue(t, "off-mandate advisory budget", request.ClassBudgets[1].StockBudget, 0)
			assertBudgetValue(t, "server portfolio total", request.TotalPortfolioValue, 10000)
			capacities, err := deploymentClassCapacities()
			if err != nil {
				t.Fatal(err)
			}
			assertBudgetValue(t, "purchase stock budget", capacities["GOLD_MINERS"].TargetValue, tc.stocks)
			assertBudgetValue(t, "legacy direct-stock denominator excludes funds", capacities["GOLD_MINERS"].StrategicWeight, 20)
		})
	}
}

func TestClassBudgetPendingPurchasesAndQ3(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedClassBudgetCore(t)
	actionUnitsExec(t, `UPDATE weight_policy SET enabled=1`)
	// A $1,000 class with a $312.50 fund target, $100 of funds and $300
	// of stocks. A pending fund purchase within target is not deducted twice.
	actionUnitsExec(t, `UPDATE portfolio_mix_snapshot_rows SET weight_pct = 10`)
	actionUnitsExec(t, `UPDATE holdings SET value_aud = CASE ticker WHEN 'SGDJ' THEN 100 ELSE 300 END`)
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	f := deploymentFunding{ClassCash: map[string]float64{"GOLD_MINERS": 500}, ClassSpent: map[string]float64{"GOLD_MINERS": 100}, SecuritySpent: map[string]float64{"SGDJ": 100}}
	f.recordClassSecuritySpend("GOLD_MINERS", "SGDJ", 100)
	stock := capacities["GOLD_MINERS"].forSecurity("AEVT", f)
	fund := capacities["GOLD_MINERS"].forSecurity("SGDJ", f)
	assertBudgetValue(t, "stock headroom after pending ETF", stock.TargetShortfall, 387.5)
	assertBudgetValue(t, "ETF headroom after pending ETF", fund.TargetShortfall, 112.5)
	f.ClassSpent["GOLD_MINERS"] += 50
	f.SecuritySpent["AEVT"] = 50
	f.recordClassSecuritySpend("GOLD_MINERS", "AEVT", 50)
	stock = capacities["GOLD_MINERS"].forSecurity("AEVT", f)
	assertBudgetValue(t, "pending stock consumes stock budget once", stock.TargetShortfall, 337.5)
	actionUnitsExec(t, `UPDATE equity_sizing SET target_equity_pct = 50 WHERE source_ticker = 'SPX'`)
	capacities, err = deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	stock = capacities["GOLD_MINERS"].forSecurity("AEVT", f)
	assertBudgetValue(t, "Q3 cap includes both holdings and pending purchases", stock.TargetShortfall, 0)
	assertBudgetValue(t, "Q3 does not rewrite approved class", stock.ApprovedTarget, 1000)
}

func TestClassBudgetLiveResearchDoesNotChangePurchaseTarget(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedClassBudgetCore(t)
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	before, _, err := securityActionTargetValue("AEVT", capacities["GOLD_MINERS"])
	if err != nil {
		t.Fatal(err)
	}
	for _, score := range []float64{1, 9} {
		req := SizingRequest{Stocks: []SizingStockInput{{Ticker: "ASX:AEVT", AssetClass: "GOLD_MINERS", GeminiQuality: score, GeminiValue: score, GeminiPT: 20, CurrentPrice: 10}}, ClassBudgets: []ClassBudget{{AssetClass: "GOLD_MINERS", ClassBudget: 10000}}}
		if err := resolveAuthoritativeSizingBudgets(context.Background(), &req); err != nil {
			t.Fatal(err)
		}
		result := CalculateAllocations(req)
		if !result.AdvisoryOnly {
			t.Fatal("research must be marked advisory")
		}
	}
	after, _, err := securityActionTargetValue("AEVT", capacities["GOLD_MINERS"])
	if err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "research must not persist a purchase target", after, before)
}

func TestClassBudgetExecutionReadsCorePolicyInsideTransaction(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedClassBudgetCore(t)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE asset_class_etf_policies SET core_ratio_pct = 100, momentum_influence_pct = 0`); err != nil {
		t.Fatal(err)
	}
	capacities, err := deploymentClassCapacitiesFrom(tx)
	if err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "transactional stock budget", capacities["GOLD_MINERS"].TargetValue, 0)
	assertBudgetValue(t, "transactional ETF target", capacities["GOLD_MINERS"].ETFs["SGDJ"].EffectiveTargetValue, 10000)
}

func TestClassBudgetUnavailableModelPausesBuysWithoutHidingExits(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedClassBudgetCore(t)
	buy := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	insertSecurityActionTestAlert(t, "SGDJ", "SELL")
	assertDeploymentState(t, buy, deploymentStateFunded)
	actionUnitsExec(t, `UPDATE settings SET value = 'INTERNAL_PUBLISHED' WHERE key = 'etf_momentum_source'`)
	assertDeploymentState(t, buy, deploymentStateTargetUnavailable)
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM security_actions WHERE intent = 'EXIT' AND status = 'OPEN'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("exit count = %d, want 1", count)
	}
}
