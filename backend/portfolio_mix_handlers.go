package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"trading-backend/internal/portfoliomix"
	"trading-backend/internal/portfoliorebalance"
)

func buildCurrentPortfolioMixRows(ctx *overlayPortfolioContext) []PortfolioMixRow {
	return fromPortfolioMixRows(portfoliomix.BuildRows(
		toPortfolioMixSummaries(ctx.ClassSummaries),
		ctx.StatementTotalValue,
		ctx.PortfolioCashBucketValue,
		func(assetClass string) (portfoliomix.Sleeve, bool) {
			assetClass = choosePrimaryAssetClass([]string{assetClass})
			sleeve, ok := resolveAssetClassForCode(assetClass, true)
			if !ok {
				return portfoliomix.Sleeve{}, false
			}
			return portfoliomix.Sleeve{
				Code:         normalizePrimaryAssetClass(sleeve.Code),
				DisplayName:  strings.TrimSpace(sleeve.DisplayName),
				DisplayOrder: sleeve.DisplayOrder,
			}, true
		},
	))
}

func toPortfolioMixSummaries(summaries map[string]*PortfolioOverlayAssetClassSummary) []portfoliomix.Summary {
	result := make([]portfoliomix.Summary, 0, len(summaries))
	for _, summary := range summaries {
		if summary == nil {
			continue
		}
		result = append(result, portfoliomix.Summary{
			AssetClass:             choosePrimaryAssetClass([]string{summary.AssetClass}),
			DisplayName:            summary.DisplayName,
			DisplayOrder:           summary.DisplayOrder,
			OverlayEligible:        summary.OverlayEligible,
			ActualInvestedPct:      summary.ActualInvestedPct,
			ActualInvestedValue:    summary.ActualInvestedValue,
			TacticalCashPct:        summary.TacticalCashPct,
			TacticalCashValue:      summary.TacticalCashValue,
			TotalClassCapitalValue: summary.TotalClassCapitalValue,
		})
	}
	return result
}

func fromPortfolioMixRows(rows []portfoliomix.Row) []PortfolioMixRow {
	result := make([]PortfolioMixRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, PortfolioMixRow{
			AssetClass:          row.AssetClass,
			DisplayName:         row.DisplayName,
			DisplayOrder:        row.DisplayOrder,
			GovernedByQ1:        row.GovernedByQ1,
			WeightPct:           row.WeightPct,
			InvestedWeightPct:   row.InvestedWeightPct,
			SleeveCashWeightPct: row.SleeveCashWeightPct,
			Value:               row.Value,
			InvestedValue:       row.InvestedValue,
			SleeveCashValue:     row.SleeveCashValue,
		})
	}
	return result
}

func toPortfolioMixCashComponents(components []PortfolioCashComponent) []portfoliomix.CashComponent {
	result := make([]portfoliomix.CashComponent, 0, len(components))
	for _, component := range components {
		result = append(result, portfoliomix.CashComponent{
			Key:          component.Key,
			DisplayName:  component.DisplayName,
			Ticker:       component.Ticker,
			Value:        component.Value,
			WeightPct:    component.WeightPct,
			DisplayOrder: component.DisplayOrder,
		})
	}
	return result
}

func fromPortfolioMixCashComponents(components []portfoliomix.CashComponent) []PortfolioCashComponent {
	result := make([]PortfolioCashComponent, 0, len(components))
	for _, component := range components {
		result = append(result, PortfolioCashComponent{
			Key:          component.Key,
			DisplayName:  component.DisplayName,
			Ticker:       component.Ticker,
			Value:        component.Value,
			WeightPct:    component.WeightPct,
			DisplayOrder: component.DisplayOrder,
		})
	}
	return result
}

func toPortfolioMixRows(rows []PortfolioMixRow) []portfoliomix.Row {
	result := make([]portfoliomix.Row, 0, len(rows))
	for _, row := range rows {
		result = append(result, portfoliomix.Row{
			AssetClass:          row.AssetClass,
			DisplayName:         row.DisplayName,
			DisplayOrder:        row.DisplayOrder,
			GovernedByQ1:        row.GovernedByQ1,
			WeightPct:           row.WeightPct,
			InvestedWeightPct:   row.InvestedWeightPct,
			SleeveCashWeightPct: row.SleeveCashWeightPct,
			Value:               row.Value,
			InvestedValue:       row.InvestedValue,
			SleeveCashValue:     row.SleeveCashValue,
		})
	}
	return result
}

func fromPortfolioMixSnapshotMeta(snapshot *portfoliomix.SnapshotMeta) *PortfolioMixSnapshotMeta {
	if snapshot == nil {
		return nil
	}
	return &PortfolioMixSnapshotMeta{
		ID:                    snapshot.ID,
		Status:                snapshot.Status,
		Reason:                snapshot.Reason,
		SourceRebalancePlanID: snapshot.SourceRebalancePlanID,
		Notes:                 snapshot.Notes,
		ApprovedAt:            snapshot.ApprovedAt,
		CreatedAt:             snapshot.CreatedAt,
	}
}

func portfolioMixStore() portfoliomix.Store {
	return portfoliomix.Store{DB: db}
}

func portfolioRebalanceStore() portfoliorebalance.Store {
	return portfoliorebalance.Store{DB: db}
}

func newPortfolioRebalanceHandler() portfoliorebalance.Handler {
	return portfoliorebalance.Handler{
		Store: portfolioRebalanceStore(),
		CreatePlan: func(ctx context.Context, payload portfoliorebalance.CreateRequest) (*portfoliorebalance.Plan, error) {
			plan, err := createPortfolioRebalancePlanInternal(ctx, struct {
				Driver    string                      `json:"driver"`
				Title     string                      `json:"title"`
				Notes     string                      `json:"notes"`
				MemoJobID string                      `json:"memo_job_id"`
				Rows      []PortfolioRebalancePlanRow `json:"rows"`
			}{
				Driver:    payload.Driver,
				Title:     payload.Title,
				Notes:     payload.Notes,
				MemoJobID: payload.MemoJobID,
				Rows:      fromPortfolioRebalancePlanRows(payload.Rows),
			})
			if err != nil {
				return nil, err
			}
			return toPortfolioRebalancePlan(plan), nil
		},
		CanonicalAssetClass: func(value string) string {
			assetClass := strings.ToUpper(strings.TrimSpace(value))
			if sleeve, ok := resolveAssetClassForCode(assetClass, true); ok {
				assetClass = normalizePrimaryAssetClass(sleeve.Code)
			}
			return assetClass
		},
	}
}

func fromPortfolioRebalancePlan(plan *portfoliorebalance.Plan) *PortfolioRebalancePlan {
	if plan == nil {
		return nil
	}
	return &PortfolioRebalancePlan{
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
		Rows:             fromPortfolioRebalancePlanRows(plan.Rows),
	}
}

func toPortfolioRebalancePlan(plan *PortfolioRebalancePlan) *portfoliorebalance.Plan {
	if plan == nil {
		return nil
	}
	return &portfoliorebalance.Plan{
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
		Rows:             toPortfolioRebalancePlanRows(plan.Rows),
	}
}

func fromPortfolioRebalancePlanRows(rows []portfoliorebalance.PlanRow) []PortfolioRebalancePlanRow {
	result := make([]PortfolioRebalancePlanRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, PortfolioRebalancePlanRow{
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

func toPortfolioRebalancePlanRows(rows []PortfolioRebalancePlanRow) []portfoliorebalance.PlanRow {
	result := make([]portfoliorebalance.PlanRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, portfoliorebalance.PlanRow{
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

func getCurrentPortfolioMix(w http.ResponseWriter, r *http.Request) {
	ctx, err := buildOverlayPortfolioContext(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cashComponents := fromPortfolioMixCashComponents(portfoliomix.BuildCashComponents(
		toPortfolioMixCashComponents(ctx.CashComponents),
		ctx.StatementTotalValue,
		ctx.PortfolioCashBucketValue,
	))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PortfolioMixCurrentResponse{
		AsOf:           time.Now().UTC(),
		TotalValue:     ctx.StatementTotalValue,
		Rows:           buildCurrentPortfolioMixRows(ctx),
		CashComponents: cashComponents,
	})
}

func loadLatestApprovedPortfolioMix() (*PortfolioMixSnapshotMeta, []PortfolioMixRow, error) {
	snapshot, rows, err := portfolioMixStore().LoadLatestApproved(context.Background())
	if err != nil {
		return nil, nil, err
	}
	return fromPortfolioMixSnapshotMeta(snapshot), fromPortfolioMixRows(rows), nil
}

func getApprovedPortfolioMix(w http.ResponseWriter, r *http.Request) {
	snapshot, rows, err := loadLatestApprovedPortfolioMix()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PortfolioMixSnapshotResponse{
		Snapshot:       snapshot,
		Rows:           rows,
		ApprovalPolicy: portfolioApprovalPolicy(snapshot),
	})
}

func portfolioApprovalPolicy(snapshot *PortfolioMixSnapshotMeta) *portfoliomix.ApprovalPolicy {
	var approvedAt *time.Time
	if snapshot != nil {
		approvedAt = snapshot.ApprovedAt
		if approvedAt == nil {
			approvedAt = snapshot.CreatedAt
		}
	}
	policy := portfoliomix.Policy(approvedAt, time.Now().UTC())
	if snapshot != nil && approvedAt == nil {
		policy.CanApprove = false
	}
	return &policy
}

func writePortfolioApprovalError(w http.ResponseWriter, err error) {
	var locked *portfoliomix.ApprovalLockedError
	if errors.As(err, &locked) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]any{"error": locked.Error(), "code": "PORTFOLIO_CYCLE_LOCKED", "next_allowed_at": locked.NextAllowedAt})
		return
	}
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

func approveCurrentPortfolioMix(w http.ResponseWriter, r *http.Request) {
	ctx, err := buildOverlayPortfolioContext(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var payload struct {
		Reason string `json:"reason"`
		Notes  string `json:"notes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)

	rows := buildCurrentPortfolioMixRows(ctx)
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if err := portfolioRebalanceStore().SupersedeActiveTx(r.Context(), tx); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	snapshot, _, err := portfolioMixStore().CreateApprovedTx(r.Context(), tx, portfoliomix.CreateSnapshotInput{
		Reason: payload.Reason,
		Notes:  payload.Notes,
		Rows:   toPortfolioMixRows(rows),
	})
	if err != nil {
		writePortfolioApprovalError(w, err)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PortfolioMixSnapshotResponse{
		Snapshot:       fromPortfolioMixSnapshotMeta(snapshot),
		Rows:           rows,
		ApprovalPolicy: portfolioApprovalPolicy(fromPortfolioMixSnapshotMeta(snapshot)),
	})
}
