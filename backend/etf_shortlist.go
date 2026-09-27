package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

// The ETF universe has exactly two sets, and they answer different questions.
//
//	Mapped funds  a fund with an asset-class mapping. It expresses that class,
//	              and mapping it is what makes it core to the class. These are
//	              the funds the allocation ledger reports on.
//	Shortlist     a fund being watched that is not mapped to a class. It is a
//	              candidate: for a class not yet expressed, or as a replacement
//	              for one that is. It carries no target and no capital.
//
// Nothing else confers membership. In particular the legacy TradingView weight
// table no longer admits a fund to the universe, which is what allowed a fund to
// appear for three unrelated reasons with no way to tell which.
//
// A fund leaves the shortlist by being mapped, or by being removed.

type ETFShortlistEntry struct {
	Ticker      string `json:"ticker"`
	DisplayName string `json:"display_name"`
	Note        string `json:"note"`
	AddedAt     string `json:"added_at"`
	// AssetClassHint records the class the fund would express if adopted. It is
	// a note to self, not a mapping: it confers nothing and creates no target.
	AssetClassHint string `json:"asset_class_hint"`
	// Mapped reports that this shortlist row has since been mapped to a class
	// and is therefore redundant. Surfaced rather than auto-deleted so removal
	// stays the user's decision.
	Mapped bool `json:"mapped"`
}

type etfShortlistUpsertRequest struct {
	DisplayName    *string `json:"display_name"`
	Note           *string `json:"note"`
	AssetClassHint *string `json:"asset_class_hint"`
}

func ensureETFShortlistSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS etf_shortlist (
			ticker TEXT PRIMARY KEY,
			display_name TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			asset_class_hint TEXT NOT NULL DEFAULT '',
			added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	return err
}

// loadETFShortlist returns watched candidates. A row whose ticker has since been
// mapped to a class is flagged rather than hidden: the fund is now part of the
// mapped universe and the shortlist row has served its purpose.
func loadETFShortlist() ([]ETFShortlistEntry, error) {
	mappings, err := loadETFAssetClassMappings(true)
	if err != nil {
		return nil, err
	}
	mapped := make(map[string]bool, len(mappings))
	for _, mapping := range mappings {
		mapped[mapping.Ticker] = true
	}

	rows, err := db.Query(`
		SELECT ticker, display_name, note, asset_class_hint, CAST(added_at AS TEXT)
		FROM etf_shortlist
		ORDER BY added_at DESC, ticker ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []ETFShortlistEntry{}
	for rows.Next() {
		var entry ETFShortlistEntry
		if err := rows.Scan(&entry.Ticker, &entry.DisplayName, &entry.Note, &entry.AssetClassHint, &entry.AddedAt); err != nil {
			return nil, err
		}
		entry.Mapped = mapped[entry.Ticker]
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func getETFShortlist(w http.ResponseWriter, r *http.Request) {
	entries, err := loadETFShortlist()
	if err != nil {
		log.Printf("[ETF] Failed to load shortlist: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

func upsertETFShortlistEntry(w http.ResponseWriter, r *http.Request) {
	ticker := canonicalSecurityTickerKey(mux.Vars(r)["ticker"])
	if ticker == "" {
		http.Error(w, "ticker is required", http.StatusBadRequest)
		return
	}

	var payload etfShortlistUpsertRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && err != http.ErrBodyNotAllowed {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	displayName := ""
	if payload.DisplayName != nil {
		displayName = strings.TrimSpace(*payload.DisplayName)
	}
	note := ""
	if payload.Note != nil {
		note = strings.TrimSpace(*payload.Note)
	}
	hint := ""
	if payload.AssetClassHint != nil {
		hint = normalizePrimaryAssetClass(*payload.AssetClassHint)
	}

	if _, err := db.Exec(`
		INSERT INTO etf_shortlist (ticker, display_name, note, asset_class_hint)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(ticker) DO UPDATE SET
			display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE etf_shortlist.display_name END,
			note = CASE WHEN excluded.note != '' THEN excluded.note ELSE etf_shortlist.note END,
			asset_class_hint = CASE WHEN excluded.asset_class_hint != '' THEN excluded.asset_class_hint ELSE etf_shortlist.asset_class_hint END
	`, ticker, displayName, note, hint); err != nil {
		log.Printf("[ETF] Failed to upsert shortlist entry %s: %v", ticker, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	entries, err := loadETFShortlist()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

func deleteETFShortlistEntry(w http.ResponseWriter, r *http.Request) {
	ticker := canonicalSecurityTickerKey(mux.Vars(r)["ticker"])
	if ticker == "" {
		http.Error(w, "ticker is required", http.StatusBadRequest)
		return
	}
	result, err := db.Exec(`DELETE FROM etf_shortlist WHERE ticker = ?`, ticker)
	if err != nil {
		log.Printf("[ETF] Failed to remove shortlist entry %s: %v", ticker, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		http.Error(w, "shortlist entry not found", http.StatusNotFound)
		return
	}

	entries, err := loadETFShortlist()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

// loadUnmappedHeldETFs finds funds held on the latest statement that have no
// asset-class mapping. These are not sidebar rows and never receive a target:
// a fund with no class expresses nothing. They are a data gap to resolve by
// mapping the fund or reclassifying it, so they are reported separately.
func loadUnmappedHeldETFs() ([]ETFShortlistEntry, error) {
	actualValues, err := loadETFActualValues()
	if err != nil {
		return nil, err
	}
	if len(actualValues) == 0 {
		return []ETFShortlistEntry{}, nil
	}
	mappings, err := loadETFAssetClassMappings(true)
	if err != nil {
		return nil, err
	}
	mapped := make(map[string]bool, len(mappings))
	for _, mapping := range mappings {
		mapped[mapping.Ticker] = true
	}

	names := map[string]string{}
	rows, err := db.Query(`
		SELECT COALESCE(ticker, ''), COALESCE(name, '')
		FROM stock_analysis
		WHERE UPPER(COALESCE(security_type, '')) = 'ETF'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var ticker, name string
		if err := rows.Scan(&ticker, &name); err != nil {
			return nil, err
		}
		if key := canonicalSecurityTickerKey(ticker); key != "" {
			names[key] = name
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	unmapped := []ETFShortlistEntry{}
	for ticker, value := range actualValues {
		if mapped[ticker] {
			continue
		}
		unmapped = append(unmapped, ETFShortlistEntry{
			Ticker:      ticker,
			DisplayName: names[ticker],
			Note:        fmt.Sprintf("Held (%s) with no asset class — map it or reclassify it", formatAUD(value)),
		})
	}
	return unmapped, nil
}

func formatAUD(value float64) string {
	return fmt.Sprintf("$%.0f", value)
}

func getETFUnmappedHoldings(w http.ResponseWriter, r *http.Request) {
	entries, err := loadUnmappedHeldETFs()
	if err != nil && err != sql.ErrNoRows {
		log.Printf("[ETF] Failed to load unmapped ETF holdings: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}
