package main

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
)

// DB and transaction readers share the same permission checks. A saved Buy
// direction is not evidence that its TradingView feed is still registered.
type deploymentReader interface {
	fundingReader
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
}

type deploymentPermission struct {
	State  string `json:"state"`
	Reason string `json:"reason"`
}

type deploymentRisk struct {
	Q3          float64
	Q4          bool
	Q4Known     bool
	Connections map[string][]string
}

func loadDeploymentRisk(reader deploymentReader) (deploymentRisk, error) {
	risk := deploymentRisk{Q3: -1, Connections: map[string][]string{}}
	rows, err := reader.Query(`SELECT ticker, script FROM active_alerts`)
	if err != nil {
		return risk, err
	}
	for rows.Next() {
		var ticker, script string
		if err := rows.Scan(&ticker, &script); err != nil {
			rows.Close()
			return risk, err
		}
		script = normalizeAlertScript(script)
		risk.Connections[script] = append(risk.Connections[script], ticker)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return risk, err
	}
	rows, err = reader.Query(`SELECT source_ticker, target_equity_pct FROM equity_sizing`)
	if err != nil {
		return risk, err
	}
	values := map[string]float64{}
	for rows.Next() {
		var source string
		var value float64
		if err := rows.Scan(&source, &value); err != nil {
			rows.Close()
			return risk, err
		}
		values[strings.ToUpper(strings.TrimSpace(source))] = value
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return risk, err
	}
	sp, xao, source := -1.0, -1.0, "SPY"
	if value, ok := values["SPY"]; ok {
		sp = value
	}
	if value, ok := values["SPX"]; ok {
		sp, source = value, "SPX"
	}
	if value, ok := values["XAO"]; ok {
		xao = value
	}
	risk.Q3, _ = resolveQ3RiskTarget(sp, xao, source)
	// Keep a disconnected saved risk state visible, but never use it to grant
	// fresh spending permission. Transition feeds do not expire by age.
	for ticker, value := range map[string]float64{source: sp, "XAO": xao} {
		if value >= 0 && !risk.hasSymbol("q3d", ticker) {
			risk.Q3 = -1
		}
	}
	if math.IsNaN(risk.Q3) || math.IsInf(risk.Q3, 0) || risk.Q3 > 100 {
		risk.Q3 = -1
	}
	err = reader.QueryRow(`SELECT active FROM q4_crisis_state WHERE id = 1`).Scan(&risk.Q4)
	risk.Q4Known = err == nil
	if err != nil && err != sql.ErrNoRows {
		return risk, err
	}
	if value, ok := values["Q4D"]; ok && value >= 0 && value <= 100 {
		risk.Q4Known = true
		if value < 100 {
			risk.Q4 = true
		}
	}
	return risk, nil
}

func (risk deploymentRisk) hasSymbol(script, ticker string) bool {
	for _, connection := range risk.Connections[script] {
		if strings.Contains(connection, "/") {
			continue
		}
		if !strings.Contains(ticker, ":") {
			if securityActionTicker(connection) == securityActionTicker(ticker) {
				return true
			}
		} else if sameConfiguredSymbol(ticker, connection) {
			return true
		}
	}
	return false
}

func (risk deploymentRisk) classPermission(setting OverlayAssetClassSetting) deploymentPermission {
	if q4dLiquidityFactorForSetting(setting) > 0 {
		if risk.Q4 {
			return deploymentPermission{"Q4_BLOCKED", "Q4 is active; increases in this asset class are paused"}
		}
		if len(risk.Connections["q4d"]) == 0 {
			return deploymentPermission{"FEED_DISCONNECTED", "Connect the Q4 detector before recommending purchases"}
		}
		if !risk.Q4Known {
			return deploymentPermission{"RISK_UNKNOWN", "Set the Q4 detector state before recommending purchases"}
		}
	}
	if q3ThrottleFactorForSetting(setting) > 0 && risk.Q3 < 0 {
		return deploymentPermission{"RISK_UNKNOWN", "Initialise and connect the Q3 detector before recommending purchases"}
	}
	if risk.Q3 == 0 && q3ThrottleFactorForSetting(setting) == 1 {
		return deploymentPermission{"CAPACITY_REACHED", "Q3 leaves no purchase capacity in this asset class"}
	}
	return deploymentPermission{}
}

func deploymentBudgetFactor(q3, sensitivity float64) float64 {
	if sensitivity <= 0 {
		return 1
	}
	if q3 < 0 {
		return 0
	}
	return 1 - (1-math.Min(q3, 100)/100)*math.Min(sensitivity, 1)
}

func deploymentApprovedWeights(reader deploymentReader) (map[string]float64, error) {
	rows, err := reader.Query(`SELECT asset_class, weight_pct FROM portfolio_mix_snapshot_rows
		WHERE snapshot_id = (SELECT id FROM portfolio_mix_snapshots WHERE status = 'APPROVED'
		ORDER BY approved_at DESC, id DESC LIMIT 1)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	weights := map[string]float64{}
	for rows.Next() {
		var class string
		var weight float64
		if err := rows.Scan(&class, &weight); err != nil {
			return nil, err
		}
		if finitePositive(weight) && weight <= 100 {
			weights[strings.ToUpper(strings.TrimSpace(class))] = weight
		}
	}
	return weights, rows.Err()
}

func deploymentSecurityPermission(reader deploymentReader, ticker, alertType, source, class string, risk deploymentRisk) (deploymentPermission, error) {
	if permission := risk.classPermission(getOverlayAssetClassSetting(class)); permission.State != "" {
		return permission, nil
	}
	// Action rows use the display symbol; ratio feeds use the exchange-qualified
	// security. Never construct ASX:XYZ / GDX from an ambiguous bare XYZ.
	rows, err := reader.Query(`SELECT COALESCE(ticker, '') FROM stock_analysis`)
	if err != nil {
		return deploymentPermission{}, err
	}
	matches := map[string]bool{}
	for rows.Next() {
		var candidate string
		if err := rows.Scan(&candidate); err != nil {
			rows.Close()
			return deploymentPermission{}, err
		}
		candidate = normalizeCommodityThemeSymbol(candidate)
		if securityActionTicker(candidate) == securityActionTicker(ticker) {
			matches[candidate] = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return deploymentPermission{}, err
	}
	if !strings.Contains(ticker, ":") {
		if len(matches) != 1 {
			return deploymentPermission{"TARGET_UNAVAILABLE", "Resolve the security's exchange and ticker before recommending purchases"}, nil
		}
		for candidate := range matches {
			ticker = candidate
		}
	}
	trendScript := "cdf"
	mode, modeErr := etfManagementModeFrom(reader, ticker)
	if modeErr != nil {
		return deploymentPermission{}, modeErr
	}
	if !etfManagementAccepts(mode, source) {
		return deploymentPermission{"MANAGEMENT_MODE_CHANGED", "This signal belongs to the fund's previous management mode"}, nil
	}
	if normalizeAlertScript(source) == "etf_tms" {
		trendScript = "etf_tms"
	}
	if !risk.hasSymbol(trendScript, ticker) {
		return deploymentPermission{"FEED_DISCONNECTED", "Connect and initialise the security trend in Alerts"}, nil
	}
	if normalizeAlertScript(source) == "tms" && !risk.hasSymbol("tms", ticker) {
		return deploymentPermission{"FEED_DISCONNECTED", "Reconnect this security's TMS in Alerts"}, nil
	}
	var direction string
	err = reader.QueryRow(`SELECT position_state FROM security_positions WHERE ticker = ?`, securityActionTicker(ticker)).Scan(&direction)
	if err != nil && err != sql.ErrNoRows {
		return deploymentPermission{}, err
	}
	direction = strings.ToUpper(strings.TrimSpace(direction))
	if direction != "BUY" && direction != "SELL" {
		return deploymentPermission{"TREND_UNKNOWN", "Set the security's current trend in Alerts"}, nil
	}
	// REENTRY was accepted through the TMS stopped/waiting lifecycle. It is an
	// exception to stock CDF Sell only, not to risk, funding or producer gates.
	if direction == "SELL" && canonicalAlertType(alertType) != "REENTRY" {
		return deploymentPermission{deploymentStateCDFBlocked, "Ordinary purchases are blocked while the security trend is Sell"}, nil
	}
	themes, err := loadCommodityThemeConfigsFrom(context.Background(), reader)
	if err != nil {
		return deploymentPermission{}, err
	}
	for _, theme := range themes {
		producer, direct := theme.TacticalAssetCode == class, theme.StrategicFloorAssetCode == class
		if !producer && !direct {
			continue
		}
		stages, err := loadCommodityThemeStageConfigsFrom(context.Background(), reader, theme.Code)
		if err != nil {
			return deploymentPermission{}, err
		}
		events, err := loadCommodityThemeEventsFrom(context.Background(), reader, theme.Code)
		if err != nil {
			return deploymentPermission{}, err
		}
		for _, stage := range stages {
			if !(producer && (stage.Key == "EQUITY_RELATIVE" || stage.Key == "SECURITY_OUTPERFORM") || direct && stage.Key == "COMMODITY") {
				continue
			}
			source := resolvedCommodityThemeSource(stage, &resolvedCommodityThemeSecurity{Ticker: ticker})
			if !hasCommodityThemeCDFConnection(risk.Connections["cdf"], source) {
				return deploymentPermission{"FEED_DISCONNECTED", fmt.Sprintf("Connect %s in Alerts", stage.Label)}, nil
			}
			var latest *commodityThemeEvent
			for i := range events {
				event := &events[i]
				if event.StageKey != stage.Key || event.Scope != stage.Scope || !commodityThemeEventMatchesConfiguredStage(*event, stage) {
					continue
				}
				if stage.Scope == "SECURITY" && !sameConfiguredSymbol(ticker, event.SecurityTicker) {
					continue
				}
				if event.Signal != "BUY" && event.Signal != "SELL" {
					continue
				}
				if latest == nil || eventIsLater(*event, *latest) {
					latest = event
				}
			}
			if latest == nil {
				return deploymentPermission{"TREND_UNKNOWN", fmt.Sprintf("Set the current %s direction in Alerts", stage.Label)}, nil
			}
			// Outperform direction is evidence, not an unapproved 75%/100% cap.
			if latest.Signal == "SELL" && stage.Key != "SECURITY_OUTPERFORM" {
				return deploymentPermission{"MARKET_BLOCKED", fmt.Sprintf("%s is Bear; purchases in this class are paused", stage.Label)}, nil
			}
		}
	}
	return deploymentPermission{}, nil
}
