package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"trading-backend/internal/portfoliomix"
	"trading-backend/internal/portfoliorebalance"
)

type portfolioHistoryAllocationRow struct {
	AssetClass   string  `json:"asset_class"`
	DisplayName  string  `json:"display_name"`
	DisplayOrder int     `json:"display_order"`
	WeightPct    float64 `json:"weight_pct"`
}

type portfolioHistoryMemoSummary struct {
	ID                int64  `json:"id"`
	MemoJobID         string `json:"memo_job_id"`
	RunID             string `json:"run_id"`
	Status            string `json:"status"`
	AnalysisDate      string `json:"analysis_date"`
	PrimaryTheme      string `json:"primary_theme"`
	SecondaryTheme    string `json:"secondary_theme"`
	OverallConviction string `json:"overall_conviction"`
	ExecutiveSummary  string `json:"executive_summary"`
}

type portfolioHistoryEntry struct {
	ID               string                          `json:"id"`
	Kind             string                          `json:"kind"`
	OccurredAt       string                          `json:"occurred_at"`
	Status           string                          `json:"status"`
	Title            string                          `json:"title"`
	Subtitle         string                          `json:"subtitle,omitempty"`
	Source           string                          `json:"source"`
	MemoJobID        string                          `json:"memo_job_id,omitempty"`
	PlanID           *int64                          `json:"plan_id,omitempty"`
	SnapshotID       *int64                          `json:"snapshot_id,omitempty"`
	SourceSnapshotID *int64                          `json:"source_snapshot_id,omitempty"`
	StatementID      *int64                          `json:"statement_id,omitempty"`
	TotalValue       *float64                        `json:"total_value,omitempty"`
	ValueBasisAt     string                          `json:"value_basis_at,omitempty"`
	Rows             []portfolioHistoryAllocationRow `json:"rows"`
	Memo             *portfolioHistoryMemoSummary    `json:"memo,omitempty"`
	occurredTime     time.Time
}

type portfolioHistoryResponse struct {
	Entries      []portfolioHistoryEntry `json:"entries"`
	Kind         string                  `json:"kind,omitempty"`
	NextBeforeID *int64                  `json:"next_before_id,omitempty"`
}

func getPortfolioHistory(w http.ResponseWriter, r *http.Request) {
	limit := 120
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 250 {
		limit = 250
	}
	if kind := r.URL.Query().Get("kind"); kind != "" {
		beforeID := int64(0)
		if raw := r.URL.Query().Get("before_id"); raw != "" {
			parsed, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || parsed <= 0 {
				http.Error(w, "before_id must be a positive snapshot ID", http.StatusBadRequest)
				return
			}
			beforeID = parsed
		}
		if kind != "shape" {
			http.Error(w, "kind must be shape when filtering history", http.StatusBadRequest)
			return
		}
		response, err := loadPortfolioShapeHistory(r.Context(), limit, beforeID)
		if err != nil {
			http.Error(w, "failed to load approved shape history", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	entries, err := loadPortfolioHistory(r.Context(), limit)
	if err != nil {
		http.Error(w, "failed to load portfolio history: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(portfolioHistoryResponse{Entries: entries})
}

// Snapshot IDs give this read-only archive a stable cursor even as new approvals arrive.
func loadPortfolioShapeHistory(ctx context.Context, limit int, beforeID int64) (portfolioHistoryResponse, error) {
	response := portfolioHistoryResponse{Kind: "shape", Entries: make([]portfolioHistoryEntry, 0)}
	rows, err := db.QueryContext(ctx, `
		SELECT id FROM portfolio_mix_snapshots
		WHERE status IN ('APPROVED', 'SUPERSEDED') AND approved_at IS NOT NULL
		AND (? = 0 OR id < ?)
		ORDER BY id DESC LIMIT ?
	`, beforeID, beforeID, limit+1)
	if err != nil {
		return response, err
	}
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return response, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return response, err
	}
	if len(ids) > limit {
		ids = ids[:limit]
		cursor := ids[len(ids)-1]
		response.NextBeforeID = &cursor
	}
	for _, id := range ids {
		snapshot, allocations, err := portfolioMixStore().LoadByID(ctx, id)
		if err != nil {
			return response, err
		}
		if snapshot == nil {
			continue
		}
		occurred := portfolioHistoryFirstTime(snapshot.ApprovedAt, snapshot.CreatedAt)
		snapshotID := snapshot.ID
		memoJobID, err := portfolioHistoryMemoForPlan(ctx, snapshot.SourceRebalancePlanID)
		if err != nil {
			return response, err
		}
		response.Entries = append(response.Entries, portfolioHistoryEntry{
			ID: fmt.Sprintf("shape:%d", snapshotID), Kind: "shape", Status: snapshot.Status,
			OccurredAt: occurred.UTC().Format(time.RFC3339), Title: "Approved portfolio shape",
			Subtitle: snapshot.Notes, Source: portfolioHistorySnapshotSource(snapshot.Reason),
			SnapshotID: &snapshotID, PlanID: snapshot.SourceRebalancePlanID, MemoJobID: memoJobID,
			Rows: portfolioHistoryRowsFromMix(allocations), occurredTime: occurred,
		})
	}
	return response, nil
}

func loadPortfolioHistory(ctx context.Context, limit int) ([]portfolioHistoryEntry, error) {
	if err := ensurePortfolioMemoSchema(); err != nil {
		return nil, err
	}

	entries := make([]portfolioHistoryEntry, 0)
	memoEntryByJobID := make(map[string]int)

	memos, err := db.QueryContext(ctx, `
		SELECT id, memo_job_id, run_id, mode, status, model, analysis_date,
		       primary_theme, secondary_theme, overall_conviction, executive_summary,
		       analyst_memo_markdown, chairman_memo_markdown, asset_class_targets_json,
		       created_at, updated_at
		FROM portfolio_memo_runs
		ORDER BY updated_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	for memos.Next() {
		memo, scanErr := scanPortfolioMemoRun(memos)
		if scanErr != nil {
			memos.Close()
			return nil, scanErr
		}
		occurred := portfolioHistoryParseTime(memo.AnalysisDate, memo.CreatedAt, memo.UpdatedAt)
		title := strings.TrimSpace(memo.PrimaryTheme)
		if title == "" {
			title = "Portfolio Analysis"
		}
		entry := portfolioHistoryEntry{
			ID:         "memo:" + memo.MemoJobID,
			Kind:       "memo",
			OccurredAt: occurred.UTC().Format(time.RFC3339),
			Status:     strings.ToUpper(strings.TrimSpace(memo.Status)),
			Title:      title,
			Subtitle:   strings.TrimSpace(memo.ExecutiveSummary),
			Source:     "Portfolio Analysis",
			MemoJobID:  memo.MemoJobID,
			Rows:       portfolioHistoryRowsFromMemo(memo.AssetClassTargets),
			Memo: &portfolioHistoryMemoSummary{
				ID:                memo.ID,
				MemoJobID:         memo.MemoJobID,
				RunID:             memo.RunID,
				Status:            memo.Status,
				AnalysisDate:      memo.AnalysisDate,
				PrimaryTheme:      memo.PrimaryTheme,
				SecondaryTheme:    memo.SecondaryTheme,
				OverallConviction: memo.OverallConviction,
				ExecutiveSummary:  memo.ExecutiveSummary,
			},
			occurredTime: occurred,
		}
		memoEntryByJobID[memo.MemoJobID] = len(entries)
		entries = append(entries, entry)
	}
	if err := memos.Err(); err != nil {
		memos.Close()
		return nil, err
	}
	memos.Close()

	planIDs, err := portfolioHistoryIDs(ctx, `
		SELECT id
		FROM portfolio_rebalance_plans
		ORDER BY COALESCE(approved_at, completed_at, updated_at, created_at) DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	for _, planID := range planIDs {
		plan, loadErr := portfolioRebalanceStore().LoadByID(ctx, planID)
		if loadErr != nil {
			return nil, loadErr
		}
		if plan == nil {
			continue
		}
		occurred := portfolioHistoryFirstTime(plan.ApprovedAt, plan.CompletedAt, plan.UpdatedAt, plan.CreatedAt)
		title := strings.TrimSpace(plan.Title)
		if title == "" {
			title = "Portfolio target"
		}
		id := plan.ID
		entry := portfolioHistoryEntry{
			ID:               fmt.Sprintf("target:%d", plan.ID),
			Kind:             "target",
			OccurredAt:       occurred.UTC().Format(time.RFC3339),
			Status:           strings.ToUpper(strings.TrimSpace(plan.Status)),
			Title:            title,
			Subtitle:         strings.TrimSpace(plan.Notes),
			Source:           portfolioHistoryPlanSource(plan.Driver),
			MemoJobID:        strings.TrimSpace(plan.MemoJobID),
			PlanID:           &id,
			SourceSnapshotID: plan.SourceSnapshotID,
			Rows:             portfolioHistoryRowsFromPlan(plan.Rows),
			occurredTime:     occurred,
		}
		entries = append(entries, entry)
		if index, ok := memoEntryByJobID[plan.MemoJobID]; ok {
			entries[index].PlanID = &id
		}
	}

	snapshotIDs, err := portfolioHistoryIDs(ctx, `
		SELECT id
		FROM portfolio_mix_snapshots
		ORDER BY approved_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	for _, snapshotID := range snapshotIDs {
		snapshot, rows, loadErr := portfolioMixStore().LoadByID(ctx, snapshotID)
		if loadErr != nil {
			return nil, loadErr
		}
		if snapshot == nil {
			continue
		}
		occurred := portfolioHistoryFirstTime(snapshot.ApprovedAt, snapshot.CreatedAt)
		id := snapshot.ID
		memoJobID, err := portfolioHistoryMemoForPlan(ctx, snapshot.SourceRebalancePlanID)
		if err != nil {
			return nil, err
		}
		entry := portfolioHistoryEntry{
			ID:           fmt.Sprintf("shape:%d", snapshot.ID),
			Kind:         "shape",
			OccurredAt:   occurred.UTC().Format(time.RFC3339),
			Status:       strings.ToUpper(strings.TrimSpace(snapshot.Status)),
			Title:        "Approved portfolio shape",
			Subtitle:     strings.TrimSpace(snapshot.Notes),
			Source:       portfolioHistorySnapshotSource(snapshot.Reason),
			PlanID:       snapshot.SourceRebalancePlanID,
			MemoJobID:    memoJobID,
			SnapshotID:   &id,
			Rows:         portfolioHistoryRowsFromMix(rows),
			occurredTime: occurred,
		}
		entries = append(entries, entry)
	}

	actuals, err := db.QueryContext(ctx, `
		SELECT statement_id, observed_at, total_value_aud, residual_cash_aud
		FROM portfolio_daily_snapshots
		ORDER BY observed_at DESC, statement_id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	for actuals.Next() {
		var statementID int64
		var observed time.Time
		var totalValue float64
		var residualCash float64
		if err := actuals.Scan(&statementID, &observed, &totalValue, &residualCash); err != nil {
			actuals.Close()
			return nil, err
		}
		rows, loadErr := portfolioHistoryActualRows(ctx, statementID, totalValue, residualCash)
		if loadErr != nil {
			actuals.Close()
			return nil, loadErr
		}
		statementIDCopy := statementID
		totalValueCopy := totalValue
		entries = append(entries, portfolioHistoryEntry{
			ID:           fmt.Sprintf("actual:%d", statementID),
			Kind:         "actual",
			OccurredAt:   observed.UTC().Format(time.RFC3339),
			Status:       "OBSERVED",
			Title:        "Broker portfolio snapshot",
			Source:       "Broker statement",
			StatementID:  &statementIDCopy,
			TotalValue:   &totalValueCopy,
			ValueBasisAt: observed.UTC().Format(time.RFC3339),
			Rows:         rows,
			occurredTime: observed,
		})
	}
	if err := actuals.Err(); err != nil {
		actuals.Close()
		return nil, err
	}
	actuals.Close()
	if err := portfolioHistoryAttachValueBasis(ctx, entries); err != nil {
		return nil, err
	}

	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].occurredTime.Equal(entries[j].occurredTime) {
			return entries[i].ID > entries[j].ID
		}
		return entries[i].occurredTime.After(entries[j].occurredTime)
	})
	if len(entries) > limit {
		entries = entries[:limit]
	}
	return entries, nil
}

// Keep approval provenance independent of the history page limit.
func portfolioHistoryMemoForPlan(ctx context.Context, planID *int64) (string, error) {
	if planID == nil {
		return "", nil
	}
	var jobID string
	err := db.QueryRowContext(ctx, `SELECT COALESCE(memo_job_id, '') FROM portfolio_rebalance_plans WHERE id = ?`, *planID).Scan(&jobID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return strings.TrimSpace(jobID), err
}

type portfolioHistoryValueBasis struct {
	ObservedAt time.Time
	TotalValue float64
}

func portfolioHistoryAttachValueBasis(ctx context.Context, entries []portfolioHistoryEntry) error {
	rows, err := db.QueryContext(ctx, `
		SELECT observed_at, total_value_aud
		FROM portfolio_daily_snapshots
		WHERE total_value_aud > 0
		ORDER BY observed_at ASC, statement_id ASC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	bases := make([]portfolioHistoryValueBasis, 0)
	for rows.Next() {
		var basis portfolioHistoryValueBasis
		if err := rows.Scan(&basis.ObservedAt, &basis.TotalValue); err != nil {
			return err
		}
		bases = append(bases, basis)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for index := range entries {
		if entries[index].TotalValue != nil || entries[index].occurredTime.IsZero() {
			continue
		}
		for basisIndex := len(bases) - 1; basisIndex >= 0; basisIndex-- {
			basis := bases[basisIndex]
			if basis.ObservedAt.After(entries[index].occurredTime) {
				continue
			}
			totalValue := basis.TotalValue
			entries[index].TotalValue = &totalValue
			entries[index].ValueBasisAt = basis.ObservedAt.UTC().Format(time.RFC3339)
			break
		}
	}
	return nil
}

func portfolioHistoryIDs(ctx context.Context, query string, limit int) ([]int64, error) {
	rows, err := db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func portfolioHistoryActualRows(ctx context.Context, statementID int64, totalValue, residualCash float64) ([]portfolioHistoryAllocationRow, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT asset_class, display_name, portfolio_weight_pct
		FROM asset_class_daily_snapshots
		WHERE statement_id = ?
		ORDER BY total_value_aud DESC, asset_class ASC
	`, statementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]portfolioHistoryAllocationRow, 0)
	for rows.Next() {
		var item portfolioHistoryAllocationRow
		if err := rows.Scan(&item.AssetClass, &item.DisplayName, &item.WeightPct); err != nil {
			return nil, err
		}
		item.DisplayOrder = len(result) + 1
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if totalValue > 0 && residualCash > 0.005 {
		result = append(result, portfolioHistoryAllocationRow{
			AssetClass: "CASH", DisplayName: "Cash / Reserve", DisplayOrder: 10000,
			WeightPct: (residualCash / totalValue) * 100,
		})
	}
	return result, nil
}

func portfolioHistoryRowsFromMemo(targets []map[string]interface{}) []portfolioHistoryAllocationRow {
	result := make([]portfolioHistoryAllocationRow, 0, len(targets))
	for index, target := range targets {
		assetClass := portfolioHistoryString(target["asset_class"])
		if assetClass == "" {
			assetClass = portfolioHistoryString(target["display_name"])
		}
		weight, ok := portfolioHistoryNumber(target["target_pct"])
		if assetClass == "" || !ok || weight < 0 {
			continue
		}
		displayName := portfolioHistoryString(target["display_name"])
		if displayName == "" {
			displayName = assetClass
		}
		result = append(result, portfolioHistoryAllocationRow{
			AssetClass: strings.ToUpper(strings.TrimSpace(assetClass)), DisplayName: displayName,
			DisplayOrder: index + 1, WeightPct: weight,
		})
	}
	return result
}

func portfolioHistoryRowsFromPlan(rows []portfoliorebalance.PlanRow) []portfolioHistoryAllocationRow {
	result := make([]portfolioHistoryAllocationRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, portfolioHistoryAllocationRow{
			AssetClass: row.AssetClass, DisplayName: row.DisplayName,
			DisplayOrder: row.DisplayOrder, WeightPct: row.TargetWeightPct,
		})
	}
	return result
}

func portfolioHistoryRowsFromMix(rows []portfoliomix.Row) []portfolioHistoryAllocationRow {
	result := make([]portfolioHistoryAllocationRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, portfolioHistoryAllocationRow{
			AssetClass: row.AssetClass, DisplayName: row.DisplayName,
			DisplayOrder: row.DisplayOrder, WeightPct: row.WeightPct,
		})
	}
	return result
}

func portfolioHistoryParseTime(values ...string) time.Time {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
			if parsed, err := time.Parse(layout, value); err == nil {
				return parsed
			}
		}
	}
	return time.Unix(0, 0).UTC()
}

func portfolioHistoryFirstTime(values ...*time.Time) time.Time {
	for _, value := range values {
		if value != nil && !value.IsZero() {
			return *value
		}
	}
	return time.Unix(0, 0).UTC()
}

func portfolioHistoryPlanSource(driver string) string {
	if strings.EqualFold(strings.TrimSpace(driver), "MEMO") {
		return "Portfolio Analysis"
	}
	return "Manual target"
}

func portfolioHistorySnapshotSource(reason string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" || strings.EqualFold(reason, "DISCRETIONARY") {
		return "User approved"
	}
	return strings.ReplaceAll(strings.ToLower(reason), "_", " ")
}

func portfolioHistoryString(value interface{}) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func portfolioHistoryNumber(value interface{}) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}
