package main

import (
	"context"
	"database/sql"
	"log"
	"strings"
	"time"
)

func loadGroupDerivedAssetClasses(ctx context.Context) map[string]string {
	if ctx == nil {
		ctx = context.Background()
	}
	queryCtx, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
	defer cancel()
	sleeves := loadAssetClasses()

	type stockGroupRow struct {
		ID             string
		Name           string
		AssetClassCode string
		ParentID       sql.NullString
	}

	groupRows, err := db.QueryContext(queryCtx, `SELECT id, name, COALESCE(asset_class_code, ''), parent_id FROM stock_groups`)
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to load stock groups for asset class sync: %v", err)
		return map[string]string{}
	}

	groupsByID := make(map[string]stockGroupRow)
	for groupRows.Next() {
		var row stockGroupRow
		if err := groupRows.Scan(&row.ID, &row.Name, &row.AssetClassCode, &row.ParentID); err != nil {
			log.Printf("[ASSET CLASS] Failed to scan stock group for asset class sync: %v", err)
			groupRows.Close()
			return map[string]string{}
		}
		groupsByID[row.ID] = row
	}
	if err := groupRows.Err(); err != nil {
		log.Printf("[ASSET CLASS] Failed while reading stock groups for asset class sync: %v", err)
		groupRows.Close()
		return map[string]string{}
	}
	groupRows.Close()

	resolveGroupAssetClass := func(groupID string) string {
		visited := make(map[string]struct{})
		currentID := strings.TrimSpace(groupID)

		for currentID != "" {
			if _, seen := visited[currentID]; seen {
				break
			}
			visited[currentID] = struct{}{}

			group, ok := groupsByID[currentID]
			if !ok {
				break
			}

			if sleeveCode, ok := resolveStockGroupAssetClassCodeFromAssetClasses(group.Name, group.AssetClassCode, sleeves); ok {
				return sleeveCode
			}

			if group.ParentID.Valid {
				currentID = strings.TrimSpace(group.ParentID.String)
			} else {
				currentID = ""
			}
		}

		return ""
	}

	assignmentRows, err := db.QueryContext(queryCtx, `SELECT company_name, group_id FROM stock_group_assignments`)
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to load stock group assignments for asset class sync: %v", err)
		return map[string]string{}
	}

	derived := make(map[string]string)
	for assignmentRows.Next() {
		var companyName, groupID string
		if err := assignmentRows.Scan(&companyName, &groupID); err != nil {
			log.Printf("[ASSET CLASS] Failed to scan group assignment for asset class sync: %v", err)
			assignmentRows.Close()
			return derived
		}

		if assetClass := resolveGroupAssetClass(groupID); assetClass != "" {
			if trimmed := strings.TrimSpace(companyName); trimmed != "" {
				derived[trimmed] = assetClass
			}
			if canonical := canonicalCompanyNameKey(companyName); canonical != "" {
				derived[canonical] = assetClass
			}
		}
	}
	if err := assignmentRows.Err(); err != nil {
		log.Printf("[ASSET CLASS] Failed while reading group assignments for asset class sync: %v", err)
		assignmentRows.Close()
		return derived
	}
	assignmentRows.Close()

	return derived
}

func canonicalCompanyNameKey(name string) string {
	upper := strings.ToUpper(strings.TrimSpace(name))
	if upper == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"&", " AND ",
		"INCORPORATED", "INC",
		"CORPORATION", "CORP",
		"LIMITED", "LTD",
	)
	upper = replacer.Replace(upper)

	var builder strings.Builder
	lastWasSpace := false
	for _, r := range upper {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastWasSpace = false
			continue
		}
		if !lastWasSpace {
			builder.WriteByte(' ')
			lastWasSpace = true
		}
	}

	return strings.TrimSpace(builder.String())
}

func guessPrimaryAssetClassFromIdentity(canonicalTicker, name string) string {
	ticker := strings.ToUpper(strings.TrimSpace(canonicalTicker))
	upperName := strings.ToUpper(strings.TrimSpace(name))

	switch ticker {
	case "QBE":
		return "INSURANCE"
	case "SGLLV":
		return "STAPLES"
	case "LNW":
		return "GAMING"
	}

	switch {
	case strings.Contains(upperName, "QBE"):
		return "INSURANCE"
	case strings.Contains(upperName, "INSURANCE"):
		return "INSURANCE"
	case strings.Contains(upperName, "RICEGROWERS"), strings.Contains(upperName, "SUNRICE"):
		return "STAPLES"
	case strings.Contains(upperName, "ARISTOCRAT"), strings.Contains(upperName, "LIGHT & WONDER"):
		return "GAMING"
	default:
		return ""
	}
}

func resolveAuthoritativeAssetClass(groupAssetClass, primaryAssetClass, canonicalTicker, name string) string {
	return resolveAuthoritativeAssetClassFromAssetClasses(groupAssetClass, primaryAssetClass, canonicalTicker, name, loadAssetClasses())
}

func resolveAuthoritativeAssetClassFromAssetClasses(groupAssetClass, primaryAssetClass, canonicalTicker, name string, sleeves []AssetClass) string {
	value, _ := resolveAssetClassWithSource(groupAssetClass, primaryAssetClass, canonicalTicker, name, sleeves)
	return value
}

// resolveAssetClassWithSource returns the class and the writer it came from, so
// a caller can record provenance instead of storing an unattributed value.
//
// The order here is only for filling a row that has no class. It is NOT the
// precedence rule for overwriting one — that lives in assetClassWriteWins, and
// it puts MANUAL above everything.
func resolveAssetClassWithSource(groupAssetClass, primaryAssetClass, canonicalTicker, name string, sleeves []AssetClass) (string, string) {
	if normalized, ok := resolvePortfolioGroupingAssetClassCodeFromAssetClasses(groupAssetClass, sleeves); ok && normalized != "" {
		return normalized, AssetClassSourceGroup
	}

	if normalized, ok := resolvePortfolioAssignmentClassFromAssetClasses(primaryAssetClass, sleeves); ok && normalized != "" {
		// Already stored on the row; whoever wrote it keeps the attribution.
		return normalized, ""
	}

	// A hardcoded ticker/name guess is the weakest thing in the system. It may
	// still fill an empty row so nothing sits unassigned, but it is stamped so
	// it is visibly a guess and loses to every real decision.
	if guessed := guessPrimaryAssetClassFromIdentity(canonicalTicker, name); guessed != "" {
		if normalized, ok := resolvePortfolioAssignmentClassFromAssetClasses(guessed, sleeves); ok && normalized != "" {
			return normalized, AssetClassSourceHeuristic
		}
	}

	return "UNASSIGNED", ""
}

func backfillPrimaryAssetClasses() {
	groupDerivedByCompany := loadGroupDerivedAssetClasses(context.Background())

	sleeves := loadAssetClasses()

	rows, err := db.Query(`SELECT id, COALESCE(ticker, ''), name, COALESCE(primary_asset_class, ''), COALESCE(security_type, ''), COALESCE(asset_class_source, '') FROM stock_analysis ORDER BY id`)
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to load analysis rows for backfill: %v", err)
		return
	}

	type analysisBackfillRow struct {
		ID                int
		Ticker            string
		Name              string
		PrimaryAssetClass string
		SecurityType      string
		AssetClassSource  string
	}

	analysisRows := make([]analysisBackfillRow, 0)

	backfilled := 0
	normalized := 0
	conflicted := 0
	for rows.Next() {
		var row analysisBackfillRow
		if err := rows.Scan(&row.ID, &row.Ticker, &row.Name, &row.PrimaryAssetClass, &row.SecurityType, &row.AssetClassSource); err != nil {
			log.Printf("[ASSET CLASS] Failed to scan analysis row for backfill: %v", err)
			rows.Close()
			return
		}
		analysisRows = append(analysisRows, row)
	}
	rows.Close()

	for _, row := range analysisRows {
		if isNonAllocatingSecurityType(row.SecurityType) || isNonAllocatingInstrumentName(row.Name) {
			if strings.TrimSpace(row.PrimaryAssetClass) != "" || !isNonAllocatingSecurityType(row.SecurityType) {
				desiredType := normalizeSecurityType(row.SecurityType)
				if isNonAllocatingInstrumentName(row.Name) {
					desiredType = "CVR"
				}
				if _, err := db.Exec(`UPDATE stock_analysis SET security_type = ?, primary_asset_class = NULL, allocation = 0, include_in_sizing = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, desiredType, row.ID); err != nil {
					log.Printf("[ASSET CLASS] Failed to clear non-allocating analysis row %d: %v", row.ID, err)
					continue
				}
				normalized++
			}
			continue
		}

		canonicalTicker := canonicalSecurityTickerKey(row.Ticker)
		groupAssetClass := groupDerivedByCompany[strings.TrimSpace(row.Name)]
		if groupAssetClass == "" {
			groupAssetClass = groupDerivedByCompany[canonicalCompanyNameKey(row.Name)]
		}
		resolved, resolvedSource := resolveAssetClassWithSource(
			groupAssetClass, row.PrimaryAssetClass, canonicalTicker, row.Name, sleeves)

		// An empty row is filled by whatever the resolver can find, and stamped
		// with which writer that was.
		if strings.TrimSpace(row.PrimaryAssetClass) == "" {
			if resolved == "UNASSIGNED" {
				continue
			}
			if _, err := db.Exec(`UPDATE stock_analysis SET primary_asset_class = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, resolved, row.ID); err != nil {
				log.Printf("[ASSET CLASS] Failed to backfill analysis row %d: %v", row.ID, err)
				continue
			}
			stampAssetClassSourceByID(row.ID, resolvedSource)
			backfilled++
			continue
		}

		// A row that already carries a class is only ever renormalised into the
		// canonical code form. Changing WHICH class it belongs to is a decision,
		// and this job runs at boot where a decision would be invisible.
		desiredValue, ok := resolvePortfolioAssignmentClass(row.PrimaryAssetClass)
		if !ok {
			desiredValue = ""
		}

		// The group implies a different class. Whether that should win depends
		// on who set the stored value, so it is compared rather than assumed.
		if resolvedSource == AssetClassSourceGroup && resolved != "" && resolved != "UNASSIGNED" && resolved != desiredValue {
			if assetClassWriteWins(AssetClassSourceGroup, row.AssetClassSource) {
				desiredValue = resolved
			} else {
				// Deliberate assignment stands. Reported by
				// GET /api/asset-classes/conflicts rather than silently reverted.
				conflicted++
				continue
			}
		}

		if desiredValue == row.PrimaryAssetClass {
			continue
		}

		var desiredValueArg interface{}
		if desiredValue != "" {
			desiredValueArg = desiredValue
		}
		if _, err := db.Exec(`UPDATE stock_analysis SET primary_asset_class = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, desiredValueArg, row.ID); err != nil {
			log.Printf("[ASSET CLASS] Failed to normalize analysis row %d: %v", row.ID, err)
			continue
		}
		if desiredValue == resolved && resolvedSource != "" {
			stampAssetClassSourceByID(row.ID, resolvedSource)
		}
		normalized++
	}

	if backfilled > 0 || normalized > 0 || conflicted > 0 {
		log.Printf("[ASSET CLASS] Primary asset class backfill complete: %d backfilled, %d normalized, %d left for the user to resolve", backfilled, normalized, conflicted)
	}
}

func migrateNonAllocatingInstruments() {
	if db == nil {
		return
	}
	result, err := db.Exec(`
		UPDATE stock_analysis
		SET security_type = 'CVR',
		    primary_asset_class = NULL,
		    allocation = 0,
		    include_in_sizing = 0,
		    updated_at = CURRENT_TIMESTAMP
		WHERE UPPER(COALESCE(name, '')) LIKE '%CONTINGENT VALUE RIGHT%'
		   OR UPPER(COALESCE(security_type, '')) IN (
		        'CVR',
		        'CONTINGENT_VALUE_RIGHT',
		        'CONTINGENT_VALUE_RIGHTS',
		        'CONTINGENT VALUE RIGHT',
		        'CONTINGENT VALUE RIGHTS'
		   )
	`)
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to migrate non-allocating instruments: %v", err)
		return
	}
	if count, _ := result.RowsAffected(); count > 0 {
		log.Printf("[ASSET CLASS] Non-allocating instrument migration complete: %d rows", count)
	}
}

// getEffectiveEquityState resolves the governing equity exposure from
// equity_sizing. "DISCONNECTED" (-1 values) means the detectors genuinely
// have not reported — a real, displayable state. A database failure is NOT
// that state: it is returned as an error so callers can fail loudly instead
// of rendering a healthy-looking "disconnected" while the risk overlay is
// actually blind (audit §1: swallowed errors in financial paths).
