package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	portfolio "trading-backend/internal/portfolio"
)

const q4CrisisTargetEquityPct = portfolio.Q4CrisisTargetEquityPct

func defaultQ4CrisisState() Q4CrisisState {
	return Q4CrisisState{
		Active:          false,
		Reason:          "",
		TargetEquityPct: 100,
	}
}

func getQ4CrisisState(ctx context.Context) (Q4CrisisState, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	row := db.QueryRowContext(ctx, `
		SELECT active, last_changed_at, last_acknowledged_at, COALESCE(reason, ''), updated_at
		FROM q4_crisis_state
		WHERE id = 1
	`)

	state := defaultQ4CrisisState()
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
			return state, nil
		}
		return state, err
	}

	if lastChangedAt.Valid {
		state.LastChangedAt = &lastChangedAt.Time
	}
	if lastAcknowledgedAt.Valid {
		state.LastAcknowledgedAt = &lastAcknowledgedAt.Time
	}
	if updatedAt.Valid {
		state.UpdatedAt = &updatedAt.Time
	}
	if state.Active {
		state.TargetEquityPct = q4CrisisTargetEquityPct
	}
	return state, nil
}

func persistQ4CrisisState(ctx context.Context, active bool, reason string, acknowledge bool) (Q4CrisisState, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	reason = strings.TrimSpace(reason)
	current, err := getQ4CrisisState(ctx)
	if err != nil {
		return current, err
	}

	stateChanged := current.Active != active
	if _, err := db.ExecContext(ctx, `
		INSERT INTO q4_crisis_state (id, active, reason, last_changed_at, last_acknowledged_at, updated_at)
		VALUES (1, ?, ?, CURRENT_TIMESTAMP, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			active = excluded.active,
			reason = excluded.reason,
			last_changed_at = CASE
				WHEN q4_crisis_state.active != excluded.active THEN CURRENT_TIMESTAMP
				ELSE q4_crisis_state.last_changed_at
			END,
			last_acknowledged_at = CASE
				WHEN ? THEN CURRENT_TIMESTAMP
				WHEN q4_crisis_state.active != excluded.active THEN NULL
				ELSE q4_crisis_state.last_acknowledged_at
			END,
			updated_at = CURRENT_TIMESTAMP
	`, active, reason, acknowledge, acknowledge); err != nil {
		return current, err
	}

	state, err := getQ4CrisisState(ctx)
	if err != nil {
		return state, err
	}
	if stateChanged {
		log.Printf("[Q4 CRISIS] active=%v target=%.1f%% reason=%q", state.Active, state.TargetEquityPct, state.Reason)
	}
	return state, nil
}

func syncQ4CrisisOverlayState(ctx context.Context, active bool, reason string, rawTicker string, acknowledge bool) (Q4CrisisState, map[string]interface{}, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	state, err := persistQ4CrisisState(ctx, active, reason, acknowledge)
	if err != nil {
		return state, nil, err
	}

	targetPct := 100.0
	if active {
		targetPct = q4CrisisTargetEquityPct
	}

	_, err = db.Exec(`
		INSERT INTO equity_sizing (source_ticker, target_equity_pct)
		VALUES ('Q4D', ?)
		ON CONFLICT(source_ticker) DO UPDATE SET
			target_equity_pct = excluded.target_equity_pct,
			last_updated = CURRENT_TIMESTAMP
	`, targetPct)
	if err != nil {
		return state, nil, err
	}

	if _, err := db.Exec(`
		INSERT INTO equity_sizing_history (source_ticker, target_equity_pct)
		VALUES ('Q4D', ?)
	`, targetPct); err != nil {
		log.Printf("[Q4D] Failed to insert equity sizing history: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO overlay_signal_state (
			id, current_q1_exposure_pct, last_applied_q1_exposure_pct,
			spy_q1_exposure_pct, xao_q1_exposure_pct, governing_source,
			last_signal_changed_at, last_applied_at
		) VALUES (1, 100, 100, 100, 100, 'Q4D', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO NOTHING
	`); err != nil {
		return state, nil, err
	}

	go func() {
		handleConnectionSignal(nil, rawTicker, "q4d", nil)
	}()

	spyPct, xaoPct, effectivePct, governingSource, spSource, eqErr := getEffectiveEquityState(context.Background())
	if eqErr != nil {
		return state, nil, eqErr
	}
	signalState, activeEvent, _, syncErr := syncOverlaySignalStateAndEvent(context.Background(), spyPct, xaoPct, effectivePct, governingSource)
	if syncErr != nil {
		return state, nil, syncErr
	}
	portfolioRisk := buildPortfolioRiskState(spyPct, xaoPct, spSource, state)

	response := map[string]interface{}{
		"status":                       "success",
		"source":                       "Q4_CRISIS",
		"active":                       state.Active,
		"reason":                       state.Reason,
		"target_pct":                   targetPct,
		"effective_pct":                effectivePct,
		"governing_source":             governingSource,
		"last_applied_q1_exposure_pct": signalState.LastAppliedQ1ExposurePct,
		"q4_crisis":                    state,
		"portfolio_risk":               portfolioRisk,
	}
	if activeEvent != nil {
		response["pending_event_id"] = activeEvent.ID
		response["event_from_pct"] = activeEvent.FromQ1ExposurePct
		response["event_to_pct"] = activeEvent.ToQ1ExposurePct
		response["event_adjustment_ratio"] = activeEvent.AdjustmentRatio
	}
	return state, response, nil
}

func handleQ4DOverlaySignal(signalUpper, rawTicker string) (map[string]interface{}, error) {
	active := false
	reason := ""
	switch strings.ToUpper(strings.TrimSpace(signalUpper)) {
	case "SELL":
		active = true
		reason = "q4d_sell_signal"
	case "BUY":
		active = false
		reason = "q4d_buy_signal"
	default:
		return nil, fmt.Errorf("Q4D signal must be BUY or SELL")
	}

	_, response, err := syncQ4CrisisOverlayState(context.Background(), active, reason, rawTicker, false)
	return response, err
}

func tradingViewWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "Invalid webhook body", http.StatusBadRequest)
		return
	}
	var probe struct {
		Script string `json:"script"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if scriptMatches(normalizeAlertScript(probe.Script), "q3d", "q4d") {
		http.Error(w, "regime detector signals must use /api/webhook/regime", http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	acknowledgeAndProcessWebhook(w, r, "tradingview")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func normalizeCDFStopState(value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	normalized = strings.ReplaceAll(normalized, " ", "_")
	switch normalized {
	case "BUY", "BUY_ZONE", "IN_BUY_ZONE", "TRUE":
		return "BUY"
	case "SELL", "SELL_ZONE", "IN_SELL_ZONE", "FALSE":
		return "SELL"
	default:
		return ""
	}
}

func tradingViewWebhookSync(w http.ResponseWriter, r *http.Request) {
	etfManagementMu.Lock()
	defer etfManagementMu.Unlock()
	var webhook struct {
		Ticker             string             `json:"ticker"`
		Signal             string             `json:"signal"`
		Script             string             `json:"script"`             // Connection signal only
		CurrentZone        string             `json:"current_zone"`       // CDF connect: current state (buy/sell)
		CDFState           string             `json:"cdf_state"`          // TMS stop context: embedded CDF state at stop
		CDFZone            string             `json:"cdf_zone"`           // Alias for cdf_state
		Allocations        map[string]float64 `json:"allocations"`        // ETF allocations
		SignalStrength     string             `json:"signalStrength"`     // Legacy field
		Strength           string             `json:"strength"`           // Legacy field
		Timeframe          string             `json:"timeframe"`          // ATR+Oscillator signals (1D, 2D, 3D)
		AnalystPriceTarget json.Number        `json:"analystPriceTarget"` // CDF signals only (accepts both number and string)
		Price              json.Number        `json:"price"`              // Optional TradingView close/price at alert
		Close              json.Number        `json:"close"`              // Optional alias for price
	}

	if err := json.NewDecoder(r.Body).Decode(&webhook); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	log.Printf("[ALPHA EDGE] TradingView webhook received: %s %s (timeframe: %s, price target: %s)",
		webhook.Ticker, webhook.Signal, webhook.Timeframe, webhook.AnalystPriceTarget.String())

	webhook.Script = normalizeAlertScript(webhook.Script)

	// Extract prefix and ticker from exchange:symbol format (e.g., "ASX:BHP" -> prefix="ASX:", ticker="BHP")
	ticker := webhook.Ticker
	exchangePrefix := "ASX:" // Default fallback

	if colonIdx := strings.Index(ticker, ":"); colonIdx != -1 {
		exchangePrefix = ticker[:colonIdx+1] // Include the colon
		ticker = ticker[colonIdx+1:]
	}

	log.Printf("[ALPHA EDGE] Parsed ticker: %s, prefix: %s", ticker, exchangePrefix)
	mode, modeErr := etfManagementModeFrom(db, webhook.Ticker)
	if modeErr != nil {
		http.Error(w, modeErr.Error(), http.StatusInternalServerError)
		return
	}
	incomingSource := determineSignalSource(webhook.AnalystPriceTarget.String(), webhook.Timeframe, strings.ToUpper(webhook.Signal), ticker, webhook.Script)
	if !etfManagementAccepts(mode, incomingSource) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ignored", "reason": "Script does not match the selected ETF management mode"})
		return
	}
	// Explicitly switched funds must reconnect in Alerts; a webhook is not setup.
	var explicitlyManaged bool
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM etf_management_profiles WHERE ticker = ?)`, canonicalSecurityTickerKey(ticker)).Scan(&explicitlyManaged); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if explicitlyManaged && (incomingSource == "tms" || incomingSource == "cdf" || incomingSource == "etf_tms") && !activeAlertSetupExists(webhook.Ticker, ticker, incomingSource) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ignored", "reason": "Confirm the selected script connection in Alerts"})
		return
	}

	// Look up company name from company_mappings using ticker
	var companyName string
	needsMapping := false
	err := db.QueryRow(`
		SELECT company_name FROM company_mappings
		WHERE ticker = ? AND exchange_prefix = ?
	`, ticker, exchangePrefix).Scan(&companyName)

	if err != nil {
		// If no mapping exists, try without exchange prefix match
		err = db.QueryRow(`
			SELECT company_name FROM company_mappings WHERE ticker = ?
		`, ticker).Scan(&companyName)

		if err != nil {
			// No company mapping found - use ticker as fallback and flag for resolution
			companyName = ticker
			needsMapping = true
			log.Printf("[ALPHA EDGE] Warning: No company mapping found for %s%s, flagging for manual resolution", exchangePrefix, ticker)
		}
	}

	log.Printf("[ALPHA EDGE] Resolved company name: %s", companyName)

	// Handle analyst price target update (runs for ALL signals including connect)
	analystPTStr := webhook.AnalystPriceTarget.String()
	if analystPTStr != "" && analystPTStr != "0" {
		var analystPT float64
		if analystPTStr == "false" {
			analystPT = 0
		} else {
			parsedPT, err := webhook.AnalystPriceTarget.Float64()
			if err != nil {
				log.Printf("[ALPHA EDGE] Warning: Could not parse analyst price target '%s': %v", analystPTStr, err)
				analystPT = 0
			} else {
				analystPT = parsedPT
			}
		}

		// Only update stock_analysis when we have a real company mapping.
		// If needsMapping=true, companyName is just the raw ticker (e.g. "GHM"),
		// and inserting it would create a placeholder duplicate that persists after the user resolves the mapping.
		if !needsMapping {
			fullTicker := exchangePrefix + ticker
			var analysisID int64
			lookupErr := db.QueryRow(`
				SELECT id
				FROM stock_analysis
				WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
				   OR UPPER(TRIM(ticker)) IN (UPPER(TRIM(?)), UPPER(TRIM(?)))
				ORDER BY
					CASE WHEN TRIM(COALESCE(primary_asset_class, '')) != '' THEN 0 ELSE 1 END,
					CASE WHEN UPPER(TRIM(ticker)) = UPPER(TRIM(?)) THEN 0 ELSE 1 END,
					updated_at DESC
				LIMIT 1
			`, companyName, fullTicker, ticker, fullTicker).Scan(&analysisID)

			if lookupErr == nil {
				_, err = db.Exec(`
					UPDATE stock_analysis
					SET analyst_pt = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`, analystPT, analysisID)
			} else if lookupErr == sql.ErrNoRows {
				_, err = db.Exec(`
					INSERT INTO stock_analysis (ticker, name, analyst_pt, updated_at)
					VALUES (?, ?, ?, CURRENT_TIMESTAMP)
					ON CONFLICT(ticker, name) DO UPDATE SET
						analyst_pt = excluded.analyst_pt,
						updated_at = CURRENT_TIMESTAMP
				`, fullTicker, companyName, analystPT)
			} else {
				err = lookupErr
			}
			if err != nil {
				log.Printf("[ALPHA EDGE] Failed to update analyst price target for %s (%s): %v", ticker, companyName, err)
			} else {
				log.Printf("[ALPHA EDGE] Updated analyst price target for %s (%s): %.2f", ticker, companyName, analystPT)
			}
		} else {
			log.Printf("[ALPHA EDGE] Skipping stock_analysis insert for unmapped ticker %s - awaiting company mapping", ticker)
		}
	}

	// Auto-register only portfolio/regime-level scripts. Per-stock CDF/TMS connections are
	// user-approved setup state, not something inferred from a TradingView event.
	if webhook.Script != "" {
		if validAlertScript(webhook.Script) && (scriptMatches(webhook.Script, "ctf", "q4d", "q3d", "etf_rebalancing")) {
			_, regErr := db.Exec(`
				INSERT INTO active_alerts (ticker, script)
				VALUES (?, ?)
				ON CONFLICT(ticker, script) DO UPDATE SET
					created_at = CURRENT_TIMESTAMP
			`, webhook.Ticker, webhook.Script)
			if regErr != nil {
				log.Printf("[CONNECTION] Failed to auto-register %s for %s: %v", webhook.Script, webhook.Ticker, regErr)
			} else {
				log.Printf("[CONNECTION] Auto-registered connection: %s on %s", webhook.Script, webhook.Ticker)
			}
		}
	}

	// Handle connection signals (alert registration) - after price target so PT is stored
	if strings.ToLower(webhook.Signal) == "connect" {
		handleConnectionSignal(w, webhook.Ticker, webhook.Script, webhook.Allocations)
		// Sync position state from current_zone if provided (CDF reports its current state on connect)
		if webhook.CurrentZone != "" {
			zone := strings.ToUpper(webhook.CurrentZone)
			if zone == "BUY" || zone == "SELL" {
				handlePositionUpdate(ticker, zone, determineSignalSource("", "", zone, ticker, webhook.Script))
				log.Printf("[CDF] Connect state sync: %s -> %s (from current_zone)", ticker, zone)
			}
		}
		return
	}

	// Normalize and parse signal according to architecture.
	normalizedSignal := normalizeTradingViewSignal(
		webhook.Signal,
		webhook.Strength,
		webhook.SignalStrength,
		webhook.Timeframe,
	)
	signalUpper := normalizedSignal.AlertType
	strength := normalizedSignal.Strength
	webhook.Timeframe = normalizedSignal.Timeframe

	if normalizedSignal.Ignored {
		log.Printf("[ALPHA EDGE] Ignoring TradingView signal for %s: %s (%s)", ticker, webhook.Signal, normalizedSignal.Reason)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message": "Signal ignored",
			"ticker":  ticker,
			"signal":  webhook.Signal,
			"reason":  normalizedSignal.Reason,
		})
		return
	}

	// If no signal provided, this is just a price target update - respond and return
	if signalUpper == "" {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message": "Price target updated",
			"ticker":  ticker,
		})
		return
	}

	// Determine signal source using architecture logic
	source := determineSignalSource(analystPTStr, webhook.Timeframe, signalUpper, ticker, webhook.Script)

	log.Printf("[ALPHA EDGE] Signal source determined: %s", source)

	if source == "tms" {
		hasPortfolioContext, contextReason := hasActionableStockTMSContext(webhook.Ticker, ticker, companyName)
		if !hasPortfolioContext {
			removeActiveAlertSetupsForTicker(webhook.Ticker, ticker, "tms")
			log.Printf("[TMS] Suppressed %s for %s — %s", signalUpper, webhook.Ticker, contextReason)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "TMS signal suppressed",
				"ticker":  ticker,
				"signal":  signalUpper,
				"reason":  contextReason,
			})
			return
		}

		if !activeAlertSetupExists(webhook.Ticker, ticker, "tms") {
			log.Printf("[TMS] Suppressed %s for %s — no active TMS setup", signalUpper, webhook.Ticker)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "TMS signal suppressed",
				"ticker":  ticker,
				"signal":  signalUpper,
				"reason":  "no active TMS setup",
			})
			return
		}
	}

	// CDF is a trend/deployment state machine — ADD and TRIM are TMS oscillator signals.
	if source == "cdf" && (signalUpper == "ADD" || signalUpper == "TRIM") {
		log.Printf("[CDF] Rejected %s signal for %s — ADD/TRIM are not valid CDF state signals", signalUpper, ticker)
		http.Error(w, fmt.Sprintf("CDF script does not accept ADD/TRIM signals: %s", signalUpper), http.StatusBadRequest)
		return
	}

	// CDF BUY/SELL = state sync only (reporting current zone).
	// A live SELL→BUY transition is sent explicitly as "breakout" by Pine Script.
	// Just update security_positions and return — no alert record created.
	if source == "cdf" && (signalUpper == "BUY" || signalUpper == "SELL") {
		handlePositionUpdate(ticker, signalUpper, source)
		log.Printf("[CDF] State sync %s for %s — position updated, no alert created", signalUpper, ticker)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message": fmt.Sprintf("CDF state sync: %s", signalUpper),
			"ticker":  ticker,
		})
		return
	}

	// Suppress CDF signals if there's an active TMS alert for this ticker
	if source == "cdf" {
		var hasATRAlert int
		err := db.QueryRow(`
			SELECT COUNT(*) FROM active_alerts
			WHERE ticker = ? AND script = 'tms'
		`, webhook.Ticker).Scan(&hasATRAlert)

		if err == nil && hasATRAlert > 0 {
			log.Printf("[ALPHA EDGE] Suppressing CDF signal for %s - active TMS position exists", ticker)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "CDF signal suppressed - active TMS position",
				"ticker":  ticker,
			})
			return
		}
	}

	// Calculate expiry based on signal type
	var expiryDate *time.Time
	if signalUpper == "TRIM" || signalUpper == "ADD" {
		// ADD/TRIM signals expire in 3 trading days
		expiry := calculateExpiryDate(time.Now())
		expiryDate = &expiry
	} else if signalUpper == "REENTRY" {
		// REENTRY signals expire in 3 trading days
		expiry := calculateExpiryDate(time.Now())
		expiryDate = &expiry
	} else if signalUpper == "SELL_DOWN" {
		// CDF sell-down zone expires in 3 trading days
		expiry := calculateExpiryDate(time.Now())
		expiryDate = &expiry
	} else if signalUpper == "BREAKOUT" {
		// BREAKOUT signals have 30-day window to cash in
		expiry := time.Now().AddDate(0, 0, 30)
		expiryDate = &expiry
	}
	// BUY/SELL signals have no expiry (nil)

	cdfStopState := normalizeCDFStopState(firstNonEmpty(webhook.CDFState, webhook.CDFZone))
	if source == "tms" && signalUpper == "SELL" && cdfStopState == "BUY" {
		signalUpper = "SELL_50"
	}

	// No position gating - record all signals that come in from TradingView

	// Validate REENTRY signal
	// Only create REENTRY alert if position is in stopped_waiting_reentry state
	if signalUpper == "REENTRY" {
		var stoppedWaitingReentry bool
		err := db.QueryRow(`
			SELECT stopped_waiting_reentry FROM security_positions WHERE ticker = ?
		`, ticker).Scan(&stoppedWaitingReentry)

		if err == sql.ErrNoRows || !stoppedWaitingReentry {
			log.Printf("[ALPHA EDGE] Skipping REENTRY alert for %s - not in waiting state", ticker)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "Alert skipped - position not waiting for re-entry",
				"ticker":  ticker,
				"signal":  signalUpper,
			})
			return
		}

		log.Printf("[ALPHA EDGE] REENTRY validation passed for %s", ticker)
	}

	alertPrice := lookupCurrentMarketPrice(ticker, exchangePrefix)
	if parsedPrice, ok := parseOptionalJSONNumber(webhook.Price); ok {
		alertPrice = floatPtr(parsedPrice)
	} else if parsedClose, ok := parseOptionalJSONNumber(webhook.Close); ok {
		alertPrice = floatPtr(parsedClose)
	}

	// Create alert from webhook with source and timeframe tracking
	result, err := db.Exec(`
		INSERT INTO alerts (ticker, alert_type, strength, expiry_date, exchange_prefix, timeframe, source, needs_mapping, alert_price)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, ticker, signalUpper, strength, expiryDate, exchangePrefix, webhook.Timeframe, source, needsMapping, nullableFloat(alertPrice))

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	if actionErr := ensureSecurityActionForAlertID(int(id)); actionErr != nil {
		log.Printf("[SECURITY ACTIONS] Failed to project webhook alert %d: %v", id, actionErr)
	}

	alert := Alert{
		ID:             int(id),
		Ticker:         ticker,
		AlertType:      signalUpper,
		Strength:       strength,
		ExpiryDate:     expiryDate,
		ExchangePrefix: exchangePrefix,
		Timeframe:      webhook.Timeframe,
		Source:         source,
		AlertPrice:     alertPrice,
		CreatedAt:      time.Now(),
		IsActive:       true,
	}
	attachAlertPriceContext(&alert)

	// Handle position state updates based on signal type and source
	handlePositionUpdate(ticker, signalUpper, source, cdfStopState)

	var q4Action map[string]interface{}
	if source == "q4d" && (signalUpper == "BUY" || signalUpper == "SELL") {
		action, actionErr := handleQ4DOverlaySignal(signalUpper, webhook.Ticker)
		if actionErr != nil {
			log.Printf("[Q4D ERROR] Failed to sync Q4D overlay action for %s %s: %v", webhook.Ticker, signalUpper, actionErr)
		} else {
			q4Action = action
			log.Printf("[Q4D] %s signal synced overlay target %.1f%%", signalUpper, action["target_pct"])
		}
	}

	// ADD signal = contribution event — record the timestamp
	if signalUpper == "ADD" && source == "tms" {
		db.Exec(`UPDATE stock_analysis SET last_contributed_at = CURRENT_TIMESTAMP WHERE ticker LIKE '%:' || ?`, ticker)
		log.Printf("[ALPHA EDGE] Recorded contribution timestamp for %s via TMS ADD signal", ticker)
	}

	// Handle REENTRY signal - clear stopped_waiting_reentry flag and set position to BUY
	if signalUpper == "REENTRY" {
		_, err := db.Exec(`
			UPDATE security_positions
			SET position_state = 'BUY',
			    stopped_waiting_reentry = 0,
			    entry_date = CURRENT_TIMESTAMP,
			    last_updated = CURRENT_TIMESTAMP
			WHERE ticker = ? AND manual_override = 0
		`, ticker)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to handle REENTRY for %s: %v", ticker, err)
		} else {
			log.Printf("[ALPHA EDGE] REENTRY executed: %s -> BUY, entry_date reset", ticker)
		}
		syncManagedETFTacticalState(ticker)
	}

	// Broadcast to SSE clients
	select {
	case alertChannel <- alert:
		log.Printf("[ALPHA EDGE] Webhook alert broadcasted: %s %s (expires: %v)", alert.Ticker, alert.AlertType, expiryDate)
	default:
		log.Println("[ALPHA EDGE] Alert channel full, skipping broadcast")
	}

	w.WriteHeader(http.StatusOK)
	response := map[string]interface{}{
		"message": "Alert created from webhook",
		"id":      id,
		"expires": expiryDate,
	}
	if q4Action != nil {
		response["portfolio_action"] = q4Action
	}
	json.NewEncoder(w).Encode(response)
}

// webhookStatus displays database information in HTML format for quick browser access
func webhookStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	// Query recent alerts
	alertRows, err := db.Query(`
		SELECT id, ticker, alert_type, strength, exchange_prefix, timeframe, source, created_at, expiry_date, is_active
		FROM alerts
		ORDER BY created_at DESC
		LIMIT 20
	`)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer alertRows.Close()

	type AlertInfo struct {
		ID             int
		Ticker         string
		AlertType      string
		Strength       string
		ExchangePrefix string
		Timeframe      sql.NullString
		Source         sql.NullString
		CreatedAt      string
		ExpiryDate     sql.NullString
		IsActive       bool
	}

	var alerts []AlertInfo
	for alertRows.Next() {
		var a AlertInfo
		if err := alertRows.Scan(&a.ID, &a.Ticker, &a.AlertType, &a.Strength, &a.ExchangePrefix, &a.Timeframe, &a.Source, &a.CreatedAt, &a.ExpiryDate, &a.IsActive); err != nil {
			continue
		}
		alerts = append(alerts, a)
	}

	// Query current holdings from most recent statement
	holdingRows, err := db.Query(`
		SELECT sh.details, sh.quantity, sh.currency, sh.cost_aud
		FROM statement_holdings sh
		INNER JOIN (
			SELECT id FROM account_statements
			ORDER BY statement_date DESC
			LIMIT 1
		) latest ON sh.statement_id = latest.id
		WHERE sh.quantity > 0
		ORDER BY sh.details
	`)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer holdingRows.Close()

	type HoldingInfo struct {
		CompanyName string
		Units       float64
		Currency    string
		CostAUD     float64
	}

	var holdings []HoldingInfo
	for holdingRows.Next() {
		var h HoldingInfo
		if err := holdingRows.Scan(&h.CompanyName, &h.Units, &h.Currency, &h.CostAUD); err != nil {
			continue
		}
		holdings = append(holdings, h)
	}

	// Query stock analysis with price targets
	analysisRows, err := db.Query(`
		SELECT ticker, name, analyst_pt, updated_at
		FROM stock_analysis
		WHERE analyst_pt IS NOT NULL AND analyst_pt > 0
		ORDER BY updated_at DESC
		LIMIT 10
	`)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer analysisRows.Close()

	type AnalysisInfo struct {
		Ticker    string
		Name      string
		AnalystPT float64
		UpdatedAt string
	}

	var analyses []AnalysisInfo
	for analysisRows.Next() {
		var a AnalysisInfo
		if err := analysisRows.Scan(&a.Ticker, &a.Name, &a.AnalystPT, &a.UpdatedAt); err != nil {
			continue
		}
		analyses = append(analyses, a)
	}

	// Build HTML response
	html := `<!DOCTYPE html>
<html>
<head>
	<title>Trading Terminal - Webhook Status</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			background: #0a0a0a;
			color: #e0e0e0;
			padding: 20px;
			margin: 0;
		}
		.container {
			max-width: 1200px;
			margin: 0 auto;
		}
		h1 {
			color: #10b981;
			border-bottom: 2px solid #10b981;
			padding-bottom: 10px;
		}
		h2 {
			color: #3b82f6;
			margin-top: 30px;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			margin: 15px 0;
			background: #1a1a1a;
			border-radius: 8px;
			overflow: hidden;
		}
		th {
			background: #2a2a2a;
			color: #10b981;
			text-align: left;
			padding: 12px;
			font-weight: 600;
		}
		td {
			padding: 10px 12px;
			border-bottom: 1px solid #2a2a2a;
		}
		tr:last-child td {
			border-bottom: none;
		}
		tr:hover {
			background: #252525;
		}
		.badge {
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 12px;
			font-weight: 600;
			display: inline-block;
		}
		.badge-buy { background: #10b981; color: #000; }
		.badge-sell { background: #ef4444; color: #fff; }
		.badge-add { background: #3b82f6; color: #fff; }
		.badge-trim { background: #f59e0b; color: #000; }
		.badge-strong { background: #8b5cf6; color: #fff; }
		.badge-weak { background: #6b7280; color: #fff; }
		.badge-active { background: #10b981; color: #000; }
		.badge-expired { background: #6b7280; color: #fff; }
		.timestamp {
			color: #9ca3af;
			font-size: 14px;
		}
		.empty {
			text-align: center;
			padding: 20px;
			color: #6b7280;
			font-style: italic;
		}
		.prefix {
			color: #f59e0b;
			font-weight: 600;
		}
		.endpoints {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 12px;
			margin: 20px 0;
		}
		.endpoint {
			background: #1a1a1a;
			border: 1px solid #2a2a2a;
			border-radius: 8px;
			padding: 12px 16px;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.endpoint:hover {
			border-color: #10b981;
			background: #1f1f1f;
		}
		.endpoint-info {
			display: flex;
			flex-direction: column;
		}
		.endpoint-name {
			color: #10b981;
			font-weight: 600;
			font-size: 14px;
		}
		.endpoint-path {
			color: #9ca3af;
			font-size: 12px;
			font-family: monospace;
		}
		.endpoint-method {
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 11px;
			font-weight: 600;
		}
		.method-get { background: #3b82f6; color: #fff; }
		.method-post { background: #10b981; color: #000; }
	</style>
</head>
<body>
	<div class="container">
		<h1>Trading Terminal - Webhook Status</h1>
		<p class="timestamp">Generated: ` + time.Now().Format("2006-01-02 15:04:05 MST") + `</p>

		<h2>API Endpoints</h2>
		<div class="endpoints">
			<a href="/api/webhook/tradingview" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">TradingView Webhook</span>
					<span class="endpoint-path">/api/webhook/tradingview</span>
				</div>
				<span class="endpoint-method method-post">POST</span>
			</a>
			<a href="/api/webhook/regime" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">Regime Webhook</span>
					<span class="endpoint-path">/api/webhook/regime</span>
				</div>
				<span class="endpoint-method method-post">POST</span>
			</a>
			<a href="/api/webhook/etf-rebalance" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">ETF Rebalance Webhook</span>
					<span class="endpoint-path">/api/webhook/etf-rebalance</span>
				</div>
				<span class="endpoint-method method-post">POST</span>
			</a>
			<a href="/api/alerts" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">Alerts</span>
					<span class="endpoint-path">/api/alerts</span>
				</div>
				<span class="endpoint-method method-get">GET</span>
			</a>
			<a href="/api/alerts/active" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">Active Alerts (Connections)</span>
					<span class="endpoint-path">/api/alerts/active</span>
				</div>
				<span class="endpoint-method method-get">GET</span>
			</a>
			<a href="/api/regimes" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">Regimes</span>
					<span class="endpoint-path">/api/regimes</span>
				</div>
				<span class="endpoint-method method-get">GET</span>
			</a>
			<a href="/api/etf/allocations" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">ETF Allocations</span>
					<span class="endpoint-path">/api/etf/allocations</span>
				</div>
				<span class="endpoint-method method-get">GET</span>
			</a>
			<a href="/api/settings" class="endpoint" style="text-decoration: none;">
				<div class="endpoint-info">
					<span class="endpoint-name">Settings</span>
					<span class="endpoint-path">/api/settings</span>
				</div>
				<span class="endpoint-method method-get">GET</span>
			</a>
		</div>

		<h2>Recent Alerts (Last 20)</h2>
		<table>
			<thead>
				<tr>
					<th>ID</th>
					<th>Ticker</th>
					<th>Signal</th>
					<th>Strength</th>
					<th>Status</th>
					<th>Created</th>
					<th>Expires</th>
				</tr>
			</thead>
			<tbody>`

	if len(alerts) == 0 {
		html += `<tr><td colspan="7" class="empty">No alerts found</td></tr>`
	} else {
		for _, a := range alerts {
			badgeClass := "badge-buy"
			switch strings.ToUpper(a.AlertType) {
			case "SELL":
				badgeClass = "badge-sell"
			case "ADD":
				badgeClass = "badge-add"
			case "TRIM":
				badgeClass = "badge-trim"
			}

			strengthBadge := ""
			if a.Strength != "" {
				strengthClass := "badge-weak"
				if a.Strength == "Strong" {
					strengthClass = "badge-strong"
				}
				strengthBadge = `<span class="badge ` + strengthClass + `">` + a.Strength + `</span>`
			}

			statusBadge := `<span class="badge badge-active">Active</span>`
			if !a.IsActive {
				statusBadge = `<span class="badge badge-expired">Expired</span>`
			}

			expiryStr := "Never"
			if a.ExpiryDate.Valid {
				expiryStr = a.ExpiryDate.String
			}

			html += `<tr>
				<td>` + strconv.Itoa(a.ID) + `</td>
				<td><span class="prefix">` + a.ExchangePrefix + `</span>` + a.Ticker + `</td>
				<td><span class="badge ` + badgeClass + `">` + a.AlertType + `</span></td>
				<td>` + strengthBadge + `</td>
				<td>` + statusBadge + `</td>
				<td class="timestamp">` + a.CreatedAt + `</td>
				<td class="timestamp">` + expiryStr + `</td>
			</tr>`
		}
	}

	html += `</tbody>
		</table>

		<h2>Current Holdings</h2>
		<table>
			<thead>
				<tr>
					<th>Company</th>
					<th>Units</th>
					<th>Currency</th>
					<th>Cost (AUD)</th>
				</tr>
			</thead>
			<tbody>`

	if len(holdings) == 0 {
		html += `<tr><td colspan="4" class="empty">No holdings found</td></tr>`
	} else {
		for _, h := range holdings {
			html += `<tr>
				<td>` + h.CompanyName + `</td>
				<td>` + strconv.FormatFloat(h.Units, 'f', 2, 64) + `</td>
				<td>` + h.Currency + `</td>
				<td>$` + strconv.FormatFloat(h.CostAUD, 'f', 2, 64) + `</td>
			</tr>`
		}
	}

	html += `</tbody>
		</table>

		<h2>Analyst Price Targets</h2>
		<table>
			<thead>
				<tr>
					<th>Ticker</th>
					<th>Company</th>
					<th>Price Target</th>
					<th>Updated</th>
				</tr>
			</thead>
			<tbody>`

	if len(analyses) == 0 {
		html += `<tr><td colspan="4" class="empty">No price targets set</td></tr>`
	} else {
		for _, a := range analyses {
			html += `<tr>
				<td>` + a.Ticker + `</td>
				<td>` + a.Name + `</td>
				<td>$` + strconv.FormatFloat(a.AnalystPT, 'f', 2, 64) + `</td>
				<td class="timestamp">` + a.UpdatedAt + `</td>
			</tr>`
		}
	}

	html += `</tbody>
		</table>
	</div>
</body>
</html>`

	w.Write([]byte(html))
}

// Import statement with holdings (bulk import from Google Sheets)
// This uses MERGE logic: database is single source of truth, sheet is just a feed
