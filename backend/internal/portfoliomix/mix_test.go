package portfoliomix

import "testing"

func testResolver(value string) (Sleeve, bool) {
	switch value {
	case "GOLD", "GOLD_MINERS":
		return Sleeve{Code: "GOLD_MINERS", DisplayName: "Gold Miners", DisplayOrder: 10}, true
	case "PHARMA", "PHARMA_BIOTECH":
		return Sleeve{Code: "PHARMA_BIOTECH", DisplayName: "Pharma & Biotech", DisplayOrder: 20}, true
	case "CASH":
		return Sleeve{Code: "CASH", DisplayName: "Cash/Reserve", DisplayOrder: 999}, true
	default:
		return Sleeve{}, false
	}
}

func TestBuildRowsCombinesResolvedSleevesAndAddsCash(t *testing.T) {
	rows := BuildRows([]Summary{
		{
			AssetClass:             "GOLD",
			DisplayName:            "Gold",
			OverlayEligible:        true,
			ActualInvestedPct:      10,
			ActualInvestedValue:    10000,
			TacticalCashPct:        2,
			TacticalCashValue:      2000,
			TotalClassCapitalValue: 12000,
		},
		{
			AssetClass:             "GOLD_MINERS",
			DisplayName:            "Gold Miners",
			ActualInvestedPct:      5,
			ActualInvestedValue:    5000,
			TacticalCashPct:        1,
			TacticalCashValue:      1000,
			TotalClassCapitalValue: 6000,
		},
	}, 100000, 3000, testResolver)

	if len(rows) != 2 {
		t.Fatalf("rows len = %d, want 2: %#v", len(rows), rows)
	}
	if rows[0].AssetClass != "GOLD_MINERS" {
		t.Fatalf("first row asset class = %q, want GOLD_MINERS", rows[0].AssetClass)
	}
	if rows[0].WeightPct != 15 || rows[0].SleeveCashWeightPct != 3 || rows[0].Value != 15000 || rows[0].SleeveCashValue != 3000 {
		t.Fatalf("combined gold row = %#v", rows[0])
	}
	if !rows[0].GovernedByQ1 {
		t.Fatalf("combined gold row should keep governed-by-Q1 when any source summary is eligible")
	}
	if rows[1].AssetClass != "CASH" || rows[1].WeightPct != 3 || rows[1].Value != 3000 {
		t.Fatalf("cash row = %#v, want 3%% cash row", rows[1])
	}
}

func TestBuildRowsSortsByDisplayOrderThenWeight(t *testing.T) {
	rows := BuildRows([]Summary{
		{
			AssetClass:             "Z_CLASS",
			DisplayName:            "Z Class",
			DisplayOrder:           100,
			ActualInvestedPct:      5,
			ActualInvestedValue:    5000,
			TotalClassCapitalValue: 5000,
		},
		{
			AssetClass:             "A_CLASS",
			DisplayName:            "A Class",
			DisplayOrder:           100,
			ActualInvestedPct:      8,
			ActualInvestedValue:    8000,
			TotalClassCapitalValue: 8000,
		},
		{
			AssetClass:             "PHARMA",
			DisplayName:            "Pharma",
			ActualInvestedPct:      1,
			ActualInvestedValue:    1000,
			TotalClassCapitalValue: 1000,
		},
	}, 100000, 0, testResolver)

	got := []string{rows[0].AssetClass, rows[1].AssetClass, rows[2].AssetClass}
	want := []string{"PHARMA_BIOTECH", "A_CLASS", "Z_CLASS"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("row order = %#v, want %#v", got, want)
		}
	}
}

func TestBuildRowsSkipsEmptySummariesButKeepsCashForNonEmptyPortfolio(t *testing.T) {
	rows := BuildRows([]Summary{{AssetClass: "GOLD", DisplayName: "Gold"}}, 100000, 0, testResolver)
	if len(rows) != 1 || rows[0].AssetClass != "CASH" || rows[0].WeightPct != 0 {
		t.Fatalf("rows = %#v, want zero-value cash row only", rows)
	}
}

func TestBuildCashComponentsFiltersWeightsSortsAndFallsBack(t *testing.T) {
	components := BuildCashComponents([]CashComponent{
		{Key: "ZERO", DisplayName: "Zero", Value: 0, DisplayOrder: 1},
		{Key: "B", DisplayName: "B Cash", Value: 2000, DisplayOrder: 2},
		{Key: "A", DisplayName: "A Cash", Value: 1000, DisplayOrder: 1},
	}, 100000, 3000)

	if len(components) != 2 {
		t.Fatalf("components len = %d, want 2", len(components))
	}
	if components[0].Key != "A" || components[0].WeightPct != 1 {
		t.Fatalf("first component = %#v, want A with 1%%", components[0])
	}
	if components[1].Key != "B" || components[1].WeightPct != 2 {
		t.Fatalf("second component = %#v, want B with 2%%", components[1])
	}

	fallback := BuildCashComponents(nil, 100000, 3000)
	if len(fallback) != 1 || fallback[0].Key != "CASH_RESERVE" || fallback[0].WeightPct != 3 {
		t.Fatalf("fallback = %#v, want CASH_RESERVE at 3%%", fallback)
	}
}
