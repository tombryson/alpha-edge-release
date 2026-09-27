package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/mux"
)

// Serialise mode changes with signal/setup writes. Broker reconciliation retains
// its existing transaction boundary and is never reset by a mode change.
var etfManagementMu sync.Mutex

type ETFManagementProfile struct {
	Ticker string `json:"ticker"`
	Mode   string `json:"mode"`
}

func ensureETFManagementSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS etf_management_profiles (
			ticker TEXT PRIMARY KEY,
			mode TEXT NOT NULL CHECK(mode IN ('etf_tms', 'tms')),
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS etf_management_changes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ticker TEXT NOT NULL,
			previous_mode TEXT NOT NULL,
			mode TEXT NOT NULL,
			initial_state TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`)
	return err
}

func etfManagementModeFrom(reader fundingReader, ticker string) (string, error) {
	if strings.Contains(ticker, "/") {
		return "", nil
	}
	symbol := canonicalSecurityTickerKey(ticker)
	var mode string
	err := reader.QueryRow(`SELECT mode FROM etf_management_profiles WHERE ticker = ?`, symbol).Scan(&mode)
	if err == nil {
		return mode, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}
	var isETF bool
	err = reader.QueryRow(fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM stock_analysis
		WHERE UPPER(security_type) = 'ETF' AND %s = ?)
		OR EXISTS(SELECT 1 FROM etf_allocations WHERE ticker = ?)`, stockAnalysisTickerKeySQL("ticker")), symbol, symbol).Scan(&isETF)
	if err != nil {
		return "", err
	}
	if isETF {
		return "etf_tms", nil
	}
	return "", nil
}

func etfManagementAccepts(mode, script string) bool {
	script = normalizeAlertScript(script)
	if mode == "" || (script != "cdf" && script != "tms" && script != "etf_tms") {
		return true
	}
	if mode == "tms" {
		return script == "tms" || script == "cdf"
	}
	return script == "etf_tms"
}

func syncManagedETFTacticalState(ticker string) {
	_, err := db.Exec(`UPDATE etf_allocations SET tactical_status =
		COALESCE((SELECT position_state FROM security_positions WHERE ticker = etf_allocations.ticker), 'SELL'),
		last_updated = CURRENT_TIMESTAMP WHERE ticker = ? AND EXISTS
		(SELECT 1 FROM etf_management_profiles WHERE ticker = etf_allocations.ticker AND mode = 'tms')`, canonicalSecurityTickerKey(ticker))
	if err != nil {
		log.Printf("[ETF MANAGEMENT] Failed to sync tactical state for %s: %v", ticker, err)
	}
	_, err = db.Exec(`UPDATE etf_positions SET position_state =
		COALESCE((SELECT position_state FROM security_positions WHERE ticker = etf_positions.ticker), 'SELL'),
		last_updated = CURRENT_TIMESTAMP WHERE ticker = ? AND EXISTS
		(SELECT 1 FROM etf_management_profiles WHERE ticker = etf_positions.ticker AND mode = 'tms')`, canonicalSecurityTickerKey(ticker))
	if err != nil {
		log.Printf("[ETF MANAGEMENT] Failed to sync legacy ETF state for %s: %v", ticker, err)
	}
}

func getETFManagementProfiles(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT ticker, mode FROM etf_management_profiles ORDER BY ticker`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	profiles := []ETFManagementProfile{}
	for rows.Next() {
		var profile ETFManagementProfile
		if err := rows.Scan(&profile.Ticker, &profile.Mode); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		profiles = append(profiles, profile)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profiles)
}

func updateETFManagementProfile(w http.ResponseWriter, r *http.Request) {
	etfManagementMu.Lock()
	defer etfManagementMu.Unlock()
	deploymentFundingMu.Lock()
	defer deploymentFundingMu.Unlock()
	var request struct {
		Mode         string `json:"mode"`
		PreviousMode string `json:"previous_mode"`
		InitialState string `json:"initial_state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid management settings", 400)
		return
	}
	if (request.Mode != "tms" && request.Mode != "etf_tms") || (request.InitialState != "BUY" && request.InitialState != "SELL") {
		http.Error(w, "Select ETF or TMS and an initial BUY or SELL direction", 400)
		return
	}
	rawTicker := strings.TrimSpace(mux.Vars(r)["ticker"])
	ticker := canonicalSecurityTickerKey(rawTicker)
	if ticker == "" || strings.Contains(rawTicker, "/") {
		http.Error(w, "Invalid fund ticker", 400)
		return
	}
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	mode, err := etfManagementModeFrom(tx, ticker)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if mode == "" {
		http.Error(w, "Classify this security as an ETF first", 400)
		return
	}
	// The existing positions ledger is symbol-keyed. Refuse ambiguous symbols
	// instead of applying one mode to two securities listed on different venues.
	var venues int
	err = tx.QueryRow(fmt.Sprintf(`SELECT COUNT(DISTINCT REPLACE(UPPER(substr(ticker, 1, instr(ticker, ':') - 1)), '_DLY', ''))
		FROM stock_analysis WHERE instr(ticker, ':') > 0 AND %s = ?`, stockAnalysisTickerKeySQL("ticker")), ticker).Scan(&venues)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if venues > 1 {
		http.Error(w, "Resolve the duplicate exchange symbol before changing management mode", 409)
		return
	}
	if mode != request.PreviousMode {
		http.Error(w, "Management mode changed; refresh before saving", 409)
		return
	}
	if mode == request.Mode {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ETFManagementProfile{ticker, mode})
		return
	}
	var pending int
	err = tx.QueryRow(`SELECT COUNT(*) FROM security_actions WHERE ticker = ? AND status IN ('AWAITING_STATEMENT', 'VARIANCE')`, ticker).Scan(&pending)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if pending > 0 {
		http.Error(w, "Reconcile this fund's reported trade before changing management mode", 409)
		return
	}
	statements := []struct {
		sql  string
		args []interface{}
	}{
		{`INSERT INTO etf_management_profiles(ticker, mode) VALUES (?, ?) ON CONFLICT(ticker) DO UPDATE SET mode = excluded.mode, updated_at = CURRENT_TIMESTAMP`, []interface{}{ticker, request.Mode}},
		{`INSERT INTO etf_management_changes(ticker, previous_mode, mode, initial_state) VALUES (?, ?, ?, ?)`, []interface{}{ticker, mode, request.Mode, request.InitialState}},
		{`UPDATE security_actions SET status = 'NOT_APPLICABLE', blocked_by_action_id = NULL, updated_at = CURRENT_TIMESTAMP
		  WHERE ticker = ? AND status IN ('OPEN', 'BLOCKED', 'OVERRIDDEN') AND alert_id IN
		  (SELECT id FROM alerts WHERE source IN ('cdf', 'tms', 'atr_oscillator', 'etf_tms', 'etf_cdf'))`, []interface{}{ticker}},
		{`UPDATE alerts SET is_active = 0, resolved_reason = 'MANAGEMENT_MODE_CHANGED'
		  WHERE ticker = ? AND is_active = 1 AND source IN ('cdf', 'tms', 'atr_oscillator', 'etf_tms', 'etf_cdf')
		  AND NOT EXISTS (SELECT 1 FROM security_actions sa WHERE sa.alert_id = alerts.id AND sa.execution_reported_at IS NOT NULL)`, []interface{}{ticker}},
		{fmt.Sprintf(`DELETE FROM active_alerts WHERE %s = ? AND script IN ('cdf', 'tms', 'atr_oscillator', 'etf_tms', 'etf_cdf')`, stockAnalysisTickerKeySQL("ticker")), []interface{}{ticker}},
		{`INSERT INTO security_positions(ticker, position_state, stopped_waiting_reentry, manual_override) VALUES (?, ?, 0, 0)
		  ON CONFLICT(ticker) DO UPDATE SET position_state = excluded.position_state, stopped_waiting_reentry = 0, manual_override = 0, last_updated = CURRENT_TIMESTAMP`, []interface{}{ticker, request.InitialState}},
		{`INSERT INTO etf_allocations(ticker, allocation_percent, base_weight, tactical_status) VALUES (?, 0, 0, ?)
		  ON CONFLICT(ticker) DO UPDATE SET tactical_status = excluded.tactical_status, last_updated = CURRENT_TIMESTAMP`, []interface{}{ticker, request.InitialState}},
		{`UPDATE etf_positions SET position_state = ?, manual_override = 0, last_updated = CURRENT_TIMESTAMP WHERE ticker = ?`, []interface{}{request.InitialState, ticker}},
	}
	for _, statement := range statements {
		if _, err = tx.Exec(statement.sql, statement.args...); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ETFManagementProfile{ticker, request.Mode})
}

// TMS position state owns eligibility, while model weights remain unchanged.
// A stopped fund cannot silently top itself up from a stale ETF Buy state.
func applyETFManagementStates(reader fundingReader, allocations map[string]etfAllocationDBRow) (map[string]string, error) {
	rows, err := reader.Query(`SELECT m.ticker, m.mode, COALESCE(p.position_state, '')
		FROM etf_management_profiles m LEFT JOIN security_positions p ON p.ticker = m.ticker`)
	if err != nil {
		return nil, err
	}
	type state struct{ ticker, mode, direction string }
	states := []state{}
	for rows.Next() {
		var s state
		if err := rows.Scan(&s.ticker, &s.mode, &s.direction); err != nil {
			rows.Close()
			return nil, err
		}
		states = append(states, s)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	modes := map[string]string{}
	for _, s := range states {
		modes[s.ticker] = s.mode
		row := allocations[s.ticker]
		row.Ticker = s.ticker
		row.TacticalStatus = "SELL"
		var connected bool
		// Like stocks, an unheld TMS fund enters through CDF; TMS is required
		// for ongoing management once the broker (or external flag) shows a holding.
		err := reader.QueryRow(fmt.Sprintf(`SELECT
			(EXISTS(SELECT 1 FROM active_alerts WHERE %s = ? AND script IN (?, ?))
			 OR (? = 'tms' AND NOT EXISTS(SELECT 1 FROM holdings WHERE %s = ? AND is_active = 1 AND value_aud > 0)
			 AND NOT EXISTS(SELECT 1 FROM stock_analysis WHERE %s = ? AND is_external = 1)))
			AND (? != 'tms' OR EXISTS(SELECT 1 FROM active_alerts WHERE %s = ? AND script = 'cdf'))`, stockAnalysisTickerKeySQL("ticker"), stockAnalysisTickerKeySQL("ticker"), stockAnalysisTickerKeySQL("ticker"), stockAnalysisTickerKeySQL("ticker")),
			s.ticker, s.mode, map[string]string{"tms": "atr_oscillator", "etf_tms": "etf_cdf"}[s.mode], s.mode, s.ticker, s.ticker, s.mode, s.ticker).Scan(&connected)
		if err != nil {
			return nil, err
		}
		if connected && s.direction == "BUY" {
			row.TacticalStatus = "BUY"
		}
		allocations[s.ticker] = row
	}
	return modes, nil
}
