package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	"trading-backend/internal/assetclass"
	"trading-backend/internal/portfoliomix"
	"trading-backend/internal/portfoliorebalance"
	"trading-backend/internal/portfoliotarget"
)

func loadCurrentPortfolioRebalance() (*PortfolioRebalancePlan, error) {
	plan, err := portfolioRebalanceStore().LoadCurrent(context.Background())
	if err != nil {
		return nil, err
	}
	return fromPortfolioRebalancePlan(plan), nil
}

func loadPortfolioRebalanceByID(planID int64) (*PortfolioRebalancePlan, error) {
	plan, err := portfolioRebalanceStore().LoadByID(context.Background(), planID)
	if err != nil {
		return nil, err
	}
	return fromPortfolioRebalancePlan(plan), nil
}

func buildPortfolioAdjustmentImportValidation(planRows []PortfolioRebalancePlanRow, liveRows []PortfolioMixRow, totalValue float64) AdjustmentImportValidation {
	return fromPortfolioTargetImportValidation(portfoliotarget.BuildImportValidation(
		toPortfolioTargetPlanRows(planRows),
		toPortfolioTargetLiveRows(liveRows),
		totalValue,
		compactPortfolioAdjustmentAssetClassKey,
	))
}

func compactPortfolioAdjustmentAssetClassKey(value string) string {
	normalized := canonicalPortfolioAdjustmentAssetClass(value)
	if normalized == "" || normalized == "UNASSIGNED" {
		normalized = strings.ToUpper(strings.TrimSpace(value))
	}
	return assetclass.CompactKey(normalized)
}

func canonicalPortfolioAdjustmentAssetClass(value string) string {
	normalized := normalizePrimaryAssetClass(value)
	if db == nil {
		return normalized
	}
	if sleeve, ok := resolveAssetClassForCode(value, true); ok {
		code := normalizePrimaryAssetClass(sleeve.Code)
		if code != "" {
			return code
		}
	}
	return normalized
}

func buildPortfolioTargetAdjustmentPlan(plan *PortfolioRebalancePlan, totalValue float64, liveRows []PortfolioMixRow) *AdjustmentPlan {
	if plan == nil {
		return nil
	}
	return fromPortfolioTargetAdjustmentPlan(portfoliotarget.BuildAdjustmentPlan(
		toPortfolioTargetPlan(plan),
		totalValue,
		toPortfolioTargetLiveRows(liveRows),
		compactPortfolioAdjustmentAssetClassKey,
	))
}

func toPortfolioTargetPlan(plan *PortfolioRebalancePlan) *portfoliotarget.Plan {
	if plan == nil {
		return nil
	}
	return &portfoliotarget.Plan{
		ID:               plan.ID,
		Status:           plan.Status,
		Driver:           plan.Driver,
		Title:            plan.Title,
		Notes:            plan.Notes,
		MemoJobID:        plan.MemoJobID,
		SourceSnapshotID: plan.SourceSnapshotID,
		CreatedAt:        plan.CreatedAt,
		UpdatedAt:        plan.UpdatedAt,
		CompletedAt:      plan.CompletedAt,
		ApprovedAt:       plan.ApprovedAt,
		Rows:             toPortfolioTargetPlanRows(plan.Rows),
	}
}

func toPortfolioTargetPlanRows(rows []PortfolioRebalancePlanRow) []portfoliotarget.PlanRow {
	result := make([]portfoliotarget.PlanRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, portfoliotarget.PlanRow{
			AssetClass:        row.AssetClass,
			DisplayName:       row.DisplayName,
			DisplayOrder:      row.DisplayOrder,
			GovernedByQ1:      row.GovernedByQ1,
			CurrentWeightPct:  row.CurrentWeightPct,
			TargetWeightPct:   row.TargetWeightPct,
			DeltaWeightPct:    row.DeltaWeightPct,
			RecordedMoveValue: row.RecordedMoveValue,
			Note:              row.Note,
		})
	}
	return result
}

func toPortfolioTargetLiveRows(rows []PortfolioMixRow) []portfoliotarget.LiveRow {
	result := make([]portfoliotarget.LiveRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, portfoliotarget.LiveRow{
			AssetClass:  row.AssetClass,
			DisplayName: row.DisplayName,
			WeightPct:   row.WeightPct,
			Value:       row.Value,
		})
	}
	return result
}

func fromPortfolioTargetAdjustmentPlan(plan *portfoliotarget.AdjustmentPlan) *AdjustmentPlan {
	if plan == nil {
		return nil
	}
	return &AdjustmentPlan{
		ID:                     plan.ID,
		SourceType:             plan.SourceType,
		SourceID:               plan.SourceID,
		SourceStatus:           plan.SourceStatus,
		Title:                  plan.Title,
		Stage:                  plan.Stage,
		Status:                 plan.Status,
		TotalValue:             plan.TotalValue,
		RequiredDecreaseValue:  plan.RequiredDecreaseValue,
		RecordedDecreaseValue:  plan.RecordedDecreaseValue,
		RemainingDecreaseValue: plan.RemainingDecreaseValue,
		RequiredIncreaseValue:  plan.RequiredIncreaseValue,
		RecordedIncreaseValue:  plan.RecordedIncreaseValue,
		RemainingIncreaseValue: plan.RemainingIncreaseValue,
		ToleranceValue:         plan.ToleranceValue,
		ReadyToConfirm:         plan.ReadyToConfirm,
		Rows:                   fromPortfolioTargetAdjustmentRows(plan.Rows),
		ImportValidation:       fromPortfolioTargetImportValidationPtr(plan.ImportValidation),
		CreatedAt:              plan.CreatedAt,
		UpdatedAt:              plan.UpdatedAt,
		CompletedAt:            plan.CompletedAt,
		ApprovedAt:             plan.ApprovedAt,
	}
}

func fromPortfolioTargetAdjustmentRows(rows []portfoliotarget.AdjustmentRow) []AdjustmentPlanRow {
	result := make([]AdjustmentPlanRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, AdjustmentPlanRow{
			Key:              row.Key,
			Label:            row.Label,
			CurrentWeightPct: row.CurrentWeightPct,
			TargetWeightPct:  row.TargetWeightPct,
			DeltaWeightPct:   row.DeltaWeightPct,
			CurrentValue:     row.CurrentValue,
			TargetValue:      row.TargetValue,
			DeltaValue:       row.DeltaValue,
			Direction:        row.Direction,
			RequiredValue:    row.RequiredValue,
			RecordedValue:    row.RecordedValue,
			RemainingValue:   row.RemainingValue,
			Status:           row.Status,
		})
	}
	return result
}

func fromPortfolioTargetImportValidationPtr(validation *portfoliotarget.ImportValidation) *AdjustmentImportValidation {
	if validation == nil {
		return nil
	}
	result := fromPortfolioTargetImportValidation(*validation)
	return &result
}

func fromPortfolioTargetImportValidation(validation portfoliotarget.ImportValidation) AdjustmentImportValidation {
	return AdjustmentImportValidation{
		Passed:                validation.Passed,
		CheckedRows:           validation.CheckedRows,
		VarianceRows:          validation.VarianceRows,
		TotalAbsVariancePct:   validation.TotalAbsVariancePct,
		TotalAbsVarianceValue: validation.TotalAbsVarianceValue,
		TolerancePct:          validation.TolerancePct,
		ToleranceValue:        validation.ToleranceValue,
		Checks:                fromPortfolioTargetImportChecks(validation.Checks),
	}
}

func fromPortfolioTargetImportChecks(checks []portfoliotarget.ImportCheck) []AdjustmentImportCheck {
	result := make([]AdjustmentImportCheck, 0, len(checks))
	for _, check := range checks {
		result = append(result, AdjustmentImportCheck{
			Key:               check.Key,
			Label:             check.Label,
			ExpectedWeightPct: check.ExpectedWeightPct,
			ImportedWeightPct: check.ImportedWeightPct,
			VarianceWeightPct: check.VarianceWeightPct,
			ExpectedValue:     check.ExpectedValue,
			ImportedValue:     check.ImportedValue,
			VarianceValue:     check.VarianceValue,
			Status:            check.Status,
		})
	}
	return result
}

func getCurrentPortfolioAdjustmentPlan(w http.ResponseWriter, r *http.Request) {
	plan, err := loadCurrentPortfolioRebalance()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if plan == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AdjustmentPlanResponse{Plan: nil})
		return
	}

	ctx, err := buildOverlayPortfolioContext(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	adjustmentPlan := buildPortfolioTargetAdjustmentPlan(
		plan,
		ctx.StatementTotalValue,
		buildCurrentPortfolioMixRows(ctx),
	)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AdjustmentPlanResponse{Plan: adjustmentPlan})
}

func getPortfolioAdjustmentPlan(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(mux.Vars(r)["id"])
	if id == "" {
		http.Error(w, "missing plan id", http.StatusBadRequest)
		return
	}
	planID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		http.Error(w, "invalid plan id", http.StatusBadRequest)
		return
	}

	plan, err := loadPortfolioRebalanceByID(planID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if plan == nil {
		http.Error(w, "plan not found", http.StatusNotFound)
		return
	}

	ctx, err := buildOverlayPortfolioContext(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	adjustmentPlan := buildPortfolioTargetAdjustmentPlan(
		plan,
		ctx.StatementTotalValue,
		buildCurrentPortfolioMixRows(ctx),
	)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AdjustmentPlanResponse{Plan: adjustmentPlan})
}

func normalisePortfolioRebalanceRows(rows []PortfolioRebalancePlanRow) ([]PortfolioRebalancePlanRow, error) {
	rowBySleeve := make(map[string]PortfolioRebalancePlanRow)
	order := make([]string, 0, len(rows))

	for _, row := range rows {
		rawAssetClass := strings.TrimSpace(row.AssetClass)
		if rawAssetClass == "" {
			continue
		}
		normalizedInput := normalizePrimaryAssetClass(rawAssetClass)
		sleeve, ok := resolveAssetClassForCode(rawAssetClass, true)
		if !ok {
			return nil, fmt.Errorf("invalid asset class %s", rawAssetClass)
		}
		if normalizePrimaryAssetClass(sleeve.Code) == "UNASSIGNED" &&
			normalizedInput != "UNASSIGNED" &&
			normalizedInput != "MISC" {
			return nil, fmt.Errorf("invalid asset class %s", rawAssetClass)
		}

		assetClass := normalizePrimaryAssetClass(sleeve.Code)
		if assetClass == "" {
			return nil, fmt.Errorf("invalid asset class %s", rawAssetClass)
		}

		normalised := row
		normalised.AssetClass = assetClass
		if strings.TrimSpace(sleeve.DisplayName) != "" {
			normalised.DisplayName = strings.TrimSpace(sleeve.DisplayName)
		} else if strings.TrimSpace(normalised.DisplayName) == "" {
			normalised.DisplayName = assetClass
		}
		if sleeve.DisplayOrder > 0 {
			normalised.DisplayOrder = sleeve.DisplayOrder
		}
		normalised.DeltaWeightPct = normalised.TargetWeightPct - normalised.CurrentWeightPct

		existing, exists := rowBySleeve[assetClass]
		if !exists {
			rowBySleeve[assetClass] = normalised
			order = append(order, assetClass)
			continue
		}

		existing.CurrentWeightPct += normalised.CurrentWeightPct
		existing.TargetWeightPct += normalised.TargetWeightPct
		existing.RecordedMoveValue += math.Max(0, normalised.RecordedMoveValue)
		existing.GovernedByQ1 = existing.GovernedByQ1 || normalised.GovernedByQ1
		existing.DeltaWeightPct = existing.TargetWeightPct - existing.CurrentWeightPct
		if strings.TrimSpace(existing.Note) == "" {
			existing.Note = strings.TrimSpace(normalised.Note)
		}
		rowBySleeve[assetClass] = existing
	}

	normalisedRows := make([]PortfolioRebalancePlanRow, 0, len(rowBySleeve))
	for _, key := range order {
		normalisedRows = append(normalisedRows, rowBySleeve[key])
	}
	sort.SliceStable(normalisedRows, func(i, j int) bool {
		if normalisedRows[i].DisplayOrder != normalisedRows[j].DisplayOrder {
			return normalisedRows[i].DisplayOrder < normalisedRows[j].DisplayOrder
		}
		return normalisedRows[i].AssetClass < normalisedRows[j].AssetClass
	})
	return normalisedRows, nil
}

func portfolioRebalanceHasMaterialMove(rows []PortfolioRebalancePlanRow) bool {
	for _, row := range rows {
		if math.Abs(row.TargetWeightPct-row.CurrentWeightPct) > 0.05 {
			return true
		}
	}
	return false
}

func createPortfolioRebalancePlanInternal(ctx context.Context, payload struct {
	Driver    string                      `json:"driver"`
	Title     string                      `json:"title"`
	Notes     string                      `json:"notes"`
	MemoJobID string                      `json:"memo_job_id"`
	Rows      []PortfolioRebalancePlanRow `json:"rows"`
}) (*PortfolioRebalancePlan, error) {
	rows, err := normalisePortfolioRebalanceRows(payload.Rows)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("missing rebalance rows")
	}
	if !portfolioRebalanceHasMaterialMove(rows) {
		return nil, fmt.Errorf("no portfolio target changes to action")
	}
	if strings.TrimSpace(payload.Driver) == "" {
		payload.Driver = "DISCRETIONARY"
	}

	snapshot, _, err := loadLatestApprovedPortfolioMix()
	if err != nil {
		return nil, err
	}

	var snapshotID *int64
	if snapshot != nil {
		snapshotID = &snapshot.ID
	}

	storeRows := make([]PortfolioRebalancePlanRow, 0, len(rows))
	for _, row := range rows {
		assetClass := normalizePrimaryAssetClass(row.AssetClass)
		if assetClass == "" {
			continue
		}
		displayName := strings.TrimSpace(row.DisplayName)
		if displayName == "" {
			if assetClass == "CASH" {
				displayName = "CASH"
			} else {
				displayName = getOverlayAssetClassSetting(assetClass).DisplayName
				if strings.TrimSpace(displayName) == "" {
					displayName = assetClass
				}
			}
		}
		displayOrder := row.DisplayOrder
		if displayOrder == 0 {
			if assetClass == "CASH" {
				displayOrder = 10000
			} else {
				displayOrder = getOverlayAssetClassSetting(assetClass).DisplayOrder
			}
		}
		row.AssetClass = assetClass
		row.DisplayName = displayName
		row.DisplayOrder = displayOrder
		storeRows = append(storeRows, row)
	}

	plan, err := portfolioRebalanceStore().CreateOpen(ctx, portfoliorebalance.CreateInput{
		Driver:           payload.Driver,
		Title:            payload.Title,
		Notes:            payload.Notes,
		MemoJobID:        payload.MemoJobID,
		SourceSnapshotID: snapshotID,
		Rows:             toPortfolioRebalancePlanRows(storeRows),
	})
	if err != nil {
		return nil, err
	}
	return fromPortfolioRebalancePlan(plan), nil
}

func approvePortfolioRebalance(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(mux.Vars(r)["id"])
	if id == "" {
		http.Error(w, "missing plan id", http.StatusBadRequest)
		return
	}
	planID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		http.Error(w, "invalid plan id", http.StatusBadRequest)
		return
	}

	plan, err := loadCurrentPortfolioRebalance()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if plan == nil || plan.ID != planID {
		http.Error(w, "plan not found", http.StatusNotFound)
		return
	}
	if strings.ToUpper(strings.TrimSpace(plan.Status)) != "COMPLETED" {
		http.Error(w, "position actions must be completed before approving baseline", http.StatusBadRequest)
		return
	}

	ctx, err := buildOverlayPortfolioContext(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	validation := buildPortfolioAdjustmentImportValidation(
		plan.Rows,
		buildCurrentPortfolioMixRows(ctx),
		ctx.StatementTotalValue,
	)
	if !validation.Passed {
		http.Error(w, "latest statement does not match target portfolio", http.StatusBadRequest)
		return
	}

	rows := make([]PortfolioMixRow, 0, len(plan.Rows))
	for _, item := range plan.Rows {
		rows = append(rows, PortfolioMixRow{
			AssetClass:   item.AssetClass,
			DisplayName:  item.DisplayName,
			DisplayOrder: item.DisplayOrder,
			GovernedByQ1: item.GovernedByQ1,
			WeightPct:    item.TargetWeightPct,
		})
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if _, _, err := portfolioMixStore().CreateApprovedTx(r.Context(), tx, portfoliomix.CreateSnapshotInput{
		Reason:       plan.Driver,
		SourcePlanID: &plan.ID,
		Notes:        plan.Notes,
		Rows:         toPortfolioMixRows(rows),
	}); err != nil {
		writePortfolioApprovalError(w, err)
		return
	}
	if err := portfolioRebalanceStore().ApproveTx(r.Context(), tx, plan.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	snapshot, snapshotRows, err := loadLatestApprovedPortfolioMix()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PortfolioMixSnapshotResponse{Snapshot: snapshot, Rows: snapshotRows, ApprovalPolicy: portfolioApprovalPolicy(snapshot)})
}
