package main

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"strings"
	"time"
)

func loadOverlaySignalStateReadOnly(spyPct, xaoPct, currentPct float64, governingSource string) (OverlaySignalState, error) {
	row := db.QueryRow(`
		SELECT current_q1_exposure_pct, last_applied_q1_exposure_pct, spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source, last_signal_changed_at, last_applied_at
		FROM overlay_signal_state
		WHERE id = 1
	`)

	var state OverlaySignalState
	var lastSignalChangedAt sql.NullTime
	var lastAppliedAt sql.NullTime
	err := row.Scan(
		&state.CurrentQ1ExposurePct,
		&state.LastAppliedQ1ExposurePct,
		&state.SpyQ1ExposurePct,
		&state.XaoQ1ExposurePct,
		&state.GoverningSource,
		&lastSignalChangedAt,
		&lastAppliedAt,
	)
	if err == nil {
		if lastSignalChangedAt.Valid {
			state.LastSignalChangedAt = &lastSignalChangedAt.Time
		}
		if lastAppliedAt.Valid {
			state.LastAppliedAt = &lastAppliedAt.Time
		}
		return state, nil
	}
	if err != sql.ErrNoRows {
		return OverlaySignalState{}, err
	}

	// No persisted state yet: report the same defaults loadOrInit would
	// create, without writing them.
	initialCurrent := currentPct
	if initialCurrent < 0 {
		initialCurrent = 100
	}
	initialSpy := spyPct
	if initialSpy < 0 {
		initialSpy = initialCurrent
	}
	initialXao := xaoPct
	if initialXao < 0 {
		initialXao = initialCurrent
	}
	if governingSource == "" {
		governingSource = "SPY"
	}
	return OverlaySignalState{
		CurrentQ1ExposurePct:     initialCurrent,
		LastAppliedQ1ExposurePct: 100,
		SpyQ1ExposurePct:         initialSpy,
		XaoQ1ExposurePct:         initialXao,
		GoverningSource:          governingSource,
	}, nil
}

func loadOrInitOverlaySignalState(spyPct, xaoPct, currentPct float64, governingSource string) (OverlaySignalState, bool, error) {
	row := db.QueryRow(`
		SELECT current_q1_exposure_pct, last_applied_q1_exposure_pct, spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source, last_signal_changed_at, last_applied_at
		FROM overlay_signal_state
		WHERE id = 1
	`)

	var state OverlaySignalState
	var lastSignalChangedAt sql.NullTime
	var lastAppliedAt sql.NullTime
	if err := row.Scan(
		&state.CurrentQ1ExposurePct,
		&state.LastAppliedQ1ExposurePct,
		&state.SpyQ1ExposurePct,
		&state.XaoQ1ExposurePct,
		&state.GoverningSource,
		&lastSignalChangedAt,
		&lastAppliedAt,
	); err == nil {
		if lastSignalChangedAt.Valid {
			state.LastSignalChangedAt = &lastSignalChangedAt.Time
		}
		if lastAppliedAt.Valid {
			state.LastAppliedAt = &lastAppliedAt.Time
		}
		state = repairImplicitQ3SelfBaseline(state)
		return state, false, nil
	} else if err != sql.ErrNoRows {
		return OverlaySignalState{}, false, err
	}

	initialCurrent := currentPct
	if initialCurrent < 0 {
		initialCurrent = 100
	}
	initialLastApplied := 100.0
	initialSpy := spyPct
	if initialSpy < 0 {
		initialSpy = initialCurrent
	}
	initialXao := xaoPct
	if initialXao < 0 {
		initialXao = initialCurrent
	}
	if governingSource == "" {
		governingSource = "SPY"
	}

	if _, err := db.Exec(`
		INSERT INTO overlay_signal_state (
			id, current_q1_exposure_pct, last_applied_q1_exposure_pct, spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source, last_signal_changed_at, last_applied_at
		) VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, initialCurrent, initialLastApplied, initialSpy, initialXao, governingSource); err != nil {
		return OverlaySignalState{}, false, err
	}

	now := time.Now()
	return OverlaySignalState{
		CurrentQ1ExposurePct:     initialCurrent,
		LastAppliedQ1ExposurePct: initialLastApplied,
		SpyQ1ExposurePct:         initialSpy,
		XaoQ1ExposurePct:         initialXao,
		GoverningSource:          governingSource,
		LastSignalChangedAt:      &now,
		LastAppliedAt:            &now,
	}, true, nil
}

func repairImplicitQ3SelfBaseline(state OverlaySignalState) OverlaySignalState {
	if strings.EqualFold(strings.TrimSpace(state.GoverningSource), "Q4D") {
		return state
	}
	if state.CurrentQ1ExposurePct >= 99.9999 {
		return state
	}
	if math.Abs(state.CurrentQ1ExposurePct-state.LastAppliedQ1ExposurePct) > 0.0001 {
		return state
	}
	if hasAcceptedOverlayEventForSignal(state.CurrentQ1ExposurePct) {
		return state
	}

	if _, err := db.Exec(`
		UPDATE overlay_signal_state
		SET last_applied_q1_exposure_pct = 100,
		    last_applied_at = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`); err != nil {
		log.Printf("[OVERLAY] Failed to repair implicit Q3 self-baseline: %v", err)
		return state
	}

	log.Printf("[OVERLAY] Repaired implicit Q3 self-baseline %.1f%% -> last applied 100%%", state.CurrentQ1ExposurePct)
	state.LastAppliedQ1ExposurePct = 100
	state.LastAppliedAt = nil
	return state
}

func hasAcceptedOverlayEventForSignal(targetPct float64) bool {
	var count int
	hasNotesColumn := false
	var notesColumnCount int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM pragma_table_info('overlay_events')
		WHERE name = 'notes'
	`).Scan(&notesColumnCount); err == nil && notesColumnCount > 0 {
		hasNotesColumn = true
	}

	reviewedSignalClause := ""
	if hasNotesColumn {
		reviewedSignalClause = "OR (status = 'CANCELLED' AND COALESCE(notes, '') LIKE '%signal_reviewed%')"
	}

	err := db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(*)
		FROM overlay_events
		WHERE ABS(to_q1_exposure_pct - ?) <= 0.0001
		  AND (
		      status IN ('STAGE1_DONE', 'STAGE2_DONE', 'BASELINED')
		      OR stage1_applied_at IS NOT NULL
		      OR baseline_accepted_at IS NOT NULL
		      %s
		  )
	`, reviewedSignalClause), targetPct).Scan(&count)
	if err != nil {
		log.Printf("[OVERLAY] Failed to inspect accepted overlay events, preserving signal state: %v", err)
		return true
	}
	return count > 0
}

