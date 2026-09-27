package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// Commodity-theme confirmations are deliberately separate from generic market
// regimes. They are append-only evidence for an advisory capacity model; they
// do not change portfolio weights, positions, or cash.

type commodityThemeConfig struct {
	Code                    string
	DisplayName             string
	MarketGroup             string
	StrategicFloorAssetCode string
	TacticalAssetCode       string
	DirectExpression        commodityThemeDirectExpressionConfig
}

type commodityThemeDefinition struct {
	Theme            commodityThemeConfig
	DirectExpression commodityThemeDirectExpressionConfig
	Stages           []commodityThemeStageConfig
}

// commodityThemeDirectExpressionConfig describes whether the direct-market
// signal has an approved execution vehicle. A chart symbol is evidence only;
// it is never assumed to be a product available to the account.
type commodityThemeDirectExpressionConfig struct {
	ThemeCode                 string
	Status                    string
	InstrumentLabel           string
	InstrumentTicker          string
	InstrumentKind            string
	ExistingPositionTreatment string
}

type commodityThemeStageConfig struct {
	ThemeCode         string
	Key               string
	StageOrder        int
	Scope             string
	Label             string
	SourceKind        string
	SourceSymbol      string
	SourceNumerator   string
	SourceDenominator string
	SourceLabel       string
	RequiredScript    string
}

type commodityThemeSource struct {
	Kind        string `json:"kind"`
	Symbol      string `json:"symbol,omitempty"`
	Numerator   string `json:"numerator,omitempty"`
	Denominator string `json:"denominator,omitempty"`
	Label       string `json:"label,omitempty"`
}

type commodityThemeWebhookPayload struct {
	EventID       string `json:"event_id"`
	Theme         string `json:"theme"`
	Stage         string `json:"stage"`
	Scope         string `json:"scope"`
	Signal        string `json:"signal"`
	Script        string `json:"script"`
	SignalVersion string `json:"signal_version"`
	Security      *struct {
		Ticker string `json:"ticker"`
	} `json:"security,omitempty"`
	Source      commodityThemeSource `json:"source"`
	Timeframe   string               `json:"timeframe"`
	BarClosedAt string               `json:"bar_closed_at,omitempty"`
	Close       *float64             `json:"close,omitempty"`
}

// commodityThemeFeedInitialisation records the state observed when a user
// confirms a TradingView feed in the connection ledger. It is deliberately not
// a webhook payload: initialisation establishes a baseline and never projects a
// trading action.
type commodityThemeFeedInitialisation struct {
	Theme    string `json:"theme"`
	Stage    string `json:"stage"`
	Signal   string `json:"signal"`
	Security *struct {
		Ticker string `json:"ticker"`
	} `json:"security,omitempty"`
}

type commodityThemeEvent struct {
	ID             int64
	ThemeCode      string
	StageKey       string
	Scope          string
	SecurityID     *int64
	SecurityTicker string
	Signal         string
	Script         string
	SignalVersion  string
	Source         commodityThemeSource
	Timeframe      string
	BarClosedAt    *time.Time
	ReceivedAt     time.Time
	Close          *float64
}

type resolvedCommodityThemeSecurity struct {
	ID                int64
	Ticker            string
	PrimaryAssetClass string
	SecurityType      string
}

type commodityThemeHeldPosition struct {
	Ticker string
	Value  float64
}

type commodityThemeSecurityTrendState struct {
	Signal    string
	UpdatedAt time.Time
}

type commodityThemeStageResponse struct {
	Key                   string               `json:"key"`
	Order                 int                  `json:"order"`
	Scope                 string               `json:"scope"`
	Label                 string               `json:"label"`
	Status                string               `json:"status"`
	Signal                string               `json:"signal,omitempty"`
	Close                 *float64             `json:"close,omitempty"`
	Return60DPct          *float64             `json:"return_60d_pct,omitempty"`
	PerformanceAsOf       *time.Time           `json:"performance_as_of,omitempty"`
	Timeframe             string               `json:"timeframe,omitempty"`
	Source                commodityThemeSource `json:"source"`
	EligibleSecurityCount int                  `json:"eligible_security_count,omitempty"`
	BlockedSecurityCount  int                  `json:"blocked_security_count,omitempty"`
	EligibleSecurityTotal int                  `json:"eligible_security_total,omitempty"`
	LastConfirmedAt       *time.Time           `json:"last_confirmed_at,omitempty"`
	LastEventAt           *time.Time           `json:"last_event_at,omitempty"`
}

type commodityThemeAllocation struct {
	AssetClassCode string  `json:"asset_class_code"`
	TargetValue    float64 `json:"target_value"`
	ActualValue    float64 `json:"actual_value"`
}

// commodityThemeClassCapital keeps actual market exposure distinct from cash
// deliberately assigned to the same asset-class sleeve.
type commodityThemeClassCapital struct {
	AssetClassCode  string  `json:"asset_class_code"`
	TargetValue     float64 `json:"target_value"`
	InvestedValue   float64 `json:"invested_value"`
	SleeveCashValue float64 `json:"sleeve_cash_value"`
	CapitalValue    float64 `json:"capital_value"`
	BudgetApproved  bool    `json:"budget_approved"`
}

type commodityThemeDirectExpression struct {
	Status                    string `json:"status"`
	InstrumentLabel           string `json:"instrument_label,omitempty"`
	InstrumentTicker          string `json:"instrument_ticker,omitempty"`
	InstrumentKind            string `json:"instrument_kind,omitempty"`
	ExistingPositionTreatment string `json:"existing_position_treatment"`
}

type commodityThemeReview struct {
	Key            string `json:"key"`
	Scope          string `json:"scope"`
	Status         string `json:"status"`
	AssetClassCode string `json:"asset_class_code"`
	Label          string `json:"label"`
	Detail         string `json:"detail"`
}

type commodityThemeTacticalAllocation struct {
	AssetClassCode string  `json:"asset_class_code"`
	MaximumValue   float64 `json:"maximum_value"`
	PermittedValue float64 `json:"permitted_value"`
	ActualValue    float64 `json:"actual_value"`
	AvailableValue float64 `json:"available_value"`
	BudgetApproved bool    `json:"budget_approved"`
}

type commodityThemeSecurityResponse struct {
	SecurityID      int64                                  `json:"security_id"`
	Ticker          string                                 `json:"ticker"`
	Name            string                                 `json:"name"`
	IncludeInSizing bool                                   `json:"include_in_sizing"`
	StageStates     map[string]string                      `json:"stage_states"`
	LatestEvents    map[string]*commodityThemeEventSummary `json:"latest_events"`
}

// commodityThemeFundResponse is a producer ETF assigned to the theme's equity
// class. Funds are shown beside company evidence for their own CDF trend only:
// they have no Outperform feed and never count towards company totals.
type commodityThemeFundResponse struct {
	SecurityID     int64      `json:"security_id"`
	Ticker         string     `json:"ticker"`
	Name           string     `json:"name"`
	TrendState     string     `json:"trend_state"`
	TrendUpdatedAt *time.Time `json:"trend_updated_at,omitempty"`
}

type commodityThemeEventSummary struct {
	Signal     string               `json:"signal"`
	Close      *float64             `json:"close,omitempty"`
	Source     commodityThemeSource `json:"source"`
	Script     string               `json:"script"`
	Timeframe  string               `json:"timeframe"`
	OccurredAt *time.Time           `json:"occurred_at,omitempty"`
}

type commodityThemeResponse struct {
	Code               string                           `json:"code"`
	DisplayName        string                           `json:"display_name"`
	MarketGroup        string                           `json:"market_group,omitempty"`
	Status             string                           `json:"status"`
	ConfirmationCount  int                              `json:"confirmation_count"`
	ConfirmationTotal  int                              `json:"confirmation_total"`
	StrategicFloor     commodityThemeAllocation         `json:"strategic_floor"`
	Tactical           commodityThemeTacticalAllocation `json:"tactical"`
	DirectExpression   commodityThemeDirectExpression   `json:"direct_expression"`
	DirectSleeve       commodityThemeClassCapital       `json:"direct_sleeve"`
	EquitySleeve       commodityThemeClassCapital       `json:"equity_sleeve"`
	Reviews            []commodityThemeReview           `json:"reviews"`
	Stages             []commodityThemeStageResponse    `json:"stages"`
	EligibleSecurities []commodityThemeSecurityResponse `json:"eligible_securities,omitempty"`
	ProducerFunds      []commodityThemeFundResponse     `json:"producer_funds,omitempty"`
}

type commodityThemesResponse struct {
	GeneratedAt time.Time                `json:"generated_at"`
	Themes      []commodityThemeResponse `json:"themes"`
}

func ensureCommodityThemeSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	// Retire the short-lived parallel feed ledger. Connection setup now belongs
	// exclusively to active_alerts, alongside Stock Connections.
	if _, err := db.Exec(`DROP TABLE IF EXISTS commodity_theme_feed_setups`); err != nil {
		return err
	}

	statements := []string{
		`CREATE TABLE IF NOT EXISTS commodity_themes (
			code TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			market_group TEXT NOT NULL DEFAULT '',
			strategic_floor_asset_class_code TEXT NOT NULL,
			tactical_asset_class_code TEXT NOT NULL,
			active BOOLEAN NOT NULL DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS commodity_theme_direct_expressions (
			theme_code TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'SIGNAL_ONLY' CHECK(status IN ('SIGNAL_ONLY', 'APPROVED')),
			instrument_label TEXT NOT NULL DEFAULT '',
			instrument_ticker TEXT NOT NULL DEFAULT '',
			instrument_kind TEXT NOT NULL DEFAULT '',
			existing_position_treatment TEXT NOT NULL DEFAULT 'CLASS_DEFINED',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(theme_code) REFERENCES commodity_themes(code) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS commodity_theme_stages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			theme_code TEXT NOT NULL,
			stage_key TEXT NOT NULL,
			stage_order INTEGER NOT NULL,
			scope TEXT NOT NULL CHECK(scope IN ('THEME', 'SECURITY')),
			label TEXT NOT NULL,
			source_kind TEXT NOT NULL,
			source_symbol TEXT NOT NULL DEFAULT '',
			source_numerator TEXT NOT NULL DEFAULT '',
			source_denominator TEXT NOT NULL DEFAULT '',
			source_label TEXT NOT NULL DEFAULT '',
			required_script TEXT NOT NULL DEFAULT '',
			active BOOLEAN NOT NULL DEFAULT 1,
			UNIQUE(theme_code, stage_key),
			FOREIGN KEY(theme_code) REFERENCES commodity_themes(code) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS commodity_theme_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_key TEXT NOT NULL UNIQUE,
			theme_code TEXT NOT NULL,
			stage_key TEXT NOT NULL,
			scope TEXT NOT NULL CHECK(scope IN ('THEME', 'SECURITY')),
			security_id INTEGER,
			security_ticker TEXT NOT NULL DEFAULT '',
			signal TEXT NOT NULL CHECK(signal IN ('BUY', 'SELL', 'CONNECT')),
			script TEXT NOT NULL,
			signal_version TEXT NOT NULL,
			source_json TEXT NOT NULL,
			timeframe TEXT NOT NULL DEFAULT '',
			bar_closed_at DATETIME,
			close REAL,
			received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			raw_payload_json TEXT NOT NULL DEFAULT '{}',
			FOREIGN KEY(theme_code) REFERENCES commodity_themes(code) ON DELETE CASCADE,
			FOREIGN KEY(security_id) REFERENCES security_identities(id) ON DELETE SET NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_commodity_theme_events_stage
			ON commodity_theme_events(theme_code, stage_key, scope, bar_closed_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_commodity_theme_events_security
			ON commodity_theme_events(theme_code, stage_key, security_id, bar_closed_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS commodity_price_daily (
			source_symbol TEXT NOT NULL,
			provider_symbol TEXT NOT NULL,
			observed_date DATE NOT NULL,
			close_price REAL NOT NULL,
			currency TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT 'YAHOO',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(source_symbol, observed_date, source)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_commodity_price_daily_source_date
			ON commodity_price_daily(source_symbol, observed_date DESC)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	if !sqliteTableColumnExists("commodity_themes", "market_group") {
		if _, err := db.Exec(`ALTER TABLE commodity_themes ADD COLUMN market_group TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}

	// The registry is intentionally data-backed. It distinguishes the commodity,
	// its producer basket, the canonical CDF read model, and the company-vs-basket test.
	// A theme may be visible before it has a portfolio mandate or active signals.
	definitions := []commodityThemeDefinition{
		newCommodityThemeDefinition("GOLD", "Gold", "Precious metals", "PHYSICAL_GOLD", "GOLD_MINERS", "Gold price", "AMEX:GLD", "AMEX:GDX", "AMEX:GLD", "Gold equities / gold"),
		newCommodityThemeDefinition("SILVER", "Silver", "Precious metals", "PHYSICAL_SILVER", "SILVER_MINERS", "Silver price", "TVC:SILVER", "AMEX:SILJ", "AMEX:SLV", "SILJ / SLV"),
		newCommodityThemeDefinition("COPPER", "Copper", "Industrial materials", "DIRECT_COMMODITIES", "COPPER_MINERS", "Copper price", "COMEX:HG1!", "AMEX:COPX", "AMEX:CPER", "COPX / copper"),
		newCommodityThemeDefinition("OIL_PRODUCERS", "Oil producers", "Energy", "ENERGY_COMMODITIES", "ENERGY_PRODUCERS", "WTI crude", "NYMEX:CL1!", "AMEX:XOP", "NYMEX:CL1!", "XOP / WTI"),
		newCommodityThemeDefinition("OIL_SERVICES", "Oil services", "Energy", "ENERGY_COMMODITIES", "OIL_SERVICES", "WTI crude", "NYMEX:CL1!", "AMEX:OIH", "NYMEX:CL1!", "OIH / WTI"),
		newCommodityThemeDefinition("NATURAL_GAS", "Natural gas producers", "Energy", "NATURAL_GAS", "NATURAL_GAS_PRODUCERS", "Natural gas", "NYMEX:NG1!", "AMEX:FCG", "NYMEX:NG1!", "FCG / natural gas"),
		newCommodityThemeDefinition("URANIUM", "Uranium", "Industrial materials", "DIRECT_COMMODITIES", "URANIUM_MINERS", "Uranium price", "OTC:SRUUF", "AMEX:URNM", "OTC:SRUUF", "URNM / uranium"),
		newCommodityThemeDefinition("PLATINUM", "Platinum", "Precious metals", "DIRECT_COMMODITIES", "PGM_MINERS", "Platinum price", "AMEX:PPLT", "NYSE:SBSW", "AMEX:PPLT", "SBSW / platinum"),
		newCommodityThemeDefinition("LITHIUM", "Lithium", "Industrial materials", "DIRECT_COMMODITIES", "LITHIUM_MINERS", "Battery metals", "AMEX:EVMT", "AMEX:LITP", "AMEX:EVMT", "LITP / battery metals"),
		newCommodityThemeDefinition("STEEL", "Steel producers", "Industrial materials", "DIRECT_COMMODITIES", "STEEL_METALS_PROCESSING", "Hot-rolled coil", "CME:HRC1!", "AMEX:SLX", "CME:HRC1!", "SLX / steel"),
	}
	for _, definition := range definitions {
		if _, err := db.Exec(`
			INSERT INTO commodity_themes (
				code, display_name, market_group, strategic_floor_asset_class_code, tactical_asset_class_code
			) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(code) DO UPDATE SET
				market_group = CASE
					WHEN TRIM(COALESCE(commodity_themes.market_group, '')) = '' THEN excluded.market_group
					ELSE commodity_themes.market_group
				END
		`, definition.Theme.Code, definition.Theme.DisplayName, definition.Theme.MarketGroup, definition.Theme.StrategicFloorAssetCode, definition.Theme.TacticalAssetCode); err != nil {
			return err
		}
		if _, err := db.Exec(`
			INSERT INTO commodity_theme_direct_expressions (
				theme_code, status, instrument_label, instrument_ticker, instrument_kind, existing_position_treatment
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(theme_code) DO NOTHING
		`, definition.DirectExpression.ThemeCode, definition.DirectExpression.Status,
			definition.DirectExpression.InstrumentLabel, definition.DirectExpression.InstrumentTicker,
			definition.DirectExpression.InstrumentKind, definition.DirectExpression.ExistingPositionTreatment); err != nil {
			return err
		}
		for _, stage := range definition.Stages {
			if _, err := db.Exec(`
			INSERT INTO commodity_theme_stages (
				theme_code, stage_key, stage_order, scope, label, source_kind,
				source_symbol, source_numerator, source_denominator, source_label, required_script
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(theme_code, stage_key) DO NOTHING
			`, stage.ThemeCode, stage.Key, stage.StageOrder, stage.Scope, stage.Label, stage.SourceKind,
				stage.SourceSymbol, stage.SourceNumerator, stage.SourceDenominator, stage.SourceLabel, stage.RequiredScript); err != nil {
				return err
			}
		}
		// SECURITY_LEADERSHIP was an advisory-only TMS transport name. Keep its
		// historical events, but remove it from the active registry so new
		// security-relative CDF events use SECURITY_OUTPERFORM.
		if _, err := db.Exec(`
			UPDATE commodity_theme_stages
			SET active = 0
			WHERE theme_code = ? AND stage_key = 'SECURITY_LEADERSHIP'
		`, definition.Theme.Code); err != nil {
			return err
		}
	}
	return nil
}

func newCommodityThemeDefinition(
	code, displayName, marketGroup, strategicFloorAssetCode, tacticalAssetCode,
	commodityLabel, commoditySymbol, equityNumerator, equityDenominator, equityLabel string,
) commodityThemeDefinition {
	return commodityThemeDefinition{
		Theme: commodityThemeConfig{
			Code: code, DisplayName: displayName, MarketGroup: marketGroup,
			StrategicFloorAssetCode: strategicFloorAssetCode, TacticalAssetCode: tacticalAssetCode,
		},
		DirectExpression: commodityThemeDirectExpressionConfig{
			ThemeCode: code, Status: "SIGNAL_ONLY", ExistingPositionTreatment: "CLASS_DEFINED",
		},
		Stages: []commodityThemeStageConfig{
			{ThemeCode: code, Key: "COMMODITY", StageOrder: 1, Scope: "THEME", Label: commodityLabel, SourceKind: "UNDERLYING_PRICE", SourceSymbol: commoditySymbol, SourceLabel: commodityLabel, RequiredScript: "cdf"},
			{ThemeCode: code, Key: "EQUITY_RELATIVE", StageOrder: 2, Scope: "THEME", Label: equityLabel, SourceKind: "RELATIVE_STRENGTH", SourceNumerator: equityNumerator, SourceDenominator: equityDenominator, SourceLabel: equityLabel, RequiredScript: "cdf"},
			{ThemeCode: code, Key: "SECURITY_TREND", StageOrder: 3, Scope: "SECURITY", Label: "Company trend", SourceKind: "SECURITY_TREND", SourceSymbol: "SECURITY", SourceLabel: "Company trend", RequiredScript: "cdf"},
			{ThemeCode: code, Key: "SECURITY_OUTPERFORM", StageOrder: 4, Scope: "SECURITY", Label: "Outperform", SourceKind: "RELATIVE_STRENGTH", SourceNumerator: "SECURITY", SourceDenominator: equityNumerator, SourceLabel: "Company / core fund", RequiredScript: "cdf"},
		},
	}
}

func equityExpressionStages(stages []commodityThemeStageResponse) []commodityThemeStageResponse {
	equityStages := make([]commodityThemeStageResponse, 0, len(stages))
	for _, stage := range stages {
		if stage.Key != "COMMODITY" {
			equityStages = append(equityStages, stage)
		}
	}
	return equityStages
}

func loadCommodityThemeConfigs(ctx context.Context) ([]commodityThemeConfig, error) {
	return loadCommodityThemeConfigsFrom(ctx, db)
}

func loadCommodityThemeConfigsFrom(ctx context.Context, reader deploymentReader) ([]commodityThemeConfig, error) {
	rows, err := reader.QueryContext(ctx, `
		SELECT t.code, t.display_name, COALESCE(t.market_group, ''),
			t.strategic_floor_asset_class_code, t.tactical_asset_class_code,
			COALESCE(d.status, 'SIGNAL_ONLY'), COALESCE(d.instrument_label, ''),
			COALESCE(d.instrument_ticker, ''), COALESCE(d.instrument_kind, ''),
			COALESCE(d.existing_position_treatment, 'CLASS_DEFINED')
		FROM commodity_themes t
		LEFT JOIN commodity_theme_direct_expressions d ON d.theme_code = t.code
		WHERE t.active = 1
		ORDER BY t.code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	themes := []commodityThemeConfig{}
	for rows.Next() {
		var theme commodityThemeConfig
		if err := rows.Scan(
			&theme.Code, &theme.DisplayName, &theme.MarketGroup,
			&theme.StrategicFloorAssetCode, &theme.TacticalAssetCode,
			&theme.DirectExpression.Status, &theme.DirectExpression.InstrumentLabel,
			&theme.DirectExpression.InstrumentTicker, &theme.DirectExpression.InstrumentKind,
			&theme.DirectExpression.ExistingPositionTreatment,
		); err != nil {
			return nil, err
		}
		theme.DirectExpression.ThemeCode = theme.Code
		themes = append(themes, theme)
	}
	return themes, rows.Err()
}

func loadCommodityThemeStageConfigs(ctx context.Context, themeCode string) ([]commodityThemeStageConfig, error) {
	return loadCommodityThemeStageConfigsFrom(ctx, db, themeCode)
}

func loadCommodityThemeStageConfigsFrom(ctx context.Context, reader deploymentReader, themeCode string) ([]commodityThemeStageConfig, error) {
	rows, err := reader.QueryContext(ctx, `
		SELECT theme_code, stage_key, stage_order, scope, label, source_kind,
			COALESCE(source_symbol, ''), COALESCE(source_numerator, ''),
			COALESCE(source_denominator, ''), COALESCE(source_label, ''), COALESCE(required_script, '')
		FROM commodity_theme_stages
		WHERE theme_code = ? AND active = 1
		ORDER BY stage_order ASC
	`, themeCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stages := []commodityThemeStageConfig{}
	for rows.Next() {
		var stage commodityThemeStageConfig
		if err := rows.Scan(&stage.ThemeCode, &stage.Key, &stage.StageOrder, &stage.Scope, &stage.Label,
			&stage.SourceKind, &stage.SourceSymbol, &stage.SourceNumerator, &stage.SourceDenominator,
			&stage.SourceLabel, &stage.RequiredScript); err != nil {
			return nil, err
		}
		stages = append(stages, stage)
	}
	return stages, rows.Err()
}

func configuredThemeSource(stage commodityThemeStageConfig) commodityThemeSource {
	return commodityThemeSource{
		Kind:        stage.SourceKind,
		Symbol:      stage.SourceSymbol,
		Numerator:   stage.SourceNumerator,
		Denominator: stage.SourceDenominator,
		Label:       stage.SourceLabel,
	}
}

// commodityThemeEventMatchesConfiguredStage deliberately compares the event
// source with the current configuration. Source edits keep old events as audit
// history, but they must not become the baseline for a new TradingView pair.
func commodityThemeEventMatchesConfiguredStage(event commodityThemeEvent, stage commodityThemeStageConfig) bool {
	expected := configuredThemeSource(stage)
	if expected.Symbol == "SECURITY" {
		expected.Symbol = event.SecurityTicker
	}
	if expected.Numerator == "SECURITY" {
		expected.Numerator = event.SecurityTicker
	}
	if expected.Denominator == "SECURITY" {
		expected.Denominator = event.SecurityTicker
	}
	if normalizeCommodityThemeValue(expected.Kind) != normalizeCommodityThemeValue(event.Source.Kind) {
		return false
	}
	return commodityThemeConfiguredSymbolMatches(expected.Symbol, event.Source.Symbol) &&
		commodityThemeConfiguredSymbolMatches(expected.Numerator, event.Source.Numerator) &&
		commodityThemeConfiguredSymbolMatches(expected.Denominator, event.Source.Denominator)
}

func commodityThemeConfiguredSymbolMatches(expected, actual string) bool {
	expected = normalizeCommodityThemeSymbol(expected)
	actual = normalizeCommodityThemeSymbol(actual)
	if expected == "" {
		return actual == ""
	}
	return sameConfiguredSymbol(expected, actual)
}

func normalizeCommodityThemeValue(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func normalizeCommodityThemeSymbol(value string) string {
	value = normalizeCommodityThemeValue(value)
	// TradingView commonly emits ASX daily-feed symbols as ASX_DLY:XYZ. The
	// security ledger stores their stable identity as ASX:XYZ.
	if strings.HasPrefix(value, "ASX_DLY:") {
		return "ASX:" + strings.TrimPrefix(value, "ASX_DLY:")
	}
	return value
}

func sameConfiguredSymbol(expected, actual string) bool {
	expected = normalizeCommodityThemeSymbol(expected)
	actual = normalizeCommodityThemeSymbol(actual)
	if expected == "" || expected == "SECURITY" || expected == actual {
		return true
	}

	// TradingView commonly routes AMEX-listed ETF charts through BATS. The
	// market data venue differs, but the instrument is the same for an
	// explicitly configured commodity ratio.
	if strings.HasPrefix(expected, "AMEX:") && strings.HasPrefix(actual, "BATS:") {
		return strings.TrimPrefix(expected, "AMEX:") == strings.TrimPrefix(actual, "BATS:")
	}
	if strings.HasPrefix(expected, "BATS:") && strings.HasPrefix(actual, "AMEX:") {
		return strings.TrimPrefix(expected, "BATS:") == strings.TrimPrefix(actual, "AMEX:")
	}

	return false
}

func validateCommodityThemeSource(stage commodityThemeStageConfig, source commodityThemeSource) error {
	if normalizeCommodityThemeValue(source.Kind) != normalizeCommodityThemeValue(stage.SourceKind) {
		return fmt.Errorf("source.kind must be %s", stage.SourceKind)
	}
	if !sameConfiguredSymbol(stage.SourceSymbol, source.Symbol) {
		return fmt.Errorf("source.symbol must be %s", stage.SourceSymbol)
	}
	if !sameConfiguredSymbol(stage.SourceNumerator, source.Numerator) {
		return fmt.Errorf("source.numerator must be %s", stage.SourceNumerator)
	}
	if !sameConfiguredSymbol(stage.SourceDenominator, source.Denominator) {
		return fmt.Errorf("source.denominator must be %s", stage.SourceDenominator)
	}
	return nil
}

func validateCommodityThemeSecuritySource(
	stage commodityThemeStageConfig,
	source commodityThemeSource,
	security resolvedCommodityThemeSecurity,
) error {
	if stage.SourceSymbol == "SECURITY" && !sameConfiguredSymbol(security.Ticker, source.Symbol) {
		return fmt.Errorf("source.symbol must match security.ticker")
	}
	if stage.SourceNumerator == "SECURITY" && !sameConfiguredSymbol(security.Ticker, source.Numerator) {
		return fmt.Errorf("source.numerator must match security.ticker")
	}
	if stage.SourceDenominator == "SECURITY" && !sameConfiguredSymbol(security.Ticker, source.Denominator) {
		return fmt.Errorf("source.denominator must match security.ticker")
	}
	return nil
}

func resolvedCommodityThemeSource(stage commodityThemeStageConfig, security *resolvedCommodityThemeSecurity) commodityThemeSource {
	source := configuredThemeSource(stage)
	if security == nil {
		return source
	}
	if source.Symbol == "SECURITY" {
		source.Symbol = security.Ticker
	}
	if source.Numerator == "SECURITY" {
		source.Numerator = security.Ticker
	}
	if source.Denominator == "SECURITY" {
		source.Denominator = security.Ticker
	}
	return source
}

func commodityThemeConnectionMatchesSource(connection string, source commodityThemeSource) bool {
	connection = strings.ToUpper(strings.TrimSpace(connection))
	if connection == "" {
		return false
	}
	if source.Symbol != "" {
		return !strings.Contains(connection, "/") && sameConfiguredSymbol(source.Symbol, connection)
	}
	if source.Numerator == "" || source.Denominator == "" {
		return false
	}
	parts := strings.Split(connection, "/")
	return len(parts) == 2 &&
		sameConfiguredSymbol(source.Numerator, parts[0]) &&
		sameConfiguredSymbol(source.Denominator, parts[1])
}

func loadCommodityThemeCDFConnections(ctx context.Context) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT ticker
		FROM active_alerts
		WHERE LOWER(TRIM(COALESCE(script, ''))) = 'cdf'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	connections := make([]string, 0)
	for rows.Next() {
		var ticker string
		if err := rows.Scan(&ticker); err != nil {
			return nil, err
		}
		ticker = strings.ToUpper(strings.TrimSpace(ticker))
		if ticker != "" {
			connections = append(connections, ticker)
		}
	}
	return connections, rows.Err()
}

func hasCommodityThemeCDFConnection(connections []string, source commodityThemeSource) bool {
	for _, connection := range connections {
		if commodityThemeConnectionMatchesSource(connection, source) {
			return true
		}
	}
	return false
}

func commodityThemeConnectionTicker(source commodityThemeSource) (string, error) {
	if symbol := strings.ToUpper(strings.TrimSpace(source.Symbol)); symbol != "" {
		return symbol, nil
	}
	numerator := strings.ToUpper(strings.TrimSpace(source.Numerator))
	denominator := strings.ToUpper(strings.TrimSpace(source.Denominator))
	if numerator != "" && denominator != "" {
		return numerator + "/" + denominator, nil
	}
	return "", fmt.Errorf("commodity theme stage has no configured CDF source")
}

func loadCommodityThemeSecurityCDFStates(ctx context.Context) (map[string]commodityThemeSecurityTrendState, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT ticker, position_state, last_updated
		FROM security_positions
		WHERE UPPER(TRIM(COALESCE(position_state, ''))) IN ('BUY', 'SELL')
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	states := map[string]commodityThemeSecurityTrendState{}
	for rows.Next() {
		var ticker, signal string
		var updatedAt time.Time
		if err := rows.Scan(&ticker, &signal, &updatedAt); err != nil {
			return nil, err
		}
		ticker = securityActionTicker(ticker)
		signal = strings.ToUpper(strings.TrimSpace(signal))
		if ticker == "" || (signal != "BUY" && signal != "SELL") {
			continue
		}
		states[ticker] = commodityThemeSecurityTrendState{Signal: signal, UpdatedAt: updatedAt.UTC()}
	}
	return states, rows.Err()
}

func findCommodityThemeConfig(ctx context.Context, themeCode string) (commodityThemeConfig, error) {
	themes, err := loadCommodityThemeConfigs(ctx)
	if err != nil {
		return commodityThemeConfig{}, err
	}
	for _, theme := range themes {
		if theme.Code == normalizeCommodityThemeValue(themeCode) {
			return theme, nil
		}
	}
	return commodityThemeConfig{}, sql.ErrNoRows
}

func findCommodityThemeStageConfig(ctx context.Context, themeCode, stageKey string) (commodityThemeStageConfig, error) {
	stages, err := loadCommodityThemeStageConfigs(ctx, themeCode)
	if err != nil {
		return commodityThemeStageConfig{}, err
	}
	for _, stage := range stages {
		if stage.Key == normalizeCommodityThemeValue(stageKey) {
			return stage, nil
		}
	}
	return commodityThemeStageConfig{}, sql.ErrNoRows
}

func resolveCommodityThemeSecurity(ctx context.Context, ticker string) (resolvedCommodityThemeSecurity, error) {
	ticker = normalizeCommodityThemeSymbol(ticker)
	if ticker == "" {
		return resolvedCommodityThemeSecurity{}, fmt.Errorf("security.ticker is required")
	}
	var security resolvedCommodityThemeSecurity
	var exchangePrefix, symbol string
	err := db.QueryRowContext(ctx, `
		SELECT sa.security_id, COALESCE(si.exchange_prefix, ''), COALESCE(si.ticker, ''),
			COALESCE(sa.primary_asset_class, ''), COALESCE(sa.security_type, 'STOCK')
		FROM stock_analysis sa
		JOIN security_identities si ON si.id = sa.security_id
		WHERE UPPER(TRIM(COALESCE(sa.ticker, ''))) = ?
			OR UPPER(TRIM(COALESCE(si.exchange_prefix, '') || COALESCE(si.ticker, ''))) = ?
			OR UPPER(TRIM(COALESCE(si.ticker, ''))) = ?
		LIMIT 1
	`, ticker, ticker, canonicalSecurityTickerKey(ticker)).Scan(
		&security.ID,
		&exchangePrefix,
		&symbol,
		&security.PrimaryAssetClass,
		&security.SecurityType,
	)
	if err == sql.ErrNoRows {
		return resolvedCommodityThemeSecurity{}, fmt.Errorf("security.ticker %q does not resolve to a stable security identity", ticker)
	}
	if err != nil {
		return resolvedCommodityThemeSecurity{}, err
	}
	security.Ticker = fullTickerForStorage(exchangePrefix, symbol)
	return security, nil
}

func latestCommodityThemeStageEvent(ctx context.Context, themeCode, stageKey, scope string, securityID *int64) (*commodityThemeEvent, error) {
	events, err := loadCommodityThemeEvents(ctx, themeCode)
	if err != nil {
		return nil, err
	}
	var latest *commodityThemeEvent
	for _, event := range events {
		// CONNECT proves delivery only. It must never erase the last tradable
		// BUY/SELL state or suppress a later adverse transition.
		if event.Scope != scope || event.StageKey != stageKey || (event.Signal != "BUY" && event.Signal != "SELL") {
			continue
		}
		if scope == "SECURITY" && (securityID == nil || event.SecurityID == nil || *event.SecurityID != *securityID) {
			continue
		}
		if latest == nil || eventIsLater(event, *latest) {
			candidate := event
			latest = &candidate
		}
	}
	return latest, nil
}

// commodityThemeHeldPositions snapshots the live producer-equity sleeve. It
// deliberately includes ETFs: the Equity Regime trim applies to all held
// producer equity expressions, while direct commodity holdings live elsewhere.
func commodityThemeHeldPositions(ctx context.Context, assetClassCode string) ([]commodityThemeHeldPosition, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT COALESCE(NULLIF(TRIM(si.ticker), ''), NULLIF(TRIM(h.ticker), ''), ''),
			SUM(COALESCE(h.value_aud, 0))
		FROM holdings h
		JOIN stock_analysis sa ON sa.security_id = h.security_id
		LEFT JOIN security_identities si ON si.id = sa.security_id
		WHERE h.is_active = 1
		  AND COALESCE(h.value_aud, 0) > 0
		  AND UPPER(TRIM(COALESCE(sa.primary_asset_class, ''))) = ?
		GROUP BY COALESCE(NULLIF(TRIM(si.ticker), ''), NULLIF(TRIM(h.ticker), ''), '')
		ORDER BY SUM(COALESCE(h.value_aud, 0)) DESC
	`, normalizeCommodityThemeValue(assetClassCode))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	positions := make([]commodityThemeHeldPosition, 0)
	for rows.Next() {
		var position commodityThemeHeldPosition
		if err := rows.Scan(&position.Ticker, &position.Value); err != nil {
			return nil, err
		}
		position.Ticker = canonicalSecurityTickerKey(position.Ticker)
		if position.Ticker == "" {
			continue
		}
		positions = append(positions, position)
	}
	return positions, rows.Err()
}

// projectCommodityThemeOutperformAlert makes a security-relative transition
// visible in the alert history without turning permission to concentrate into
// an automatic deployment instruction. The internal note stores the immutable
// event key so replaying a webhook cannot create a duplicate notification.
func projectCommodityThemeOutperformAlert(eventKey string, ticker string, signal string, timeframe string) error {
	eventKey = strings.TrimSpace(eventKey)
	ticker = securityActionTicker(ticker)
	if eventKey == "" || ticker == "" {
		return fmt.Errorf("outperform alert requires an event key and ticker")
	}

	alertType := "OUTPERFORM_CONFIRMED"
	strength := "MEDIUM"
	if strings.EqualFold(strings.TrimSpace(signal), "SELL") {
		alertType = "OUTPERFORM_LOST"
		strength = "HIGH"
	}
	oppositeAlertType := "OUTPERFORM_LOST"
	if alertType == "OUTPERFORM_LOST" {
		oppositeAlertType = "OUTPERFORM_CONFIRMED"
	}
	if _, err := db.Exec(`
		UPDATE alerts
		SET is_active = 0,
			resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
			resolved_reason = COALESCE(resolved_reason, 'OUTPERFORM_STATE_CHANGED')
		WHERE ticker = ?
		  AND alert_type = ?
		  AND is_active = 1
		  AND resolved_note LIKE 'COMMODITY_THEME_EVENT:%'
	`, ticker, oppositeAlertType); err != nil {
		return err
	}
	// A simulator reset archives its prior fixture alerts but deliberately keeps
	// their audit rows. Re-open the same immutable event row before attempting
	// an insert, so deterministic fixture IDs remain repeatable without making
	// a real webhook replay non-idempotent.
	result, err := db.Exec(`
		UPDATE alerts
		SET alert_type = ?, strength = ?, exchange_prefix = 'ASX:', timeframe = ?,
			source = 'cdf', is_active = 1, resolved_at = NULL,
			resolved_reason = NULL
		WHERE resolved_note = ?
	`, alertType, strength, strings.TrimSpace(timeframe), "COMMODITY_THEME_EVENT:"+eventKey)
	if err != nil {
		return err
	}
	if rows, err := result.RowsAffected(); err != nil {
		return err
	} else if rows > 0 {
		return nil
	}
	_, err = db.Exec(`
		INSERT INTO alerts (
			ticker, alert_type, strength, exchange_prefix, timeframe, source, resolved_note, is_active
		)
		SELECT ?, ?, ?, 'ASX:', ?, 'cdf', ?, 1
		WHERE NOT EXISTS (
			SELECT 1 FROM alerts WHERE resolved_note = ?
		)
	`, ticker, alertType, strength, strings.TrimSpace(timeframe), "COMMODITY_THEME_EVENT:"+eventKey, "COMMODITY_THEME_EVENT:"+eventKey)
	return err
}

func projectCommodityThemeEquityRegimeAction(ctx context.Context, theme commodityThemeConfig, eventKey string) error {
	positions, err := commodityThemeHeldPositions(ctx, theme.TacticalAssetCode)
	if err != nil {
		return err
	}
	tickers := make([]string, 0, len(positions))
	value := 0.0
	for _, position := range positions {
		tickers = append(tickers, position.Ticker)
		value += position.Value
	}
	return projectCommodityThemeAssetClassAction(eventKey, theme.Code, theme.TacticalAssetCode, tickers, value)
}

func parseCommodityThemeEventTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, fmt.Errorf("bar_closed_at must be RFC3339: %w", err)
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func commodityThemeEventKey(payload commodityThemeWebhookPayload, securityID *int64) string {
	if strings.TrimSpace(payload.EventID) != "" {
		return payload.Theme + ":" + strings.TrimSpace(payload.EventID)
	}
	securityKey := ""
	if securityID != nil {
		securityKey = fmt.Sprintf("%d", *securityID)
	}
	hash := sha256.Sum256([]byte(strings.Join([]string{
		payload.Theme, payload.Stage, payload.Scope, payload.Signal, payload.Script,
		payload.SignalVersion, securityKey, payload.Timeframe, payload.BarClosedAt,
		payload.Source.Kind, payload.Source.Symbol, payload.Source.Numerator, payload.Source.Denominator,
	}, "|")))
	return "derived:" + hex.EncodeToString(hash[:])
}

func themeEventOccurredAt(event commodityThemeEvent) *time.Time {
	if event.BarClosedAt != nil {
		return event.BarClosedAt
	}
	value := event.ReceivedAt
	return &value
}

func eventIsLater(candidate, previous commodityThemeEvent) bool {
	candidateAt := themeEventOccurredAt(candidate)
	previousAt := themeEventOccurredAt(previous)
	if candidateAt.After(*previousAt) {
		return true
	}
	if candidateAt.Equal(*previousAt) {
		return candidate.ID > previous.ID
	}
	return false
}

func loadCommodityThemeEvents(ctx context.Context, themeCode string) ([]commodityThemeEvent, error) {
	return loadCommodityThemeEventsFrom(ctx, db, themeCode)
}

func loadCommodityThemeEventsFrom(ctx context.Context, reader deploymentReader, themeCode string) ([]commodityThemeEvent, error) {
	rows, err := reader.QueryContext(ctx, `
		SELECT id, theme_code, stage_key, scope, security_id, COALESCE(security_ticker, ''),
			signal, script, signal_version, source_json, COALESCE(timeframe, ''),
			bar_closed_at, received_at, close
		FROM commodity_theme_events
		WHERE theme_code = ?
		ORDER BY id ASC
	`, themeCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []commodityThemeEvent{}
	for rows.Next() {
		var event commodityThemeEvent
		var sourceJSON string
		var barClosedAt sql.NullTime
		var closeValue sql.NullFloat64
		var securityID sql.NullInt64
		if err := rows.Scan(&event.ID, &event.ThemeCode, &event.StageKey, &event.Scope, &securityID,
			&event.SecurityTicker, &event.Signal, &event.Script, &event.SignalVersion, &sourceJSON,
			&event.Timeframe, &barClosedAt, &event.ReceivedAt, &closeValue); err != nil {
			return nil, err
		}
		if securityID.Valid {
			value := securityID.Int64
			event.SecurityID = &value
		}
		if barClosedAt.Valid {
			value := barClosedAt.Time.UTC()
			event.BarClosedAt = &value
		}
		if closeValue.Valid {
			value := closeValue.Float64
			event.Close = &value
		}
		if err := json.Unmarshal([]byte(sourceJSON), &event.Source); err != nil {
			return nil, fmt.Errorf("read commodity theme event %d source: %w", event.ID, err)
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func loadCommodityThemeEligibleSecurities(ctx context.Context, tacticalAssetCode string) ([]commodityThemeSecurityResponse, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT sa.security_id, COALESCE(si.exchange_prefix, ''), COALESCE(si.ticker, ''),
			sa.name, COALESCE(sa.include_in_sizing, 1)
		FROM stock_analysis sa
		JOIN security_identities si ON si.id = sa.security_id
		WHERE UPPER(TRIM(COALESCE(sa.primary_asset_class, ''))) = ?
			AND UPPER(COALESCE(sa.security_type, 'STOCK')) != 'ETF'
		ORDER BY sa.name COLLATE NOCASE
	`, normalizeCommodityThemeValue(tacticalAssetCode))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	securities := []commodityThemeSecurityResponse{}
	for rows.Next() {
		var security commodityThemeSecurityResponse
		var exchangePrefix, symbol string
		var includeInSizing bool
		if err := rows.Scan(&security.SecurityID, &exchangePrefix, &symbol, &security.Name, &includeInSizing); err != nil {
			return nil, err
		}
		security.Ticker = fullTickerForStorage(exchangePrefix, symbol)
		security.IncludeInSizing = includeInSizing
		security.StageStates = map[string]string{}
		security.LatestEvents = map[string]*commodityThemeEventSummary{}
		securities = append(securities, security)
	}
	return securities, rows.Err()
}

// loadCommodityThemeProducerFunds returns the ETFs in the theme's equity class
// with their canonical CDF trend state, read the same way Positions reads it.
func loadCommodityThemeProducerFunds(
	ctx context.Context,
	tacticalAssetCode string,
	trendStates map[string]commodityThemeSecurityTrendState,
) ([]commodityThemeFundResponse, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT sa.security_id, COALESCE(si.exchange_prefix, ''), COALESCE(si.ticker, ''), sa.name
		FROM stock_analysis sa
		JOIN security_identities si ON si.id = sa.security_id
		WHERE UPPER(TRIM(COALESCE(sa.primary_asset_class, ''))) = ?
			AND UPPER(COALESCE(sa.security_type, 'STOCK')) = 'ETF'
		ORDER BY sa.name COLLATE NOCASE
	`, normalizeCommodityThemeValue(tacticalAssetCode))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	funds := []commodityThemeFundResponse{}
	for rows.Next() {
		var fund commodityThemeFundResponse
		var exchangePrefix, symbol string
		if err := rows.Scan(&fund.SecurityID, &exchangePrefix, &symbol, &fund.Name); err != nil {
			return nil, err
		}
		fund.Ticker = fullTickerForStorage(exchangePrefix, symbol)
		fund.TrendState = "DISCONNECTED"
		if state, ok := trendStates[securityActionTicker(fund.Ticker)]; ok {
			fund.TrendState = stageStatusFromEvent(&commodityThemeEvent{Signal: state.Signal})
			updatedAt := state.UpdatedAt
			fund.TrendUpdatedAt = &updatedAt
		}
		funds = append(funds, fund)
	}
	return funds, rows.Err()
}

func stageStatusFromEvent(event *commodityThemeEvent) string {
	if event == nil {
		return "DISCONNECTED"
	}
	switch event.Signal {
	case "BUY":
		return "CONFIRMED"
	case "SELL":
		return "BLOCKED"
	default:
		return "DISCONNECTED"
	}
}

func buildCommodityThemeResponse(ctx context.Context, theme commodityThemeConfig, includeSecurities bool) (commodityThemeResponse, error) {
	stages, err := loadCommodityThemeStageConfigs(ctx, theme.Code)
	if err != nil {
		return commodityThemeResponse{}, err
	}
	events, err := loadCommodityThemeEvents(ctx, theme.Code)
	if err != nil {
		return commodityThemeResponse{}, err
	}
	connections, err := loadCommodityThemeCDFConnections(ctx)
	if err != nil {
		return commodityThemeResponse{}, err
	}
	securityTrendStates, err := loadCommodityThemeSecurityCDFStates(ctx)
	if err != nil {
		return commodityThemeResponse{}, err
	}

	stagesByKey := make(map[string]commodityThemeStageConfig, len(stages))
	for _, stage := range stages {
		stagesByKey[stage.Key] = stage
	}
	latestThemeEvents := map[string]commodityThemeEvent{}
	latestSecurityEvents := map[string]map[int64]commodityThemeEvent{}
	for _, event := range events {
		if event.Signal != "BUY" && event.Signal != "SELL" {
			continue
		}
		stage, configured := stagesByKey[event.StageKey]
		if !configured || event.Scope != stage.Scope || !commodityThemeEventMatchesConfiguredStage(event, stage) {
			continue
		}
		if event.Scope == "THEME" {
			previous, exists := latestThemeEvents[event.StageKey]
			if !exists || eventIsLater(event, previous) {
				latestThemeEvents[event.StageKey] = event
			}
			continue
		}
		if event.SecurityID == nil {
			continue
		}
		bySecurity := latestSecurityEvents[event.StageKey]
		if bySecurity == nil {
			bySecurity = map[int64]commodityThemeEvent{}
			latestSecurityEvents[event.StageKey] = bySecurity
		}
		previous, exists := bySecurity[*event.SecurityID]
		if !exists || eventIsLater(event, previous) {
			bySecurity[*event.SecurityID] = event
		}
	}

	securities, err := loadCommodityThemeEligibleSecurities(ctx, theme.TacticalAssetCode)
	if err != nil {
		return commodityThemeResponse{}, err
	}
	eligibleSecurityTotal := 0
	for index := range securities {
		if securities[index].IncludeInSizing {
			eligibleSecurityTotal++
		}
	}

	stageResponses := make([]commodityThemeStageResponse, 0, len(stages))
	for _, stage := range stages {
		response := commodityThemeStageResponse{
			Key: stage.Key, Order: stage.StageOrder, Scope: stage.Scope, Label: stage.Label,
			Source: configuredThemeSource(stage),
		}
		if stage.Key == "COMMODITY" && response.Source.Symbol != "" {
			performance := loadCommodityPricePerformance(ctx, response.Source.Symbol)
			response.Return60DPct = performance.Return60DPct
			response.PerformanceAsOf = performance.AsOf
		}
		if stage.Scope == "THEME" {
			if !hasCommodityThemeCDFConnection(connections, response.Source) {
				response.Status = "DISCONNECTED"
				stageResponses = append(stageResponses, response)
				continue
			}
			if event, ok := latestThemeEvents[stage.Key]; ok {
				response.Signal = event.Signal
				response.Close = event.Close
				response.Timeframe = event.Timeframe
				response.Status = stageStatusFromEvent(&event)
				response.LastEventAt = themeEventOccurredAt(event)
				if event.Signal == "BUY" {
					response.LastConfirmedAt = themeEventOccurredAt(event)
				}
			} else {
				response.Status = "DISCONNECTED"
			}
		} else {
			confirmed := 0
			blocked := 0
			var latestConfirmed *time.Time
			var latestObserved *time.Time
			for index := range securities {
				security := &securities[index]
				resolvedSecurity := resolvedCommodityThemeSecurity{ID: security.SecurityID, Ticker: security.Ticker}
				securitySource := resolvedCommodityThemeSource(stage, &resolvedSecurity)
				if !hasCommodityThemeCDFConnection(connections, securitySource) {
					continue
				}

				var signal string
				var occurredAt *time.Time
				var summary *commodityThemeEventSummary
				if stage.Key == "SECURITY_TREND" {
					state, ok := securityTrendStates[securityActionTicker(security.Ticker)]
					if !ok {
						continue
					}
					signal = state.Signal
					observedAt := state.UpdatedAt
					occurredAt = &observedAt
					summary = &commodityThemeEventSummary{
						Signal: signal, Source: securitySource, Script: "cdf", OccurredAt: occurredAt,
					}
				} else {
					event, ok := latestSecurityEvents[stage.Key][security.SecurityID]
					if !ok {
						continue
					}
					signal = event.Signal
					occurredAt = themeEventOccurredAt(event)
					summary = &commodityThemeEventSummary{
						Signal: event.Signal, Close: event.Close, Source: event.Source, Script: event.Script,
						Timeframe: event.Timeframe, OccurredAt: occurredAt,
					}
				}

				if latestObserved == nil || occurredAt.After(*latestObserved) {
					latestObserved = occurredAt
				}
				status := stageStatusFromEvent(&commodityThemeEvent{Signal: signal})
				security.StageStates[stage.Key] = status
				security.LatestEvents[stage.Key] = summary
				if !security.IncludeInSizing {
					continue
				}
				switch status {
				case "CONFIRMED":
					confirmed++
					if latestConfirmed == nil || occurredAt.After(*latestConfirmed) {
						latestConfirmed = occurredAt
					}
				case "BLOCKED":
					blocked++
				}
			}
			response.EligibleSecurityCount = confirmed
			response.BlockedSecurityCount = blocked
			response.EligibleSecurityTotal = eligibleSecurityTotal
			response.LastConfirmedAt = latestConfirmed
			response.LastEventAt = latestObserved
			switch {
			case confirmed > 0:
				response.Status = "CONFIRMED"
				response.Signal = "BUY"
			case blocked > 0:
				response.Status = "BLOCKED"
				response.Signal = "SELL"
			default:
				response.Status = "DISCONNECTED"
			}
		}
		stageResponses = append(stageResponses, response)
	}
	equityStages := equityExpressionStages(stageResponses)
	consecutiveConfirmed := consecutiveConfirmedStages(equityStages)

	capitalByClass, totalValue, hasCurrentMix := commodityThemeClassCapitalValues(ctx)
	targetByClass, hasApprovedBudget := commodityThemeTargetValues(ctx, totalValue)
	strategicTarget := targetByClass[normalizeCommodityThemeValue(theme.StrategicFloorAssetCode)]
	tacticalMaximum := targetByClass[normalizeCommodityThemeValue(theme.TacticalAssetCode)]
	if !hasApprovedBudget {
		strategicTarget = 0
		tacticalMaximum = 0
	}
	directSleeve := commodityThemeClassCapitalFor(
		capitalByClass,
		theme.StrategicFloorAssetCode,
		strategicTarget,
		hasApprovedBudget && hasCurrentMix,
	)
	equitySleeve := commodityThemeClassCapitalFor(
		capitalByClass,
		theme.TacticalAssetCode,
		tacticalMaximum,
		hasApprovedBudget && hasCurrentMix,
	)
	permitted := tacticalMaximum * (float64(consecutiveConfirmed) / float64(maxInt(1, len(equityStages))))
	actualTactical := equitySleeve.InvestedValue
	available := permitted - actualTactical
	if available < 0 {
		available = 0
	}

	status := "DISCONNECTED"
	if consecutiveConfirmed == len(equityStages) && len(equityStages) > 0 {
		status = "CONFIRMED"
	} else if consecutiveConfirmed > 0 {
		status = "PARTIAL"
	} else {
		for _, stage := range equityStages {
			if stage.Status == "BLOCKED" {
				status = "BLOCKED"
				break
			}
			if stage.Status == "WAITING" {
				status = "WAITING"
			}
		}
	}

	var producerFunds []commodityThemeFundResponse
	if !includeSecurities {
		securities = nil
	} else {
		producerFunds, err = loadCommodityThemeProducerFunds(ctx, theme.TacticalAssetCode, securityTrendStates)
		if err != nil {
			return commodityThemeResponse{}, err
		}
		for index := range securities {
			for _, stage := range stages {
				if stage.Scope == "SECURITY" {
					if _, ok := securities[index].StageStates[stage.Key]; !ok {
						securities[index].StageStates[stage.Key] = "DISCONNECTED"
					}
				}
			}
		}
	}
	physicalStatus := commodityThemeStageStatus(stageResponses, "COMMODITY")
	equityStatus := commodityThemeStageStatus(stageResponses, "EQUITY_RELATIVE")

	return commodityThemeResponse{
		Code: theme.Code, DisplayName: theme.DisplayName, MarketGroup: theme.MarketGroup, Status: status,
		ConfirmationCount: consecutiveConfirmed, ConfirmationTotal: len(equityStages),
		StrategicFloor: commodityThemeAllocation{
			AssetClassCode: theme.StrategicFloorAssetCode, TargetValue: strategicTarget,
			ActualValue: directSleeve.InvestedValue,
		},
		Tactical: commodityThemeTacticalAllocation{
			AssetClassCode: theme.TacticalAssetCode, MaximumValue: tacticalMaximum,
			PermittedValue: permitted, ActualValue: actualTactical, AvailableValue: available,
			BudgetApproved: hasApprovedBudget && hasCurrentMix,
		},
		DirectExpression: commodityThemeDirectExpression{
			Status:                    theme.DirectExpression.Status,
			InstrumentLabel:           theme.DirectExpression.InstrumentLabel,
			InstrumentTicker:          theme.DirectExpression.InstrumentTicker,
			InstrumentKind:            theme.DirectExpression.InstrumentKind,
			ExistingPositionTreatment: theme.DirectExpression.ExistingPositionTreatment,
		},
		DirectSleeve: directSleeve,
		EquitySleeve: equitySleeve,
		Reviews: commodityThemeReviews(
			theme,
			directSleeve,
			equitySleeve,
			physicalStatus,
			equityStatus,
		),
		Stages: stageResponses, EligibleSecurities: securities, ProducerFunds: producerFunds,
	}, nil
}

func commodityThemeClassCapitalValues(ctx context.Context) (map[string]commodityThemeClassCapital, float64, bool) {
	overlayContext, err := buildOverlayPortfolioContext(ctx)
	if err != nil {
		return map[string]commodityThemeClassCapital{}, 0, false
	}
	values := map[string]commodityThemeClassCapital{}
	for _, row := range buildCurrentPortfolioMixRows(overlayContext) {
		assetClassCode := normalizeCommodityThemeValue(row.AssetClass)
		values[assetClassCode] = commodityThemeClassCapital{
			AssetClassCode:  assetClassCode,
			InvestedValue:   row.InvestedValue,
			SleeveCashValue: row.SleeveCashValue,
			// PortfolioMixRow.Value remains the invested market value for its
			// existing callers. Commodity sleeve capital is deliberately the
			// broader accounting value, so compute it without changing that
			// shared contract.
			CapitalValue: row.InvestedValue + row.SleeveCashValue,
		}
	}
	return values, overlayContext.StatementTotalValue, true
}

func commodityThemeClassCapitalFor(
	capitalByClass map[string]commodityThemeClassCapital,
	assetClassCode string,
	targetValue float64,
	budgetApproved bool,
) commodityThemeClassCapital {
	assetClassCode = normalizeCommodityThemeValue(assetClassCode)
	capital := capitalByClass[assetClassCode]
	capital.AssetClassCode = assetClassCode
	capital.TargetValue = targetValue
	capital.BudgetApproved = budgetApproved
	return capital
}

func commodityThemeStageStatus(stages []commodityThemeStageResponse, stageKey string) string {
	for _, stage := range stages {
		if stage.Key == stageKey {
			return stage.Status
		}
	}
	return "DISCONNECTED"
}

func commodityThemeReviews(
	theme commodityThemeConfig,
	directSleeve commodityThemeClassCapital,
	equitySleeve commodityThemeClassCapital,
	physicalStatus string,
	equityStatus string,
) []commodityThemeReview {
	reviews := []commodityThemeReview{}
	if directSleeve.TargetValue > 0.01 && theme.DirectExpression.Status != "APPROVED" {
		reviews = append(reviews, commodityThemeReview{
			Key:            "DIRECT_VEHICLE_REVIEW",
			Scope:          "DIRECT",
			Status:         "REVIEW",
			AssetClassCode: directSleeve.AssetClassCode,
			Label:          "Direct vehicle review",
			Detail:         "This sleeve has an approved portfolio budget but no approved broker execution vehicle. The market signal remains evidence only.",
		})
	}
	if equitySleeve.SleeveCashValue > 0.01 && equityStatus != "CONFIRMED" {
		detail := "Class cash remains locked to this producer-equity sleeve while its equity gate is not confirmed. It is not available to another asset class."
		if physicalStatus == "CONFIRMED" {
			detail = "The direct commodity signal is confirmed, but producer-equity class cash remains locked because the separate equity gate is not confirmed."
		}
		reviews = append(reviews, commodityThemeReview{
			Key:            "EQUITY_CLASS_CASH_HELD",
			Scope:          "EQUITY",
			Status:         "HOLD",
			AssetClassCode: equitySleeve.AssetClassCode,
			Label:          "Class cash held",
			Detail:         detail,
		})
	}
	return reviews
}

func commodityThemeTargetValues(ctx context.Context, totalValue float64) (map[string]float64, bool) {
	_, rows, err := loadLatestApprovedPortfolioMix()
	if err != nil || len(rows) == 0 || totalValue <= 0 {
		return map[string]float64{}, false
	}
	values := map[string]float64{}
	for _, row := range rows {
		values[normalizeCommodityThemeValue(row.AssetClass)] = totalValue * row.WeightPct / 100
	}
	return values, true
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func consecutiveConfirmedStages(stages []commodityThemeStageResponse) int {
	confirmed := 0
	for _, stage := range stages {
		if stage.Status != "CONFIRMED" {
			break
		}
		confirmed++
	}
	return confirmed
}

// GET /api/commodity-themes
func getCommodityThemes(w http.ResponseWriter, r *http.Request) {
	themes, err := loadCommodityThemeConfigs(r.Context())
	if err != nil {
		http.Error(w, "Failed to load commodity themes", http.StatusInternalServerError)
		return
	}
	response := commodityThemesResponse{GeneratedAt: time.Now().UTC(), Themes: make([]commodityThemeResponse, 0, len(themes))}
	includeSecurities := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("include_securities")), "true")
	for _, theme := range themes {
		summary, err := buildCommodityThemeResponse(r.Context(), theme, includeSecurities)
		if err != nil {
			http.Error(w, "Failed to build commodity theme state", http.StatusInternalServerError)
			return
		}
		response.Themes = append(response.Themes, summary)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

// GET /api/commodity-themes/{code}
func getCommodityTheme(w http.ResponseWriter, r *http.Request) {
	code := normalizeCommodityThemeValue(mux.Vars(r)["code"])
	theme, err := findCommodityThemeConfig(r.Context(), code)
	if err == sql.ErrNoRows {
		http.Error(w, "Commodity theme not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load commodity theme", http.StatusInternalServerError)
		return
	}
	response, err := buildCommodityThemeResponse(r.Context(), theme, true)
	if err != nil {
		http.Error(w, "Failed to build commodity theme state", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

type updateCommodityThemeDirectExpressionRequest struct {
	Status           string `json:"status"`
	InstrumentLabel  string `json:"instrument_label"`
	InstrumentTicker string `json:"instrument_ticker"`
	InstrumentKind   string `json:"instrument_kind"`
}

// updateCommodityThemeDirectExpression records an explicitly approved broker
// vehicle. It never infers a product from a TradingView source symbol.
func updateCommodityThemeDirectExpression(w http.ResponseWriter, r *http.Request) {
	code := normalizeCommodityThemeValue(mux.Vars(r)["code"])
	theme, err := findCommodityThemeConfig(r.Context(), code)
	if err == sql.ErrNoRows {
		http.Error(w, "Commodity theme not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load commodity theme", http.StatusInternalServerError)
		return
	}

	var payload updateCommodityThemeDirectExpressionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	payload.Status = normalizeCommodityThemeValue(payload.Status)
	payload.InstrumentLabel = strings.TrimSpace(payload.InstrumentLabel)
	payload.InstrumentTicker = strings.TrimSpace(payload.InstrumentTicker)
	payload.InstrumentKind = strings.TrimSpace(payload.InstrumentKind)
	if payload.Status != "SIGNAL_ONLY" && payload.Status != "APPROVED" {
		http.Error(w, "status must be SIGNAL_ONLY or APPROVED", http.StatusBadRequest)
		return
	}
	if payload.Status == "APPROVED" && payload.InstrumentLabel == "" && payload.InstrumentTicker == "" {
		http.Error(w, "an approved direct expression requires an instrument label or ticker", http.StatusBadRequest)
		return
	}
	if payload.Status == "SIGNAL_ONLY" {
		payload.InstrumentLabel = ""
		payload.InstrumentTicker = ""
		payload.InstrumentKind = ""
	}

	if _, err := db.ExecContext(r.Context(), `
		INSERT INTO commodity_theme_direct_expressions (
			theme_code, status, instrument_label, instrument_ticker, instrument_kind, existing_position_treatment, updated_at
		) VALUES (?, ?, ?, ?, ?, 'CLASS_DEFINED', CURRENT_TIMESTAMP)
		ON CONFLICT(theme_code) DO UPDATE SET
			status = excluded.status,
			instrument_label = excluded.instrument_label,
			instrument_ticker = excluded.instrument_ticker,
			instrument_kind = excluded.instrument_kind,
			updated_at = CURRENT_TIMESTAMP
	`, theme.Code, payload.Status, payload.InstrumentLabel, payload.InstrumentTicker, payload.InstrumentKind); err != nil {
		http.Error(w, "Failed to update direct expression", http.StatusInternalServerError)
		return
	}

	theme, err = findCommodityThemeConfig(r.Context(), code)
	if err != nil {
		http.Error(w, "Direct expression saved but theme could not be reloaded", http.StatusInternalServerError)
		return
	}
	response, err := buildCommodityThemeResponse(r.Context(), theme, true)
	if err != nil {
		http.Error(w, "Direct expression saved but theme state could not be loaded", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

type commodityThemeSourceConfiguration struct {
	Label       string `json:"label"`
	Symbol      string `json:"symbol"`
	Numerator   string `json:"numerator"`
	Denominator string `json:"denominator"`
}

type updateCommodityThemeConfigurationRequest struct {
	DisplayName    string                            `json:"display_name"`
	MarketGroup    string                            `json:"market_group"`
	Commodity      commodityThemeSourceConfiguration `json:"commodity"`
	EquityRelative commodityThemeSourceConfiguration `json:"equity_relative"`
}

type createCommodityThemeRequest struct {
	Code                    string                            `json:"code"`
	StrategicFloorAssetCode string                            `json:"strategic_floor_asset_class_code"`
	TacticalAssetCode       string                            `json:"tactical_asset_class_code"`
	DisplayName             string                            `json:"display_name"`
	MarketGroup             string                            `json:"market_group"`
	Commodity               commodityThemeSourceConfiguration `json:"commodity"`
	EquityRelative          commodityThemeSourceConfiguration `json:"equity_relative"`
}

func normalizeCommodityThemeConfigurationSymbol(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func normalizeCommodityThemeSourceConfiguration(payload *commodityThemeSourceConfiguration, kind string) error {
	payload.Label = strings.TrimSpace(payload.Label)
	payload.Symbol = normalizeCommodityThemeConfigurationSymbol(payload.Symbol)
	payload.Numerator = normalizeCommodityThemeConfigurationSymbol(payload.Numerator)
	payload.Denominator = normalizeCommodityThemeConfigurationSymbol(payload.Denominator)
	if payload.Label == "" {
		return fmt.Errorf("%s label is required", kind)
	}
	if kind == "commodity" && payload.Symbol == "" {
		return fmt.Errorf("commodity TradingView symbol is required")
	}
	if kind == "equity relative" && (payload.Numerator == "" || payload.Denominator == "") {
		return fmt.Errorf("equity numerator and denominator are required")
	}
	return nil
}

func normalizeCommodityThemeConfiguration(payload *updateCommodityThemeConfigurationRequest) error {
	payload.DisplayName = strings.TrimSpace(payload.DisplayName)
	payload.MarketGroup = strings.TrimSpace(payload.MarketGroup)
	if payload.DisplayName == "" {
		return fmt.Errorf("market name is required")
	}
	if err := normalizeCommodityThemeSourceConfiguration(&payload.Commodity, "commodity"); err != nil {
		return err
	}
	return normalizeCommodityThemeSourceConfiguration(&payload.EquityRelative, "equity relative")
}

func validCommodityThemeCode(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= '0' && character <= '9') && character != '_' {
			return false
		}
	}
	return true
}

func commodityThemeAssetClassExists(code string) bool {
	code = normalizeCommodityThemeValue(code)
	if code == "" {
		return false
	}
	for _, assetClass := range loadAssetClasses() {
		if normalizeCommodityThemeValue(assetClass.Code) == code {
			return true
		}
	}
	return false
}

func commodityThemeTacticalAssetClassAvailable(ctx context.Context, tacticalAssetClassCode, exceptThemeCode string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM commodity_themes
		WHERE active = 1
			AND UPPER(TRIM(tactical_asset_class_code)) = ?
			AND code != ?
	`, normalizeCommodityThemeValue(tacticalAssetClassCode), normalizeCommodityThemeValue(exceptThemeCode)).Scan(&count)
	if err != nil {
		return false, err
	}
	return count == 0, nil
}

func upsertCommodityThemeConfigurationStages(
	tx *sql.Tx,
	themeCode string,
	commodity commodityThemeSourceConfiguration,
	equityRelative commodityThemeSourceConfiguration,
) error {
	stages := []commodityThemeStageConfig{
		{ThemeCode: themeCode, Key: "COMMODITY", StageOrder: 1, Scope: "THEME", Label: commodity.Label, SourceKind: "UNDERLYING_PRICE", SourceSymbol: commodity.Symbol, SourceLabel: commodity.Label, RequiredScript: "cdf"},
		{ThemeCode: themeCode, Key: "EQUITY_RELATIVE", StageOrder: 2, Scope: "THEME", Label: equityRelative.Label, SourceKind: "RELATIVE_STRENGTH", SourceNumerator: equityRelative.Numerator, SourceDenominator: equityRelative.Denominator, SourceLabel: equityRelative.Label, RequiredScript: "cdf"},
		{ThemeCode: themeCode, Key: "SECURITY_TREND", StageOrder: 3, Scope: "SECURITY", Label: "Company trend", SourceKind: "SECURITY_TREND", SourceSymbol: "SECURITY", SourceLabel: "Company trend", RequiredScript: "cdf"},
		{ThemeCode: themeCode, Key: "SECURITY_OUTPERFORM", StageOrder: 4, Scope: "SECURITY", Label: "Outperform", SourceKind: "RELATIVE_STRENGTH", SourceNumerator: "SECURITY", SourceDenominator: equityRelative.Numerator, SourceLabel: "Company / core fund", RequiredScript: "cdf"},
	}
	for _, stage := range stages {
		if _, err := tx.Exec(`
			INSERT INTO commodity_theme_stages (
				theme_code, stage_key, stage_order, scope, label, source_kind,
				source_symbol, source_numerator, source_denominator, source_label, required_script, active
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
			ON CONFLICT(theme_code, stage_key) DO UPDATE SET
				stage_order = excluded.stage_order,
				scope = excluded.scope,
				label = excluded.label,
				source_kind = excluded.source_kind,
				source_symbol = excluded.source_symbol,
				source_numerator = excluded.source_numerator,
				source_denominator = excluded.source_denominator,
				source_label = excluded.source_label,
				required_script = excluded.required_script,
				active = 1
		`, stage.ThemeCode, stage.Key, stage.StageOrder, stage.Scope, stage.Label, stage.SourceKind,
			stage.SourceSymbol, stage.SourceNumerator, stage.SourceDenominator, stage.SourceLabel, stage.RequiredScript); err != nil {
			return err
		}
	}
	return nil
}

func writeCommodityThemeConfigurationResponse(w http.ResponseWriter, r *http.Request, themeCode string, status int) {
	theme, err := findCommodityThemeConfig(r.Context(), themeCode)
	if err != nil {
		http.Error(w, "Market configuration saved but could not be reloaded", http.StatusInternalServerError)
		return
	}
	response, err := buildCommodityThemeResponse(r.Context(), theme, true)
	if err != nil {
		http.Error(w, "Market configuration saved but market state could not be loaded", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}

// PATCH /api/commodity-themes/{code}/configuration
//
// TradingView data symbols are operational configuration. Changing them does
// not rewrite old event evidence: the read model only accepts events that
// match the current configured source, so the replacement pair must be
// connected and given a fresh directional baseline in Alerts.
func updateCommodityThemeConfiguration(w http.ResponseWriter, r *http.Request) {
	code := normalizeCommodityThemeValue(mux.Vars(r)["code"])
	if _, err := findCommodityThemeConfig(r.Context(), code); err == sql.ErrNoRows {
		http.Error(w, "Commodity theme not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Failed to load commodity theme", http.StatusInternalServerError)
		return
	}

	var payload updateCommodityThemeConfigurationRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if err := normalizeCommodityThemeConfiguration(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "Failed to update market configuration", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `
		UPDATE commodity_themes
		SET display_name = ?, market_group = ?, updated_at = CURRENT_TIMESTAMP
		WHERE code = ? AND active = 1
	`, payload.DisplayName, payload.MarketGroup, code); err != nil {
		http.Error(w, "Failed to update market configuration", http.StatusInternalServerError)
		return
	}
	if err = upsertCommodityThemeConfigurationStages(tx, code, payload.Commodity, payload.EquityRelative); err != nil {
		http.Error(w, "Failed to update market sources", http.StatusInternalServerError)
		return
	}
	if err = tx.Commit(); err != nil {
		http.Error(w, "Failed to save market configuration", http.StatusInternalServerError)
		return
	}
	writeCommodityThemeConfigurationResponse(w, r, code, http.StatusOK)
}

// POST /api/commodity-themes
//
// A market is a complete direct/equity pair attached to one producer asset
// class. There can be one active market per tactical class, because that class
// supplies the shared core fund for its security-level Outperform connections.
func createCommodityTheme(w http.ResponseWriter, r *http.Request) {
	var payload createCommodityThemeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	payload.Code = normalizeCommodityThemeValue(payload.Code)
	payload.StrategicFloorAssetCode = normalizeCommodityThemeValue(payload.StrategicFloorAssetCode)
	payload.TacticalAssetCode = normalizeCommodityThemeValue(payload.TacticalAssetCode)
	configuration := updateCommodityThemeConfigurationRequest{
		DisplayName: payload.DisplayName, MarketGroup: payload.MarketGroup,
		Commodity: payload.Commodity, EquityRelative: payload.EquityRelative,
	}
	if !validCommodityThemeCode(payload.Code) {
		http.Error(w, "code must use uppercase letters, numbers, and underscores", http.StatusBadRequest)
		return
	}
	if err := normalizeCommodityThemeConfiguration(&configuration); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if !commodityThemeAssetClassExists(payload.StrategicFloorAssetCode) || !commodityThemeAssetClassExists(payload.TacticalAssetCode) {
		http.Error(w, "strategic and tactical asset classes must be active asset classes", http.StatusUnprocessableEntity)
		return
	}
	var existingActive int
	err := db.QueryRowContext(r.Context(), `SELECT active FROM commodity_themes WHERE code = ?`, payload.Code).Scan(&existingActive)
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, "Failed to validate market code", http.StatusInternalServerError)
		return
	}
	if existingActive == 1 {
		http.Error(w, "a market already uses this code", http.StatusConflict)
		return
	}
	available, err := commodityThemeTacticalAssetClassAvailable(r.Context(), payload.TacticalAssetCode, payload.Code)
	if err != nil {
		http.Error(w, "Failed to validate tactical asset class", http.StatusInternalServerError)
		return
	}
	if !available {
		http.Error(w, "an active market already uses this tactical asset class", http.StatusConflict)
		return
	}

	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "Failed to create market", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `
		INSERT INTO commodity_themes (
			code, display_name, market_group, strategic_floor_asset_class_code, tactical_asset_class_code, active, updated_at
		) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
		ON CONFLICT(code) DO UPDATE SET
			display_name = excluded.display_name,
			market_group = excluded.market_group,
			strategic_floor_asset_class_code = excluded.strategic_floor_asset_class_code,
			tactical_asset_class_code = excluded.tactical_asset_class_code,
			active = 1,
			updated_at = CURRENT_TIMESTAMP
	`, payload.Code, configuration.DisplayName, configuration.MarketGroup, payload.StrategicFloorAssetCode, payload.TacticalAssetCode); err != nil {
		http.Error(w, "Failed to create market", http.StatusInternalServerError)
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		INSERT INTO commodity_theme_direct_expressions (theme_code, status, existing_position_treatment)
		VALUES (?, 'SIGNAL_ONLY', 'CLASS_DEFINED')
		ON CONFLICT(theme_code) DO NOTHING
	`, payload.Code); err != nil {
		http.Error(w, "Failed to initialise direct market expression", http.StatusInternalServerError)
		return
	}
	if err = upsertCommodityThemeConfigurationStages(tx, payload.Code, configuration.Commodity, configuration.EquityRelative); err != nil {
		http.Error(w, "Failed to create market sources", http.StatusInternalServerError)
		return
	}
	if err = tx.Commit(); err != nil {
		http.Error(w, "Failed to save market", http.StatusInternalServerError)
		return
	}
	writeCommodityThemeConfigurationResponse(w, r, payload.Code, http.StatusCreated)
}

// DELETE /api/commodity-themes/{code}
//
// Preserve events and configuration for audit/recovery, while removing the
// market from the live Markets and Alerts connection ledgers.
func deactivateCommodityTheme(w http.ResponseWriter, r *http.Request) {
	code := normalizeCommodityThemeValue(mux.Vars(r)["code"])
	result, err := db.ExecContext(r.Context(), `
		UPDATE commodity_themes
		SET active = 0, updated_at = CURRENT_TIMESTAMP
		WHERE code = ? AND active = 1
	`, code)
	if err != nil {
		http.Error(w, "Failed to remove market", http.StatusInternalServerError)
		return
	}
	updated, _ := result.RowsAffected()
	if updated == 0 {
		http.Error(w, "Commodity theme not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "removed", "code": code})
}

// POST /api/commodity-themes/initialise-feed
//
// A connection-ledger setup is not an incoming market transition. It records
// the user-selected current CDF direction as the feed baseline, then awaits a
// later BUY/SELL webhook before any transition logic can run.
func initialiseCommodityThemeFeed(w http.ResponseWriter, r *http.Request) {
	var payload commodityThemeFeedInitialisation
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	payload.Theme = normalizeCommodityThemeValue(payload.Theme)
	payload.Stage = normalizeCommodityThemeValue(payload.Stage)
	payload.Signal = normalizeCommodityThemeValue(payload.Signal)
	if payload.Theme == "" || payload.Stage == "" || (payload.Signal != "BUY" && payload.Signal != "SELL") {
		http.Error(w, "theme, stage, and signal BUY or SELL are required", http.StatusBadRequest)
		return
	}

	theme, err := findCommodityThemeConfig(r.Context(), payload.Theme)
	if err == sql.ErrNoRows {
		http.Error(w, "Unknown commodity theme", http.StatusUnprocessableEntity)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load commodity theme", http.StatusInternalServerError)
		return
	}
	stage, err := findCommodityThemeStageConfig(r.Context(), theme.Code, payload.Stage)
	if err == sql.ErrNoRows {
		http.Error(w, "Unknown commodity theme stage", http.StatusUnprocessableEntity)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load commodity theme stage", http.StatusInternalServerError)
		return
	}
	if stage.Key == "SECURITY_TREND" {
		http.Error(w, "company trend is initialised through the stock CDF connection", http.StatusUnprocessableEntity)
		return
	}
	if stage.Key != "COMMODITY" && stage.Key != "EQUITY_RELATIVE" && stage.Key != "SECURITY_OUTPERFORM" {
		http.Error(w, "stage cannot be initialised from the connection ledger", http.StatusUnprocessableEntity)
		return
	}

	var security *resolvedCommodityThemeSecurity
	if stage.Scope == "SECURITY" {
		if payload.Security == nil {
			http.Error(w, "security is required for SECURITY scope", http.StatusBadRequest)
			return
		}
		resolved, resolveErr := resolveCommodityThemeSecurity(r.Context(), payload.Security.Ticker)
		if resolveErr != nil {
			http.Error(w, resolveErr.Error(), http.StatusUnprocessableEntity)
			return
		}
		if normalizeCommodityThemeValue(resolved.PrimaryAssetClass) != normalizeCommodityThemeValue(theme.TacticalAssetCode) ||
			normalizeCommodityThemeValue(resolved.SecurityType) == "ETF" {
			http.Error(w, "security must be a non-ETF member of the theme tactical asset class", http.StatusUnprocessableEntity)
			return
		}
		security = &resolved
	} else if payload.Security != nil {
		http.Error(w, "security is only valid for SECURITY scope", http.StatusUnprocessableEntity)
		return
	}

	source := resolvedCommodityThemeSource(stage, security)
	connectionTicker, err := commodityThemeConnectionTicker(source)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}

	now := time.Now().UTC()
	eventKey := strings.Join([]string{
		"manual-initialisation", theme.Code, stage.Key, connectionTicker, now.Format(time.RFC3339Nano),
	}, ":")
	var securityID *int64
	securityTicker := ""
	if security != nil {
		securityID = &security.ID
		securityTicker = security.Ticker
	}
	sourceJSON, err := json.Marshal(source)
	if err != nil {
		http.Error(w, "Failed to encode source", http.StatusInternalServerError)
		return
	}
	rawPayload, err := json.Marshal(map[string]interface{}{
		"origin": "MANUAL_INITIALISATION",
		"theme":  theme.Code,
		"stage":  stage.Key,
		"signal": payload.Signal,
	})
	if err != nil {
		http.Error(w, "Failed to encode initialisation", http.StatusInternalServerError)
		return
	}

	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "Failed to initialise feed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `
		INSERT INTO active_alerts (ticker, script)
		VALUES (?, 'cdf')
		ON CONFLICT(ticker, script) DO UPDATE SET created_at = CURRENT_TIMESTAMP
	`, connectionTicker); err != nil {
		http.Error(w, "Failed to register feed connection", http.StatusInternalServerError)
		return
	}
	result, err := tx.ExecContext(r.Context(), `
		INSERT INTO commodity_theme_events (
			event_key, theme_code, stage_key, scope, security_id, security_ticker,
			signal, script, signal_version, source_json, timeframe, bar_closed_at, raw_payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'cdf', 'manual.initialisation.v1', ?, '1D', ?, ?)
	`, eventKey, theme.Code, stage.Key, stage.Scope, securityID, securityTicker,
		payload.Signal, string(sourceJSON), now, string(rawPayload))
	if err != nil {
		http.Error(w, "Failed to record feed baseline", http.StatusInternalServerError)
		return
	}
	if err = tx.Commit(); err != nil {
		http.Error(w, "Failed to initialise feed", http.StatusInternalServerError)
		return
	}
	eventID, _ := result.LastInsertId()

	summary, err := buildCommodityThemeResponse(r.Context(), theme, false)
	if err != nil {
		http.Error(w, "Feed initialised but theme state could not be loaded", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "initialised", "event_id": eventID, "connection_ticker": connectionTicker,
		"theme": summary.Code, "stage": stage.Key, "theme_status": summary.Status,
	})
}

func themeConfirmationWebhook(w http.ResponseWriter, r *http.Request) {
	acknowledgeAndProcessWebhook(w, r, "theme_confirmation")
}

// POST /api/webhook/theme-confirmation
func themeConfirmationWebhookSync(w http.ResponseWriter, r *http.Request) {
	var payload commodityThemeWebhookPayload
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	payload.Theme = normalizeCommodityThemeValue(payload.Theme)
	payload.Stage = normalizeCommodityThemeValue(payload.Stage)
	payload.Scope = normalizeCommodityThemeValue(payload.Scope)
	payload.Signal = normalizeCommodityThemeValue(payload.Signal)
	payload.Script = strings.ToLower(strings.TrimSpace(payload.Script))
	payload.SignalVersion = strings.TrimSpace(payload.SignalVersion)
	payload.Timeframe = strings.TrimSpace(payload.Timeframe)

	if payload.Theme == "" || payload.Stage == "" || payload.Scope == "" || payload.Signal == "" || payload.Script == "" || payload.SignalVersion == "" {
		http.Error(w, "theme, stage, scope, signal, script, and signal_version are required", http.StatusBadRequest)
		return
	}
	// TradingView can resend CONNECT when its servers restart. It is setup
	// noise, not directional evidence, so it never changes a commodity state.
	if payload.Signal == "CONNECT" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": "ignored",
			"detail": "connection signals do not change commodity trend state",
		})
		return
	}
	if payload.Signal != "BUY" && payload.Signal != "SELL" {
		http.Error(w, "signal must be BUY or SELL", http.StatusBadRequest)
		return
	}
	barClosedAt, err := parseCommodityThemeEventTime(payload.BarClosedAt)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if (payload.Signal == "BUY" || payload.Signal == "SELL") && barClosedAt == nil {
		http.Error(w, "bar_closed_at is required for BUY and SELL", http.StatusBadRequest)
		return
	}

	theme, err := findCommodityThemeConfig(r.Context(), payload.Theme)
	if err == sql.ErrNoRows {
		http.Error(w, "Unknown commodity theme", http.StatusUnprocessableEntity)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load commodity theme", http.StatusInternalServerError)
		return
	}
	stage, err := findCommodityThemeStageConfig(r.Context(), theme.Code, payload.Stage)
	if err == sql.ErrNoRows {
		http.Error(w, "Unknown commodity theme stage", http.StatusUnprocessableEntity)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load commodity theme stage", http.StatusInternalServerError)
		return
	}
	if payload.Scope != stage.Scope {
		http.Error(w, "scope does not match configured stage", http.StatusUnprocessableEntity)
		return
	}
	if payload.Script != strings.ToLower(stage.RequiredScript) {
		http.Error(w, fmt.Sprintf("script must be %s for %s", stage.RequiredScript, stage.Key), http.StatusUnprocessableEntity)
		return
	}
	if err := validateCommodityThemeSource(stage, payload.Source); err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	var securityID *int64
	securityTicker := ""
	if stage.Scope == "SECURITY" {
		if payload.Security == nil {
			http.Error(w, "security is required for SECURITY scope", http.StatusBadRequest)
			return
		}
		resolvedSecurity, err := resolveCommodityThemeSecurity(r.Context(), payload.Security.Ticker)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		if normalizeCommodityThemeValue(resolvedSecurity.PrimaryAssetClass) != normalizeCommodityThemeValue(theme.TacticalAssetCode) ||
			normalizeCommodityThemeValue(resolvedSecurity.SecurityType) == "ETF" {
			http.Error(w, "security must be a non-ETF member of the theme tactical asset class", http.StatusUnprocessableEntity)
			return
		}
		if err := validateCommodityThemeSecuritySource(stage, payload.Source, resolvedSecurity); err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		securityID = &resolvedSecurity.ID
		securityTicker = resolvedSecurity.Ticker
	} else if payload.Security != nil {
		http.Error(w, "security is only valid for SECURITY scope", http.StatusBadRequest)
		return
	}
	connections, err := loadCommodityThemeCDFConnections(r.Context())
	if err != nil {
		http.Error(w, "Failed to load commodity theme feed connections", http.StatusInternalServerError)
		return
	}
	if !hasCommodityThemeCDFConnection(connections, payload.Source) {
		http.Error(w, "commodity theme feed is not registered in the Alerts connection ledger", http.StatusConflict)
		return
	}
	previousThemeStageEvent, err := latestCommodityThemeStageEvent(r.Context(), theme.Code, stage.Key, stage.Scope, securityID)
	if err != nil {
		http.Error(w, "Failed to load prior commodity theme state", http.StatusInternalServerError)
		return
	}

	sourceJSON, err := json.Marshal(payload.Source)
	if err != nil {
		http.Error(w, "Failed to encode source", http.StatusInternalServerError)
		return
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, "Failed to encode payload", http.StatusInternalServerError)
		return
	}
	eventKey := commodityThemeEventKey(payload, securityID)
	result, err := db.ExecContext(r.Context(), `
		INSERT INTO commodity_theme_events (
			event_key, theme_code, stage_key, scope, security_id, security_ticker,
			signal, script, signal_version, source_json, timeframe, bar_closed_at, close, raw_payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(event_key) DO NOTHING
	`, eventKey, theme.Code, stage.Key, stage.Scope, securityID, securityTicker,
		payload.Signal, payload.Script, payload.SignalVersion, string(sourceJSON), payload.Timeframe,
		barClosedAt, payload.Close, string(rawPayload))
	if err != nil {
		http.Error(w, "Failed to record commodity theme confirmation", http.StatusInternalServerError)
		return
	}
	eventID, _ := result.LastInsertId()
	inserted, _ := result.RowsAffected()
	incomingEvent := commodityThemeEvent{
		ID: eventID, ThemeCode: theme.Code, StageKey: stage.Key, Scope: stage.Scope,
		SecurityID: securityID,
		Signal:     payload.Signal, Script: payload.Script, SignalVersion: payload.SignalVersion,
		Source: payload.Source, Timeframe: payload.Timeframe, BarClosedAt: barClosedAt,
	}
	// An equity-basket breakdown creates one class action only when it is a
	// newer BUY -> SELL transition. Replays and stale bars remain evidence, not
	// duplicate work. Raw commodity SELL remains intentionally outside this path.
	if stage.Key == "EQUITY_RELATIVE" && payload.Signal == "SELL" &&
		previousThemeStageEvent != nil && previousThemeStageEvent.Signal == "BUY" &&
		eventIsLater(incomingEvent, *previousThemeStageEvent) {
		if err := projectCommodityThemeEquityRegimeAction(r.Context(), theme, eventKey); err != nil {
			http.Error(w, "Confirmation recorded but failed to project the equity-regime action", http.StatusInternalServerError)
			return
		}
	}
	if stage.Key == "SECURITY_OUTPERFORM" && inserted > 0 &&
		(previousThemeStageEvent == nil || previousThemeStageEvent.Signal != payload.Signal) {
		if err := projectCommodityThemeOutperformAlert(eventKey, securityTicker, payload.Signal, payload.Timeframe); err != nil {
			http.Error(w, "Confirmation recorded but failed to project the Outperform alert", http.StatusInternalServerError)
			return
		}
	}

	summary, err := buildCommodityThemeResponse(r.Context(), theme, false)
	if err != nil {
		http.Error(w, "Confirmation recorded but failed to build theme state", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success", "event_id": eventID, "duplicate": eventID == 0,
		"theme": summary.Code, "stage": stage.Key, "theme_status": summary.Status,
		"confirmation_count":       summary.ConfirmationCount,
		"tactical_permitted_pct":   float64(summary.ConfirmationCount) * 100 / float64(maxInt(1, summary.ConfirmationTotal)),
		"tactical_permitted_value": summary.Tactical.PermittedValue,
	})
}
