package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const commodityPriceHistorySource = "YAHOO"

type commodityPricePerformance struct {
	Return60DPct *float64
	AsOf         *time.Time
}

type commodityPriceRefreshResult struct {
	ExpectedSources  int      `json:"expected_sources"`
	UpdatedSources   int      `json:"updated_sources"`
	PointsUpserted   int      `json:"points_upserted"`
	DataFreshThrough *string  `json:"data_fresh_through,omitempty"`
	Errors           []string `json:"errors"`
}

// commodityYahooSymbol maps the configured chart source for a direct commodity
// gate to the equivalent daily Yahoo Finance series. The UI only presents this
// value as a return for the configured source; it never treats the symbol as a
// broker-accessible direct vehicle.
func commodityYahooSymbol(sourceSymbol string) string {
	switch strings.ToUpper(strings.TrimSpace(sourceSymbol)) {
	case "AMEX:GLD", "BATS:GLD":
		return "GLD"
	case "TVC:SILVER":
		return "SI=F"
	case "COMEX:HG1!":
		return "HG=F"
	case "NYMEX:CL1!":
		return "CL=F"
	case "NYMEX:NG1!":
		return "NG=F"
	case "OTC:SRUUF":
		return "SRUUF"
	case "AMEX:PPLT", "BATS:PPLT":
		return "PPLT"
	case "AMEX:EVMT", "BATS:EVMT":
		return "EVMT"
	case "CME:HRC1!":
		return "HRC=F"
	default:
		return ""
	}
}

func configuredCommodityPriceSources(ctx context.Context) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT TRIM(source_symbol)
		FROM commodity_theme_stages
		WHERE stage_key = 'COMMODITY'
		  AND active = 1
		  AND TRIM(source_symbol) <> ''
		ORDER BY source_symbol
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sources := []string{}
	for rows.Next() {
		var source string
		if err := rows.Scan(&source); err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	return sources, rows.Err()
}

func refreshCommodityPriceHistory(ctx context.Context) (commodityPriceRefreshResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	sources, err := configuredCommodityPriceSources(ctx)
	if err != nil {
		return commodityPriceRefreshResult{}, err
	}

	result := commodityPriceRefreshResult{Errors: []string{}}
	result.ExpectedSources = len(sources)
	for _, sourceSymbol := range sources {
		yahooSymbol := commodityYahooSymbol(sourceSymbol)
		if yahooSymbol == "" {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: no daily price source configured", sourceSymbol))
			continue
		}

		points, _, err := fetchYahooAdjustedDailyPrices(ctx, yahooSymbol, "", "4mo")
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", sourceSymbol, err))
			continue
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", sourceSymbol, err))
			continue
		}
		upserted := 0
		for _, point := range points {
			if _, execErr := tx.ExecContext(ctx, `
				INSERT INTO commodity_price_daily (
					source_symbol, provider_symbol, observed_date, close_price, currency, source, updated_at
				)
				VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(source_symbol, observed_date, source) DO UPDATE SET
					provider_symbol = excluded.provider_symbol,
					close_price = excluded.close_price,
					currency = excluded.currency,
					updated_at = CURRENT_TIMESTAMP
			`, sourceSymbol, yahooSymbol, point.Date.Format("2006-01-02"), point.AdjustedClose, point.Currency, commodityPriceHistorySource); execErr != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s %s: %v", sourceSymbol, point.Date.Format("2006-01-02"), execErr))
				continue
			}
			upserted++
		}
		if err := tx.Commit(); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", sourceSymbol, err))
			continue
		}
		if upserted > 0 {
			result.UpdatedSources++
			result.PointsUpserted += upserted
			latestDate := points[len(points)-1].Date.Format("2006-01-02")
			if result.DataFreshThrough == nil || latestDate < *result.DataFreshThrough {
				freshThrough := latestDate
				result.DataFreshThrough = &freshThrough
			}
		}

		// Keep the keyless upstream endpoint comfortably below its burst limit.
		time.Sleep(150 * time.Millisecond)
	}
	return result, nil
}

// loadCommodityPricePerformance returns a 60-calendar-day price change using
// the closest preceding trading close. It is deliberately separate from the
// CDF state: a positive return never implies a BULL signal.
func loadCommodityPricePerformance(ctx context.Context, sourceSymbol string) commodityPricePerformance {
	if ctx == nil || strings.TrimSpace(sourceSymbol) == "" {
		return commodityPricePerformance{}
	}

	var latestDate string
	var latestClose float64
	err := db.QueryRowContext(ctx, `
		SELECT observed_date, close_price
		FROM commodity_price_daily
		WHERE source_symbol = ?
		  AND source = ?
		  AND close_price > 0
		ORDER BY observed_date DESC
		LIMIT 1
	`, sourceSymbol, commodityPriceHistorySource).Scan(&latestDate, &latestClose)
	if err != nil {
		return commodityPricePerformance{}
	}

	asOf, err := time.Parse("2006-01-02", latestDate)
	if err != nil {
		asOf, err = time.Parse(time.RFC3339, latestDate)
		if err != nil {
			return commodityPricePerformance{}
		}
	}
	performance := commodityPricePerformance{AsOf: &asOf}

	var anchorClose sql.NullFloat64
	err = db.QueryRowContext(ctx, `
		SELECT close_price
		FROM commodity_price_daily
		WHERE source_symbol = ?
		  AND source = ?
		  AND close_price > 0
		  AND observed_date <= date(?, '-60 days')
		ORDER BY observed_date DESC
		LIMIT 1
	`, sourceSymbol, commodityPriceHistorySource, latestDate).Scan(&anchorClose)
	if err != nil || !anchorClose.Valid || anchorClose.Float64 <= 0 {
		return performance
	}
	performance.Return60DPct = pctReturn(latestClose, anchorClose.Float64)
	return performance
}

func refreshCommodityPriceHistoryHandler(w http.ResponseWriter, r *http.Request) {
	runID, ok := beginManualDataRefresh(w, r, dataRefreshCommodityPriceHistory)
	if !ok {
		return
	}
	result, err := refreshCommodityPriceHistory(r.Context())
	if !finishManualDataRefresh(w, r, runID, commodityPriceExecutionFromResult(result, err)) {
		return
	}
	if err != nil {
		http.Error(w, "Failed to refresh commodity price history", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}
