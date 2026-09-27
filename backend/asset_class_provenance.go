package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// Asset-class provenance.
//
// stock_analysis.primary_asset_class has four writers, and until now nothing
// recorded which one set the current value:
//
//	MANUAL     a person assigned it (analysis tab, ETF mapping, group manager
//	           edit routed through the API)
//	LLM_AUTO   the auto-assign feature chose it
//	GROUP      derived from the security's stock_group assignment
//	HEURISTIC  guessed from ticker or name by guessPrimaryAssetClassFromIdentity
//
// Without provenance the boot-time backfill could not tell a deliberate manual
// assignment from a stale derived one, so it overwrote both alike — silently
// reverting manual edits on the next deploy, and only on a deploy, which made
// the behaviour depend on release timing rather than on what anyone did.
//
// Precedence is now explicit and enforced at write time: MANUAL outranks
// everything. A group is an organisational construct for looking at holdings;
// it must not silently overrule a deliberate decision about which class owns a
// security's capital. Where the two disagree the conflict is reported rather
// than resolved — see loadAssetClassConflicts.
const (
	AssetClassSourceManual    = "MANUAL"
	AssetClassSourceLLMAuto   = "LLM_AUTO"
	AssetClassSourceGroup     = "GROUP"
	AssetClassSourceHeuristic = "HEURISTIC"
	AssetClassSourceSignal    = "SIGNAL"
)

// assetClassSourceRank orders the writers. Higher wins. An unknown or empty
// source ranks lowest so legacy rows, whose provenance nobody recorded, never
// block a better-attributed write.
func assetClassSourceRank(source string) int {
	switch strings.ToUpper(strings.TrimSpace(source)) {
	case AssetClassSourceManual:
		return 40
	case AssetClassSourceLLMAuto:
		return 30
	case AssetClassSourceSignal:
		return 20
	case AssetClassSourceGroup:
		return 10
	case AssetClassSourceHeuristic:
		return 5
	default:
		return 0
	}
}

// normalizeAssetClassSource keeps unrecognised values out of the column so the
// rank function has a closed set to reason about.
func normalizeAssetClassSource(source string) string {
	upper := strings.ToUpper(strings.TrimSpace(source))
	switch upper {
	case AssetClassSourceManual, AssetClassSourceLLMAuto, AssetClassSourceGroup,
		AssetClassSourceHeuristic, AssetClassSourceSignal:
		return upper
	default:
		return ""
	}
}

// assetClassWriteWins reports whether a write from incoming may replace a value
// attributed to existing. Equal ranks mean the newer write wins, which is what
// makes repeated manual edits work; a lower rank never overwrites a higher one.
func assetClassWriteWins(incoming, existing string) bool {
	return assetClassSourceRank(incoming) >= assetClassSourceRank(existing)
}

func ensureAssetClassProvenanceSchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	// Both are nullable with no default: a NULL source means "written before
	// provenance existed", which is exactly rank 0.
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN asset_class_source TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN asset_class_set_at DATETIME`)
	_, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_stock_analysis_asset_class_source
			ON stock_analysis(asset_class_source)
	`)
	return err
}

// stampAssetClassSource records who set the class on a row that was just
// written. Callers update primary_asset_class and then stamp, so a failure to
// stamp degrades to an unattributed value rather than losing the assignment.
func stampAssetClassSourceByID(id int, source string) {
	normalized := normalizeAssetClassSource(source)
	if normalized == "" {
		return
	}
	if _, err := db.Exec(`
		UPDATE stock_analysis
		SET asset_class_source = ?, asset_class_set_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, normalized, id); err != nil {
		log.Printf("[ASSET CLASS] Failed to stamp provenance %s on row %d: %v", normalized, id, err)
	}
}

func stampAssetClassSourceByTicker(ticker, source string) {
	normalized := normalizeAssetClassSource(source)
	key := canonicalSecurityTickerKey(ticker)
	if normalized == "" || key == "" {
		return
	}
	if _, err := db.Exec(`
		UPDATE stock_analysis
		SET asset_class_source = ?, asset_class_set_at = CURRENT_TIMESTAMP
		WHERE `+stockAnalysisTickerKeySQL("ticker")+` = ?
	`, normalized, key); err != nil {
		log.Printf("[ASSET CLASS] Failed to stamp provenance %s on %s: %v", normalized, key, err)
	}
}

// loadStoredAssetClassSource returns the provenance currently recorded for a
// row, or "" for rows written before provenance existed.
func loadStoredAssetClassSource(id int) string {
	var source sql.NullString
	if err := db.QueryRow(`SELECT asset_class_source FROM stock_analysis WHERE id = ?`, id).Scan(&source); err != nil {
		return ""
	}
	return normalizeAssetClassSource(source.String)
}

// AssetClassConflict is a security whose stored class disagrees with the class
// its stock group implies. Both values are real decisions made at different
// times through different surfaces; the resolution is the user's, so this is
// reported and never auto-applied.
type AssetClassConflict struct {
	ID             int    `json:"id"`
	Ticker         string `json:"ticker"`
	Name           string `json:"name"`
	StoredClass    string `json:"stored_class"`
	StoredSource   string `json:"stored_source"`
	StoredSetAt    string `json:"stored_set_at"`
	GroupClass     string `json:"group_class"`
	SecurityType   string `json:"security_type"`
	Recommendation string `json:"recommendation"`
}

// loadAssetClassConflicts compares every analysis row against the class its
// group implies. It reads only; the divergence is the point.
func loadAssetClassConflicts() ([]AssetClassConflict, error) {
	groupDerivedByCompany := loadGroupDerivedAssetClasses(context.Background())

	rows, err := db.Query(`
		SELECT id, COALESCE(ticker, ''), COALESCE(name, ''),
		       COALESCE(primary_asset_class, ''), COALESCE(asset_class_source, ''),
		       COALESCE(CAST(asset_class_set_at AS TEXT), ''), COALESCE(security_type, '')
		FROM stock_analysis
		ORDER BY id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	conflicts := []AssetClassConflict{}
	for rows.Next() {
		var row AssetClassConflict
		if err := rows.Scan(&row.ID, &row.Ticker, &row.Name, &row.StoredClass,
			&row.StoredSource, &row.StoredSetAt, &row.SecurityType); err != nil {
			return nil, err
		}
		if strings.TrimSpace(row.StoredClass) == "" {
			continue
		}
		if isNonAllocatingSecurityType(row.SecurityType) {
			continue
		}

		groupClass := groupDerivedByCompany[strings.TrimSpace(row.Name)]
		if groupClass == "" {
			groupClass = groupDerivedByCompany[canonicalCompanyNameKey(row.Name)]
		}
		if groupClass == "" || groupClass == row.StoredClass {
			continue
		}

		row.GroupClass = groupClass
		switch assetClassSourceRank(row.StoredSource) {
		case assetClassSourceRank(AssetClassSourceManual):
			row.Recommendation = "Stored class was set by hand and is being kept. Move the security's group, or change the class, to agree."
		case 0:
			row.Recommendation = "Stored class predates provenance tracking, so which decision is newer is unknown. Confirm one."
		default:
			row.Recommendation = "Stored class came from " + row.StoredSource + ". The group implies a different class."
		}
		conflicts = append(conflicts, row)
	}
	return conflicts, rows.Err()
}

func getAssetClassConflicts(w http.ResponseWriter, r *http.Request) {
	conflicts, err := loadAssetClassConflicts()
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to load asset class conflicts: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(conflicts)
}
