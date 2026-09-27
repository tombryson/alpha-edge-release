package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"trading-backend/internal/staticdata"
)

type TickerReturns struct {
	Ticker  string             `json:"ticker"`
	Label   string             `json:"label"`
	Returns map[string]float64 `json:"returns"`
}

type AssetClassReturns struct {
	AssetClass string          `json:"asset_class"`
	Tickers    []TickerReturns `json:"tickers"`
}

type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Close []*float64 `json:"close"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
		Error *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

func fetchYahooReturns(ctx context.Context, ticker string) (map[string]float64, string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	url := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=4y",
		ticker,
	)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, "", fmt.Errorf("Yahoo returned HTTP %d for %s", resp.StatusCode, ticker)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	var parsed yahooChartResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, "", err
	}
	if parsed.Chart.Error != nil {
		return nil, "", fmt.Errorf("Yahoo %s: %s", parsed.Chart.Error.Code, parsed.Chart.Error.Description)
	}
	if len(parsed.Chart.Result) == 0 {
		return nil, "", fmt.Errorf("no data for %s", ticker)
	}

	result := parsed.Chart.Result[0]
	timestamps := result.Timestamp
	if len(result.Indicators.Quote) == 0 {
		return nil, "", fmt.Errorf("missing quote series for %s", ticker)
	}
	closes := result.Indicators.Quote[0].Close
	pointCount := len(timestamps)
	if len(closes) < pointCount {
		pointCount = len(closes)
	}
	if pointCount == 0 {
		return nil, "", fmt.Errorf("empty data for %s", ticker)
	}

	// Find the last non-nil close as current price
	var currentPrice float64
	var currentIdx int
	for i := pointCount - 1; i >= 0; i-- {
		if closes[i] != nil {
			currentPrice = *closes[i]
			currentIdx = i
			break
		}
	}
	if currentPrice == 0 {
		return nil, "", fmt.Errorf("no valid close price for %s", ticker)
	}
	currentTime := time.Unix(timestamps[currentIdx], 0)

	// Target offsets
	periods := map[string]time.Duration{
		"1M": 30 * 24 * time.Hour,
		"3M": 91 * 24 * time.Hour,
		"6M": 182 * 24 * time.Hour,
		"1Y": 365 * 24 * time.Hour,
		"3Y": 3 * 365 * 24 * time.Hour,
	}

	returns := make(map[string]float64)
	for label, offset := range periods {
		// Find closest timestamp to target
		bestIdx := -1
		bestDiff := time.Duration(1<<63 - 1)
		for i := 0; i < pointCount; i++ {
			if closes[i] == nil {
				continue
			}
			diff := currentTime.Sub(time.Unix(timestamps[i], 0)) - offset
			if diff < 0 {
				diff = -diff
			}
			if diff < bestDiff {
				bestDiff = diff
				bestIdx = i
			}
		}
		if bestIdx >= 0 && closes[bestIdx] != nil && *closes[bestIdx] != 0 {
			ret := (currentPrice - *closes[bestIdx]) / *closes[bestIdx] * 100
			returns[label] = math.Round(ret*100) / 100
		}
	}
	return returns, currentTime.UTC().Format("2006-01-02"), nil
}

var regimeReturnsFetcher = fetchYahooReturns

type regimeReturnsRefreshResult struct {
	ExpectedTickers  int      `json:"expected_tickers"`
	UpdatedTickers   int      `json:"updated_tickers"`
	DataFreshThrough *string  `json:"data_fresh_through,omitempty"`
	Errors           []string `json:"errors"`
}

func buildReturnsData(ctx context.Context) ([]AssetClassReturns, regimeReturnsRefreshResult) {
	var result []AssetClassReturns
	diagnostics := regimeReturnsRefreshResult{Errors: []string{}}
	for _, ac := range staticdata.RegimeReturnAssetClassOrder {
		tickers, ok := staticdata.RegimeReturnTickers[ac]
		if !ok {
			continue
		}
		var tickerResults []TickerReturns
		for _, ticker := range tickers {
			diagnostics.ExpectedTickers++
			rets, freshThrough, err := regimeReturnsFetcher(ctx, ticker)
			if err != nil {
				log.Printf("[RETURNS] Failed to fetch %s: %v", ticker, err)
				diagnostics.Errors = append(diagnostics.Errors, fmt.Sprintf("%s: %v", ticker, err))
				tickerResults = append(tickerResults, TickerReturns{
					Ticker:  ticker,
					Label:   staticdata.RegimeReturnLabels[ticker],
					Returns: map[string]float64{},
				})
				continue
			}
			diagnostics.UpdatedTickers++
			if freshThrough != "" && (diagnostics.DataFreshThrough == nil || freshThrough < *diagnostics.DataFreshThrough) {
				value := freshThrough
				diagnostics.DataFreshThrough = &value
			}
			tickerResults = append(tickerResults, TickerReturns{
				Ticker:  ticker,
				Label:   staticdata.RegimeReturnLabels[ticker],
				Returns: rets,
			})
		}
		result = append(result, AssetClassReturns{AssetClass: ac, Tickers: tickerResults})
	}
	return result, diagnostics
}

func refreshRegimeReturns(ctx context.Context) (regimeReturnsRefreshResult, error) {
	data, diagnostics := buildReturnsData(ctx)
	if diagnostics.UpdatedTickers == 0 && diagnostics.ExpectedTickers > 0 {
		return diagnostics, fmt.Errorf("no regime return series could be refreshed")
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return diagnostics, err
	}
	errorsPayload, _ := json.Marshal(diagnostics.Errors)
	_, err = db.ExecContext(ctx, `
		INSERT INTO regime_return_snapshots (
			data_json, data_fresh_through, expected_tickers, updated_tickers,
			error_count, errors_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, string(payload), diagnostics.DataFreshThrough, diagnostics.ExpectedTickers,
		diagnostics.UpdatedTickers, len(diagnostics.Errors), string(errorsPayload))
	return diagnostics, err
}

func refreshRegimeReturnsHandler(w http.ResponseWriter, r *http.Request) {
	runID, ok := beginManualDataRefresh(w, r, dataRefreshRegimeReturns)
	if !ok {
		return
	}
	result, err := refreshRegimeReturns(r.Context())
	if !finishManualDataRefresh(w, r, runID, regimeReturnsExecutionFromResult(result, err)) {
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func getRegimeReturns(w http.ResponseWriter, r *http.Request) {
	var payload string
	var freshThrough sql.NullString
	err := db.QueryRowContext(r.Context(), `
		SELECT data_json, data_fresh_through
		FROM regime_return_snapshots
		ORDER BY id DESC
		LIMIT 1
	`).Scan(&payload, &freshThrough)
	if err == sql.ErrNoRows {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Data-Freshness-Status", "NEVER_RUN")
		_ = json.NewEncoder(w).Encode([]AssetClassReturns{})
		return
	}
	if err != nil {
		http.Error(w, "Failed to load persisted regime returns", http.StatusInternalServerError)
		return
	}
	var data []AssetClassReturns
	if err := json.Unmarshal([]byte(payload), &data); err != nil {
		http.Error(w, "Persisted regime returns are invalid", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if freshThrough.Valid {
		w.Header().Set("X-Data-Fresh-Through", freshThrough.String)
	}
	_ = json.NewEncoder(w).Encode(data)
}

func getRegimes(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, ticker, signal, last_updated, created_at
		FROM regimes
		ORDER BY ticker
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var regimes []Regime
	for rows.Next() {
		var regime Regime
		err := rows.Scan(&regime.ID, &regime.Ticker, &regime.Signal, &regime.LastUpdated, &regime.CreatedAt)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		regimes = append(regimes, regime)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(regimes)
}

// GET /api/regimes/status - Get regime status with computed asset classes
func getRegimeStatus(w http.ResponseWriter, r *http.Request) {
	// Get all raw regimes
	rows, err := db.QueryContext(r.Context(), `
		SELECT ticker, signal, last_updated
		FROM regimes
		ORDER BY ticker
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rawRegimes := make(map[string]interface{})
	signalByTicker := make(map[string]string)
	for rows.Next() {
		var ticker, signal, lastUpdated string
		if err := rows.Scan(&ticker, &signal, &lastUpdated); err != nil {
			rows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		signalByTicker[ticker] = signal
		rawRegimes[ticker] = map[string]string{
			"signal":       signal,
			"last_updated": lastUpdated,
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	rows.Close()

	regimeSignal := func(ticker string) string {
		if signal, ok := signalByTicker[ticker]; ok {
			return signal
		}
		return "DISCONNECTED"
	}
	assetClassSignal := func(assetClass string) string {
		switch assetClass {
		case "EQUITY":
			spy := regimeSignal("SPY")
			if spy == "DISCONNECTED" {
				spy = regimeSignal("SPX")
			}
			xao := regimeSignal("XAO")
			if spy == "DISCONNECTED" && xao == "DISCONNECTED" {
				return "DISCONNECTED"
			}
			if spy == "SELL" || xao == "SELL" {
				return "SELL"
			}
			return "BUY"
		case "ENERGY":
			return regimeSignal("XLE")
		case "BASEMETALS":
			copper := regimeSignal("COPPER")
			if copper == "SELL" {
				return "SELL"
			}
			return copper
		case "REE":
			return regimeSignal("REMX")
		case "FINANCIALS":
			return regimeSignal("XLF")
		case "HEALTHCARE":
			return regimeSignal("XLV")
		default:
			return regimeSignal(assetClass)
		}
	}

	assetClasses := make(map[string]string, len(staticdata.RegimeStatusAssetClasses))
	for _, assetClass := range staticdata.RegimeStatusAssetClasses {
		assetClasses[assetClass] = assetClassSignal(assetClass)
	}

	// Overall status is determined by EQUITY signal only.
	// Commodity asset classes affect per-security position sizing but not the system-wide status.
	status := "DISCONNECTED"
	equitySignal := assetClassSignal("EQUITY")
	if equitySignal == "BUY" {
		status = "NORMAL"
	} else if equitySignal == "SELL" {
		status = "WARNING"
	}

	// Equity sizing state
	sizingRows, err := db.QueryContext(r.Context(), `SELECT source_ticker, target_equity_pct, last_updated FROM equity_sizing ORDER BY source_ticker`)
	equitySources := map[string]interface{}{}
	if err == nil && sizingRows != nil {
		for sizingRows.Next() {
			var src, upd string
			var pct float64
			if err := sizingRows.Scan(&src, &pct, &upd); err != nil {
				sizingRows.Close()
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			equitySources[src] = map[string]interface{}{
				"target_equity_pct": pct,
				"last_updated":      upd,
			}
		}
		if err := sizingRows.Err(); err != nil {
			sizingRows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		sizingRows.Close()
	}
	_, _, effectivePct, _, _, eqErr := getEffectiveEquityState(r.Context())
	if eqErr != nil {
		http.Error(w, eqErr.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":        status,
		"raw_regimes":   rawRegimes,
		"asset_classes": assetClasses,
		"equity_sizing": map[string]interface{}{
			"effective_pct": effectivePct,
			"sources":       equitySources,
		},
	})
}

// POST /api/webhook/regime - Update regime signal from TradingView
// ═══════════════════════════════════════════════════════════
// ASSET CLASS LOGIC
// ═══════════════════════════════════════════════════════════

// Get raw regime signal from database
func getRegimeSignal(ticker string) string {
	var signal string
	err := db.QueryRow(`SELECT signal FROM regimes WHERE ticker = ?`, ticker).Scan(&signal)
	if err != nil {
		return "DISCONNECTED" // No signal received yet - DO NOT assume BUY
	}
	return signal
}

// Get computed asset class signal
func GetAssetClassSignal(assetClass string) string {
	switch assetClass {
	case "EQUITY":
		// Check both SPY and SPX (index vs ETF - scripts may use either)
		spy := getRegimeSignal("SPY")
		if spy == "DISCONNECTED" {
			spy = getRegimeSignal("SPX")
		}
		xao := getRegimeSignal("XAO")

		// If both disconnected, EQUITY is disconnected
		if spy == "DISCONNECTED" && xao == "DISCONNECTED" {
			return "DISCONNECTED"
		}
		// min() logic: if EITHER connected signal is SELL, EQUITY is SELL
		if spy == "SELL" || xao == "SELL" {
			return "SELL"
		}
		return "BUY"

	case "GOLD":
		return getRegimeSignal("GOLD")

	case "SILVER":
		return getRegimeSignal("SILVER")

	case "COPPER":
		return getRegimeSignal("COPPER")

	case "ENERGY":
		return getRegimeSignal("XLE") // Energy Select Sector SPDR

	case "URANIUM":
		return getRegimeSignal("URANIUM")

	case "MATERIALS":
		return getRegimeSignal("XLB") // Materials Select Sector SPDR

	case "FINANCIALS":
		return getRegimeSignal("XLF") // Financial Select Sector SPDR

	case "HEALTHCARE":
		return getRegimeSignal("XLV") // Health Care Select Sector SPDR

	case "IRON":
		return getRegimeSignal("IRON") // Futures

	case "ALUMINIUM":
		return getRegimeSignal("ALUMINIUM") // Futures

	// Asset classes that map to other regimes
	case "BASEMETALS":
		return getRegimeSignal("COPPER") // Copper is the bellwether for base metals

	case "PHARMA":
		return getRegimeSignal("XLV") // Pharma is subset of healthcare

	case "REE":
		return getRegimeSignal("REMX") // Rare Earth ETF

	// ETF is a label for security type, not a regime - no signal tracking
	case "ETF":
		return "N/A"

	default:
		return "DISCONNECTED" // Unknown asset class - no signal
	}
}

func getAffectedAssetClassesForRegime(regimeTicker string) []string {
	regimeTicker = strings.ToUpper(strings.TrimSpace(regimeTicker))

	// Map incoming controller tickers onto the asset-class/controller model used by the app.
	// Some controllers fan out to multiple asset classes because several sleeves share the same driver.
	assetClasses, ok := staticdata.AffectedAssetClassesByRegimeTicker[regimeTicker]
	if !ok {
		assetClasses = []string{regimeTicker}
	}

	seen := make(map[string]struct{}, len(assetClasses))
	unique := make([]string, 0, len(assetClasses))
	for _, assetClass := range assetClasses {
		assetClass = strings.TrimSpace(assetClass)
		if assetClass == "" {
			continue
		}
		if _, exists := seen[assetClass]; exists {
			continue
		}
		seen[assetClass] = struct{}{}
		unique = append(unique, assetClass)
	}

	return unique
}

type securityRegimeProfile struct {
	Ticker       string
	SecurityType string
	AssetClass   string
	Controllers  []string
}

func getRegimeControllersForAssetClass(assetClass string) []string {
	normalized := normalizePrimaryAssetClass(assetClass)
	if _, controllerless := staticdata.RegimeControllerlessAssetClasses[normalized]; controllerless {
		return nil
	}
	if controllers, ok := staticdata.RegimeControllersByAssetClass[normalized]; ok {
		return append([]string(nil), controllers...)
	}
	return []string{"EQUITY"}
}

func normalizeControllerList(candidates []string) []string {
	seen := map[string]struct{}{}
	unique := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		normalized := normalizePrimaryAssetClass(candidate)
		if normalized == "" || normalized == "UNASSIGNED" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		unique = append(unique, normalized)
	}
	return unique
}

func controllersIntersect(controllers []string, affected map[string]struct{}) bool {
	for _, controller := range controllers {
		if _, exists := affected[controller]; exists {
			return true
		}
	}
	return false
}

func getPositionTargetForControllers(controllers []string) (int, string, []string) {
	normalizedControllers := normalizeControllerList(controllers)
	if len(normalizedControllers) == 0 {
		return 100, "HOLD - No regime control", nil
	}

	sellCount := 0
	sellControllers := make([]string, 0, len(normalizedControllers))
	for _, controller := range normalizedControllers {
		if GetAssetClassSignal(controller) == "SELL" {
			sellCount++
			sellControllers = append(sellControllers, controller)
		}
	}

	if sellCount == 0 {
		return 100, "HOLD - All controllers BUY", nil
	}
	if sellCount == len(normalizedControllers) {
		return 0, fmt.Sprintf("EXIT - Controllers in SELL: %s", strings.Join(sellControllers, ", ")), sellControllers
	}
	return 50, fmt.Sprintf("REDUCE 50%% - Controllers in SELL: %s", strings.Join(sellControllers, ", ")), sellControllers
}

func getETFAssetClass(ticker string) string {
	canonicalTicker := canonicalSecurityTickerKey(ticker)
	if canonicalTicker == "" {
		return ""
	}
	var assetClass string
	err := db.QueryRow(`
		SELECT COALESCE(primary_asset_class, '')
		FROM stock_analysis
		WHERE UPPER(TRIM(COALESCE(ticker, ''))) = ?
		  AND UPPER(COALESCE(security_type, '')) = 'ETF'
		  AND TRIM(COALESCE(primary_asset_class, '')) != ''
		ORDER BY updated_at DESC, id DESC
		LIMIT 1
	`, canonicalTicker).Scan(&assetClass)
	if err != nil {
		return ""
	}
	return normalizePrimaryAssetClass(assetClass)
}

func loadSecurityRegimeProfiles() []securityRegimeProfile {
	groupDerivedByCompany := loadGroupDerivedAssetClasses(context.Background())
	rows, err := db.Query(`SELECT COALESCE(ticker, ''), name, COALESCE(primary_asset_class, ''), COALESCE(security_type, '') FROM stock_analysis ORDER BY id`)
	if err != nil {
		log.Printf("[REGIME] Failed to load stock analysis rows for asset-class regime profiles: %v", err)
		return nil
	}

	profilesByTicker := make(map[string]securityRegimeProfile)
	for rows.Next() {
		var ticker, name, primaryAssetClass, securityType string
		if err := rows.Scan(&ticker, &name, &primaryAssetClass, &securityType); err != nil {
			log.Printf("[REGIME] Failed to scan stock analysis row for regime profiles: %v", err)
			rows.Close()
			return nil
		}
		if isNonAllocatingSecurityType(securityType) || isNonAllocatingInstrumentName(name) {
			continue
		}

		canonicalTicker := canonicalSecurityTickerKey(ticker)
		if canonicalTicker == "" {
			continue
		}

		groupAssetClass := groupDerivedByCompany[strings.TrimSpace(name)]
		if groupAssetClass == "" {
			groupAssetClass = groupDerivedByCompany[canonicalCompanyNameKey(name)]
		}

		assetClass := resolveAuthoritativeAssetClass(
			groupAssetClass,
			primaryAssetClass,
			canonicalTicker,
			name,
		)
		controllers := getRegimeControllersForAssetClass(assetClass)
		if len(controllers) == 0 {
			continue
		}

		profilesByTicker[canonicalTicker] = securityRegimeProfile{
			Ticker:       canonicalTicker,
			SecurityType: "STOCK",
			AssetClass:   assetClass,
			Controllers:  controllers,
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[REGIME] Failed while reading stock analysis rows for regime profiles: %v", err)
		rows.Close()
		return nil
	}
	rows.Close()

	etfRows, err := db.Query(`SELECT ticker FROM etf_allocations ORDER BY ticker`)
	if err != nil {
		log.Printf("[REGIME] Failed to load ETF allocation rows for regime profiles: %v", err)
	} else {
		defer etfRows.Close()
		for etfRows.Next() {
			var ticker string
			if err := etfRows.Scan(&ticker); err != nil {
				log.Printf("[REGIME] Failed to scan ETF allocation row for regime profiles: %v", err)
				return nil
			}
			canonicalTicker := canonicalSecurityTickerKey(ticker)
			if canonicalTicker == "" {
				continue
			}
			if _, exists := profilesByTicker[canonicalTicker]; exists {
				continue
			}
			assetClass := getETFAssetClass(canonicalTicker)
			controllers := getRegimeControllersForAssetClass(assetClass)
			if len(controllers) == 0 {
				continue
			}
			profilesByTicker[canonicalTicker] = securityRegimeProfile{
				Ticker:       canonicalTicker,
				SecurityType: "ETF",
				AssetClass:   assetClass,
				Controllers:  controllers,
			}
		}
	}

	return sortSecurityRegimeProfiles(profilesByTicker)
}

func sortSecurityRegimeProfiles(profilesByTicker map[string]securityRegimeProfile) []securityRegimeProfile {
	profiles := make([]securityRegimeProfile, 0, len(profilesByTicker))
	for _, profile := range profilesByTicker {
		profiles = append(profiles, profile)
	}

	sort.Slice(profiles, func(i, j int) bool {
		if profiles[i].SecurityType != profiles[j].SecurityType {
			return profiles[i].SecurityType < profiles[j].SecurityType
		}
		return profiles[i].Ticker < profiles[j].Ticker
	})

	return profiles
}

// ═══════════════════════════════════════════════════════════
// REGIME WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════

func regimeWebhook(w http.ResponseWriter, r *http.Request) {
	acknowledgeAndProcessWebhook(w, r, "regime")
}

func regimeWebhookSync(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Ticker          string  `json:"ticker"`
		Signal          string  `json:"signal"`
		Script          string  `json:"script"`
		TargetEquityPct float64 `json:"target_equity_pct"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Normalize ticker: strip exchange prefix (SP:SPX → SPX, ASX:XAO → XAO)
	regimeTicker := payload.Ticker
	if idx := strings.LastIndex(regimeTicker, ":"); idx >= 0 {
		regimeTicker = regimeTicker[idx+1:]
	}

	signalUpper := strings.ToUpper(payload.Signal)

	// Dispatch to position sizing handler (connect or update)
	payload.Script = normalizeAlertScript(payload.Script)

	if scriptMatches(payload.Script, "q3d") {
		handlePositionSizingSignal(w, regimeTicker, payload.TargetEquityPct, payload.Ticker)
		return
	}

	if scriptMatches(payload.Script, "q4d") {
		if signalUpper != "BUY" && signalUpper != "SELL" {
			http.Error(w, "Q4D signal must be BUY or SELL", http.StatusBadRequest)
			return
		}
		action, actionErr := handleQ4DOverlaySignal(signalUpper, payload.Ticker)
		if actionErr != nil {
			log.Printf("[Q4D ERROR] Failed to sync Q4D overlay action for %s %s: %v", payload.Ticker, signalUpper, actionErr)
			http.Error(w, actionErr.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":           "success",
			"regime":           regimeTicker,
			"signal":           signalUpper,
			"portfolio_action": action,
		})
		return
	}

	// Handle connection signals (alert registration + set initial state if provided)
	if signalUpper == "CONNECT" {
		script := payload.Script
		if script == "" {
			script = "q4d" // Default market-stress detector
		}
		handleConnectionSignal(w, payload.Ticker, script, nil)
		return
	}

	// Validate signal
	if signalUpper != "BUY" && signalUpper != "SELL" {
		http.Error(w, "Signal must be BUY or SELL", http.StatusBadRequest)
		return
	}

	// Also register connection when receiving buy/sell (script is active if it's sending signals)
	if payload.Script != "" {
		go func() {
			handleConnectionSignal(nil, payload.Ticker, payload.Script, nil)
		}()
	}

	// Update regime using normalized ticker
	_, err := db.Exec(`
		INSERT INTO regimes (ticker, signal)
		VALUES (?, ?)
		ON CONFLICT(ticker) DO UPDATE SET
			signal = excluded.signal,
			last_updated = CURRENT_TIMESTAMP
	`, regimeTicker, signalUpper)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		log.Printf("[REGIME ERROR] Failed to update regime: %v", err)
		return
	}

	log.Printf("[REGIME] %s (raw: %s) → %s", regimeTicker, payload.Ticker, signalUpper)

	// Compute impacts (pure — no position writes). Persist as proposed
	// actions so the user can review and confirm before anything changes.
	proposed, computeErr := computeRegimeImpacts(regimeTicker)
	if computeErr != nil {
		log.Printf("[REGIME ERROR] Failed to compute regime impacts: %v", computeErr)
		http.Error(w, computeErr.Error(), http.StatusInternalServerError)
		return
	}
	if persistErr := persistRegimeProposedActions(regimeTicker, signalUpper, proposed); persistErr != nil {
		log.Printf("[REGIME ERROR] Failed to persist proposed actions: %v", persistErr)
		http.Error(w, persistErr.Error(), http.StatusInternalServerError)
		return
	}

	// Create an alert for this regime change
	createRegimeAlert(regimeTicker, signalUpper, proposed)

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"status":           "success",
		"regime":           regimeTicker,
		"signal":           signalUpper,
		"proposed_actions": proposed,
	}
	json.NewEncoder(w).Encode(response)
}

// computeRegimeImpacts returns what a regime change would do to affected
// securities. Pure function — no database writes. The caller is responsible
// for persisting the results and presenting them to the user for confirmation.
func computeRegimeImpacts(regimeTicker string) ([]RegimeImpact, error) {
	affectedAssetClasses := getAffectedAssetClassesForRegime(regimeTicker)
	if len(affectedAssetClasses) == 0 {
		log.Printf("[REGIME WARN] No affected asset classes resolved for %s", regimeTicker)
		return nil, nil
	}

	affectedSet := make(map[string]struct{}, len(affectedAssetClasses))
	for _, assetClass := range affectedAssetClasses {
		affectedSet[normalizePrimaryAssetClass(assetClass)] = struct{}{}
	}

	profiles := loadSecurityRegimeProfiles()
	if len(profiles) == 0 {
		return nil, nil
	}

	var impacts []RegimeImpact
	for _, profile := range profiles {
		if !controllersIntersect(profile.Controllers, affectedSet) {
			continue
		}
		targetPct, action, sellAssets := getPositionTargetForControllers(profile.Controllers)
		impacts = append(impacts, RegimeImpact{
			Ticker:            profile.Ticker,
			Type:              profile.SecurityType,
			AssetClassesSell:  sellAssets,
			TargetPositionPct: targetPct,
			Action:            action,
		})
	}
	return impacts, nil
}

// persistRegimeProposedActions writes computed impacts to regime_proposed_actions
// so they can be reviewed and confirmed by the user before any position changes.
// Any previously-pending (unapplied, undismissed) rows for this regime ticker
// are dismissed first — they're superseded by the new signal.
func persistRegimeProposedActions(regimeTicker, signal string, impacts []RegimeImpact) error {
	// Dismiss superseded pending proposals for this regime.
	if _, err := db.Exec(`
		UPDATE regime_proposed_actions
		SET dismissed_at = CURRENT_TIMESTAMP
		WHERE regime_ticker = ? AND applied_at IS NULL AND dismissed_at IS NULL
	`, regimeTicker); err != nil {
		return fmt.Errorf("dismiss old proposals for %s: %w", regimeTicker, err)
	}

	for _, impact := range impacts {
		sellJSON, _ := json.Marshal(impact.AssetClassesSell)
		if _, err := db.Exec(`
			INSERT INTO regime_proposed_actions
				(regime_ticker, signal, ticker, security_type, action, target_position_pct, asset_classes_sell)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, regimeTicker, signal, impact.Ticker, impact.Type, impact.Action, impact.TargetPositionPct, string(sellJSON)); err != nil {
			return fmt.Errorf("insert proposed action for %s/%s: %w", regimeTicker, impact.Ticker, err)
		}
	}
	return nil
}

// applyRegimeImpacts executes the position writes for a set of proposed
// actions identified by their DB ids. Only called after explicit user
// confirmation via POST /api/regime/apply-impacts.
func applyRegimeImpacts(ids []int64) error {
	var applyErrs []error
	for _, id := range ids {
		var (
			ticker       string
			securityType string
			targetPct    int
		)
		err := db.QueryRow(`
			SELECT ticker, security_type, target_position_pct
			FROM regime_proposed_actions
			WHERE id = ? AND applied_at IS NULL AND dismissed_at IS NULL
		`, id).Scan(&ticker, &securityType, &targetPct)
		if err == sql.ErrNoRows {
			// Already applied or dismissed — skip silently.
			continue
		}
		if err != nil {
			applyErrs = append(applyErrs, fmt.Errorf("fetch proposal %d: %w", id, err))
			continue
		}

		var applyErr error
		if securityType == "STOCK" && targetPct == 0 {
			result, execErr := db.Exec(`
				UPDATE security_positions
				SET position_state = 'SELL', last_updated = CURRENT_TIMESTAMP
				WHERE ticker = ? AND manual_override = 0
			`, ticker)
			if execErr != nil {
				applyErr = fmt.Errorf("force SELL %s: %w", ticker, execErr)
			} else {
				rowsAffected, _ := result.RowsAffected()
				log.Printf("[REGIME APPLY] %s → SELL (%d rows affected)", ticker, rowsAffected)
			}
		} else if securityType == "ETF" {
			applyErr = updateETFAllocationForRegime(ticker, targetPct)
			if applyErr == nil {
				log.Printf("[REGIME APPLY] ETF %s → target %d%%", ticker, targetPct)
			}
		}

		if applyErr != nil {
			log.Printf("[REGIME ERROR] Apply failed for proposal %d (%s): %v", id, ticker, applyErr)
			applyErrs = append(applyErrs, applyErr)
			continue
		}

		// Mark as applied.
		if _, err := db.Exec(`
			UPDATE regime_proposed_actions SET applied_at = CURRENT_TIMESTAMP WHERE id = ?
		`, id); err != nil {
			log.Printf("[REGIME ERROR] Failed to mark proposal %d applied: %v", id, err)
		}
	}
	return errors.Join(applyErrs...)
}

// getRegimeProposedActionsHandler serves GET /api/regime/proposed-actions.
// Returns all pending (unapplied, undismissed) proposed actions.
func getRegimeProposedActionsHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, regime_ticker, signal, ticker, security_type, action,
		       target_position_pct, asset_classes_sell, created_at
		FROM regime_proposed_actions
		WHERE applied_at IS NULL AND dismissed_at IS NULL
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ProposedAction struct {
		ID                int64    `json:"id"`
		RegimeTicker      string   `json:"regime_ticker"`
		Signal            string   `json:"signal"`
		Ticker            string   `json:"ticker"`
		SecurityType      string   `json:"security_type"`
		Action            string   `json:"action"`
		TargetPositionPct int      `json:"target_position_pct"`
		AssetClassesSell  []string `json:"asset_classes_sell"`
		CreatedAt         string   `json:"created_at"`
	}

	var actions []ProposedAction
	for rows.Next() {
		var a ProposedAction
		var sellJSON string
		if err := rows.Scan(&a.ID, &a.RegimeTicker, &a.Signal, &a.Ticker,
			&a.SecurityType, &a.Action, &a.TargetPositionPct, &sellJSON, &a.CreatedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_ = json.Unmarshal([]byte(sellJSON), &a.AssetClassesSell)
		actions = append(actions, a)
	}
	if actions == nil {
		actions = []ProposedAction{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"proposed_actions": actions,
		"pending_count":    len(actions),
	})
}

// applyRegimeImpactsHandler serves POST /api/regime/apply-impacts.
// Body: {"ids": [1, 2, 3]} — IDs of proposed actions to apply.
// Body: {"dismiss_ids": [4]} — IDs to dismiss without applying.
func applyRegimeImpactsHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs        []int64 `json:"ids"`
		DismissIDs []int64 `json:"dismiss_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if len(body.DismissIDs) > 0 {
		for _, id := range body.DismissIDs {
			if _, err := db.Exec(`
				UPDATE regime_proposed_actions SET dismissed_at = CURRENT_TIMESTAMP
				WHERE id = ? AND applied_at IS NULL AND dismissed_at IS NULL
			`, id); err != nil {
				log.Printf("[REGIME] Failed to dismiss proposal %d: %v", id, err)
			}
		}
	}

	if len(body.IDs) > 0 {
		if err := applyRegimeImpacts(body.IDs); err != nil {
			log.Printf("[REGIME ERROR] Partial apply failure: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}

// Update ETF allocation based on target percentage from regime
func updateETFAllocationForRegime(ticker string, targetPct int) error {
	// Get current ETF position
	var positionState string
	var currentAlloc float64
	err := db.QueryRow(`
		SELECT position_state, allocation_pct
		FROM etf_positions
		WHERE ticker = ?
	`, ticker).Scan(&positionState, &currentAlloc)

	if err == sql.ErrNoRows {
		// Not a tracked ETF position — expected, not a failure.
		return nil
	}
	if err != nil {
		return fmt.Errorf("fetch ETF position %s: %w", ticker, err)
	}

	// Calculate final target allocation considering both sleeve and regime
	var finalTargetAlloc float64

	if positionState == "SELL" && targetPct == 0 {
		// Both SELL → full exit
		finalTargetAlloc = 0
	} else if positionState == "SELL" || targetPct == 50 {
		// One signal negative → cap at 50%
		if currentAlloc > 50 {
			finalTargetAlloc = 50
		} else {
			finalTargetAlloc = currentAlloc
		}
	} else {
		// Both positive → no forced change
		finalTargetAlloc = currentAlloc
	}

	// Update allocation if changed
	if finalTargetAlloc != currentAlloc {
		_, err := db.Exec(`
			UPDATE etf_positions
			SET allocation_pct = ?, last_updated = CURRENT_TIMESTAMP
			WHERE ticker = ?
		`, finalTargetAlloc, ticker)

		if err != nil {
			return err
		}
		log.Printf("[REGIME] %s allocation: %.0f%% → %.0f%%", ticker, currentAlloc, finalTargetAlloc)
	}
	return nil
}

// Create an alert for regime change with affected positions
func createRegimeAlert(regimeTicker, signal string, affected []RegimeImpact) {
	// Use the regime ticker directly (not "REGIME:SPY") to avoid foreign key constraint issues
	// The alert_type field will be 'REGIME' to distinguish it from normal alerts

	// Insert alert with PRAGMA to disable foreign keys for this operation
	_, err := db.Exec(`PRAGMA foreign_keys = OFF`)
	if err != nil {
		log.Printf("[REGIME ERROR] Failed to disable foreign keys: %v", err)
		return
	}

	// Use "REGIME:{ticker}" format - frontend expects this in ticker field
	ticker := fmt.Sprintf("REGIME:%s", regimeTicker)
	affectedPositions := "[]"
	if payload, err := json.Marshal(affected); err != nil {
		log.Printf("[REGIME ERROR] Failed to marshal affected positions for %s: %v", regimeTicker, err)
	} else {
		affectedPositions = string(payload)
	}

	// Insert alert (using REGIME as alert_type, signal as strength)
	result, err := db.Exec(`
		INSERT INTO alerts (ticker, alert_type, strength, exchange_prefix, affected_positions, created_at, is_active)
		VALUES (?, 'REGIME', ?, '', ?, CURRENT_TIMESTAMP, 1)
	`, ticker, signal, affectedPositions)

	// Re-enable foreign keys
	db.Exec(`PRAGMA foreign_keys = ON`)

	if err != nil {
		log.Printf("[REGIME ERROR] Failed to create alert: %v", err)
		return
	}

	alertID, _ := result.LastInsertId()

	// Send to SSE stream
	alert := Alert{
		ID:                int(alertID),
		Ticker:            ticker,
		AlertType:         "REGIME",
		Strength:          signal,
		ExchangePrefix:    "",
		AffectedPositions: affectedPositions,
		CreatedAt:         time.Now(),
		IsActive:          true,
	}

	select {
	case alertChannel <- alert:
		log.Printf("[REGIME ALERT] Created alert for %s → %s (ID: %d)", regimeTicker, signal, alertID)
	default:
		log.Printf("[REGIME ALERT] Alert channel full, skipping SSE broadcast")
	}
}
