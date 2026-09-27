package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

const (
	etfMomentumCadenceManual            = "MANUAL"
	etfMomentumCadenceDaily             = "DAILY"
	etfMomentumCadenceWeekly            = "WEEKLY"
	etfMomentumCadenceMonthly           = "MONTHLY"
	etfMomentumCadenceEightyTradingDays = "EIGHTY_TRADING_DAYS"
	etfMomentumAutomationPollInterval   = 30 * time.Minute
	etfMomentumAutomationRetryInterval  = 2 * time.Hour
)

type ETFMomentumAutomationStatus struct {
	Enabled                   bool    `json:"enabled"`
	DailyUTCHour              int     `json:"daily_utc_hour"`
	PublishCadence            string  `json:"publish_cadence"`
	LastAttemptAt             *string `json:"last_attempt_at,omitempty"`
	LastSuccessAt             *string `json:"last_success_at,omitempty"`
	LastOutcome               string  `json:"last_outcome"`
	LastError                 string  `json:"last_error,omitempty"`
	PublishedRunID            *int64  `json:"published_run_id,omitempty"`
	PublishedDataFreshThrough *string `json:"published_data_fresh_through,omitempty"`
	TradingSessionsElapsed    int     `json:"trading_sessions_elapsed"`
	TradingSessionsRequired   int     `json:"trading_sessions_required"`
}

type etfMomentumAutomationConfig struct {
	Enabled        bool
	DailyUTCHour   int
	PublishCadence string
}

func saveETFSetting(key, value string) error {
	_, err := db.Exec(`
		INSERT INTO settings (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`, key, value)
	return err
}

func normalizeETFMomentumCadence(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case etfMomentumCadenceManual:
		return etfMomentumCadenceManual
	case etfMomentumCadenceDaily:
		return etfMomentumCadenceDaily
	case etfMomentumCadenceWeekly:
		return etfMomentumCadenceWeekly
	case etfMomentumCadenceMonthly:
		return etfMomentumCadenceMonthly
	default:
		return etfMomentumCadenceEightyTradingDays
	}
}

func loadETFMomentumAutomationConfig() etfMomentumAutomationConfig {
	enabled, err := strconv.ParseBool(strings.TrimSpace(loadStringSetting("etf_momentum_automation_enabled", "true")))
	if err != nil {
		enabled = true
	}
	hour, err := strconv.Atoi(strings.TrimSpace(loadStringSetting("etf_momentum_daily_utc_hour", "10")))
	if err != nil || hour < 0 || hour > 23 {
		hour = 10
	}
	return etfMomentumAutomationConfig{
		Enabled:        enabled,
		DailyUTCHour:   hour,
		PublishCadence: normalizeETFMomentumCadence(loadStringSetting("etf_momentum_publish_cadence", etfMomentumCadenceEightyTradingDays)),
	}
}

func parseETFSettingTime(key string) *time.Time {
	raw := strings.TrimSpace(loadStringSetting(key, ""))
	if raw == "" {
		return nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil
	}
	value = value.UTC()
	return &value
}

func etfMomentumAutomationDue(now time.Time, config etfMomentumAutomationConfig, lastAttempt, lastSuccess *time.Time) bool {
	if !config.Enabled {
		return false
	}
	now = now.UTC()
	if now.Hour() < config.DailyUTCHour {
		return false
	}
	if lastSuccess != nil && lastSuccess.UTC().Format("2006-01-02") == now.Format("2006-01-02") {
		return false
	}
	if lastAttempt != nil && now.Sub(lastAttempt.UTC()) < etfMomentumAutomationRetryInterval {
		return false
	}
	return true
}

func countETFMomentumTradingSessions(ctx context.Context, afterDate, throughDate string) (int, error) {
	if strings.TrimSpace(afterDate) == "" || strings.TrimSpace(throughDate) == "" || throughDate <= afterDate {
		return 0, nil
	}
	var ticker, exchangePrefix string
	if err := db.QueryRowContext(ctx, `
		SELECT display_ticker, exchange_prefix
		FROM etf_momentum_universe_members
		WHERE universe_code = ? AND active = 1
		ORDER BY display_order ASC, id ASC
		LIMIT 1
	`, etfMomentumLegacyUniverseCode).Scan(&ticker, &exchangePrefix); err != nil {
		return 0, err
	}
	var count int
	err := db.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT observed_date)
		FROM security_price_daily
		WHERE ticker = ?
		  AND exchange_prefix = ?
		  AND source = ?
		  AND observed_date > ?
		  AND observed_date <= ?
	`, ticker, exchangePrefix, etfMomentumYahooSource, afterDate, throughDate).Scan(&count)
	return count, err
}

// currentETFMomentumDataFreshThrough returns the oldest latest-price date in
// the active universe. A nil date means at least one member has no cached data,
// so it cannot be treated as a complete evidence date.
func currentETFMomentumDataFreshThrough(ctx context.Context) (*string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT m.display_ticker, MAX(p.observed_date)
		FROM etf_momentum_universe_members m
		LEFT JOIN security_price_daily p
		  ON p.ticker = m.display_ticker
		 AND p.exchange_prefix = m.exchange_prefix
		 AND p.source = ?
		WHERE m.universe_code = ? AND m.active = 1
		GROUP BY m.id, m.display_ticker
		ORDER BY m.display_order ASC, m.id ASC
	`, etfMomentumYahooSource, etfMomentumLegacyUniverseCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	earliest := ""
	memberCount := 0
	for rows.Next() {
		var ticker string
		var latest sql.NullString
		if err := rows.Scan(&ticker, &latest); err != nil {
			return nil, err
		}
		memberCount++
		if !latest.Valid || strings.TrimSpace(latest.String) == "" {
			return nil, nil
		}
		value := strings.TrimSpace(latest.String)
		if len(value) >= 10 {
			value = value[:10]
		}
		if earliest == "" || value < earliest {
			earliest = value
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if memberCount == 0 || earliest == "" {
		return nil, nil
	}
	return &earliest, nil
}

func etfMomentumPublicationDue(
	ctx context.Context,
	cadence string,
	publishedRun *ETFMomentumRunResponse,
	candidateRun *ETFMomentumRunResponse,
) (bool, string, int, error) {
	if candidateRun == nil || candidateRun.Status != "COMPLETE" || candidateRun.DataFreshThrough == nil {
		return false, "", 0, nil
	}
	if publishedRun == nil || publishedRun.DataFreshThrough == nil {
		return true, "INITIAL_BASELINE", 0, nil
	}
	if *candidateRun.DataFreshThrough <= *publishedRun.DataFreshThrough {
		return false, "", 0, nil
	}

	sessions, err := countETFMomentumTradingSessions(
		ctx,
		*publishedRun.DataFreshThrough,
		*candidateRun.DataFreshThrough,
	)
	if err != nil {
		return false, "", 0, err
	}

	switch normalizeETFMomentumCadence(cadence) {
	case etfMomentumCadenceDaily:
		return true, "DAILY_CADENCE", sessions, nil
	case etfMomentumCadenceWeekly:
		return sessions >= 5, "WEEKLY_CADENCE", sessions, nil
	case etfMomentumCadenceMonthly:
		publishedDate, publishedErr := time.Parse("2006-01-02", *publishedRun.DataFreshThrough)
		candidateDate, candidateErr := time.Parse("2006-01-02", *candidateRun.DataFreshThrough)
		if publishedErr != nil || candidateErr != nil {
			return false, "", sessions, fmt.Errorf("invalid ETF momentum publication date")
		}
		publishedMonth := publishedDate.Format("2006-01")
		candidateMonth := candidateDate.Format("2006-01")
		return candidateMonth > publishedMonth, "MONTHLY_CADENCE", sessions, nil
	case etfMomentumCadenceEightyTradingDays:
		return sessions >= 80, "EIGHTY_TRADING_DAY_CADENCE", sessions, nil
	default:
		return false, "", sessions, nil
	}
}

func publishETFMomentumRun(ctx context.Context, runID int64, reason string) error {
	result, err := db.ExecContext(ctx, `
		UPDATE etf_momentum_runs
		SET published_at = CURRENT_TIMESTAMP,
			publication_reason = ?
		WHERE id = ? AND status = 'COMPLETE'
	`, strings.TrimSpace(reason), runID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("ETF momentum run %d is not complete or does not exist", runID)
	}
	return nil
}

func loadETFMomentumAutomationStatus(
	ctx context.Context,
	publishedRun *ETFMomentumRunResponse,
) ETFMomentumAutomationStatus {
	config := loadETFMomentumAutomationConfig()
	status := ETFMomentumAutomationStatus{
		Enabled:                 config.Enabled,
		DailyUTCHour:            config.DailyUTCHour,
		PublishCadence:          config.PublishCadence,
		LastOutcome:             loadStringSetting("etf_momentum_last_outcome", "NOT_RUN"),
		LastError:               loadStringSetting("etf_momentum_last_error", ""),
		TradingSessionsRequired: 80,
	}
	if config.PublishCadence == etfMomentumCadenceDaily {
		status.TradingSessionsRequired = 1
	} else if config.PublishCadence == etfMomentumCadenceWeekly {
		status.TradingSessionsRequired = 5
	} else if config.PublishCadence == etfMomentumCadenceMonthly || config.PublishCadence == etfMomentumCadenceManual {
		status.TradingSessionsRequired = 0
	}
	if value := parseETFSettingTime("etf_momentum_last_attempt_at"); value != nil {
		formatted := value.Format(time.RFC3339)
		status.LastAttemptAt = &formatted
	}
	if value := parseETFSettingTime("etf_momentum_last_success_at"); value != nil {
		formatted := value.Format(time.RFC3339)
		status.LastSuccessAt = &formatted
	}
	if publishedRun != nil {
		status.PublishedRunID = &publishedRun.ID
		status.PublishedDataFreshThrough = publishedRun.DataFreshThrough
		if latestRun, err := latestETFMomentumRun(ctx); err == nil && latestRun != nil && latestRun.DataFreshThrough != nil && publishedRun.DataFreshThrough != nil {
			status.TradingSessionsElapsed, _ = countETFMomentumTradingSessions(ctx, *publishedRun.DataFreshThrough, *latestRun.DataFreshThrough)
		}
	}
	return status
}

func runETFMomentumAutomationCycle(ctx context.Context, now time.Time) error {
	now = now.UTC()
	if err := saveETFSetting("etf_momentum_last_attempt_at", now.Format(time.RFC3339)); err != nil {
		return err
	}

	refreshResult, err := refreshETFMomentumPriceHistory(ctx)
	if err != nil {
		_ = saveETFSetting("etf_momentum_last_error", err.Error())
		_ = saveETFSetting("etf_momentum_last_outcome", "PRICE_REFRESH_FAILED")
		return err
	}
	latestRun, err := latestETFMomentumRun(ctx)
	if err != nil {
		return err
	}
	currentFreshThrough, err := currentETFMomentumDataFreshThrough(ctx)
	if err != nil {
		return err
	}
	if latestRun != nil && latestRun.Status == "COMPLETE" &&
		latestRun.DataFreshThrough != nil && currentFreshThrough != nil &&
		*latestRun.DataFreshThrough == *currentFreshThrough {
		errorText := ""
		if len(refreshResult.Errors) > 0 {
			errorText = strings.Join(refreshResult.Errors, "; ")
		}
		if err := saveETFSetting("etf_momentum_last_success_at", now.Format(time.RFC3339)); err != nil {
			return err
		}
		_ = saveETFSetting("etf_momentum_last_outcome", "NO_NEW_PRICE_DATA")
		_ = saveETFSetting("etf_momentum_last_error", errorText)
		return nil
	}

	runID, err := runETFMomentumParity(ctx, now)
	if err != nil {
		_ = saveETFSetting("etf_momentum_last_error", err.Error())
		_ = saveETFSetting("etf_momentum_last_outcome", "CALCULATION_FAILED")
		return err
	}
	candidate, err := loadETFMomentumRun(ctx, runID)
	if err != nil {
		return err
	}
	published, err := latestPublishedETFMomentumRun(ctx)
	if err != nil {
		return err
	}
	config := loadETFMomentumAutomationConfig()
	due, reason, _, err := etfMomentumPublicationDue(ctx, config.PublishCadence, published, candidate)
	if err != nil {
		return err
	}
	outcome := "EVIDENCE_UPDATED"
	if candidate != nil && candidate.Status != "COMPLETE" {
		outcome = "INCOMPLETE_EVIDENCE"
	}
	if due {
		if err := publishETFMomentumRun(ctx, runID, reason); err != nil {
			return err
		}
		outcome = "WEIGHTS_PUBLISHED"
	}
	errorText := ""
	if len(refreshResult.Errors) > 0 {
		errorText = strings.Join(refreshResult.Errors, "; ")
	}
	if err := saveETFSetting("etf_momentum_last_success_at", now.Format(time.RFC3339)); err != nil {
		return err
	}
	_ = saveETFSetting("etf_momentum_last_outcome", outcome)
	_ = saveETFSetting("etf_momentum_last_error", errorText)
	return nil
}

func startETFMomentumAutomation(ctx context.Context) {
	go func() {
		runIfDue := func() {
			config := loadETFMomentumAutomationConfig()
			now := time.Now().UTC()
			if !etfMomentumAutomationDue(
				now,
				config,
				parseETFSettingTime("etf_momentum_last_attempt_at"),
				parseETFSettingTime("etf_momentum_last_success_at"),
			) {
				return
			}
			cycleContext, cancel := context.WithTimeout(ctx, 10*time.Minute)
			defer cancel()
			if err := runETFMomentumAutomationCycle(cycleContext, now); err != nil {
				log.Printf("[ETF MOMENTUM] Automated daily cycle failed: %v", err)
				return
			}
			log.Printf("[ETF MOMENTUM] Automated daily cycle completed")
		}

		runIfDue()
		ticker := time.NewTicker(etfMomentumAutomationPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runIfDue()
			}
		}
	}()
}

func ensureETFMomentumAutomationSettings() error {
	defaults := map[string]string{
		"etf_momentum_automation_enabled": "true",
		"etf_momentum_daily_utc_hour":     "10",
		"etf_momentum_publish_cadence":    etfMomentumCadenceEightyTradingDays,
	}
	for key, value := range defaults {
		if _, err := db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`, key, value); err != nil {
			return err
		}
	}
	if _, err := db.Exec(`
		UPDATE settings
		SET value = 'INTERNAL_PUBLISHED', updated_at = CURRENT_TIMESTAMP
		WHERE key = 'etf_momentum_source' AND value = 'INTERNAL_LATEST_COMPLETE'
	`); err != nil && err != sql.ErrNoRows {
		return err
	}
	return nil
}
