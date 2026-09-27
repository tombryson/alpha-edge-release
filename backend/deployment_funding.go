package main

import (
	"database/sql"
	"fmt"
	"math"
	"strings"
	"sync"
)

// Serialize ticket projections and execution reports in the single-process
// backend. Execution also checks funding inside its database transaction.
var deploymentFundingMu sync.Mutex

type fundingReader interface {
	actionQueryReader
	Query(string, ...interface{}) (*sql.Rows, error)
}

type deploymentFunding struct {
	Cash               float64
	Committed          float64
	Requested          float64
	UnknownPurchase    bool
	ClassCash          map[string]float64
	ClassSpent         map[string]float64
	SecuritySpent      map[string]float64
	ClassSecuritySpent map[string]map[string]float64
}

func loadDeploymentFunding(reader fundingReader) (deploymentFunding, error) {
	f := deploymentFunding{ClassCash: map[string]float64{}, ClassSpent: map[string]float64{}, SecuritySpent: map[string]float64{}, ClassSecuritySpent: map[string]map[string]float64{}}
	err := reader.QueryRow(`SELECT cash_aud FROM account_statements
		ORDER BY statement_date DESC, id DESC LIMIT 1`).Scan(&f.Cash)
	if err != nil && err != sql.ErrNoRows {
		return f, err
	}
	if math.IsNaN(f.Cash) || math.IsInf(f.Cash, 0) {
		return f, fmt.Errorf("invalid statement cash")
	}
	f.Cash = math.Max(f.Cash, 0)
	// Reserves are proposed allocations of broker cash, never additional cash.
	// Expected sale proceeds and deposits do not become usable merely because
	// someone recorded an intent. Their pending increments remain excluded.
	rows, err := reader.Query(`SELECT UPPER(TRIM(c.code)), MAX(COALESCE(c.cash_reserve, 0), 0)
		FROM asset_class_config c WHERE c.active = 1`)
	if err != nil {
		return f, err
	}
	for rows.Next() {
		var class string
		var value float64
		if err := rows.Scan(&class, &value); err != nil {
			rows.Close()
			return f, err
		}
		f.ClassCash[class] = value
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return f, err
	}
	rows, err = reader.Query(`SELECT UPPER(TRIM(asset_class_code)), amount_delta
		FROM cash_movements WHERE source_type IN ('STOCK_SALE', 'EXTERNAL_CAPITAL')
		AND status IN ('PENDING', 'MISMATCH') ORDER BY id`)
	if err != nil {
		return f, err
	}
	pending := map[string]float64{}
	for rows.Next() {
		var class string
		var delta float64
		if err := rows.Scan(&class, &delta); err != nil {
			rows.Close()
			return f, err
		}
		// A downward revision cancels expected funding first. Floor each step:
		// an earlier reduction of actual cash cannot pre-fund a later sale claim.
		pending[class] = math.Max(pending[class]+delta, 0)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return f, err
	}
	for class, cash := range f.ClassCash {
		f.ClassCash[class] = math.Max(cash-pending[class], 0)
		f.Requested += f.ClassCash[class]
	}
	// Retain unresolved purchase commitments even if a ticker is reclassified,
	// archived, or no longer has a current target. Confirmed buys are already
	// reflected in the broker statement and must not be deducted again.
	rows, err = reader.Query(`SELECT COALESCE(asset_class_code, ''), ticker,
		MAX(COALESCE(execution_cash_value, instruction_value, 0), 0)
		FROM security_actions WHERE intent = 'DEPLOY'
		AND status IN ('AWAITING_STATEMENT', 'VARIANCE')
		AND reconciliation_method != 'MANUAL_EXTERNAL'`)
	if err != nil {
		return f, err
	}
	defer rows.Close()
	for rows.Next() {
		var class, ticker string
		var value float64
		if err := rows.Scan(&class, &ticker, &value); err != nil {
			return f, err
		}
		if !finitePositive(value) {
			f.UnknownPurchase = true
		}
		f.Committed += value
		class = strings.ToUpper(strings.TrimSpace(class))
		f.ClassSpent[class] += value
		f.SecuritySpent[securityActionTicker(ticker)] += value
		f.recordClassSecuritySpend(class, ticker, value)
	}
	return f, rows.Err()
}

func (f *deploymentFunding) recordClassSecuritySpend(class, ticker string, value float64) {
	if f.ClassSecuritySpent == nil {
		f.ClassSecuritySpent = map[string]map[string]float64{}
	}
	if f.ClassSecuritySpent[class] == nil {
		f.ClassSecuritySpent[class] = map[string]float64{}
	}
	f.ClassSecuritySpent[class][securityActionTicker(ticker)] += value
}

func (f deploymentFunding) available() float64 {
	return math.Max(f.Cash-f.Committed, 0)
}

func (f deploymentFunding) reason() string {
	if f.UnknownPurchase {
		return "A reported purchase has no reliable cash amount; reconcile it before funding further buys"
	}
	if f.Requested > f.Cash+0.005 {
		return fmt.Sprintf("Class cash proposals total $%.0f but statement cash is $%.0f; revise class funding", f.Requested, f.Cash)
	}
	remainingProposals := 0.0
	for class, cash := range f.ClassCash {
		remainingProposals += math.Max(cash-f.ClassSpent[class], 0)
	}
	if remainingProposals > f.available()+0.005 {
		return "Class cash proposals exceed cash remaining after reported purchases; revise class funding"
	}
	if f.available() < deploymentMinimumTicket {
		return "Statement cash remaining after reported purchases is below the $100 broker minimum"
	}
	return ""
}

func validateDeploymentExecution(tx *sql.Tx, action SecurityAction, units *float64) (float64, error) {
	if action.IsExternal || action.Intent != "DEPLOY" {
		return 0, nil
	}
	if action.Status != securityActionOpen || action.DeploymentState != deploymentStateFunded {
		return 0, fmt.Errorf("this deployment has no funded class-pool ticket")
	}
	capacities, err := deploymentClassCapacitiesFrom(tx)
	if err != nil {
		return 0, err
	}
	capacity := capacities[action.AssetClassCode]
	permission, err := deploymentSecurityPermission(tx, action.Ticker, action.AlertType, action.Source, action.AssetClassCode, capacity.Risk)
	if err != nil {
		return 0, err
	}
	if permission.State != "" {
		return 0, fmt.Errorf("%s", permission.Reason)
	}
	f, err := loadDeploymentFunding(tx)
	if err != nil {
		return 0, err
	}
	if reason := f.reason(); reason != "" {
		return 0, fmt.Errorf("%s", reason)
	}
	capacity = capacity.forSecurity(action.Ticker, f)
	var class string
	if err := tx.QueryRow(`SELECT asset_class_code FROM security_actions WHERE id = ?`, action.ID).Scan(&class); err != nil {
		return 0, err
	}
	value := action.InstructionValue
	if units != nil {
		var price float64
		err := tx.QueryRow(`SELECT COALESCE((SELECT SUM(value_aud) / NULLIF(SUM(quantity), 0)
			FROM holdings WHERE is_active = 1 AND UPPER(TRIM(ticker)) = ?),
			(SELECT CASE WHEN COUNT(*) = 1 THEN MAX(CASE WHEN UPPER(TRIM(ticker)) LIKE 'ASX:%'
			THEN current_price ELSE 0 END) ELSE 0 END FROM stock_analysis
			WHERE UPPER(TRIM(CASE WHEN INSTR(ticker, ':') > 0
			THEN SUBSTR(ticker, INSTR(ticker, ':') + 1) ELSE ticker END)) = ?), 0)`,
			securityActionTicker(action.Ticker), securityActionTicker(action.Ticker)).Scan(&price)
		if err != nil {
			return 0, err
		}
		if !finitePositive(price) {
			return 0, fmt.Errorf("cannot estimate reported purchase cost in AUD; an AUD price is required")
		}
		value = math.Max(value, *units*price)
	}
	if !finitePositive(value) || value > f.available()+0.005 || value > f.ClassCash[class]-f.ClassSpent[class]+0.005 {
		return 0, fmt.Errorf("reported purchase exceeds available statement-backed class cash; refresh funding before recording")
	}
	if value > capacity.TargetShortfall+0.005 {
		return 0, fmt.Errorf("reported purchase exceeds the current class budget; record an exception only if already executed")
	}
	_, shortfall, err := securityActionTargetValueFrom(tx, action.Ticker, capacity)
	if err != nil {
		return 0, err
	}
	if value > shortfall-f.SecuritySpent[securityActionTicker(action.Ticker)]+0.005 {
		return 0, fmt.Errorf("reported purchase exceeds the current security target; record an exception only if already executed")
	}
	return value, nil
}
