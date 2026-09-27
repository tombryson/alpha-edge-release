package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWatchlistUpsertEstablishesStableIdentity(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/analysis",
		bytes.NewBufferString(`{"ticker":"ASX:IDT","name":"Identity Test Limited","is_watchlist":true}`),
	)
	response := httptest.NewRecorder()
	upsertAnalysis(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("upsert response: got %d want %d body=%s", response.Code, http.StatusOK, response.Body.String())
	}

	var securityID int64
	if err := db.QueryRow(`SELECT security_id FROM stock_analysis WHERE ticker = 'ASX:IDT'`).Scan(&securityID); err != nil {
		t.Fatalf("read analysis identity: %v", err)
	}
	if securityID == 0 {
		t.Fatal("watchlist upsert did not link a security identity")
	}

	var prefix, ticker, canonicalName string
	if err := db.QueryRow(`
		SELECT exchange_prefix, ticker, canonical_name
		FROM security_identities
		WHERE id = ?
	`, securityID).Scan(&prefix, &ticker, &canonicalName); err != nil {
		t.Fatalf("read stable identity: %v", err)
	}
	if prefix != "ASX:" || ticker != "IDT" || canonicalName != "Identity Test Limited" {
		t.Fatalf("identity = %q/%q/%q", prefix, ticker, canonicalName)
	}
}

func TestWatchlistRefreshRecordsNameCandidateWithoutChangingSecurity(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	inserted, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, is_watchlist)
		VALUES ('ASX:OLD', 'Old Resources Ltd', 1)
	`)
	if err != nil {
		t.Fatalf("insert watchlist row: %v", err)
	}
	analysisID64, err := inserted.LastInsertId()
	if err != nil {
		t.Fatalf("read analysis id: %v", err)
	}

	previousFetcher := watchlistListingSnapshotFetcher
	watchlistListingSnapshotFetcher = func(ticker, exchangePrefix string) (watchlistListingSnapshot, error) {
		if ticker != "OLD" || exchangePrefix != "ASX:" {
			t.Fatalf("unexpected quote request: %s %s", exchangePrefix, ticker)
		}
		return watchlistListingSnapshot{
			Price:                  1.23,
			Provider:               listingProviderYahoo,
			ObservedTicker:         "OLD.AX",
			ObservedExchangePrefix: "ASX:",
			ObservedName:           "New Resources Limited",
			QuoteType:              "EQUITY",
		}, nil
	}
	defer func() { watchlistListingSnapshotFetcher = previousFetcher }()

	first := refreshWatchlistPricesInternal()
	if first.Updated != 1 || first.NewReviews != 1 || first.OpenReviews != 1 {
		t.Fatalf("first refresh = %#v, want one update and one open review", first)
	}
	if len(first.Errors) != 0 {
		t.Fatalf("first refresh errors = %#v", first.Errors)
	}

	var name string
	var price float64
	var securityID int64
	if err := db.QueryRow(`SELECT name, current_price, security_id FROM stock_analysis WHERE id = ?`, analysisID64).Scan(&name, &price, &securityID); err != nil {
		t.Fatalf("read refreshed row: %v", err)
	}
	if name != "Old Resources Ltd" {
		t.Fatalf("provider renamed analysis row: got %q", name)
	}
	if price != 1.23 || securityID == 0 {
		t.Fatalf("refreshed row = price %.2f security=%d, want 1.23 and stable identity", price, securityID)
	}

	var reviewType, currentName, observedName, status string
	var seenCount int
	if err := db.QueryRow(`
		SELECT review_type, current_name, observed_name, status, seen_count
		FROM security_listing_reviews
	`).Scan(&reviewType, &currentName, &observedName, &status, &seenCount); err != nil {
		t.Fatalf("read listing review: %v", err)
	}
	if reviewType != listingReviewNameChange || currentName != "Old Resources Ltd" || observedName != "New Resources Limited" || status != listingReviewOpen || seenCount != 1 {
		t.Fatalf("unexpected review: type=%q current=%q observed=%q status=%q seen=%d", reviewType, currentName, observedName, status, seenCount)
	}

	second := refreshWatchlistPricesInternal()
	if second.NewReviews != 0 || second.OpenReviews != 1 {
		t.Fatalf("second refresh = %#v, want existing review to be refreshed", second)
	}
	if err := db.QueryRow(`SELECT seen_count FROM security_listing_reviews`).Scan(&seenCount); err != nil {
		t.Fatalf("read deduplicated review: %v", err)
	}
	if seenCount != 2 {
		t.Fatalf("review was not deduplicated: seen_count=%d want 2", seenCount)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/analysis/listing-reviews", nil)
	response := httptest.NewRecorder()
	getListingReviews(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("listing review response: got %d want %d body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload []listingReviewResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode listing review response: %v", err)
	}
	if len(payload) != 1 || payload[0].ReviewType != listingReviewNameChange || payload[0].Name != "Old Resources Ltd" {
		t.Fatalf("listing review payload = %#v", payload)
	}
}

func TestWatchlistRefreshRequiresRepeatedUnavailableObservation(t *testing.T) {
	cleanup := setupAnalysisTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, is_watchlist)
		VALUES ('ASX:GONE', 'Gone Resources Ltd', 1)
	`); err != nil {
		t.Fatalf("insert watchlist row: %v", err)
	}

	previousFetcher := watchlistListingSnapshotFetcher
	watchlistListingSnapshotFetcher = func(string, string) (watchlistListingSnapshot, error) {
		return watchlistListingSnapshot{}, fmt.Errorf("no price data for GONE.AX")
	}
	defer func() { watchlistListingSnapshotFetcher = previousFetcher }()

	first := refreshWatchlistPricesInternal()
	if first.NewReviews != 0 || first.OpenReviews != 0 {
		t.Fatalf("first unavailable observation opened a review: %#v", first)
	}

	second := refreshWatchlistPricesInternal()
	if second.NewReviews != 1 || second.OpenReviews != 1 {
		t.Fatalf("second unavailable observation = %#v, want one review", second)
	}

	var reviewType, status string
	var failures int
	if err := db.QueryRow(`SELECT review_type, status FROM security_listing_reviews`).Scan(&reviewType, &status); err != nil {
		t.Fatalf("read unavailable review: %v", err)
	}
	if err := db.QueryRow(`SELECT consecutive_failures FROM security_listing_checks`).Scan(&failures); err != nil {
		t.Fatalf("read listing check: %v", err)
	}
	if reviewType != listingReviewUnavailable || status != listingReviewOpen || failures != 2 {
		t.Fatalf("unavailable review = type=%q status=%q failures=%d", reviewType, status, failures)
	}

	var name string
	if err := db.QueryRow(`SELECT name FROM stock_analysis WHERE ticker = 'ASX:GONE'`).Scan(&name); err != nil {
		t.Fatalf("read original row: %v", err)
	}
	if name != "Gone Resources Ltd" {
		t.Fatalf("unavailable observation mutated row name: %q", name)
	}
}
