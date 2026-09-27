package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

func getAllAnalysis(w http.ResponseWriter, r *http.Request) {
	rows, err := db.QueryContext(r.Context(), `
		SELECT id, ticker, name, council_run_id, council_run_label, grok_quality, grok_value, gemini_quality, gemini_value, gpt_quality, gpt_value,
		       deer_flow_quality, deer_flow_value, perplexity_quality, perplexity_value,
		       claude_quality, claude_value, council_quality, council_value,
		       grok_pt, gemini_pt, gpt_pt, deer_flow_pt, perplexity_pt, claude_pt, council_pt,
		       gemini_webui_output, gemini_webui_input_at, perplexity_webui_output, perplexity_webui_input_at,
		       gpt_webui_output, gpt_webui_input_at, claude_webui_output, claude_webui_input_at,
		       council_source_output, council_source_input_at,
		       current_price, tipranks_pt, analyst_pt, upside_24m, allocation, COALESCE(include_in_sizing, 1), primary_asset_class, security_type, overlay_sell_priority, market_cap, risk_profile, notes,
		       thesis, bear_case_pt, base_case_pt, bull_case_pt, bear_probability, base_probability, bull_probability, catalysts,
		       last_contributed_at, is_watchlist, is_external, updated_at, created_at
		FROM stock_analysis
		ORDER BY updated_at DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var analyses []StockAnalysis
	for rows.Next() {
		var a StockAnalysis
		err := rows.Scan(&a.ID, &a.Ticker, &a.Name, &a.CouncilRunID, &a.CouncilRunLabel, &a.GrokQuality, &a.GrokValue,
			&a.GeminiQuality, &a.GeminiValue, &a.GptQuality, &a.GptValue,
			&a.DeerFlowQuality, &a.DeerFlowValue, &a.PerplexityQuality, &a.PerplexityValue, &a.ClaudeQuality, &a.ClaudeValue,
			&a.CouncilQuality, &a.CouncilValue,
			&a.GrokPT, &a.GeminiPT, &a.GptPT, &a.DeerFlowPT, &a.PerplexityPT, &a.ClaudePT, &a.CouncilPT,
			&a.GeminiWebUIOutput, &a.GeminiWebUIInputAt, &a.PerplexityWebUIOutput, &a.PerplexityWebUIInputAt,
			&a.GptWebUIOutput, &a.GptWebUIInputAt, &a.ClaudeWebUIOutput, &a.ClaudeWebUIInputAt,
			&a.CouncilSourceOutput, &a.CouncilSourceInputAt,
			&a.CurrentPrice, &a.TipRanksPT, &a.AnalystPT,
			&a.Upside24M, &a.Allocation, &a.IncludeInSizing, &a.PrimaryAssetClass, &a.SecurityType, &a.OverlaySellPriority, &a.MarketCap, &a.RiskProfile, &a.Notes,
			&a.Thesis, &a.BearCasePT, &a.BaseCasePT, &a.BullCasePT, &a.BearProbability, &a.BaseProbability, &a.BullProbability, &a.Catalysts,
			&a.LastContributedAt, &a.IsWatchlist, &a.IsExternal, &a.UpdatedAt, &a.CreatedAt)
		if err != nil {
			continue
		}
		analyses = append(analyses, a)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	rows.Close()
	analyses = dedupeAnalysisResponseRows(analyses)
	attachAnalysisPerformanceMetrics(r.Context(), analyses)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(analyses)
}

func dedupeAnalysisResponseRows(analyses []StockAnalysis) []StockAnalysis {
	if len(analyses) <= 1 {
		return analyses
	}

	result := make([]StockAnalysis, 0, len(analyses))
	indexByKey := make(map[string]int)
	for _, analysis := range analyses {
		key := ""
		if analysis.Ticker != nil {
			key = canonicalSecurityTickerKey(*analysis.Ticker)
		}
		if key == "" {
			key = "name:" + strings.ToLower(strings.TrimSpace(analysis.Name))
		} else {
			key = "ticker:" + key
		}

		existingIndex, exists := indexByKey[key]
		if !exists {
			indexByKey[key] = len(result)
			result = append(result, analysis)
			continue
		}

		existing := result[existingIndex]
		if stockAnalysisPreferenceScore(analysis) > stockAnalysisPreferenceScore(existing) {
			analysis.IsWatchlist = analysis.IsWatchlist || existing.IsWatchlist
			analysis.IsExternal = analysis.IsExternal || existing.IsExternal
			result[existingIndex] = analysis
		} else {
			existing.IsWatchlist = existing.IsWatchlist || analysis.IsWatchlist
			existing.IsExternal = existing.IsExternal || analysis.IsExternal
			result[existingIndex] = existing
		}
	}
	return result
}

func stockAnalysisPreferenceScore(analysis StockAnalysis) int {
	score := 0
	if analysis.Ticker != nil {
		symbol := canonicalSecurityTickerKey(*analysis.Ticker)
		name := strings.ToUpper(strings.TrimSpace(analysis.Name))
		if name != "" && name != symbol && name != strings.ToUpper(strings.TrimSpace(*analysis.Ticker)) {
			score += 1000
		}
	}
	if analysis.CouncilRunID != nil && strings.TrimSpace(*analysis.CouncilRunID) != "" {
		score += 500
	}
	if analysis.Thesis != nil && strings.TrimSpace(*analysis.Thesis) != "" {
		score += 300
	}
	if analysis.Catalysts != nil && strings.TrimSpace(*analysis.Catalysts) != "" {
		score += 200
	}
	if analysis.PrimaryAssetClass != nil && strings.TrimSpace(*analysis.PrimaryAssetClass) != "" {
		score += 100
	}
	if analysis.SecurityType != nil && strings.TrimSpace(*analysis.SecurityType) != "" {
		score += 50
	}
	if analysis.IsExternal {
		score += 20
	}
	if analysis.IsWatchlist {
		score += 10
	}
	return score
}

type analysisPerformanceMetric struct {
	sixMonthPct    *float64
	twelveMonthPct *float64
	asOf           string
	source         string
}

func performanceKey(ticker, exchangePrefix string) string {
	return strings.ToUpper(strings.TrimSpace(exchangePrefix) + strings.TrimSpace(ticker))
}

func splitFullTicker(raw string) (string, string) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", ""
	}
	if idx := strings.Index(value, ":"); idx >= 0 {
		return strings.ToUpper(strings.TrimSpace(value[:idx+1])), strings.ToUpper(strings.TrimSpace(value[idx+1:]))
	}
	return "", strings.ToUpper(value)
}

func ptrFloat64(value float64) *float64 {
	v := value
	return &v
}

func ptrString(value string) *string {
	v := value
	return &v
}

func pctReturn(latest, anchor float64) *float64 {
	if anchor <= 0 {
		return nil
	}
	return ptrFloat64(((latest - anchor) / anchor) * 100)
}

func attachAnalysisPerformanceMetrics(ctx context.Context, analyses []StockAnalysis) {
	if len(analyses) == 0 {
		return
	}
	metrics := loadAnalysisPerformanceMetrics(ctx)
	if len(metrics) == 0 {
		return
	}
	for i := range analyses {
		if analyses[i].Ticker == nil || strings.TrimSpace(*analyses[i].Ticker) == "" {
			continue
		}
		exchangePrefix, ticker := splitFullTicker(*analyses[i].Ticker)
		if ticker == "" {
			continue
		}
		metric, ok := metrics[performanceKey(ticker, exchangePrefix)]
		if !ok && exchangePrefix != "" {
			metric, ok = metrics[performanceKey(ticker, "")]
		}
		if !ok {
			continue
		}
		analyses[i].Performance6MPct = metric.sixMonthPct
		analyses[i].Performance12MPct = metric.twelveMonthPct
		analyses[i].PerformanceAsOf = ptrString(metric.asOf)
		analyses[i].PerformanceSource = ptrString(metric.source)
	}
}

func loadAnalysisPerformanceMetrics(ctx context.Context) map[string]analysisPerformanceMetric {
	return loadAnalysisPerformanceMetricsFrom(ctx, db)
}

func loadAnalysisPerformanceMetricsFrom(ctx context.Context, reader deploymentReader) map[string]analysisPerformanceMetric {
	metrics, err := readAnalysisPerformanceMetrics(ctx, reader)
	if err != nil {
		log.Printf("[ANALYSIS] Failed to load performance metrics: %v", err)
	}
	return metrics
}

func readAnalysisPerformanceMetrics(ctx context.Context, reader deploymentReader) (map[string]analysisPerformanceMetric, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	rows, err := reader.QueryContext(ctx, `
		WITH latest AS (
			SELECT ticker, exchange_prefix, MAX(observed_date) AS latest_date
			FROM security_price_daily
			WHERE adjusted_close_price > 0
			GROUP BY ticker, exchange_prefix
		)
		SELECT
			l.ticker,
			l.exchange_prefix,
			l.latest_date,
			latest_price.adjusted_close_price,
			latest_price.source,
			(
				SELECT p6.adjusted_close_price
				FROM security_price_daily p6
				WHERE p6.ticker = l.ticker
				  AND p6.exchange_prefix = l.exchange_prefix
				  AND p6.adjusted_close_price > 0
				  AND p6.observed_date <= date(l.latest_date, '-6 months')
				ORDER BY p6.observed_date DESC
				LIMIT 1
			) AS price_6m,
			(
				SELECT p12.adjusted_close_price
				FROM security_price_daily p12
				WHERE p12.ticker = l.ticker
				  AND p12.exchange_prefix = l.exchange_prefix
				  AND p12.adjusted_close_price > 0
				  AND p12.observed_date <= date(l.latest_date, '-12 months')
				ORDER BY p12.observed_date DESC
				LIMIT 1
			) AS price_12m
		FROM latest l
		JOIN security_price_daily latest_price
		  ON latest_price.ticker = l.ticker
		 AND latest_price.exchange_prefix = l.exchange_prefix
		 AND latest_price.observed_date = l.latest_date
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metrics := make(map[string]analysisPerformanceMetric)
	for rows.Next() {
		var ticker, exchangePrefix, latestDate, source string
		var latestPrice float64
		var price6M, price12M sql.NullFloat64
		if err := rows.Scan(&ticker, &exchangePrefix, &latestDate, &latestPrice, &source, &price6M, &price12M); err != nil {
			return nil, err
		}
		metric := analysisPerformanceMetric{
			asOf:   latestDate,
			source: source,
		}
		if price6M.Valid {
			metric.sixMonthPct = pctReturn(latestPrice, price6M.Float64)
		}
		if price12M.Valid {
			metric.twelveMonthPct = pctReturn(latestPrice, price12M.Float64)
		}
		metrics[performanceKey(ticker, exchangePrefix)] = metric
		if exchangePrefix == "" {
			metrics[performanceKey(ticker, "")] = metric
		}
	}
	return metrics, rows.Err()
}

type securityPricePoint struct {
	Date          time.Time
	Close         float64
	AdjustedClose float64
	Currency      string
}

type performanceRefreshResult struct {
	ExpectedTickers  int      `json:"expected_tickers"`
	UpdatedTickers   int      `json:"updated_tickers"`
	PointsUpserted   int      `json:"points_upserted"`
	DataFreshThrough *string  `json:"data_fresh_through,omitempty"`
	Errors           []string `json:"errors"`
}

func fetchYahooAdjustedDailyPrices(ctx context.Context, ticker, exchangePrefix, historyRange string) ([]securityPricePoint, string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	yahooSymbol := yahooSymbolForTicker(ticker, exchangePrefix)
	if yahooSymbol == "" {
		return nil, "", fmt.Errorf("empty yahoo symbol")
	}
	url := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=%s&events=history",
		yahooSymbol,
		historyRange,
	)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, yahooSymbol, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, yahooSymbol, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, yahooSymbol, fmt.Errorf("yahoo status %d", resp.StatusCode)
	}

	var parsed struct {
		Chart struct {
			Result []struct {
				Meta struct {
					Currency string `json:"currency"`
				} `json:"meta"`
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Close []*float64 `json:"close"`
					} `json:"quote"`
					AdjClose []struct {
						AdjClose []*float64 `json:"adjclose"`
					} `json:"adjclose"`
				} `json:"indicators"`
			} `json:"result"`
			Error *struct {
				Code        string `json:"code"`
				Description string `json:"description"`
			} `json:"error"`
		} `json:"chart"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, yahooSymbol, err
	}
	if parsed.Chart.Error != nil {
		return nil, yahooSymbol, fmt.Errorf("%s", parsed.Chart.Error.Description)
	}
	if len(parsed.Chart.Result) == 0 {
		return nil, yahooSymbol, fmt.Errorf("no chart data")
	}

	result := parsed.Chart.Result[0]
	if len(result.Timestamp) == 0 || len(result.Indicators.Quote) == 0 {
		return nil, yahooSymbol, fmt.Errorf("empty price history")
	}
	closes := result.Indicators.Quote[0].Close
	var adjusted []*float64
	if len(result.Indicators.AdjClose) > 0 {
		adjusted = result.Indicators.AdjClose[0].AdjClose
	}

	points := make([]securityPricePoint, 0, len(result.Timestamp))
	for i, ts := range result.Timestamp {
		if i >= len(closes) || closes[i] == nil || *closes[i] <= 0 {
			continue
		}
		adjustedClose := *closes[i]
		if i < len(adjusted) && adjusted[i] != nil && *adjusted[i] > 0 {
			adjustedClose = *adjusted[i]
		}
		points = append(points, securityPricePoint{
			Date:          time.Unix(ts, 0).UTC(),
			Close:         *closes[i],
			AdjustedClose: adjustedClose,
			Currency:      result.Meta.Currency,
		})
	}
	if len(points) == 0 {
		return nil, yahooSymbol, fmt.Errorf("no valid daily prices")
	}
	return points, yahooSymbol, nil
}

func refreshAnalysisPerformanceInternal(ctx context.Context, limit int) (performanceRefreshResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if limit <= 0 {
		limit = 300
	}
	if limit > 1000 {
		limit = 1000
	}

	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT COALESCE(ticker, '')
		FROM stock_analysis
		WHERE ticker IS NOT NULL
		  AND TRIM(ticker) <> ''
		  AND UPPER(COALESCE(security_type, '')) NOT IN ('CVR', 'NON_ALLOCATING')
		  AND UPPER(COALESCE(name, '')) NOT LIKE '%CONTINGENT VALUE RIGHT%'
		ORDER BY ticker
		LIMIT ?
	`, limit)
	if err != nil {
		return performanceRefreshResult{}, err
	}
	defer rows.Close()

	result := performanceRefreshResult{Errors: []string{}}
	seen := map[string]bool{}
	for rows.Next() {
		var fullTicker string
		if err := rows.Scan(&fullTicker); err != nil {
			continue
		}
		exchangePrefix, ticker := splitFullTicker(fullTicker)
		if ticker == "" {
			continue
		}
		key := performanceKey(ticker, exchangePrefix)
		if seen[key] {
			continue
		}
		seen[key] = true
		result.ExpectedTickers++

		points, yahooSymbol, err := fetchYahooAdjustedDailyPrices(ctx, ticker, exchangePrefix, "18mo")
		if err != nil && exchangePrefix == "" {
			points, yahooSymbol, err = fetchYahooAdjustedDailyPrices(ctx, ticker, "ASX:", "18mo")
		}
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", fullTicker, err))
			continue
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", fullTicker, err))
			continue
		}
		upserted := 0
		for _, point := range points {
			_, execErr := tx.ExecContext(ctx, `
				INSERT INTO security_price_daily (
					ticker, exchange_prefix, yahoo_symbol, observed_date, close_price, adjusted_close_price, currency, source, updated_at
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, 'YAHOO', CURRENT_TIMESTAMP)
				ON CONFLICT(ticker, exchange_prefix, observed_date, source) DO UPDATE SET
					yahoo_symbol = excluded.yahoo_symbol,
					close_price = excluded.close_price,
					adjusted_close_price = excluded.adjusted_close_price,
					currency = excluded.currency,
					updated_at = CURRENT_TIMESTAMP
			`, ticker, exchangePrefix, yahooSymbol, point.Date.Format("2006-01-02"), point.Close, point.AdjustedClose, point.Currency)
			if execErr != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s %s: %v", fullTicker, point.Date.Format("2006-01-02"), execErr))
				continue
			}
			upserted++
		}
		if err := tx.Commit(); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", fullTicker, err))
			continue
		}
		if upserted > 0 {
			result.UpdatedTickers++
			result.PointsUpserted += upserted
			latestPoint := points[len(points)-1]
			latestDate := latestPoint.Date.Format("2006-01-02")
			if result.DataFreshThrough == nil || latestDate < *result.DataFreshThrough {
				freshThrough := latestDate
				result.DataFreshThrough = &freshThrough
			}
			_, updateErr := db.ExecContext(ctx, `
				UPDATE stock_analysis
				SET current_price = ?, updated_at = CURRENT_TIMESTAMP
				WHERE UPPER(TRIM(COALESCE(ticker, ''))) = UPPER(TRIM(?))
			`, latestPoint.Close, fullTicker)
			if updateErr != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: current price update failed: %v", fullTicker, updateErr))
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	return result, nil
}

func refreshAnalysisPerformance(w http.ResponseWriter, r *http.Request) {
	limit := 300
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 {
			limit = parsed
		}
	}

	runID, ok := beginManualDataRefresh(w, r, dataRefreshAnalysisPriceHistory)
	if !ok {
		return
	}
	result, err := refreshAnalysisPerformanceInternal(r.Context(), limit)
	if !finishManualDataRefresh(w, r, runID, analysisPriceExecutionFromResult(result, err)) {
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func upsertAnalysis(w http.ResponseWriter, r *http.Request) {
	var analysis StockAnalysis
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := json.Unmarshal(body, &analysis); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var rawFields map[string]json.RawMessage
	if err := json.Unmarshal(body, &rawFields); err == nil {
		if _, ok := rawFields["include_in_sizing"]; !ok {
			analysis.IncludeInSizing = true
		}
	}

	var securityType interface{}
	if resolvedSecurityType := resolveSecurityTypeForAnalysis(analysis.Name, analysis.SecurityType); resolvedSecurityType != "" {
		normalizedSecurityType := normalizeSecurityType(resolvedSecurityType)
		analysis.SecurityType = &normalizedSecurityType
		securityType = normalizedSecurityType
		if isNonAllocatingSecurityType(normalizedSecurityType) {
			analysis.PrimaryAssetClass = nil
			analysis.Allocation = 0
		}
	}
	if analysis.PrimaryAssetClass != nil {
		normalizedClass, ok := resolvePortfolioAssignmentClass(*analysis.PrimaryAssetClass)
		if !ok {
			http.Error(w, fmt.Sprintf("invalid primary_asset_class %s", *analysis.PrimaryAssetClass), http.StatusBadRequest)
			return
		}
		if normalizedClass == "" {
			analysis.PrimaryAssetClass = nil
		} else {
			analysis.PrimaryAssetClass = &normalizedClass
		}
	}

	// Upsert: Insert or update if exists
	result, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, council_run_id, council_run_label, grok_quality, grok_value, gemini_quality, gemini_value, gpt_quality, gpt_value,
			deer_flow_quality, deer_flow_value, perplexity_quality, perplexity_value,
			claude_quality, claude_value, council_quality, council_value,
			grok_pt, gemini_pt, gpt_pt, deer_flow_pt, perplexity_pt, claude_pt, council_pt,
			gemini_webui_output, gemini_webui_input_at, perplexity_webui_output, perplexity_webui_input_at,
			gpt_webui_output, gpt_webui_input_at, claude_webui_output, claude_webui_input_at,
			council_source_output, council_source_input_at,
			tipranks_pt, analyst_pt, upside_24m, allocation, include_in_sizing, primary_asset_class, overlay_sell_priority, market_cap, risk_profile, notes,
			thesis, bear_case_pt, base_case_pt, bull_case_pt, bear_probability, base_probability, bull_probability, catalysts,
			is_watchlist, is_external, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(ticker, name) DO UPDATE SET
			council_run_id = excluded.council_run_id,
			council_run_label = excluded.council_run_label,
			grok_quality = excluded.grok_quality,
			grok_value = excluded.grok_value,
			gemini_quality = excluded.gemini_quality,
			gemini_value = excluded.gemini_value,
			gpt_quality = excluded.gpt_quality,
			gpt_value = excluded.gpt_value,
			deer_flow_quality = excluded.deer_flow_quality,
			deer_flow_value = excluded.deer_flow_value,
			perplexity_quality = excluded.perplexity_quality,
			perplexity_value = excluded.perplexity_value,
			claude_quality = excluded.claude_quality,
			claude_value = excluded.claude_value,
			council_quality = excluded.council_quality,
			council_value = excluded.council_value,
			grok_pt = excluded.grok_pt,
			gemini_pt = excluded.gemini_pt,
			gpt_pt = excluded.gpt_pt,
			deer_flow_pt = excluded.deer_flow_pt,
			perplexity_pt = excluded.perplexity_pt,
			claude_pt = excluded.claude_pt,
			council_pt = excluded.council_pt,
			gemini_webui_output = excluded.gemini_webui_output,
			gemini_webui_input_at = excluded.gemini_webui_input_at,
			perplexity_webui_output = excluded.perplexity_webui_output,
			perplexity_webui_input_at = excluded.perplexity_webui_input_at,
			gpt_webui_output = excluded.gpt_webui_output,
			gpt_webui_input_at = excluded.gpt_webui_input_at,
			claude_webui_output = excluded.claude_webui_output,
			claude_webui_input_at = excluded.claude_webui_input_at,
			council_source_output = excluded.council_source_output,
			council_source_input_at = excluded.council_source_input_at,
			tipranks_pt = excluded.tipranks_pt,
			analyst_pt = excluded.analyst_pt,
			upside_24m = excluded.upside_24m,
			allocation = excluded.allocation,
			include_in_sizing = excluded.include_in_sizing,
			primary_asset_class = excluded.primary_asset_class,
			overlay_sell_priority = excluded.overlay_sell_priority,
			market_cap = excluded.market_cap,
			risk_profile = excluded.risk_profile,
			notes = excluded.notes,
			thesis = excluded.thesis,
			bear_case_pt = excluded.bear_case_pt,
			base_case_pt = excluded.base_case_pt,
			bull_case_pt = excluded.bull_case_pt,
			bear_probability = excluded.bear_probability,
			base_probability = excluded.base_probability,
			bull_probability = excluded.bull_probability,
			catalysts = excluded.catalysts,
			is_watchlist = excluded.is_watchlist,
			is_external = excluded.is_external,
			updated_at = CURRENT_TIMESTAMP
	`, analysis.Ticker, analysis.Name, analysis.CouncilRunID, analysis.CouncilRunLabel, analysis.GrokQuality, analysis.GrokValue,
		analysis.GeminiQuality, analysis.GeminiValue, analysis.GptQuality, analysis.GptValue,
		analysis.DeerFlowQuality, analysis.DeerFlowValue, analysis.PerplexityQuality, analysis.PerplexityValue, analysis.ClaudeQuality, analysis.ClaudeValue,
		analysis.CouncilQuality, analysis.CouncilValue,
		analysis.GrokPT, analysis.GeminiPT, analysis.GptPT,
		analysis.DeerFlowPT, analysis.PerplexityPT, analysis.ClaudePT, analysis.CouncilPT,
		analysis.GeminiWebUIOutput, analysis.GeminiWebUIInputAt, analysis.PerplexityWebUIOutput, analysis.PerplexityWebUIInputAt,
		analysis.GptWebUIOutput, analysis.GptWebUIInputAt, analysis.ClaudeWebUIOutput, analysis.ClaudeWebUIInputAt,
		analysis.CouncilSourceOutput, analysis.CouncilSourceInputAt,
		analysis.TipRanksPT, analysis.AnalystPT, analysis.Upside24M, analysis.Allocation, analysis.IncludeInSizing, analysis.PrimaryAssetClass, analysis.OverlaySellPriority, analysis.MarketCap,
		analysis.RiskProfile, analysis.Notes,
		analysis.Thesis, analysis.BearCasePT, analysis.BaseCasePT, analysis.BullCasePT,
		analysis.BearProbability, analysis.BaseProbability, analysis.BullProbability, analysis.Catalysts,
		analysis.IsWatchlist, analysis.IsExternal)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Attribute the class to whoever set it. The auto-assign caller declares
	// LLM_AUTO; anything else arriving with an explicit class is a person.
	if analysis.PrimaryAssetClass != nil {
		source := normalizeAssetClassSource(analysis.AssetClassSource)
		if source == "" {
			source = AssetClassSourceManual
		}
		if analysis.Ticker != nil {
			stampAssetClassSourceByTicker(*analysis.Ticker, source)
		}
	}

	id, _ := result.LastInsertId()
	analysis.ID = int(id)
	if analysis.Ticker != nil {
		tickerKey := canonicalSecurityTickerKey(*analysis.Ticker)
		if tickerKey != "" {
			if err := deduplicateStockAnalysisTickerKey(tickerKey); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			query := fmt.Sprintf(`
				SELECT id
				FROM stock_analysis
				WHERE %s = ?
				ORDER BY updated_at DESC, id ASC
				LIMIT 1
			`, stockAnalysisTickerKeySQL("ticker"))
			_ = db.QueryRow(query, tickerKey).Scan(&analysis.ID)
		}
	}

	if securityType != nil {
		_, err = db.Exec(`
			UPDATE stock_analysis
			SET security_type = ?,
			    primary_asset_class = CASE WHEN ? IN ('CVR', 'NON_ALLOCATING') THEN NULL ELSE primary_asset_class END,
			    allocation = CASE WHEN ? IN ('CVR', 'NON_ALLOCATING') THEN 0 ELSE allocation END,
			    include_in_sizing = CASE WHEN ? IN ('CVR', 'NON_ALLOCATING') THEN 0 ELSE include_in_sizing END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE name = ?
			  AND (
					COALESCE(ticker, '') = COALESCE(?, '')
				 OR UPPER(CASE
						WHEN instr(COALESCE(ticker, ''), ':') > 0 THEN substr(ticker, instr(ticker, ':') + 1)
						ELSE COALESCE(ticker, '')
					END) = UPPER(CASE
						WHEN instr(COALESCE(?, ''), ':') > 0 THEN substr(?, instr(?, ':') + 1)
						ELSE COALESCE(?, '')
					END)
			  )
		`, securityType, securityType, securityType, securityType, analysis.Name, analysis.Ticker, analysis.Ticker, analysis.Ticker, analysis.Ticker, analysis.Ticker)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Watchlist rows need a durable identity from their first write. The identity
	// is keyed by the supplied exchange+ticker where available; no provider data
	// is used here to alter it.
	if analysis.ID > 0 {
		var ticker string
		if analysis.Ticker != nil {
			ticker = *analysis.Ticker
		}
		if _, err := ensureAnalysisSecurityIdentity(analysis.ID, ticker, analysis.Name, "analysis_upsert"); err != nil {
			log.Printf("[ANALYSIS] identity link failed for id=%d: %v", analysis.ID, err)
			http.Error(w, "failed to establish security identity", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(analysis)
}

func updateAnalysis(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Decode into a map to detect which fields were actually sent
	var updates map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if rawSecurityType, ok := updates["security_type"]; ok {
		normalizedSecurityType := normalizeSecurityType(fmt.Sprint(rawSecurityType))
		updates["security_type"] = normalizedSecurityType
		if isNonAllocatingSecurityType(normalizedSecurityType) {
			updates["primary_asset_class"] = nil
			updates["allocation"] = float64(0)
			updates["include_in_sizing"] = false
		}
	} else if _, updatesPrimaryClass := updates["primary_asset_class"]; updatesPrimaryClass {
		var currentSecurityType string
		if err := db.QueryRow(`SELECT COALESCE(security_type, '') FROM stock_analysis WHERE id = ?`, id).Scan(&currentSecurityType); err == nil && isNonAllocatingSecurityType(currentSecurityType) {
			http.Error(w, "non-allocating instruments cannot be assigned a primary_asset_class", http.StatusBadRequest)
			return
		}
	}

	// Build dynamic UPDATE query based on provided fields
	var setClauses []string
	var args []interface{}

	fieldMap := map[string]string{
		"ticker":                    "ticker",
		"grok_quality":              "grok_quality",
		"grok_value":                "grok_value",
		"gemini_quality":            "gemini_quality",
		"gemini_value":              "gemini_value",
		"gpt_quality":               "gpt_quality",
		"gpt_value":                 "gpt_value",
		"deer_flow_quality":         "deer_flow_quality",
		"deer_flow_value":           "deer_flow_value",
		"perplexity_quality":        "perplexity_quality",
		"perplexity_value":          "perplexity_value",
		"claude_quality":            "claude_quality",
		"claude_value":              "claude_value",
		"council_quality":           "council_quality",
		"council_value":             "council_value",
		"grok_pt":                   "grok_pt",
		"gemini_pt":                 "gemini_pt",
		"gpt_pt":                    "gpt_pt",
		"deer_flow_pt":              "deer_flow_pt",
		"perplexity_pt":             "perplexity_pt",
		"claude_pt":                 "claude_pt",
		"council_pt":                "council_pt",
		"council_run_id":            "council_run_id",
		"council_run_label":         "council_run_label",
		"gemini_webui_output":       "gemini_webui_output",
		"gemini_webui_input_at":     "gemini_webui_input_at",
		"perplexity_webui_output":   "perplexity_webui_output",
		"perplexity_webui_input_at": "perplexity_webui_input_at",
		"gpt_webui_output":          "gpt_webui_output",
		"gpt_webui_input_at":        "gpt_webui_input_at",
		"claude_webui_output":       "claude_webui_output",
		"claude_webui_input_at":     "claude_webui_input_at",
		"council_source_output":     "council_source_output",
		"council_source_input_at":   "council_source_input_at",
		"tipranks_pt":               "tipranks_pt",
		"analyst_pt":                "analyst_pt",
		"upside_24m":                "upside_24m",
		"allocation":                "allocation",
		"include_in_sizing":         "include_in_sizing",
		"primary_asset_class":       "primary_asset_class",
		"security_type":             "security_type",
		"overlay_sell_priority":     "overlay_sell_priority",
		"market_cap":                "market_cap",
		"risk_profile":              "risk_profile",
		"notes":                     "notes",
		"thesis":                    "thesis",
		"bear_case_pt":              "bear_case_pt",
		"base_case_pt":              "base_case_pt",
		"bull_case_pt":              "bull_case_pt",
		"bear_probability":          "bear_probability",
		"base_probability":          "base_probability",
		"bull_probability":          "bull_probability",
		"catalysts":                 "catalysts",
		"is_watchlist":              "is_watchlist",
		"is_external":               "is_external",
	}
	patchedAssetClass := false

	for jsonField, dbField := range fieldMap {
		if val, ok := updates[jsonField]; ok {
			if jsonField == "security_type" {
				val = normalizeSecurityType(fmt.Sprint(val))
			}
			if jsonField == "primary_asset_class" {
				patchedAssetClass = true
				if val == nil {
					val = nil
				} else {
					normalizedClass, ok := resolvePortfolioAssignmentClass(fmt.Sprint(val))
					if !ok {
						http.Error(w, fmt.Sprintf("invalid primary_asset_class %v", val), http.StatusBadRequest)
						return
					}
					if normalizedClass == "" {
						val = nil
					} else {
						val = normalizedClass
					}
				}
			}
			setClauses = append(setClauses, dbField+" = ?")
			args = append(args, val)
		}
	}

	if len(setClauses) == 0 {
		http.Error(w, "No fields to update", http.StatusBadRequest)
		return
	}

	// Always update timestamp
	setClauses = append(setClauses, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)

	query := fmt.Sprintf("UPDATE stock_analysis SET %s WHERE id = ?", strings.Join(setClauses, ", "))
	_, err := db.Exec(query, args...)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// A class edited through this endpoint is a decision. The auto-assign caller
	// declares asset_class_source: "LLM_AUTO"; everything else is a person.
	if patchedAssetClass {
		source := AssetClassSourceManual
		if declared, ok := updates["asset_class_source"]; ok {
			if normalized := normalizeAssetClassSource(fmt.Sprint(declared)); normalized != "" {
				source = normalized
			}
		}
		if numericID, convErr := strconv.Atoi(fmt.Sprint(id)); convErr == nil {
			stampAssetClassSourceByID(numericID, source)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

func setAnalysisSecurityType(w http.ResponseWriter, r *http.Request) {
	type SecurityTypePayload struct {
		AnalysisID        *int64  `json:"analysis_id"`
		Name              string  `json:"name"`
		Ticker            *string `json:"ticker"`
		SecurityType      string  `json:"security_type"`
		PrimaryAssetClass *string `json:"primary_asset_class"`
	}

	var payload SecurityTypePayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	payload.Name = strings.TrimSpace(payload.Name)
	if payload.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	securityType := normalizeSecurityType(payload.SecurityType)
	if isNonAllocatingInstrumentName(payload.Name) {
		securityType = "CVR"
	}
	var rawTicker string
	if payload.Ticker != nil {
		ticker := strings.ToUpper(strings.TrimSpace(*payload.Ticker))
		if ticker != "" {
			rawTicker = ticker
			if strings.Contains(rawTicker, ":") {
				parts := strings.Split(rawTicker, ":")
				rawTicker = parts[len(parts)-1]
			}
		}
	}

	var primaryAssetClass interface{}
	if isNonAllocatingSecurityType(securityType) {
		primaryAssetClass = nil
	} else if payload.PrimaryAssetClass != nil {
		normalizedClass, ok := resolvePortfolioAssignmentClass(*payload.PrimaryAssetClass)
		if !ok {
			http.Error(w, fmt.Sprintf("invalid primary_asset_class %s", *payload.PrimaryAssetClass), http.StatusBadRequest)
			return
		}
		if normalizedClass != "" {
			primaryAssetClass = normalizedClass
		}
	}

	whereClause := "name = ?"
	whereArgs := []interface{}{payload.Name}
	if payload.AnalysisID != nil && *payload.AnalysisID > 0 {
		whereClause = "id = ?"
		whereArgs = []interface{}{*payload.AnalysisID}
	} else if rawTicker != "" {
		whereClause = fmt.Sprintf("(name = ? OR %s = ?)", stockAnalysisTickerKeySQL("ticker"))
		whereArgs = []interface{}{payload.Name, rawTicker}
	}

	query := fmt.Sprintf(`
		UPDATE stock_analysis
		SET security_type = ?,
			primary_asset_class = CASE WHEN ? IN ('CVR', 'NON_ALLOCATING') THEN NULL ELSE COALESCE(NULLIF(primary_asset_class, ''), ?) END,
			allocation = CASE WHEN ? IN ('CVR', 'NON_ALLOCATING') THEN 0 ELSE allocation END,
			include_in_sizing = CASE WHEN ? IN ('CVR', 'NON_ALLOCATING') THEN 0 ELSE include_in_sizing END,
			updated_at = CURRENT_TIMESTAMP
		WHERE %s
	`, whereClause)
	args := []interface{}{securityType, securityType, primaryAssetClass, securityType, securityType}
	args = append(args, whereArgs...)
	result, err := db.Exec(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		if payload.AnalysisID != nil && *payload.AnalysisID > 0 {
			http.Error(w, "analysis security not found", http.StatusNotFound)
			return
		}
		var tickerValue interface{}
		if payload.Ticker != nil && strings.TrimSpace(*payload.Ticker) != "" {
			tickerValue = strings.ToUpper(strings.TrimSpace(*payload.Ticker))
		}
		_, err = db.Exec(`
			INSERT INTO stock_analysis (ticker, name, primary_asset_class, security_type, include_in_sizing, updated_at)
			VALUES (?, ?, ?, ?, CASE WHEN ? IN ('CVR', 'NON_ALLOCATING') THEN 0 ELSE 1 END, CURRENT_TIMESTAMP)
			ON CONFLICT(ticker, name) DO UPDATE SET
				security_type = excluded.security_type,
				primary_asset_class = CASE WHEN excluded.security_type IN ('CVR', 'NON_ALLOCATING') THEN NULL ELSE COALESCE(NULLIF(stock_analysis.primary_asset_class, ''), excluded.primary_asset_class) END,
				allocation = CASE WHEN excluded.security_type IN ('CVR', 'NON_ALLOCATING') THEN 0 ELSE allocation END,
				include_in_sizing = CASE WHEN excluded.security_type IN ('CVR', 'NON_ALLOCATING') THEN 0 ELSE stock_analysis.include_in_sizing END,
				updated_at = CURRENT_TIMESTAMP
		`, tickerValue, payload.Name, primaryAssetClass, securityType, securityType)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":        "updated",
		"security_type": securityType,
	})
}

type assetClassClassifierRequest struct {
	CompanyName  string `json:"company_name"`
	Ticker       string `json:"ticker"`
	ExchangeCode string `json:"exchange_code"`
}

type assetClassClassifierResponse struct {
	AssetClass string  `json:"asset_class"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

func classifyAnalysisAssetClass(w http.ResponseWriter, r *http.Request) {
	var payload assetClassClassifierRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	payload.CompanyName = strings.TrimSpace(payload.CompanyName)
	if payload.CompanyName == "" {
		http.Error(w, "company_name is required", http.StatusBadRequest)
		return
	}

	allowed := make([]AssetClass, 0)
	for _, sleeve := range loadAssetClasses() {
		if !sleeve.Active || !sleeve.AllowGrouping || strings.EqualFold(sleeve.ClassType, "SYSTEM_BUCKET") {
			continue
		}
		allowed = append(allowed, sleeve)
	}
	if len(allowed) == 0 {
		http.Error(w, "no asset classes available", http.StatusInternalServerError)
		return
	}

	result, err := callGrokAssetClassClassifier(payload, allowed)
	if err != nil {
		log.Printf("[ASSET CLASS CLASSIFIER] %s: %v", payload.CompanyName, err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	resolved, ok := resolvePortfolioAssignmentClass(result.AssetClass)
	if !ok || resolved == "" || resolved == "UNASSIGNED" {
		http.Error(w, fmt.Sprintf("classifier returned invalid asset_class %q", result.AssetClass), http.StatusBadGateway)
		return
	}

	result.AssetClass = resolved
	if result.Confidence < 0 {
		result.Confidence = 0
	}
	if result.Confidence > 1 {
		result.Confidence = 1
	}
	result.Reason = strings.TrimSpace(result.Reason)
	if result.Reason == "" {
		result.Reason = "Classified from public company information."
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func callGrokAssetClassClassifier(payload assetClassClassifierRequest, allowed []AssetClass) (assetClassClassifierResponse, error) {
	apiKey := strings.TrimSpace(os.Getenv("XAI_API_KEY"))
	if apiKey == "" {
		return assetClassClassifierResponse{}, fmt.Errorf("XAI_API_KEY not configured")
	}

	model := strings.TrimSpace(os.Getenv("XAI_CLASSIFIER_MODEL"))
	if model == "" {
		model = "grok-4.3"
	}

	lines := make([]string, 0, len(allowed))
	for _, sleeve := range allowed {
		code := normalizePrimaryAssetClass(sleeve.Code)
		if code == "" {
			continue
		}
		label := strings.TrimSpace(sleeve.DisplayName)
		if label == "" {
			label = code
		}
		lines = append(lines, fmt.Sprintf("- %s: %s", code, label))
	}
	sort.Strings(lines)

	prompt := fmt.Sprintf(`Use web search to identify the primary economic driver for this listed security, then classify it into exactly one allowed asset class.

Company: %s
Ticker: %s
Exchange: %s

Allowed asset classes:
%s

Rules:
- Choose the asset class that best represents the company's primary economic driver.
- If the security is an ETF or fund, classify by the fund's main exposure.
- Do not invent a class.
- Return JSON only, with no markdown.

JSON shape:
{"asset_class":"CODE","confidence":0.0,"reason":"one sentence"}`,
		payload.CompanyName,
		strings.TrimSpace(payload.Ticker),
		strings.TrimSpace(payload.ExchangeCode),
		strings.Join(lines, "\n"),
	)

	reqBody := map[string]interface{}{
		"model": model,
		"input": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"tools": []map[string]string{
			{"type": "web_search"},
		},
		"store":             false,
		"max_output_tokens": 300,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return assetClassClassifierResponse{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.x.ai/v1/responses", bytes.NewReader(body))
	if err != nil {
		return assetClassClassifierResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return assetClassClassifierResponse{}, fmt.Errorf("xAI request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return assetClassClassifierResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return assetClassClassifierResponse{}, fmt.Errorf("xAI API error %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	text := extractXAIResponseText(raw)
	if text == "" {
		return assetClassClassifierResponse{}, fmt.Errorf("empty classifier response")
	}

	var result assetClassClassifierResponse
	if err := json.Unmarshal([]byte(cleanJSONText(text)), &result); err != nil {
		return assetClassClassifierResponse{}, fmt.Errorf("failed to parse classifier JSON: %w", err)
	}
	return result, nil
}

func extractXAIResponseText(raw []byte) string {
	var decoded struct {
		Output []struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return ""
	}
	for _, output := range decoded.Output {
		for _, content := range output.Content {
			if content.Type == "output_text" && strings.TrimSpace(content.Text) != "" {
				return strings.TrimSpace(content.Text)
			}
		}
	}
	return ""
}

func cleanJSONText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	return strings.TrimSpace(text)
}

func deleteAnalysis(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	result, err := db.Exec(`DELETE FROM stock_analysis WHERE id = ?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Analysis not found", http.StatusNotFound)
		return
	}

	log.Printf("[ANALYSIS] Deleted analysis entry %s", id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// logContribution manually records a contribution date for a security
func logContribution(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	_, err := db.Exec(`UPDATE stock_analysis SET last_contributed_at = CURRENT_TIMESTAMP WHERE id = ?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("[DCA] Manually logged contribution for analysis id %s", id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// contributeByName upserts a minimal stock_analysis row by name+ticker and logs a contribution.
// Used for held stocks that don't yet have a stock_analysis entry.
func contributeByName(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   string `json:"name"`
		Ticker string `json:"ticker"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	// Upsert a minimal row, then set last_contributed_at
	result, err := db.Exec(`
		INSERT INTO stock_analysis (name, ticker, last_contributed_at, updated_at, created_at)
		VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT(ticker, name) DO UPDATE SET last_contributed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
	`, req.Name, req.Ticker)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Get the id (either newly inserted or existing via last_insert_rowid trick)
	id, _ := result.LastInsertId()
	if id == 0 {
		// Row already existed — fetch its id
		db.QueryRow(`SELECT id FROM stock_analysis WHERE name = ?`, req.Name).Scan(&id)
	}

	log.Printf("[DCA] contributeByName: logged contribution for %q (id=%d)", req.Name, id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "id": id})
}

// renameAnalysis renames the company name for a watchlist entry and cascades to dependent tables
func renameAnalysis(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var payload struct {
		NewName string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(payload.NewName) == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "failed to start rename transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Get the current row so we can validate and cascade safely.
	var oldName string
	var ticker sql.NullString
	var existingSecurityID sql.NullInt64
	err = tx.QueryRow(`SELECT name, ticker, security_id FROM stock_analysis WHERE id = ?`, id).Scan(&oldName, &ticker, &existingSecurityID)
	if err != nil {
		http.Error(w, "Analysis not found", http.StatusNotFound)
		return
	}

	newName := strings.TrimSpace(payload.NewName)
	if newName == oldName {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "renamed", "name": newName})
		return
	}

	// Prevent silent UNIQUE(ticker, name) collisions from becoming a generic 500.
	var duplicateID int
	dupErr := tx.QueryRow(`
		SELECT id
		FROM stock_analysis
		WHERE COALESCE(ticker, '') = COALESCE(?, '') AND name = ? AND id != ?
		LIMIT 1
	`, ticker, newName, id).Scan(&duplicateID)
	if dupErr == nil {
		http.Error(w, "another analysis row already uses that ticker/name combination", http.StatusConflict)
		return
	}
	if dupErr != sql.ErrNoRows {
		log.Printf("[ANALYSIS] rename duplicate check failed for id=%s: %v", id, dupErr)
		http.Error(w, "failed to validate rename", http.StatusInternalServerError)
		return
	}

	securityID, err := ensureSecurityIdentityTx(tx, securityIdentityCandidate{
		Ticker: ticker.String,
		Name:   newName,
	}, "analysis_rename", false)
	if err != nil {
		log.Printf("[ANALYSIS] rename identity resolution failed for id=%s: %v", id, err)
		http.Error(w, "failed to preserve security identity", http.StatusInternalServerError)
		return
	}
	if existingSecurityID.Valid && existingSecurityID.Int64 != securityID {
		log.Printf("[ANALYSIS] rename identity mismatch for id=%s: stored=%d resolved=%d", id, existingSecurityID.Int64, securityID)
		http.Error(w, "failed to preserve security identity", http.StatusConflict)
		return
	}
	if err := addSecurityNameAliasTx(tx, securityID, oldName, "analysis_rename"); err != nil {
		log.Printf("[ANALYSIS] rename old-name alias failed for id=%s: %v", id, err)
		http.Error(w, "failed to preserve security identity", http.StatusInternalServerError)
		return
	}

	// Update only the analysis display name. Broker holdings retain their imported name.
	if _, err := tx.Exec(`UPDATE stock_analysis SET name = ?, security_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, newName, securityID, id); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint failed") {
			http.Error(w, "another analysis row already uses that ticker/name combination", http.StatusConflict)
			return
		}
		log.Printf("[ANALYSIS] rename update failed for id=%s: %v", id, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// A manual rename changes analysis presentation only. Do not mutate holdings or
	// company_mappings; retain the group assignment under the stable identity.
	var groupID string
	groupErr := tx.QueryRow(`
		SELECT group_id
		FROM stock_group_assignments
		WHERE security_id = ? OR company_name = ?
		ORDER BY CASE WHEN security_id = ? THEN 0 ELSE 1 END
		LIMIT 1
	`, securityID, oldName, securityID).Scan(&groupID)
	if groupErr != nil && groupErr != sql.ErrNoRows {
		log.Printf("[ANALYSIS] rename group lookup failed for id=%s: %v", id, groupErr)
		http.Error(w, "failed to update group assignment", http.StatusInternalServerError)
		return
	}
	if groupErr == nil {
		if _, err := tx.Exec(`
			INSERT INTO stock_group_assignments (company_name, group_id, security_id, assigned_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(company_name) DO UPDATE SET
				group_id = excluded.group_id,
				security_id = excluded.security_id,
				assigned_at = CURRENT_TIMESTAMP
		`, newName, groupID, securityID); err != nil {
			log.Printf("[ANALYSIS] rename upsert to stock_group_assignments failed for id=%s: %v", id, err)
			http.Error(w, "failed to update group assignment", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`DELETE FROM stock_group_assignments WHERE company_name = ?`, oldName); err != nil {
			log.Printf("[ANALYSIS] rename cleanup of old stock_group_assignments failed for id=%s: %v", id, err)
			http.Error(w, "failed to update group assignment", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[ANALYSIS] rename commit failed for id=%s: %v", id, err)
		http.Error(w, "failed to commit rename", http.StatusInternalServerError)
		return
	}

	log.Printf("[ANALYSIS] Renamed '%s' -> '%s' (id: %s)", oldName, newName, id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "renamed", "name": newName})
}

// fetchYahooPrice fetches the current price for a ticker from Yahoo Finance
func yahooSymbolForTicker(ticker string, exchangePrefix string) string {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	exchangePrefix = strings.ToUpper(strings.TrimSpace(exchangePrefix))
	switch exchangePrefix {
	case "ASX:":
		return ticker + ".AX"
	case "NASDAQ:", "NYSE:", "AMEX:", "NYSEARCA:", "NYSEAMERICAN:", "BATS:":
		return ticker
	case "LSE:":
		return ticker + ".L"
	case "TSX:":
		return ticker + ".TO"
	case "TSXV:":
		return ticker + ".V"
	case "NZX:":
		return ticker + ".NZ"
	case "HKEX:", "HK:":
		return ticker + ".HK"
	case "SGX:":
		return ticker + ".SI"
	case "XETRA:", "FRA:":
		return ticker + ".DE"
	case "EPA:":
		return ticker + ".PA"
	case "TSE:":
		return ticker + ".T"
	case "KRX:":
		return ticker + ".KS"
	case "SSE:":
		return ticker + ".SS"
	case "SZSE:":
		return ticker + ".SZ"
	default:
		return ticker
	}
}

func refreshWatchlistPricesInternal() watchlistPriceRefreshResult {
	result := watchlistPriceRefreshResult{Errors: make([]string, 0)}

	// Get all analysis entries with tickers (watchlist items)
	rows, err := db.Query(`
		SELECT id, ticker, name
		FROM stock_analysis
		WHERE ticker IS NOT NULL
		  AND ticker != ''
		  AND (COALESCE(is_watchlist, 0) = 1 OR COALESCE(is_external, 0) = 1)
	`)
	if err != nil {
		result.Errors = append(result.Errors, err.Error())
		return result
	}

	// Collect all items first to avoid holding the rows cursor open during updates
	type watchlistItem struct {
		id     int
		ticker string
		name   string
	}
	var items []watchlistItem

	for rows.Next() {
		var item watchlistItem
		if err := rows.Scan(&item.id, &item.ticker, &item.name); err != nil {
			continue
		}
		items = append(items, item)
	}
	rows.Close() // Close rows before doing updates

	for _, item := range items {
		// Parse ticker to get exchange prefix
		exchangePrefix := "ASX:"
		tickerSymbol := item.ticker
		if colonIdx := strings.Index(item.ticker, ":"); colonIdx != -1 {
			exchangePrefix = item.ticker[:colonIdx+1]
			tickerSymbol = item.ticker[colonIdx+1:]
		}

		// Yahoo is an advisory quote/listing source. A failed observation never
		// changes the security; it only records evidence for a later review.
		snapshot, err := watchlistListingSnapshotFetcher(tickerSymbol, exchangePrefix)
		if err != nil {
			createdReview, recordErr := recordWatchlistListingFailure(item.id, item.ticker, item.name, err)
			if recordErr != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: failed to record listing observation: %v", item.ticker, recordErr))
			}
			if createdReview {
				result.NewReviews++
			}
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", item.ticker, err))
			log.Printf("[WATCHLIST] Failed to fetch price for %s: %v", item.ticker, err)
			continue
		}
		if snapshot.Price <= 0 {
			err := fmt.Errorf("no valid price data for %s", item.ticker)
			createdReview, recordErr := recordWatchlistListingFailure(item.id, item.ticker, item.name, err)
			if recordErr != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: failed to record listing observation: %v", item.ticker, recordErr))
			}
			if createdReview {
				result.NewReviews++
			}
			result.Errors = append(result.Errors, err.Error())
			continue
		}

		if snapshot.Provider == "" {
			snapshot.Provider = listingProviderYahoo
		}
		createdReview, recordErr := recordWatchlistListingSuccess(item.id, item.ticker, item.name, snapshot)
		if recordErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: failed to record listing observation: %v", item.ticker, recordErr))
			continue
		}
		if createdReview {
			result.NewReviews++
		}

		// Update the price in the database
		_, updateErr := db.Exec(`UPDATE stock_analysis SET current_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, snapshot.Price, item.id)
		if updateErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: db update failed: %v", item.ticker, updateErr))
			log.Printf("[WATCHLIST] DB update failed for %s: %v", item.ticker, updateErr)
			continue
		}

		log.Printf("[WATCHLIST] Updated price for %s: %.4f", item.ticker, snapshot.Price)
		result.Updated++
	}

	openReviews, err := countOpenListingReviews()
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("failed to count listing reviews: %v", err))
		return result
	}
	result.OpenReviews = openReviews
	return result
}

// refreshWatchlistPrices fetches current prices for all watchlist items
func refreshWatchlistPrices(w http.ResponseWriter, r *http.Request) {
	runID, ok := beginManualDataRefresh(w, r, dataRefreshListingVerification)
	if !ok {
		return
	}
	result := refreshWatchlistPricesInternal()
	var expected int
	_ = db.QueryRowContext(r.Context(), `
		SELECT COUNT(*) FROM stock_analysis
		WHERE ticker IS NOT NULL AND TRIM(ticker) <> ''
		  AND (COALESCE(is_watchlist, 0) = 1 OR COALESCE(is_external, 0) = 1)
	`).Scan(&expected)
	freshThrough := time.Now().UTC().Format("2006-01-02")
	execution := dataRefreshExecutionResult{
		DataFreshThrough: &freshThrough,
		ExpectedCount:    expected,
		UpdatedCount:     result.Updated,
		Errors:           append([]string{}, result.Errors...),
		Message:          fmt.Sprintf("open reviews %d; new reviews %d", result.OpenReviews, result.NewReviews),
	}
	if !finishManualDataRefresh(w, r, runID, execution) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}
