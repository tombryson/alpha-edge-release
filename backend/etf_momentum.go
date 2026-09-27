package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

const (
	etfMomentumLegacyUniverseCode = "LEGACY_15"
	etfMomentumPineParityV1       = "PINE_PARITY_V1"
	etfMomentumYahooSource        = "YAHOO"
	etfMomentumMinimumHistoryBars = 241
	// Allocation is the model's economically actionable output. Differences at
	// or below this percentage-point band are accepted without user work.
	etfMomentumAllocationDriftTolerancePct = 2.0
	etfMomentumExactMatchTolerancePct      = 0.051
)

// The legacy Pine script is deliberately modelled as a separate, durable
// universe. It is shadow evidence only: none of these records update the live
// etf_allocations or etf_rebalance_targets tables.
type etfMomentumUniverseSeed struct {
	DisplayTicker     string
	DisplayName       string
	ExchangePrefix    string
	TradingViewSymbol string
	ProviderSymbol    string
	Currency          string
}

var etfMomentumLegacyUniverse = []etfMomentumUniverseSeed{
	{DisplayTicker: "FANG", DisplayName: "FANG", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:FANG", ProviderSymbol: "FANG.AX", Currency: "AUD"},
	{DisplayTicker: "GPEQ", DisplayName: "GPEQ", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:GPEQ", ProviderSymbol: "GPEQ.AX", Currency: "AUD"},
	{DisplayTicker: "ESPO", DisplayName: "ESPO", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:ESPO", ProviderSymbol: "ESPO.AX", Currency: "AUD"},
	{DisplayTicker: "ASIA", DisplayName: "ASIA", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:ASIA", ProviderSymbol: "ASIA.AX", Currency: "AUD"},
	{DisplayTicker: "SGDJ", DisplayName: "SGDJ", ExchangePrefix: "BATS:", TradingViewSymbol: "BATS:SGDJ", ProviderSymbol: "SGDJ", Currency: "USD"},
	{DisplayTicker: "SLVR", DisplayName: "SLVR", ExchangePrefix: "BATS:", TradingViewSymbol: "BATS:SLVR", ProviderSymbol: "SLVR", Currency: "USD"},
	{DisplayTicker: "ARMR", DisplayName: "ARMR", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:ARMR", ProviderSymbol: "ARMR.AX", Currency: "AUD"},
	{DisplayTicker: "SEMI", DisplayName: "SEMI", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:SEMI", ProviderSymbol: "SEMI.AX", Currency: "AUD"},
	{DisplayTicker: "LSX", DisplayName: "LSX", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:LSX", ProviderSymbol: "LSX.AX", Currency: "AUD"},
	{DisplayTicker: "NUCL", DisplayName: "NUCL", ExchangePrefix: "LSE:", TradingViewSymbol: "LSE_DLY:NUCL", ProviderSymbol: "NUCL.L", Currency: "GBP"},
	{DisplayTicker: "VPN", DisplayName: "VPN", ExchangePrefix: "LSE:", TradingViewSymbol: "LSE_DLY:VPN", ProviderSymbol: "VPN.L", Currency: "GBP"},
	{DisplayTicker: "LITP", DisplayName: "LITP", ExchangePrefix: "BATS:", TradingViewSymbol: "BATS:LITP", ProviderSymbol: "LITP", Currency: "USD"},
	{DisplayTicker: "LSF", DisplayName: "LSF", ExchangePrefix: "ASX:", TradingViewSymbol: "ASX_DLY:LSF", ProviderSymbol: "LSF.AX", Currency: "AUD"},
	{DisplayTicker: "UFO", DisplayName: "UFO", ExchangePrefix: "BATS:", TradingViewSymbol: "BATS:UFO", ProviderSymbol: "UFO", Currency: "USD"},
	{DisplayTicker: "COPJ", DisplayName: "COPJ", ExchangePrefix: "BATS:", TradingViewSymbol: "BATS:COPJ", ProviderSymbol: "COPJ", Currency: "USD"},
}

type etfMomentumUniverseMember struct {
	ID                int64
	SecurityID        int64
	UniverseCode      string
	DisplayTicker     string
	DisplayName       string
	ExchangePrefix    string
	TradingViewSymbol string
	ProviderSymbol    string
	Currency          string
	RankEligible      bool
	TacticalEligible  bool
	Active            bool
	DisplayOrder      int
}

type ETFMomentumPriceRefreshResult struct {
	UpdatedMembers int      `json:"updated_members"`
	PointsUpserted int      `json:"points_upserted"`
	Errors         []string `json:"errors"`
}

type ETFMomentumRunRequest struct {
	AsOfDate string `json:"as_of_date"`
}

type ETFMomentumRunResponse struct {
	ID                int64                       `json:"id"`
	UniverseCode      string                      `json:"universe_code"`
	AlgorithmVersion  string                      `json:"algorithm_version"`
	AsOfDate          string                      `json:"as_of_date"`
	PriceBasis        string                      `json:"price_basis"`
	Provider          string                      `json:"provider"`
	Status            string                      `json:"status"`
	ExpectedMembers   int                         `json:"expected_members"`
	ReadyMembers      int                         `json:"ready_members"`
	DataFreshThrough  *string                     `json:"data_fresh_through,omitempty"`
	ComparisonStatus  string                      `json:"comparison_status"`
	CreatedAt         string                      `json:"created_at"`
	PublishedAt       *string                     `json:"published_at,omitempty"`
	PublicationReason string                      `json:"publication_reason,omitempty"`
	Rows              []ETFMomentumRunRowResponse `json:"rows"`
}

type ETFMomentumRunRowResponse struct {
	Ticker            string   `json:"ticker"`
	DisplayName       string   `json:"display_name"`
	TradingViewSymbol string   `json:"tradingview_symbol"`
	ProviderSymbol    string   `json:"provider_symbol"`
	PriceDate         *string  `json:"price_date,omitempty"`
	ClosePrice        *float64 `json:"close_price,omitempty"`
	DataPoints        int      `json:"data_points"`
	Return80Pct       *float64 `json:"return_80_pct,omitempty"`
	Momentum240Pct    *float64 `json:"momentum_240_pct,omitempty"`
	Volatility240     *float64 `json:"volatility_240,omitempty"`
	SharpeProxy       *float64 `json:"sharpe_proxy,omitempty"`
	Score             *float64 `json:"score,omitempty"`
	Rank              *int     `json:"rank,omitempty"`
	Decay             *float64 `json:"decay,omitempty"`
	RawWeightPct      *float64 `json:"raw_weight_pct,omitempty"`
	CappedWeightPct   *float64 `json:"capped_weight_pct,omitempty"`
	FinalWeightPct    *float64 `json:"final_weight_pct,omitempty"`
	Status            string   `json:"status"`
	Diagnostic        string   `json:"diagnostic,omitempty"`
}

type ETFMomentumTradingViewReferenceResponse struct {
	ID                          int64                                        `json:"id"`
	Source                      string                                       `json:"source"`
	RebalanceDate               string                                       `json:"rebalance_date"`
	AllocationCount             int                                          `json:"allocation_count"`
	ComparisonRunID             *int64                                       `json:"comparison_run_id,omitempty"`
	ComparisonStatus            string                                       `json:"comparison_status"`
	ComparisonSummary           string                                       `json:"comparison_summary,omitempty"`
	AllocationDriftTolerancePct float64                                      `json:"allocation_drift_tolerance_pct"`
	ActionRequiredCount         int                                          `json:"action_required_count"`
	ReceivedAt                  string                                       `json:"received_at"`
	Rows                        []ETFMomentumTradingViewReferenceRowResponse `json:"rows"`
}

type ETFMomentumTradingViewReferenceRowResponse struct {
	Ticker                string   `json:"ticker"`
	Return80Pct           float64  `json:"return_80_pct"`
	Momentum240Pct        float64  `json:"momentum_240_pct"`
	DecayPct              float64  `json:"decay_pct"`
	SharpeProxy           float64  `json:"sharpe_proxy"`
	Score                 float64  `json:"score"`
	Rank                  int      `json:"rank"`
	AllocationPct         float64  `json:"allocation_pct"`
	InternalRank          *int     `json:"internal_rank,omitempty"`
	InternalReturn80Pct   *float64 `json:"internal_return_80_pct,omitempty"`
	InternalAllocationPct *float64 `json:"internal_allocation_pct,omitempty"`
	RankDelta             *int     `json:"rank_delta,omitempty"`
	Return80DeltaPct      *float64 `json:"return_80_delta_pct,omitempty"`
	AllocationDeltaPct    *float64 `json:"allocation_delta_pct,omitempty"`
	ComparisonStatus      string   `json:"comparison_status"`
	ActionRequired        bool     `json:"action_required"`
}

type ETFMomentumTradingViewSnapshotRequest struct {
	AsOfDate string                                       `json:"as_of_date"`
	Rows     []ETFMomentumTradingViewReferenceRowResponse `json:"rows"`
}

type ETFMomentumWorkspaceResponse struct {
	UniverseCode               string                                   `json:"universe_code"`
	LatestRun                  *ETFMomentumRunResponse                  `json:"latest_run,omitempty"`
	PublishedRun               *ETFMomentumRunResponse                  `json:"published_run,omitempty"`
	Automation                 ETFMomentumAutomationStatus              `json:"automation"`
	LatestTradingViewReference *ETFMomentumTradingViewReferenceResponse `json:"latest_tradingview_reference,omitempty"`
}

type etfMomentumPricePoint struct {
	Date  time.Time
	Close float64
}

type etfMomentumCalculationInput struct {
	Member etfMomentumUniverseMember
	Points []etfMomentumPricePoint
}

type etfMomentumCalculationResult struct {
	Member          etfMomentumUniverseMember
	PriceDate       *time.Time
	ClosePrice      *float64
	DataPoints      int
	Return80Pct     *float64
	Momentum240Pct  *float64
	Volatility240   *float64
	SharpeProxy     *float64
	Score           *float64
	Rank            *int
	Decay           *float64
	RawWeightPct    *float64
	CappedWeightPct *float64
	FinalWeightPct  *float64
	Status          string
	Diagnostic      string
}

func ensureETFMomentumSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS etf_momentum_universe_members (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			universe_code TEXT NOT NULL,
			security_id INTEGER NOT NULL,
			display_ticker TEXT NOT NULL,
			display_name TEXT NOT NULL,
			exchange_prefix TEXT NOT NULL DEFAULT '',
			tradingview_symbol TEXT NOT NULL,
			provider_symbol TEXT NOT NULL,
			currency TEXT DEFAULT '',
			rank_eligible BOOLEAN NOT NULL DEFAULT 1,
			tactical_eligible BOOLEAN NOT NULL DEFAULT 1,
			active BOOLEAN NOT NULL DEFAULT 1,
			display_order INTEGER NOT NULL DEFAULT 999,
			effective_from DATE NOT NULL DEFAULT '2000-01-01',
			inactive_at DATE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(universe_code, security_id),
			UNIQUE(universe_code, display_ticker),
			FOREIGN KEY(security_id) REFERENCES security_identities(id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_etf_momentum_universe_active
			ON etf_momentum_universe_members(universe_code, active, display_order)`,
		`CREATE TABLE IF NOT EXISTS etf_momentum_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			universe_code TEXT NOT NULL,
			algorithm_version TEXT NOT NULL,
			as_of_date DATE NOT NULL,
			price_basis TEXT NOT NULL,
			provider TEXT NOT NULL,
			parameters_json TEXT NOT NULL,
			expected_members INTEGER NOT NULL,
			ready_members INTEGER NOT NULL,
			status TEXT NOT NULL,
			data_fresh_through DATE,
			comparison_status TEXT NOT NULL DEFAULT 'WAITING_FOR_TRADINGVIEW',
			published_at DATETIME,
			publication_reason TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_etf_momentum_runs_lookup
			ON etf_momentum_runs(universe_code, algorithm_version, as_of_date, id DESC)`,
		`CREATE TABLE IF NOT EXISTS etf_momentum_run_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL,
			universe_member_id INTEGER NOT NULL,
			security_id INTEGER NOT NULL,
			display_ticker TEXT NOT NULL,
			display_name TEXT NOT NULL,
			tradingview_symbol TEXT NOT NULL,
			provider_symbol TEXT NOT NULL,
			price_date DATE,
			close_price REAL,
			data_points INTEGER NOT NULL DEFAULT 0,
			return_80_pct REAL,
			momentum_240_pct REAL,
			volatility_240 REAL,
			sharpe_proxy REAL,
			score REAL,
			rank_value INTEGER,
			decay REAL,
			raw_weight_pct REAL,
			capped_weight_pct REAL,
			final_weight_pct REAL,
			status TEXT NOT NULL,
			diagnostic TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(run_id, universe_member_id),
			FOREIGN KEY(run_id) REFERENCES etf_momentum_runs(id) ON DELETE CASCADE,
			FOREIGN KEY(universe_member_id) REFERENCES etf_momentum_universe_members(id),
			FOREIGN KEY(security_id) REFERENCES security_identities(id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_etf_momentum_run_rows_run_rank
			ON etf_momentum_run_rows(run_id, rank_value, display_ticker)`,
		`CREATE TABLE IF NOT EXISTS etf_momentum_tradingview_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			universe_code TEXT NOT NULL,
			as_of_date DATE NOT NULL,
			source TEXT NOT NULL DEFAULT 'TRADINGVIEW_TABLE',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_etf_momentum_tradingview_snapshots_latest
			ON etf_momentum_tradingview_snapshots(universe_code, as_of_date DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS etf_momentum_tradingview_snapshot_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			snapshot_id INTEGER NOT NULL,
			ticker TEXT NOT NULL,
			return_80_pct REAL NOT NULL,
			momentum_240_pct REAL NOT NULL,
			decay_pct REAL NOT NULL,
			sharpe_proxy REAL NOT NULL,
			score REAL NOT NULL,
			rank_value INTEGER NOT NULL,
			allocation_pct REAL NOT NULL,
			FOREIGN KEY(snapshot_id) REFERENCES etf_momentum_tradingview_snapshots(id) ON DELETE CASCADE,
			UNIQUE(snapshot_id, ticker)
		)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	for _, statement := range []string{
		`ALTER TABLE etf_momentum_runs ADD COLUMN published_at DATETIME`,
		`ALTER TABLE etf_momentum_runs ADD COLUMN publication_reason TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := db.Exec(statement); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
			return err
		}
	}
	if _, err := db.Exec(`
		UPDATE etf_momentum_runs
		SET published_at = created_at,
			publication_reason = 'MIGRATION_BASELINE'
		WHERE id = (
			SELECT id FROM etf_momentum_runs
			WHERE status = 'COMPLETE'
			ORDER BY as_of_date DESC, id DESC
			LIMIT 1
		)
		AND NOT EXISTS (
			SELECT 1 FROM etf_momentum_runs WHERE published_at IS NOT NULL
		)
	`); err != nil {
		return err
	}
	if err := ensureETFMomentumAutomationSettings(); err != nil {
		return err
	}
	if err := seedETFMomentumLegacyUniverse(); err != nil {
		return err
	}
	return nil
}

func existingETFMomentumSecurityIDTx(tx *sql.Tx, ticker string) (int64, bool, error) {
	rows, err := tx.Query(fmt.Sprintf(`
		SELECT DISTINCT security_id
		FROM stock_analysis
		WHERE security_id IS NOT NULL
		  AND %s = ?
		LIMIT 2
	`, stockAnalysisTickerKeySQL("ticker")), canonicalSecurityTickerKey(ticker))
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var securityID int64
		if err := rows.Scan(&securityID); err != nil {
			return 0, false, err
		}
		ids = append(ids, securityID)
	}
	if err := rows.Err(); err != nil {
		return 0, false, err
	}
	if len(ids) == 1 {
		return ids[0], true, nil
	}
	return 0, false, nil
}

func ensureETFMomentumSecurityIdentityTx(tx *sql.Tx, seed etfMomentumUniverseSeed) (int64, error) {
	if securityID, found, err := existingETFMomentumSecurityIDTx(tx, seed.DisplayTicker); err != nil {
		return 0, err
	} else if found {
		return securityID, nil
	}
	return ensureSecurityIdentityTx(tx, securityIdentityCandidate{
		Ticker:         seed.DisplayTicker,
		ExchangePrefix: seed.ExchangePrefix,
		Name:           seed.DisplayName,
	}, "etf_momentum_universe", false)
}

func seedETFMomentumLegacyUniverse() error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for index, seed := range etfMomentumLegacyUniverse {
		securityID, err := ensureETFMomentumSecurityIdentityTx(tx, seed)
		if err != nil {
			return fmt.Errorf("resolve %s identity: %w", seed.DisplayTicker, err)
		}
		if _, err := tx.Exec(`
			INSERT INTO etf_momentum_universe_members (
				universe_code, security_id, display_ticker, display_name, exchange_prefix,
				tradingview_symbol, provider_symbol, currency, rank_eligible,
				tactical_eligible, active, display_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?)
			ON CONFLICT(universe_code, display_ticker) DO UPDATE SET
				security_id = excluded.security_id,
				display_name = CASE
					WHEN TRIM(COALESCE(etf_momentum_universe_members.display_name, '')) = ''
					THEN excluded.display_name ELSE etf_momentum_universe_members.display_name END,
				exchange_prefix = excluded.exchange_prefix,
				tradingview_symbol = excluded.tradingview_symbol,
				provider_symbol = excluded.provider_symbol,
				currency = excluded.currency,
				display_order = excluded.display_order,
				updated_at = CURRENT_TIMESTAMP
		`, etfMomentumLegacyUniverseCode, securityID, seed.DisplayTicker, seed.DisplayName,
			seed.ExchangePrefix, seed.TradingViewSymbol, seed.ProviderSymbol, seed.Currency, index+1); err != nil {
			return fmt.Errorf("seed %s: %w", seed.DisplayTicker, err)
		}
	}
	return tx.Commit()
}

func loadETFMomentumUniverseMembers(ctx context.Context) ([]etfMomentumUniverseMember, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, security_id, universe_code, display_ticker, display_name,
		       exchange_prefix, tradingview_symbol, provider_symbol, currency,
		       rank_eligible, tactical_eligible, active, display_order
		FROM etf_momentum_universe_members
		WHERE universe_code = ?
		  AND active = 1
		ORDER BY display_order ASC, display_ticker ASC
	`, etfMomentumLegacyUniverseCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []etfMomentumUniverseMember{}
	for rows.Next() {
		var member etfMomentumUniverseMember
		if err := rows.Scan(
			&member.ID, &member.SecurityID, &member.UniverseCode, &member.DisplayTicker,
			&member.DisplayName, &member.ExchangePrefix, &member.TradingViewSymbol,
			&member.ProviderSymbol, &member.Currency, &member.RankEligible,
			&member.TacticalEligible, &member.Active, &member.DisplayOrder,
		); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func refreshETFMomentumPriceHistory(ctx context.Context) (ETFMomentumPriceRefreshResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	members, err := loadETFMomentumUniverseMembers(ctx)
	if err != nil {
		return ETFMomentumPriceRefreshResult{}, err
	}

	result := ETFMomentumPriceRefreshResult{Errors: []string{}}
	for _, member := range members {
		providerSymbol := strings.TrimSpace(member.ProviderSymbol)
		if providerSymbol == "" {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: no provider symbol configured", member.DisplayTicker))
			continue
		}
		points, yahooSymbol, fetchErr := fetchYahooAdjustedDailyPrices(ctx, providerSymbol, "", "2y")
		if fetchErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", member.DisplayTicker, fetchErr))
			continue
		}

		tx, beginErr := db.BeginTx(ctx, nil)
		if beginErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", member.DisplayTicker, beginErr))
			continue
		}
		upserted := 0
		for _, point := range points {
			currency := point.Currency
			if strings.TrimSpace(currency) == "" {
				currency = member.Currency
			}
			if _, execErr := tx.ExecContext(ctx, `
				INSERT INTO security_price_daily (
					ticker, exchange_prefix, yahoo_symbol, observed_date, close_price,
					adjusted_close_price, currency, source, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(ticker, exchange_prefix, observed_date, source) DO UPDATE SET
					yahoo_symbol = excluded.yahoo_symbol,
					close_price = excluded.close_price,
					adjusted_close_price = excluded.adjusted_close_price,
					currency = excluded.currency,
					updated_at = CURRENT_TIMESTAMP
			`, member.DisplayTicker, member.ExchangePrefix, yahooSymbol,
				point.Date.Format("2006-01-02"), point.Close, point.AdjustedClose,
				currency, etfMomentumYahooSource); execErr != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s %s: %v", member.DisplayTicker, point.Date.Format("2006-01-02"), execErr))
				continue
			}
			upserted++
		}
		if commitErr := tx.Commit(); commitErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", member.DisplayTicker, commitErr))
			continue
		}
		if upserted > 0 {
			result.UpdatedMembers++
			result.PointsUpserted += upserted
		}
		// Keep the unauthenticated upstream chart endpoint below burst limits.
		time.Sleep(125 * time.Millisecond)
	}
	return result, nil
}

func refreshETFMomentumPriceHistoryHandler(w http.ResponseWriter, r *http.Request) {
	result, err := refreshETFMomentumPriceHistory(r.Context())
	if err != nil {
		http.Error(w, "Failed to refresh ETF momentum price history", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func parseETFMomentumAsOf(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		now := time.Now().UTC()
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC), nil
	}
	value, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("as_of_date must be YYYY-MM-DD")
	}
	return value.UTC(), nil
}

func loadETFMomentumPriceSeries(ctx context.Context, member etfMomentumUniverseMember, asOf time.Time) ([]etfMomentumPricePoint, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT observed_date, close_price
		FROM security_price_daily
		WHERE ticker = ?
		  AND exchange_prefix = ?
		  AND source = ?
		  AND close_price > 0
		  AND observed_date <= ?
		ORDER BY observed_date ASC
	`, member.DisplayTicker, member.ExchangePrefix, etfMomentumYahooSource, asOf.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := []etfMomentumPricePoint{}
	for rows.Next() {
		var rawDate string
		var closePrice float64
		if err := rows.Scan(&rawDate, &closePrice); err != nil {
			return nil, err
		}
		if len(rawDate) >= len("2006-01-02") {
			rawDate = rawDate[:len("2006-01-02")]
		}
		date, err := time.Parse("2006-01-02", rawDate)
		if err != nil {
			return nil, fmt.Errorf("%s: invalid cached price date %q", member.DisplayTicker, rawDate)
		}
		points = append(points, etfMomentumPricePoint{Date: date.UTC(), Close: closePrice})
	}
	return points, rows.Err()
}

func etfMomentumFloat(value float64) *float64 {
	return &value
}

func etfMomentumInt(value int) *int {
	return &value
}

func etfMomentumTime(value time.Time) *time.Time {
	return &value
}

func populationStandardDeviation(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	mean := 0.0
	for _, value := range values {
		mean += value
	}
	mean /= float64(len(values))
	variance := 0.0
	for _, value := range values {
		delta := value - mean
		variance += delta * delta
	}
	return math.Sqrt(variance / float64(len(values)))
}

func etfMomentumFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

// calculatePineParityRows preserves the supplied Pine calculation, including
// its price-level volatility and one-pass cap redistribution. It intentionally
// does not improve the economic model: a future research engine gets a new
// algorithm identifier rather than changing PINE_PARITY_V1 in place.
func calculatePineParityRows(inputs []etfMomentumCalculationInput) []etfMomentumCalculationResult {
	results := make([]etfMomentumCalculationResult, len(inputs))
	ready := make([]int, 0, len(inputs))

	for index, input := range inputs {
		result := etfMomentumCalculationResult{
			Member:     input.Member,
			DataPoints: len(input.Points),
			Status:     "INCOMPLETE",
		}
		if len(input.Points) < etfMomentumMinimumHistoryBars {
			result.Diagnostic = fmt.Sprintf("requires %d valid daily closes; %d cached", etfMomentumMinimumHistoryBars, len(input.Points))
			results[index] = result
			continue
		}
		latest := input.Points[len(input.Points)-1]
		if latest.Close <= 0 {
			result.Diagnostic = "latest cached close is not positive"
			results[index] = result
			continue
		}
		shortAnchor := input.Points[len(input.Points)-1-80].Close
		longAnchor := input.Points[len(input.Points)-1-240].Close
		if shortAnchor <= 0 || longAnchor <= 0 {
			result.Diagnostic = "lookback close is not positive"
			results[index] = result
			continue
		}
		volatilityValues := make([]float64, 240)
		for valueIndex, point := range input.Points[len(input.Points)-240:] {
			volatilityValues[valueIndex] = point.Close
		}
		return80 := ((latest.Close - shortAnchor) / shortAnchor) * 100
		momentum240 := ((latest.Close - longAnchor) / longAnchor) * 100
		volatility240 := populationStandardDeviation(volatilityValues)
		volatilityFloored := math.Max(volatility240, 1.0)
		sharpeProxy := return80 / math.Sqrt(volatilityFloored)
		score := return80 * (1 + (momentum240/100)*0.5 + sharpeProxy*0.05)
		if !etfMomentumFinite(return80) || !etfMomentumFinite(momentum240) || !etfMomentumFinite(volatility240) || !etfMomentumFinite(score) {
			result.Diagnostic = "calculation produced a non-finite value"
			results[index] = result
			continue
		}

		result.PriceDate = etfMomentumTime(latest.Date)
		result.ClosePrice = etfMomentumFloat(latest.Close)
		result.Return80Pct = etfMomentumFloat(return80)
		result.Momentum240Pct = etfMomentumFloat(momentum240)
		result.Volatility240 = etfMomentumFloat(volatility240)
		result.SharpeProxy = etfMomentumFloat(sharpeProxy)
		result.Score = etfMomentumFloat(score)
		result.Status = "READY"
		results[index] = result
		ready = append(ready, index)
	}

	// A partial universe never emits a tactical target. Metrics remain visible
	// for diagnosis, but the run cannot be mistaken for a valid allocation.
	if len(ready) != len(results) {
		for _, index := range ready {
			results[index].Status = "HELD_FOR_UNIVERSE_COMPLETENESS"
			results[index].Diagnostic = "metrics available, but the full 15-ETF universe is incomplete"
		}
		return results
	}

	for index := range results {
		rank := 1
		for _, peer := range results {
			if *peer.Score > *results[index].Score {
				rank++
			}
		}
		decay := 0.0
		if rank <= 8 {
			decay = math.Max(0, 1-float64(rank-1)/8)
		}
		results[index].Rank = etfMomentumInt(rank)
		results[index].Decay = etfMomentumFloat(decay)
	}

	weightedScores := make([]float64, len(results))
	totalWeightedScore := 0.0
	for index := range results {
		weightedScores[index] = *results[index].Score * *results[index].Decay
		totalWeightedScore += weightedScores[index]
	}
	rawWeights := make([]float64, len(results))
	for index := range results {
		if totalWeightedScore != 0 {
			rawWeights[index] = weightedScores[index] / totalWeightedScore * 100
		}
		results[index].RawWeightPct = etfMomentumFloat(rawWeights[index])
	}

	const maxAllocation = 25.0
	totalExcess := 0.0
	uncappedTotal := 0.0
	for _, weight := range rawWeights {
		if weight > maxAllocation {
			totalExcess += weight - maxAllocation
		}
		if weight < maxAllocation {
			uncappedTotal += weight
		}
	}
	cappedWeights := make([]float64, len(results))
	for index, weight := range rawWeights {
		redistribution := 0.0
		if weight < maxAllocation && uncappedTotal > 0 {
			redistribution = weight / uncappedTotal * totalExcess
		}
		cappedWeights[index] = math.Min(math.Min(weight, maxAllocation)+redistribution, maxAllocation)
		results[index].CappedWeightPct = etfMomentumFloat(cappedWeights[index])
	}

	const minimumAllocation = 5.0
	const minimumHoldings = 10
	forcedWeights := make([]float64, len(results))
	holdingCount := 0
	for index, weight := range cappedWeights {
		if weight >= minimumAllocation {
			forcedWeights[index] = weight
			holdingCount++
		}
	}
	if holdingCount < minimumHoldings {
		for index := range results {
			if *results[index].Rank <= minimumHoldings && forcedWeights[index] == 0 {
				forcedWeights[index] = 100.0 / minimumHoldings
			}
		}
	}
	totalForced := 0.0
	for _, weight := range forcedWeights {
		totalForced += weight
	}
	for index := range results {
		finalWeight := 0.0
		if totalForced != 0 {
			finalWeight = forcedWeights[index] / totalForced * 100
		}
		results[index].FinalWeightPct = etfMomentumFloat(finalWeight)
	}
	return results
}

func etfMomentumFreshThrough(results []etfMomentumCalculationResult) *string {
	var earliest *time.Time
	for _, result := range results {
		if result.PriceDate == nil {
			continue
		}
		if earliest == nil || result.PriceDate.Before(*earliest) {
			value := *result.PriceDate
			earliest = &value
		}
	}
	if earliest == nil {
		return nil
	}
	value := earliest.Format("2006-01-02")
	return &value
}

func nullableETFMomentumFloat(value *float64) interface{} {
	if value == nil {
		return nil
	}
	return *value
}

func nullableETFMomentumInt(value *int) interface{} {
	if value == nil {
		return nil
	}
	return *value
}

func nullableETFMomentumDate(value *time.Time) interface{} {
	if value == nil {
		return nil
	}
	return value.Format("2006-01-02")
}

func persistETFMomentumRun(ctx context.Context, asOf time.Time, results []etfMomentumCalculationResult) (int64, error) {
	readyMembers := 0
	complete := true
	for _, result := range results {
		if result.Return80Pct != nil {
			readyMembers++
		}
		if result.Status != "READY" {
			complete = false
		}
	}
	status := "INCOMPLETE"
	if complete {
		status = "COMPLETE"
	}
	automationConfig := loadETFMomentumAutomationConfig()
	parameters, _ := json.Marshal(map[string]interface{}{
		"short_return_bars":      80,
		"long_momentum_bars":     240,
		"volatility_bars":        240,
		"volatility_floor":       1.0,
		"rank_decay_top":         8,
		"max_allocation_pct":     25.0,
		"minimum_allocation_pct": 5.0,
		"minimum_holdings":       10,
		"calculation_schedule":   "DAILY_UTC",
		"calculation_utc_hour":   automationConfig.DailyUTCHour,
		"publication_cadence":    automationConfig.PublishCadence,
	})

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		INSERT INTO etf_momentum_runs (
			universe_code, algorithm_version, as_of_date, price_basis, provider,
			parameters_json, expected_members, ready_members, status, data_fresh_through
		) VALUES (?, ?, ?, 'RAW_CLOSE', ?, ?, ?, ?, ?, ?)
	`, etfMomentumLegacyUniverseCode, etfMomentumPineParityV1, asOf.Format("2006-01-02"),
		etfMomentumYahooSource, string(parameters), len(results), readyMembers, status,
		etfMomentumFreshThrough(results))
	if err != nil {
		return 0, err
	}
	runID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	for _, row := range results {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO etf_momentum_run_rows (
				run_id, universe_member_id, security_id, display_ticker, display_name,
				tradingview_symbol, provider_symbol, price_date, close_price, data_points,
				return_80_pct, momentum_240_pct, volatility_240, sharpe_proxy, score,
				rank_value, decay, raw_weight_pct, capped_weight_pct, final_weight_pct,
				status, diagnostic
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, runID, row.Member.ID, row.Member.SecurityID, row.Member.DisplayTicker,
			row.Member.DisplayName, row.Member.TradingViewSymbol, row.Member.ProviderSymbol,
			nullableETFMomentumDate(row.PriceDate), nullableETFMomentumFloat(row.ClosePrice),
			row.DataPoints, nullableETFMomentumFloat(row.Return80Pct),
			nullableETFMomentumFloat(row.Momentum240Pct), nullableETFMomentumFloat(row.Volatility240),
			nullableETFMomentumFloat(row.SharpeProxy), nullableETFMomentumFloat(row.Score),
			nullableETFMomentumInt(row.Rank), nullableETFMomentumFloat(row.Decay),
			nullableETFMomentumFloat(row.RawWeightPct), nullableETFMomentumFloat(row.CappedWeightPct),
			nullableETFMomentumFloat(row.FinalWeightPct), row.Status, row.Diagnostic); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return runID, nil
}

func runETFMomentumParity(ctx context.Context, asOf time.Time) (int64, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	members, err := loadETFMomentumUniverseMembers(ctx)
	if err != nil {
		return 0, err
	}
	if len(members) != len(etfMomentumLegacyUniverse) {
		return 0, fmt.Errorf("legacy ETF universe has %d active members; expected %d", len(members), len(etfMomentumLegacyUniverse))
	}
	inputs := make([]etfMomentumCalculationInput, 0, len(members))
	for _, member := range members {
		points, err := loadETFMomentumPriceSeries(ctx, member, asOf)
		if err != nil {
			return 0, err
		}
		inputs = append(inputs, etfMomentumCalculationInput{Member: member, Points: points})
	}
	runID, err := persistETFMomentumRun(ctx, asOf, calculatePineParityRows(inputs))
	if err != nil {
		return 0, err
	}
	return runID, nil
}

func runETFMomentumParityHandler(w http.ResponseWriter, r *http.Request) {
	request := ETFMomentumRunRequest{}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
	}
	asOf, err := parseETFMomentumAsOf(request.AsOfDate)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	runID, err := runETFMomentumParity(r.Context(), asOf)
	if err != nil {
		http.Error(w, "Failed to run ETF momentum parity: "+err.Error(), http.StatusInternalServerError)
		return
	}
	run, err := loadETFMomentumRun(r.Context(), runID)
	if err != nil {
		http.Error(w, "Failed to read ETF momentum parity run", http.StatusInternalServerError)
		return
	}
	if reference, referenceErr := latestETFMomentumTradingViewReference(r.Context()); referenceErr == nil && reference != nil && reference.ComparisonRunID != nil && *reference.ComparisonRunID == run.ID {
		run.ComparisonStatus = reference.ComparisonStatus
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(run)
}

func scanNullableString(value sql.NullString) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	result := value.String
	return &result
}

func scanNullableFloat(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	result := value.Float64
	return &result
}

func scanNullableInt(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Int64)
	return &result
}

func loadETFMomentumRun(ctx context.Context, runID int64) (*ETFMomentumRunResponse, error) {
	var run ETFMomentumRunResponse
	var freshThrough, publishedAt sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT id, universe_code, algorithm_version, as_of_date, price_basis, provider,
		       status, expected_members, ready_members, data_fresh_through,
		       comparison_status, CAST(created_at AS TEXT), CAST(published_at AS TEXT),
		       COALESCE(publication_reason, '')
		FROM etf_momentum_runs
		WHERE id = ?
	`, runID).Scan(
		&run.ID, &run.UniverseCode, &run.AlgorithmVersion, &run.AsOfDate, &run.PriceBasis,
		&run.Provider, &run.Status, &run.ExpectedMembers, &run.ReadyMembers,
		&freshThrough, &run.ComparisonStatus, &run.CreatedAt, &publishedAt,
		&run.PublicationReason,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	run.DataFreshThrough = scanNullableString(freshThrough)
	run.PublishedAt = scanNullableString(publishedAt)

	rows, err := db.QueryContext(ctx, `
		SELECT display_ticker, display_name, tradingview_symbol, provider_symbol,
		       price_date, close_price, data_points, return_80_pct, momentum_240_pct,
		       volatility_240, sharpe_proxy, score, rank_value, decay, raw_weight_pct,
		       capped_weight_pct, final_weight_pct, status, diagnostic
		FROM etf_momentum_run_rows
		WHERE run_id = ?
		ORDER BY rank_value IS NULL, rank_value ASC, display_ticker ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	run.Rows = []ETFMomentumRunRowResponse{}
	for rows.Next() {
		var row ETFMomentumRunRowResponse
		var priceDate sql.NullString
		var closePrice, return80, momentum240, volatility240, sharpeProxy, score sql.NullFloat64
		var rank sql.NullInt64
		var decay, rawWeight, cappedWeight, finalWeight sql.NullFloat64
		if err := rows.Scan(
			&row.Ticker, &row.DisplayName, &row.TradingViewSymbol, &row.ProviderSymbol,
			&priceDate, &closePrice, &row.DataPoints, &return80, &momentum240,
			&volatility240, &sharpeProxy, &score, &rank, &decay, &rawWeight,
			&cappedWeight, &finalWeight, &row.Status, &row.Diagnostic,
		); err != nil {
			return nil, err
		}
		row.PriceDate = scanNullableString(priceDate)
		row.ClosePrice = scanNullableFloat(closePrice)
		row.Return80Pct = scanNullableFloat(return80)
		row.Momentum240Pct = scanNullableFloat(momentum240)
		row.Volatility240 = scanNullableFloat(volatility240)
		row.SharpeProxy = scanNullableFloat(sharpeProxy)
		row.Score = scanNullableFloat(score)
		row.Rank = scanNullableInt(rank)
		row.Decay = scanNullableFloat(decay)
		row.RawWeightPct = scanNullableFloat(rawWeight)
		row.CappedWeightPct = scanNullableFloat(cappedWeight)
		row.FinalWeightPct = scanNullableFloat(finalWeight)
		run.Rows = append(run.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &run, nil
}

func latestETFMomentumRun(ctx context.Context) (*ETFMomentumRunResponse, error) {
	var runID int64
	err := db.QueryRowContext(ctx, `
		SELECT id
		FROM etf_momentum_runs
		WHERE universe_code = ? AND algorithm_version = ?
		ORDER BY id DESC
		LIMIT 1
	`, etfMomentumLegacyUniverseCode, etfMomentumPineParityV1).Scan(&runID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return loadETFMomentumRun(ctx, runID)
}

func latestPublishedETFMomentumRun(ctx context.Context) (*ETFMomentumRunResponse, error) {
	var runID int64
	err := db.QueryRowContext(ctx, `
		SELECT id
		FROM etf_momentum_runs
		WHERE universe_code = ?
		  AND algorithm_version = ?
		  AND status = 'COMPLETE'
		  AND published_at IS NOT NULL
		ORDER BY published_at DESC, id DESC
		LIMIT 1
	`, etfMomentumLegacyUniverseCode, etfMomentumPineParityV1).Scan(&runID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return loadETFMomentumRun(ctx, runID)
}

func latestETFMomentumTradingViewReference(ctx context.Context) (*ETFMomentumTradingViewReferenceResponse, error) {
	// A parity reference is an explicitly captured TradingView table, not the
	// last live rebalance webhook. Rebalance payloads are intentionally sparse
	// and can be months old between scheduled cycles.
	var reference ETFMomentumTradingViewReferenceResponse
	err := db.QueryRowContext(ctx, `
		SELECT id, source, date(as_of_date), CAST(created_at AS TEXT)
		FROM etf_momentum_tradingview_snapshots
		WHERE universe_code = ?
		ORDER BY id DESC
		LIMIT 1
	`, etfMomentumLegacyUniverseCode).Scan(
		&reference.ID, &reference.Source, &reference.RebalanceDate, &reference.ReceivedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	reference.Rows = []ETFMomentumTradingViewReferenceRowResponse{}
	rows, err := db.QueryContext(ctx, `
		SELECT ticker, return_80_pct, momentum_240_pct, decay_pct, sharpe_proxy,
		       score, rank_value, allocation_pct
		FROM etf_momentum_tradingview_snapshot_rows
		WHERE snapshot_id = ?
		ORDER BY rank_value ASC, ticker ASC
	`, reference.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row ETFMomentumTradingViewReferenceRowResponse
		if err := rows.Scan(
			&row.Ticker, &row.Return80Pct, &row.Momentum240Pct, &row.DecayPct,
			&row.SharpeProxy, &row.Score, &row.Rank, &row.AllocationPct,
		); err != nil {
			return nil, err
		}
		row.ComparisonStatus = "WAITING_FOR_INTERNAL_RUN"
		reference.Rows = append(reference.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	reference.AllocationCount = len(reference.Rows)
	reference.ComparisonStatus = "WAITING_FOR_INTERNAL_RUN"
	reference.ComparisonSummary = "No complete internal run exists for this TradingView snapshot date."

	var runID int64
	err = db.QueryRowContext(ctx, `
		SELECT id
		FROM etf_momentum_runs
		WHERE universe_code = ?
		  AND algorithm_version = ?
		  AND date(as_of_date) = date(?)
		  AND status = 'COMPLETE'
		ORDER BY id DESC
		LIMIT 1
	`, etfMomentumLegacyUniverseCode, etfMomentumPineParityV1, reference.RebalanceDate).Scan(&runID)
	if err == sql.ErrNoRows {
		return &reference, nil
	}
	if err != nil {
		return nil, err
	}
	run, err := loadETFMomentumRun(ctx, runID)
	if err != nil {
		return nil, err
	}
	compareETFMomentumReference(&reference, run)
	return &reference, nil
}

func createETFMomentumTradingViewSnapshotHandler(w http.ResponseWriter, r *http.Request) {
	var request ETFMomentumTradingViewSnapshotRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid TradingView snapshot payload", http.StatusBadRequest)
		return
	}
	asOf, err := parseETFMomentumAsOf(request.AsOfDate)
	if err != nil {
		http.Error(w, "Invalid TradingView snapshot date: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(request.Rows) != len(etfMomentumLegacyUniverse) {
		http.Error(w, fmt.Sprintf("TradingView snapshot requires %d ETF rows", len(etfMomentumLegacyUniverse)), http.StatusBadRequest)
		return
	}
	expected := map[string]bool{}
	for _, seed := range etfMomentumLegacyUniverse {
		expected[canonicalSecurityTickerKey(seed.DisplayTicker)] = true
	}
	seen := map[string]bool{}
	for _, row := range request.Rows {
		ticker := canonicalSecurityTickerKey(row.Ticker)
		if !expected[ticker] || seen[ticker] || row.Rank < 1 || row.Rank > len(etfMomentumLegacyUniverse) ||
			!etfMomentumFinite(row.Return80Pct) || !etfMomentumFinite(row.Momentum240Pct) ||
			!etfMomentumFinite(row.DecayPct) || !etfMomentumFinite(row.SharpeProxy) ||
			!etfMomentumFinite(row.Score) || !etfMomentumFinite(row.AllocationPct) {
			http.Error(w, "TradingView snapshot contains invalid or duplicate ETF data", http.StatusBadRequest)
			return
		}
		seen[ticker] = true
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "Failed to start TradingView snapshot", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `
		INSERT INTO etf_momentum_tradingview_snapshots (universe_code, as_of_date)
		VALUES (?, ?)
	`, etfMomentumLegacyUniverseCode, asOf.Format("2006-01-02"))
	if err != nil {
		http.Error(w, "Failed to save TradingView snapshot", http.StatusInternalServerError)
		return
	}
	snapshotID, _ := result.LastInsertId()
	for _, row := range request.Rows {
		if _, err := tx.ExecContext(r.Context(), `
			INSERT INTO etf_momentum_tradingview_snapshot_rows (
				snapshot_id, ticker, return_80_pct, momentum_240_pct, decay_pct,
				sharpe_proxy, score, rank_value, allocation_pct
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, snapshotID, canonicalSecurityTickerKey(row.Ticker), row.Return80Pct, row.Momentum240Pct,
			row.DecayPct, row.SharpeProxy, row.Score, row.Rank, row.AllocationPct); err != nil {
			http.Error(w, "Failed to save TradingView snapshot rows", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit TradingView snapshot", http.StatusInternalServerError)
		return
	}
	reference, err := latestETFMomentumTradingViewReference(r.Context())
	if err != nil || reference == nil {
		http.Error(w, "Failed to load TradingView snapshot", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(reference)
}

func compareETFMomentumReference(reference *ETFMomentumTradingViewReferenceResponse, run *ETFMomentumRunResponse) {
	if reference == nil || run == nil {
		return
	}
	reference.ComparisonRunID = &run.ID
	reference.AllocationDriftTolerancePct = etfMomentumAllocationDriftTolerancePct
	type internalRow struct {
		rank        int
		return80    float64
		momentum240 float64
		decayPct    float64
		sharpe      float64
		score       float64
		weight      float64
	}
	internalByTicker := map[string]internalRow{}
	for _, row := range run.Rows {
		if row.Rank == nil || row.Return80Pct == nil || row.Momentum240Pct == nil || row.Decay == nil ||
			row.SharpeProxy == nil || row.Score == nil || row.FinalWeightPct == nil {
			continue
		}
		internalByTicker[canonicalSecurityTickerKey(row.Ticker)] = internalRow{
			rank:        *row.Rank,
			return80:    *row.Return80Pct,
			momentum240: *row.Momentum240Pct,
			decayPct:    *row.Decay * 100,
			sharpe:      *row.SharpeProxy,
			score:       *row.Score,
			weight:      *row.FinalWeightPct,
		}
	}

	matched := 0
	accepted := 0
	actionRequired := 0
	missing := 0
	for index := range reference.Rows {
		row := &reference.Rows[index]
		internal, found := internalByTicker[canonicalSecurityTickerKey(row.Ticker)]
		if !found {
			missing++
			row.ComparisonStatus = "MISSING_INTERNAL"
			row.ActionRequired = true
			actionRequired++
			continue
		}
		internalRank := internal.rank
		internalReturn80 := internal.return80
		internalWeight := internal.weight
		rankDelta := internal.rank - row.Rank
		return80Delta := internal.return80 - row.Return80Pct
		allocationDelta := internal.weight - row.AllocationPct
		row.InternalRank = &internalRank
		row.InternalReturn80Pct = &internalReturn80
		row.InternalAllocationPct = &internalWeight
		row.RankDelta = &rankDelta
		row.Return80DeltaPct = &return80Delta
		row.AllocationDeltaPct = &allocationDelta
		row.ComparisonStatus = "ACCEPTABLE_DRIFT"
		if math.Abs(allocationDelta) > etfMomentumAllocationDriftTolerancePct {
			row.ComparisonStatus = "ACTION_REQUIRED"
			row.ActionRequired = true
			actionRequired++
		} else {
			accepted++
		}
		if rankDelta == 0 && math.Abs(return80Delta) <= etfMomentumExactMatchTolerancePct && math.Abs(allocationDelta) <= etfMomentumExactMatchTolerancePct &&
			math.Abs(internal.momentum240-row.Momentum240Pct) <= etfMomentumExactMatchTolerancePct &&
			math.Abs(internal.decayPct-row.DecayPct) <= etfMomentumExactMatchTolerancePct &&
			math.Abs(internal.sharpe-row.SharpeProxy) <= etfMomentumExactMatchTolerancePct &&
			math.Abs(internal.score-row.Score) <= etfMomentumExactMatchTolerancePct {
			row.ComparisonStatus = "MATCH"
			matched++
		}
	}

	reference.ActionRequiredCount = actionRequired
	reference.ComparisonStatus = "ACCEPTABLE_DRIFT"
	if len(reference.Rows) < len(internalByTicker) || missing > 0 {
		reference.ComparisonStatus = "PARTIAL_REFERENCE"
	} else if actionRequired > 0 {
		reference.ComparisonStatus = "ACTION_REQUIRED"
	} else if len(reference.Rows) == len(internalByTicker) && matched == len(reference.Rows) {
		reference.ComparisonStatus = "MATCH"
	}
	reference.ComparisonSummary = fmt.Sprintf(
		"%d/%d rows are within the %.1f percentage-point allocation tolerance; %d require action. %d are exact formula matches.",
		accepted,
		len(reference.Rows),
		etfMomentumAllocationDriftTolerancePct,
		actionRequired,
		matched,
	)
	run.ComparisonStatus = reference.ComparisonStatus
}

func getETFMomentumWorkspace(w http.ResponseWriter, r *http.Request) {
	workspace := ETFMomentumWorkspaceResponse{UniverseCode: etfMomentumLegacyUniverseCode}
	var err error
	workspace.LatestRun, err = latestETFMomentumRun(r.Context())
	if err != nil {
		http.Error(w, "Failed to load ETF momentum run", http.StatusInternalServerError)
		return
	}
	workspace.PublishedRun, err = latestPublishedETFMomentumRun(r.Context())
	if err != nil {
		http.Error(w, "Failed to load published ETF momentum run", http.StatusInternalServerError)
		return
	}
	workspace.Automation = loadETFMomentumAutomationStatus(r.Context(), workspace.PublishedRun)
	workspace.LatestTradingViewReference, err = latestETFMomentumTradingViewReference(r.Context())
	if err != nil {
		http.Error(w, "Failed to load ETF TradingView reference", http.StatusInternalServerError)
		return
	}
	if workspace.LatestRun != nil && workspace.LatestTradingViewReference != nil && workspace.LatestTradingViewReference.ComparisonRunID != nil && *workspace.LatestTradingViewReference.ComparisonRunID == workspace.LatestRun.ID {
		workspace.LatestRun.ComparisonStatus = workspace.LatestTradingViewReference.ComparisonStatus
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(workspace)
}
