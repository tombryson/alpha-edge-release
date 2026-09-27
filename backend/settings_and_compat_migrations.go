package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

func getAssetClassConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getOverlayAssetClassSettings())
}

func updateAssetClassConfig(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(mux.Vars(r)["code"]))
	if code == "" {
		http.Error(w, "missing asset class code", http.StatusBadRequest)
		return
	}

	var payload struct {
		DisplayName        *string  `json:"display_name"`
		AlertLabel         *string  `json:"alert_label"`
		AlertColor         *string  `json:"alert_color"`
		Kind               *string  `json:"kind"`
		ParentCode         *string  `json:"parent_code"`
		IsPortfolioSleeve  *bool    `json:"is_portfolio_sleeve"`
		IsSystemBucket     *bool    `json:"is_system_bucket"`
		AllowGrouping      *bool    `json:"allow_grouping"`
		AllowTargetWeight  *bool    `json:"allow_target_weight"`
		OverlayEligible    *bool    `json:"overlay_eligible"`
		DisplayOrder       *int     `json:"display_order"`
		Q3SellPriority     *int     `json:"q3_sell_priority"`
		Q3ThrottleFactor   *float64 `json:"q3_throttle_factor"`
		Q4DLiquidityFactor *float64 `json:"q4d_liquidity_factor"`
		Stage2TargetPct    *float64 `json:"stage2_target_pct"`
		Q1Category         *bool    `json:"q1_category"`
		Q3Beneficiary      *bool    `json:"q3_beneficiary"`
		RegimeIndependent  *bool    `json:"regime_independent"`
		Q3Rating           *string  `json:"q3_rating"`
		Q3Logic            *string  `json:"q3_logic"`
		Sector             *string  `json:"sector"`
		CashReserve          *float64 `json:"cash_reserve"`
		StockAllocationRatio *float64 `json:"stock_allocation_ratio"`
		Active               *bool    `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	current := getOverlayAssetClassSetting(code)
	if payload.DisplayName != nil {
		current.DisplayName = strings.TrimSpace(*payload.DisplayName)
	}
	if payload.AlertLabel != nil {
		current.AlertLabel = strings.TrimSpace(*payload.AlertLabel)
	}
	if payload.AlertColor != nil {
		current.AlertColor = strings.TrimSpace(*payload.AlertColor)
	}
	if payload.Kind != nil {
		current.Kind = strings.ToUpper(strings.TrimSpace(*payload.Kind))
		if current.Kind == "" {
			current.Kind = "ASSET_CLASS"
		}
	}
	if payload.ParentCode != nil {
		current.ParentCode = strings.ToUpper(strings.TrimSpace(*payload.ParentCode))
	}
	if payload.IsPortfolioSleeve != nil {
		current.IsPortfolioSleeve = *payload.IsPortfolioSleeve
	}
	if payload.IsSystemBucket != nil {
		current.IsSystemBucket = *payload.IsSystemBucket
	}
	if payload.AllowGrouping != nil {
		current.AllowGrouping = *payload.AllowGrouping
	}
	if payload.AllowTargetWeight != nil {
		current.AllowTargetWeight = *payload.AllowTargetWeight
	}
	if payload.OverlayEligible != nil {
		current.OverlayEligible = *payload.OverlayEligible
	}
	if payload.DisplayOrder != nil {
		current.DisplayOrder = *payload.DisplayOrder
	}
	if payload.Q3SellPriority != nil {
		current.Q3SellPriority = payload.Q3SellPriority
	}
	if payload.Q3ThrottleFactor != nil {
		value := clampFloat(*payload.Q3ThrottleFactor, 0, 1)
		current.Q3ThrottleFactor = &value
	}
	if payload.Q4DLiquidityFactor != nil {
		value := clampFloat(*payload.Q4DLiquidityFactor, 0, 1)
		current.Q4DLiquidityFactor = &value
	}
	if payload.Stage2TargetPct != nil {
		current.Stage2TargetPct = payload.Stage2TargetPct
	}
	if payload.Q1Category != nil {
		current.Q1Category = *payload.Q1Category
	}
	if payload.Q3Beneficiary != nil {
		current.Q3Beneficiary = *payload.Q3Beneficiary
	}
	if payload.RegimeIndependent != nil {
		current.RegimeIndependent = *payload.RegimeIndependent
	}
	if payload.Q3Rating != nil {
		current.Q3Rating = strings.TrimSpace(*payload.Q3Rating)
	}
	if payload.Q3Logic != nil {
		current.Q3Logic = strings.TrimSpace(*payload.Q3Logic)
	}
	if payload.Sector != nil {
		current.Sector = strings.TrimSpace(*payload.Sector)
	}
	if payload.CashReserve != nil {
		current.CashReserve = *payload.CashReserve
	}
	if payload.StockAllocationRatio != nil {
		value := clampFloat(*payload.StockAllocationRatio, 0, 1)
		current.StockAllocationRatio = value
	}
	if payload.Active != nil {
		current.Active = *payload.Active
	}

	_, err := db.Exec(`
		INSERT INTO asset_class_config (
			code, display_name, alert_label, alert_color, kind, parent_code, is_portfolio_sleeve, is_system_bucket,
			allow_grouping, allow_target_weight, overlay_eligible, display_order, q3_sell_priority,
			q3_throttle_factor, q4d_liquidity_factor,
			q1_category, q3_beneficiary, regime_independent, q3_rating, q3_logic,
			stage2_target_pct, sector, cash_reserve, stock_allocation_ratio, active, updated_at
		) VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(code) DO UPDATE SET
			display_name = excluded.display_name,
			alert_label = excluded.alert_label,
			alert_color = excluded.alert_color,
			kind = excluded.kind,
			parent_code = excluded.parent_code,
			is_portfolio_sleeve = excluded.is_portfolio_sleeve,
			is_system_bucket = excluded.is_system_bucket,
			allow_grouping = excluded.allow_grouping,
			allow_target_weight = excluded.allow_target_weight,
			overlay_eligible = excluded.overlay_eligible,
			display_order = excluded.display_order,
			q3_sell_priority = excluded.q3_sell_priority,
			q3_throttle_factor = excluded.q3_throttle_factor,
			q4d_liquidity_factor = excluded.q4d_liquidity_factor,
			q1_category = excluded.q1_category,
			q3_beneficiary = excluded.q3_beneficiary,
			regime_independent = excluded.regime_independent,
			q3_rating = excluded.q3_rating,
			q3_logic = excluded.q3_logic,
			stage2_target_pct = excluded.stage2_target_pct,
			sector = excluded.sector,
			cash_reserve = excluded.cash_reserve,
			stock_allocation_ratio = excluded.stock_allocation_ratio,
			active = excluded.active,
			updated_at = CURRENT_TIMESTAMP
	`,
		code,
		current.DisplayName,
		current.AlertLabel,
		current.AlertColor,
		current.Kind,
		current.ParentCode,
		current.IsPortfolioSleeve,
		current.IsSystemBucket,
		current.AllowGrouping,
		current.AllowTargetWeight,
		current.OverlayEligible,
		current.DisplayOrder,
		current.Q3SellPriority,
		current.Q3ThrottleFactor,
		current.Q4DLiquidityFactor,
		current.Q1Category,
		current.Q3Beneficiary,
		current.RegimeIndependent,
		current.Q3Rating,
		current.Q3Logic,
		current.Stage2TargetPct,
		current.Sector,
		current.CashReserve,
		current.StockAllocationRatio,
		current.Active,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(current)
}

// ═══════════════════════════════════════════════════════════
// EQUITY POSITION SIZING
// ═══════════════════════════════════════════════════════════

// migrateActiveAlertsForPositionSizing adds regime_position_sizing to the CHECK constraint
func migrateActiveAlertsForPositionSizing() {
	var sql string
	err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='active_alerts'`).Scan(&sql)
	if err != nil {
		log.Println("[ALPHA EDGE] No active_alerts table found, skipping position sizing migration")
		return
	}

	if strings.Contains(sql, "q3d") || strings.Contains(sql, "regime_position_sizing") {
		log.Println("[ALPHA EDGE] active_alerts constraint already includes Q3 detector, skipping")
		return
	}

	log.Println("[ALPHA EDGE] Migrating active_alerts: adding regime_position_sizing to CHECK constraint...")
	db.Exec(`PRAGMA foreign_keys = OFF`)
	db.Exec(`BEGIN TRANSACTION`)
	db.Exec(`CREATE TABLE active_alerts_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT,
		script TEXT CHECK(script IN ('oms','atr_oscillator','regime_equities','regime_commodities','etf_rebalancing','etf_oms','regime_position_sizing')) NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(ticker, script)
	)`)
	db.Exec(`INSERT INTO active_alerts_new SELECT * FROM active_alerts`)
	db.Exec(`DROP TABLE active_alerts`)
	db.Exec(`ALTER TABLE active_alerts_new RENAME TO active_alerts`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_active_alerts_ticker ON active_alerts(ticker)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_active_alerts_script ON active_alerts(script)`)
	db.Exec(`COMMIT`)
	db.Exec(`PRAGMA foreign_keys = ON`)
	log.Println("[ALPHA EDGE] active_alerts position sizing migration completed")
}

func migrateCanonicalActiveAlertScripts() {
	var tableSQL string
	if err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='active_alerts'`).Scan(&tableSQL); err != nil {
		log.Println("[ALPHA EDGE] No active_alerts table found, skipping canonical script migration")
		return
	}

	var legacyCount int
	_ = db.QueryRow(`
		SELECT COUNT(*)
		FROM active_alerts
		WHERE script IN ('oms','atr_oscillator','etf_oms','etf_cdf','etf_tms','regime_equities','regime_commodities','regime_position_sizing')
	`).Scan(&legacyCount)

	if strings.Contains(tableSQL, "q3d") && strings.Contains(tableSQL, "ctf") && strings.Contains(tableSQL, "q4d") && legacyCount == 0 {
		log.Println("[ALPHA EDGE] active_alerts already uses canonical script names, skipping")
		return
	}

	log.Println("[ALPHA EDGE] Migrating active_alerts to canonical script names...")
	db.Exec(`PRAGMA foreign_keys = OFF`)
	db.Exec(`BEGIN TRANSACTION`)
	db.Exec(`CREATE TABLE active_alerts_canonical (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT,
		script TEXT CHECK(script IN ('cdf','tms','etf_tms','ctf','q4d','q3d','etf_rebalancing')) NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(ticker, script)
	)`)
	db.Exec(`
		INSERT OR IGNORE INTO active_alerts_canonical (ticker, script, created_at)
		SELECT
			ticker,
			CASE script
				WHEN 'oms' THEN 'cdf'
				WHEN 'cdf' THEN 'cdf'
				WHEN 'atr_oscillator' THEN 'tms'
				WHEN 'tms' THEN 'tms'
				WHEN 'etf_oms' THEN 'etf_tms'
				WHEN 'etf_cdf' THEN 'etf_tms'
				WHEN 'etf_tms' THEN 'etf_tms'
				WHEN 'regime_equities' THEN 'q4d'
				WHEN 'q4d' THEN 'q4d'
				WHEN 'regime_commodities' THEN 'ctf'
				WHEN 'ctf' THEN 'ctf'
				WHEN 'regime_position_sizing' THEN 'q3d'
				WHEN 'q3d' THEN 'q3d'
				ELSE script
			END AS canonical_script,
			MAX(created_at)
		FROM active_alerts
		WHERE script IN (
			'oms','cdf','atr_oscillator','tms','etf_oms','etf_cdf','etf_tms',
			'regime_equities','q4d','regime_commodities','ctf','regime_position_sizing','q3d','etf_rebalancing'
		)
		GROUP BY ticker, canonical_script
	`)
	db.Exec(`DROP TABLE active_alerts`)
	db.Exec(`ALTER TABLE active_alerts_canonical RENAME TO active_alerts`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_active_alerts_ticker ON active_alerts(ticker)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_active_alerts_script ON active_alerts(script)`)
	db.Exec(`COMMIT`)
	db.Exec(`PRAGMA foreign_keys = ON`)
	log.Println("[ALPHA EDGE] active_alerts canonical script migration completed")
}

func migrateCanonicalAlertSources() {
	var tableSQL string
	if err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='alerts'`).Scan(&tableSQL); err != nil {
		log.Println("[ALPHA EDGE] No alerts table found, skipping canonical source migration")
		return
	}

	var legacyCount int
	_ = db.QueryRow(`
		SELECT COUNT(*)
		FROM alerts
		WHERE source IN (
			'oms','atr_oscillator','etf_oms','etf_cdf',
			'regime','regime_equities','regime_commodities','regime_position_sizing'
		)
	`).Scan(&legacyCount)

	if strings.Contains(tableSQL, "'q3d'") &&
		strings.Contains(tableSQL, "'q4d'") &&
		strings.Contains(tableSQL, "'ctf'") &&
		!strings.Contains(tableSQL, "'atr_oscillator'") &&
		legacyCount == 0 {
		log.Println("[ALPHA EDGE] alerts already uses canonical source names, skipping")
		return
	}

	log.Println("[ALPHA EDGE] Migrating alerts to canonical source names...")

	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		log.Printf("[ALPHA EDGE] Failed to disable foreign keys for alerts migration: %v", err)
		return
	}
	if _, err := db.Exec(`BEGIN TRANSACTION`); err != nil {
		log.Printf("[ALPHA EDGE] Failed to begin alerts migration: %v", err)
		db.Exec(`PRAGMA foreign_keys = ON`)
		return
	}

	rollback := func(format string, args ...interface{}) {
		log.Printf(format, args...)
		db.Exec(`ROLLBACK`)
		db.Exec(`DROP TABLE IF EXISTS alerts_canonical`)
		db.Exec(`PRAGMA foreign_keys = ON`)
	}

	if _, err := db.Exec(`DROP TABLE IF EXISTS alerts_canonical`); err != nil {
		rollback("[ALPHA EDGE] Failed to clear stale canonical alerts table: %v", err)
		return
	}

	if _, err := db.Exec(`CREATE TABLE alerts_canonical (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL,
		alert_type TEXT NOT NULL,
		strength TEXT,
		expiry_date DATETIME,
		exchange_prefix TEXT DEFAULT 'ASX:',
		timeframe TEXT,
		source TEXT CHECK(source IN ('cdf','tms','etf_tms','ctf','q4d','q3d','unknown')),
		affected_positions TEXT,
		alert_price REAL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		is_active BOOLEAN DEFAULT 1,
		resolved_at DATETIME,
		resolved_reason TEXT,
		resolved_note TEXT,
		needs_mapping BOOLEAN DEFAULT 0
	)`); err != nil {
		rollback("[ALPHA EDGE] Failed to create canonical alerts table: %v", err)
		return
	}

	if _, err := db.Exec(`
		INSERT INTO alerts_canonical (
			id, ticker, alert_type, strength, expiry_date, exchange_prefix, timeframe,
			source, affected_positions, alert_price, created_at, is_active, resolved_at,
			resolved_reason, resolved_note, needs_mapping
		)
		SELECT
			id,
			ticker,
			alert_type,
			strength,
			expiry_date,
			exchange_prefix,
			timeframe,
			CASE
				WHEN source IS NULL OR TRIM(source) = '' THEN NULL
				WHEN source IN ('oms','cdf') THEN 'cdf'
				WHEN source IN ('atr_oscillator','tms') THEN 'tms'
				WHEN source IN ('etf_oms','etf_cdf','etf_tms') THEN 'etf_tms'
				WHEN source IN ('regime_commodities','ctf') THEN 'ctf'
				WHEN source IN ('regime_position_sizing','q3d') THEN 'q3d'
				WHEN source IN ('regime','regime_equities','q4d') THEN 'q4d'
				WHEN source = 'unknown' THEN 'unknown'
				ELSE 'unknown'
			END AS canonical_source,
			affected_positions,
			alert_price,
			created_at,
			is_active,
			resolved_at,
			resolved_reason,
			resolved_note,
			needs_mapping
		FROM alerts
	`); err != nil {
		rollback("[ALPHA EDGE] Failed to copy canonical alerts data: %v", err)
		return
	}

	if _, err := db.Exec(`DROP TABLE alerts`); err != nil {
		rollback("[ALPHA EDGE] Failed to drop old alerts table: %v", err)
		return
	}
	if _, err := db.Exec(`ALTER TABLE alerts_canonical RENAME TO alerts`); err != nil {
		rollback("[ALPHA EDGE] Failed to rename canonical alerts table: %v", err)
		return
	}
	if _, err := db.Exec(`COMMIT`); err != nil {
		rollback("[ALPHA EDGE] Failed to commit alerts source migration: %v", err)
		return
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		log.Printf("[ALPHA EDGE] Failed to re-enable foreign keys after alerts migration: %v", err)
	}

	log.Println("[ALPHA EDGE] alerts canonical source migration completed")
}

func migrateCanonicalAlertTypes() {
	if _, err := db.Exec(`
		UPDATE alerts
		SET alert_type = CASE LOWER(TRIM(alert_type))
			WHEN 'cdf_buy_zone' THEN 'BREAKOUT'
			WHEN 'oms_buy_zone' THEN 'BREAKOUT'
			WHEN 'cdf_sell_zone' THEN 'SELL_DOWN'
			WHEN 'oms_sell_zone' THEN 'SELL_DOWN'
			WHEN 'sell down' THEN 'SELL_DOWN'
			WHEN 'sell-down' THEN 'SELL_DOWN'
			WHEN 're entry' THEN 'REENTRY'
			WHEN 're-entry' THEN 'REENTRY'
			WHEN 'breakout' THEN 'BREAKOUT'
			WHEN 'sell_down' THEN 'SELL_DOWN'
			WHEN 'reentry' THEN 'REENTRY'
			WHEN 'add' THEN 'ADD'
			WHEN 'trim' THEN 'TRIM'
			WHEN 'buy' THEN 'BUY'
			WHEN 'sell' THEN 'SELL'
			WHEN 'regime' THEN 'REGIME'
			ELSE alert_type
		END
		WHERE LOWER(TRIM(alert_type)) IN (
			'cdf_buy_zone',
			'oms_buy_zone',
			'cdf_sell_zone',
			'oms_sell_zone',
			'sell down',
			'sell-down',
			're entry',
			're-entry',
			'breakout',
			'sell_down',
			'reentry',
			'add',
			'trim',
			'buy',
			'sell',
			'regime'
		)
	`); err != nil {
		log.Printf("[ALPHA EDGE] Failed to canonicalize alert types: %v", err)
		return
	}

	if _, err := db.Exec(`
		UPDATE alerts
		SET strength = CASE LOWER(TRIM(COALESCE(strength, '')))
			WHEN 'strong' THEN 'Strong'
			WHEN 'weak' THEN 'Weak'
			ELSE NULLIF(TRIM(COALESCE(strength, '')), '')
		END,
		timeframe = CASE UPPER(TRIM(COALESCE(timeframe, '')))
			WHEN '1D' THEN '1D'
			WHEN '2D' THEN '2D'
			WHEN '3D' THEN '3D'
			ELSE NULLIF(TRIM(COALESCE(timeframe, '')), '')
		END
	`); err != nil {
		log.Printf("[ALPHA EDGE] Failed to canonicalize alert metadata: %v", err)
		return
	}
}

// handlePositionSizingSignal processes update and heartbeat signals from the Q3 detector.
func handlePositionSizingSignal(w http.ResponseWriter, sourceTicker string, pct float64, rawTicker string) {
	// source_ticker defaults to "SPY" if payload had no ticker (shouldn't happen but be safe)
	if sourceTicker == "" {
		sourceTicker = "SPY"
	}

	// Upsert current state
	_, err := db.Exec(`
		INSERT INTO equity_sizing (source_ticker, target_equity_pct)
		VALUES (?, ?)
		ON CONFLICT(source_ticker) DO UPDATE SET
			target_equity_pct = excluded.target_equity_pct,
			last_updated = CURRENT_TIMESTAMP
	`, sourceTicker, pct)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		log.Printf("[POSITION SIZING ERROR] Failed to upsert equity_sizing for %s: %v", sourceTicker, err)
		return
	}

	// Append to history
	_, err = db.Exec(`
		INSERT INTO equity_sizing_history (source_ticker, target_equity_pct)
		VALUES (?, ?)
	`, sourceTicker, pct)
	if err != nil {
		log.Printf("[POSITION SIZING ERROR] Failed to insert history for %s: %v", sourceTicker, err)
	}

	connectionTicker := strings.TrimSpace(rawTicker)
	if connectionTicker == "" {
		connectionTicker = strings.TrimSpace(sourceTicker)
	}

	// Register connection (so alert status indicator shows it as active)
	go func() {
		handleConnectionSignal(nil, connectionTicker, "q3d", nil)
	}()

	log.Printf("[POSITION SIZING] %s → %.0f%%", sourceTicker, pct)

	spyPct, xaoPct, effectivePct, governingSource, _, eqErr := getEffectiveEquityState(context.Background())
	if eqErr != nil {
		log.Printf("[POSITION SIZING ERROR] Failed to read effective equity state: %v", eqErr)
		if w != nil {
			http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		}
		return
	}
	signalState, activeEvent, _, syncErr := syncOverlaySignalStateAndEvent(context.Background(), spyPct, xaoPct, effectivePct, governingSource)
	if syncErr != nil {
		log.Printf("[POSITION SIZING ERROR] Failed to sync overlay event state: %v", syncErr)
	}

	if w != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":                       "success",
			"source":                       sourceTicker,
			"pct":                          pct,
			"effective_pct":                effectivePct,
			"last_applied_q1_exposure_pct": signalState.LastAppliedQ1ExposurePct,
			"pending_event_id": func() interface{} {
				if activeEvent != nil {
					return activeEvent.ID
				}
				return nil
			}(),
		})
	}
}

// GetEffectiveEquityPct returns min(SPX_pct, XAO_pct), or whichever is available.
// Legacy SPY rows are still accepted as S&P-compatible input.
// Returns -1 if no data has been received yet
// GET /api/equity-sizing — current state + history
func getEquitySizing(w http.ResponseWriter, r *http.Request) {
	// Current per-source state
	rows, err := db.Query(`SELECT source_ticker, target_equity_pct, last_updated FROM equity_sizing ORDER BY source_ticker`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	sources := []EquitySizingEntry{}
	for rows.Next() {
		var e EquitySizingEntry
		rows.Scan(&e.SourceTicker, &e.TargetEquityPct, &e.LastUpdated)
		sources = append(sources, e)
	}

	// History (last 20)
	hrows, err := db.Query(`
		SELECT id, source_ticker, target_equity_pct, received_at
		FROM equity_sizing_history
		ORDER BY id DESC
		LIMIT 20
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer hrows.Close()

	history := []EquitySizingHistoryEntry{}
	for hrows.Next() {
		var e EquitySizingHistoryEntry
		hrows.Scan(&e.ID, &e.SourceTicker, &e.TargetEquityPct, &e.ReceivedAt)
		history = append(history, e)
	}

	effectivePct, eqErr := GetEffectiveEquityPct()
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"effective_pct": effectivePct,
		"sources":       sources,
		"history":       history,
	})
}

// getSettings returns all settings as key-value pairs
func getSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		log.Printf("[SETTINGS] Failed to query settings: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			log.Printf("[SETTINGS] Failed to scan setting: %v", err)
			continue
		}
		settings[key] = value
	}

	// Set defaults if not present
	if _, ok := settings["etf_sell_reduction_pct"]; !ok {
		settings["etf_sell_reduction_pct"] = "50"
	}
	if _, ok := settings["etf_min_exposure_pct"]; !ok {
		settings["etf_min_exposure_pct"] = "25"
	}
	if _, ok := settings["etf_core_sleeve_ratio_pct"]; !ok {
		settings["etf_core_sleeve_ratio_pct"] = "25"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// updateSettings updates settings from a key-value map
func updateSettings(w http.ResponseWriter, r *http.Request) {
	var updates map[string]string
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if status, message := validateAssetClassColourSettings(updates); status != 0 {
		http.Error(w, message, status)
		return
	}

	for key, value := range updates {
		_, err := db.Exec(`
			INSERT INTO settings (key, value, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(key) DO UPDATE SET
				value = excluded.value,
				updated_at = CURRENT_TIMESTAMP
		`, key, value)

		if err != nil {
			log.Printf("[SETTINGS] Failed to update setting %s: %v", key, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("[SETTINGS] Updated %s = %s", key, value)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"updated": updates,
	})
}
