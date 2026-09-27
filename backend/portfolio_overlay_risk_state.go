package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	portfolio "trading-backend/internal/portfolio"
)

func getEffectiveEquityState(ctx context.Context) (float64, float64, float64, string, string, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	rows, err := db.QueryContext(ctx, `SELECT source_ticker, target_equity_pct FROM equity_sizing`)
	if err != nil {
		return -1, -1, -1, "DISCONNECTED", "SPY", fmt.Errorf("equity_sizing query failed: %w", err)
	}

	spyPct := -1.0
	spxPct := -1.0
	xaoPct := -1.0
	q4dPct := -1.0
	spSource := "SPY"

	for rows.Next() {
		var source string
		var pct float64
		if err := rows.Scan(&source, &pct); err != nil {
			rows.Close()
			return -1, -1, -1, "DISCONNECTED", "SPY", fmt.Errorf("equity_sizing scan failed: %w", err)
		}
		switch strings.ToUpper(strings.TrimSpace(source)) {
		case "SPY":
			spyPct = pct
		case "SPX":
			spxPct = pct
		case "XAO":
			xaoPct = pct
		case "Q4D":
			q4dPct = pct
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return -1, -1, -1, "DISCONNECTED", "SPY", fmt.Errorf("equity_sizing iteration failed: %w", err)
	}
	rows.Close()
	if spxPct >= 0 {
		spyPct = spxPct
		spSource = "SPX"
	}

	effectivePct := -1.0
	governing := "DISCONNECTED"

	switch {
	case spyPct == -1 && xaoPct == -1 && q4dPct == -1:
		return spyPct, xaoPct, -1, governing, spSource, nil
	case spyPct == -1:
		effectivePct = xaoPct
		governing = "XAO"
	case xaoPct == -1:
		effectivePct = spyPct
		governing = spSource
	case spyPct <= xaoPct:
		effectivePct = spyPct
		governing = spSource
	default:
		effectivePct = xaoPct
		governing = "XAO"
	}

	if q4dPct >= 0 && (effectivePct < 0 || q4dPct <= effectivePct) {
		effectivePct = q4dPct
		governing = "Q4D"
	}

	return spyPct, xaoPct, effectivePct, governing, spSource, nil
}

func resolveQ3RiskTarget(spPct, xaoPct float64, spSource string) (float64, string) {
	return portfolio.ResolveQ3RiskTarget(spPct, xaoPct, spSource)
}

func buildPortfolioRiskState(spyPct, xaoPct float64, spSource string, q4Crisis Q4CrisisState) PortfolioRiskState {
	resolved := portfolio.BuildRiskState(spyPct, xaoPct, spSource, portfolio.Q4CrisisInput{
		Active: q4Crisis.Active,
		Reason: q4Crisis.Reason,
	})
	q3TargetPct := resolved.Q3TargetPct
	q3Source := resolved.Q3Source
	q3Active := resolved.Q3Active

	q3Input := PortfolioRiskQ3Input{
		Active:          q3Active,
		GoverningSource: q3Source,
	}
	if spyPct >= 0 {
		q3Input.SPXTargetPct = float64Ptr(spyPct)
		q3Input.SpyTargetPct = float64Ptr(spyPct)
	}
	if xaoPct >= 0 {
		q3Input.XaoTargetPct = float64Ptr(xaoPct)
	}
	if q3TargetPct >= 0 {
		q3Input.EffectiveTargetPct = float64Ptr(q3TargetPct)
	}

	inputs := PortfolioRiskInputs{
		Q3: q3Input,
		Q4: PortfolioRiskQ4Input{
			Active:             q4Crisis.Active,
			TargetPct:          q4CrisisTargetEquityPct,
			Reason:             q4Crisis.Reason,
			LastChangedAt:      q4Crisis.LastChangedAt,
			LastAcknowledgedAt: q4Crisis.LastAcknowledgedAt,
			UpdatedAt:          q4Crisis.UpdatedAt,
		},
	}

	return PortfolioRiskState{
		Mode:         resolved.Mode,
		Label:        resolved.Label,
		Priority:     resolved.Priority,
		TargetPct:    resolved.TargetPct,
		TargetKind:   resolved.TargetKind,
		ActiveReason: resolved.ActiveReason,
		Inputs:       inputs,
	}
}

func loadPortfolioRiskHeaderQ3State(ctx context.Context) (*PortfolioRiskHeaderQ3State, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	rows, err := db.QueryContext(ctx, `
		SELECT source_ticker, target_equity_pct, last_updated
		FROM equity_sizing
		WHERE UPPER(TRIM(source_ticker)) IN ('SPY', 'SPX', 'XAO')
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	spyPct := -1.0
	spxPct := -1.0
	xaoPct := -1.0
	spSource := "SPY"
	var spyUpdated *time.Time
	var spxUpdated *time.Time
	var xaoUpdated *time.Time

	for rows.Next() {
		var source string
		var pct float64
		var updated sql.NullTime
		if err := rows.Scan(&source, &pct, &updated); err != nil {
			return nil, err
		}
		if updated.Valid {
			value := updated.Time
			switch strings.ToUpper(strings.TrimSpace(source)) {
			case "SPY":
				spyUpdated = &value
			case "SPX":
				spxUpdated = &value
			case "XAO":
				xaoUpdated = &value
			}
		}
		switch strings.ToUpper(strings.TrimSpace(source)) {
		case "SPY":
			spyPct = pct
		case "SPX":
			spxPct = pct
		case "XAO":
			xaoPct = pct
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if spxPct >= 0 {
		spyPct = spxPct
		spyUpdated = spxUpdated
		spSource = "SPX"
	}

	targetPct, source := resolveQ3RiskTarget(spyPct, xaoPct, spSource)
	if targetPct < 0 {
		return nil, nil
	}

	state := &PortfolioRiskHeaderQ3State{
		TargetPct:      targetPct,
		Source:         source,
		Active:         targetPct < 99.9999,
		SPXLastUpdated: spyUpdated,
		SpyLastUpdated: spyUpdated,
		XaoLastUpdated: xaoUpdated,
	}
	if spyPct >= 0 {
		state.SPXTargetPct = float64Ptr(spyPct)
		state.SpyTargetPct = float64Ptr(spyPct)
	}
	if xaoPct >= 0 {
		state.XaoTargetPct = float64Ptr(xaoPct)
	}

	var lastSignalChanged sql.NullTime
	var lastApplied sql.NullTime
	var lastAppliedPct sql.NullFloat64
	if err := db.QueryRowContext(ctx, `
		SELECT last_signal_changed_at, last_applied_at, last_applied_q1_exposure_pct
		FROM overlay_signal_state
		WHERE id = 1
	`).Scan(&lastSignalChanged, &lastApplied, &lastAppliedPct); err == nil {
		if lastSignalChanged.Valid {
			value := lastSignalChanged.Time
			state.LastSignalChanged = &value
		}
		if lastApplied.Valid {
			value := lastApplied.Time
			state.LastAppliedAt = &value
		}
		if lastAppliedPct.Valid {
			value := lastAppliedPct.Float64
			state.LastAppliedPct = &value
		}
	} else if err != sql.ErrNoRows {
		return nil, err
	}

	return state, nil
}

func loadOptionalQ4CrisisState(ctx context.Context) (*Q4CrisisState, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	row := db.QueryRowContext(ctx, `
		SELECT active, last_changed_at, last_acknowledged_at, COALESCE(reason, ''), updated_at
		FROM q4_crisis_state
		WHERE id = 1
	`)

	var state Q4CrisisState
	var lastChangedAt sql.NullTime
	var lastAcknowledgedAt sql.NullTime
	var updatedAt sql.NullTime
	if err := row.Scan(
		&state.Active,
		&lastChangedAt,
		&lastAcknowledgedAt,
		&state.Reason,
		&updatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	if lastChangedAt.Valid {
		value := lastChangedAt.Time
		state.LastChangedAt = &value
	}
	if lastAcknowledgedAt.Valid {
		value := lastAcknowledgedAt.Time
		state.LastAcknowledgedAt = &value
	}
	if updatedAt.Valid {
		value := updatedAt.Time
		state.UpdatedAt = &value
	}
	if state.Active {
		state.TargetEquityPct = q4CrisisTargetEquityPct
	}

	return &state, nil
}

func getPortfolioRiskHeaderState(w http.ResponseWriter, r *http.Request) {
	q3, err := loadPortfolioRiskHeaderQ3State(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	q4, err := loadOptionalQ4CrisisState(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	snapshot, rows, err := loadLatestApprovedPortfolioMix()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sort.Slice(rows, func(i, j int) bool {
		if math.Abs(rows[i].WeightPct-rows[j].WeightPct) > 0.0001 {
			return rows[i].WeightPct > rows[j].WeightPct
		}
		if rows[i].DisplayOrder != rows[j].DisplayOrder {
			return rows[i].DisplayOrder < rows[j].DisplayOrder
		}
		return rows[i].AssetClass < rows[j].AssetClass
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PortfolioRiskHeaderStateResponse{
		Q3: q3,
		Q4: q4,
		BaselineMix: PortfolioMixSnapshotResponse{
			Snapshot: snapshot,
			Rows:     rows,
		},
	})
}

func GetEffectiveEquityPct() (float64, error) {
	_, _, effectivePct, _, _, err := getEffectiveEquityState(context.Background())
	return effectivePct, err
}

