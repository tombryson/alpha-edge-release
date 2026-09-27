package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"math"
	"strings"
	"time"

	"trading-backend/internal/portfoliomix"
)

type SecurityPosition struct {
	ID                    int       `json:"id"`
	Ticker                string    `json:"ticker"`
	PositionState         string    `json:"position_state"`
	ManualOverride        bool      `json:"manual_override"`
	StoppedWaitingReentry bool      `json:"stopped_waiting_reentry"`
	LastUpdated           time.Time `json:"last_updated"`
	CreatedAt             time.Time `json:"created_at"`
}

type Alert struct {
	ID                int        `json:"id"`
	Ticker            string     `json:"ticker"`
	AlertType         string     `json:"alert_type"`
	Strength          string     `json:"strength"`
	ExpiryDate        *time.Time `json:"expiry_date"`
	ExchangePrefix    string     `json:"exchange_prefix"`
	Timeframe         string     `json:"timeframe,omitempty"`
	Source            string     `json:"source,omitempty"`
	AffectedPositions string     `json:"affected_positions,omitempty"`
	AlertPrice        *float64   `json:"alert_price,omitempty"`
	CurrentPrice      *float64   `json:"current_price,omitempty"`
	MovePct           *float64   `json:"move_pct,omitempty"`
	ResolvedReason    string     `json:"resolved_reason,omitempty"`
	ResolvedNote      string     `json:"resolved_note,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	IsActive          bool       `json:"is_active"`
}

func floatPtr(value float64) *float64 {
	v := value
	return &v
}

func nullableFloat(value *float64) interface{} {
	if value == nil {
		return nil
	}
	return *value
}

func parseOptionalJSONNumber(value json.Number) (float64, bool) {
	raw := strings.TrimSpace(value.String())
	if raw == "" || strings.EqualFold(raw, "null") {
		return 0, false
	}
	parsed, err := value.Float64()
	if err != nil || parsed <= 0 {
		return 0, false
	}
	return parsed, true
}

type marketPriceSnapshot struct {
	Price float64
	AsOf  time.Time
}

func lookupCurrentMarketPriceSnapshot(ticker string, exchangePrefix string) *marketPriceSnapshot {
	symbol := strings.ToUpper(strings.TrimSpace(ticker))
	prefix := strings.ToUpper(strings.TrimSpace(exchangePrefix))
	fullTicker := prefix + symbol
	if symbol == "" {
		return nil
	}

	var snapshot marketPriceSnapshot
	err := db.QueryRow(`
		SELECT price, as_of
		FROM (
			SELECT current_price AS price, COALESCE(updated_at, last_synced_at, created_at) AS as_of
			FROM holdings
			WHERE is_active = 1
			  AND current_price > 0
			  AND UPPER(TRIM(COALESCE(ticker, ''))) = ?
			  AND (? = '' OR UPPER(TRIM(COALESCE(exchange_prefix, ''))) = ?)

			UNION ALL

			SELECT current_price AS price, COALESCE(updated_at, created_at) AS as_of
			FROM stock_analysis
			WHERE current_price > 0
			  AND (
				UPPER(TRIM(COALESCE(ticker, ''))) = ?
				OR UPPER(TRIM(COALESCE(ticker, ''))) = ?
				OR UPPER(TRIM(COALESCE(ticker, ''))) LIKE '%:' || ?
			  )
		)
		ORDER BY datetime(as_of) DESC
		LIMIT 1
	`, symbol, prefix, prefix, fullTicker, symbol, symbol).Scan(&snapshot.Price, &snapshot.AsOf)
	if err == nil {
		return &snapshot
	}

	return nil
}

func lookupCurrentMarketPrice(ticker string, exchangePrefix string) *float64 {
	snapshot := lookupCurrentMarketPriceSnapshot(ticker, exchangePrefix)
	if snapshot == nil {
		return nil
	}
	return floatPtr(snapshot.Price)
}

func lookupCurrentMarketPriceForAlert(alert *Alert) *float64 {
	snapshot := lookupCurrentMarketPriceSnapshot(alert.Ticker, alert.ExchangePrefix)
	if snapshot == nil {
		return nil
	}
	if !alert.CreatedAt.IsZero() && snapshot.AsOf.Before(alert.CreatedAt) {
		log.Printf(
			"[ALERT PRICE] Skipping stale price for %s: price as_of=%s before alert=%s",
			alert.Ticker,
			snapshot.AsOf.Format(time.RFC3339),
			alert.CreatedAt.Format(time.RFC3339),
		)
		return nil
	}
	return floatPtr(snapshot.Price)
}

func attachAlertPriceContext(alert *Alert) {
	current := lookupCurrentMarketPriceForAlert(alert)
	alert.CurrentPrice = current
	if alert.AlertPrice != nil && current != nil && *alert.AlertPrice > 0 {
		alert.MovePct = floatPtr(((*current - *alert.AlertPrice) / *alert.AlertPrice) * 100)
	}
}

func writePerformanceSnapshotsForStatementTx(tx *sql.Tx, statementID int64) error {
	var statement AccountStatement
	if err := tx.QueryRow(`
		SELECT id, account_name, statement_date, total_value_aud, cash_aud,
		       usd_value, usd_aud, gbp_value, gbp_aud, aud_value, created_at
		FROM account_statements
		WHERE id = ?
	`, statementID).Scan(
		&statement.ID,
		&statement.AccountName,
		&statement.StatementDate,
		&statement.TotalValueAUD,
		&statement.CashAUD,
		&statement.USDValue,
		&statement.USDAUD,
		&statement.GBPValue,
		&statement.GBPAUD,
		&statement.AUDValue,
		&statement.CreatedAt,
	); err != nil {
		return err
	}

	var investedValue float64
	var sleeveCashValue float64
	var holdingsCount int
	if err := tx.QueryRow(`
		SELECT COALESCE(SUM(value_aud), 0), COALESCE(SUM(cash_reserve), 0), COUNT(*)
		FROM statement_holdings sh
		WHERE sh.statement_id = ?
		  AND UPPER(COALESCE(sh.details, '')) NOT LIKE '%CONTINGENT VALUE RIGHT%'
		  AND NOT EXISTS (
		      SELECT 1
		      FROM stock_analysis sa
		      WHERE LOWER(TRIM(sa.name)) = LOWER(TRIM(sh.details))
		        AND UPPER(COALESCE(sa.security_type, '')) IN ('CVR', 'NON_ALLOCATING')
		  )
	`, statementID).Scan(&investedValue, &sleeveCashValue, &holdingsCount); err != nil {
		return err
	}

	residualCashValue := statement.TotalValueAUD - investedValue - sleeveCashValue
	if residualCashValue < 0 && math.Abs(residualCashValue) < 0.01 {
		residualCashValue = 0
	}

	if _, err := tx.Exec(`
		INSERT INTO portfolio_daily_snapshots (
			statement_id, observed_at, total_value_aud, invested_value_aud,
			statement_cash_aud, sleeve_cash_aud, residual_cash_aud, holdings_count, source, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'STATEMENT', CURRENT_TIMESTAMP)
		ON CONFLICT(statement_id) DO UPDATE SET
			observed_at = excluded.observed_at,
			total_value_aud = excluded.total_value_aud,
			invested_value_aud = excluded.invested_value_aud,
			statement_cash_aud = excluded.statement_cash_aud,
			sleeve_cash_aud = excluded.sleeve_cash_aud,
			residual_cash_aud = excluded.residual_cash_aud,
			holdings_count = excluded.holdings_count,
			source = excluded.source,
			updated_at = CURRENT_TIMESTAMP
	`, statementID, statement.StatementDate, statement.TotalValueAUD, investedValue, statement.CashAUD, sleeveCashValue, residualCashValue, holdingsCount); err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM asset_class_daily_snapshots WHERE statement_id = ?`, statementID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM security_position_snapshots WHERE statement_id = ?`, statementID); err != nil {
		return err
	}

	assetRows, err := tx.Query(`
		WITH enriched AS (
			SELECT
				sh.value_aud,
				sh.cash_reserve,
				COALESCE(
					NULLIF((SELECT sa.primary_asset_class FROM stock_analysis sa WHERE LOWER(TRIM(sa.name)) = LOWER(TRIM(sh.details)) LIMIT 1), ''),
					'UNCLASSIFIED'
				) AS asset_class
			FROM statement_holdings sh
			WHERE sh.statement_id = ?
			  AND UPPER(COALESCE(sh.details, '')) NOT LIKE '%CONTINGENT VALUE RIGHT%'
			  AND NOT EXISTS (
			      SELECT 1
			      FROM stock_analysis sa
			      WHERE LOWER(TRIM(sa.name)) = LOWER(TRIM(sh.details))
			        AND UPPER(COALESCE(sa.security_type, '')) IN ('CVR', 'NON_ALLOCATING')
			  )
		)
		SELECT
			asset_class,
			COALESCE((SELECT cfg.display_name FROM asset_class_config cfg WHERE UPPER(TRIM(cfg.code)) = UPPER(TRIM(asset_class)) LIMIT 1), asset_class) AS display_name,
			COALESCE(SUM(value_aud), 0) AS invested_value,
			COALESCE(SUM(cash_reserve), 0) AS cash_value,
			COALESCE(SUM(value_aud + cash_reserve), 0) AS total_value
		FROM enriched
		GROUP BY asset_class
		ORDER BY total_value DESC
	`, statementID)
	if err != nil {
		return err
	}
	for assetRows.Next() {
		var assetClass, displayName string
		var invested, cashValue, totalValue float64
		if err := assetRows.Scan(&assetClass, &displayName, &invested, &cashValue, &totalValue); err != nil {
			assetRows.Close()
			return err
		}
		weightPct := 0.0
		if statement.TotalValueAUD > 0 {
			weightPct = (totalValue / statement.TotalValueAUD) * 100
		}
		if _, err := tx.Exec(`
			INSERT INTO asset_class_daily_snapshots (
				statement_id, observed_at, asset_class, display_name, invested_value_aud,
				cash_value_aud, total_value_aud, portfolio_weight_pct, source
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'STATEMENT')
		`, statementID, statement.StatementDate, strings.TrimSpace(assetClass), strings.TrimSpace(displayName), invested, cashValue, totalValue, weightPct); err != nil {
			assetRows.Close()
			return err
		}
	}
	if err := assetRows.Err(); err != nil {
		assetRows.Close()
		return err
	}
	assetRows.Close()

	securityRows, err := tx.Query(`
		SELECT
			COALESCE(
				NULLIF((SELECT cm.ticker FROM company_mappings cm WHERE cm.company_name = sh.details LIMIT 1), ''),
				NULLIF((SELECT sa.ticker FROM stock_analysis sa WHERE LOWER(TRIM(sa.name)) = LOWER(TRIM(sh.details)) LIMIT 1), ''),
				''
			) AS ticker,
			COALESCE((SELECT cm.exchange_prefix FROM company_mappings cm WHERE cm.company_name = sh.details LIMIT 1), '') AS exchange_prefix,
			sh.details,
			COALESCE(
				NULLIF((SELECT sa.primary_asset_class FROM stock_analysis sa WHERE LOWER(TRIM(sa.name)) = LOWER(TRIM(sh.details)) LIMIT 1), ''),
				'UNCLASSIFIED'
			) AS asset_class,
			sh.quantity,
			sh.current_price,
			sh.value_aud,
			sh.currency
		FROM statement_holdings sh
		WHERE sh.statement_id = ?
		  AND UPPER(COALESCE(sh.details, '')) NOT LIKE '%CONTINGENT VALUE RIGHT%'
		  AND NOT EXISTS (
		      SELECT 1
		      FROM stock_analysis sa
		      WHERE LOWER(TRIM(sa.name)) = LOWER(TRIM(sh.details))
		        AND UPPER(COALESCE(sa.security_type, '')) IN ('CVR', 'NON_ALLOCATING')
		  )
		ORDER BY sh.value_aud DESC
	`, statementID)
	if err != nil {
		return err
	}
	for securityRows.Next() {
		var ticker, exchangePrefix, name, assetClass, currency string
		var quantity, price, marketValue float64
		if err := securityRows.Scan(&ticker, &exchangePrefix, &name, &assetClass, &quantity, &price, &marketValue, &currency); err != nil {
			securityRows.Close()
			return err
		}
		weightPct := 0.0
		if statement.TotalValueAUD > 0 {
			weightPct = (marketValue / statement.TotalValueAUD) * 100
		}
		if _, err := tx.Exec(`
			INSERT INTO security_position_snapshots (
				statement_id, observed_at, ticker, exchange_prefix, name, asset_class,
				quantity, price, market_value_aud, portfolio_weight_pct, currency, source
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STATEMENT')
		`, statementID, statement.StatementDate, strings.TrimSpace(ticker), strings.TrimSpace(exchangePrefix), strings.TrimSpace(name), strings.TrimSpace(assetClass), quantity, price, marketValue, weightPct, strings.TrimSpace(currency)); err != nil {
			securityRows.Close()
			return err
		}
	}
	if err := securityRows.Err(); err != nil {
		securityRows.Close()
		return err
	}
	securityRows.Close()

	return nil
}

func backfillPerformanceSnapshots() {
	rows, err := db.Query(`SELECT id FROM account_statements ORDER BY statement_date ASC`)
	if err != nil {
		log.Printf("[PERFORMANCE] Failed to query statements for snapshot backfill: %v", err)
		return
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			log.Printf("[PERFORMANCE] Failed to scan statement id for snapshot backfill: %v", err)
			continue
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[PERFORMANCE] Failed during snapshot backfill statement scan: %v", err)
		return
	}

	backfilled := 0
	for _, id := range ids {
		tx, err := db.Begin()
		if err != nil {
			log.Printf("[PERFORMANCE] Failed to start snapshot backfill tx for statement %d: %v", id, err)
			continue
		}
		if err := writePerformanceSnapshotsForStatementTx(tx, id); err != nil {
			tx.Rollback()
			log.Printf("[PERFORMANCE] Failed to backfill snapshots for statement %d: %v", id, err)
			continue
		}
		if err := tx.Commit(); err != nil {
			log.Printf("[PERFORMANCE] Failed to commit snapshot backfill for statement %d: %v", id, err)
			continue
		}
		backfilled++
	}

	if backfilled > 0 {
		log.Printf("[PERFORMANCE] Statement-derived snapshots ready: %d statements", backfilled)
	}
}

type StockGroup struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	AssetClassCode string    `json:"asset_class_code,omitempty"`
	Collapsed      bool      `json:"collapsed"`
	DisplayOrder   int       `json:"order"`
	ParentID       *string   `json:"parent_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type StockGroupAssignment struct {
	CompanyName string    `json:"company_name"`
	GroupID     string    `json:"group_id"`
	AssignedAt  time.Time `json:"assigned_at"`
}

type RegimeAssignment struct {
	ID             int    `json:"id"`
	SecurityTicker string `json:"security_ticker"`
	SecurityType   string `json:"security_type"`
	RegimeTicker   string `json:"regime_ticker"`
	CreatedAt      string `json:"created_at"`
}

type ETFPosition struct {
	ID             int       `json:"id"`
	Ticker         string    `json:"ticker"`
	PositionState  string    `json:"position_state"`
	AllocationPct  float64   `json:"allocation_pct"`
	CashAllocated  float64   `json:"cash_allocated"`
	ManualOverride bool      `json:"manual_override"`
	LastUpdated    time.Time `json:"last_updated"`
	CreatedAt      time.Time `json:"created_at"`
}

type ETFRebalanceTarget struct {
	ID                      int        `json:"id"`
	SequenceNumber          int        `json:"sequence_number"`
	RebalanceDate           time.Time  `json:"rebalance_date"`
	Ticker                  string     `json:"ticker"`
	Rank                    *int       `json:"rank,omitempty"`
	Return60Bar             *float64   `json:"return_60bar,omitempty"`
	CurrentAllocation       float64    `json:"current_allocation"`
	TargetAllocation        float64    `json:"target_allocation"`
	PendingDelta            *float64   `json:"pending_delta,omitempty"`
	Status                  string     `json:"status"`
	WeightedPortfolioReturn *float64   `json:"weighted_portfolio_return,omitempty"`
	CreatedAt               time.Time  `json:"created_at"`
	ExpiresAt               *time.Time `json:"expires_at,omitempty"`
}

type ETFExecution struct {
	ID               int       `json:"id"`
	RebalanceID      *int      `json:"rebalance_id,omitempty"`
	Ticker           string    `json:"ticker"`
	Signal           string    `json:"signal"`
	AllocationBefore float64   `json:"allocation_before"`
	AllocationAfter  float64   `json:"allocation_after"`
	CashBefore       float64   `json:"cash_before"`
	CashAfter        float64   `json:"cash_after"`
	ExecutedAt       time.Time `json:"executed_at"`
}

type Regime struct {
	ID          int       `json:"id"`
	Ticker      string    `json:"ticker"`
	Signal      string    `json:"signal"`
	LastUpdated time.Time `json:"last_updated"`
	CreatedAt   time.Time `json:"created_at"`
}

type RegimeImpact struct {
	Ticker            string   `json:"ticker"`
	Type              string   `json:"type"`
	AssetClassesSell  []string `json:"asset_classes_sell"`
	TargetPositionPct int      `json:"target_position_pct"`
	Action            string   `json:"action"`
}

type EquitySizingEntry struct {
	SourceTicker    string  `json:"source_ticker"`
	TargetEquityPct float64 `json:"target_equity_pct"`
	LastUpdated     string  `json:"last_updated"`
}

type EquitySizingHistoryEntry struct {
	ID              int     `json:"id"`
	SourceTicker    string  `json:"source_ticker"`
	TargetEquityPct float64 `json:"target_equity_pct"`
	ReceivedAt      string  `json:"received_at"`
}

// DEPRECATED: Security struct (use statement_holdings instead)
// type Security struct { ... }

type Decision struct {
	AlertID          *int     `json:"alert_id"`
	Decision         string   `json:"decision"`
	Notes            *string  `json:"notes"`
	PositionPctAfter *float64 `json:"position_pct_after"`
	Units            *float64 `json:"units,omitempty"`
}

type PreviousAlert struct {
	Ticker             string  `json:"ticker"`
	Signal             string  `json:"signal"`
	AnalystPriceTarget float64 `json:"analyst_price_target"`
	DateUpdated        string  `json:"date_updated"`
	SignalDate         string  `json:"signalDate"`
}

type AccountStatement struct {
	ID            int       `json:"id"`
	AccountName   string    `json:"account_name"`
	StatementDate time.Time `json:"statement_date"`
	TotalValueAUD float64   `json:"total_value_aud"`
	CashAUD       float64   `json:"cash_aud"`
	USDValue      float64   `json:"usd_value"`
	USDAUD        float64   `json:"usd_aud"`
	GBPValue      float64   `json:"gbp_value"`
	GBPAUD        float64   `json:"gbp_aud"`
	AUDValue      float64   `json:"aud_value"`
	CreatedAt     time.Time `json:"created_at"`
}

type StatementHolding struct {
	ID                int       `json:"id"`
	StatementID       int       `json:"statement_id"`
	Details           string    `json:"details"`
	ISIN              string    `json:"isin"` // Unique security identifier
	Quantity          float64   `json:"quantity"`
	CostAUD           float64   `json:"cost_aud,omitempty"`    // For internal use
	CostNative        float64   `json:"cost_native,omitempty"` // From Google Sheets
	CurrentPrice      float64   `json:"current_price"`
	ValueAUD          float64   `json:"value_aud,omitempty"`           // For internal use
	MarketValueNative float64   `json:"market_value_native,omitempty"` // From Google Sheets
	GainLossAUD       float64   `json:"gain_loss_aud,omitempty"`       // For internal use
	GainLossNative    float64   `json:"gain_loss_native,omitempty"`    // From Google Sheets
	GainLossPct       float64   `json:"gain_loss_pct"`
	Currency          string    `json:"currency"`
	MarketValue       float64   `json:"market_value,omitempty"` // For internal use
	CashReserve       float64   `json:"cash_reserve"`
	Ticker            *string   `json:"ticker"`
	ExchangePrefix    *string   `json:"exchange_prefix"`
	TemplateID        *string   `json:"template_id"`
	CreatedAt         time.Time `json:"created_at"`
}

type StatementImport struct {
	Account  AccountStatement   `json:"account"`
	Holdings []StatementHolding `json:"holdings"`
}

func statementCurrencyRate(account AccountStatement, currency string) float64 {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "USD":
		if account.USDValue > 0 && account.USDAUD > 0 {
			return account.USDAUD / account.USDValue
		}
	case "GBP":
		if account.GBPValue > 0 && account.GBPAUD > 0 {
			return account.GBPAUD / account.GBPValue
		}
	}
	return 1
}

func importedNativeAmountToAUD(account AccountStatement, currency string, nativeAmount float64) float64 {
	return nativeAmount * statementCurrencyRate(account, currency)
}

func importedHoldingAUDAmounts(account AccountStatement, holding StatementHolding) (float64, float64, float64, float64) {
	costAUD := holding.CostAUD
	if holding.CostNative != 0 {
		costAUD = importedNativeAmountToAUD(account, holding.Currency, holding.CostNative)
	}

	valueAUD := holding.ValueAUD
	if holding.MarketValueNative != 0 {
		valueAUD = importedNativeAmountToAUD(account, holding.Currency, holding.MarketValueNative)
	}

	gainLossAUD := holding.GainLossAUD
	if holding.GainLossNative != 0 {
		gainLossAUD = importedNativeAmountToAUD(account, holding.Currency, holding.GainLossNative)
	}

	marketValueAUD := holding.MarketValue
	if holding.MarketValueNative != 0 {
		marketValueAUD = importedNativeAmountToAUD(account, holding.Currency, holding.MarketValueNative)
	} else if marketValueAUD == 0 {
		marketValueAUD = valueAUD
	}

	return costAUD, valueAUD, gainLossAUD, marketValueAUD
}

type PortfolioPerformancePoint struct {
	StatementID      int64     `json:"statement_id"`
	ObservedAt       time.Time `json:"observed_at"`
	TotalValueAUD    float64   `json:"total_value_aud"`
	InvestedValueAUD float64   `json:"invested_value_aud"`
	StatementCashAUD float64   `json:"statement_cash_aud"`
	SleeveCashAUD    float64   `json:"sleeve_cash_aud"`
	ResidualCashAUD  float64   `json:"residual_cash_aud"`
	HoldingsCount    int       `json:"holdings_count"`
	Source           string    `json:"source"`
}

type AssetClassPerformancePoint struct {
	StatementID        int64     `json:"statement_id"`
	ObservedAt         time.Time `json:"observed_at"`
	AssetClass         string    `json:"asset_class"`
	DisplayName        string    `json:"display_name"`
	InvestedValueAUD   float64   `json:"invested_value_aud"`
	CashValueAUD       float64   `json:"cash_value_aud"`
	TotalValueAUD      float64   `json:"total_value_aud"`
	PortfolioWeightPct float64   `json:"portfolio_weight_pct"`
	Source             string    `json:"source"`
}

type SecurityPerformancePoint struct {
	StatementID        int64     `json:"statement_id"`
	ObservedAt         time.Time `json:"observed_at"`
	Ticker             string    `json:"ticker"`
	ExchangePrefix     string    `json:"exchange_prefix"`
	Name               string    `json:"name"`
	AssetClass         string    `json:"asset_class"`
	Quantity           float64   `json:"quantity"`
	Price              float64   `json:"price"`
	MarketValueAUD     float64   `json:"market_value_aud"`
	PortfolioWeightPct float64   `json:"portfolio_weight_pct"`
	Currency           string    `json:"currency"`
	Source             string    `json:"source"`
}

type PerformanceEvent struct {
	ID          string                 `json:"id"`
	EventType   string                 `json:"event_type"`
	OccurredAt  time.Time              `json:"occurred_at"`
	Title       string                 `json:"title"`
	Scope       string                 `json:"scope"`
	Ticker      string                 `json:"ticker,omitempty"`
	AssetClass  string                 `json:"asset_class,omitempty"`
	Source      string                 `json:"source,omitempty"`
	Severity    string                 `json:"severity,omitempty"`
	StatementID int64                  `json:"statement_id,omitempty"`
	ValueAUD    *float64               `json:"value_aud,omitempty"`
	PctValue    *float64               `json:"pct_value,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type SecurityPerformanceDirection struct {
	Ticker        string    `json:"ticker"`
	Name          string    `json:"name"`
	AssetClass    string    `json:"asset_class"`
	ObservedAt    time.Time `json:"observed_at"`
	PreviousAt    time.Time `json:"previous_at,omitempty"`
	Price         float64   `json:"price"`
	PreviousPrice float64   `json:"previous_price"`
	Change        float64   `json:"change"`
	ChangePct     float64   `json:"change_pct"`
	Direction     string    `json:"direction"`
}

type StockAnalysis struct {
	ID                     int     `json:"id"`
	Ticker                 *string `json:"ticker"`
	Name                   string  `json:"name"`
	CouncilRunID           *string `json:"council_run_id"`
	CouncilRunLabel        *string `json:"council_run_label"`
	GrokQuality            float64 `json:"grok_quality"`
	GrokValue              float64 `json:"grok_value"`
	GeminiQuality          float64 `json:"gemini_quality"`
	GeminiValue            float64 `json:"gemini_value"`
	GptQuality             float64 `json:"gpt_quality"`
	GptValue               float64 `json:"gpt_value"`
	DeerFlowQuality        float64 `json:"deer_flow_quality"`
	DeerFlowValue          float64 `json:"deer_flow_value"`
	PerplexityQuality      float64 `json:"perplexity_quality"`
	PerplexityValue        float64 `json:"perplexity_value"`
	ClaudeQuality          float64 `json:"claude_quality"`
	ClaudeValue            float64 `json:"claude_value"`
	CouncilQuality         float64 `json:"council_quality"`
	CouncilValue           float64 `json:"council_value"`
	GrokPT                 float64 `json:"grok_pt"`
	GeminiPT               float64 `json:"gemini_pt"`
	GptPT                  float64 `json:"gpt_pt"`
	DeerFlowPT             float64 `json:"deer_flow_pt"`
	PerplexityPT           float64 `json:"perplexity_pt"`
	ClaudePT               float64 `json:"claude_pt"`
	CouncilPT              float64 `json:"council_pt"`
	GeminiWebUIOutput      *string `json:"gemini_webui_output"`
	GeminiWebUIInputAt     *string `json:"gemini_webui_input_at"`
	PerplexityWebUIOutput  *string `json:"perplexity_webui_output"`
	PerplexityWebUIInputAt *string `json:"perplexity_webui_input_at"`
	GptWebUIOutput         *string `json:"gpt_webui_output"`
	GptWebUIInputAt        *string `json:"gpt_webui_input_at"`
	ClaudeWebUIOutput      *string `json:"claude_webui_output"`
	ClaudeWebUIInputAt     *string `json:"claude_webui_input_at"`
	CouncilSourceOutput    *string `json:"council_source_output"`
	CouncilSourceInputAt   *string `json:"council_source_input_at"`
	CurrentPrice           float64 `json:"current_price"`
	TipRanksPT             float64 `json:"tipranks_pt"`
	AnalystPT              float64 `json:"analyst_pt"`
	Upside24M              float64 `json:"upside_24m"`
	Allocation             float64 `json:"allocation"`
	IncludeInSizing        bool    `json:"include_in_sizing"`
	PrimaryAssetClass      *string `json:"primary_asset_class"`
	// AssetClassSource lets a caller declare who chose the class — the
	// auto-assign feature sends "LLM_AUTO". Absent means a person did it.
	// Never persisted from here directly; see stampAssetClassSourceByTicker.
	AssetClassSource    string    `json:"asset_class_source,omitempty"`
	SecurityType        *string   `json:"security_type"`
	OverlaySellPriority int       `json:"overlay_sell_priority"`
	MarketCap           *string   `json:"market_cap"`
	RiskProfile         *string   `json:"risk_profile"`
	Notes               *string   `json:"notes"`
	Thesis              *string   `json:"thesis"`
	BearCasePT          float64   `json:"bear_case_pt"`
	BaseCasePT          float64   `json:"base_case_pt"`
	BullCasePT          float64   `json:"bull_case_pt"`
	BearProbability     float64   `json:"bear_probability"`
	BaseProbability     float64   `json:"base_probability"`
	BullProbability     float64   `json:"bull_probability"`
	Catalysts           *string   `json:"catalysts"`
	LastContributedAt   *string   `json:"last_contributed_at"`
	IsWatchlist         bool      `json:"is_watchlist"`
	IsExternal          bool      `json:"is_external"`
	Performance6MPct    *float64  `json:"performance_6m_pct,omitempty"`
	Performance12MPct   *float64  `json:"performance_12m_pct,omitempty"`
	PerformanceAsOf     *string   `json:"performance_as_of,omitempty"`
	PerformanceSource   *string   `json:"performance_source,omitempty"`
	UpdatedAt           time.Time `json:"updated_at"`
	CreatedAt           time.Time `json:"created_at"`
}

type OverlayAssetClassSetting struct {
	Key                string   `json:"key"`
	DisplayName        string   `json:"display_name"`
	AlertLabel         string   `json:"alert_label,omitempty"`
	AlertColor         string   `json:"alert_color,omitempty"`
	Kind               string   `json:"kind"`
	ParentCode         string   `json:"parent_code,omitempty"`
	IsPortfolioSleeve  bool     `json:"is_portfolio_sleeve"`
	IsSystemBucket     bool     `json:"is_system_bucket"`
	AllowGrouping      bool     `json:"allow_grouping"`
	AllowTargetWeight  bool     `json:"allow_target_weight"`
	OverlayEligible    bool     `json:"overlay_eligible"`
	DisplayOrder       int      `json:"display_order"`
	Q3SellPriority     *int     `json:"q3_sell_priority,omitempty"`
	Q3ThrottleFactor   *float64 `json:"q3_throttle_factor,omitempty"`
	Q4DLiquidityFactor *float64 `json:"q4d_liquidity_factor,omitempty"`
	Q1Category         bool     `json:"q1_category"`
	Q3Beneficiary      bool     `json:"q3_beneficiary"`
	RegimeIndependent  bool     `json:"regime_independent"`
	Q3Rating           string   `json:"q3_rating,omitempty"`
	Q3Logic            string   `json:"q3_logic,omitempty"`
	Stage2TargetPct    *float64 `json:"stage2_target_pct,omitempty"`
	Sector             string   `json:"sector,omitempty"`
	CashReserve        float64  `json:"cash_reserve"`
	// StockAllocationRatio is the fraction of the class budget reserved for
	// individual stocks (0–1). The remainder is allocated to ETFs.
	// Default 0.75 means 75% stocks, 25% ETFs.
	StockAllocationRatio float64 `json:"stock_allocation_ratio"`
	Active               bool    `json:"active"`
}

type AssetClass struct {
	Code              string `json:"code"`
	AssetClassCode    string `json:"asset_class_code"`
	DisplayName       string `json:"display_name"`
	ClassType         string `json:"class_type"`
	ParentCode        string `json:"parent_code,omitempty"`
	AllowGrouping     bool   `json:"allow_grouping"`
	AllowTargetWeight bool   `json:"allow_target_weight"`
	AnalysisEligible  bool   `json:"analysis_eligible"`
	InstrumentScope   string `json:"instrument_scope"`
	RiskBucket        string `json:"risk_bucket,omitempty"`
	Quartile          string `json:"quartile,omitempty"`
	DisplayOrder      int    `json:"display_order"`
	Active            bool   `json:"active"`
	// InMandate/MandateWeightPct: does the approved shape fund this class? The
	// class picker shows it so the consequence of choosing an unfunded class is
	// visible at the moment of choice. It never constrains the choice —
	// classifying something outside the mandate is how a shape gets revised.
	// See DOCS/system/PORTFOLIO_MANDATE_MODEL.md §2.
	InMandate        bool    `json:"in_mandate"`
	MandateWeightPct float64 `json:"mandate_weight_pct"`
}

type PortfolioOverlaySellCandidate struct {
	Ticker              string  `json:"ticker"`
	Name                string  `json:"name"`
	PositionValue       float64 `json:"position_value"`
	PortfolioWeightPct  float64 `json:"portfolio_weight_pct"`
	PositionExposurePct float64 `json:"position_exposure_pct"`
	OverlaySellPriority int     `json:"overlay_sell_priority"`
	AllocationPct       float64 `json:"allocation_pct"`
}

type PortfolioOverlayAssetClassSummary struct {
	AssetClass               string                          `json:"asset_class"`
	DisplayName              string                          `json:"display_name"`
	OverlayEligible          bool                            `json:"overlay_eligible"`
	DisplayOrder             int                             `json:"display_order"`
	StrategicWeightPct       float64                         `json:"strategic_weight_pct"`
	StrategicWeightSource    string                          `json:"strategic_weight_source"`
	TriggerInvestedPct       float64                         `json:"trigger_invested_pct,omitempty"`
	TriggerInvestedValue     float64                         `json:"trigger_invested_value,omitempty"`
	TriggerTacticalCashPct   float64                         `json:"trigger_tactical_cash_pct,omitempty"`
	TriggerTacticalCashValue float64                         `json:"trigger_tactical_cash_value,omitempty"`
	TriggerTotalClassPct     float64                         `json:"trigger_total_class_pct,omitempty"`
	TriggerTotalClassValue   float64                         `json:"trigger_total_class_value,omitempty"`
	AllowedInvestedPct       float64                         `json:"allowed_invested_pct"`
	AllowedInvestedValue     float64                         `json:"allowed_invested_value"`
	ActualInvestedPct        float64                         `json:"actual_invested_pct"`
	ActualInvestedValue      float64                         `json:"actual_invested_value"`
	TacticalCashPct          float64                         `json:"tactical_cash_pct"`
	TacticalCashValue        float64                         `json:"tactical_cash_value"`
	TotalClassCapitalPct     float64                         `json:"total_class_capital_pct"`
	TotalClassCapitalValue   float64                         `json:"total_class_capital_value"`
	DeltaPct                 float64                         `json:"delta_pct"`
	DeltaValue               float64                         `json:"delta_value"`
	Q3SellPriority           *int                            `json:"q3_sell_priority,omitempty"`
	Q3ThrottleFactor         *float64                        `json:"q3_throttle_factor,omitempty"`
	Q4DLiquidityFactor       *float64                        `json:"q4d_liquidity_factor,omitempty"`
	Stage2TargetPct          *float64                        `json:"stage2_target_pct,omitempty"`
	Stage2TargetValue        *float64                        `json:"stage2_target_value,omitempty"`
	Stage1RecordedReduction  float64                         `json:"stage1_recorded_reduction,omitempty"`
	SellCandidates           []PortfolioOverlaySellCandidate `json:"sell_candidates"`
}

type PortfolioOverlayStage2Item struct {
	AssetClass           string   `json:"asset_class"`
	DisplayName          string   `json:"display_name"`
	DisplayOrder         int      `json:"display_order"`
	TargetPct            float64  `json:"target_pct"`
	TargetValue          float64  `json:"target_value"`
	DefaultTargetPct     *float64 `json:"default_target_pct,omitempty"`
	CurrentInvestedPct   float64  `json:"current_invested_pct"`
	CurrentInvestedValue float64  `json:"current_invested_value"`
	OverlayEligible      bool     `json:"overlay_eligible"`
	Q3Beneficiary        bool     `json:"q3_beneficiary"`
	RegimeIndependent    bool     `json:"regime_independent"`
	Q3Rating             string   `json:"q3_rating,omitempty"`
	Q3Logic              string   `json:"q3_logic,omitempty"`
}

type PortfolioOverlayStage2Workflow struct {
	Mode            string                       `json:"mode"`
	PlaybookLabel   string                       `json:"playbook_label"`
	EventStatus     string                       `json:"event_status"`
	RegimeCashValue float64                      `json:"regime_cash_value"`
	RegimeCashPct   float64                      `json:"regime_cash_pct"`
	AllocatedPct    float64                      `json:"allocated_pct"`
	AllocatedValue  float64                      `json:"allocated_value"`
	RemainingPct    float64                      `json:"remaining_pct"`
	RemainingValue  float64                      `json:"remaining_value"`
	Items           []PortfolioOverlayStage2Item `json:"items"`
}

type OverlaySignalState struct {
	CurrentQ1ExposurePct     float64    `json:"current_q1_exposure_pct"`
	LastAppliedQ1ExposurePct float64    `json:"last_applied_q1_exposure_pct"`
	SpyQ1ExposurePct         float64    `json:"spy_q1_exposure_pct"`
	XaoQ1ExposurePct         float64    `json:"xao_q1_exposure_pct"`
	GoverningSource          string     `json:"governing_source"`
	LastSignalChangedAt      *time.Time `json:"last_signal_changed_at,omitempty"`
	LastAppliedAt            *time.Time `json:"last_applied_at,omitempty"`
}

type Q4CrisisState struct {
	Active             bool       `json:"active"`
	LastChangedAt      *time.Time `json:"last_changed_at"`
	LastAcknowledgedAt *time.Time `json:"last_acknowledged_at"`
	Reason             string     `json:"reason"`
	TargetEquityPct    float64    `json:"target_equity_pct"`
	UpdatedAt          *time.Time `json:"updated_at"`
}

type PortfolioRiskQ3Input struct {
	Active             bool     `json:"active"`
	SPXTargetPct       *float64 `json:"spx_target_pct,omitempty"`
	SpyTargetPct       *float64 `json:"spy_target_pct,omitempty"` // Deprecated: use spx_target_pct.
	XaoTargetPct       *float64 `json:"xao_target_pct"`
	EffectiveTargetPct *float64 `json:"effective_target_pct"`
	GoverningSource    string   `json:"governing_source"`
}

type PortfolioRiskQ4Input struct {
	Active             bool       `json:"active"`
	TargetPct          float64    `json:"target_pct"`
	Reason             string     `json:"reason"`
	LastChangedAt      *time.Time `json:"last_changed_at"`
	LastAcknowledgedAt *time.Time `json:"last_acknowledged_at"`
	UpdatedAt          *time.Time `json:"updated_at"`
}

type PortfolioRiskInputs struct {
	Q3 PortfolioRiskQ3Input `json:"q3"`
	Q4 PortfolioRiskQ4Input `json:"q4"`
}

type PortfolioRiskState struct {
	Mode         string              `json:"mode"`
	Label        string              `json:"label"`
	Priority     int                 `json:"priority"`
	TargetPct    float64             `json:"target_pct"`
	TargetKind   string              `json:"target_kind"`
	ActiveReason string              `json:"active_reason"`
	Inputs       PortfolioRiskInputs `json:"inputs"`
}

type PortfolioRiskHeaderQ3State struct {
	TargetPct         float64    `json:"target_pct"`
	Source            string     `json:"source"`
	Active            bool       `json:"active"`
	SPXTargetPct      *float64   `json:"spx_target_pct,omitempty"`
	SpyTargetPct      *float64   `json:"spy_target_pct,omitempty"` // Deprecated: use spx_target_pct.
	XaoTargetPct      *float64   `json:"xao_target_pct"`
	SPXLastUpdated    *time.Time `json:"spx_last_updated,omitempty"`
	SpyLastUpdated    *time.Time `json:"spy_last_updated,omitempty"` // Deprecated: use spx_last_updated.
	XaoLastUpdated    *time.Time `json:"xao_last_updated"`
	LastSignalChanged *time.Time `json:"last_signal_changed_at"`
	LastAppliedPct    *float64   `json:"last_applied_pct"`
	LastAppliedAt     *time.Time `json:"last_applied_at"`
}

type PortfolioRiskHeaderStateResponse struct {
	Q3          *PortfolioRiskHeaderQ3State  `json:"q3"`
	Q4          *Q4CrisisState               `json:"q4"`
	BaselineMix PortfolioMixSnapshotResponse `json:"baseline_mix"`
}

type OverlayEventClass struct {
	AssetClass               string
	OverlayEligible          bool
	TriggerInvestedValue     float64
	TriggerInvestedPct       float64
	TriggerTacticalCashValue float64
	TriggerTotalClassValue   float64
	TargetInvestedValue      float64
	TargetInvestedPct        float64
	Q3SellPriority           *int
	Stage2TargetPct          *float64
	Stage1RecordedReduction  float64
}

type OverlayEvent struct {
	ID                           int64
	Status                       string
	FromQ1ExposurePct            float64
	ToQ1ExposurePct              float64
	AdjustmentRatio              float64
	GoverningSource              string
	TriggeredAt                  time.Time
	Stage1AppliedAt              *time.Time
	Stage1RequiredReductionValue float64
	Stage1RecordedReductionValue float64
	Stage1BaselineReserveValue   float64
	Stage1ExpectedReserveValue   float64
	Stage1ImportBaselineAt       *time.Time
	ReserveConfirmedAt           *time.Time
	ReserveConfirmedValue        *float64
	ReserveVariance              *float64
	CashConfirmationStatus       string
	Stage2CompletedAt            *time.Time
	BaselineAcceptedAt           *time.Time
}

type ApplyStage1SourceRequest struct {
	HoldingID  *int64  `json:"holding_id,omitempty"`
	StockName  string  `json:"stock_name"`
	Ticker     string  `json:"ticker"`
	AssetClass string  `json:"asset_class"`
	GroupID    string  `json:"group_id,omitempty"`
	GroupLabel string  `json:"group_label,omitempty"`
	AmountSold float64 `json:"amount_sold"`
}

type ApplyStage1Request struct {
	RequiredReductionValue float64                    `json:"required_reduction_value"`
	RecordedReductionValue float64                    `json:"recorded_reduction_value"`
	BaselineReserveValue   float64                    `json:"baseline_reserve_value"`
	ExpectedReserveValue   float64                    `json:"expected_reserve_value"`
	Sources                []ApplyStage1SourceRequest `json:"sources"`
}

type PortfolioOverlayCashReconciliation struct {
	BaselineReserveValue float64 `json:"baseline_reserve_value"`
	ExpectedReserveValue float64 `json:"expected_reserve_value"`
	ImportedReserveValue float64 `json:"imported_reserve_value"`
	ReserveVariance      float64 `json:"reserve_variance"`
	Status               string  `json:"status"`
	ConfirmedAt          *string `json:"confirmed_at,omitempty"`
	LatestImportAt       *string `json:"latest_import_at,omitempty"`
	Tolerance            float64 `json:"tolerance"`
}

type PortfolioOverlaySourceReconciliation struct {
	ID                 int64   `json:"id"`
	HoldingID          *int64  `json:"holding_id,omitempty"`
	StockName          string  `json:"stock_name"`
	Ticker             string  `json:"ticker"`
	AssetClass         string  `json:"asset_class"`
	GroupID            string  `json:"group_id,omitempty"`
	GroupLabel         string  `json:"group_label,omitempty"`
	BeforeValue        float64 `json:"before_value"`
	ExpectedReduction  float64 `json:"expected_reduction"`
	ExpectedAfterValue float64 `json:"expected_after_value"`
	ImportedValue      float64 `json:"imported_value"`
	ActualReduction    float64 `json:"actual_reduction"`
	Variance           float64 `json:"variance"`
	Status             string  `json:"status"`
}

type PortfolioOverlayClassReconciliation struct {
	AssetClass         string  `json:"asset_class"`
	DisplayName        string  `json:"display_name"`
	BeforeValue        float64 `json:"before_value"`
	ExpectedReduction  float64 `json:"expected_reduction"`
	ExpectedAfterValue float64 `json:"expected_after_value"`
	ImportedValue      float64 `json:"imported_value"`
	ActualReduction    float64 `json:"actual_reduction"`
	Variance           float64 `json:"variance"`
	Status             string  `json:"status"`
}

type PortfolioOverlayReconciliation struct {
	EventID          int64                                  `json:"event_id"`
	EventStatus      string                                 `json:"event_status"`
	CashConfirmation string                                 `json:"cash_confirmation_status"`
	Stage1AppliedAt  *string                                `json:"stage1_applied_at,omitempty"`
	Cash             PortfolioOverlayCashReconciliation     `json:"cash"`
	SourceChecks     []PortfolioOverlaySourceReconciliation `json:"source_checks"`
	AssetClassChecks []PortfolioOverlayClassReconciliation  `json:"asset_class_checks"`
	SourceStatus     string                                 `json:"source_status"`
	AssetClassStatus string                                 `json:"asset_class_status"`
	OverallStatus    string                                 `json:"overall_status"`
	ImportReceived   bool                                   `json:"import_received"`
}

type PortfolioOverlaySummary struct {
	EffectiveEquityPct           float64                             `json:"effective_equity_pct"`
	OverlayMultiplier            float64                             `json:"overlay_multiplier"`
	SPXTargetPct                 float64                             `json:"spx_target_pct"`
	SpyTargetPct                 float64                             `json:"spy_target_pct"` // Deprecated: use spx_target_pct.
	XaoTargetPct                 float64                             `json:"xao_target_pct"`
	GoverningSource              string                              `json:"governing_source"`
	StrategicWeightSource        string                              `json:"strategic_weight_source"`
	OverlayStatus                string                              `json:"overlay_status"`
	PortfolioValue               float64                             `json:"portfolio_value"`
	PortfolioCashBucketValue     float64                             `json:"portfolio_cash_bucket_value"`
	PortfolioCashBucketPct       float64                             `json:"portfolio_cash_bucket_pct"`
	ActualEligibleInvestedPct    float64                             `json:"actual_eligible_invested_pct"`
	ActualEligibleInvestedValue  float64                             `json:"actual_eligible_invested_value"`
	AllowedEligibleInvestedPct   float64                             `json:"allowed_eligible_invested_pct"`
	AllowedEligibleInvestedValue float64                             `json:"allowed_eligible_invested_value"`
	RequiredDeRiskPct            float64                             `json:"required_de_risk_pct"`
	RequiredDeRiskValue          float64                             `json:"required_de_risk_value"`
	AvailableHeadroomPct         float64                             `json:"available_headroom_pct"`
	AvailableHeadroomValue       float64                             `json:"available_headroom_value"`
	TotalTacticalCashValue       float64                             `json:"total_tactical_cash_value"`
	TotalTacticalCashPct         float64                             `json:"total_tactical_cash_pct"`
	LastAppliedQ1ExposurePct     float64                             `json:"last_applied_q1_exposure_pct"`
	SignalAdjustmentRatio        float64                             `json:"signal_adjustment_ratio"`
	ActiveEventID                *int64                              `json:"active_event_id,omitempty"`
	ActiveEventStatus            string                              `json:"active_event_status,omitempty"`
	ActiveEventGoverningSource   string                              `json:"active_event_governing_source,omitempty"`
	ActiveEventTriggeredAt       *time.Time                          `json:"active_event_triggered_at,omitempty"`
	ActiveEventFromQ1ExposurePct *float64                            `json:"active_event_from_q1_exposure_pct,omitempty"`
	ActiveEventToQ1ExposurePct   *float64                            `json:"active_event_to_q1_exposure_pct,omitempty"`
	ActiveEventStage1AppliedAt   *time.Time                          `json:"active_event_stage1_applied_at,omitempty"`
	Stage1RequiredReductionValue float64                             `json:"stage1_required_reduction_value,omitempty"`
	Stage1RecordedReductionValue float64                             `json:"stage1_recorded_reduction_value,omitempty"`
	Stage1BaselineReserveValue   float64                             `json:"stage1_baseline_reserve_value,omitempty"`
	Stage1ExpectedReserveValue   float64                             `json:"stage1_expected_reserve_value,omitempty"`
	Stage1ImportBaselineAt       *time.Time                          `json:"stage1_import_baseline_at,omitempty"`
	ReserveConfirmedAt           *time.Time                          `json:"reserve_confirmed_at,omitempty"`
	ReserveConfirmedValue        *float64                            `json:"reserve_confirmed_value,omitempty"`
	ReserveVariance              *float64                            `json:"reserve_variance,omitempty"`
	CashConfirmationStatus       string                              `json:"cash_confirmation_status,omitempty"`
	ActiveEventStage2CompletedAt *time.Time                          `json:"active_event_stage2_completed_at,omitempty"`
	CanApplyStage1               bool                                `json:"can_apply_stage1"`
	CanCompleteStage2            bool                                `json:"can_complete_stage2"`
	CanAcceptBaseline            bool                                `json:"can_accept_baseline"`
	LastSignalChangedAt          *time.Time                          `json:"last_signal_changed_at,omitempty"`
	LastAppliedAt                *time.Time                          `json:"last_applied_at,omitempty"`
	UsingStage1Snapshot          bool                                `json:"using_stage1_snapshot"`
	Stage1SnapshotAt             *time.Time                          `json:"stage1_snapshot_at,omitempty"`
	Q4Crisis                     Q4CrisisState                       `json:"q4_crisis"`
	PortfolioRisk                PortfolioRiskState                  `json:"portfolio_risk"`
	Stage2Workflow               *PortfolioOverlayStage2Workflow     `json:"stage2_workflow,omitempty"`
	AssetClasses                 []PortfolioOverlayAssetClassSummary `json:"asset_classes"`
	Settings                     []OverlayAssetClassSetting          `json:"settings"`
}

type PortfolioMixRow struct {
	AssetClass          string  `json:"asset_class"`
	DisplayName         string  `json:"display_name"`
	DisplayOrder        int     `json:"display_order"`
	GovernedByQ1        bool    `json:"governed_by_q1"`
	WeightPct           float64 `json:"weight_pct"`
	InvestedWeightPct   float64 `json:"invested_weight_pct"`
	SleeveCashWeightPct float64 `json:"sleeve_cash_weight_pct"`
	Value               float64 `json:"value"`
	InvestedValue       float64 `json:"invested_value"`
	SleeveCashValue     float64 `json:"sleeve_cash_value"`
}

type PortfolioCashComponent struct {
	Key          string  `json:"key"`
	DisplayName  string  `json:"display_name"`
	Ticker       string  `json:"ticker,omitempty"`
	Value        float64 `json:"value"`
	WeightPct    float64 `json:"weight_pct"`
	DisplayOrder int     `json:"display_order"`
}

type PortfolioMixSnapshotMeta struct {
	ID                    int64      `json:"id"`
	Status                string     `json:"status"`
	Reason                string     `json:"reason"`
	SourceRebalancePlanID *int64     `json:"source_rebalance_plan_id,omitempty"`
	Notes                 string     `json:"notes,omitempty"`
	ApprovedAt            *time.Time `json:"approved_at,omitempty"`
	CreatedAt             *time.Time `json:"created_at,omitempty"`
}

type PortfolioMixCurrentResponse struct {
	AsOf           time.Time                `json:"as_of"`
	TotalValue     float64                  `json:"total_value"`
	Rows           []PortfolioMixRow        `json:"rows"`
	CashComponents []PortfolioCashComponent `json:"cash_components"`
}

type PortfolioMixSnapshotResponse struct {
	Snapshot       *PortfolioMixSnapshotMeta    `json:"snapshot"`
	Rows           []PortfolioMixRow            `json:"rows"`
	ApprovalPolicy *portfoliomix.ApprovalPolicy `json:"approval_policy,omitempty"`
}

type PortfolioRebalancePlanRow struct {
	AssetClass        string  `json:"asset_class"`
	DisplayName       string  `json:"display_name"`
	DisplayOrder      int     `json:"display_order"`
	GovernedByQ1      bool    `json:"governed_by_q1"`
	CurrentWeightPct  float64 `json:"current_weight_pct"`
	TargetWeightPct   float64 `json:"target_weight_pct"`
	DeltaWeightPct    float64 `json:"delta_weight_pct"`
	RecordedMoveValue float64 `json:"recorded_move_value,omitempty"`
	Note              string  `json:"note,omitempty"`
}

type PortfolioRebalancePlan struct {
	ID               int64                       `json:"id"`
	Status           string                      `json:"status"`
	Driver           string                      `json:"driver"`
	Title            string                      `json:"title,omitempty"`
	Notes            string                      `json:"notes,omitempty"`
	MemoJobID        string                      `json:"memo_job_id,omitempty"`
	SourceSnapshotID *int64                      `json:"source_snapshot_id,omitempty"`
	CreatedAt        *time.Time                  `json:"created_at,omitempty"`
	UpdatedAt        *time.Time                  `json:"updated_at,omitempty"`
	CompletedAt      *time.Time                  `json:"completed_at,omitempty"`
	ApprovedAt       *time.Time                  `json:"approved_at,omitempty"`
	Rows             []PortfolioRebalancePlanRow `json:"rows"`
}

type AdjustmentPlanRow struct {
	Key              string  `json:"key"`
	Label            string  `json:"label"`
	CurrentWeightPct float64 `json:"current_weight_pct"`
	TargetWeightPct  float64 `json:"target_weight_pct"`
	DeltaWeightPct   float64 `json:"delta_weight_pct"`
	CurrentValue     float64 `json:"current_value"`
	TargetValue      float64 `json:"target_value"`
	DeltaValue       float64 `json:"delta_value"`
	Direction        string  `json:"direction"`
	RequiredValue    float64 `json:"required_value"`
	RecordedValue    float64 `json:"recorded_value"`
	RemainingValue   float64 `json:"remaining_value"`
	Status           string  `json:"status"`
}

type AdjustmentImportCheck struct {
	Key               string  `json:"key"`
	Label             string  `json:"label"`
	ExpectedWeightPct float64 `json:"expected_weight_pct"`
	ImportedWeightPct float64 `json:"imported_weight_pct"`
	VarianceWeightPct float64 `json:"variance_weight_pct"`
	ExpectedValue     float64 `json:"expected_value"`
	ImportedValue     float64 `json:"imported_value"`
	VarianceValue     float64 `json:"variance_value"`
	Status            string  `json:"status"`
}

type AdjustmentImportValidation struct {
	Passed                bool                    `json:"passed"`
	CheckedRows           int                     `json:"checked_rows"`
	VarianceRows          int                     `json:"variance_rows"`
	TotalAbsVariancePct   float64                 `json:"total_abs_variance_pct"`
	TotalAbsVarianceValue float64                 `json:"total_abs_variance_value"`
	TolerancePct          float64                 `json:"tolerance_pct"`
	ToleranceValue        float64                 `json:"tolerance_value"`
	Checks                []AdjustmentImportCheck `json:"checks"`
}

type AdjustmentPlan struct {
	ID                     string                      `json:"id"`
	SourceType             string                      `json:"source_type"`
	SourceID               int64                       `json:"source_id"`
	SourceStatus           string                      `json:"source_status"`
	Title                  string                      `json:"title"`
	Stage                  string                      `json:"stage"`
	Status                 string                      `json:"status"`
	TotalValue             float64                     `json:"total_value"`
	RequiredDecreaseValue  float64                     `json:"required_decrease_value"`
	RecordedDecreaseValue  float64                     `json:"recorded_decrease_value"`
	RemainingDecreaseValue float64                     `json:"remaining_decrease_value"`
	RequiredIncreaseValue  float64                     `json:"required_increase_value"`
	RecordedIncreaseValue  float64                     `json:"recorded_increase_value"`
	RemainingIncreaseValue float64                     `json:"remaining_increase_value"`
	ToleranceValue         float64                     `json:"tolerance_value"`
	ReadyToConfirm         bool                        `json:"ready_to_confirm"`
	Rows                   []AdjustmentPlanRow         `json:"rows"`
	ImportValidation       *AdjustmentImportValidation `json:"import_validation,omitempty"`
	CreatedAt              *time.Time                  `json:"created_at,omitempty"`
	UpdatedAt              *time.Time                  `json:"updated_at,omitempty"`
	CompletedAt            *time.Time                  `json:"completed_at,omitempty"`
	ApprovedAt             *time.Time                  `json:"approved_at,omitempty"`
}

type AdjustmentPlanResponse struct {
	Plan *AdjustmentPlan `json:"plan"`
}
