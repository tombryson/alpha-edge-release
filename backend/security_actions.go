package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

const securityActionPolicyVersion = "security-action-v1"

const deploymentTicketPolicyVersion = "pooled-capital-optional-weight-v5"

const (
	deploymentStateFunded            = "FUNDED"
	deploymentStateCDFBlocked        = "CDF_BLOCKED"
	deploymentStateTargetUnavailable = "TARGET_UNAVAILABLE"
	deploymentStateInsufficientFunds = "INSUFFICIENT_FUNDS"
	deploymentStateBelowMinimum      = "BELOW_MINIMUM"
)

const (
	deploymentMinimumTicket  = 100.0
	deploymentTicketFraction = 0.10
)

const (
	securityActionOpen              = "OPEN"
	securityActionBlocked           = "BLOCKED"
	securityActionAwaitingStatement = "AWAITING_STATEMENT"
	securityActionConfirmed         = "CONFIRMED"
	securityActionVariance          = "VARIANCE"
	securityActionIgnored           = "IGNORED"
	securityActionExpired           = "EXPIRED"
	securityActionOverridden        = "OVERRIDDEN"
	securityActionNotApplicable     = "NOT_APPLICABLE"
)

type SecurityAction struct {
	ID                       int              `json:"id"`
	AlertID                  int              `json:"alert_id"`
	Ticker                   string           `json:"ticker"`
	AlertType                string           `json:"alert_type"`
	Strength                 string           `json:"strength,omitempty"`
	Timeframe                string           `json:"timeframe,omitempty"`
	Source                   string           `json:"source,omitempty"`
	Scope                    string           `json:"scope"`
	AssetClassCode           string           `json:"asset_class_code,omitempty"`
	AffectedTickers          []string         `json:"affected_tickers,omitempty"`
	SourceEventKey           string           `json:"source_event_key,omitempty"`
	Intent                   string           `json:"intent"`
	InstructionBasis         string           `json:"instruction_basis"`
	Instruction              string           `json:"instruction"`
	Priority                 int              `json:"priority"`
	Status                   string           `json:"status"`
	BlockedByActionID        *int             `json:"blocked_by_action_id,omitempty"`
	BlockedByInstruction     string           `json:"blocked_by_instruction,omitempty"`
	HoldingQuantitySnapshot  float64          `json:"holding_quantity_snapshot"`
	HoldingValueSnapshot     float64          `json:"holding_value_snapshot"`
	HoldingPriceSnapshot     float64          `json:"holding_price_snapshot"`
	DeploymentState          string           `json:"deployment_state,omitempty"`
	DeploymentPolicyVersion  string           `json:"deployment_policy_version,omitempty"`
	InstructionValue         float64          `json:"instruction_value,omitempty"`
	TargetValue              float64          `json:"target_value,omitempty"`
	TargetShortfallValue     float64          `json:"target_shortfall_value,omitempty"`
	ClassFundingBefore       float64          `json:"class_funding_before,omitempty"`
	ClassFundingAfter        float64          `json:"class_funding_after,omitempty"`
	ExecutionReportedAt      *time.Time       `json:"execution_reported_at,omitempty"`
	ExecutionNote            string           `json:"execution_note,omitempty"`
	ExecutionUnits           *float64         `json:"execution_units,omitempty"`
	ExecutionCashValue       *float64         `json:"execution_cash_value,omitempty"`
	ExecutionExceptionReason string           `json:"execution_exception_reason,omitempty"`
	ExecutionPolicySnapshot  string           `json:"execution_policy_snapshot,omitempty"`
	PurchaseExceptionAllowed bool             `json:"can_record_purchase_exception"`
	ReconciliationMethod     string           `json:"reconciliation_method,omitempty"`
	IsExternal               bool             `json:"is_external"`
	OverrideReason           string           `json:"override_reason,omitempty"`
	NextReviewAt             *time.Time       `json:"next_review_at,omitempty"`
	ReconciledStatementID    *int             `json:"reconciled_statement_id,omitempty"`
	ReconciledAt             *time.Time       `json:"reconciled_at,omitempty"`
	CreatedAt                time.Time        `json:"created_at"`
	UpdatedAt                time.Time        `json:"updated_at"`
	QueueCount               int              `json:"queue_count"`
	IsPrimary                bool             `json:"is_primary"`
	WeightEvidence           *weightReference `json:"weight_evidence,omitempty"`
	ClosedReason             string           `json:"closed_reason,omitempty"`
}

type securityActionSpec struct {
	Scope            string
	Intent           string
	InstructionBasis string
	Instruction      string
	Priority         int
}

func ensureSecurityActionSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS security_actions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			alert_id INTEGER NOT NULL UNIQUE,
			ticker TEXT NOT NULL,
			scope TEXT NOT NULL DEFAULT 'SECURITY' CHECK(scope IN ('SECURITY', 'ASSET_CLASS', 'PORTFOLIO')),
			asset_class_code TEXT NOT NULL DEFAULT '',
			affected_tickers_json TEXT NOT NULL DEFAULT '[]',
			source_event_key TEXT UNIQUE,
			intent TEXT NOT NULL CHECK(intent IN ('DEPLOY', 'REDUCE', 'EXIT', 'REVIEW')),
			instruction_basis TEXT NOT NULL DEFAULT 'NONE',
			instruction TEXT NOT NULL DEFAULT '',
			priority INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'BLOCKED', 'AWAITING_STATEMENT', 'CONFIRMED', 'VARIANCE', 'IGNORED', 'EXPIRED', 'OVERRIDDEN', 'NOT_APPLICABLE')),
			blocked_by_action_id INTEGER,
			holding_quantity_snapshot REAL NOT NULL DEFAULT 0,
			holding_value_snapshot REAL NOT NULL DEFAULT 0,
			holding_price_snapshot REAL NOT NULL DEFAULT 0,
			policy_version TEXT NOT NULL DEFAULT 'security-action-v1',
			deployment_state TEXT NOT NULL DEFAULT '',
			deployment_policy_version TEXT NOT NULL DEFAULT '',
			instruction_value REAL NOT NULL DEFAULT 0,
			target_value REAL NOT NULL DEFAULT 0,
			target_shortfall_value REAL NOT NULL DEFAULT 0,
			class_funding_before REAL NOT NULL DEFAULT 0,
			class_funding_after REAL NOT NULL DEFAULT 0,
			execution_reported_at DATETIME,
			execution_sync_id INTEGER,
			execution_note TEXT,
			override_reason TEXT,
			next_review_at DATETIME,
			reconciled_statement_id INTEGER,
			reconciled_at DATETIME,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(alert_id) REFERENCES alerts(id),
			FOREIGN KEY(blocked_by_action_id) REFERENCES security_actions(id),
			FOREIGN KEY(reconciled_statement_id) REFERENCES account_statements(id)
		);
		CREATE INDEX IF NOT EXISTS idx_security_actions_queue
			ON security_actions(ticker, status, priority, created_at, id);
		CREATE INDEX IF NOT EXISTS idx_security_actions_alert ON security_actions(alert_id);
	`)
	if err != nil {
		return err
	}
	// Existing installations already have the original table. SQLite's CREATE
	// TABLE IF NOT EXISTS does not add new columns, so keep this migration local
	// to the queue schema rather than forcing a table rebuild.
	for _, statement := range []string{
		`ALTER TABLE security_actions ADD COLUMN asset_class_code TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE security_actions ADD COLUMN affected_tickers_json TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE security_actions ADD COLUMN source_event_key TEXT`,
		`ALTER TABLE security_actions ADD COLUMN deployment_state TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE security_actions ADD COLUMN deployment_policy_version TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE security_actions ADD COLUMN instruction_value REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE security_actions ADD COLUMN target_value REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE security_actions ADD COLUMN target_shortfall_value REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE security_actions ADD COLUMN class_funding_before REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE security_actions ADD COLUMN class_funding_after REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE security_actions ADD COLUMN execution_units REAL`,
		`ALTER TABLE security_actions ADD COLUMN execution_cash_value REAL`,
		`ALTER TABLE security_actions ADD COLUMN execution_exception_reason TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE security_actions ADD COLUMN execution_policy_snapshot TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE security_actions ADD COLUMN execution_snapshot_json TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE security_actions ADD COLUMN reconciliation_method TEXT NOT NULL DEFAULT ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_security_actions_source_event ON security_actions(source_event_key)`,
	} {
		if _, migrationErr := db.Exec(statement); migrationErr != nil && !strings.Contains(strings.ToLower(migrationErr.Error()), "duplicate column name") {
			return migrationErr
		}
	}
	_, err = db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_security_actions_asset_class
			ON security_actions(asset_class_code, status, priority, created_at, id)
	`)
	return err
}

func securityActionSpecForAlert(alertType, source string) (securityActionSpec, bool) {
	source = strings.TrimSpace(source)
	canonicalType := canonicalAlertType(alertType)
	if source == "q3d" || source == "q4d" || (source == "ctf" && canonicalType != "EQUITY_REGIME_STRONG_TRIM") {
		return securityActionSpec{}, false
	}

	switch canonicalType {
	case "SELL":
		return securityActionSpec{"SECURITY", "EXIT", "TARGET_HOLDING_VALUE", "Exit remaining holding", 0}, true
	case "SELL_50":
		return securityActionSpec{"SECURITY", "REDUCE", "PERCENT_OF_CURRENT_HOLDING", "Sell Down 50% of current holding", 1}, true
	case "SELL_DOWN":
		return securityActionSpec{"SECURITY", "REDUCE", "PERCENT_OF_CURRENT_HOLDING", "Sell Down 20% of current holding", 1}, true
	case "TRIM":
		return securityActionSpec{"SECURITY", "REDUCE", "NONE", "Trim using source instruction", 1}, true
	case "WEIGHT_REDUCE":
		return securityActionSpec{"SECURITY", "REDUCE", "DOLLAR_VALUE", "Reduce exposure", 1}, true
	case "WEIGHT_CLASS_REVIEW":
		return securityActionSpec{"ASSET_CLASS", "REVIEW", "NONE", "Review class allocation", 3}, true
	case "ADD":
		return securityActionSpec{"SECURITY", "DEPLOY", "TARGET_HOLDING_VALUE", "Add within current permitted capacity", 2}, true
	case "BUY":
		return securityActionSpec{"SECURITY", "DEPLOY", "TARGET_HOLDING_VALUE", "Deploy within current permitted capacity", 2}, true
	case "BREAKOUT":
		return securityActionSpec{"SECURITY", "DEPLOY", "TARGET_HOLDING_VALUE", "Deploy within current permitted capacity", 2}, true
	case "REENTRY":
		return securityActionSpec{"SECURITY", "DEPLOY", "TARGET_HOLDING_VALUE", "Re-enter within current permitted capacity", 2}, true
	case "EQUITY_REGIME_STRONG_TRIM":
		if strings.TrimSpace(source) != "ctf" {
			return securityActionSpec{}, false
		}
		return securityActionSpec{"ASSET_CLASS", "REDUCE", "PERCENT_OF_CURRENT_HOLDING", "Reduce each affected producer-equity holding by 20%", 1}, true
	default:
		return securityActionSpec{}, false
	}
}

func securityActionTicker(ticker string) string {
	parts := strings.Split(strings.ToUpper(strings.TrimSpace(ticker)), ":")
	return strings.TrimSpace(parts[len(parts)-1])
}

func securityActionHoldingSnapshot(ticker string) (quantity, value, price float64) {
	symbol := securityActionTicker(ticker)
	if symbol == "" {
		return 0, 0, 0
	}
	_ = db.QueryRow(`
		SELECT quantity, value_aud, current_price
		FROM holdings
		WHERE is_active = 1
		  AND UPPER(TRIM(COALESCE(ticker, ''))) = ?
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
	`, symbol).Scan(&quantity, &value, &price)
	return quantity, value, price
}

type deploymentClassCapacity struct {
	AssetClass       string
	DisplayName      string
	StrategicWeight  float64
	TargetValue      float64
	CurrentValue     float64
	TargetShortfall  float64
	CashReserve      float64
	AvailableFunding float64
	Risk             deploymentRisk
	ApprovedTarget   float64
	WorkingTarget    float64
	TotalCurrent     float64
	EffectiveETF     float64
	ActualETF        float64
	ETFs             map[string]ETFAllocationLedgerRow
	WeightEnabled    bool
}

type deploymentActionCandidate struct {
	ID               int
	Ticker           string
	AlertType        string
	Source           string
	Status           string
	CreatedAt        time.Time
	InstructionValue float64
}

// The approved class budget remains authoritative in both policy modes.
// Model headroom is never cash.
func deploymentClassCapacities() (map[string]deploymentClassCapacity, error) {
	return deploymentClassCapacitiesFrom(db)
}

func deploymentClassCapacitiesFrom(reader deploymentReader) (map[string]deploymentClassCapacity, error) {
	mode, err := readWeightPolicy(reader)
	if err != nil {
		return nil, err
	}
	portfolio, err := buildOverlayPortfolioContextFrom(context.Background(), reader)
	if err == sql.ErrNoRows {
		return map[string]deploymentClassCapacity{}, nil
	}
	if err != nil {
		return nil, err
	}
	approved, err := deploymentApprovedWeights(reader)
	if err != nil {
		return nil, err
	}
	risk, err := loadDeploymentRisk(reader)
	if err != nil {
		return nil, err
	}
	ledger, err := buildETFAllocationLedgerFrom(reader, portfolio)
	if err != nil {
		return nil, err
	}
	classImplementations := map[string]ETFAllocationClassSummary{}
	fundsByClass := map[string]map[string]ETFAllocationLedgerRow{}
	for _, class := range ledger.Classes {
		classImplementations[class.AssetClass] = class
		fundsByClass[class.AssetClass] = map[string]ETFAllocationLedgerRow{}
	}
	for _, fund := range ledger.Rows {
		if fundsByClass[fund.AssetClass] == nil {
			fundsByClass[fund.AssetClass] = map[string]ETFAllocationLedgerRow{}
		}
		fundsByClass[fund.AssetClass][securityActionTicker(fund.Ticker)] = fund
	}
	for _, fund := range ledger.Candidates {
		if fundsByClass[fund.AssetClass] == nil {
			fundsByClass[fund.AssetClass] = map[string]ETFAllocationLedgerRow{}
		}
		fundsByClass[fund.AssetClass][securityActionTicker(fund.Ticker)] = ETFAllocationLedgerRow{}
	}

	assetClassKeys := make(map[string]struct{}, len(portfolio.AssetClassKeys))
	for assetClass := range portfolio.AssetClassKeys {
		assetClassKeys[assetClass] = struct{}{}
	}
	for _, setting := range getOverlayAssetClassSettings() {
		assetClassKeys[setting.Key] = struct{}{}
	}
	for class := range approved {
		assetClassKeys[class] = struct{}{}
	}

	capacities := make(map[string]deploymentClassCapacity, len(assetClassKeys))
	for assetClass := range assetClassKeys {
		assetClass = strings.ToUpper(strings.TrimSpace(assetClass))
		if assetClass == "" {
			continue
		}
		strategicWeight := portfolio.DirectStockWeightByClass[assetClass]

		setting := getOverlayAssetClassSetting(assetClass)
		implementation := classImplementations[assetClass]
		budgetValue := portfolio.StatementTotalValue * approved[assetClass] / 100 * deploymentBudgetFactor(risk.Q3, q3ThrottleFactorForSetting(setting))
		targetValue := implementation.StockCapacityValue
		currentValue := 0.0
		if summary := portfolio.ClassSummaries[assetClass]; summary != nil {
			currentValue = summary.ActualInvestedValue
		}
		directCurrent := math.Max(currentValue-implementation.ActualETFValue, 0)
		shortfall := math.Max(math.Min(targetValue-directCurrent, budgetValue-currentValue), 0)
		cashReserve := math.Max(setting.CashReserve, 0)
		capacities[assetClass] = deploymentClassCapacity{
			AssetClass:       assetClass,
			DisplayName:      setting.DisplayName,
			StrategicWeight:  strategicWeight,
			TargetValue:      targetValue,
			CurrentValue:     directCurrent,
			TargetShortfall:  shortfall,
			CashReserve:      cashReserve,
			AvailableFunding: math.Min(cashReserve, shortfall),
			Risk:             risk,
			ApprovedTarget:   implementation.ClassTargetValue,
			WorkingTarget:    budgetValue,
			TotalCurrent:     currentValue,
			EffectiveETF:     implementation.EffectiveTargetValue,
			ActualETF:        implementation.ActualETFValue,
			ETFs:             fundsByClass[assetClass],
			WeightEnabled:    mode.Enabled,
		}
	}
	return capacities, nil
}

// Include reported purchases once: ETF purchases consume ETF capacity, stock
// purchases consume stock capacity, and both consume the working class ceiling.
func (capacity deploymentClassCapacity) forSecurity(ticker string, funding deploymentFunding) deploymentClassCapacity {
	pendingETF := 0.0
	for symbol := range capacity.ETFs {
		pendingETF += funding.ClassSecuritySpent[capacity.AssetClass][symbol]
	}
	pendingClass := funding.ClassSpent[capacity.AssetClass]
	classRemaining := capacity.WorkingTarget - capacity.TotalCurrent - pendingClass
	capacity.TargetValue = directStockBudget(capacity.ApprovedTarget, capacity.EffectiveETF, capacity.ActualETF+pendingETF)
	remaining := capacity.TargetValue - capacity.CurrentValue - math.Max(pendingClass-pendingETF, 0)
	if fund, ok := capacity.ETFs[securityActionTicker(ticker)]; ok {
		capacity.TargetValue = fund.EffectiveTargetValue
		capacity.CurrentValue = fund.ActualValue
		remaining = fund.EffectiveTargetValue - fund.ActualValue - funding.SecuritySpent[securityActionTicker(ticker)]
		if !capacity.WeightEnabled {
			remaining = classRemaining
		}
	}
	capacity.TargetShortfall = math.Max(math.Min(remaining, classRemaining), 0)
	capacity.AvailableFunding = math.Max(math.Min(capacity.TargetShortfall, funding.ClassCash[capacity.AssetClass]-pendingClass), 0)
	return capacity
}

// The optional individual ceiling is backend-owned; Off retains only the
// separately enforced class, signal and funding limits.
func securityActionTargetValue(ticker string, capacity deploymentClassCapacity) (targetValue, targetShortfall float64, err error) {
	return securityActionTargetValueFrom(db, ticker, capacity)
}

func securityActionTargetValueFrom(reader deploymentReader, ticker string, capacity deploymentClassCapacity) (targetValue, targetShortfall float64, err error) {
	mode, err := readWeightPolicy(reader)
	if err != nil {
		return 0, 0, err
	}
	if !mode.Enabled {
		// Class capacity is checked separately, including pending purchases.
		// Off must never retain the old stored individual allocation ceiling.
		return capacity.WorkingTarget, capacity.WorkingTarget, nil
	}
	return weightTargetFrom(reader, ticker, capacity)
}

func securityActionAssetClassForTicker(ticker string) (string, error) {
	canonicalTicker := canonicalSecurityTickerKey(ticker)
	if canonicalTicker == "" {
		return "", nil
	}

	sleeves := loadAssetClasses()
	groupDerivedByCompany := loadGroupDerivedAssetClasses(context.Background())
	rows, err := db.Query(`
		SELECT COALESCE(ticker, ''), name, COALESCE(primary_asset_class, ''), COALESCE(security_type, '')
		FROM stock_analysis
	`)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	for rows.Next() {
		var analysisTicker, name, primaryAssetClass, securityType string
		if err := rows.Scan(&analysisTicker, &name, &primaryAssetClass, &securityType); err != nil {
			return "", err
		}
		if canonicalSecurityTickerKey(analysisTicker) != canonicalTicker {
			continue
		}
		if isNonAllocatingSecurityType(securityType) || isNonAllocatingInstrumentName(name) {
			return "", nil
		}
		groupAssetClass := groupDerivedByCompany[strings.TrimSpace(name)]
		if groupAssetClass == "" {
			groupAssetClass = groupDerivedByCompany[canonicalCompanyNameKey(name)]
		}
		return resolveAuthoritativeAssetClassFromAssetClasses(groupAssetClass, primaryAssetClass, canonicalTicker, name, sleeves), nil
	}
	return "", rows.Err()
}

func deploymentActionVerb(alertType string) string {
	switch canonicalAlertType(alertType) {
	case "ADD":
		return "Add"
	case "REENTRY":
		return "Re-enter"
	default:
		return "Deploy"
	}
}

func deploymentInstruction(action deploymentActionCandidate, capacity deploymentClassCapacity, ticket, fundingBefore, fundingAfter, targetShortfall float64) string {
	return fmt.Sprintf(
		"%s $%.0f from %s class cash ($%.0f available -> $%.0f after; $%.0f target shortfall)",
		deploymentActionVerb(action.AlertType), ticket, capacity.DisplayName,
		fundingBefore, fundingAfter, targetShortfall,
	)
}

func updateDeploymentActionProjection(
	actionID int,
	state string,
	capacity deploymentClassCapacity,
	targetValue float64,
	targetShortfall float64,
	instructionValue float64,
	fundingBefore float64,
	fundingAfter float64,
	instruction string,
) error {
	instructionBasis := "NONE"
	if state == deploymentStateFunded {
		instructionBasis = "DOLLAR_VALUE"
	}
	_, err := db.Exec(`
		UPDATE security_actions
		SET deployment_state = ?, deployment_policy_version = ?, instruction_value = ?,
			target_value = ?, target_shortfall_value = ?, class_funding_before = ?,
			class_funding_after = ?, instruction_basis = ?, instruction = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, state, deploymentTicketPolicyVersion, instructionValue,
		targetValue, targetShortfall, fundingBefore, fundingAfter,
		instructionBasis, instruction, actionID)
	return err
}

// projectOpenDeploymentActions turns an already-queued deployment signal into
// one deterministic class-pool ticket. The ticket is never a Strong/Weak
// multiplier: evidence changes priority and review, not the order size.
func projectOpenDeploymentActions() error {
	deploymentFundingMu.Lock()
	defer deploymentFundingMu.Unlock()
	return projectOpenDeploymentActionsLocked()
}

func projectOpenDeploymentActionsLocked() error {
	if err := syncWeightPolicyLocked(); err != nil {
		log.Printf("[WEIGHT] Evidence unavailable: %v", err)
		tx, beginErr := db.Begin()
		if beginErr != nil {
			return beginErr
		}
		if closeErr := closeWeightActions(tx, "Weight evidence unavailable; review paused", ""); closeErr != nil {
			tx.Rollback()
			return closeErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return commitErr
		}
	}
	mode, err := readWeightPolicy(db)
	if err != nil {
		return err
	}
	if mode.Enabled {
		if err := prioritiseSecurityActions(); err != nil {
			return err
		}
	}
	capacities, err := deploymentClassCapacities()
	if err != nil {
		log.Printf("[DEPLOYMENT] Class allocation unavailable: %v", err)
		// An unavailable allocation input must pause purchases, not hide exits
		// and other existing instructions or leave an old funded ticket usable.
		_, updateErr := db.Exec(`UPDATE security_actions SET deployment_state = ?,
			instruction_value = 0, target_value = 0, target_shortfall_value = 0,
			class_funding_before = 0, class_funding_after = 0, instruction_basis = 'NONE',
			instruction = 'Class allocation data unavailable; purchase suggestions paused',
			deployment_policy_version = ?, updated_at = CURRENT_TIMESTAMP
			WHERE intent = 'DEPLOY' AND status = 'OPEN'`, deploymentStateTargetUnavailable, deploymentTicketPolicyVersion)
		return updateErr
	}
	funding, err := loadDeploymentFunding(db)
	if err != nil {
		return err
	}
	globalRemaining := funding.available()

	rows, err := db.Query(`
		SELECT sa.id, sa.ticker, a.alert_type, COALESCE(a.source, ''), sa.status, sa.created_at,
			COALESCE(sa.instruction_value, 0)
		FROM security_actions sa
		JOIN alerts a ON a.id = sa.alert_id
		WHERE sa.scope = 'SECURITY'
		  AND sa.intent = 'DEPLOY'
		  AND sa.status = 'OPEN'
		ORDER BY sa.created_at ASC, sa.id ASC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	candidates := make([]deploymentActionCandidate, 0)
	for rows.Next() {
		var action deploymentActionCandidate
		if err := rows.Scan(&action.ID, &action.Ticker, &action.AlertType, &action.Source, &action.Status, &action.CreatedAt, &action.InstructionValue); err != nil {
			return err
		}
		candidates = append(candidates, action)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	byClass := map[string][]deploymentActionCandidate{}
	for _, action := range candidates {
		external, err := securityActionIsExternal(db, action.Ticker)
		if err != nil {
			return err
		}
		if external {
			if err := updateDeploymentActionProjection(action.ID, deploymentStateTargetUnavailable,
				deploymentClassCapacity{}, 0, 0, 0, 0, 0, "External holding; no IG cash ticket"); err != nil {
				return err
			}
			continue
		}
		assetClass, err := securityActionAssetClassForTicker(action.Ticker)
		if err != nil {
			return err
		}
		assetClass = strings.ToUpper(strings.TrimSpace(assetClass))
		if _, ok := capacities[assetClass]; !ok {
			if err := updateDeploymentActionProjection(action.ID, deploymentStateTargetUnavailable,
				deploymentClassCapacity{}, 0, 0, 0, 0, 0, "No current asset-class funding target"); err != nil {
				return err
			}
			continue
		}
		if _, err := db.Exec(`UPDATE security_actions SET asset_class_code = ? WHERE id = ?`, assetClass, action.ID); err != nil {
			return err
		}
		byClass[assetClass] = append(byClass[assetClass], action)
	}

	classKeys := make([]string, 0, len(byClass))
	for assetClass := range byClass {
		classKeys = append(classKeys, assetClass)
	}
	sort.Strings(classKeys)
	for _, assetClass := range classKeys {
		actions := byClass[assetClass]
		for _, action := range actions {
			capacity := capacities[assetClass].forSecurity(action.Ticker, funding)
			remaining := math.Min(capacity.AvailableFunding, globalRemaining)
			permission, err := deploymentSecurityPermission(db, action.Ticker, action.AlertType, action.Source, assetClass, capacity.Risk)
			if err != nil {
				return err
			}
			if permission.State != "" {
				if err := updateDeploymentActionProjection(
					action.ID, permission.State, capacity, 0, 0, 0, remaining, remaining, permission.Reason,
				); err != nil {
					return err
				}
				continue
			}

			targetValue, targetShortfall, err := securityActionTargetValue(action.Ticker, capacity)
			if err != nil {
				log.Printf("[WEIGHT] Target unavailable for %s: %v", action.Ticker, err)
				targetValue, targetShortfall = 0, 0
			}
			targetShortfall = math.Max(targetShortfall-funding.SecuritySpent[securityActionTicker(action.Ticker)], 0)
			if targetValue <= 0 {
				if err := updateDeploymentActionProjection(
					action.ID, deploymentStateTargetUnavailable, capacity, targetValue, targetShortfall, 0, remaining, remaining,
					"Add paused: ideal weight unavailable; review research and data freshness",
				); err != nil {
					return err
				}
				continue
			}
			if capacity.WeightEnabled && targetShortfall <= 0 {
				if err := updateDeploymentActionProjection(action.ID, "WEIGHT_LIMIT", capacity,
					targetValue, 0, 0, remaining, remaining, "Add paused: at ideal weight, including pending purchases"); err != nil {
					return err
				}
				continue
			}
			if capacity.TargetShortfall <= 0 || targetShortfall <= 0 {
				if err := updateDeploymentActionProjection(action.ID, "CAPACITY_REACHED", capacity,
					targetValue, targetShortfall, 0, 0, 0,
					"Current class or security capacity is fully used, including purchases awaiting statements"); err != nil {
					return err
				}
				continue
			}
			if reason := funding.reason(); reason != "" {
				if err := updateDeploymentActionProjection(action.ID, deploymentStateInsufficientFunds,
					capacity, targetValue, targetShortfall, 0, 0, 0, reason); err != nil {
					return err
				}
				continue
			}
			if remaining <= 0 {
				if err := updateDeploymentActionProjection(
					action.ID, deploymentStateInsufficientFunds, capacity, targetValue, targetShortfall, 0, remaining, remaining,
					"No deployable class cash remains against the current direct-stock target",
				); err != nil {
					return err
				}
				continue
			}

			baseTicket := math.Max(deploymentMinimumTicket, deploymentTicketFraction*capacity.AvailableFunding)
			ticket := math.Min(baseTicket, math.Min(targetShortfall, remaining))
			if ticket < deploymentMinimumTicket {
				if err := updateDeploymentActionProjection(
					action.ID, deploymentStateBelowMinimum, capacity, targetValue, targetShortfall, 0, remaining, remaining,
					"Available purchase room is below the $100 broker minimum",
				); err != nil {
					return err
				}
				continue
			}
			after := math.Max(remaining-ticket, 0)
			if err := updateDeploymentActionProjection(
				action.ID, deploymentStateFunded, capacity, targetValue, targetShortfall, ticket, remaining, after,
				deploymentInstruction(action, capacity, ticket, remaining, after, targetShortfall),
			); err != nil {
				return err
			}
			funding.ClassSpent[assetClass] += ticket
			funding.SecuritySpent[securityActionTicker(action.Ticker)] += ticket
			funding.recordClassSecuritySpend(assetClass, action.Ticker, ticket)
			globalRemaining = math.Max(globalRemaining-ticket, 0)
		}
	}
	return nil
}

func ensureSecurityActionForAlertID(alertID int) error {
	var ticker, alertType, source string
	if err := db.QueryRow(`
		SELECT ticker, alert_type, COALESCE(source, '')
		FROM alerts
		WHERE id = ?
	`, alertID).Scan(&ticker, &alertType, &source); err != nil {
		return err
	}

	spec, ok := securityActionSpecForAlert(alertType, source)
	if !ok {
		return nil
	}
	quantity, value, price := securityActionHoldingSnapshot(ticker)
	_, err := db.Exec(`
		INSERT INTO security_actions (
			alert_id, ticker, scope, intent, instruction_basis, instruction,
			priority, holding_quantity_snapshot, holding_value_snapshot,
			holding_price_snapshot, policy_version
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(alert_id) DO NOTHING
	`, alertID, securityActionTicker(ticker), spec.Scope, spec.Intent, spec.InstructionBasis,
		spec.Instruction, spec.Priority, quantity, value, price, securityActionPolicyVersion)
	return err
}

// projectCommodityThemeAssetClassAction turns one already-recorded theme event
// into one queue row. The synthetic alert remains the immutable evidence link;
// the action itself carries the class membership snapshot so it is never copied
// into a separate task for every affected holding.
func projectCommodityThemeAssetClassAction(
	sourceEventKey string,
	themeCode string,
	assetClassCode string,
	affectedTickers []string,
	holdingValue float64,
) error {
	sourceEventKey = strings.TrimSpace(sourceEventKey)
	if sourceEventKey == "" {
		return fmt.Errorf("commodity theme action requires a source event key")
	}
	if len(affectedTickers) == 0 || holdingValue <= 0 {
		return nil
	}

	var existingID int
	err := db.QueryRow(`SELECT id FROM security_actions WHERE source_event_key = ?`, sourceEventKey).Scan(&existingID)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}

	assetClassCode = strings.ToUpper(strings.TrimSpace(assetClassCode))
	affectedJSON, err := json.Marshal(affectedTickers)
	if err != nil {
		return err
	}
	result, err := db.Exec(`
		INSERT INTO alerts (
			ticker, alert_type, strength, exchange_prefix, timeframe, source,
			affected_positions, is_active
		) VALUES (?, 'EQUITY_REGIME_STRONG_TRIM', 'HIGH', 'ASSET_CLASS:', '1D', 'ctf', ?, 1)
	`, "ASSET_CLASS:"+assetClassCode, string(affectedJSON))
	if err != nil {
		return err
	}
	alertID, err := result.LastInsertId()
	if err != nil {
		return err
	}
	if err := ensureSecurityActionForAlertID(int(alertID)); err != nil {
		return err
	}
	_, err = db.Exec(`
		UPDATE security_actions
		SET scope = 'ASSET_CLASS', asset_class_code = ?, affected_tickers_json = ?,
			source_event_key = ?, holding_quantity_snapshot = 0,
			holding_value_snapshot = ?, holding_price_snapshot = 0,
			instruction = ?, updated_at = CURRENT_TIMESTAMP
		WHERE alert_id = ?
	`, assetClassCode, string(affectedJSON), sourceEventKey, holdingValue,
		fmt.Sprintf("Reduce each affected %s holding by 20%% ($%.0f across %d holdings)", strings.ToLower(strings.ReplaceAll(assetClassCode, "_", " ")), holdingValue*0.20, len(affectedTickers)),
		alertID)
	if err != nil {
		return err
	}
	log.Printf("[SECURITY ACTIONS] Projected %s Equity Regime Strong Trim for %d holdings", themeCode, len(affectedTickers))
	return nil
}

func backfillOpenSecurityActions() error {
	rows, err := db.Query(`
		SELECT id
		FROM alerts
		WHERE is_active = 1
		  AND UPPER(TRIM(alert_type)) NOT IN ('REGIME', 'CONNECT', 'CONNECTED', 'CONNECTION')
		ORDER BY id ASC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var alertID int
		if err := rows.Scan(&alertID); err != nil {
			return err
		}
		if err := ensureSecurityActionForAlertID(alertID); err != nil {
			return err
		}
	}
	return rows.Err()
}

func securityActionTerminalStatus(status string) bool {
	switch status {
	case securityActionConfirmed, securityActionIgnored, securityActionExpired, securityActionNotApplicable:
		return true
	default:
		return false
	}
}

func securityActionTableMissing(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "no such table: security_actions")
}

func activeExitActionForAlert(alertID int) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM security_actions
		WHERE alert_id = ?
		  AND intent = 'EXIT'
		  AND status NOT IN ('CONFIRMED', 'IGNORED', 'EXPIRED', 'NOT_APPLICABLE')
	`, alertID).Scan(&count)
	if securityActionTableMissing(err) {
		return false, nil
	}
	return count > 0, err
}

func syncLegacyDecisionIntoSecurityAction(alertID int, decision string, notes *string, units *float64) error {
	var actionID int
	if err := db.QueryRow(`SELECT id FROM security_actions WHERE alert_id = ?`, alertID).Scan(&actionID); err != nil {
		if securityActionTableMissing(err) || err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	if err := projectOpenDeploymentActions(); err != nil {
		return err
	}
	action, err := loadOpenSecurityAction(actionID)
	if err != nil {
		return err
	}
	if action.Status == securityActionAwaitingStatement || securityActionTerminalStatus(action.Status) {
		return nil
	}
	status := securityActionAwaitingStatement
	if strings.EqualFold(strings.TrimSpace(decision), "IGNORE") {
		status = securityActionIgnored
	}
	note := ""
	if notes != nil {
		note = strings.TrimSpace(*notes)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	method, snapshotJSON := "", []byte("[]")
	if status == securityActionAwaitingStatement {
		snapshots, err := captureSecurityActionUnits(tx, action, units)
		if err != nil {
			return err
		}
		snapshotJSON, err = json.Marshal(snapshots)
		if err != nil {
			return err
		}
		method = "ESTIMATED_UNITS"
		if canonicalAlertType(action.AlertType) == "TRIM" && securityActionTrimFraction(action) == 0 {
			method = "QUANTITY_DIRECTION"
		}
		if units != nil {
			method = "REPORTED_UNITS"
		}
		if action.IsExternal || actionUnitsAllExternal(snapshots) {
			status, method = securityActionConfirmed, "MANUAL_EXTERNAL"
		}
	}
	var syncID int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM sync_history`).Scan(&syncID); err != nil {
		return err
	}
	_, err = tx.Exec(`
		UPDATE security_actions
		SET status = ?, execution_reported_at = CASE WHEN ? != 'IGNORED' THEN CURRENT_TIMESTAMP ELSE execution_reported_at END,
			execution_sync_id = ?, execution_note = ?, execution_snapshot_json = ?, reconciliation_method = ?, execution_units = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE alert_id = ?
	`, status, status, syncID, note, string(snapshotJSON), method, units, alertID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func securityActionStatusRank(status string) int {
	switch status {
	case securityActionVariance:
		return 0
	case securityActionAwaitingStatement:
		return 1
	case securityActionOverridden:
		return 2
	case securityActionOpen:
		return 3
	case securityActionBlocked:
		return 4
	default:
		return 9
	}
}

type securityActionQueueRow struct {
	ID        int
	Ticker    string
	Intent    string
	Priority  int
	Status    string
	CreatedAt time.Time
}

// retireInactiveSecurityActions prevents an unresolved action from outliving
// its source alert. Simulator resets are not real expiry events, so retain
// their audit trail as not applicable; ordinary inactive alerts are expired.
func retireInactiveSecurityActions() error {
	_, err := db.Exec(`
		UPDATE security_actions
		SET status = CASE
				WHEN COALESCE((
					SELECT resolved_reason
					FROM alerts
					WHERE alerts.id = security_actions.alert_id
				), '') = 'SIMULATOR_RESET' THEN 'NOT_APPLICABLE'
				ELSE 'EXPIRED'
			END,
			blocked_by_action_id = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE status IN ('OPEN', 'BLOCKED')
		  AND EXISTS (
				SELECT 1
				FROM alerts
				WHERE alerts.id = security_actions.alert_id
				  AND COALESCE(alerts.is_active, 0) = 0
		  )
	`)
	return err
}

func refreshSecurityActionQueue() error {
	if err := retireInactiveSecurityActions(); err != nil {
		return err
	}
	return prioritiseSecurityActions()
}

func prioritiseSecurityActions() error {
	if _, err := db.Exec(`
		UPDATE security_actions
		SET status = 'OPEN', blocked_by_action_id = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE status = 'BLOCKED'
	`); err != nil {
		return err
	}

	rows, err := db.Query(`
		SELECT id, ticker, intent, priority, status, created_at
		FROM security_actions
		WHERE status IN ('OPEN', 'AWAITING_STATEMENT', 'VARIANCE', 'OVERRIDDEN')
		ORDER BY ticker ASC, priority ASC, created_at ASC, id ASC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	byTicker := map[string][]securityActionQueueRow{}
	for rows.Next() {
		var action securityActionQueueRow
		if err := rows.Scan(&action.ID, &action.Ticker, &action.Intent, &action.Priority, &action.Status, &action.CreatedAt); err != nil {
			return err
		}
		byTicker[action.Ticker] = append(byTicker[action.Ticker], action)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, actions := range byTicker {
		sort.SliceStable(actions, func(i, j int) bool {
			if actions[i].Priority != actions[j].Priority {
				return actions[i].Priority < actions[j].Priority
			}
			if securityActionStatusRank(actions[i].Status) != securityActionStatusRank(actions[j].Status) {
				return securityActionStatusRank(actions[i].Status) < securityActionStatusRank(actions[j].Status)
			}
			if !actions[i].CreatedAt.Equal(actions[j].CreatedAt) {
				return actions[i].CreatedAt.Before(actions[j].CreatedAt)
			}
			return actions[i].ID < actions[j].ID
		})
		if len(actions) < 2 {
			continue
		}

		primary := actions[0]
		for _, action := range actions[1:] {
			if _, err := db.Exec(`
				UPDATE security_actions
				SET status = 'BLOCKED', blocked_by_action_id = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'OPEN'
			`, primary.ID, action.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func reconcileSecurityActionsAfterStatement(statementID, syncID int64) {
	type reconciliationCandidate struct {
		actionID  int
		intent    string
		method    string
		snapshots []securityActionUnitSnapshot
	}

	rows, err := db.Query(`
		SELECT id, intent, reconciliation_method, execution_snapshot_json
		FROM security_actions
		WHERE (status = 'AWAITING_STATEMENT'
		   OR (status IN ('CONFIRMED', 'VARIANCE') AND reconciled_statement_id = ?))
		  AND COALESCE(execution_sync_id, 0) < ?
	`, statementID, syncID)
	if err != nil {
		log.Printf("[SECURITY ACTIONS] Failed to load actions for reconciliation: %v", err)
		return
	}

	candidates := make([]reconciliationCandidate, 0)

	for rows.Next() {
		var candidate reconciliationCandidate
		var snapshotJSON string
		if err := rows.Scan(
			&candidate.actionID, &candidate.intent, &candidate.method, &snapshotJSON,
		); err != nil {
			log.Printf("[SECURITY ACTIONS] Failed to scan action reconciliation: %v", err)
			continue
		}
		if err := json.Unmarshal([]byte(snapshotJSON), &candidate.snapshots); err != nil {
			log.Printf("[SECURITY ACTIONS] Failed to read action %d holding snapshot: %v", candidate.actionID, err)
			continue
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[SECURITY ACTIONS] Action reconciliation iteration failed: %v", err)
		return
	}
	if err := rows.Close(); err != nil {
		log.Printf("[SECURITY ACTIONS] Failed to close reconciliation cursor: %v", err)
		return
	}

	for _, candidate := range candidates {
		var baselineID int64
		for _, snapshot := range candidate.snapshots {
			if snapshot.StatementID > 0 {
				baselineID = snapshot.StatementID
				break
			}
		}
		if baselineID > 0 {
			var newer bool
			err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM account_statements current
				JOIN account_statements baseline ON baseline.id = ? WHERE current.id = ?
				AND current.account_name = baseline.account_name AND date(current.statement_date) > date(baseline.statement_date))`,
				baselineID, statementID).Scan(&newer)
			if err != nil || !newer {
				continue
			}
		}
		confirmed := len(candidate.snapshots) > 0
		checked, external, failed := 0, false, false
		for _, snapshot := range candidate.snapshots {
			if snapshot.External {
				external = true
				continue
			}
			actual, found, err := statementQuantityForAction(statementID, snapshot)
			if err != nil {
				log.Printf("[SECURITY ACTIONS] Failed to read imported units for action %d: %v", candidate.actionID, err)
				failed = true
				break
			}
			checked++
			matched := securityActionUnitsMatch(candidate.intent, snapshot, actual, candidate.method == "REPORTED_UNITS")
			if candidate.method == "QUANTITY_DIRECTION" {
				matched = snapshot.Before > 0 && actual >= 0 && actual < snapshot.Before-0.0001
			}
			if !found || !matched {
				confirmed = false
			}
		}
		if failed {
			continue
		}
		confirmed = confirmed && checked > 0
		method := candidate.method
		if confirmed && external {
			method = "UNITS_AND_MANUAL_EXTERNAL"
		}
		status := securityActionVariance
		if confirmed {
			status = securityActionConfirmed
		}
		if _, err := db.Exec(`
			UPDATE security_actions
			SET status = ?, reconciled_statement_id = ?, reconciled_at = CURRENT_TIMESTAMP,
				reconciliation_method = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, status, statementID, method, candidate.actionID); err != nil {
			log.Printf("[SECURITY ACTIONS] Failed to reconcile action %d: %v", candidate.actionID, err)
		}
	}
}

func getSecurityActions(w http.ResponseWriter, r *http.Request) {
	resolveExpiredAlerts()
	if err := backfillOpenSecurityActions(); err != nil {
		http.Error(w, fmt.Sprintf("Failed to prepare action queue: %v", err), http.StatusInternalServerError)
		return
	}
	if err := refreshSecurityActionQueue(); err != nil {
		http.Error(w, fmt.Sprintf("Failed to prioritise action queue: %v", err), http.StatusInternalServerError)
		return
	}
	if err := projectOpenDeploymentActions(); err != nil {
		http.Error(w, fmt.Sprintf("Failed to project deployment tickets: %v", err), http.StatusInternalServerError)
		return
	}

	tickerFilter := securityActionTicker(r.URL.Query().Get("ticker"))
	includeHistory := r.URL.Query().Get("includeHistory") == "true"
	query := `
		SELECT sa.id, sa.alert_id, sa.ticker, a.alert_type, COALESCE(a.strength, ''),
		       COALESCE(a.timeframe, ''), COALESCE(a.source, ''), sa.scope,
		       COALESCE(sa.asset_class_code, ''), COALESCE(sa.affected_tickers_json, '[]'),
		       COALESCE(sa.source_event_key, ''), sa.intent,
		       sa.instruction_basis, sa.instruction, sa.priority, sa.status,
		       sa.blocked_by_action_id, COALESCE(blocker.instruction, ''),
		       sa.holding_quantity_snapshot, sa.holding_value_snapshot,
		       sa.holding_price_snapshot, COALESCE(sa.deployment_state, ''),
		       COALESCE(sa.deployment_policy_version, ''), COALESCE(sa.instruction_value, 0),
		       COALESCE(sa.target_value, 0), COALESCE(sa.target_shortfall_value, 0),
		       COALESCE(sa.class_funding_before, 0), COALESCE(sa.class_funding_after, 0),
		       sa.execution_reported_at,
		       COALESCE(sa.execution_note, ''), COALESCE(sa.override_reason, ''),
		       sa.next_review_at, sa.reconciled_statement_id, sa.reconciled_at,
		       sa.created_at, sa.updated_at, sa.execution_units, sa.reconciliation_method,
		       sa.execution_cash_value, sa.execution_exception_reason, sa.execution_policy_snapshot
		FROM security_actions sa
		JOIN alerts a ON a.id = sa.alert_id
		LEFT JOIN security_actions blocker ON blocker.id = sa.blocked_by_action_id
		WHERE (? = '' OR sa.ticker = ?)
	`
	if !includeHistory {
		query += ` AND sa.status NOT IN ('CONFIRMED', 'IGNORED', 'EXPIRED', 'NOT_APPLICABLE')`
	}
	query += ` ORDER BY sa.ticker ASC, sa.priority ASC, sa.created_at ASC, sa.id ASC`

	rows, err := db.Query(query, tickerFilter, tickerFilter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	actions := make([]SecurityAction, 0)
	queueCounts := map[string]int{}
	for rows.Next() {
		var action SecurityAction
		var affectedTickersJSON string
		var blockedBy sql.NullInt64
		var executionReportedAt, nextReviewAt, reconciledAt sql.NullTime
		var reconciledStatementID sql.NullInt64
		if err := rows.Scan(
			&action.ID, &action.AlertID, &action.Ticker, &action.AlertType, &action.Strength,
			&action.Timeframe, &action.Source, &action.Scope, &action.AssetClassCode,
			&affectedTickersJSON, &action.SourceEventKey, &action.Intent,
			&action.InstructionBasis, &action.Instruction, &action.Priority, &action.Status,
			&blockedBy, &action.BlockedByInstruction, &action.HoldingQuantitySnapshot,
			&action.HoldingValueSnapshot, &action.HoldingPriceSnapshot, &action.DeploymentState,
			&action.DeploymentPolicyVersion, &action.InstructionValue, &action.TargetValue,
			&action.TargetShortfallValue, &action.ClassFundingBefore, &action.ClassFundingAfter,
			&executionReportedAt,
			&action.ExecutionNote, &action.OverrideReason, &nextReviewAt, &reconciledStatementID,
			&reconciledAt, &action.CreatedAt, &action.UpdatedAt, &action.ExecutionUnits, &action.ReconciliationMethod,
			&action.ExecutionCashValue, &action.ExecutionExceptionReason, &action.ExecutionPolicySnapshot,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		action.AlertType = canonicalAlertType(action.AlertType)
		if err := json.Unmarshal([]byte(affectedTickersJSON), &action.AffectedTickers); err != nil {
			http.Error(w, fmt.Sprintf("Invalid action holding snapshot: %v", err), http.StatusInternalServerError)
			return
		}
		if blockedBy.Valid {
			value := int(blockedBy.Int64)
			action.BlockedByActionID = &value
		}
		if executionReportedAt.Valid {
			value := executionReportedAt.Time
			action.ExecutionReportedAt = &value
		}
		if nextReviewAt.Valid {
			value := nextReviewAt.Time
			action.NextReviewAt = &value
		}
		if reconciledStatementID.Valid {
			value := int(reconciledStatementID.Int64)
			action.ReconciledStatementID = &value
		}
		if reconciledAt.Valid {
			value := reconciledAt.Time
			action.ReconciledAt = &value
		}
		if !securityActionTerminalStatus(action.Status) {
			queueCounts[action.Ticker]++
		}
		actions = append(actions, action)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := rows.Close(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	primaryByTicker := map[string]int{}
	for index := range actions {
		action := &actions[index]
		if err := attachWeightActionEvidence(db, action); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		action.IsExternal, err = securityActionIsExternal(db, action.Ticker)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		action.QueueCount = queueCounts[action.Ticker]
		action.PurchaseExceptionAllowed = action.Intent == "DEPLOY" && action.Scope == "SECURITY" && !action.IsExternal &&
			(action.Status == securityActionOpen || action.Status == securityActionBlocked)
		if action.Status != securityActionBlocked && !securityActionTerminalStatus(action.Status) {
			if _, alreadyPrimary := primaryByTicker[action.Ticker]; !alreadyPrimary {
				action.IsPrimary = true
				primaryByTicker[action.Ticker] = action.ID
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(actions)
}

func actionDecisionCode(alertType string) string {
	switch canonicalAlertType(alertType) {
	case "SELL":
		return "SELL"
	case "SELL_50":
		return "SELL_50"
	case "SELL_DOWN":
		return "SELL_DOWN"
	case "TRIM", "WEIGHT_REDUCE":
		return "TRIM"
	case "EQUITY_REGIME_STRONG_TRIM":
		return "EQUITY_REGIME_STRONG_TRIM"
	case "ADD":
		return "ADD"
	default:
		return "BUY"
	}
}

func loadOpenSecurityAction(actionID int) (SecurityAction, error) {
	var action SecurityAction
	var affectedJSON string
	err := db.QueryRow(`
		SELECT sa.id, sa.alert_id, sa.ticker, a.alert_type, sa.intent, sa.status,
			COALESCE(sa.deployment_state, ''), COALESCE(sa.instruction_value, 0),
			sa.scope, sa.affected_tickers_json, COALESCE(a.strength, ''), COALESCE(a.source, ''),
			sa.asset_class_code, sa.instruction
		FROM security_actions sa
		JOIN alerts a ON a.id = sa.alert_id
		WHERE sa.id = ?
	`, actionID).Scan(&action.ID, &action.AlertID, &action.Ticker, &action.AlertType,
		&action.Intent, &action.Status, &action.DeploymentState, &action.InstructionValue,
		&action.Scope, &affectedJSON, &action.Strength, &action.Source, &action.AssetClassCode, &action.Instruction)
	if err != nil {
		return action, err
	}
	if err := json.Unmarshal([]byte(affectedJSON), &action.AffectedTickers); err != nil {
		return action, err
	}
	action.IsExternal, err = securityActionIsExternal(db, action.Ticker)
	if err != nil {
		return action, err
	}
	return action, nil
}

type securityExecutionRequest struct {
	Notes                    string   `json:"notes"`
	Units                    *float64 `json:"units"`
	ExceptionReason          string   `json:"exception_reason"`
	CashValue                *float64 `json:"cash_value"`
	ExpectedInstructionValue *float64 `json:"expected_instruction_value"`
}

func recordSecurityActionExecution(w http.ResponseWriter, r *http.Request) {
	var request securityExecutionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	recordSecurityActionExecutionRequest(w, r, request)
}

func recordSecurityActionExecutionRequest(w http.ResponseWriter, r *http.Request, request securityExecutionRequest) {
	deploymentFundingMu.Lock()
	defer deploymentFundingMu.Unlock()
	if request.Units != nil && (!finitePositive(*request.Units)) {
		http.Error(w, "Units must be a positive finite number", http.StatusBadRequest)
		return
	}
	exception := strings.TrimSpace(request.ExceptionReason) != ""
	if exception && (request.Units == nil || request.CashValue == nil || !finitePositive(*request.CashValue)) || !exception && request.CashValue != nil {
		http.Error(w, "A purchase exception requires units, AUD spent and a reason", http.StatusBadRequest)
		return
	}
	if err := refreshSecurityActionQueue(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := projectOpenDeploymentActionsLocked(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	actionID, err := strconvActionID(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	action, err := loadOpenSecurityAction(actionID)
	if err == sql.ErrNoRows {
		http.Error(w, "Security action not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if exception && (action.Intent != "DEPLOY" || action.Scope != "SECURITY" || action.IsExternal) {
		http.Error(w, "Purchase exceptions apply only to broker-funded security purchases", http.StatusBadRequest)
		return
	}
	if action.Status == securityActionBlocked && !exception {
		http.Error(w, "Resolve the higher-priority action before recording this action", http.StatusConflict)
		return
	}
	if action.Status != securityActionOpen && !(exception && action.Status == securityActionBlocked) {
		http.Error(w, "This action is not ready to record", http.StatusConflict)
		return
	}
	if action.Scope == "ASSET_CLASS" && request.Units != nil {
		http.Error(w, "A single unit amount cannot describe multiple holdings", http.StatusBadRequest)
		return
	}
	if action.Intent == "REVIEW" {
		http.Error(w, "Review the class in Portfolio; this is not a trade", http.StatusConflict)
		return
	}
	if action.AlertType == "WEIGHT_REDUCE" {
		if request.ExpectedInstructionValue == nil || !finitePositive(*request.ExpectedInstructionValue) || math.Abs(*request.ExpectedInstructionValue-action.InstructionValue) > 0.01 {
			http.Error(w, "The reduction must match the amount you reviewed; refresh before recording. No execution was recorded", http.StatusConflict)
			return
		}
		if err := validateWeightReduction(action); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
	}
	if !exception && !action.IsExternal && action.Intent == "DEPLOY" && action.DeploymentState != deploymentStateFunded {
		http.Error(w, "This deployment has no funded class-pool ticket", http.StatusConflict)
		return
	}
	if exception && action.AssetClassCode == "" {
		action.AssetClassCode, err = securityActionAssetClassForTicker(action.Ticker)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	var executionCash float64
	var policySnapshot string
	if exception {
		executionCash = *request.CashValue
		risk, riskErr := loadDeploymentRisk(tx)
		if riskErr != nil {
			http.Error(w, riskErr.Error(), http.StatusInternalServerError)
			return
		}
		permission, gateErr := deploymentSecurityPermission(tx, action.Ticker, action.AlertType, action.Source, action.AssetClassCode, risk)
		if gateErr != nil {
			http.Error(w, gateErr.Error(), http.StatusInternalServerError)
			return
		}
		evidence, _ := json.Marshal(map[string]interface{}{"policy_version": deploymentTicketPolicyVersion, "gate": permission,
			"deployment_state": action.DeploymentState, "instruction": action.Instruction, "queue_status": action.Status,
			"q3_target_pct": risk.Q3, "q4_active": risk.Q4, "asset_class": action.AssetClassCode})
		policySnapshot = string(evidence)
	} else {
		executionCash, err = validateDeploymentExecution(tx, action, request.Units)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	snapshots, err := captureSecurityActionUnits(tx, action, request.Units)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	snapshotJSON, err := json.Marshal(snapshots)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	status, method := securityActionAwaitingStatement, "ESTIMATED_UNITS"
	if canonicalAlertType(action.AlertType) == "TRIM" && securityActionTrimFraction(action) == 0 {
		method = "QUANTITY_DIRECTION"
	}
	if request.Units != nil {
		method = "REPORTED_UNITS"
	}
	if action.IsExternal || actionUnitsAllExternal(snapshots) {
		status, method = securityActionConfirmed, "MANUAL_EXTERNAL"
	}

	var syncID int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM sync_history`).Scan(&syncID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	executionNote := strings.TrimSpace(request.Notes)
	if exception {
		executionNote = fmt.Sprintf("Purchase exception: %.6g units, AUD %.2f. %s", *request.Units, executionCash, strings.TrimSpace(request.ExceptionReason))
		if strings.TrimSpace(request.Notes) != "" {
			executionNote += "\n" + strings.TrimSpace(request.Notes)
		}
	}
	decisionResult, err := tx.Exec(`
		INSERT INTO decisions (alert_id, decision, notes, position_pct_after)
		VALUES (?, ?, ?, NULL)
	`, action.AlertID, actionDecisionCode(action.AlertType), executionNote)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`
		UPDATE alerts
		SET is_active = 0, resolved_at = CURRENT_TIMESTAMP,
			resolved_reason = 'EXECUTION_REPORTED', resolved_note = ?
		WHERE id = ?
	`, executionNote, action.AlertID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	result, err := tx.Exec(`
		UPDATE security_actions
		SET status = ?, execution_reported_at = CURRENT_TIMESTAMP,
			execution_sync_id = ?, execution_note = ?, execution_units = ?,
			execution_snapshot_json = ?, reconciliation_method = ?, execution_cash_value = ?,
			execution_exception_reason = ?, execution_policy_snapshot = ?, asset_class_code = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = ?
	`, status, syncID, executionNote, request.Units, string(snapshotJSON), method, executionCash,
		strings.TrimSpace(request.ExceptionReason), policySnapshot, action.AssetClassCode, action.ID, action.Status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	changed, err := result.RowsAffected()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if changed != 1 {
		http.Error(w, "This action has changed; reload before recording execution", http.StatusConflict)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	decisionID, _ := decisionResult.LastInsertId()
	json.NewEncoder(w).Encode(map[string]interface{}{"status": status, "id": decisionID, "message": "Decision recorded"})
}

func ignoreSecurityAction(w http.ResponseWriter, r *http.Request) {
	if err := refreshSecurityActionQueue(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	actionID, err := strconvActionID(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	action, err := loadOpenSecurityAction(actionID)
	if err == sql.ErrNoRows {
		http.Error(w, "Security action not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if action.Intent == "EXIT" {
		http.Error(w, "Exit actions require execution or an explicit override", http.StatusConflict)
		return
	}
	if action.Status != securityActionOpen {
		http.Error(w, "This action is not ready to ignore", http.StatusConflict)
		return
	}
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`
		INSERT INTO decisions (alert_id, decision, notes, position_pct_after)
		VALUES (?, 'IGNORE', 'Ignored from the security action queue', NULL)
	`, action.AlertID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`
		UPDATE alerts
		SET is_active = 0, resolved_at = CURRENT_TIMESTAMP,
			resolved_reason = 'IGNORE', resolved_note = 'Ignored from the security action queue'
		WHERE id = ?
	`, action.AlertID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`
		UPDATE security_actions
		SET status = 'IGNORED', updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, action.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": securityActionIgnored})
}

func overrideSecurityActionExit(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Reason       string `json:"reason"`
		NextReviewAt string `json:"next_review_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	reason := strings.TrimSpace(request.Reason)
	if reason == "" {
		http.Error(w, "An Exit override needs a reason", http.StatusBadRequest)
		return
	}
	var nextReviewAt *time.Time
	if raw := strings.TrimSpace(request.NextReviewAt); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			http.Error(w, "next_review_at must be an RFC3339 timestamp", http.StatusBadRequest)
			return
		}
		nextReviewAt = &parsed
	}
	if err := refreshSecurityActionQueue(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	actionID, err := strconvActionID(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	action, err := loadOpenSecurityAction(actionID)
	if err == sql.ErrNoRows {
		http.Error(w, "Security action not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if action.Intent != "EXIT" {
		http.Error(w, "Only Exit actions can be overridden", http.StatusConflict)
		return
	}
	if action.Status != securityActionOpen && action.Status != securityActionOverridden {
		http.Error(w, "This Exit is not ready to override", http.StatusConflict)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`
		INSERT INTO decisions (alert_id, decision, notes, position_pct_after)
		VALUES (?, 'OVERRIDE', ?, NULL)
	`, action.AlertID, reason); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`
		UPDATE alerts
		SET is_active = 0, resolved_at = CURRENT_TIMESTAMP,
			resolved_reason = 'OVERRIDE', resolved_note = ?
		WHERE id = ?
	`, reason, action.AlertID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`
		UPDATE security_actions
		SET status = 'OVERRIDDEN', override_reason = ?, next_review_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, reason, nextReviewAt, action.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": securityActionOverridden})
}

func strconvActionID(r *http.Request) (int, error) {
	value := strings.TrimSpace(mux.Vars(r)["id"])
	if value == "" {
		return 0, fmt.Errorf("security action id is required")
	}
	var id int
	if _, err := fmt.Sscanf(value, "%d", &id); err != nil || id < 1 {
		return 0, fmt.Errorf("invalid security action id")
	}
	return id, nil
}
