package portfoliotarget

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

type KeyFunc func(string) string

type PlanRow struct {
	AssetClass        string
	DisplayName       string
	DisplayOrder      int
	GovernedByQ1      bool
	CurrentWeightPct  float64
	TargetWeightPct   float64
	DeltaWeightPct    float64
	RecordedMoveValue float64
	Note              string
}

type Plan struct {
	ID               int64
	Status           string
	Driver           string
	Title            string
	Notes            string
	MemoJobID        string
	SourceSnapshotID *int64
	CreatedAt        *time.Time
	UpdatedAt        *time.Time
	CompletedAt      *time.Time
	ApprovedAt       *time.Time
	Rows             []PlanRow
}

type LiveRow struct {
	AssetClass  string
	DisplayName string
	WeightPct   float64
	Value       float64
}

type AdjustmentRow struct {
	Key              string
	Label            string
	CurrentWeightPct float64
	TargetWeightPct  float64
	DeltaWeightPct   float64
	CurrentValue     float64
	TargetValue      float64
	DeltaValue       float64
	Direction        string
	RequiredValue    float64
	RecordedValue    float64
	RemainingValue   float64
	Status           string
}

type ImportCheck struct {
	Key               string
	Label             string
	ExpectedWeightPct float64
	ImportedWeightPct float64
	VarianceWeightPct float64
	ExpectedValue     float64
	ImportedValue     float64
	VarianceValue     float64
	Status            string
}

type ImportValidation struct {
	Passed                bool
	CheckedRows           int
	VarianceRows          int
	TotalAbsVariancePct   float64
	TotalAbsVarianceValue float64
	TolerancePct          float64
	ToleranceValue        float64
	Checks                []ImportCheck
}

type AdjustmentPlan struct {
	ID                     string
	SourceType             string
	SourceID               int64
	SourceStatus           string
	Title                  string
	Stage                  string
	Status                 string
	TotalValue             float64
	RequiredDecreaseValue  float64
	RecordedDecreaseValue  float64
	RemainingDecreaseValue float64
	RequiredIncreaseValue  float64
	RecordedIncreaseValue  float64
	RemainingIncreaseValue float64
	ToleranceValue         float64
	ReadyToConfirm         bool
	Rows                   []AdjustmentRow
	ImportValidation       *ImportValidation
	CreatedAt              *time.Time
	UpdatedAt              *time.Time
	CompletedAt            *time.Time
	ApprovedAt             *time.Time
}

func BuildAdjustmentPlan(plan *Plan, totalValue float64, liveRows []LiveRow, keyFunc KeyFunc) *AdjustmentPlan {
	if plan == nil {
		return nil
	}

	threshold := math.Max(50, totalValue*0.0005)
	liveWeightByClass := make(map[string]float64)
	for _, live := range liveRows {
		key := canonicalKey(live.AssetClass, keyFunc)
		if key == "" || key == "UNASSIGNED" {
			continue
		}
		liveWeightByClass[key] += live.WeightPct
	}

	rows := make([]AdjustmentRow, 0, len(plan.Rows))
	requiredDecrease := 0.0
	recordedDecrease := 0.0
	requiredIncrease := 0.0
	recordedIncrease := 0.0

	for _, row := range plan.Rows {
		key := strings.ToUpper(strings.TrimSpace(row.AssetClass))
		if key == "" {
			continue
		}
		currentWeightPct := row.CurrentWeightPct
		if len(liveRows) > 0 {
			if liveWeight, ok := liveWeightByClass[canonicalKey(row.AssetClass, keyFunc)]; ok {
				currentWeightPct = liveWeight
			} else {
				currentWeightPct = 0
			}
		}
		currentValue := (currentWeightPct / 100) * totalValue
		targetValue := (row.TargetWeightPct / 100) * totalValue
		deltaValue := targetValue - currentValue
		direction := "hold"
		if deltaValue < -threshold {
			direction = "decrease"
		} else if deltaValue > threshold {
			direction = "increase"
		}
		requiredValue := 0.0
		if direction != "hold" {
			requiredValue = math.Abs(deltaValue)
		}
		recordedValue := math.Max(0, row.RecordedMoveValue)
		if direction == "decrease" {
			requiredDecrease += requiredValue
			recordedDecrease += recordedValue
		} else if direction == "increase" {
			requiredIncrease += requiredValue
			recordedIncrease += recordedValue
		}
		rows = append(rows, AdjustmentRow{
			Key:              key,
			Label:            strings.TrimSpace(row.DisplayName),
			CurrentWeightPct: currentWeightPct,
			TargetWeightPct:  row.TargetWeightPct,
			DeltaWeightPct:   row.TargetWeightPct - currentWeightPct,
			CurrentValue:     currentValue,
			TargetValue:      targetValue,
			DeltaValue:       deltaValue,
			Direction:        direction,
			RequiredValue:    requiredValue,
			RecordedValue:    recordedValue,
			RemainingValue:   math.Max(0, requiredValue-recordedValue),
			Status:           "HOLD",
		})
	}

	tolerance := 0.0
	if requiredDecrease > 0 {
		tolerance = math.Max(250, requiredDecrease*0.05)
	}
	remainingDecrease := math.Max(0, requiredDecrease-recordedDecrease)
	remainingIncrease := math.Max(0, requiredIncrease-recordedIncrease)
	readyToConfirm := requiredDecrease <= 0 || (remainingDecrease <= tolerance && recordedDecrease <= requiredDecrease+tolerance)

	for i := range rows {
		switch rows[i].Direction {
		case "decrease":
			rowTolerance := math.Max(250, rows[i].RequiredValue*0.05)
			if rows[i].RecordedValue <= 0 && rows[i].RequiredValue > rowTolerance {
				rows[i].Status = "ACTION_REQUIRED"
			} else if rows[i].RemainingValue <= rowTolerance {
				rows[i].Status = "RECORDED"
			} else {
				rows[i].Status = "ACTION_REQUIRED"
			}
		case "increase":
			rows[i].Status = "PENDING_ADD"
		default:
			rows[i].Status = "HOLD"
		}
	}

	stage := "action_positions"
	status := "ACTIONING"
	var importValidation *ImportValidation
	switch strings.ToUpper(plan.Status) {
	case "COMPLETED":
		stage = "confirm_statement"
		status = "AWAITING_STATEMENT"
		validation := BuildImportValidation(plan.Rows, liveRows, totalValue, keyFunc)
		if validation.VarianceRows > 0 {
			status = "VARIANCE"
		}
		importValidation = &validation
	case "APPROVED":
		stage = "complete"
		status = "COMPLETE"
		validation := BuildImportValidation(plan.Rows, liveRows, totalValue, keyFunc)
		importValidation = &validation
	default:
		if !readyToConfirm {
			status = "ACTIONING"
		}
	}

	return &AdjustmentPlan{
		ID:                     fmt.Sprintf("portfolio_rebalance:%d", plan.ID),
		SourceType:             "PORTFOLIO_TARGET",
		SourceID:               plan.ID,
		SourceStatus:           plan.Status,
		Title:                  plan.Title,
		Stage:                  stage,
		Status:                 status,
		TotalValue:             totalValue,
		RequiredDecreaseValue:  requiredDecrease,
		RecordedDecreaseValue:  recordedDecrease,
		RemainingDecreaseValue: remainingDecrease,
		RequiredIncreaseValue:  requiredIncrease,
		RecordedIncreaseValue:  recordedIncrease,
		RemainingIncreaseValue: remainingIncrease,
		ToleranceValue:         tolerance,
		ReadyToConfirm:         readyToConfirm,
		Rows:                   rows,
		ImportValidation:       importValidation,
		CreatedAt:              plan.CreatedAt,
		UpdatedAt:              plan.UpdatedAt,
		CompletedAt:            plan.CompletedAt,
		ApprovedAt:             plan.ApprovedAt,
	}
}

func BuildImportValidation(planRows []PlanRow, liveRows []LiveRow, totalValue float64, keyFunc KeyFunc) ImportValidation {
	tolerancePct := 0.5
	toleranceValue := math.Max(250, totalValue*0.005)
	targetByClass := make(map[string]PlanRow)
	liveByClass := make(map[string]LiveRow)
	seen := make(map[string]bool)

	for _, row := range planRows {
		key := canonicalKey(row.AssetClass, keyFunc)
		if key == "" {
			continue
		}
		targetByClass[key] = row
		seen[key] = true
	}
	for _, row := range liveRows {
		key := canonicalKey(row.AssetClass, keyFunc)
		if key == "" {
			continue
		}
		existing := liveByClass[key]
		if existing.AssetClass == "" {
			existing = row
			existing.AssetClass = key
		} else {
			existing.WeightPct += row.WeightPct
			existing.Value += row.Value
			if existing.DisplayName == "" {
				existing.DisplayName = row.DisplayName
			}
		}
		liveByClass[key] = existing
		seen[key] = true
	}

	checks := make([]ImportCheck, 0, len(seen))
	totalAbsVariancePct := 0.0
	totalAbsVarianceValue := 0.0
	varianceRows := 0

	for key := range seen {
		target := targetByClass[key]
		live := liveByClass[key]
		label := strings.TrimSpace(target.DisplayName)
		if label == "" {
			label = strings.TrimSpace(live.DisplayName)
		}
		if label == "" {
			label = key
		}
		expectedWeightPct := target.TargetWeightPct
		importedWeightPct := live.WeightPct
		variancePct := importedWeightPct - expectedWeightPct
		expectedValue := (expectedWeightPct / 100) * totalValue
		importedValue := (importedWeightPct / 100) * totalValue
		varianceValue := importedValue - expectedValue
		status := "MATCHED"
		if math.Abs(variancePct) > tolerancePct && math.Abs(varianceValue) > toleranceValue {
			status = "VARIANCE"
			varianceRows++
		}
		totalAbsVariancePct += math.Abs(variancePct)
		totalAbsVarianceValue += math.Abs(varianceValue)
		checks = append(checks, ImportCheck{
			Key:               key,
			Label:             label,
			ExpectedWeightPct: expectedWeightPct,
			ImportedWeightPct: importedWeightPct,
			VarianceWeightPct: variancePct,
			ExpectedValue:     expectedValue,
			ImportedValue:     importedValue,
			VarianceValue:     varianceValue,
			Status:            status,
		})
	}

	sort.Slice(checks, func(i, j int) bool {
		if checks[i].Status != checks[j].Status {
			return checks[i].Status == "VARIANCE"
		}
		if math.Abs(checks[i].VarianceValue) != math.Abs(checks[j].VarianceValue) {
			return math.Abs(checks[i].VarianceValue) > math.Abs(checks[j].VarianceValue)
		}
		return checks[i].Key < checks[j].Key
	})

	return ImportValidation{
		Passed:                len(checks) > 0 && varianceRows == 0,
		CheckedRows:           len(checks),
		VarianceRows:          varianceRows,
		TotalAbsVariancePct:   totalAbsVariancePct,
		TotalAbsVarianceValue: totalAbsVarianceValue,
		TolerancePct:          tolerancePct,
		ToleranceValue:        toleranceValue,
		Checks:                checks,
	}
}

func canonicalKey(value string, keyFunc KeyFunc) string {
	if keyFunc == nil {
		return strings.ToUpper(strings.TrimSpace(value))
	}
	return keyFunc(value)
}
