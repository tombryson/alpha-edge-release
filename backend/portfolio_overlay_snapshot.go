package main

import (
	"database/sql"
	"time"
)

func intPtr(v int) *int             { return &v }
func float64Ptr(v float64) *float64 { return &v }

func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

type overlayStage1Snapshot struct {
	ID          int64
	ActivatedAt time.Time
	Q1Exposure  float64
}

type overlayStage1SnapshotClass struct {
	AssetClass             string
	InvestedValue          float64
	TacticalCashValue      float64
	TotalClassCapitalValue float64
	StrategicWeightPct     float64
}

func getActiveOverlayStage1Snapshot() (*overlayStage1Snapshot, map[string]overlayStage1SnapshotClass, error) {
	row := db.QueryRow(`
		SELECT id, activated_at, q1_exposure_pct
		FROM overlay_stage1_state
		WHERE active = 1
		ORDER BY activated_at DESC
		LIMIT 1
	`)

	var snapshot overlayStage1Snapshot
	if err := row.Scan(&snapshot.ID, &snapshot.ActivatedAt, &snapshot.Q1Exposure); err != nil {
		if err == sql.ErrNoRows {
			return nil, map[string]overlayStage1SnapshotClass{}, nil
		}
		return nil, nil, err
	}

	rows, err := db.Query(`
		SELECT asset_class, invested_value, tactical_cash_value, total_class_capital_value, strategic_weight_pct
		FROM overlay_stage1_state_classes
		WHERE state_id = ?
	`, snapshot.ID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	classMap := map[string]overlayStage1SnapshotClass{}
	for rows.Next() {
		var entry overlayStage1SnapshotClass
		if err := rows.Scan(
			&entry.AssetClass,
			&entry.InvestedValue,
			&entry.TacticalCashValue,
			&entry.TotalClassCapitalValue,
			&entry.StrategicWeightPct,
		); err != nil {
			return nil, nil, err
		}
		classMap[entry.AssetClass] = entry
	}

	return &snapshot, classMap, nil
}

func releaseActiveOverlayStage1Snapshot() {
	db.Exec(`
		UPDATE overlay_stage1_state
		SET active = 0, released_at = CURRENT_TIMESTAMP
		WHERE active = 1
	`)
}

func captureOverlayStage1Snapshot(q1ExposurePct, spyPct, xaoPct float64, governingSource string, portfolioValue float64, classes []PortfolioOverlayAssetClassSummary) (*overlayStage1Snapshot, map[string]overlayStage1SnapshotClass, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	// Only one active Stage 1 snapshot should exist.
	if _, err := tx.Exec(`UPDATE overlay_stage1_state SET active = 0, released_at = CURRENT_TIMESTAMP WHERE active = 1`); err != nil {
		return nil, nil, err
	}

	result, err := tx.Exec(`
		INSERT INTO overlay_stage1_state (active, q1_exposure_pct, spy_target_pct, xao_target_pct, governing_source, portfolio_value)
		VALUES (1, ?, ?, ?, ?, ?)
	`, q1ExposurePct, spyPct, xaoPct, governingSource, portfolioValue)
	if err != nil {
		return nil, nil, err
	}

	stateID, err := result.LastInsertId()
	if err != nil {
		return nil, nil, err
	}

	classMap := map[string]overlayStage1SnapshotClass{}
	for _, classSummary := range classes {
		if _, err := tx.Exec(`
			INSERT INTO overlay_stage1_state_classes (
				state_id, asset_class, invested_value, tactical_cash_value, total_class_capital_value, strategic_weight_pct
			) VALUES (?, ?, ?, ?, ?, ?)
		`, stateID, classSummary.AssetClass, classSummary.ActualInvestedValue, classSummary.TacticalCashValue, classSummary.TotalClassCapitalValue, classSummary.StrategicWeightPct); err != nil {
			return nil, nil, err
		}
		classMap[classSummary.AssetClass] = overlayStage1SnapshotClass{
			AssetClass:             classSummary.AssetClass,
			InvestedValue:          classSummary.ActualInvestedValue,
			TacticalCashValue:      classSummary.TacticalCashValue,
			TotalClassCapitalValue: classSummary.TotalClassCapitalValue,
			StrategicWeightPct:     classSummary.StrategicWeightPct,
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	snapshot, _, err := getActiveOverlayStage1Snapshot()
	if err != nil {
		return nil, nil, err
	}

	return snapshot, classMap, nil
}

