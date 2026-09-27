package main

import (
	"context"
	"database/sql"
	"log"
	"math"
	"sort"
	"strings"
	"time"
)

func getActivePendingOverlayEvent() (*OverlayEvent, map[string]OverlayEventClass, error) {
	row := db.QueryRow(`
		SELECT id, status, from_q1_exposure_pct, to_q1_exposure_pct, adjustment_ratio, governing_source, triggered_at,
		       stage1_applied_at, stage1_required_reduction_value, stage1_recorded_reduction_value,
		       stage1_baseline_reserve_value, stage1_expected_reserve_value, stage1_import_baseline_at,
		       reserve_confirmed_at, reserve_confirmed_value, reserve_variance, COALESCE(cash_confirmation_status, ''),
		       stage2_completed_at, baseline_accepted_at
		FROM overlay_events
		WHERE status IN ('PENDING', 'PARTIAL')
		ORDER BY triggered_at DESC, id DESC
		LIMIT 1
	`)

	var event OverlayEvent
	var stage1AppliedAt sql.NullTime
	var stage1ImportBaselineAt sql.NullTime
	var reserveConfirmedAt sql.NullTime
	var reserveConfirmedValue sql.NullFloat64
	var reserveVariance sql.NullFloat64
	var stage2CompletedAt sql.NullTime
	var baselineAcceptedAt sql.NullTime
	if err := row.Scan(
		&event.ID,
		&event.Status,
		&event.FromQ1ExposurePct,
		&event.ToQ1ExposurePct,
		&event.AdjustmentRatio,
		&event.GoverningSource,
		&event.TriggeredAt,
		&stage1AppliedAt,
		&event.Stage1RequiredReductionValue,
		&event.Stage1RecordedReductionValue,
		&event.Stage1BaselineReserveValue,
		&event.Stage1ExpectedReserveValue,
		&stage1ImportBaselineAt,
		&reserveConfirmedAt,
		&reserveConfirmedValue,
		&reserveVariance,
		&event.CashConfirmationStatus,
		&stage2CompletedAt,
		&baselineAcceptedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, map[string]OverlayEventClass{}, nil
		}
		return nil, nil, err
	}
	if stage1AppliedAt.Valid {
		event.Stage1AppliedAt = &stage1AppliedAt.Time
	}
	if stage1ImportBaselineAt.Valid {
		event.Stage1ImportBaselineAt = &stage1ImportBaselineAt.Time
	}
	if reserveConfirmedAt.Valid {
		event.ReserveConfirmedAt = &reserveConfirmedAt.Time
	}
	if reserveConfirmedValue.Valid {
		value := reserveConfirmedValue.Float64
		event.ReserveConfirmedValue = &value
	}
	if reserveVariance.Valid {
		value := reserveVariance.Float64
		event.ReserveVariance = &value
	}
	if stage2CompletedAt.Valid {
		event.Stage2CompletedAt = &stage2CompletedAt.Time
	}
	if baselineAcceptedAt.Valid {
		event.BaselineAcceptedAt = &baselineAcceptedAt.Time
	}

	classMap, err := loadOverlayEventClasses(event.ID)
	if err != nil {
		return nil, nil, err
	}

	return &event, classMap, nil
}

func loadOverlayEventClasses(eventID int64) (map[string]OverlayEventClass, error) {
	rows, err := db.Query(`
		SELECT asset_class, overlay_eligible, trigger_invested_value, trigger_invested_pct, trigger_tactical_cash_value,
		       trigger_total_class_capital_value, target_invested_value, target_invested_pct, q3_sell_priority, stage2_target_pct
		       , COALESCE(stage1_recorded_reduction_value, 0)
		FROM overlay_event_classes
		WHERE event_id = ?
	`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	classMap := map[string]OverlayEventClass{}
	for rows.Next() {
		var cls OverlayEventClass
		var q3SellPriority sql.NullInt64
		var stage2TargetPct sql.NullFloat64
		if err := rows.Scan(
			&cls.AssetClass,
			&cls.OverlayEligible,
			&cls.TriggerInvestedValue,
			&cls.TriggerInvestedPct,
			&cls.TriggerTacticalCashValue,
			&cls.TriggerTotalClassValue,
			&cls.TargetInvestedValue,
			&cls.TargetInvestedPct,
			&q3SellPriority,
			&stage2TargetPct,
			&cls.Stage1RecordedReduction,
		); err != nil {
			return nil, err
		}
		if q3SellPriority.Valid {
			value := int(q3SellPriority.Int64)
			cls.Q3SellPriority = &value
		}
		if stage2TargetPct.Valid {
			value := stage2TargetPct.Float64
			cls.Stage2TargetPct = &value
		}
		classMap[cls.AssetClass] = cls
	}

	return classMap, nil
}

func latestOverlayImportTime(ctx *overlayPortfolioContext) time.Time {
	if ctx == nil {
		return time.Time{}
	}
	if ctx.StatementCreatedAt.After(ctx.StatementDate) {
		return ctx.StatementCreatedAt
	}
	return ctx.StatementDate
}

func nullableTime(value time.Time) interface{} {
	if value.IsZero() {
		return nil
	}
	return value
}

func overlayStage1ReductionTolerance(requiredReductionValue float64) float64 {
	if requiredReductionValue <= 0 {
		return 0
	}
	return math.Max(1000, requiredReductionValue*0.05)
}

func lookupOverlayHoldingValue(tx *sql.Tx, holdingID *int64, stockName string) float64 {
	var value float64
	if tx == nil {
		return 0
	}
	if holdingID != nil {
		if err := tx.QueryRow(`
			SELECT COALESCE(value_aud, market_value, 0)
			FROM holdings
			WHERE id = ?
		`, *holdingID).Scan(&value); err == nil {
			return value
		}
	}
	name := strings.TrimSpace(stockName)
	if name == "" {
		return 0
	}
	if err := tx.QueryRow(`
		SELECT COALESCE(value_aud, market_value, 0)
		FROM holdings
		WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?))
		  AND is_active = 1
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
	`, name).Scan(&value); err == nil {
		return value
	}
	return 0
}

func reconcileOverlayStage1CashConfirmation(event *OverlayEvent, ctx *overlayPortfolioContext) {
	if event == nil || event.Status != "STAGE1_DONE" || event.Stage1AppliedAt == nil || event.Stage1ExpectedReserveValue <= 0 {
		return
	}
	if event.ReserveConfirmedAt != nil {
		if event.CashConfirmationStatus == "" {
			event.CashConfirmationStatus = "CONFIRMED"
		}
		return
	}

	importTime := latestOverlayImportTime(ctx)
	if importTime.IsZero() || !importTime.After(*event.Stage1AppliedAt) {
		event.CashConfirmationStatus = "AWAITING_IMPORT"
		return
	}

	variance := ctx.PortfolioCashBucketValue - event.Stage1ExpectedReserveValue
	tolerance := math.Max(25, math.Abs(event.Stage1ExpectedReserveValue)*0.005)
	if math.Abs(variance) <= tolerance {
		now := time.Now()
		status := "CONFIRMED"
		if _, err := db.Exec(`
			UPDATE overlay_events
			SET reserve_confirmed_at = CURRENT_TIMESTAMP,
			    reserve_confirmed_value = ?,
			    reserve_variance = ?,
			    cash_confirmation_status = ?
			WHERE id = ?
		`, ctx.PortfolioCashBucketValue, variance, status, event.ID); err != nil {
			log.Printf("[OVERLAY] Failed to persist Stage 1 cash confirmation for event %d: %v", event.ID, err)
		}
		event.ReserveConfirmedAt = &now
		confirmedValue := ctx.PortfolioCashBucketValue
		event.ReserveConfirmedValue = &confirmedValue
		event.ReserveVariance = &variance
		event.CashConfirmationStatus = status
		return
	}

	status := "VARIANCE"
	if _, err := db.Exec(`
		UPDATE overlay_events
		SET reserve_confirmed_value = ?,
		    reserve_variance = ?,
		    cash_confirmation_status = ?
		WHERE id = ?
	`, ctx.PortfolioCashBucketValue, variance, status, event.ID); err != nil {
		log.Printf("[OVERLAY] Failed to persist Stage 1 cash variance for event %d: %v", event.ID, err)
	}
	confirmedValue := ctx.PortfolioCashBucketValue
	event.ReserveConfirmedValue = &confirmedValue
	event.ReserveVariance = &variance
	event.CashConfirmationStatus = status
}

func getLatestOverlayWorkflowEvent() (*OverlayEvent, map[string]OverlayEventClass, error) {
	row := db.QueryRow(`
		SELECT id, status, from_q1_exposure_pct, to_q1_exposure_pct, adjustment_ratio, governing_source, triggered_at,
		       stage1_applied_at, stage1_required_reduction_value, stage1_recorded_reduction_value,
		       stage1_baseline_reserve_value, stage1_expected_reserve_value, stage1_import_baseline_at,
		       reserve_confirmed_at, reserve_confirmed_value, reserve_variance, COALESCE(cash_confirmation_status, ''),
		       stage2_completed_at, baseline_accepted_at
		FROM overlay_events
		WHERE status IN ('PENDING', 'PARTIAL', 'STAGE1_DONE', 'STAGE2_DONE')
		ORDER BY triggered_at DESC, id DESC
		LIMIT 1
	`)

	var event OverlayEvent
	var stage1AppliedAt sql.NullTime
	var stage1ImportBaselineAt sql.NullTime
	var reserveConfirmedAt sql.NullTime
	var reserveConfirmedValue sql.NullFloat64
	var reserveVariance sql.NullFloat64
	var stage2CompletedAt sql.NullTime
	var baselineAcceptedAt sql.NullTime
	if err := row.Scan(
		&event.ID,
		&event.Status,
		&event.FromQ1ExposurePct,
		&event.ToQ1ExposurePct,
		&event.AdjustmentRatio,
		&event.GoverningSource,
		&event.TriggeredAt,
		&stage1AppliedAt,
		&event.Stage1RequiredReductionValue,
		&event.Stage1RecordedReductionValue,
		&event.Stage1BaselineReserveValue,
		&event.Stage1ExpectedReserveValue,
		&stage1ImportBaselineAt,
		&reserveConfirmedAt,
		&reserveConfirmedValue,
		&reserveVariance,
		&event.CashConfirmationStatus,
		&stage2CompletedAt,
		&baselineAcceptedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, map[string]OverlayEventClass{}, nil
		}
		return nil, nil, err
	}
	if stage1AppliedAt.Valid {
		event.Stage1AppliedAt = &stage1AppliedAt.Time
	}
	if stage1ImportBaselineAt.Valid {
		event.Stage1ImportBaselineAt = &stage1ImportBaselineAt.Time
	}
	if reserveConfirmedAt.Valid {
		event.ReserveConfirmedAt = &reserveConfirmedAt.Time
	}
	if reserveConfirmedValue.Valid {
		value := reserveConfirmedValue.Float64
		event.ReserveConfirmedValue = &value
	}
	if reserveVariance.Valid {
		value := reserveVariance.Float64
		event.ReserveVariance = &value
	}
	if stage2CompletedAt.Valid {
		event.Stage2CompletedAt = &stage2CompletedAt.Time
	}
	if baselineAcceptedAt.Valid {
		event.BaselineAcceptedAt = &baselineAcceptedAt.Time
	}

	classMap, err := loadOverlayEventClasses(event.ID)
	if err != nil {
		return nil, nil, err
	}
	return &event, classMap, nil
}

func closePendingOverlayEvents(status string) error {
	if status != "SUPERSEDED" && status != "CANCELLED" {
		status = "SUPERSEDED"
	}
	_, err := db.Exec(`
		UPDATE overlay_events
		SET status = ?, superseded_at = CURRENT_TIMESTAMP
		WHERE status IN ('PENDING', 'PARTIAL')
	`, status)
	return err
}

func getOverlayStage2Mode(fromSignal, toSignal float64) string {
	if toSignal < fromSignal {
		return "DEFENSIVE"
	}
	if toSignal > fromSignal {
		return "RERISK"
	}
	return ""
}

func getDefaultStage2PlaybookTargets(mode string) map[string]float64 {
	targets, ok := defaultStage2PlaybookTargetsByMode[strings.ToUpper(strings.TrimSpace(mode))]
	if !ok {
		return map[string]float64{}
	}
	copyTargets := make(map[string]float64, len(targets))
	for key, value := range targets {
		copyTargets[key] = value
	}
	return copyTargets
}

func buildOverlayStage2Workflow(ctx *overlayPortfolioContext, event *OverlayEvent, eventClasses map[string]OverlayEventClass) *PortfolioOverlayStage2Workflow {
	if event == nil {
		return nil
	}
	if event.Status != "STAGE1_DONE" && event.Status != "STAGE2_DONE" {
		return nil
	}

	regimeCashValue := 0.0
	if event.Stage1RecordedReductionValue > 0 {
		regimeCashValue = event.Stage1RecordedReductionValue
	} else {
		for _, cls := range eventClasses {
			delta := cls.TriggerInvestedValue - cls.TargetInvestedValue
			if delta > 0 {
				regimeCashValue += delta
			}
		}
	}

	targetKeys := make(map[string]struct{})
	mode := getOverlayStage2Mode(event.FromQ1ExposurePct, event.ToQ1ExposurePct)
	defaultTargets := getDefaultStage2PlaybookTargets(mode)
	for assetClass, summary := range ctx.ClassSummaries {
		if summary == nil {
			continue
		}
		if summary.TotalClassCapitalValue <= 0 && summary.ActualInvestedValue <= 0 && summary.TacticalCashValue <= 0 {
			continue
		}
		targetKeys[assetClass] = struct{}{}
	}
	for assetClass, eventClass := range eventClasses {
		if eventClass.Stage2TargetPct != nil && *eventClass.Stage2TargetPct > 0 {
			targetKeys[assetClass] = struct{}{}
			continue
		}
		if _, exists := targetKeys[assetClass]; exists {
			continue
		}
		currentSummary := ctx.ClassSummaries[assetClass]
		if currentSummary != nil && (currentSummary.TotalClassCapitalValue > 0 || currentSummary.ActualInvestedValue > 0 || currentSummary.TacticalCashValue > 0) {
			targetKeys[assetClass] = struct{}{}
		}
	}

	items := make([]PortfolioOverlayStage2Item, 0, len(targetKeys))
	allocatedPct := 0.0

	for assetClass := range targetKeys {
		setting := getOverlayAssetClassSetting(assetClass)
		eventClass := eventClasses[assetClass]
		currentSummary := ctx.ClassSummaries[assetClass]

		targetPct := 0.0
		var defaultTargetPct *float64
		if defaultPct, ok := defaultTargets[assetClass]; ok && defaultPct > 0 {
			targetPct = defaultPct
			defaultTargetPct = &defaultPct
		} else if setting.Stage2TargetPct != nil {
			targetPct = *setting.Stage2TargetPct
			defaultValue := *setting.Stage2TargetPct
			defaultTargetPct = &defaultValue
		}
		if eventClass.Stage2TargetPct != nil {
			targetPct = *eventClass.Stage2TargetPct
		}
		targetValue := 0.0
		if regimeCashValue > 0 && targetPct > 0 {
			targetValue = (targetPct / 100) * regimeCashValue
		}

		currentInvestedValue := 0.0
		currentInvestedPct := 0.0
		if currentSummary != nil {
			currentInvestedValue = currentSummary.ActualInvestedValue
			currentInvestedPct = currentSummary.ActualInvestedPct
		}

		items = append(items, PortfolioOverlayStage2Item{
			AssetClass:           assetClass,
			DisplayName:          setting.DisplayName,
			DisplayOrder:         setting.DisplayOrder,
			TargetPct:            targetPct,
			TargetValue:          targetValue,
			DefaultTargetPct:     defaultTargetPct,
			CurrentInvestedPct:   currentInvestedPct,
			CurrentInvestedValue: currentInvestedValue,
			OverlayEligible:      setting.OverlayEligible,
			Q3Beneficiary:        setting.Q3Beneficiary,
			RegimeIndependent:    setting.RegimeIndependent,
			Q3Rating:             setting.Q3Rating,
			Q3Logic:              setting.Q3Logic,
		})
		allocatedPct += targetPct
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].DisplayOrder != items[j].DisplayOrder {
			return items[i].DisplayOrder < items[j].DisplayOrder
		}
		return items[i].AssetClass < items[j].AssetClass
	})

	allocatedValue := 0.0
	if regimeCashValue > 0 && allocatedPct > 0 {
		allocatedValue = (allocatedPct / 100) * regimeCashValue
	}
	remainingPct := 100 - allocatedPct
	remainingValue := regimeCashValue - allocatedValue

	regimeCashPct := 0.0
	if ctx.StatementTotalValue > 0 {
		regimeCashPct = (regimeCashValue / ctx.StatementTotalValue) * 100
	}

	return &PortfolioOverlayStage2Workflow{
		Mode:            mode,
		PlaybookLabel:   "Redistribute Regime Cash",
		EventStatus:     event.Status,
		RegimeCashValue: regimeCashValue,
		RegimeCashPct:   regimeCashPct,
		AllocatedPct:    allocatedPct,
		AllocatedValue:  allocatedValue,
		RemainingPct:    remainingPct,
		RemainingValue:  remainingValue,
		Items:           items,
	}
}

func createOverlayEventFromContext(ctx *overlayPortfolioContext, fromSignal, toSignal float64, governingSource string) (*OverlayEvent, map[string]OverlayEventClass, error) {
	if fromSignal <= 0 {
		fromSignal = 100
	}
	adjustmentRatio := toSignal / fromSignal

	if existingEvent, existingClasses, err := getOpenOverlayEventForTransition(fromSignal, toSignal, governingSource); err != nil {
		return nil, nil, err
	} else if existingEvent != nil {
		return existingEvent, existingClasses, nil
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`
		INSERT INTO overlay_events (status, from_q1_exposure_pct, to_q1_exposure_pct, adjustment_ratio, governing_source)
		VALUES ('PENDING', ?, ?, ?, ?)
	`, fromSignal, toSignal, adjustmentRatio, governingSource)
	if err != nil {
		return nil, nil, err
	}

	eventID, err := result.LastInsertId()
	if err != nil {
		return nil, nil, err
	}

	eventClasses := map[string]OverlayEventClass{}
	for assetClass := range ctx.AssetClassKeys {
		eventClass, ok := buildOverlayEventClass(ctx, assetClass, fromSignal, toSignal, governingSource)
		if !ok {
			continue
		}
		if err := insertOverlayEventClass(tx, eventID, eventClass); err != nil {
			return nil, nil, err
		}
		eventClasses[eventClass.AssetClass] = eventClass
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	event, _, err := getActivePendingOverlayEvent()
	if err != nil {
		return nil, nil, err
	}
	return event, eventClasses, nil
}

func buildOverlayEventClass(ctx *overlayPortfolioContext, assetClass string, fromSignal, toSignal float64, governingSource string) (OverlayEventClass, bool) {
	if ctx == nil {
		return OverlayEventClass{}, false
	}
	if fromSignal <= 0 {
		fromSignal = 100
	}
	summary := ctx.ClassSummaries[assetClass]
	if summary == nil {
		return OverlayEventClass{}, false
	}
	if summary.ActualInvestedValue <= 0 && summary.TacticalCashValue <= 0 {
		return OverlayEventClass{}, false
	}

	setting := getOverlayAssetClassSetting(assetClass)
	liquidityFactor := q3ThrottleFactorForSetting(setting)
	if strings.EqualFold(strings.TrimSpace(governingSource), "Q4D") {
		liquidityFactor = q4dLiquidityFactorForSetting(setting)
	}
	adjustmentRatio := toSignal / fromSignal
	targetInvestedValue := summary.ActualInvestedValue
	if adjustmentRatio < 1 {
		cutRatio := clampFloat(1-adjustmentRatio, 0, 1) * liquidityFactor
		targetInvestedValue = summary.ActualInvestedValue * (1 - cutRatio)
	} else if adjustmentRatio > 1 {
		addRatio := (adjustmentRatio - 1) * liquidityFactor
		targetInvestedValue = summary.ActualInvestedValue * (1 + addRatio)
	}
	if targetInvestedValue < 0 {
		targetInvestedValue = 0
	}

	triggerInvestedPct := 0.0
	targetInvestedPct := 0.0
	if ctx.StatementTotalValue > 0 {
		triggerInvestedPct = (summary.ActualInvestedValue / ctx.StatementTotalValue) * 100
		targetInvestedPct = (targetInvestedValue / ctx.StatementTotalValue) * 100
	}

	return OverlayEventClass{
		AssetClass:               assetClass,
		OverlayEligible:          summary.OverlayEligible,
		TriggerInvestedValue:     summary.ActualInvestedValue,
		TriggerInvestedPct:       triggerInvestedPct,
		TriggerTacticalCashValue: summary.TacticalCashValue,
		TriggerTotalClassValue:   summary.TotalClassCapitalValue,
		TargetInvestedValue:      targetInvestedValue,
		TargetInvestedPct:        targetInvestedPct,
		Q3SellPriority:           setting.Q3SellPriority,
	}, true
}

func insertOverlayEventClass(tx *sql.Tx, eventID int64, eventClass OverlayEventClass) error {
	_, err := tx.Exec(`
		INSERT INTO overlay_event_classes (
			event_id, asset_class, overlay_eligible, trigger_invested_value, trigger_invested_pct,
			trigger_tactical_cash_value, trigger_total_class_capital_value, target_invested_value, target_invested_pct,
			q3_sell_priority, stage2_target_pct
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, eventID, eventClass.AssetClass, eventClass.OverlayEligible, eventClass.TriggerInvestedValue, eventClass.TriggerInvestedPct,
		eventClass.TriggerTacticalCashValue, eventClass.TriggerTotalClassValue, eventClass.TargetInvestedValue, eventClass.TargetInvestedPct,
		eventClass.Q3SellPriority, eventClass.Stage2TargetPct)
	return err
}

func targetOverlayEventClassFromTrigger(eventClass OverlayEventClass, setting OverlayAssetClassSetting, fromSignal, toSignal float64, governingSource string, statementTotalValue float64) OverlayEventClass {
	if fromSignal <= 0 {
		fromSignal = 100
	}
	liquidityFactor := q3ThrottleFactorForSetting(setting)
	if strings.EqualFold(strings.TrimSpace(governingSource), "Q4D") {
		liquidityFactor = q4dLiquidityFactorForSetting(setting)
	}
	adjustmentRatio := toSignal / fromSignal
	targetInvestedValue := eventClass.TriggerInvestedValue
	if adjustmentRatio < 1 {
		cutRatio := clampFloat(1-adjustmentRatio, 0, 1) * liquidityFactor
		targetInvestedValue = eventClass.TriggerInvestedValue * (1 - cutRatio)
	} else if adjustmentRatio > 1 {
		addRatio := (adjustmentRatio - 1) * liquidityFactor
		targetInvestedValue = eventClass.TriggerInvestedValue * (1 + addRatio)
	}
	if targetInvestedValue < 0 {
		targetInvestedValue = 0
	}

	targetInvestedPct := 0.0
	if statementTotalValue > 0 {
		targetInvestedPct = (targetInvestedValue / statementTotalValue) * 100
	} else if eventClass.TriggerInvestedValue > 0 {
		targetInvestedPct = eventClass.TriggerInvestedPct * (targetInvestedValue / eventClass.TriggerInvestedValue)
	}

	eventClass.OverlayEligible = setting.OverlayEligible
	eventClass.TargetInvestedValue = targetInvestedValue
	eventClass.TargetInvestedPct = targetInvestedPct
	eventClass.Q3SellPriority = setting.Q3SellPriority
	return eventClass
}

func overlayEventClassNeedsRepair(existing, repaired OverlayEventClass) bool {
	if existing.OverlayEligible != repaired.OverlayEligible {
		return true
	}
	if math.Abs(existing.TargetInvestedValue-repaired.TargetInvestedValue) > 0.01 {
		return true
	}
	if math.Abs(existing.TargetInvestedPct-repaired.TargetInvestedPct) > 0.0001 {
		return true
	}
	if (existing.Q3SellPriority == nil) != (repaired.Q3SellPriority == nil) {
		return true
	}
	if existing.Q3SellPriority != nil && repaired.Q3SellPriority != nil && *existing.Q3SellPriority != *repaired.Q3SellPriority {
		return true
	}
	return false
}

func updateOverlayEventClassTarget(tx *sql.Tx, eventID int64, eventClass OverlayEventClass) error {
	_, err := tx.Exec(`
		UPDATE overlay_event_classes
		SET overlay_eligible = ?, target_invested_value = ?, target_invested_pct = ?, q3_sell_priority = ?
		WHERE event_id = ? AND asset_class = ?
	`, eventClass.OverlayEligible, eventClass.TargetInvestedValue, eventClass.TargetInvestedPct, eventClass.Q3SellPriority, eventID, eventClass.AssetClass)
	return err
}

func ensurePendingOverlayEventClasses(ctx *overlayPortfolioContext, event *OverlayEvent, eventClasses map[string]OverlayEventClass) (map[string]OverlayEventClass, error) {
	if ctx == nil || event == nil {
		return eventClasses, nil
	}
	if event.Status != "PENDING" || event.Stage1AppliedAt != nil || event.Stage1RecordedReductionValue > 0 {
		return eventClasses, nil
	}
	if eventClasses == nil {
		eventClasses = map[string]OverlayEventClass{}
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	reconciled := map[string]OverlayEventClass{}
	for assetClass := range ctx.AssetClassKeys {
		if existing, ok := eventClasses[assetClass]; ok {
			setting := getOverlayAssetClassSetting(assetClass)
			repaired := targetOverlayEventClassFromTrigger(existing, setting, event.FromQ1ExposurePct, event.ToQ1ExposurePct, event.GoverningSource, ctx.StatementTotalValue)
			if overlayEventClassNeedsRepair(existing, repaired) {
				if err := updateOverlayEventClassTarget(tx, event.ID, repaired); err != nil {
					return nil, err
				}
			}
			reconciled[assetClass] = repaired
			continue
		}

		eventClass, ok := buildOverlayEventClass(ctx, assetClass, event.FromQ1ExposurePct, event.ToQ1ExposurePct, event.GoverningSource)
		if !ok {
			continue
		}
		if err := insertOverlayEventClass(tx, event.ID, eventClass); err != nil {
			return nil, err
		}
		reconciled[eventClass.AssetClass] = eventClass
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return reconciled, nil
}

func getOpenOverlayEventForTransition(fromSignal, toSignal float64, governingSource string) (*OverlayEvent, map[string]OverlayEventClass, error) {
	row := db.QueryRow(`
		SELECT id, status, from_q1_exposure_pct, to_q1_exposure_pct, adjustment_ratio, governing_source, triggered_at,
		       stage1_applied_at, stage1_required_reduction_value, stage1_recorded_reduction_value,
		       stage1_baseline_reserve_value, stage1_expected_reserve_value, stage1_import_baseline_at,
		       reserve_confirmed_at, reserve_confirmed_value, reserve_variance, COALESCE(cash_confirmation_status, ''),
		       stage2_completed_at, baseline_accepted_at
		FROM overlay_events
		WHERE status IN ('PENDING', 'PARTIAL')
		  AND ABS(from_q1_exposure_pct - ?) <= 0.0001
		  AND ABS(to_q1_exposure_pct - ?) <= 0.0001
		  AND UPPER(COALESCE(governing_source, '')) = UPPER(?)
		ORDER BY triggered_at DESC, id DESC
		LIMIT 1
	`, fromSignal, toSignal, strings.TrimSpace(governingSource))

	var event OverlayEvent
	var stage1AppliedAt sql.NullTime
	var stage1ImportBaselineAt sql.NullTime
	var reserveConfirmedAt sql.NullTime
	var reserveConfirmedValue sql.NullFloat64
	var reserveVariance sql.NullFloat64
	var stage2CompletedAt sql.NullTime
	var baselineAcceptedAt sql.NullTime
	if err := row.Scan(
		&event.ID,
		&event.Status,
		&event.FromQ1ExposurePct,
		&event.ToQ1ExposurePct,
		&event.AdjustmentRatio,
		&event.GoverningSource,
		&event.TriggeredAt,
		&stage1AppliedAt,
		&event.Stage1RequiredReductionValue,
		&event.Stage1RecordedReductionValue,
		&event.Stage1BaselineReserveValue,
		&event.Stage1ExpectedReserveValue,
		&stage1ImportBaselineAt,
		&reserveConfirmedAt,
		&reserveConfirmedValue,
		&reserveVariance,
		&event.CashConfirmationStatus,
		&stage2CompletedAt,
		&baselineAcceptedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, map[string]OverlayEventClass{}, nil
		}
		return nil, nil, err
	}

	if stage1AppliedAt.Valid {
		event.Stage1AppliedAt = &stage1AppliedAt.Time
	}
	if stage1ImportBaselineAt.Valid {
		event.Stage1ImportBaselineAt = &stage1ImportBaselineAt.Time
	}
	if reserveConfirmedAt.Valid {
		event.ReserveConfirmedAt = &reserveConfirmedAt.Time
	}
	if reserveConfirmedValue.Valid {
		value := reserveConfirmedValue.Float64
		event.ReserveConfirmedValue = &value
	}
	if reserveVariance.Valid {
		value := reserveVariance.Float64
		event.ReserveVariance = &value
	}
	if stage2CompletedAt.Valid {
		event.Stage2CompletedAt = &stage2CompletedAt.Time
	}
	if baselineAcceptedAt.Valid {
		event.BaselineAcceptedAt = &baselineAcceptedAt.Time
	}

	classes, err := loadOverlayEventClasses(event.ID)
	if err != nil {
		return nil, nil, err
	}
	return &event, classes, nil
}

func syncOverlaySignalStateAndEvent(reqCtx context.Context, spyPct, xaoPct, currentPct float64, governingSource string) (OverlaySignalState, *OverlayEvent, map[string]OverlayEventClass, error) {
	if reqCtx == nil {
		reqCtx = context.Background()
	}

	state, _, err := loadOrInitOverlaySignalState(spyPct, xaoPct, currentPct, governingSource)
	if err != nil {
		return OverlaySignalState{}, nil, nil, err
	}

	if currentPct < 0 {
		return state, nil, map[string]OverlayEventClass{}, nil
	}

	now := time.Now()
	signalChanged := math.Abs(state.CurrentQ1ExposurePct-currentPct) > 0.0001
	if signalChanged {
		if _, err := db.ExecContext(reqCtx, `
			UPDATE overlay_signal_state
			SET current_q1_exposure_pct = ?, spy_q1_exposure_pct = ?, xao_q1_exposure_pct = ?, governing_source = ?, last_signal_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
			WHERE id = 1
		`, currentPct, spyPct, xaoPct, governingSource); err != nil {
			return OverlaySignalState{}, nil, nil, err
		}
		state.CurrentQ1ExposurePct = currentPct
		state.SpyQ1ExposurePct = spyPct
		state.XaoQ1ExposurePct = xaoPct
		state.GoverningSource = governingSource
		state.LastSignalChangedAt = &now
	} else {
		if _, err := db.ExecContext(reqCtx, `
			UPDATE overlay_signal_state
			SET spy_q1_exposure_pct = ?, xao_q1_exposure_pct = ?, governing_source = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = 1
		`, spyPct, xaoPct, governingSource); err != nil {
			return OverlaySignalState{}, nil, nil, err
		}
		state.SpyQ1ExposurePct = spyPct
		state.XaoQ1ExposurePct = xaoPct
		state.GoverningSource = governingSource
	}

	activeEvent, eventClasses, err := getActivePendingOverlayEvent()
	if err != nil {
		return OverlaySignalState{}, nil, nil, err
	}

	if math.Abs(state.CurrentQ1ExposurePct-state.LastAppliedQ1ExposurePct) <= 0.0001 {
		if activeEvent != nil {
			if err := closePendingOverlayEvents("CANCELLED"); err != nil {
				return OverlaySignalState{}, nil, nil, err
			}
		}
		return state, nil, map[string]OverlayEventClass{}, nil
	}

	if activeEvent != nil &&
		math.Abs(activeEvent.FromQ1ExposurePct-state.LastAppliedQ1ExposurePct) <= 0.0001 &&
		math.Abs(activeEvent.ToQ1ExposurePct-state.CurrentQ1ExposurePct) <= 0.0001 &&
		!strings.EqualFold(strings.TrimSpace(governingSource), "Q4D") {
		return state, activeEvent, eventClasses, nil
	}

	eventFromPct := state.LastAppliedQ1ExposurePct
	eventToPct := state.CurrentQ1ExposurePct
	if strings.EqualFold(strings.TrimSpace(governingSource), "Q4D") {
		eventFromPct = 100
		eventToPct = q4CrisisTargetEquityPct
		if activeEvent != nil &&
			math.Abs(activeEvent.FromQ1ExposurePct-eventFromPct) <= 0.0001 &&
			math.Abs(activeEvent.ToQ1ExposurePct-eventToPct) <= 0.0001 &&
			strings.EqualFold(strings.TrimSpace(activeEvent.GoverningSource), "Q4D") {
			return state, activeEvent, eventClasses, nil
		}
	}

	if activeEvent != nil {
		if err := closePendingOverlayEvents("SUPERSEDED"); err != nil {
			return OverlaySignalState{}, nil, nil, err
		}
	}

	portfolioCtx, err := buildOverlayPortfolioContext(reqCtx)
	if err != nil {
		if err == sql.ErrNoRows {
			return state, nil, map[string]OverlayEventClass{}, nil
		}
		return OverlaySignalState{}, nil, nil, err
	}

	event, classes, err := createOverlayEventFromContext(portfolioCtx, eventFromPct, eventToPct, governingSource)
	if err != nil {
		return OverlaySignalState{}, nil, nil, err
	}

	return state, event, classes, nil
}

// syncPortfolioOverlayHandler is the explicit version of the signal-state
// reconciliation that GET /api/portfolio-overlay-summary used to perform
// implicitly on every poll. It updates overlay_signal_state from the current
// equity-sizing inputs and creates/cancels/supersedes overlay events as
// needed. Normal operation does not require calling it — every signal path
// (Q3/Q4 webhooks, stage handlers, settings changes) already syncs — but it
// is the recovery lever if state ever drifts.
