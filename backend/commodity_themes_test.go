package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

func TestConsecutiveConfirmedStagesStopsAtFirstUnconfirmedGate(t *testing.T) {
	stages := []commodityThemeStageResponse{
		{Key: "COMMODITY", Status: "CONFIRMED"},
		{Key: "EQUITY_RELATIVE", Status: "DISCONNECTED"},
		{Key: "SECURITY_TREND", Status: "CONFIRMED"},
		{Key: "SECURITY_OUTPERFORM", Status: "CONFIRMED"},
	}
	if got := consecutiveConfirmedStages(stages); got != 1 {
		t.Fatalf("consecutive confirmed stages = %d, want 1", got)
	}
}

func TestEquityExpressionStagesExcludeTheDirectCommodityGate(t *testing.T) {
	stages := []commodityThemeStageResponse{
		{Key: "COMMODITY", Status: "CONFIRMED"},
		{Key: "EQUITY_RELATIVE", Status: "CONFIRMED"},
		{Key: "SECURITY_TREND", Status: "CONFIRMED"},
		{Key: "SECURITY_OUTPERFORM", Status: "BLOCKED"},
	}
	equityStages := equityExpressionStages(stages)
	if len(equityStages) != 3 {
		t.Fatalf("equity stages = %d, want 3", len(equityStages))
	}
	if got := consecutiveConfirmedStages(equityStages); got != 2 {
		t.Fatalf("confirmed equity stages = %d, want 2", got)
	}
}

func TestValidateCommodityThemeSourceRequiresConfiguredRatio(t *testing.T) {
	stage := commodityThemeStageConfig{
		SourceKind:        "RELATIVE_STRENGTH",
		SourceNumerator:   "AMEX:GDX",
		SourceDenominator: "AMEX:GLD",
	}
	if err := validateCommodityThemeSource(stage, commodityThemeSource{
		Kind: "RELATIVE_STRENGTH", Numerator: "AMEX:GDX", Denominator: "AMEX:GLD",
	}); err != nil {
		t.Fatalf("expected configured ratio to validate: %v", err)
	}
	if err := validateCommodityThemeSource(stage, commodityThemeSource{
		Kind: "RELATIVE_STRENGTH", Numerator: "AMEX:GDX", Denominator: "TVC:GOLD",
	}); err == nil {
		t.Fatal("expected different ratio numerator to be rejected")
	}
}

func TestValidateCommodityThemeSourceAcceptsTradingViewBATSForAMEXETFs(t *testing.T) {
	stage := commodityThemeStageConfig{
		SourceKind:        "RELATIVE_STRENGTH",
		SourceNumerator:   "AMEX:GDX",
		SourceDenominator: "AMEX:GLD",
	}
	if err := validateCommodityThemeSource(stage, commodityThemeSource{
		Kind: "RELATIVE_STRENGTH", Numerator: "BATS:GDX", Denominator: "BATS:GLD",
	}); err != nil {
		t.Fatalf("expected TradingView BATS routing to validate against AMEX ETF sources: %v", err)
	}
}

func TestCommodityThemeRegistryIncludesConfiguredMarkets(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	themes, err := loadCommodityThemeConfigs(context.Background())
	if err != nil {
		t.Fatalf("load theme registry: %v", err)
	}
	want := map[string]string{
		"GOLD": "Gold", "SILVER": "Silver", "COPPER": "Copper",
		"OIL_PRODUCERS": "Oil producers", "OIL_SERVICES": "Oil services",
		"NATURAL_GAS": "Natural gas producers", "URANIUM": "Uranium",
		"PLATINUM": "Platinum", "LITHIUM": "Lithium", "STEEL": "Steel producers",
	}
	if len(themes) != len(want) {
		t.Fatalf("theme count = %d, want %d", len(themes), len(want))
	}
	for _, theme := range themes {
		if want[theme.Code] != theme.DisplayName {
			t.Fatalf("theme %s display name = %q, want %q", theme.Code, theme.DisplayName, want[theme.Code])
		}
		delete(want, theme.Code)
	}
	if len(want) > 0 {
		t.Fatalf("missing configured themes: %#v", want)
	}
}

func TestCommodityThemeDirectExpressionsDefaultToSignalOnly(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("load Gold theme: %v", err)
	}
	if theme.DirectExpression.Status != "SIGNAL_ONLY" {
		t.Fatalf("default direct expression status = %q, want SIGNAL_ONLY", theme.DirectExpression.Status)
	}
	if theme.DirectExpression.InstrumentLabel != "" || theme.DirectExpression.InstrumentTicker != "" {
		t.Fatalf("default direct expression must not infer a broker vehicle: %#v", theme.DirectExpression)
	}
}

func TestCommodityThemeResponseIncludesDirectCommodity60DayReturn(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	for _, point := range []struct {
		date  string
		close float64
	}{
		{date: "2026-06-19", close: 100},
		{date: "2026-08-18", close: 120},
	} {
		if _, err := db.Exec(`
			INSERT INTO commodity_price_daily (
				source_symbol, provider_symbol, observed_date, close_price, currency, source
			) VALUES ('AMEX:GLD', 'GLD', ?, ?, 'USD', 'YAHOO')
		`, point.date, point.close); err != nil {
			t.Fatalf("seed commodity price point: %v", err)
		}
	}

	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("load Gold theme: %v", err)
	}
	response, err := buildCommodityThemeResponse(context.Background(), theme, false)
	if err != nil {
		t.Fatalf("build Gold response: %v", err)
	}

	for _, stage := range response.Stages {
		if stage.Key != "COMMODITY" {
			continue
		}
		if stage.Return60DPct == nil || math.Abs(*stage.Return60DPct-20) > 0.0001 {
			t.Fatalf("commodity return_60d_pct = %#v, want 20", stage.Return60DPct)
		}
		if stage.PerformanceAsOf == nil || stage.PerformanceAsOf.Format("2006-01-02") != "2026-08-18" {
			t.Fatalf("commodity performance_as_of = %#v, want 2026-08-18", stage.PerformanceAsOf)
		}
		return
	}
	t.Fatal("missing COMMODITY stage")
}

func TestCommodityYahooSymbolsCoverConfiguredDirectSources(t *testing.T) {
	for source, want := range map[string]string{
		"AMEX:GLD":   "GLD",
		"BATS:GLD":   "GLD",
		"TVC:SILVER": "SI=F",
		"COMEX:HG1!": "HG=F",
		"NYMEX:CL1!": "CL=F",
		"NYMEX:NG1!": "NG=F",
		"OTC:SRUUF":  "SRUUF",
		"AMEX:PPLT":  "PPLT",
		"AMEX:EVMT":  "EVMT",
		"CME:HRC1!":  "HRC=F",
	} {
		if got := commodityYahooSymbol(source); got != want {
			t.Errorf("commodityYahooSymbol(%q) = %q, want %q", source, got, want)
		}
	}
}

func TestUpdateCommodityThemeDirectExpressionRequiresExplicitBrokerVehicle(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	missingVehicleRequest := httptest.NewRequest(
		http.MethodPatch,
		"/api/commodity-themes/GOLD/direct-expression",
		bytes.NewBufferString(`{"status":"APPROVED"}`),
	)
	missingVehicleRequest = mux.SetURLVars(missingVehicleRequest, map[string]string{"code": "GOLD"})
	missingVehicleResponse := httptest.NewRecorder()
	updateCommodityThemeDirectExpression(missingVehicleResponse, missingVehicleRequest)
	if missingVehicleResponse.Code != http.StatusBadRequest {
		t.Fatalf("approve without vehicle status = %d, want %d: %s", missingVehicleResponse.Code, http.StatusBadRequest, missingVehicleResponse.Body.String())
	}

	request := httptest.NewRequest(
		http.MethodPatch,
		"/api/commodity-themes/GOLD/direct-expression",
		bytes.NewBufferString(`{"status":"APPROVED","instrument_label":"IG Gold","instrument_ticker":"CS.D.GOLD.CFD.IP","instrument_kind":"CFD"}`),
	)
	request = mux.SetURLVars(request, map[string]string{"code": "GOLD"})
	response := httptest.NewRecorder()
	updateCommodityThemeDirectExpression(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("approve direct vehicle status = %d: %s", response.Code, response.Body.String())
	}

	var theme commodityThemeResponse
	if err := json.NewDecoder(response.Body).Decode(&theme); err != nil {
		t.Fatalf("decode direct vehicle response: %v", err)
	}
	if theme.DirectExpression.Status != "APPROVED" || theme.DirectExpression.InstrumentTicker != "CS.D.GOLD.CFD.IP" {
		t.Fatalf("approved direct vehicle = %#v", theme.DirectExpression)
	}

	var status, label, ticker string
	if err := db.QueryRow(`
		SELECT status, instrument_label, instrument_ticker
		FROM commodity_theme_direct_expressions
		WHERE theme_code = 'GOLD'
	`).Scan(&status, &label, &ticker); err != nil {
		t.Fatalf("load persisted direct vehicle: %v", err)
	}
	if status != "APPROVED" || label != "IG Gold" || ticker != "CS.D.GOLD.CFD.IP" {
		t.Fatalf("persisted direct vehicle = %q / %q / %q", status, label, ticker)
	}

	clearRequest := httptest.NewRequest(
		http.MethodPatch,
		"/api/commodity-themes/GOLD/direct-expression",
		bytes.NewBufferString(`{"status":"SIGNAL_ONLY"}`),
	)
	clearRequest = mux.SetURLVars(clearRequest, map[string]string{"code": "GOLD"})
	clearResponse := httptest.NewRecorder()
	updateCommodityThemeDirectExpression(clearResponse, clearRequest)
	if clearResponse.Code != http.StatusOK {
		t.Fatalf("clear direct vehicle status = %d: %s", clearResponse.Code, clearResponse.Body.String())
	}

	var cleared commodityThemeResponse
	if err := json.NewDecoder(clearResponse.Body).Decode(&cleared); err != nil {
		t.Fatalf("decode cleared direct vehicle response: %v", err)
	}
	if cleared.DirectExpression.Status != "SIGNAL_ONLY" || cleared.DirectExpression.InstrumentLabel != "" || cleared.DirectExpression.InstrumentTicker != "" {
		t.Fatalf("cleared direct vehicle = %#v", cleared.DirectExpression)
	}
}

func TestCommodityThemeConfigurationPersistsAndRequiresFreshSourceBaseline(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	initialiseRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/commodity-themes/initialise-feed",
		bytes.NewBufferString(`{"theme":"GOLD","stage":"EQUITY_RELATIVE","signal":"BUY"}`),
	)
	initialiseResponse := httptest.NewRecorder()
	initialiseCommodityThemeFeed(initialiseResponse, initialiseRequest)
	if initialiseResponse.Code != http.StatusOK {
		t.Fatalf("initialise old source = %d: %s", initialiseResponse.Code, initialiseResponse.Body.String())
	}

	request := httptest.NewRequest(
		http.MethodPatch,
		"/api/commodity-themes/GOLD/configuration",
		bytes.NewBufferString(`{
			"display_name":"Gold producers",
			"market_group":"Precious metals",
			"commodity":{"label":"Gold price","symbol":"AMEX:GLD"},
			"equity_relative":{"label":"GDXJ / GLD","numerator":"AMEX:GDXJ","denominator":"AMEX:GLD"}
		}`),
	)
	request = mux.SetURLVars(request, map[string]string{"code": "GOLD"})
	response := httptest.NewRecorder()
	updateCommodityThemeConfiguration(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("update configuration = %d: %s", response.Code, response.Body.String())
	}

	var updated commodityThemeResponse
	if err := json.NewDecoder(response.Body).Decode(&updated); err != nil {
		t.Fatalf("decode configuration response: %v", err)
	}
	if updated.DisplayName != "Gold producers" || updated.MarketGroup != "Precious metals" {
		t.Fatalf("updated configuration = %#v", updated)
	}

	// Calling the startup schema seed again must retain an operator's source
	// change rather than restoring the hard-coded default pair.
	if err := ensureCommodityThemeSchema(); err != nil {
		t.Fatalf("re-run commodity schema: %v", err)
	}
	// The replacement pair has now been registered but not given a directional
	// baseline. Its old GDX/GLD event must still be ignored.
	seedCommodityThemeCDFConnection(t, "AMEX:GDXJ/AMEX:GLD")
	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("reload Gold theme: %v", err)
	}
	result, err := buildCommodityThemeResponse(context.Background(), theme, false)
	if err != nil {
		t.Fatalf("build Gold response: %v", err)
	}
	for _, stage := range result.Stages {
		if stage.Key != "EQUITY_RELATIVE" {
			continue
		}
		if stage.Source.Numerator != "AMEX:GDXJ" || stage.Source.Denominator != "AMEX:GLD" {
			t.Fatalf("persisted equity source = %#v", stage.Source)
		}
		if stage.Status != "DISCONNECTED" {
			t.Fatalf("old GDX/GLD baseline leaked into replacement pair: %#v", stage)
		}
		return
	}
	t.Fatal("missing EQUITY_RELATIVE stage")
}

func TestCreateAndDeactivateCommodityThemePair(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/commodity-themes",
		bytes.NewBufferString(`{
			"code":"TEST_GAS",
			"display_name":"Test gas producers",
			"market_group":"Energy",
			"strategic_floor_asset_class_code":"PHYSICAL_GOLD",
			"tactical_asset_class_code":"BASE_METALS_MINERS",
			"commodity":{"label":"Natural gas","symbol":"NYMEX:NG1!"},
			"equity_relative":{"label":"FCG / natural gas","numerator":"AMEX:FCG","denominator":"NYMEX:NG1!"}
		}`),
	)
	response := httptest.NewRecorder()
	createCommodityTheme(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create market pair = %d: %s", response.Code, response.Body.String())
	}

	created, err := findCommodityThemeConfig(context.Background(), "TEST_GAS")
	if err != nil {
		t.Fatalf("load created market: %v", err)
	}
	if created.DisplayName != "Test gas producers" || created.TacticalAssetCode != "BASE_METALS_MINERS" {
		t.Fatalf("created market = %#v", created)
	}
	stages, err := loadCommodityThemeStageConfigs(context.Background(), "TEST_GAS")
	if err != nil {
		t.Fatalf("load created stages: %v", err)
	}
	for _, stage := range stages {
		if stage.Key == "SECURITY_OUTPERFORM" && stage.SourceDenominator != "AMEX:FCG" {
			t.Fatalf("outperform core fund = %q, want AMEX:FCG", stage.SourceDenominator)
		}
	}

	removeRequest := httptest.NewRequest(http.MethodDelete, "/api/commodity-themes/TEST_GAS", nil)
	removeRequest = mux.SetURLVars(removeRequest, map[string]string{"code": "TEST_GAS"})
	removeResponse := httptest.NewRecorder()
	deactivateCommodityTheme(removeResponse, removeRequest)
	if removeResponse.Code != http.StatusOK {
		t.Fatalf("remove market pair = %d: %s", removeResponse.Code, removeResponse.Body.String())
	}
	if _, err := findCommodityThemeConfig(context.Background(), "TEST_GAS"); err != sql.ErrNoRows {
		t.Fatalf("removed market should not be active, err = %v", err)
	}
}

func TestCommodityThemeResponseSeparatesMarketExposureFromClassCash(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
		VALUES ('UAT', '2026-08-14T00:00:00Z', 10000, 0)
	`); err != nil {
		t.Fatalf("seed statement: %v", err)
	}
	seedCommodityThemeHeldSecurityInClass(t, "AMEX:GLD", "Gold Direct Expression", "ETF", "PHYSICAL_GOLD", 4000, 1000)
	seedCommodityThemeHeldSecurityInClass(t, "ASX:GOLD1", "Gold Producer", "STOCK", "GOLD_MINERS", 3500, 1500)
	seedApprovedCommodityThemeBudget(t, []commodityThemeBudgetRow{
		{AssetClass: "PHYSICAL_GOLD", DisplayName: "Physical Gold", WeightPct: 50},
		{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", WeightPct: 50},
	})

	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("load Gold theme: %v", err)
	}
	response, err := buildCommodityThemeResponse(context.Background(), theme, false)
	if err != nil {
		t.Fatalf("build Gold response: %v", err)
	}
	if response.DirectSleeve.InvestedValue != 4000 || response.DirectSleeve.SleeveCashValue != 1000 || response.DirectSleeve.CapitalValue != 5000 {
		t.Fatalf("direct sleeve = %#v, want invested 4000, cash 1000, capital 5000", response.DirectSleeve)
	}
	if response.StrategicFloor.ActualValue != 4000 {
		t.Fatalf("strategic-floor actual = %.2f, want market exposure only (4000)", response.StrategicFloor.ActualValue)
	}
	if response.EquitySleeve.InvestedValue != 3500 || response.EquitySleeve.SleeveCashValue != 1500 || response.EquitySleeve.CapitalValue != 5000 {
		t.Fatalf("equity sleeve = %#v, want invested 3500, cash 1500, capital 5000", response.EquitySleeve)
	}
	if !hasCommodityThemeReview(response.Reviews, "DIRECT_VEHICLE_REVIEW") {
		t.Fatalf("reviews = %#v, want explicit direct vehicle review", response.Reviews)
	}
	if !hasCommodityThemeReview(response.Reviews, "EQUITY_CLASS_CASH_HELD") {
		t.Fatalf("reviews = %#v, want equity class cash hold", response.Reviews)
	}
}

func TestCommodityThemeReviewsDoNotTurnClassCashIntoCrossClassCapacity(t *testing.T) {
	reviews := commodityThemeReviews(
		commodityThemeConfig{DirectExpression: commodityThemeDirectExpressionConfig{Status: "SIGNAL_ONLY"}},
		commodityThemeClassCapital{AssetClassCode: "PHYSICAL_GOLD", TargetValue: 5000},
		commodityThemeClassCapital{AssetClassCode: "GOLD_MINERS", SleeveCashValue: 1500},
		"CONFIRMED",
		"BLOCKED",
	)

	var classCashReview *commodityThemeReview
	for index := range reviews {
		if reviews[index].Key == "EQUITY_CLASS_CASH_HELD" {
			classCashReview = &reviews[index]
			break
		}
	}
	if classCashReview == nil {
		t.Fatalf("reviews = %#v, want class-cash hold", reviews)
	}
	if classCashReview.AssetClassCode != "GOLD_MINERS" || classCashReview.Scope != "EQUITY" || classCashReview.Status != "HOLD" {
		t.Fatalf("class-cash review = %#v", classCashReview)
	}
}

type commodityThemeBudgetRow struct {
	AssetClass  string
	DisplayName string
	WeightPct   float64
}

func seedApprovedCommodityThemeBudget(t *testing.T, rows []commodityThemeBudgetRow) {
	t.Helper()
	result, err := db.Exec(`
		INSERT INTO portfolio_mix_snapshots (status, reason, notes)
		VALUES ('APPROVED', 'TEST', 'commodity theme test fixture')
	`)
	if err != nil {
		t.Fatalf("seed portfolio budget snapshot: %v", err)
	}
	snapshotID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("read portfolio budget snapshot id: %v", err)
	}
	for index, row := range rows {
		if _, err := db.Exec(`
			INSERT INTO portfolio_mix_snapshot_rows (
				snapshot_id, asset_class, display_name, display_order, governed_by_q1, weight_pct
			) VALUES (?, ?, ?, ?, 0, ?)
		`, snapshotID, row.AssetClass, row.DisplayName, index+1, row.WeightPct); err != nil {
			t.Fatalf("seed portfolio budget row %s: %v", row.AssetClass, err)
		}
	}
}

func hasCommodityThemeReview(reviews []commodityThemeReview, key string) bool {
	for _, review := range reviews {
		if review.Key == key {
			return true
		}
	}
	return false
}

func TestValidateCommodityThemeSecuritySourceRequiresResolvedTicker(t *testing.T) {
	stage := commodityThemeStageConfig{
		SourceKind:   "SECURITY_TREND",
		SourceSymbol: "SECURITY",
	}
	security := resolvedCommodityThemeSecurity{Ticker: "ASX:NST"}
	if err := validateCommodityThemeSecuritySource(
		stage,
		commodityThemeSource{Symbol: "ASX:NST"},
		security,
	); err != nil {
		t.Fatalf("expected resolved security ticker to validate: %v", err)
	}
	if err := validateCommodityThemeSecuritySource(
		stage,
		commodityThemeSource{Symbol: "ASX:EVN"},
		security,
	); err == nil {
		t.Fatal("expected a mismatched security source to be rejected")
	}
	if err := validateCommodityThemeSecuritySource(
		stage,
		commodityThemeSource{Symbol: "ASX_DLY:NST"},
		security,
	); err != nil {
		t.Fatalf("expected TradingView ASX_DLY ticker to match ASX stable identity: %v", err)
	}
}

func TestThemeConfirmationWebhookPersistsIdempotentAdvisoryEvent(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()
	seedCommodityThemeCDFConnection(t, "AMEX:GDX/AMEX:GLD")

	body := []byte(`{
		"event_id":"gold-gdx-gold-2026-08-05-1d",
		"theme":"GOLD",
		"stage":"EQUITY_RELATIVE",
		"scope":"THEME",
		"signal":"BUY",
		"script":"cdf",
		"signal_version":"cdf.relative.v1",
		"source":{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:GDX","denominator":"AMEX:GLD","label":"Gold equities / gold"},
		"timeframe":"1D",
		"bar_closed_at":"2026-08-05T20:00:00Z",
		"close":1.4321
	}`)

	for attempt := 0; attempt < 2; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/api/webhook/theme-confirmation", bytes.NewReader(body))
		recorder := httptest.NewRecorder()
		themeConfirmationWebhookSync(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("attempt %d: status = %d, body = %s", attempt+1, recorder.Code, recorder.Body.String())
		}
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM commodity_theme_events`).Scan(&count); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if count != 1 {
		t.Fatalf("event count = %d, want 1 after idempotent replay", count)
	}

	var targetRows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM portfolio_mix_snapshots`).Scan(&targetRows); err != nil {
		t.Fatalf("count portfolio mix snapshots: %v", err)
	}
	if targetRows != 0 {
		t.Fatalf("theme event changed approved portfolio mix: got %d snapshots", targetRows)
	}
}

func TestInitialiseCommodityThemeFeedRegistersBaselineWithoutAction(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/commodity-themes/initialise-feed",
		bytes.NewBufferString(`{"theme":"GOLD","stage":"EQUITY_RELATIVE","signal":"BUY"}`),
	)
	response := httptest.NewRecorder()
	initialiseCommodityThemeFeed(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("initialise status = %d: %s", response.Code, response.Body.String())
	}

	var connectionCount, eventCount, actionCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM active_alerts WHERE ticker = 'AMEX:GDX/AMEX:GLD' AND script = 'cdf'`).Scan(&connectionCount); err != nil {
		t.Fatalf("count registered feed: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM commodity_theme_events WHERE theme_code = 'GOLD' AND stage_key = 'EQUITY_RELATIVE' AND signal = 'BUY' AND signal_version = 'manual.initialisation.v1'`).Scan(&eventCount); err != nil {
		t.Fatalf("count baseline event: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM security_actions`).Scan(&actionCount); err != nil {
		t.Fatalf("count projected actions: %v", err)
	}
	if connectionCount != 1 || eventCount != 1 || actionCount != 0 {
		t.Fatalf("baseline setup = connections=%d events=%d actions=%d, want 1/1/0", connectionCount, eventCount, actionCount)
	}

	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("load Gold theme: %v", err)
	}
	summary, err := buildCommodityThemeResponse(context.Background(), theme, false)
	if err != nil {
		t.Fatalf("build Gold theme: %v", err)
	}
	for _, stage := range summary.Stages {
		if stage.Key == "EQUITY_RELATIVE" {
			if stage.Status != "CONFIRMED" || stage.Signal != "BUY" {
				t.Fatalf("equity baseline = %#v, want BUY", stage)
			}
			return
		}
	}
	t.Fatal("missing EQUITY_RELATIVE stage")
}

func TestThemeConfirmationWebhookIgnoresConnectSignals(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/webhook/theme-confirmation",
		bytes.NewBufferString(`{
			"theme":"GOLD","stage":"EQUITY_RELATIVE","scope":"THEME","signal":"CONNECT",
			"script":"cdf","signal_version":"cdf.relative.v1",
			"source":{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:GDX","denominator":"AMEX:GLD"}
		}`),
	)
	response := httptest.NewRecorder()
	themeConfirmationWebhookSync(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ignored"`) {
		t.Fatalf("CONNECT response = %d: %s", response.Code, response.Body.String())
	}

	var eventCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM commodity_theme_events`).Scan(&eventCount); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("CONNECT stored %d events, want none", eventCount)
	}
}

func TestThemeConfirmationWebhookRequiresRegisteredFeed(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/webhook/theme-confirmation",
		bytes.NewBufferString(`{
			"event_id":"unregistered-gold-equity-buy","theme":"GOLD","stage":"EQUITY_RELATIVE","scope":"THEME","signal":"BUY",
			"script":"cdf","signal_version":"cdf.relative.v1",
			"source":{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:GDX","denominator":"AMEX:GLD"},
			"timeframe":"1D","bar_closed_at":"2026-08-10T06:00:00Z"
		}`),
	)
	response := httptest.NewRecorder()
	themeConfirmationWebhookSync(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("unregistered feed status = %d: %s", response.Code, response.Body.String())
	}

	var eventCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM commodity_theme_events`).Scan(&eventCount); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("unregistered feed stored %d events, want none", eventCount)
	}
}

func TestCommodityThemeSecurityTrendReadsCanonicalCDFState(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	seedCommodityThemeHeldSecurity(t, "ASX:AEVT", "UAT Event Simulator", "STOCK", 500)
	seedCommodityThemeCDFConnection(t, "ASX:AEVT")
	if _, err := db.Exec(`INSERT INTO security_positions (ticker, position_state) VALUES ('AEVT', 'SELL')`); err != nil {
		t.Fatalf("seed canonical CDF state: %v", err)
	}

	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("load Gold theme: %v", err)
	}
	summary, err := buildCommodityThemeResponse(context.Background(), theme, true)
	if err != nil {
		t.Fatalf("build Gold theme: %v", err)
	}
	for _, stage := range summary.Stages {
		if stage.Key == "SECURITY_TREND" {
			if stage.Status != "BLOCKED" || stage.Signal != "SELL" || stage.EligibleSecurityCount != 0 || stage.BlockedSecurityCount != 1 || stage.EligibleSecurityTotal != 1 {
				t.Fatalf("canonical security trend = %#v, want SELL 1/1", stage)
			}
			return
		}
	}
	t.Fatal("missing SECURITY_TREND stage")
}

func TestCommodityThemeProducerFundsCarryTrendWithoutJoiningCompanyTotals(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	seedCommodityThemeHeldSecurity(t, "ASX:AEVT", "UAT Event Simulator", "STOCK", 500)
	seedCommodityThemeCDFConnection(t, "ASX:AEVT")
	seedCommodityThemeHeldSecurity(t, "ASX:GDX", "VanEck Gold Miners ETF", "ETF", 700)
	seedCommodityThemeHeldSecurity(t, "ASX:GOLDX", "Unsignalled Gold Fund", "ETF", 300)
	if _, err := db.Exec(`INSERT INTO security_positions (ticker, position_state) VALUES ('AEVT', 'BUY'), ('GDX', 'SELL')`); err != nil {
		t.Fatalf("seed canonical CDF states: %v", err)
	}

	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("load Gold theme: %v", err)
	}
	summary, err := buildCommodityThemeResponse(context.Background(), theme, true)
	if err != nil {
		t.Fatalf("build Gold theme: %v", err)
	}
	if len(summary.EligibleSecurities) != 1 || summary.EligibleSecurities[0].Ticker != "ASX:AEVT" {
		t.Fatalf("eligible securities = %#v, want the company only", summary.EligibleSecurities)
	}
	for _, stage := range summary.Stages {
		if stage.Key == "SECURITY_TREND" && stage.EligibleSecurityTotal != 1 {
			t.Fatalf("company trend total = %d, want funds excluded", stage.EligibleSecurityTotal)
		}
	}
	if len(summary.ProducerFunds) != 2 {
		t.Fatalf("producer funds = %#v, want two class ETFs", summary.ProducerFunds)
	}
	states := map[string]string{}
	for _, fund := range summary.ProducerFunds {
		states[fund.Ticker] = fund.TrendState
	}
	if states["ASX:GDX"] != "BLOCKED" || states["ASX:GOLDX"] != "DISCONNECTED" {
		t.Fatalf("fund trend states = %#v, want GDX BLOCKED and GOLDX DISCONNECTED", states)
	}

	withoutSecurities, err := buildCommodityThemeResponse(context.Background(), theme, false)
	if err != nil {
		t.Fatalf("build Gold summary: %v", err)
	}
	if withoutSecurities.ProducerFunds != nil {
		t.Fatalf("summary without securities returned funds %#v", withoutSecurities.ProducerFunds)
	}
}

func TestThemeConfirmationWebhookAcceptsTradingViewCommodityRatioAliases(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	seedCommodityThemeHeldSecurity(t, "ASX:AEVT", "UAT Event Simulator", "STOCK", 500)
	seedCommodityThemeCDFConnection(t, "ASX:AEVT/AMEX:GDX")
	body := []byte(`{
		"event_id":"uat-event-simulator:gold-aevt-outperform-buy",
		"theme":"GOLD",
		"stage":"SECURITY_OUTPERFORM",
		"scope":"SECURITY",
		"signal":"BUY",
		"script":"cdf",
		"signal_version":"cdf.relative.v1",
		"security":{"ticker":"ASX_DLY:AEVT"},
		"source":{"kind":"RELATIVE_STRENGTH","numerator":"ASX_DLY:AEVT","denominator":"BATS:GDX"},
		"timeframe":"1D",
		"bar_closed_at":"2026-08-10T06:00:00Z"
	}`)

	request := httptest.NewRequest(http.MethodPost, "/api/webhook/theme-confirmation", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	themeConfirmationWebhookSync(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("theme webhook status = %d: %s", recorder.Code, recorder.Body.String())
	}

	var stage, ticker, script string
	if err := db.QueryRow(`
		SELECT stage_key, security_ticker, script
		FROM commodity_theme_events
		WHERE event_key = 'GOLD:uat-event-simulator:gold-aevt-outperform-buy'
	`).Scan(&stage, &ticker, &script); err != nil {
		t.Fatalf("read stored relative event: %v", err)
	}
	if stage != "SECURITY_OUTPERFORM" || ticker != "ASX:AEVT" || script != "cdf" {
		t.Fatalf("stored relative event = stage %q, ticker %q, script %q", stage, ticker, script)
	}
	var confirmedAlertCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM alerts WHERE alert_type = 'OUTPERFORM_CONFIRMED' AND ticker = 'AEVT'`).Scan(&confirmedAlertCount); err != nil {
		t.Fatalf("count Outperform confirmation alert: %v", err)
	}
	if confirmedAlertCount != 1 {
		t.Fatalf("Outperform confirmation alerts = %d, want 1", confirmedAlertCount)
	}

	sellBody := bytes.Replace(body, []byte(`gold-aevt-outperform-buy`), []byte(`gold-aevt-outperform-sell`), 1)
	sellBody = bytes.Replace(sellBody, []byte(`"signal":"BUY"`), []byte(`"signal":"SELL"`), 1)
	sellBody = bytes.Replace(sellBody, []byte(`2026-08-10T06:00:00Z`), []byte(`2026-08-11T06:00:00Z`), 1)
	request = httptest.NewRequest(http.MethodPost, "/api/webhook/theme-confirmation", bytes.NewReader(sellBody))
	recorder = httptest.NewRecorder()
	themeConfirmationWebhookSync(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("Outperform sell status = %d: %s", recorder.Code, recorder.Body.String())
	}
	var lostAlertCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM alerts WHERE alert_type = 'OUTPERFORM_LOST' AND ticker = 'AEVT'`).Scan(&lostAlertCount); err != nil {
		t.Fatalf("count Outperform lost alert: %v", err)
	}
	if lostAlertCount != 1 {
		t.Fatalf("Outperform lost alerts = %d, want 1", lostAlertCount)
	}
	var confirmedIsActive bool
	if err := db.QueryRow(`SELECT is_active FROM alerts WHERE alert_type = 'OUTPERFORM_CONFIRMED' AND ticker = 'AEVT'`).Scan(&confirmedIsActive); err != nil {
		t.Fatalf("load prior Outperform alert: %v", err)
	}
	if confirmedIsActive {
		t.Fatal("Outperform confirmation should be archived when the newer loss arrives")
	}
}

func TestCommodityThemeSecurityStageReportsEligibleUniverse(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	for index, ticker := range []string{"ASX:AEVT", "ASX:GOLD1", "ASX:GOLD2", "ASX:GOLD3"} {
		seedCommodityThemeHeldSecurity(t, ticker, fmt.Sprintf("Gold Producer %d", index+1), "STOCK", 500)
	}
	seedCommodityThemeCDFConnection(t, "ASX:AEVT/AMEX:GDX")

	body := []byte(`{
		"event_id":"gold-aevt-outperform-buy","theme":"GOLD","stage":"SECURITY_OUTPERFORM",
		"scope":"SECURITY","signal":"BUY","script":"cdf","signal_version":"cdf.relative.v1",
		"security":{"ticker":"ASX_DLY:AEVT"},
		"source":{"kind":"RELATIVE_STRENGTH","numerator":"ASX_DLY:AEVT","denominator":"BATS:GDX"},
		"timeframe":"1D","bar_closed_at":"2026-08-10T06:00:00Z"
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/webhook/theme-confirmation", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	themeConfirmationWebhookSync(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("theme webhook status = %d: %s", recorder.Code, recorder.Body.String())
	}

	theme, err := findCommodityThemeConfig(context.Background(), "GOLD")
	if err != nil {
		t.Fatalf("load Gold theme: %v", err)
	}
	response, err := buildCommodityThemeResponse(context.Background(), theme, false)
	if err != nil {
		t.Fatalf("build Gold response: %v", err)
	}
	for _, stage := range response.Stages {
		if stage.Key != "SECURITY_OUTPERFORM" {
			continue
		}
		if stage.Status != "CONFIRMED" || stage.EligibleSecurityCount != 1 || stage.EligibleSecurityTotal != 4 {
			t.Fatalf("outperformance stage = %#v, want Confirmed 1/4", stage)
		}
		return
	}
	t.Fatal("missing SECURITY_OUTPERFORM stage")
}

func seedCommodityThemeHeldSecurity(t *testing.T, ticker, name, securityType string, value float64) {
	seedCommodityThemeHeldSecurityInClass(t, ticker, name, securityType, "GOLD_MINERS", value, 0)
}

func seedCommodityThemeCDFConnection(t *testing.T, ticker string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO active_alerts (ticker, script) VALUES (?, 'cdf')`, ticker); err != nil {
		t.Fatalf("seed commodity CDF connection %s: %v", ticker, err)
	}
}

func seedCommodityThemeHeldSecurityInClass(
	t *testing.T,
	ticker, name, securityType, assetClass string,
	value, tacticalCash float64,
) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("start identity transaction: %v", err)
	}
	defer tx.Rollback()
	securityID, err := ensureSecurityIdentityTx(tx, securityIdentityCandidate{
		Ticker: ticker,
		Name:   name,
	}, "commodity_theme_test", true)
	if err != nil {
		t.Fatalf("create stable identity: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit stable identity: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, security_id, primary_asset_class, security_type)
		VALUES (?, ?, ?, ?, ?)
	`, ticker, name, securityID, assetClass, securityType); err != nil {
		t.Fatalf("seed analysis security: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, security_id, quantity, current_price, value_aud, cash_reserve, is_active)
		VALUES (?, ?, ?, 100, ?, ?, ?, 1)
	`, securityActionTicker(ticker), name, securityID, value/100, value, tacticalCash); err != nil {
		t.Fatalf("seed held security: %v", err)
	}
}

func TestEquityRelativeBreakdownProjectsOneSharedAssetClassAction(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	seedCommodityThemeHeldSecurity(t, "ASX:GOLD1", "Gold Producer", "STOCK", 1000)
	seedCommodityThemeHeldSecurity(t, "AMEX:GDX", "Gold Producer ETF", "ETF", 500)
	seedCommodityThemeCDFConnection(t, "AMEX:GDX/AMEX:GLD")

	buyBody := []byte(`{
		"event_id":"gold-equity-buy","theme":"GOLD","stage":"EQUITY_RELATIVE",
		"scope":"THEME","signal":"BUY","script":"cdf","signal_version":"cdf.relative.v1",
		"source":{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:GDX","denominator":"AMEX:GLD"},
		"timeframe":"1D","bar_closed_at":"2026-08-05T20:00:00Z"
	}`)
	connectBody := []byte(`{
		"event_id":"gold-equity-connect","theme":"GOLD","stage":"EQUITY_RELATIVE",
		"scope":"THEME","signal":"CONNECT","script":"cdf","signal_version":"cdf.relative.v1",
		"source":{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:GDX","denominator":"AMEX:GLD"},
		"timeframe":"1D"
	}`)
	sellBody := []byte(`{
		"event_id":"gold-equity-sell","theme":"GOLD","stage":"EQUITY_RELATIVE",
		"scope":"THEME","signal":"SELL","script":"cdf","signal_version":"cdf.relative.v1",
		"source":{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:GDX","denominator":"AMEX:GLD"},
		"timeframe":"1D","bar_closed_at":"2026-08-06T20:00:00Z"
	}`)
	for _, body := range [][]byte{buyBody, connectBody, sellBody, sellBody} {
		request := httptest.NewRequest(http.MethodPost, "/api/webhook/theme-confirmation", bytes.NewReader(body))
		response := httptest.NewRecorder()
		themeConfirmationWebhookSync(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("theme webhook status = %d: %s", response.Code, response.Body.String())
		}
	}

	var action SecurityAction
	var tickersJSON string
	err := db.QueryRow(`
		SELECT alert_id, ticker, scope, asset_class_code, affected_tickers_json,
			intent, instruction_basis, holding_value_snapshot, source_event_key
		FROM security_actions
		WHERE source_event_key = 'GOLD:gold-equity-sell'
	`).Scan(
		&action.AlertID, &action.Ticker, &action.Scope, &action.AssetClassCode, &tickersJSON,
		&action.Intent, &action.InstructionBasis, &action.HoldingValueSnapshot, &action.SourceEventKey,
	)
	if err != nil {
		t.Fatalf("load projected action: %v", err)
	}
	if action.Scope != "ASSET_CLASS" || action.AssetClassCode != "GOLD_MINERS" || action.Intent != "REDUCE" {
		t.Fatalf("projected class action = %#v", action)
	}
	if action.Ticker != "GOLD_MINERS" {
		t.Fatalf("projected class action ticker = %q, want GOLD_MINERS", action.Ticker)
	}
	if action.HoldingValueSnapshot != 1500 {
		t.Fatalf("class action snapshot = %.2f, want 1500", action.HoldingValueSnapshot)
	}
	if err := json.Unmarshal([]byte(tickersJSON), &action.AffectedTickers); err != nil {
		t.Fatalf("decode affected tickers: %v", err)
	}
	if len(action.AffectedTickers) != 2 || action.AffectedTickers[0] != "GOLD1" || action.AffectedTickers[1] != "GDX" {
		t.Fatalf("affected tickers = %#v, want Gold stock and ETF", action.AffectedTickers)
	}
	var actionCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM security_actions WHERE source_event_key = 'GOLD:gold-equity-sell'`).Scan(&actionCount); err != nil {
		t.Fatalf("count projected actions: %v", err)
	}
	if actionCount != 1 {
		t.Fatalf("projected action count = %d, want exactly one after replay", actionCount)
	}
}

func TestCommodityThemeHeldPositionsSkipsLegacyBlankTicker(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	seedCommodityThemeHeldSecurity(t, "ASX:GOLD1", "Gold Producer", "STOCK", 1000)
	if _, err := db.Exec(`
		INSERT INTO security_identities (exchange_prefix, ticker, canonical_name)
		VALUES ('ASX:', '', 'Legacy unlinked Gold holding')
	`); err != nil {
		t.Fatalf("seed blank identity: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, security_id, primary_asset_class, security_type)
		VALUES ('', 'Legacy unlinked Gold holding', (SELECT id FROM security_identities WHERE canonical_name = 'Legacy unlinked Gold holding'), 'GOLD_MINERS', 'STOCK')
	`); err != nil {
		t.Fatalf("seed blank analysis: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, security_id, quantity, current_price, value_aud, is_active)
		VALUES ('', 'Legacy unlinked Gold holding', (SELECT id FROM security_identities WHERE canonical_name = 'Legacy unlinked Gold holding'), 1, 1, 1, 1)
	`); err != nil {
		t.Fatalf("seed blank holding: %v", err)
	}

	positions, err := commodityThemeHeldPositions(context.Background(), "GOLD_MINERS")
	if err != nil {
		t.Fatalf("load held positions with blank legacy ticker: %v", err)
	}
	if len(positions) != 1 || positions[0].Ticker != "GOLD1" {
		t.Fatalf("held positions = %#v, want only mapped Gold Producer", positions)
	}
}

func TestCommodityThemeClassActionReconcilesByAffectedHoldingQuantity(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES ('GOLD1', 'Gold Producer', 100, 10, 1000, 1)
	`); err != nil {
		t.Fatalf("seed holding: %v", err)
	}
	if err := projectCommodityThemeAssetClassAction("GOLD:test-regime", "GOLD", "GOLD_MINERS", []string{"GOLD1"}, 1000); err != nil {
		t.Fatalf("project class action: %v", err)
	}
	var actionID int
	if err := db.QueryRow(`SELECT id FROM security_actions WHERE source_event_key = 'GOLD:test-regime'`).Scan(&actionID); err != nil {
		t.Fatalf("read class action: %v", err)
	}
	recordRequest := httptest.NewRequest(http.MethodPost, "/api/security-actions/record-execution", bytes.NewBufferString(`{"notes":"reduced class sleeve"}`))
	recordRequest = mux.SetURLVars(recordRequest, map[string]string{"id": stringInt(actionID)})
	recordResponse := httptest.NewRecorder()
	recordSecurityActionExecution(recordResponse, recordRequest)
	if recordResponse.Code != http.StatusOK {
		t.Fatalf("record class action execution = %d: %s", recordResponse.Code, recordResponse.Body.String())
	}
	var decision string
	if err := db.QueryRow(`SELECT decision FROM decisions WHERE alert_id = (SELECT alert_id FROM security_actions WHERE id = ?)`, actionID).Scan(&decision); err != nil {
		t.Fatalf("read class action decision: %v", err)
	}
	if decision != "EQUITY_REGIME_STRONG_TRIM" {
		t.Fatalf("class action decision = %q, want EQUITY_REGIME_STRONG_TRIM", decision)
	}
	statement, err := db.Exec(`
		INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
		VALUES ('UAT', '2026-08-10T00:00:00Z', 800, 0)
	`)
	if err != nil {
		t.Fatalf("seed statement: %v", err)
	}
	statementID, _ := statement.LastInsertId()
	if _, err := db.Exec(`INSERT INTO company_mappings (company_name, ticker, exchange_prefix) VALUES ('Gold Producer', 'GOLD1', 'ASX:')`); err != nil {
		t.Fatalf("seed mapping: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO statement_holdings (statement_id, details, quantity, cost_aud, current_price, value_aud, gain_loss_aud, gain_loss_pct, currency, market_value, cash_reserve)
		VALUES (?, 'Gold Producer', 80, 8, 10, 800, 0, 0, 'AUD', 800, 0)
	`, statementID); err != nil {
		t.Fatalf("seed statement holding: %v", err)
	}

	reconcileSecurityActionsAfterStatement(statementID, 2)
	var status string
	if err := db.QueryRow(`SELECT status FROM security_actions WHERE id = ?`, actionID).Scan(&status); err != nil {
		t.Fatalf("read reconciled action: %v", err)
	}
	if status != securityActionConfirmed {
		t.Fatalf("class action status = %s, want %s", status, securityActionConfirmed)
	}
}
