package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

func syncPortfolioOverlayHandler(w http.ResponseWriter, r *http.Request) {
	overlaySummaryMu.Lock()
	defer overlaySummaryMu.Unlock()

	spyPct, xaoPct, effectivePct, governingSource, _, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}
	signalState, activeEvent, _, err := syncOverlaySignalStateAndEvent(r.Context(), spyPct, xaoPct, effectivePct, governingSource)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"status":                       "synced",
		"effective_pct":                effectivePct,
		"governing_source":             governingSource,
		"current_q1_exposure_pct":      signalState.CurrentQ1ExposurePct,
		"last_applied_q1_exposure_pct": signalState.LastAppliedQ1ExposurePct,
	}
	if activeEvent != nil {
		response["pending_event_id"] = activeEvent.ID
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getPortfolioOverlaySummary(w http.ResponseWriter, r *http.Request) {
	overlaySummaryMu.Lock()
	defer overlaySummaryMu.Unlock()

	settings := getOverlayAssetClassSettings()
	q4Crisis, q4Err := getQ4CrisisState(r.Context())
	if q4Err != nil {
		http.Error(w, q4Err.Error(), http.StatusInternalServerError)
		return
	}
	spyPct, xaoPct, effectivePct, governingSource, spSource, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}
	portfolioRisk := buildPortfolioRiskState(spyPct, xaoPct, spSource, q4Crisis)

	ctx, err := buildOverlayPortfolioContext(r.Context())
	if err == sql.ErrNoRows {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(PortfolioOverlaySummary{
			EffectiveEquityPct: effectivePct,
			OverlayMultiplier:  0,
			SPXTargetPct:       spyPct,
			SpyTargetPct:       spyPct,
			XaoTargetPct:       xaoPct,
			GoverningSource:    governingSource,
			OverlayStatus:      "NO_DATA",
			Q4Crisis:           q4Crisis,
			PortfolioRisk:      portfolioRisk,
			Settings:           settings,
		})
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	overlayMultiplier := 0.0
	if effectivePct > 0 {
		overlayMultiplier = effectivePct / 100
	}

	// Read-only: polling this endpoint must never create, cancel, or
	// supersede workflow rows (audit §7 / PLAN.md 2.2). Signal-state sync
	// happens at signal time (webhooks, stage handlers) or via the explicit
	// POST /api/portfolio-overlay/sync.
	signalState, err := loadOverlaySignalStateReadOnly(spyPct, xaoPct, effectivePct, governingSource)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	workflowEvent, eventClasses, err := getLatestOverlayWorkflowEvent()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	reconcileOverlayStage1CashConfirmation(workflowEvent, ctx)
	eventClasses, err = ensurePendingOverlayEventClasses(ctx, workflowEvent, eventClasses)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resolveStrategicWeight := func(summary *PortfolioOverlayAssetClassSummary) (float64, string) {
		if strategicWeight := ctx.StrategicWeightByClass[summary.AssetClass]; strategicWeight > 0 {
			return strategicWeight, "analysis_allocation_sum"
		}
		classCapitalValue := summary.ActualInvestedValue + summary.TacticalCashValue
		if ctx.StatementTotalValue > 0 && classCapitalValue > 0 {
			return (classCapitalValue / ctx.StatementTotalValue) * 100, "current_capital_fallback"
		}
		return 0, "unset"
	}

	assetClassKeys := map[string]struct{}{}
	for assetClass := range ctx.AssetClassKeys {
		assetClassKeys[assetClass] = struct{}{}
	}

	getClassSummary := func(assetClass string) *PortfolioOverlayAssetClassSummary {
		assetClass = choosePrimaryAssetClass([]string{assetClass})
		if existing, ok := ctx.ClassSummaries[assetClass]; ok {
			return existing
		}
		setting := getOverlayAssetClassSetting(assetClass)
		summary := &PortfolioOverlayAssetClassSummary{
			AssetClass:         setting.Key,
			DisplayName:        setting.DisplayName,
			OverlayEligible:    setting.OverlayEligible,
			DisplayOrder:       setting.DisplayOrder,
			Q3ThrottleFactor:   float64Ptr(q3ThrottleFactorForSetting(setting)),
			Q4DLiquidityFactor: float64Ptr(q4dLiquidityFactorForSetting(setting)),
			SellCandidates:     []PortfolioOverlaySellCandidate{},
		}
		ctx.ClassSummaries[assetClass] = summary
		return summary
	}

	summaries := make([]PortfolioOverlayAssetClassSummary, 0, len(assetClassKeys))
	actualEligibleInvestedPct := 0.0
	allowedEligibleInvestedPct := 0.0
	actualEligibleInvestedValue := 0.0
	allowedEligibleInvestedValue := 0.0
	requiredDeRiskPct := 0.0
	requiredDeRiskValue := 0.0
	availableHeadroomPct := 0.0
	availableHeadroomValue := 0.0
	isQ4DWorkflow := workflowEvent != nil && strings.EqualFold(strings.TrimSpace(workflowEvent.GoverningSource), "Q4D")

	for assetClass := range assetClassKeys {
		summary := getClassSummary(assetClass)
		setting := getOverlayAssetClassSetting(assetClass)
		strategicWeight, strategicSource := resolveStrategicWeight(summary)
		summary.StrategicWeightPct = strategicWeight
		summary.StrategicWeightSource = strategicSource
		q3ThrottleFactor := q3ThrottleFactorForSetting(setting)
		q4dLiquidityFactor := q4dLiquidityFactorForSetting(setting)
		actionFactor := q3ThrottleFactor
		if isQ4DWorkflow {
			actionFactor = q4dLiquidityFactor
		}
		summary.Q3ThrottleFactor = float64Ptr(q3ThrottleFactor)
		summary.Q4DLiquidityFactor = float64Ptr(q4dLiquidityFactor)
		summary.TotalClassCapitalValue = summary.ActualInvestedValue + summary.TacticalCashValue
		if ctx.StatementTotalValue > 0 {
			summary.ActualInvestedPct = (summary.ActualInvestedValue / ctx.StatementTotalValue) * 100
			summary.TacticalCashPct = (summary.TacticalCashValue / ctx.StatementTotalValue) * 100
			summary.TotalClassCapitalPct = (summary.TotalClassCapitalValue / ctx.StatementTotalValue) * 100
		}

		if eventClass, ok := eventClasses[assetClass]; ok && actionFactor > 0 {
			summary.TriggerInvestedValue = eventClass.TriggerInvestedValue
			summary.TriggerInvestedPct = eventClass.TriggerInvestedPct
			summary.TriggerTacticalCashValue = eventClass.TriggerTacticalCashValue
			if ctx.StatementTotalValue > 0 {
				summary.TriggerTacticalCashPct = (eventClass.TriggerTacticalCashValue / ctx.StatementTotalValue) * 100
				summary.TriggerTotalClassPct = (eventClass.TriggerTotalClassValue / ctx.StatementTotalValue) * 100
			}
			summary.TriggerTotalClassValue = eventClass.TriggerTotalClassValue
			summary.AllowedInvestedValue = eventClass.TargetInvestedValue
			summary.AllowedInvestedPct = eventClass.TargetInvestedPct
			summary.Stage1RecordedReduction = eventClass.Stage1RecordedReduction
		} else {
			summary.TriggerInvestedValue = summary.ActualInvestedValue
			summary.TriggerInvestedPct = summary.ActualInvestedPct
			summary.TriggerTacticalCashValue = summary.TacticalCashValue
			summary.TriggerTacticalCashPct = summary.TacticalCashPct
			summary.TriggerTotalClassValue = summary.TotalClassCapitalValue
			summary.TriggerTotalClassPct = summary.TotalClassCapitalPct
			summary.AllowedInvestedValue = summary.ActualInvestedValue
			if ctx.StatementTotalValue > 0 {
				summary.AllowedInvestedPct = (summary.AllowedInvestedValue / ctx.StatementTotalValue) * 100
			}
		}
		summary.DeltaValue = summary.ActualInvestedValue - summary.AllowedInvestedValue
		summary.DeltaPct = summary.ActualInvestedPct - summary.AllowedInvestedPct
		summary.Q3SellPriority = setting.Q3SellPriority
		stage2TargetPct := setting.Stage2TargetPct
		if eventClass, ok := eventClasses[assetClass]; ok && eventClass.Stage2TargetPct != nil {
			stage2TargetPct = eventClass.Stage2TargetPct
		}
		summary.Stage2TargetPct = stage2TargetPct
		if stage2TargetPct != nil {
			stage2Value := (*stage2TargetPct / 100) * ctx.StatementTotalValue
			summary.Stage2TargetValue = &stage2Value
		}

		if actionFactor > 0 {
			actualEligibleInvestedPct += summary.ActualInvestedPct
			allowedEligibleInvestedPct += summary.AllowedInvestedPct
			actualEligibleInvestedValue += summary.ActualInvestedValue
			allowedEligibleInvestedValue += summary.AllowedInvestedValue
			if summary.DeltaValue > 0 {
				requiredDeRiskValue += summary.DeltaValue
				requiredDeRiskPct += summary.DeltaPct
			} else if summary.DeltaValue < 0 {
				availableHeadroomValue += -summary.DeltaValue
				availableHeadroomPct += -summary.DeltaPct
			}
		}

		summaries = append(summaries, *summary)
	}

	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].DisplayOrder != summaries[j].DisplayOrder {
			return summaries[i].DisplayOrder < summaries[j].DisplayOrder
		}
		return summaries[i].AssetClass < summaries[j].AssetClass
	})

	portfolioCashBucketPct := 0.0
	totalTacticalCashPct := 0.0
	if ctx.StatementTotalValue > 0 {
		portfolioCashBucketPct = (ctx.PortfolioCashBucketValue / ctx.StatementTotalValue) * 100
		totalTacticalCashPct = (ctx.TotalTacticalCashValue / ctx.StatementTotalValue) * 100
	}

	overlayStatus := "ONSIDE"
	switch {
	case effectivePct < 0:
		overlayStatus = "NO_DATA"
	case workflowEvent != nil && requiredDeRiskValue > 1:
		overlayStatus = "REDUCE"
	case workflowEvent != nil && availableHeadroomValue > 1:
		overlayStatus = "HEADROOM_AVAILABLE"
	}

	strategicWeightSource := "analysis_allocation_sum"
	if len(ctx.StrategicWeightByClass) == 0 {
		strategicWeightSource = "current_capital_fallback"
	}

	var activeEventID *int64
	var activeEventStatus string
	var activeEventGoverningSource string
	var activeEventTriggeredAt *time.Time
	var activeEventFromQ1ExposurePct *float64
	var activeEventToQ1ExposurePct *float64
	var activeEventStage1AppliedAt *time.Time
	var activeEventStage2CompletedAt *time.Time
	var stage1RequiredReductionValue float64
	var stage1RecordedReductionValue float64
	var stage1BaselineReserveValue float64
	var stage1ExpectedReserveValue float64
	var stage1ImportBaselineAt *time.Time
	var reserveConfirmedAt *time.Time
	var reserveConfirmedValue *float64
	var reserveVariance *float64
	var cashConfirmationStatus string
	if workflowEvent != nil {
		activeEventID = &workflowEvent.ID
		activeEventStatus = workflowEvent.Status
		activeEventGoverningSource = workflowEvent.GoverningSource
		activeEventTriggeredAt = &workflowEvent.TriggeredAt
		activeEventFromQ1ExposurePct = &workflowEvent.FromQ1ExposurePct
		activeEventToQ1ExposurePct = &workflowEvent.ToQ1ExposurePct
		activeEventStage1AppliedAt = workflowEvent.Stage1AppliedAt
		activeEventStage2CompletedAt = workflowEvent.Stage2CompletedAt
		stage1RequiredReductionValue = workflowEvent.Stage1RequiredReductionValue
		stage1RecordedReductionValue = workflowEvent.Stage1RecordedReductionValue
		stage1BaselineReserveValue = workflowEvent.Stage1BaselineReserveValue
		stage1ExpectedReserveValue = workflowEvent.Stage1ExpectedReserveValue
		stage1ImportBaselineAt = workflowEvent.Stage1ImportBaselineAt
		reserveConfirmedAt = workflowEvent.ReserveConfirmedAt
		reserveConfirmedValue = workflowEvent.ReserveConfirmedValue
		reserveVariance = workflowEvent.ReserveVariance
		cashConfirmationStatus = workflowEvent.CashConfirmationStatus
	}

	signalAdjustmentRatio := 1.0
	if workflowEvent != nil && workflowEvent.AdjustmentRatio > 0 {
		signalAdjustmentRatio = workflowEvent.AdjustmentRatio
	} else if signalState.LastAppliedQ1ExposurePct > 0 && effectivePct >= 0 {
		signalAdjustmentRatio = effectivePct / signalState.LastAppliedQ1ExposurePct
	}

	stage2Workflow := buildOverlayStage2Workflow(ctx, workflowEvent, eventClasses)
	canApplyStage1 := workflowEvent != nil && (workflowEvent.Status == "PENDING" || workflowEvent.Status == "PARTIAL")
	canCompleteStage2 := workflowEvent != nil && workflowEvent.Status == "STAGE1_DONE" && workflowEvent.CashConfirmationStatus == "CONFIRMED"
	canAcceptBaseline := workflowEvent != nil && workflowEvent.Status == "STAGE2_DONE"

	summary := PortfolioOverlaySummary{
		EffectiveEquityPct:           effectivePct,
		OverlayMultiplier:            overlayMultiplier,
		SPXTargetPct:                 spyPct,
		SpyTargetPct:                 spyPct,
		XaoTargetPct:                 xaoPct,
		GoverningSource:              governingSource,
		StrategicWeightSource:        strategicWeightSource,
		OverlayStatus:                overlayStatus,
		PortfolioValue:               ctx.StatementTotalValue,
		PortfolioCashBucketValue:     ctx.PortfolioCashBucketValue,
		PortfolioCashBucketPct:       portfolioCashBucketPct,
		ActualEligibleInvestedPct:    actualEligibleInvestedPct,
		ActualEligibleInvestedValue:  actualEligibleInvestedValue,
		AllowedEligibleInvestedPct:   allowedEligibleInvestedPct,
		AllowedEligibleInvestedValue: allowedEligibleInvestedValue,
		RequiredDeRiskPct:            requiredDeRiskPct,
		RequiredDeRiskValue:          requiredDeRiskValue,
		AvailableHeadroomPct:         availableHeadroomPct,
		AvailableHeadroomValue:       availableHeadroomValue,
		TotalTacticalCashValue:       ctx.TotalTacticalCashValue,
		TotalTacticalCashPct:         totalTacticalCashPct,
		LastAppliedQ1ExposurePct:     signalState.LastAppliedQ1ExposurePct,
		SignalAdjustmentRatio:        signalAdjustmentRatio,
		ActiveEventID:                activeEventID,
		ActiveEventStatus:            activeEventStatus,
		ActiveEventGoverningSource:   activeEventGoverningSource,
		ActiveEventTriggeredAt:       activeEventTriggeredAt,
		ActiveEventFromQ1ExposurePct: activeEventFromQ1ExposurePct,
		ActiveEventToQ1ExposurePct:   activeEventToQ1ExposurePct,
		ActiveEventStage1AppliedAt:   activeEventStage1AppliedAt,
		Stage1RequiredReductionValue: stage1RequiredReductionValue,
		Stage1RecordedReductionValue: stage1RecordedReductionValue,
		Stage1BaselineReserveValue:   stage1BaselineReserveValue,
		Stage1ExpectedReserveValue:   stage1ExpectedReserveValue,
		Stage1ImportBaselineAt:       stage1ImportBaselineAt,
		ReserveConfirmedAt:           reserveConfirmedAt,
		ReserveConfirmedValue:        reserveConfirmedValue,
		ReserveVariance:              reserveVariance,
		CashConfirmationStatus:       cashConfirmationStatus,
		ActiveEventStage2CompletedAt: activeEventStage2CompletedAt,
		CanApplyStage1:               canApplyStage1,
		CanCompleteStage2:            canCompleteStage2,
		CanAcceptBaseline:            canAcceptBaseline,
		LastSignalChangedAt:          signalState.LastSignalChangedAt,
		LastAppliedAt:                signalState.LastAppliedAt,
		UsingStage1Snapshot:          false,
		Stage2Workflow:               stage2Workflow,
		Q4Crisis:                     q4Crisis,
		PortfolioRisk:                portfolioRisk,
		AssetClasses:                 summaries,
		Settings:                     settings,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}

func reconciliationStatus(variance, tolerance float64, importReceived bool) string {
	if !importReceived {
		return "AWAITING_IMPORT"
	}
	if math.Abs(variance) <= tolerance {
		return "MATCHED"
	}
	return "VARIANCE"
}

func getPortfolioOverlayReconciliation(w http.ResponseWriter, r *http.Request) {
	event, eventClasses, err := getLatestOverlayWorkflowEvent()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "No active overlay event", http.StatusNotFound)
		return
	}

	ctx, ctxErr := buildOverlayPortfolioContext(r.Context())
	if ctxErr != nil && ctxErr != sql.ErrNoRows {
		http.Error(w, ctxErr.Error(), http.StatusInternalServerError)
		return
	}
	if ctx != nil {
		reconcileOverlayStage1CashConfirmation(event, ctx)
	}

	latestImportAt := time.Time{}
	if ctx != nil {
		latestImportAt = latestOverlayImportTime(ctx)
	}
	importReceived := event.Stage1AppliedAt != nil && !latestImportAt.IsZero() && latestImportAt.After(*event.Stage1AppliedAt)
	var latestImportPtr *string
	if !latestImportAt.IsZero() {
		value := latestImportAt.Format(time.RFC3339)
		latestImportPtr = &value
	}
	var appliedAtPtr *string
	if event.Stage1AppliedAt != nil {
		value := event.Stage1AppliedAt.Format(time.RFC3339)
		appliedAtPtr = &value
	}
	var confirmedAtPtr *string
	if event.ReserveConfirmedAt != nil {
		value := event.ReserveConfirmedAt.Format(time.RFC3339)
		confirmedAtPtr = &value
	}

	importedReserve := 0.0
	if ctx != nil {
		importedReserve = ctx.PortfolioCashBucketValue
	}
	cashVariance := importedReserve - event.Stage1ExpectedReserveValue
	if event.ReserveVariance != nil {
		cashVariance = *event.ReserveVariance
	}
	cashTolerance := math.Max(25, math.Abs(event.Stage1ExpectedReserveValue)*0.005)
	cashStatus := event.CashConfirmationStatus
	if cashStatus == "" {
		cashStatus = reconciliationStatus(cashVariance, cashTolerance, importReceived)
	}

	holdingValueByID := map[int64]float64{}
	holdingValueByName := map[string]float64{}
	rows, err := db.QueryContext(r.Context(), `
		SELECT id, company_name, COALESCE(value_aud, market_value, 0)
		FROM holdings
		WHERE is_active = 1
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var id int64
		var name string
		var value float64
		if err := rows.Scan(&id, &name, &value); err != nil {
			rows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		holdingValueByID[id] = value
		holdingValueByName[canonicalCompanyNameKey(name)] = value
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	rows.Close()

	sourceRows, err := db.QueryContext(r.Context(), `
		SELECT id, holding_id, COALESCE(stock_name, ''), COALESCE(ticker, ''),
		       COALESCE(asset_class, ''), COALESCE(group_id, ''), COALESCE(group_label, ''),
		       COALESCE(amount_sold, 0), COALESCE(before_value, 0), COALESCE(expected_after_value, 0)
		FROM overlay_stage1_sources
		WHERE event_id = ?
		ORDER BY asset_class, amount_sold DESC, stock_name
	`, event.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer sourceRows.Close()

	sourceChecks := []PortfolioOverlaySourceReconciliation{}
	sourceStatus := "MATCHED"
	for sourceRows.Next() {
		var check PortfolioOverlaySourceReconciliation
		var holdingID sql.NullInt64
		if err := sourceRows.Scan(
			&check.ID,
			&holdingID,
			&check.StockName,
			&check.Ticker,
			&check.AssetClass,
			&check.GroupID,
			&check.GroupLabel,
			&check.ExpectedReduction,
			&check.BeforeValue,
			&check.ExpectedAfterValue,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if holdingID.Valid {
			value := holdingID.Int64
			check.HoldingID = &value
			check.ImportedValue = holdingValueByID[value]
		}
		if check.ImportedValue == 0 && check.StockName != "" {
			check.ImportedValue = holdingValueByName[canonicalCompanyNameKey(check.StockName)]
		}
		if check.BeforeValue <= 0 {
			if importReceived {
				check.BeforeValue = check.ImportedValue + check.ExpectedReduction
			} else {
				check.BeforeValue = check.ImportedValue
			}
		}
		if check.ExpectedAfterValue <= 0 {
			check.ExpectedAfterValue = math.Max(0, check.BeforeValue-check.ExpectedReduction)
		}
		check.ActualReduction = math.Max(0, check.BeforeValue-check.ImportedValue)
		check.Variance = check.ImportedValue - check.ExpectedAfterValue
		tolerance := math.Max(25, math.Abs(check.ExpectedReduction)*0.05)
		check.Status = reconciliationStatus(check.Variance, tolerance, importReceived)
		if check.Status == "VARIANCE" {
			sourceStatus = "VARIANCE"
		}
		if check.Status == "AWAITING_IMPORT" && sourceStatus != "VARIANCE" {
			sourceStatus = "AWAITING_IMPORT"
		}
		sourceChecks = append(sourceChecks, check)
	}
	if err := sourceRows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if len(sourceChecks) == 0 {
		sourceStatus = "NO_SOURCES"
	}

	importedClassValue := map[string]float64{}
	classDisplayName := map[string]string{}
	if ctx != nil {
		for assetClass, summary := range ctx.ClassSummaries {
			key := choosePrimaryAssetClass([]string{assetClass})
			importedClassValue[key] = summary.ActualInvestedValue
			classDisplayName[key] = summary.DisplayName
		}
	}

	classChecks := []PortfolioOverlayClassReconciliation{}
	classStatus := "MATCHED"
	classKeys := make([]string, 0, len(eventClasses))
	for assetClass := range eventClasses {
		classKeys = append(classKeys, assetClass)
	}
	sort.Strings(classKeys)
	for _, assetClass := range classKeys {
		eventClass := eventClasses[assetClass]
		beforeValue := eventClass.TriggerInvestedValue
		expectedAfterValue := eventClass.TargetInvestedValue
		expectedReduction := math.Max(0, beforeValue-expectedAfterValue)
		if eventClass.Stage1RecordedReduction > 0 {
			expectedReduction = eventClass.Stage1RecordedReduction
			expectedAfterValue = math.Max(0, beforeValue-expectedReduction)
		}
		importedValue := importedClassValue[assetClass]
		check := PortfolioOverlayClassReconciliation{
			AssetClass:         assetClass,
			DisplayName:        classDisplayName[assetClass],
			BeforeValue:        beforeValue,
			ExpectedReduction:  expectedReduction,
			ExpectedAfterValue: expectedAfterValue,
			ImportedValue:      importedValue,
			ActualReduction:    math.Max(0, beforeValue-importedValue),
			Variance:           importedValue - expectedAfterValue,
		}
		if check.DisplayName == "" {
			check.DisplayName = getOverlayAssetClassSetting(assetClass).DisplayName
		}
		tolerance := math.Max(25, math.Abs(expectedReduction)*0.05)
		check.Status = reconciliationStatus(check.Variance, tolerance, importReceived)
		if check.Status == "VARIANCE" {
			classStatus = "VARIANCE"
		}
		if check.Status == "AWAITING_IMPORT" && classStatus != "VARIANCE" {
			classStatus = "AWAITING_IMPORT"
		}
		classChecks = append(classChecks, check)
	}

	overallStatus := cashStatus
	if overallStatus == "CONFIRMED" {
		overallStatus = "MATCHED"
	}
	if sourceStatus == "VARIANCE" || classStatus == "VARIANCE" || cashStatus == "VARIANCE" {
		overallStatus = "VARIANCE"
	} else if !importReceived || cashStatus == "AWAITING_IMPORT" || sourceStatus == "AWAITING_IMPORT" || classStatus == "AWAITING_IMPORT" {
		overallStatus = "AWAITING_IMPORT"
	}
	if overallStatus == "MATCHED" && cashStatus == "CONFIRMED" {
		overallStatus = "CONFIRMED"
	}

	response := PortfolioOverlayReconciliation{
		EventID:          event.ID,
		EventStatus:      event.Status,
		CashConfirmation: cashStatus,
		Stage1AppliedAt:  appliedAtPtr,
		Cash: PortfolioOverlayCashReconciliation{
			BaselineReserveValue: event.Stage1BaselineReserveValue,
			ExpectedReserveValue: event.Stage1ExpectedReserveValue,
			ImportedReserveValue: importedReserve,
			ReserveVariance:      cashVariance,
			Status:               cashStatus,
			ConfirmedAt:          confirmedAtPtr,
			LatestImportAt:       latestImportPtr,
			Tolerance:            cashTolerance,
		},
		SourceChecks:     sourceChecks,
		AssetClassChecks: classChecks,
		SourceStatus:     sourceStatus,
		AssetClassStatus: classStatus,
		OverallStatus:    overallStatus,
		ImportReceived:   importReceived,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func applyPortfolioOverlayStage1(w http.ResponseWriter, r *http.Request) {
	spyPct, xaoPct, effectivePct, governingSource, _, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}
	signalState, activeEvent, eventClasses, err := syncOverlaySignalStateAndEvent(r.Context(), spyPct, xaoPct, effectivePct, governingSource)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var request ApplyStage1Request
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil && err != io.EOF {
			http.Error(w, "Invalid Stage 1 payload", http.StatusBadRequest)
			return
		}
	}
	if effectivePct < 0 {
		http.Error(w, "No active Q1 Exposure signal", http.StatusBadRequest)
		return
	}

	if math.Abs(signalState.CurrentQ1ExposurePct-signalState.LastAppliedQ1ExposurePct) <= 0.0001 && activeEvent == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":          "onside",
			"q1_exposure_pct": effectivePct,
		})
		return
	}

	ctx, ctxErr := buildOverlayPortfolioContext(r.Context())
	if ctxErr != nil && ctxErr != sql.ErrNoRows {
		http.Error(w, ctxErr.Error(), http.StatusInternalServerError)
		return
	}
	if ctx != nil {
		eventClasses, err = ensurePendingOverlayEventClasses(ctx, activeEvent, eventClasses)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if request.RecordedReductionValue <= 0 {
		for _, source := range request.Sources {
			if source.AmountSold > 0 {
				request.RecordedReductionValue += source.AmountSold
			}
		}
	}
	if request.RequiredReductionValue <= 0 {
		for _, cls := range eventClasses {
			delta := cls.TriggerInvestedValue - cls.TargetInvestedValue
			if delta > 0 {
				request.RequiredReductionValue += delta
			}
		}
	}
	if request.BaselineReserveValue <= 0 && ctx != nil {
		request.BaselineReserveValue = ctx.PortfolioCashBucketValue
	}
	if request.ExpectedReserveValue <= 0 {
		request.ExpectedReserveValue = request.BaselineReserveValue + request.RecordedReductionValue
	}
	if activeEvent != nil && request.RequiredReductionValue > 1 {
		tolerance := overlayStage1ReductionTolerance(request.RequiredReductionValue)
		switch {
		case request.RecordedReductionValue <= 0:
			http.Error(w, "Stage 1 requires recorded reductions before it can be applied", http.StatusBadRequest)
			return
		case request.RecordedReductionValue < request.RequiredReductionValue-tolerance:
			http.Error(w, "Stage 1 recorded reductions are below the required reduction", http.StatusBadRequest)
			return
		case request.RecordedReductionValue > request.RequiredReductionValue+tolerance:
			http.Error(w, "Stage 1 recorded reductions exceed the required reduction tolerance", http.StatusBadRequest)
			return
		}
	}

	importBaselineAt := time.Time{}
	if ctx != nil {
		importBaselineAt = latestOverlayImportTime(ctx)
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE overlay_signal_state
		SET last_applied_q1_exposure_pct = current_q1_exposure_pct,
		    last_applied_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if activeEvent != nil {
		if _, err := tx.Exec(`
			UPDATE overlay_events
			SET status = 'STAGE1_DONE',
			    stage1_applied_at = CURRENT_TIMESTAMP,
			    stage1_required_reduction_value = ?,
			    stage1_recorded_reduction_value = ?,
			    stage1_baseline_reserve_value = ?,
			    stage1_expected_reserve_value = ?,
			    stage1_import_baseline_at = ?,
			    cash_confirmation_status = 'AWAITING_IMPORT'
			WHERE id = ?
		`, request.RequiredReductionValue, request.RecordedReductionValue, request.BaselineReserveValue, request.ExpectedReserveValue, nullableTime(importBaselineAt), activeEvent.ID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if _, err := tx.Exec(`DELETE FROM overlay_stage1_sources WHERE event_id = ?`, activeEvent.ID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		reductionByClass := map[string]float64{}
		for _, source := range request.Sources {
			if source.AmountSold <= 0 {
				continue
			}
			assetClass := choosePrimaryAssetClass([]string{source.AssetClass})
			reductionByClass[assetClass] += source.AmountSold
			var holdingID interface{}
			if source.HoldingID != nil {
				holdingID = *source.HoldingID
			}
			beforeValue := lookupOverlayHoldingValue(tx, source.HoldingID, source.StockName)
			expectedAfterValue := math.Max(0, beforeValue-source.AmountSold)
			if _, err := tx.Exec(`
				INSERT INTO overlay_stage1_sources (
					event_id, holding_id, stock_name, ticker, asset_class, group_id, group_label, amount_sold, before_value, expected_after_value
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, activeEvent.ID, holdingID, source.StockName, source.Ticker, assetClass, source.GroupID, source.GroupLabel, source.AmountSold, beforeValue, expectedAfterValue); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		for assetClass, amount := range reductionByClass {
			if _, err := tx.Exec(`
				UPDATE overlay_event_classes
				SET stage1_recorded_reduction_value = ?
				WHERE event_id = ? AND asset_class = ?
			`, amount, activeEvent.ID, assetClass); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[OVERLAY] Stage 1 applied at %.1f%% (event %v)", effectivePct, activeEvent)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                       "stage1_applied",
		"q1_exposure_pct":              effectivePct,
		"last_applied_q1_exposure_pct": effectivePct,
		"required_reduction_value":     request.RequiredReductionValue,
		"recorded_reduction_value":     request.RecordedReductionValue,
		"baseline_reserve_value":       request.BaselineReserveValue,
		"expected_reserve_value":       request.ExpectedReserveValue,
		"cash_confirmation_status":     "AWAITING_IMPORT",
		"event_id": func() interface{} {
			if activeEvent != nil {
				return activeEvent.ID
			}
			return nil
		}(),
	})
}

func markPortfolioOverlayStage1Partial(w http.ResponseWriter, r *http.Request) {
	spyPct, xaoPct, effectivePct, governingSource, _, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}
	_, activeEvent, _, err := syncOverlaySignalStateAndEvent(r.Context(), spyPct, xaoPct, effectivePct, governingSource)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if effectivePct < 0 {
		http.Error(w, "No active Q1 Exposure signal", http.StatusBadRequest)
		return
	}
	if activeEvent == nil {
		http.Error(w, "No active overlay event", http.StatusBadRequest)
		return
	}
	if activeEvent.Status != "PENDING" && activeEvent.Status != "PARTIAL" {
		http.Error(w, "Stage 1 is no longer open for partial progress", http.StatusBadRequest)
		return
	}

	if _, err := db.Exec(`
		UPDATE overlay_events
		SET status = 'PARTIAL'
		WHERE id = ?
	`, activeEvent.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "stage1_partial",
		"event_id": activeEvent.ID,
	})
}

func reopenPortfolioOverlayStage1(w http.ResponseWriter, r *http.Request) {
	spyPct, xaoPct, effectivePct, governingSource, _, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}
	if effectivePct < 0 {
		http.Error(w, "No active Q1 Exposure signal", http.StatusBadRequest)
		return
	}

	event, _, err := getLatestOverlayWorkflowEvent()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "No active overlay event", http.StatusBadRequest)
		return
	}
	if math.Abs(event.ToQ1ExposurePct-effectivePct) > 0.0001 {
		http.Error(w, "Cannot reopen Stage 1 because the active signal has changed", http.StatusBadRequest)
		return
	}
	if event.Status == "PENDING" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":   "stage1_open",
			"event_id": event.ID,
		})
		return
	}
	if event.Status != "PARTIAL" && event.Status != "STAGE1_DONE" && event.Status != "STAGE2_DONE" {
		http.Error(w, "Stage 1 cannot be reopened from the current workflow state", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE overlay_events
		SET status = 'PENDING',
		    stage1_applied_at = NULL,
		    stage1_required_reduction_value = 0,
		    stage1_recorded_reduction_value = 0,
		    stage1_baseline_reserve_value = 0,
		    stage1_expected_reserve_value = 0,
		    stage1_import_baseline_at = NULL,
		    reserve_confirmed_at = NULL,
		    reserve_confirmed_value = NULL,
		    reserve_variance = NULL,
		    cash_confirmation_status = '',
		    stage2_completed_at = NULL
		WHERE id = ?
		`, event.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec(`
		UPDATE overlay_event_classes
		SET stage1_recorded_reduction_value = 0
		WHERE event_id = ?
	`, event.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec(`
		UPDATE overlay_signal_state
		SET current_q1_exposure_pct = ?,
		    last_applied_q1_exposure_pct = ?,
		    spy_q1_exposure_pct = ?,
		    xao_q1_exposure_pct = ?,
		    governing_source = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`, effectivePct, event.FromQ1ExposurePct, spyPct, xaoPct, governingSource); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[OVERLAY] Stage 1 reopened for event %d (%.1f%% -> %.1f%%)", event.ID, event.FromQ1ExposurePct, event.ToQ1ExposurePct)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                       "stage1_reopened",
		"event_id":                     event.ID,
		"q1_exposure_pct":              effectivePct,
		"last_applied_q1_exposure_pct": event.FromQ1ExposurePct,
	})
}

func savePortfolioOverlayStage2(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Items []struct {
			AssetClass string   `json:"asset_class"`
			TargetPct  *float64 `json:"target_pct"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	event, _, err := getLatestOverlayWorkflowEvent()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "No active overlay event", http.StatusBadRequest)
		return
	}
	if event.Status != "STAGE1_DONE" {
		http.Error(w, "Stage 2 can only be edited after Stage 1 is applied", http.StatusBadRequest)
		return
	}
	if event.CashConfirmationStatus != "CONFIRMED" {
		http.Error(w, "Stage 2 is locked until the reserve cash is confirmed by a later holdings import", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	for _, item := range payload.Items {
		assetClass := choosePrimaryAssetClass([]string{item.AssetClass})
		if assetClass == "" {
			continue
		}
		setting := getOverlayAssetClassSetting(assetClass)

		if _, err := tx.Exec(`
			INSERT INTO overlay_event_classes (
				event_id, asset_class, overlay_eligible, trigger_invested_value, trigger_invested_pct,
				trigger_tactical_cash_value, trigger_total_class_capital_value, target_invested_value, target_invested_pct,
				q3_sell_priority, stage2_target_pct
			) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?)
			ON CONFLICT(event_id, asset_class) DO UPDATE SET
				stage2_target_pct = excluded.stage2_target_pct,
				q3_sell_priority = COALESCE(overlay_event_classes.q3_sell_priority, excluded.q3_sell_priority)
		`, event.ID, assetClass, setting.OverlayEligible, setting.Q3SellPriority, item.TargetPct); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "stage2_saved",
		"event_id": event.ID,
	})
}

func completePortfolioOverlayStage2(w http.ResponseWriter, r *http.Request) {
	event, _, err := getLatestOverlayWorkflowEvent()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if event == nil {
		http.Error(w, "No active overlay event", http.StatusBadRequest)
		return
	}
	if event.Status != "STAGE1_DONE" {
		http.Error(w, "Stage 2 can only be completed after Stage 1 is applied", http.StatusBadRequest)
		return
	}
	if event.CashConfirmationStatus != "CONFIRMED" {
		http.Error(w, "Stage 2 is locked until the reserve cash is confirmed by a later holdings import", http.StatusBadRequest)
		return
	}

	if _, err := db.Exec(`
		UPDATE overlay_events
		SET status = 'STAGE2_DONE',
		    stage2_completed_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, event.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "stage2_completed",
		"event_id": event.ID,
	})
}

func setPortfolioOverlayBaseline(w http.ResponseWriter, r *http.Request) {
	spyPct, xaoPct, effectivePct, governingSource, _, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}
	if effectivePct < 0 {
		http.Error(w, "No active Q1 Exposure signal", http.StatusBadRequest)
		return
	}

	if _, _, _, err := syncOverlaySignalStateAndEvent(r.Context(), spyPct, xaoPct, effectivePct, governingSource); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	workflowEvent, _, err := getLatestOverlayWorkflowEvent()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if workflowEvent != nil && workflowEvent.Status != "STAGE2_DONE" {
		http.Error(w, "Stage 2 must be completed before accepting a new baseline", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE overlay_signal_state
		SET current_q1_exposure_pct = ?,
		    last_applied_q1_exposure_pct = ?,
		    spy_q1_exposure_pct = ?,
		    xao_q1_exposure_pct = ?,
		    governing_source = ?,
		    last_applied_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`, effectivePct, effectivePct, spyPct, xaoPct, governingSource); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec(`
		UPDATE overlay_events
		SET status = 'BASELINED',
		    baseline_accepted_at = CURRENT_TIMESTAMP
		WHERE id = (
			SELECT id
			FROM overlay_events
			WHERE status IN ('PENDING', 'PARTIAL', 'STAGE1_DONE', 'STAGE2_DONE')
			ORDER BY triggered_at DESC, id DESC
			LIMIT 1
		)
	`); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[OVERLAY] Baseline accepted at %.1f%%", effectivePct)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                       "baseline_set",
		"q1_exposure_pct":              effectivePct,
		"last_applied_q1_exposure_pct": effectivePct,
	})
}

func markPortfolioOverlaySignalReviewed(w http.ResponseWriter, r *http.Request) {
	spPct, xaoPct, effectivePct, governingSource, _, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}
	if effectivePct < 0 {
		http.Error(w, "No active Q3/Q4 signal", http.StatusBadRequest)
		return
	}

	if _, _, _, err := syncOverlaySignalStateAndEvent(r.Context(), spPct, xaoPct, effectivePct, governingSource); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	workflowEvent, _, err := getLatestOverlayWorkflowEvent()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if workflowEvent == nil {
		http.Error(w, "No active signal review", http.StatusBadRequest)
		return
	}
	if workflowEvent.Stage1AppliedAt != nil || workflowEvent.Status == "STAGE1_DONE" || workflowEvent.Status == "STAGE2_DONE" {
		http.Error(w, "Signal has recorded position actions and cannot be marked reviewed", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE overlay_signal_state
		SET current_q1_exposure_pct = ?,
		    last_applied_q1_exposure_pct = ?,
		    spy_q1_exposure_pct = ?,
		    xao_q1_exposure_pct = ?,
		    governing_source = ?,
		    last_applied_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`, effectivePct, effectivePct, spPct, xaoPct, governingSource); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec(`
		UPDATE overlay_events
		SET status = 'CANCELLED',
		    superseded_at = CURRENT_TIMESTAMP,
		    notes = CASE
		        WHEN COALESCE(notes, '') = '' THEN 'signal_reviewed'
		        ELSE notes || '; signal_reviewed'
		    END
		WHERE id = ?
		  AND status IN ('PENDING', 'PARTIAL')
	`, workflowEvent.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[OVERLAY] Signal reviewed at %.1f%% (%s)", effectivePct, governingSource)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                       "signal_reviewed",
		"event_id":                     workflowEvent.ID,
		"q1_exposure_pct":              effectivePct,
		"last_applied_q1_exposure_pct": effectivePct,
	})
}

