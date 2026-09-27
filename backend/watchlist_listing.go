package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	listingProviderYahoo = "YAHOO"

	listingCheckActive      = "ACTIVE"
	listingCheckUnavailable = "UNAVAILABLE"
	listingCheckSourceError = "SOURCE_ERROR"

	listingReviewNameChange  = "NAME_CHANGE_CANDIDATE"
	listingReviewUnavailable = "LISTING_UNAVAILABLE"
	listingReviewOpen        = "OPEN"
)

// watchlistListingSnapshot is an observation from a quote provider. It is
// deliberately advisory: no provider response can change a security identity
// without an explicit user decision.
type watchlistListingSnapshot struct {
	Price                  float64
	Provider               string
	ObservedTicker         string
	ObservedExchangePrefix string
	ObservedName           string
	QuoteType              string
}

type watchlistPriceRefreshResult struct {
	Updated     int      `json:"updated"`
	Errors      []string `json:"errors"`
	OpenReviews int      `json:"open_reviews"`
	NewReviews  int      `json:"new_reviews"`
}

type listingReviewResponse struct {
	ID             int       `json:"id"`
	SecurityID     int64     `json:"security_id"`
	AnalysisID     int       `json:"analysis_id"`
	Name           string    `json:"name"`
	Ticker         string    `json:"ticker"`
	ReviewType     string    `json:"review_type"`
	Provider       string    `json:"provider"`
	CurrentName    string    `json:"current_name"`
	ObservedName   string    `json:"observed_name"`
	CurrentTicker  string    `json:"current_ticker"`
	ObservedTicker string    `json:"observed_ticker"`
	FirstSeenAt    time.Time `json:"first_seen_at"`
	LastSeenAt     time.Time `json:"last_seen_at"`
	SeenCount      int       `json:"seen_count"`
}

// The indirection keeps provider behaviour deterministic in backend tests.
var watchlistListingSnapshotFetcher = fetchYahooListingSnapshot

func ensureWatchlistListingSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS security_listing_checks (
			security_id INTEGER NOT NULL,
			provider TEXT NOT NULL,
			requested_exchange_prefix TEXT NOT NULL DEFAULT '',
			requested_ticker TEXT NOT NULL DEFAULT '',
			observed_exchange_prefix TEXT NOT NULL DEFAULT '',
			observed_ticker TEXT NOT NULL DEFAULT '',
			observed_name TEXT NOT NULL DEFAULT '',
			quote_type TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'UNAVAILABLE', 'SOURCE_ERROR')),
			last_error TEXT NOT NULL DEFAULT '',
			consecutive_failures INTEGER NOT NULL DEFAULT 0,
			last_checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_success_at DATETIME,
			PRIMARY KEY (security_id, provider),
			FOREIGN KEY (security_id) REFERENCES security_identities(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS security_listing_reviews (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			security_id INTEGER NOT NULL,
			review_type TEXT NOT NULL CHECK(review_type IN ('NAME_CHANGE_CANDIDATE', 'LISTING_UNAVAILABLE')),
			provider TEXT NOT NULL,
			current_name TEXT NOT NULL DEFAULT '',
			observed_name TEXT NOT NULL DEFAULT '',
			current_ticker TEXT NOT NULL DEFAULT '',
			observed_ticker TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'DISMISSED', 'RESOLVED', 'SUPERSEDED')),
			dedupe_key TEXT NOT NULL UNIQUE,
			first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			seen_count INTEGER NOT NULL DEFAULT 1,
			resolved_at DATETIME,
			resolution_note TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (security_id) REFERENCES security_identities(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_security_listing_reviews_open
			ON security_listing_reviews(status, last_seen_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func ensureAnalysisSecurityIdentity(analysisID int, ticker, name, source string) (int64, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	securityID, err := ensureAnalysisSecurityIdentityTx(tx, analysisID, ticker, name, source)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return securityID, nil
}

func ensureAnalysisSecurityIdentityTx(tx *sql.Tx, analysisID int, ticker, name, source string) (int64, error) {
	securityID, err := ensureSecurityIdentityTx(tx, securityIdentityCandidate{
		Ticker: ticker,
		Name:   name,
	}, source, false)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`UPDATE stock_analysis SET security_id = ? WHERE id = ?`, securityID, analysisID); err != nil {
		return 0, err
	}
	return securityID, nil
}

func fetchYahooListingSnapshot(ticker string, exchangePrefix string) (watchlistListingSnapshot, error) {
	yahooSymbol := yahooSymbolForTicker(ticker, exchangePrefix)
	if yahooSymbol == "" {
		return watchlistListingSnapshot{}, fmt.Errorf("empty yahoo symbol")
	}

	requestURL := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=1d",
		url.PathEscape(yahooSymbol),
	)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return watchlistListingSnapshot{}, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := client.Do(req)
	if err != nil {
		return watchlistListingSnapshot{}, fmt.Errorf("yahoo finance request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return watchlistListingSnapshot{}, fmt.Errorf("yahoo status %d", resp.StatusCode)
	}

	var result struct {
		Chart struct {
			Result []struct {
				Meta struct {
					RegularMarketPrice float64 `json:"regularMarketPrice"`
					Symbol             string  `json:"symbol"`
					LongName           string  `json:"longName"`
					ShortName          string  `json:"shortName"`
					InstrumentType     string  `json:"instrumentType"`
				} `json:"meta"`
			} `json:"result"`
			Error *struct {
				Description string `json:"description"`
			} `json:"error"`
		} `json:"chart"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return watchlistListingSnapshot{}, fmt.Errorf("failed to parse yahoo response: %w", err)
	}
	if result.Chart.Error != nil {
		return watchlistListingSnapshot{}, fmt.Errorf("yahoo error: %s", result.Chart.Error.Description)
	}
	if len(result.Chart.Result) == 0 {
		return watchlistListingSnapshot{}, fmt.Errorf("no price data for %s", yahooSymbol)
	}

	meta := result.Chart.Result[0].Meta
	snapshot := watchlistListingSnapshot{
		Price:                  meta.RegularMarketPrice,
		Provider:               listingProviderYahoo,
		ObservedTicker:         strings.ToUpper(strings.TrimSpace(meta.Symbol)),
		ObservedExchangePrefix: normaliseExchangePrefix(exchangePrefix),
		ObservedName:           strings.TrimSpace(meta.LongName),
		QuoteType:              strings.ToUpper(strings.TrimSpace(meta.InstrumentType)),
	}
	if snapshot.ObservedTicker == "" {
		snapshot.ObservedTicker = strings.ToUpper(strings.TrimSpace(yahooSymbol))
	}
	if snapshot.ObservedName == "" {
		snapshot.ObservedName = strings.TrimSpace(meta.ShortName)
	}
	if snapshot.ObservedName == "" {
		if name, quoteType, observedTicker, lookupErr := fetchYahooExactListingMetadata(yahooSymbol); lookupErr == nil {
			snapshot.ObservedName = name
			if quoteType != "" {
				snapshot.QuoteType = quoteType
			}
			if observedTicker != "" {
				snapshot.ObservedTicker = observedTicker
			}
		}
	}
	return snapshot, nil
}

func fetchYahooExactListingMetadata(yahooSymbol string) (name string, quoteType string, observedTicker string, err error) {
	requestURL := fmt.Sprintf(
		"https://query2.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=10&newsCount=0",
		url.QueryEscape(yahooSymbol),
	)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return "", "", "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := client.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", "", "", fmt.Errorf("yahoo search status %d", resp.StatusCode)
	}

	var result struct {
		Quotes []struct {
			Symbol    string `json:"symbol"`
			ShortName string `json:"shortname"`
			LongName  string `json:"longname"`
			QuoteType string `json:"quoteType"`
		} `json:"quotes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", "", err
	}
	wanted := strings.ToUpper(strings.TrimSpace(yahooSymbol))
	for _, quote := range result.Quotes {
		if strings.ToUpper(strings.TrimSpace(quote.Symbol)) != wanted {
			continue
		}
		name = strings.TrimSpace(quote.LongName)
		if name == "" {
			name = strings.TrimSpace(quote.ShortName)
		}
		return name, strings.ToUpper(strings.TrimSpace(quote.QuoteType)), wanted, nil
	}
	return "", "", "", fmt.Errorf("no exact yahoo listing metadata for %s", yahooSymbol)
}

func normalizedListingName(name string) string {
	value := strings.ToLower(strings.TrimSpace(name))
	value = strings.NewReplacer("&", " and ", ".", " ", ",", " ", "-", " ").Replace(value)
	parts := strings.Fields(value)
	legalSuffixes := map[string]bool{
		"ltd": true, "limited": true, "inc": true, "incorporated": true,
		"corp": true, "corporation": true, "plc": true, "nl": true,
	}
	for len(parts) > 1 && legalSuffixes[parts[len(parts)-1]] {
		parts = parts[:len(parts)-1]
	}
	return strings.Join(parts, " ")
}

func listingNamesMatch(currentName, observedName string) bool {
	current := normalizedListingName(currentName)
	observed := normalizedListingName(observedName)
	return current != "" && observed != "" && current == observed
}

func listingFailureStatus(err error) string {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "status 404") ||
		strings.Contains(message, "no price data") ||
		strings.Contains(message, "no chart data") ||
		strings.Contains(message, "delisted") ||
		strings.Contains(message, "not found") {
		return listingCheckUnavailable
	}
	return listingCheckSourceError
}

func listingReviewKey(securityID int64, reviewType, provider, observedName, observedTicker string) string {
	return strings.Join([]string{
		fmt.Sprintf("%d", securityID),
		reviewType,
		strings.ToUpper(strings.TrimSpace(provider)),
		normalizedListingName(observedName),
		strings.ToUpper(strings.TrimSpace(observedTicker)),
	}, "|")
}

func upsertListingCheckTx(tx *sql.Tx, securityID int64, provider, requestedTicker, requestedPrefix string, snapshot *watchlistListingSnapshot, status, errorMessage string) (int, error) {
	provider = strings.ToUpper(strings.TrimSpace(provider))
	var previousFailures int
	err := tx.QueryRow(`
		SELECT consecutive_failures
		FROM security_listing_checks
		WHERE security_id = ? AND provider = ?
	`, securityID, provider).Scan(&previousFailures)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}

	failures := 0
	if status != listingCheckActive {
		failures = previousFailures + 1
	}
	observedTicker := ""
	observedPrefix := ""
	observedName := ""
	quoteType := ""
	if snapshot != nil {
		observedTicker = snapshot.ObservedTicker
		observedPrefix = snapshot.ObservedExchangePrefix
		observedName = snapshot.ObservedName
		quoteType = snapshot.QuoteType
	}
	_, err = tx.Exec(`
		INSERT INTO security_listing_checks (
			security_id, provider, requested_exchange_prefix, requested_ticker,
			observed_exchange_prefix, observed_ticker, observed_name, quote_type,
			status, last_error, consecutive_failures, last_checked_at, last_success_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
			CASE WHEN ? = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE NULL END)
		ON CONFLICT(security_id, provider) DO UPDATE SET
			requested_exchange_prefix = excluded.requested_exchange_prefix,
			requested_ticker = excluded.requested_ticker,
			observed_exchange_prefix = excluded.observed_exchange_prefix,
			observed_ticker = excluded.observed_ticker,
			observed_name = excluded.observed_name,
			quote_type = excluded.quote_type,
			status = excluded.status,
			last_error = excluded.last_error,
			consecutive_failures = excluded.consecutive_failures,
			last_checked_at = CURRENT_TIMESTAMP,
			last_success_at = CASE WHEN excluded.status = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE security_listing_checks.last_success_at END
	`, securityID, provider, requestedPrefix, requestedTicker,
		observedPrefix, observedTicker, observedName, quoteType,
		status, errorMessage, failures, status)
	return failures, err
}

func upsertListingReviewTx(tx *sql.Tx, securityID int64, reviewType, provider, currentName, observedName, currentTicker, observedTicker string) (bool, error) {
	dedupeKey := listingReviewKey(securityID, reviewType, provider, observedName, observedTicker)
	var existingID int
	err := tx.QueryRow(`SELECT id FROM security_listing_reviews WHERE dedupe_key = ?`, dedupeKey).Scan(&existingID)
	if err == sql.ErrNoRows {
		_, err = tx.Exec(`
			INSERT INTO security_listing_reviews (
				security_id, review_type, provider, current_name, observed_name,
				current_ticker, observed_ticker, status, dedupe_key
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, securityID, reviewType, provider, currentName, observedName, currentTicker, observedTicker, listingReviewOpen, dedupeKey)
		return err == nil, err
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(`
		UPDATE security_listing_reviews
		SET current_name = ?, observed_name = ?, current_ticker = ?, observed_ticker = ?,
			status = ?, last_seen_at = CURRENT_TIMESTAMP, seen_count = seen_count + 1
		WHERE id = ?
	`, currentName, observedName, currentTicker, observedTicker, listingReviewOpen, existingID)
	return false, err
}

func recordWatchlistListingSuccess(analysisID int, ticker, name string, snapshot watchlistListingSnapshot) (bool, error) {
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	securityID, err := ensureAnalysisSecurityIdentityTx(tx, analysisID, ticker, name, "watchlist_verification")
	if err != nil {
		return false, err
	}
	prefix, symbol := splitSecurityTicker("", ticker)
	if _, err := upsertListingCheckTx(tx, securityID, snapshot.Provider, symbol, prefix, &snapshot, listingCheckActive, ""); err != nil {
		return false, err
	}

	createdReview := false
	if snapshot.ObservedName != "" && !listingNamesMatch(name, snapshot.ObservedName) {
		createdReview, err = upsertListingReviewTx(
			tx,
			securityID,
			listingReviewNameChange,
			snapshot.Provider,
			name,
			snapshot.ObservedName,
			strings.ToUpper(strings.TrimSpace(ticker)),
			snapshot.ObservedTicker,
		)
		if err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return createdReview, nil
}

func recordWatchlistListingFailure(analysisID int, ticker, name string, fetchErr error) (bool, error) {
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	securityID, err := ensureAnalysisSecurityIdentityTx(tx, analysisID, ticker, name, "watchlist_verification")
	if err != nil {
		return false, err
	}
	prefix, symbol := splitSecurityTicker("", ticker)
	status := listingFailureStatus(fetchErr)
	failures, err := upsertListingCheckTx(tx, securityID, listingProviderYahoo, symbol, prefix, nil, status, fetchErr.Error())
	if err != nil {
		return false, err
	}

	createdReview := false
	if status == listingCheckUnavailable && failures >= 2 {
		createdReview, err = upsertListingReviewTx(
			tx,
			securityID,
			listingReviewUnavailable,
			listingProviderYahoo,
			name,
			"",
			strings.ToUpper(strings.TrimSpace(ticker)),
			"",
		)
		if err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return createdReview, nil
}

func countOpenListingReviews() (int, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM security_listing_reviews WHERE status = ?`, listingReviewOpen).Scan(&count)
	return count, err
}

func getListingReviews(w http.ResponseWriter, r *http.Request) {
	rows, err := db.QueryContext(r.Context(), `
		SELECT
			reviews.id,
			reviews.security_id,
			COALESCE(analysis.id, 0),
			COALESCE(analysis.name, identities.canonical_name),
			COALESCE(NULLIF(analysis.ticker, ''), identities.exchange_prefix || identities.ticker),
			reviews.review_type,
			reviews.provider,
			reviews.current_name,
			reviews.observed_name,
			reviews.current_ticker,
			reviews.observed_ticker,
			reviews.first_seen_at,
			reviews.last_seen_at,
			reviews.seen_count
		FROM security_listing_reviews reviews
		JOIN security_identities identities ON identities.id = reviews.security_id
		LEFT JOIN stock_analysis analysis ON analysis.id = (
			SELECT candidate.id
			FROM stock_analysis candidate
			WHERE candidate.security_id = reviews.security_id
			ORDER BY candidate.updated_at DESC, candidate.id ASC
			LIMIT 1
		)
		WHERE reviews.status = ?
		ORDER BY reviews.last_seen_at DESC, reviews.id DESC
	`, listingReviewOpen)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	reviews := make([]listingReviewResponse, 0)
	for rows.Next() {
		var review listingReviewResponse
		if err := rows.Scan(
			&review.ID,
			&review.SecurityID,
			&review.AnalysisID,
			&review.Name,
			&review.Ticker,
			&review.ReviewType,
			&review.Provider,
			&review.CurrentName,
			&review.ObservedName,
			&review.CurrentTicker,
			&review.ObservedTicker,
			&review.FirstSeenAt,
			&review.LastSeenAt,
			&review.SeenCount,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		reviews = append(reviews, review)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(reviews)
}
