package main

import (
	"database/sql"
	"fmt"
	"math"
	"strings"
)

const estimatedActionUnitTolerance = 0.10

// These are the existing Alert Stack trim percentages, not new sizing policy.
func securityActionTrimFraction(action SecurityAction) float64 {
	switch strings.ToLower(strings.TrimSpace(action.Strength)) {
	case "strong":
		return 0.20
	case "weak":
		return 0.05
	default:
		return 0
	}
}

type actionQueryReader interface {
	QueryRow(string, ...interface{}) *sql.Row
}

type securityActionUnitSnapshot struct {
	Ticker      string  `json:"ticker"`
	SecurityID  int64   `json:"security_id,omitempty"`
	Name        string  `json:"name"`
	Before      float64 `json:"before"`
	Expected    float64 `json:"expected"`
	External    bool    `json:"external,omitempty"`
	StatementID int64   `json:"statement_id,omitempty"`
}

func finitePositive(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func actionUnitsAllExternal(snapshots []securityActionUnitSnapshot) bool {
	if len(snapshots) == 0 {
		return false
	}
	for _, snapshot := range snapshots {
		if !snapshot.External {
			return false
		}
	}
	return true
}

func securityActionIsExternal(reader actionQueryReader, ticker string) (bool, error) {
	var external bool
	err := reader.QueryRow(`SELECT EXISTS (
		SELECT 1 FROM stock_analysis WHERE COALESCE(is_external, 0) = 1
		AND UPPER(TRIM(CASE WHEN INSTR(ticker, ':') > 0
		THEN SUBSTR(ticker, INSTR(ticker, ':') + 1) ELSE ticker END)) = ?
	)`, securityActionTicker(ticker)).Scan(&external)
	return external, err
}

// Capture the current broker quantities when execution is reported, not when
// the alert arrived: sequential reductions must use the remaining holding.
func captureSecurityActionUnits(tx *sql.Tx, action SecurityAction, reported *float64) ([]securityActionUnitSnapshot, error) {
	tickers := []string{action.Ticker}
	if action.Scope == "ASSET_CLASS" {
		tickers = action.AffectedTickers
	}
	result := make([]securityActionUnitSnapshot, 0, len(tickers))
	for _, ticker := range tickers {
		snapshot := securityActionUnitSnapshot{Ticker: securityActionTicker(ticker)}
		var err error
		snapshot.External, err = securityActionIsExternal(tx, ticker)
		if err != nil {
			return nil, err
		}
		if snapshot.External {
			result = append(result, snapshot)
			continue
		}
		var count int
		var value, priceAUD float64
		err = tx.QueryRow(`SELECT COUNT(*), COALESCE(MAX(security_id), 0),
			COALESCE(MAX(company_name), ''), COALESCE(SUM(quantity), 0), COALESCE(SUM(value_aud), 0)
			FROM holdings WHERE is_active = 1 AND UPPER(TRIM(ticker)) = ?`, snapshot.Ticker).
			Scan(&count, &snapshot.SecurityID, &snapshot.Name, &snapshot.Before, &value)
		if err != nil {
			return nil, err
		}
		if count > 1 {
			return nil, fmt.Errorf("ambiguous holding identity for %s", snapshot.Ticker)
		}
		if snapshot.Before > 0 {
			priceAUD = value / snapshot.Before
		}
		if count == 0 {
			// A new ASX holding can use its AUD quote. Never divide an AUD
			// ticket by an unconverted foreign quote to manufacture units.
			err = tx.QueryRow(`SELECT COUNT(*), COALESCE(MAX(security_id), 0),
				COALESCE(MAX(name), ''), COALESCE(MAX(CASE WHEN UPPER(ticker) LIKE 'ASX:%'
				THEN current_price ELSE 0 END), 0) FROM stock_analysis
				WHERE UPPER(TRIM(CASE WHEN INSTR(ticker, ':') > 0 THEN
				SUBSTR(ticker, INSTR(ticker, ':') + 1) ELSE ticker END)) = ?`, snapshot.Ticker).
				Scan(&count, &snapshot.SecurityID, &snapshot.Name, &priceAUD)
			if err != nil || count > 1 {
				return nil, fmt.Errorf("cannot resolve execution baseline for %s (matches %d): %v", snapshot.Ticker, count, err)
			}
		}
		if err := tx.QueryRow(`SELECT COALESCE((SELECT id FROM account_statements
			ORDER BY statement_date DESC, id DESC LIMIT 1), 0)`).Scan(&snapshot.StatementID); err != nil {
			return nil, err
		}
		switch {
		case reported != nil:
			snapshot.Expected = *reported
		case action.Intent == "EXIT":
			snapshot.Expected = snapshot.Before
		case action.AlertType == "WEIGHT_REDUCE" && finitePositive(priceAUD):
			snapshot.Expected = action.InstructionValue / priceAUD
		case action.Scope == "ASSET_CLASS" || canonicalAlertType(action.AlertType) == "SELL_DOWN":
			snapshot.Expected = snapshot.Before * 0.2
		case canonicalAlertType(action.AlertType) == "SELL_50":
			snapshot.Expected = snapshot.Before * 0.5
		case canonicalAlertType(action.AlertType) == "TRIM":
			snapshot.Expected = snapshot.Before * securityActionTrimFraction(action)
		case action.Intent == "DEPLOY" && finitePositive(priceAUD):
			snapshot.Expected = action.InstructionValue / priceAUD
		}
		result = append(result, snapshot)
	}
	return result, nil
}

func securityActionUnitsMatch(intent string, snapshot securityActionUnitSnapshot, actual float64, reported bool) bool {
	if !finitePositive(snapshot.Expected) || actual < 0 || math.IsNaN(actual) || math.IsInf(actual, 0) {
		return false
	}
	change := snapshot.Before - actual
	if intent == "DEPLOY" {
		change = -change
	}
	if intent == "EXIT" && actual > 0.0001 {
		return false
	}
	tolerance := 0.0001
	if !reported {
		tolerance += snapshot.Expected * estimatedActionUnitTolerance
	}
	return change > 0 && math.Abs(change-snapshot.Expected) <= tolerance
}

func statementQuantityForAction(statementID int64, snapshot securityActionUnitSnapshot) (float64, bool, error) {
	if snapshot.StatementID > 0 {
		var newer bool
		err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM account_statements current
			JOIN account_statements baseline ON baseline.id = ?
			WHERE current.id = ? AND current.account_name = baseline.account_name
			AND date(current.statement_date) > date(baseline.statement_date))`, snapshot.StatementID, statementID).Scan(&newer)
		if err != nil || !newer {
			return 0, false, err
		}
	}
	var count int
	var quantity float64
	if snapshot.SecurityID > 0 {
		err := db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(quantity), 0)
			FROM statement_holdings WHERE statement_id = ? AND security_id = ?`, statementID, snapshot.SecurityID).
			Scan(&count, &quantity)
		if err != nil || count > 0 {
			return quantity, count == 1, err
		}
		// Absence means zero only with stable identity and a fully resolved
		// complete broker snapshot. An unresolved name is not proof of exit.
		var unresolved int
		err = db.QueryRow(`SELECT COUNT(*) FROM statement_holdings
			WHERE statement_id = ? AND COALESCE(security_id, 0) = 0`, statementID).Scan(&unresolved)
		return 0, unresolved == 0, err
	}
	if snapshot.Name == "" {
		return 0, false, nil
	}
	err := db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(quantity), 0)
		FROM statement_holdings WHERE statement_id = ? AND LOWER(TRIM(details)) = LOWER(TRIM(?))`,
		statementID, snapshot.Name).Scan(&count, &quantity)
	return quantity, count == 1, err
}
