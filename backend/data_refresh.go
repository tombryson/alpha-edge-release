package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	dataRefreshAnalysisPriceHistory  = "ANALYSIS_PRICE_HISTORY"
	dataRefreshETFMomentum           = "ETF_MOMENTUM"
	dataRefreshCommodityPriceHistory = "COMMODITY_PRICE_HISTORY"
	dataRefreshRegimeReturns         = "REGIME_RETURNS"
	dataRefreshListingVerification   = "LISTING_VERIFICATION"
	dataRefreshNewsDaily             = "NEWS_DAILY"
	dataRefreshBrokerStatements      = "BROKER_STATEMENTS"
	dataRefreshTradingViewSignals    = "TRADINGVIEW_SIGNALS"

	dataRefreshStatusRunning  = "RUNNING"
	dataRefreshStatusComplete = "COMPLETE"
	dataRefreshStatusPartial  = "PARTIAL"
	dataRefreshStatusFailed   = "FAILED"
	dataRefreshStatusSkipped  = "SKIPPED"
	dataRefreshStatusNeverRun = "NEVER_RUN"
	dataRefreshStatusStale    = "STALE"

	dataRefreshPollInterval  = 30 * time.Minute
	dataRefreshRetryInterval = 2 * time.Hour
	dataRefreshLeaseTimeout  = 20 * time.Minute
)

type dataRefreshConfig struct {
	Enabled             bool `json:"enabled"`
	DailyUTCHour        int  `json:"daily_utc_hour"`
	ListingEnabled      bool `json:"listing_enabled"`
	ListingUTCHour      int  `json:"listing_utc_hour"`
	NewsEnabled         bool `json:"news_enabled"`
	NewsDailyUTCHour    int  `json:"news_daily_utc_hour"`
	PollIntervalMinutes int  `json:"poll_interval_minutes"`
}

type dataRefreshRun struct {
	ID               int64   `json:"id"`
	Dataset          string  `json:"dataset"`
	Source           string  `json:"source"`
	UpdateMode       string  `json:"update_mode"`
	Cadence          string  `json:"cadence"`
	TriggerSource    string  `json:"trigger_source"`
	Status           string  `json:"status"`
	StartedAt        string  `json:"last_attempt_at"`
	FinishedAt       *string `json:"finished_at,omitempty"`
	LastSuccessAt    *string `json:"last_success_at,omitempty"`
	DataFreshThrough *string `json:"data_fresh_through,omitempty"`
	CoverageComplete bool    `json:"coverage_complete"`
	ExpectedCount    int     `json:"records_expected"`
	UpdatedCount     int     `json:"records_updated"`
	ErrorCount       int     `json:"error_count"`
	Message          string  `json:"message,omitempty"`
	LastError        *string `json:"last_error,omitempty"`
	StaleAfterDays   int     `json:"stale_after_days"`
}

type dataFreshnessResponse struct {
	GeneratedAt string            `json:"generated_at"`
	Scheduler   dataRefreshConfig `json:"scheduler"`
	Datasets    []dataRefreshRun  `json:"datasets"`
}

type dataRefreshExecutionResult struct {
	Status           string
	DataFreshThrough *string
	ExpectedCount    int
	UpdatedCount     int
	Errors           []string
	Message          string
}

type dataRefreshDatasetDefinition struct {
	Dataset        string
	Source         string
	UpdateMode     string
	Cadence        string
	StaleAfterDays int
}

var dataRefreshDatasetDefinitions = []dataRefreshDatasetDefinition{
	{dataRefreshAnalysisPriceHistory, "YAHOO", "SCHEDULED_PROVIDER_REFRESH", "DAILY", 4},
	{dataRefreshETFMomentum, "YAHOO", "SCHEDULED_CALCULATION", "DAILY_EVIDENCE_80_SESSION_PUBLICATION", 4},
	{dataRefreshCommodityPriceHistory, "YAHOO", "SCHEDULED_PROVIDER_REFRESH", "DAILY", 4},
	{dataRefreshRegimeReturns, "YAHOO", "SCHEDULED_PROVIDER_REFRESH", "DAILY", 4},
	{dataRefreshListingVerification, "YAHOO", "SCHEDULED_PROVIDER_VERIFICATION", "WEEKLY", 8},
	{dataRefreshNewsDaily, "XAI", "SCHEDULED_AI_JOB", "DAILY", 2},
	{dataRefreshBrokerStatements, "BROKER_STATEMENT", "EVENT_INGESTION", "EXTERNAL", 0},
	{dataRefreshTradingViewSignals, "TRADINGVIEW", "EVENT_INGESTION", "EVENT_DRIVEN", 0},
}

func ensureDataRefreshSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS data_refresh_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			dataset TEXT NOT NULL,
			trigger_source TEXT NOT NULL DEFAULT 'SCHEDULED',
			status TEXT NOT NULL,
			started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			finished_at DATETIME,
			data_fresh_through DATE,
			expected_count INTEGER NOT NULL DEFAULT 0,
			updated_count INTEGER NOT NULL DEFAULT 0,
			error_count INTEGER NOT NULL DEFAULT 0,
			message TEXT NOT NULL DEFAULT ''
		);
		CREATE INDEX IF NOT EXISTS idx_data_refresh_runs_dataset
			ON data_refresh_runs(dataset, started_at DESC, id DESC);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_data_refresh_runs_active
			ON data_refresh_runs(dataset) WHERE status = 'RUNNING';

		CREATE TABLE IF NOT EXISTS regime_return_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			data_json TEXT NOT NULL,
			data_fresh_through DATE,
			expected_tickers INTEGER NOT NULL DEFAULT 0,
			updated_tickers INTEGER NOT NULL DEFAULT 0,
			error_count INTEGER NOT NULL DEFAULT 0,
			errors_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_regime_return_snapshots_created
			ON regime_return_snapshots(created_at DESC, id DESC);
	`)
	if err != nil {
		return err
	}
	defaults := map[string]string{
		"data_refresh_automation_enabled":         "true",
		"data_refresh_daily_utc_hour":             "10",
		"listing_verification_automation_enabled": "true",
		"listing_verification_utc_hour":           "11",
		"news_daily_automation_enabled":           "true",
		"news_daily_utc_hour":                     "12",
	}
	for key, value := range defaults {
		if _, err := db.Exec(`
			INSERT INTO settings (key, value, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(key) DO NOTHING
		`, key, value); err != nil {
			return err
		}
	}
	return nil
}

func loadBoolSetting(key string, fallback bool) bool {
	raw := strings.TrimSpace(loadStringSetting(key, ""))
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return value
}

func loadHourSetting(key string, fallback int) int {
	raw := strings.TrimSpace(loadStringSetting(key, ""))
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > 23 {
		return fallback
	}
	return value
}

func loadDataRefreshConfig() dataRefreshConfig {
	return dataRefreshConfig{
		Enabled:             loadBoolSetting("data_refresh_automation_enabled", true),
		DailyUTCHour:        loadHourSetting("data_refresh_daily_utc_hour", 10),
		ListingEnabled:      loadBoolSetting("listing_verification_automation_enabled", true),
		ListingUTCHour:      loadHourSetting("listing_verification_utc_hour", 11),
		NewsEnabled:         loadBoolSetting("news_daily_automation_enabled", true),
		NewsDailyUTCHour:    loadHourSetting("news_daily_utc_hour", 12),
		PollIntervalMinutes: int(dataRefreshPollInterval / time.Minute),
	}
}

func parseDatabaseTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05Z07:00", "2006-01-02"} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed.UTC(), true
		}
	}
	return time.Time{}, false
}

func dataRefreshDue(now time.Time, enabled bool, utcHour int, cadence string, latest *dataRefreshRun) bool {
	if !enabled {
		return false
	}
	now = now.UTC()
	if now.Hour() < utcHour {
		return false
	}
	if latest == nil {
		return true
	}
	startedAt, ok := parseDatabaseTime(latest.StartedAt)
	if !ok {
		return true
	}
	if latest.Status == dataRefreshStatusRunning {
		return now.Sub(startedAt) > dataRefreshLeaseTimeout
	}
	if latest.Status == dataRefreshStatusFailed || latest.Status == dataRefreshStatusPartial || latest.Status == dataRefreshStatusSkipped {
		return now.Sub(startedAt) >= dataRefreshRetryInterval
	}
	if strings.EqualFold(cadence, "WEEKLY") {
		return now.Sub(startedAt) >= 7*24*time.Hour
	}
	return startedAt.Format("2006-01-02") != now.Format("2006-01-02")
}

func loadLatestDataRefreshRun(ctx context.Context, dataset string) (*dataRefreshRun, error) {
	var run dataRefreshRun
	var finishedAt, freshThrough sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT id, dataset, trigger_source, status, CAST(started_at AS TEXT),
		       CAST(finished_at AS TEXT), CAST(data_fresh_through AS TEXT),
		       expected_count, updated_count, error_count, message
		FROM data_refresh_runs
		WHERE dataset = ?
		ORDER BY started_at DESC, id DESC
		LIMIT 1
	`, dataset).Scan(
		&run.ID, &run.Dataset, &run.TriggerSource, &run.Status, &run.StartedAt,
		&finishedAt, &freshThrough, &run.ExpectedCount, &run.UpdatedCount,
		&run.ErrorCount, &run.Message,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if finishedAt.Valid {
		value := finishedAt.String
		run.FinishedAt = &value
	}
	if freshThrough.Valid {
		value := freshThrough.String
		run.DataFreshThrough = &value
	}
	var lastSuccessAt sql.NullString
	err = db.QueryRowContext(ctx, `
		SELECT CAST(finished_at AS TEXT)
		FROM data_refresh_runs
		WHERE dataset = ? AND status = 'COMPLETE'
		ORDER BY started_at DESC, id DESC
		LIMIT 1
	`, dataset).Scan(&lastSuccessAt)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if lastSuccessAt.Valid {
		value := lastSuccessAt.String
		run.LastSuccessAt = &value
	}
	if run.DataFreshThrough == nil {
		var lastValidFreshThrough sql.NullString
		err = db.QueryRowContext(ctx, `
			SELECT CAST(data_fresh_through AS TEXT)
			FROM data_refresh_runs
			WHERE dataset = ? AND status IN ('COMPLETE', 'PARTIAL')
			  AND data_fresh_through IS NOT NULL
			ORDER BY started_at DESC, id DESC
			LIMIT 1
		`, dataset).Scan(&lastValidFreshThrough)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if lastValidFreshThrough.Valid {
			value := lastValidFreshThrough.String
			run.DataFreshThrough = &value
		}
	}
	return &run, nil
}

func beginDataRefreshRun(ctx context.Context, dataset, trigger string, now time.Time) (int64, bool, error) {
	cutoff := now.UTC().Add(-dataRefreshLeaseTimeout).Format("2006-01-02 15:04:05")
	if _, err := db.ExecContext(ctx, `
		UPDATE data_refresh_runs
		SET status = 'FAILED', finished_at = CURRENT_TIMESTAMP,
			message = CASE WHEN message = '' THEN 'Refresh lease expired' ELSE message END
		WHERE dataset = ? AND status = 'RUNNING' AND started_at < ?
	`, dataset, cutoff); err != nil {
		return 0, false, err
	}
	result, err := db.ExecContext(ctx, `
		INSERT INTO data_refresh_runs (dataset, trigger_source, status, started_at)
		VALUES (?, ?, 'RUNNING', ?)
	`, dataset, trigger, now.UTC().Format("2006-01-02 15:04:05"))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return 0, false, nil
		}
		return 0, false, err
	}
	id, err := result.LastInsertId()
	return id, true, err
}

func finishDataRefreshRun(ctx context.Context, runID int64, result dataRefreshExecutionResult) error {
	status := strings.ToUpper(strings.TrimSpace(result.Status))
	if status == "" {
		status = dataRefreshStatusComplete
		if len(result.Errors) > 0 && result.UpdatedCount > 0 {
			status = dataRefreshStatusPartial
		} else if len(result.Errors) > 0 {
			status = dataRefreshStatusFailed
		}
	}
	message := strings.TrimSpace(result.Message)
	if len(result.Errors) > 0 {
		errorText := strings.Join(result.Errors, "; ")
		if message != "" {
			message += "; "
		}
		message += errorText
	}
	if len(message) > 8000 {
		message = message[:8000]
	}
	_, err := db.ExecContext(ctx, `
		UPDATE data_refresh_runs
		SET status = ?, finished_at = CURRENT_TIMESTAMP, data_fresh_through = ?,
			expected_count = ?, updated_count = ?, error_count = ?, message = ?
		WHERE id = ?
	`, status, result.DataFreshThrough, result.ExpectedCount, result.UpdatedCount,
		len(result.Errors), message, runID)
	return err
}

func runTrackedDataRefresh(
	ctx context.Context,
	dataset string,
	trigger string,
	now time.Time,
	execute func(context.Context) dataRefreshExecutionResult,
) (bool, error) {
	runID, acquired, err := beginDataRefreshRun(ctx, dataset, trigger, now)
	if err != nil || !acquired {
		return acquired, err
	}
	result := execute(ctx)
	if err := finishDataRefreshRun(ctx, runID, result); err != nil {
		return true, err
	}
	return true, nil
}

func analysisPriceRefreshExecution(ctx context.Context) dataRefreshExecutionResult {
	result, err := refreshAnalysisPerformanceInternal(ctx, 1000)
	return analysisPriceExecutionFromResult(result, err)
}

func analysisPriceExecutionFromResult(result performanceRefreshResult, err error) dataRefreshExecutionResult {
	execution := dataRefreshExecutionResult{
		DataFreshThrough: result.DataFreshThrough,
		ExpectedCount:    result.ExpectedTickers,
		UpdatedCount:     result.UpdatedTickers,
		Errors:           append([]string{}, result.Errors...),
	}
	if err != nil {
		execution.Errors = append(execution.Errors, err.Error())
	}
	return execution
}

func etfMomentumRefreshExecution(ctx context.Context, now time.Time) dataRefreshExecutionResult {
	execution := dataRefreshExecutionResult{}
	if err := runETFMomentumAutomationCycle(ctx, now); err != nil {
		execution.Errors = append(execution.Errors, err.Error())
		return execution
	}
	run, err := latestETFMomentumRun(ctx)
	if err != nil {
		execution.Errors = append(execution.Errors, err.Error())
		return execution
	}
	if run == nil {
		execution.Errors = append(execution.Errors, "no ETF momentum evidence run exists")
		return execution
	}
	execution.DataFreshThrough = run.DataFreshThrough
	execution.ExpectedCount = run.ExpectedMembers
	execution.UpdatedCount = run.ReadyMembers
	if run.Status != "COMPLETE" {
		execution.Errors = append(execution.Errors, "latest ETF momentum evidence is incomplete")
	}
	if warning := strings.TrimSpace(loadStringSetting("etf_momentum_last_error", "")); warning != "" {
		execution.Errors = append(execution.Errors, warning)
	}
	execution.Message = loadStringSetting("etf_momentum_last_outcome", "")
	return execution
}

func commodityPriceRefreshExecution(ctx context.Context) dataRefreshExecutionResult {
	result, err := refreshCommodityPriceHistory(ctx)
	return commodityPriceExecutionFromResult(result, err)
}

func commodityPriceExecutionFromResult(result commodityPriceRefreshResult, err error) dataRefreshExecutionResult {
	execution := dataRefreshExecutionResult{
		DataFreshThrough: result.DataFreshThrough,
		ExpectedCount:    result.ExpectedSources,
		UpdatedCount:     result.UpdatedSources,
		Errors:           append([]string{}, result.Errors...),
	}
	if err != nil {
		execution.Errors = append(execution.Errors, err.Error())
	}
	return execution
}

func regimeReturnsRefreshExecution(ctx context.Context) dataRefreshExecutionResult {
	result, err := refreshRegimeReturns(ctx)
	return regimeReturnsExecutionFromResult(result, err)
}

func regimeReturnsExecutionFromResult(result regimeReturnsRefreshResult, err error) dataRefreshExecutionResult {
	execution := dataRefreshExecutionResult{
		DataFreshThrough: result.DataFreshThrough,
		ExpectedCount:    result.ExpectedTickers,
		UpdatedCount:     result.UpdatedTickers,
		Errors:           append([]string{}, result.Errors...),
	}
	if err != nil {
		execution.Errors = append(execution.Errors, err.Error())
	}
	return execution
}

func listingVerificationRefreshExecution(ctx context.Context, now time.Time) dataRefreshExecutionResult {
	var expected int
	_ = db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM stock_analysis
		WHERE ticker IS NOT NULL AND TRIM(ticker) <> ''
		  AND (COALESCE(is_watchlist, 0) = 1 OR COALESCE(is_external, 0) = 1)
	`).Scan(&expected)
	result := refreshWatchlistPricesInternal()
	freshThrough := now.UTC().Format("2006-01-02")
	return dataRefreshExecutionResult{
		DataFreshThrough: &freshThrough,
		ExpectedCount:    expected,
		UpdatedCount:     result.Updated,
		Errors:           append([]string{}, result.Errors...),
		Message:          fmt.Sprintf("open reviews %d; new reviews %d", result.OpenReviews, result.NewReviews),
	}
}

func newsDailyRefreshExecution(ctx context.Context, now time.Time) dataRefreshExecutionResult {
	date := now.UTC().Format("2006-01-02")
	if strings.TrimSpace(os.Getenv("XAI_API_KEY")) == "" {
		return dataRefreshExecutionResult{Status: dataRefreshStatusSkipped, Message: "XAI_API_KEY is not configured"}
	}
	if loadActiveNewsFoundationCohort(ctx) == nil {
		return dataRefreshExecutionResult{Status: dataRefreshStatusSkipped, Message: "No active News foundation cohort"}
	}
	var existingStatus string
	err := db.QueryRowContext(ctx, `
		SELECT status FROM news_daily_jobs
		WHERE date(created_at) = date(?)
		  AND status IN ('QUEUED', 'RUNNING', 'SUCCEEDED')
		ORDER BY created_at DESC LIMIT 1
	`, date).Scan(&existingStatus)
	if err == nil {
		freshThrough := date
		if existingStatus == "SUCCEEDED" {
			return dataRefreshExecutionResult{
				DataFreshThrough: &freshThrough,
				ExpectedCount:    1,
				UpdatedCount:     1,
				Message:          "Daily News job already succeeded",
			}
		}
		return dataRefreshExecutionResult{
			Status:           dataRefreshStatusSkipped,
			DataFreshThrough: &freshThrough,
			Message:          "Daily News job already " + strings.ToLower(existingStatus),
		}
	}
	if err != sql.ErrNoRows {
		return dataRefreshExecutionResult{Errors: []string{err.Error()}}
	}
	job, err := createNewsDailyJob(ctx)
	if err != nil {
		return dataRefreshExecutionResult{Errors: []string{err.Error()}}
	}
	jobContext, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	if err := runNewsDailyJobWithContext(jobContext, job.ID); err != nil {
		return dataRefreshExecutionResult{ExpectedCount: 1, Errors: []string{err.Error()}}
	}
	freshThrough := date
	return dataRefreshExecutionResult{
		DataFreshThrough: &freshThrough,
		ExpectedCount:    1,
		UpdatedCount:     1,
		Message:          "News daily job " + job.ID,
	}
}

func runDataRefreshAutomationCycle(ctx context.Context, now time.Time) {
	config := loadDataRefreshConfig()
	if !config.Enabled {
		return
	}

	type scheduledTask struct {
		dataset string
		enabled bool
		hour    int
		cadence string
		run     func(context.Context) dataRefreshExecutionResult
	}
	etfConfig := loadETFMomentumAutomationConfig()
	tasks := []scheduledTask{
		{dataRefreshAnalysisPriceHistory, true, config.DailyUTCHour, "DAILY", analysisPriceRefreshExecution},
		{dataRefreshETFMomentum, etfConfig.Enabled, etfConfig.DailyUTCHour, "DAILY", func(taskCtx context.Context) dataRefreshExecutionResult {
			return etfMomentumRefreshExecution(taskCtx, now)
		}},
		{dataRefreshCommodityPriceHistory, true, config.DailyUTCHour, "DAILY", commodityPriceRefreshExecution},
		{dataRefreshRegimeReturns, true, config.DailyUTCHour, "DAILY", regimeReturnsRefreshExecution},
		{dataRefreshListingVerification, config.ListingEnabled, config.ListingUTCHour, "WEEKLY", func(taskCtx context.Context) dataRefreshExecutionResult {
			return listingVerificationRefreshExecution(taskCtx, now)
		}},
		{dataRefreshNewsDaily, config.NewsEnabled, config.NewsDailyUTCHour, "DAILY", func(taskCtx context.Context) dataRefreshExecutionResult {
			return newsDailyRefreshExecution(taskCtx, now)
		}},
	}

	for _, task := range tasks {
		latest, err := loadLatestDataRefreshRun(ctx, task.dataset)
		if err != nil {
			log.Printf("[DATA REFRESH] Failed to inspect %s: %v", task.dataset, err)
			continue
		}
		if !dataRefreshDue(now, task.enabled, task.hour, task.cadence, latest) {
			continue
		}
		taskContext, cancel := context.WithTimeout(ctx, 12*time.Minute)
		started, runErr := runTrackedDataRefresh(taskContext, task.dataset, "SCHEDULED", now, task.run)
		cancel()
		if runErr != nil {
			log.Printf("[DATA REFRESH] %s failed: %v", task.dataset, runErr)
			continue
		}
		if started {
			log.Printf("[DATA REFRESH] %s cycle completed", task.dataset)
		}
	}
}

func startDataRefreshAutomation(ctx context.Context) {
	go func() {
		run := func() {
			cycleContext, cancel := context.WithTimeout(ctx, 45*time.Minute)
			defer cancel()
			runDataRefreshAutomationCycle(cycleContext, time.Now().UTC())
		}
		run()
		ticker := time.NewTicker(dataRefreshPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}

func dataRefreshDefinition(dataset string) dataRefreshDatasetDefinition {
	for _, definition := range dataRefreshDatasetDefinitions {
		if definition.Dataset == dataset {
			return definition
		}
	}
	return dataRefreshDatasetDefinition{Dataset: dataset}
}

func applyDataRefreshDefinition(run *dataRefreshRun, definition dataRefreshDatasetDefinition) {
	run.Source = definition.Source
	run.UpdateMode = definition.UpdateMode
	run.Cadence = definition.Cadence
	run.StaleAfterDays = definition.StaleAfterDays
	run.CoverageComplete = run.Status == dataRefreshStatusComplete
	if run.ErrorCount > 0 && strings.TrimSpace(run.Message) != "" {
		value := run.Message
		run.LastError = &value
	}
	if run.Status != dataRefreshStatusComplete && run.Status != dataRefreshStatusPartial {
		return
	}
	if definition.StaleAfterDays <= 0 || run.DataFreshThrough == nil {
		return
	}
	freshDate, ok := parseDatabaseTime(*run.DataFreshThrough)
	if ok && time.Since(freshDate) > time.Duration(definition.StaleAfterDays)*24*time.Hour {
		run.Status = dataRefreshStatusStale
	}
}

func syntheticBrokerStatementFreshness(ctx context.Context) dataRefreshRun {
	definition := dataRefreshDefinition(dataRefreshBrokerStatements)
	run := dataRefreshRun{Dataset: definition.Dataset, Status: dataRefreshStatusNeverRun}
	var statementDate, createdAt sql.NullString
	var count int
	err := db.QueryRowContext(ctx, `
		SELECT MAX(statement_date), MAX(created_at), COUNT(*) FROM account_statements
	`).Scan(&statementDate, &createdAt, &count)
	if err == nil && statementDate.Valid {
		run.Status = dataRefreshStatusComplete
		run.StartedAt = createdAt.String
		run.LastSuccessAt = &createdAt.String
		run.DataFreshThrough = &statementDate.String
		run.ExpectedCount = 1
		run.UpdatedCount = 1
		run.Message = fmt.Sprintf("Latest accepted broker statement; %d statements retained", count)
	}
	applyDataRefreshDefinition(&run, definition)
	return run
}

func syntheticTradingViewFreshness(ctx context.Context) dataRefreshRun {
	definition := dataRefreshDefinition(dataRefreshTradingViewSignals)
	run := dataRefreshRun{Dataset: definition.Dataset, Status: dataRefreshStatusNeverRun}
	var latest sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT MAX(event_time) FROM (
			SELECT CAST(created_at AS TEXT) AS event_time FROM alerts
			UNION ALL
			SELECT CAST(last_updated AS TEXT) AS event_time FROM regimes
			UNION ALL
			SELECT CAST(created_at AS TEXT) AS event_time FROM etf_rebalance_targets
			UNION ALL
			SELECT CAST(received_at AS TEXT) AS event_time FROM commodity_theme_events
			UNION ALL
			SELECT CAST(received_at AS TEXT) AS event_time FROM equity_sizing_history
		)
	`).Scan(&latest)
	if err == nil && latest.Valid {
		run.Status = dataRefreshStatusComplete
		run.StartedAt = latest.String
		run.LastSuccessAt = &latest.String
		run.DataFreshThrough = &latest.String
		run.UpdatedCount = 1
		run.Message = "Latest accepted TradingView event"
	}
	applyDataRefreshDefinition(&run, definition)
	return run
}

func getDataFreshness(w http.ResponseWriter, r *http.Request) {
	response := dataFreshnessResponse{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Scheduler:   loadDataRefreshConfig(),
		Datasets:    make([]dataRefreshRun, 0, len(dataRefreshDatasetDefinitions)),
	}
	for _, definition := range dataRefreshDatasetDefinitions {
		if definition.Dataset == dataRefreshBrokerStatements || definition.Dataset == dataRefreshTradingViewSignals {
			continue
		}
		run, err := loadLatestDataRefreshRun(r.Context(), definition.Dataset)
		if err != nil {
			http.Error(w, "Failed to load data freshness", http.StatusInternalServerError)
			return
		}
		if run == nil {
			run = &dataRefreshRun{Dataset: definition.Dataset, Status: dataRefreshStatusNeverRun}
		}
		applyDataRefreshDefinition(run, definition)
		response.Datasets = append(response.Datasets, *run)
	}
	response.Datasets = append(response.Datasets,
		syntheticBrokerStatementFreshness(r.Context()),
		syntheticTradingViewFreshness(r.Context()),
	)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func manualDataRefreshConflict(w http.ResponseWriter, dataset string) {
	http.Error(w, fmt.Sprintf("%s refresh is already running", dataset), http.StatusConflict)
}

func beginManualDataRefresh(w http.ResponseWriter, r *http.Request, dataset string) (int64, bool) {
	runID, acquired, err := beginDataRefreshRun(r.Context(), dataset, "MANUAL", time.Now().UTC())
	if err != nil {
		http.Error(w, "Failed to start data refresh", http.StatusInternalServerError)
		return 0, false
	}
	if !acquired {
		manualDataRefreshConflict(w, dataset)
		return 0, false
	}
	return runID, true
}

func finishManualDataRefresh(w http.ResponseWriter, r *http.Request, runID int64, result dataRefreshExecutionResult) bool {
	if err := finishDataRefreshRun(r.Context(), runID, result); err != nil {
		http.Error(w, "Refresh completed but its audit record could not be saved", http.StatusInternalServerError)
		return false
	}
	return true
}
