package portfoliotarget

import (
	"math"
	"testing"
)

func testKey(value string) string {
	switch value {
	case "GOLD", "GOLD_MINERS":
		return "GOLDMINERS"
	case "PHARMA", "Pharma & Biotech":
		return "PHARMABIOTECH"
	default:
		return value
	}
}

func TestBuildAdjustmentPlanNilPlan(t *testing.T) {
	if got := BuildAdjustmentPlan(nil, 100000, nil, testKey); got != nil {
		t.Fatalf("BuildAdjustmentPlan(nil) = %#v, want nil", got)
	}
}

func TestBuildAdjustmentPlanMatchesCanonicalAliases(t *testing.T) {
	plan := &Plan{
		ID:     7,
		Status: "OPEN",
		Title:  "Manual target",
		Rows: []PlanRow{
			{AssetClass: "GOLD", DisplayName: "Gold Miners", TargetWeightPct: 22.1},
			{AssetClass: "Pharma & Biotech", DisplayName: "Pharma & Biotech", TargetWeightPct: 13.5},
		},
	}

	got := BuildAdjustmentPlan(plan, 100000, []LiveRow{
		{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", WeightPct: 22.1},
		{AssetClass: "PHARMA", DisplayName: "Pharma", WeightPct: 13.5},
	}, testKey)
	if got == nil {
		t.Fatalf("BuildAdjustmentPlan returned nil")
	}
	if got.RequiredDecreaseValue != 0 || got.RequiredIncreaseValue != 0 {
		t.Fatalf("required decrease/increase = %v/%v, want 0/0", got.RequiredDecreaseValue, got.RequiredIncreaseValue)
	}
	for _, row := range got.Rows {
		if row.Direction != "hold" || row.Status != "HOLD" {
			t.Fatalf("row %s direction/status = %s/%s, want hold/HOLD", row.Key, row.Direction, row.Status)
		}
	}
}

func TestBuildAdjustmentPlanDecreaseAndIncreaseRows(t *testing.T) {
	plan := &Plan{
		ID:     8,
		Status: "OPEN",
		Rows: []PlanRow{
			{AssetClass: "GOLD", DisplayName: "Gold Miners", TargetWeightPct: 20, RecordedMoveValue: 1000},
			{AssetClass: "PHARMA", DisplayName: "Pharma", TargetWeightPct: 15},
		},
	}

	got := BuildAdjustmentPlan(plan, 100000, []LiveRow{
		{AssetClass: "GOLD_MINERS", WeightPct: 25},
		{AssetClass: "PHARMA", WeightPct: 10},
	}, testKey)
	if math.Abs(got.RequiredDecreaseValue-5000) > 1e-6 {
		t.Fatalf("required decrease = %v, want 5000", got.RequiredDecreaseValue)
	}
	if math.Abs(got.RequiredIncreaseValue-5000) > 1e-6 {
		t.Fatalf("required increase = %v, want 5000", got.RequiredIncreaseValue)
	}
	if got.ReadyToConfirm {
		t.Fatalf("ready to confirm = true, want false")
	}
	if got.Rows[0].Direction != "decrease" || got.Rows[0].Status != "ACTION_REQUIRED" {
		t.Fatalf("decrease row direction/status = %s/%s", got.Rows[0].Direction, got.Rows[0].Status)
	}
	if got.Rows[1].Direction != "increase" || got.Rows[1].Status != "PENDING_ADD" {
		t.Fatalf("increase row direction/status = %s/%s", got.Rows[1].Direction, got.Rows[1].Status)
	}
}

func TestCompletedPlanBuildsImportValidation(t *testing.T) {
	plan := &Plan{
		ID:     9,
		Status: "COMPLETED",
		Rows: []PlanRow{
			{AssetClass: "GOLD", DisplayName: "Gold Miners", TargetWeightPct: 20},
		},
	}

	got := BuildAdjustmentPlan(plan, 100000, []LiveRow{
		{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", WeightPct: 18},
	}, testKey)
	if got.Stage != "confirm_statement" || got.Status != "VARIANCE" {
		t.Fatalf("stage/status = %s/%s, want confirm_statement/VARIANCE", got.Stage, got.Status)
	}
	if got.ImportValidation == nil || got.ImportValidation.VarianceRows != 1 {
		t.Fatalf("validation = %#v, want one variance row", got.ImportValidation)
	}
}
