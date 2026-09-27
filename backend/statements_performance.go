package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

func importStatement(w http.ResponseWriter, r *http.Request) {
	payload, err := decodeStatementImport(http.MaxBytesReader(w, r.Body, 4<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateStatementImport(&payload, time.Now()); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Start transaction
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// A complete snapshot may replace only this account's current broker book.
	var latestAccount string
	var latestDate time.Time
	var statementID int64
	var correctionID interface{}
	err = tx.QueryRow(`SELECT id, account_name, statement_date FROM account_statements ORDER BY statement_date DESC, id DESC LIMIT 1`).Scan(&statementID, &latestAccount, &latestDate)
	newStatementDay := err == sql.ErrNoRows
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, "Failed to inspect current statement: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err == nil {
		if !strings.EqualFold(strings.TrimSpace(latestAccount), payload.Account.AccountName) {
			http.Error(w, "Statement account differs from the current broker account; nothing imported", http.StatusConflict)
			return
		}
		day := statementCalendarDay(latestDate)
		if payload.Account.StatementDate.Before(day) {
			http.Error(w, "Statement predates the current broker statement; nothing imported", http.StatusConflict)
			return
		}
		newStatementDay = payload.Account.StatementDate.After(day)
		payload.Account.AccountName = latestAccount
		if !newStatementDay {
			if err := preserveLegacyStatementTx(tx, statementID); err != nil {
				http.Error(w, "Failed to preserve statement evidence", http.StatusInternalServerError)
				return
			}
			// Preserve the original key when correcting an older timestamp format.
			payload.Account.StatementDate = latestDate
			correctionID = statementID
		}
	}

	// 1. Insert/update account statement (for historical tracking)
	statementResult, err := tx.Exec(`
		INSERT INTO account_statements
		(id, account_name, statement_date, total_value_aud, cash_aud, usd_value, usd_aud, gbp_value, gbp_aud, aud_value)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id)
		DO UPDATE SET
			total_value_aud = excluded.total_value_aud,
			cash_aud = excluded.cash_aud,
			usd_value = excluded.usd_value,
			usd_aud = excluded.usd_aud,
			gbp_value = excluded.gbp_value,
			gbp_aud = excluded.gbp_aud,
			aud_value = excluded.aud_value
	`, correctionID, payload.Account.AccountName, payload.Account.StatementDate, payload.Account.TotalValueAUD,
		payload.Account.CashAUD, payload.Account.USDValue, payload.Account.USDAUD,
		payload.Account.GBPValue, payload.Account.GBPAUD, payload.Account.AUDValue)

	if err != nil {
		http.Error(w, "Failed to insert account statement: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if newStatementDay {
		statementID, err = statementResult.LastInsertId()
		if err != nil {
			http.Error(w, "Failed to resolve account statement: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// 2. Create sync history record
	syncResult, err := tx.Exec(`
		INSERT INTO sync_history (sync_type, sync_status, total_changes)
		VALUES ('sheet_import', 'success', 0)
	`)
	if err != nil {
		http.Error(w, "Failed to create sync history: "+err.Error(), http.StatusInternalServerError)
		return
	}
	syncID, err := syncResult.LastInsertId()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 3. Load existing holdings from database
	// Helper function to create a unique match key (uses ISIN if available, otherwise normalized company name)
	makeMatchKey := func(isin, companyName string) string {
		// ISIN (International Securities Identification Number) is globally unique and never changes
		// This is the most reliable matching key
		if isin != "" {
			return "ISIN:" + strings.ToUpper(strings.TrimSpace(isin))
		}

		// Fallback: normalize company name by trimming whitespace and converting to lowercase
		normalizedName := strings.ToLower(strings.TrimSpace(companyName))
		return "NAME:" + normalizedName
	}

	existingHoldings := make(map[string]statementExistingHolding)
	existingHoldingsByName := make(map[string]statementExistingHolding)

	rows, err := tx.Query(`SELECT id, COALESCE(security_id, 0), COALESCE(isin, ''), COALESCE(ticker, ''), COALESCE(exchange_prefix, ''), company_name, quantity, value_aud FROM holdings WHERE is_active = 1`)
	if err != nil {
		http.Error(w, "Failed to load existing holdings: "+err.Error(), http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var h statementExistingHolding
		if err := rows.Scan(&h.ID, &h.SecurityID, &h.ISIN, &h.Ticker, &h.ExchangePrefix, &h.CompanyName, &h.Quantity, &h.ValueAUD); err != nil {
			rows.Close()
			http.Error(w, "Failed to read current holding: "+err.Error(), http.StatusInternalServerError)
			return
		}
		// Use ISIN as primary match key (most reliable), fallback to normalized company name
		matchKey := makeMatchKey(h.ISIN, h.CompanyName)
		existingHoldings[matchKey] = h
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := rows.Close(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for key, h := range existingHoldings {
		h.External, err = statementSecurityIsExternalTx(tx, h.SecurityID, h.CompanyName, h.Ticker)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		existingHoldings[key] = h
		existingHoldingsByName[strings.ToLower(strings.TrimSpace(h.CompanyName))] = h
	}

	// 4. Process incoming holdings from sheet (MERGE LOGIC)
	addedCount := 0
	updatedCount := 0
	removedCount := 0
	matchedHoldingIDs := make(map[int]bool)
	resolvedSecurityIDs := make(map[int64]string)
	incomingNames := make(map[string]bool)
	securityIDsByMatchKey := make(map[string]int64)

	for _, holding := range payload.Holdings {
		normalizedIncomingName := strings.ToLower(strings.TrimSpace(holding.Details))
		if normalizedIncomingName == "" {
			http.Error(w, "Incoming holding is missing company name", http.StatusBadRequest)
			return
		}
		if incomingNames[normalizedIncomingName] {
			http.Error(w, "Duplicate holding in import payload: "+holding.Details, http.StatusBadRequest)
			return
		}
		incomingNames[normalizedIncomingName] = true

		// Create match key for this incoming holding (ISIN-based if available, otherwise normalized name)
		matchKey := makeMatchKey(holding.ISIN, holding.Details)

		// Try to preserve any existing ticker/prefix before falling back to the mapping table.
		// This prevents a later import from wiping a user-assigned mapping if the broker/feed
		// changes the company name formatting slightly.
		var existingTicker, existingPrefix string
		if existing, exists := existingHoldings[matchKey]; exists {
			existingTicker = existing.Ticker
			existingPrefix = existing.ExchangePrefix
		} else if holding.ISIN != "" {
			nameKey := makeMatchKey("", holding.Details)
			if existing, exists := existingHoldings[nameKey]; exists {
				log.Printf("[ALPHA EDGE] Preserving existing ticker for '%s' by name fallback (existing ISIN=%s, incoming ISIN=%s)",
					holding.Details, existing.ISIN, holding.ISIN)
				existingTicker = existing.Ticker
				existingPrefix = existing.ExchangePrefix
			}
		}

		// Look up ticker from company_mappings
		var ticker, exchangePrefix string
		if existingTicker != "" {
			ticker = existingTicker
		}
		if existingPrefix != "" {
			exchangePrefix = existingPrefix
		}
		err := tx.QueryRow(`SELECT COALESCE(ticker, ''), COALESCE(exchange_prefix, '') FROM company_mappings WHERE company_name = ?`, holding.Details).
			Scan(&ticker, &exchangePrefix)
		if err != nil && err != sql.ErrNoRows {
			http.Error(w, "Failed to read company mapping: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if err != nil {
			// No mapping found - keep any existing ticker/prefix if present, otherwise leave blank
			if ticker == "" {
				ticker = existingTicker
			}
			if exchangePrefix == "" {
				exchangePrefix = existingPrefix
			}
		}

		costAUD, valueAUD, gainLossAUD, marketValue := importedHoldingAUDAmounts(payload.Account, holding)

		// Look up existing holding using match key
		// Try ISIN-based match first, then fall back to name-based match
		existing, exists := existingHoldings[matchKey]
		if !exists && holding.ISIN != "" {
			// Incoming has ISIN but didn't match - try name-based fallback
			// This handles case where existing record has NULL ISIN
			nameKey := makeMatchKey("", holding.Details)
			existing, exists = existingHoldings[nameKey]
			if exists {
				log.Printf("[ALPHA EDGE] Matched '%s' by name (existing ISIN=%s, incoming ISIN=%s)",
					holding.Details, existing.ISIN, holding.ISIN)
			}
		}
		if !exists {
			if existingByName, ok := existingHoldingsByName[normalizedIncomingName]; ok {
				existing = existingByName
				exists = true
				log.Printf("[ALPHA EDGE] Matched '%s' by normalized company name fallback (existing ISIN=%s, incoming ISIN=%s)",
					holding.Details, existing.ISIN, holding.ISIN)
			}
		}

		if exists {
			if existing.External || matchedHoldingIDs[existing.ID] {
				http.Error(w, "Incoming holding conflicts with an external or already matched holding: "+holding.Details, http.StatusConflict)
				return
			}
			if existing.ISIN != "" && holding.ISIN != "" && !strings.EqualFold(existing.ISIN, holding.ISIN) {
				http.Error(w, "Conflicting security ISIN for "+holding.Details, http.StatusConflict)
				return
			}
			if holding.ISIN == "" {
				holding.ISIN = existing.ISIN
			}
			if ticker == "" {
				ticker = existing.Ticker
			}
			if exchangePrefix == "" {
				exchangePrefix = existing.ExchangePrefix
			}
			matchedHoldingIDs[existing.ID] = true
		}
		identityCandidate := securityIdentityCandidate{
			ISIN:           holding.ISIN,
			Ticker:         ticker,
			ExchangePrefix: exchangePrefix,
			Name:           holding.Details,
		}
		securityID, err := ensureSecurityIdentityTx(
			tx,
			identityCandidate,
			"broker_import",
			true,
		)
		if err != nil {
			if errors.Is(err, errSecurityIdentityConflict) {
				http.Error(w, "Cannot import "+holding.Details+": "+err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, "Failed to resolve security identity: "+err.Error(), http.StatusInternalServerError)
			return
		}
		securityIDsByMatchKey[matchKey] = securityID
		external, err := statementSecurityIsExternalTx(tx, securityID, holding.Details, ticker)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if external {
			http.Error(w, "Incoming security is marked external: "+holding.Details, http.StatusConflict)
			return
		}
		if previousName, duplicate := resolvedSecurityIDs[securityID]; duplicate {
			http.Error(w, fmt.Sprintf("Incoming securities %q and %q resolve to the same security ID %d; review the security mappings", previousName, holding.Details, securityID), http.StatusConflict)
			return
		}
		resolvedSecurityIDs[securityID] = holding.Details

		if exists {
			// UPDATE existing holding — preserve cash_reserve (set manually by user, not from broker sync)
			_, err := tx.Exec(`
				UPDATE holdings
				SET company_name = ?, isin = NULLIF(?, ''), ticker = ?, exchange_prefix = ?, security_id = ?,
				    quantity = ?, cost_aud = ?, current_price = ?, value_aud = ?,
				    gain_loss_aud = ?, gain_loss_pct = ?, currency = ?, market_value = ?,
				    last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, holding.Details, holding.ISIN, ticker, exchangePrefix, securityID,
				holding.Quantity, costAUD, holding.CurrentPrice, valueAUD,
				gainLossAUD, holding.GainLossPct, holding.Currency, marketValue,
				existing.ID)

			if err != nil {
				http.Error(w, "Failed to update holding: "+err.Error(), http.StatusInternalServerError)
				return
			}

			// Any live holding is no longer a watchlist-only item.
			if err := setStockAnalysisWatchlistStateTx(tx, ticker, exchangePrefix, holding.Details, false); err != nil {
				http.Error(w, "Failed to update analysis watchlist state: "+err.Error(), http.StatusInternalServerError)
				return
			}
			if err := syncSecurityIdentityReferencesTx(tx, securityID, existing.CompanyName, identityCandidate); err != nil {
				http.Error(w, "Failed to synchronize security rename: "+err.Error(), http.StatusInternalServerError)
				return
			}

			// Log change if quantity or value changed significantly
			if existing.Quantity != holding.Quantity || existing.ValueAUD != valueAUD {
				if _, err := tx.Exec(`
					INSERT INTO sync_changes (sync_id, change_type, ticker, company_name, old_quantity, new_quantity, old_value, new_value)
					VALUES (?, 'UPDATED', ?, ?, ?, ?, ?, ?)
				`, syncID, ticker, holding.Details, existing.Quantity, holding.Quantity, existing.ValueAUD, valueAUD); err != nil {
					http.Error(w, "Failed to log holding update: "+err.Error(), http.StatusInternalServerError)
					return
				}
				updatedCount++
			}

		} else {
			// INSERT new holding
			// The UNIQUE index on (isin) WHERE isin IS NOT NULL prevents ISIN duplicates at DB level
			_, err := tx.Exec(`
				INSERT INTO holdings
				(isin, ticker, company_name, exchange_prefix, security_id, quantity, cost_aud, current_price, value_aud,
				 gain_loss_aud, gain_loss_pct, currency, market_value, cash_reserve, is_active)
				VALUES (NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
			`, holding.ISIN, ticker, holding.Details, exchangePrefix, securityID, holding.Quantity, costAUD,
				holding.CurrentPrice, valueAUD, gainLossAUD, holding.GainLossPct,
				holding.Currency, marketValue, holding.CashReserve)

			if err != nil {
				// If we hit a UNIQUE constraint violation, log it with details
				if strings.Contains(err.Error(), "UNIQUE constraint failed") {
					log.Printf("[ALPHA EDGE] ERROR: Duplicate holding detected for '%s' (matchKey=%s). This should have been caught by map matching. err=%v",
						holding.Details, matchKey, err)
				}
				http.Error(w, "Failed to insert holding: "+err.Error(), http.StatusInternalServerError)
				return
			}

			// If analysis already exists for this security, the position is live again.
			if err := setStockAnalysisWatchlistStateTx(tx, ticker, exchangePrefix, holding.Details, false); err != nil {
				http.Error(w, "Failed to update analysis watchlist state: "+err.Error(), http.StatusInternalServerError)
				return
			}
			if err := syncSecurityIdentityReferencesTx(tx, securityID, "", identityCandidate); err != nil {
				http.Error(w, "Failed to synchronize security identity: "+err.Error(), http.StatusInternalServerError)
				return
			}

			// Log addition
			if _, err := tx.Exec(`
				INSERT INTO sync_changes (sync_id, change_type, ticker, company_name, new_quantity, new_value)
				VALUES (?, 'ADDED', ?, ?, ?, ?)
			`, syncID, ticker, holding.Details, holding.Quantity, valueAUD); err != nil {
				http.Error(w, "Failed to log holding addition: "+err.Error(), http.StatusInternalServerError)
				return
			}
			addedCount++
		}
	}

	// 5. Mark holdings as inactive if they're not in the incoming data (REMOVED)
	for _, existing := range existingHoldings {
		if !existing.External && !matchedHoldingIDs[existing.ID] {
			// Historical imports can leave an older inactive row for the same company.
			// Remove those duplicates first so the active row can transition cleanly to inactive
			// under the UNIQUE(company_name, is_active) constraint.
			if _, err := tx.Exec(`
				DELETE FROM holdings
				WHERE id != ?
				  AND is_active = 0
				  AND LOWER(TRIM(company_name)) = LOWER(TRIM(?))
			`, existing.ID, existing.CompanyName); err != nil {
				http.Error(w, "Failed to clear inactive duplicate for removed holding: "+err.Error(), http.StatusInternalServerError)
				return
			}

			if _, err := tx.Exec(`
				UPDATE holdings
				SET is_active = 0, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, existing.ID); err != nil {
				http.Error(w, "Failed to mark removed holding inactive: "+err.Error(), http.StatusInternalServerError)
				return
			}

			if err := setStockAnalysisWatchlistStateTx(tx, existing.Ticker, existing.ExchangePrefix, existing.CompanyName, true); err != nil {
				http.Error(w, "Failed to move removed holding to watchlist: "+err.Error(), http.StatusInternalServerError)
				return
			}

			if _, err := tx.Exec(`
				INSERT INTO sync_changes (sync_id, change_type, ticker, company_name, old_quantity, old_value)
				VALUES (?, 'REMOVED', ?, ?, ?, ?)
			`, syncID, existing.Ticker, existing.CompanyName, existing.Quantity, existing.ValueAUD); err != nil {
				http.Error(w, "Failed to log removed holding: "+err.Error(), http.StatusInternalServerError)
				return
			}
			removedCount++
		}
	}

	// 6. Update sync history with counts
	totalChanges := addedCount + updatedCount + removedCount
	if _, err := tx.Exec(`
		UPDATE sync_history
		SET total_changes = ?, added_count = ?, updated_count = ?, removed_count = ?
		WHERE id = ?
	`, totalChanges, addedCount, updatedCount, removedCount, syncID); err != nil {
		http.Error(w, "Failed to finalize sync history: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 7. Also store in statement_holdings for historical record
	if _, err := tx.Exec(`DELETE FROM statement_holdings WHERE statement_id = ?`, statementID); err != nil {
		http.Error(w, "Failed to replace statement holdings: "+err.Error(), http.StatusInternalServerError)
		return
	}
	for _, holding := range payload.Holdings {
		costAUD, valueAUD, gainLossAUD, marketValue := importedHoldingAUDAmounts(payload.Account, holding)

		if _, err := tx.Exec(`
			INSERT INTO statement_holdings
			(statement_id, security_id, details, quantity, cost_aud, current_price, value_aud,
			 gain_loss_aud, gain_loss_pct, currency, market_value, cash_reserve)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, statementID, securityIDsByMatchKey[makeMatchKey(holding.ISIN, holding.Details)], holding.Details, holding.Quantity, costAUD,
			holding.CurrentPrice, valueAUD, gainLossAUD, holding.GainLossPct,
			holding.Currency, marketValue, holding.CashReserve); err != nil {
			http.Error(w, "Failed to store statement holding: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := writePerformanceSnapshotsForStatementTx(tx, statementID); err != nil {
		http.Error(w, "Failed to write performance snapshots: "+err.Error(), http.StatusInternalServerError)
		return
	}

	revisionID, err := recordStatementRevisionTx(tx, statementID, payload)
	if err != nil {
		http.Error(w, "Failed to preserve imported statement evidence", http.StatusInternalServerError)
		return
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[ALPHA EDGE] Statement imported with MERGE: added=%d, updated=%d, removed=%d, total=%d",
		addedCount, updatedCount, removedCount, len(payload.Holdings))
	// Corrections must recheck evidence already matched to this statement. The
	// reconciler still requires a later calendar day than the execution baseline.
	reconcileSecurityActionsAfterStatement(statementID, syncID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":        "Statement imported successfully",
		"statement_id":   statementID,
		"revision_id":    revisionID,
		"sync_id":        syncID,
		"holdings_count": len(payload.Holdings),
		"changes": map[string]int{
			"added":   addedCount,
			"updated": updatedCount,
			"removed": removedCount,
			"total":   totalChanges,
		},
	})
}

func getPortfolioPerformance(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT statement_id, observed_at, total_value_aud, invested_value_aud,
		       statement_cash_aud, sleeve_cash_aud, residual_cash_aud, holdings_count, source
		FROM portfolio_daily_snapshots
		ORDER BY observed_at ASC, statement_id ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	points := []PortfolioPerformancePoint{}
	for rows.Next() {
		var point PortfolioPerformancePoint
		if err := rows.Scan(
			&point.StatementID,
			&point.ObservedAt,
			&point.TotalValueAUD,
			&point.InvestedValueAUD,
			&point.StatementCashAUD,
			&point.SleeveCashAUD,
			&point.ResidualCashAUD,
			&point.HoldingsCount,
			&point.Source,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(points)
}

func getAssetClassPerformance(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT statement_id, observed_at, asset_class, display_name, invested_value_aud,
		       cash_value_aud, total_value_aud, portfolio_weight_pct, source
		FROM asset_class_daily_snapshots
		ORDER BY observed_at ASC, total_value_aud DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	points := []AssetClassPerformancePoint{}
	for rows.Next() {
		var point AssetClassPerformancePoint
		if err := rows.Scan(
			&point.StatementID,
			&point.ObservedAt,
			&point.AssetClass,
			&point.DisplayName,
			&point.InvestedValueAUD,
			&point.CashValueAUD,
			&point.TotalValueAUD,
			&point.PortfolioWeightPct,
			&point.Source,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(points)
}

func getSecurityPerformance(w http.ResponseWriter, r *http.Request) {
	ticker := strings.ToUpper(strings.TrimSpace(mux.Vars(r)["ticker"]))
	if ticker == "" {
		http.Error(w, "ticker is required", http.StatusBadRequest)
		return
	}

	rows, err := db.Query(`
		SELECT statement_id, observed_at, COALESCE(ticker, ''), COALESCE(exchange_prefix, ''),
		       name, asset_class, quantity, price, market_value_aud, portfolio_weight_pct,
		       currency, source
		FROM security_position_snapshots
		WHERE UPPER(TRIM(COALESCE(ticker, ''))) = ?
		   OR UPPER(TRIM(name)) = ?
		ORDER BY observed_at ASC, statement_id ASC
	`, ticker, ticker)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	points := []SecurityPerformancePoint{}
	for rows.Next() {
		var point SecurityPerformancePoint
		if err := rows.Scan(
			&point.StatementID,
			&point.ObservedAt,
			&point.Ticker,
			&point.ExchangePrefix,
			&point.Name,
			&point.AssetClass,
			&point.Quantity,
			&point.Price,
			&point.MarketValueAUD,
			&point.PortfolioWeightPct,
			&point.Currency,
			&point.Source,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(points)
}

func performanceEventSeverity(label string) string {
	normalized := strings.ToUpper(strings.TrimSpace(label))
	switch normalized {
	case "SELL", "SELL_DOWN", "TRIM", "Q4D", "Q4", "Q4_CRISIS":
		return "negative"
	case "BUY", "ADD", "BREAKOUT", "ACCEPT", "APPROVED", "BASELINED":
		return "positive"
	case "Q3D", "Q3", "REGIME":
		return "risk"
	default:
		return "neutral"
	}
}

func performanceEventScope(ticker string, source string) string {
	t := strings.ToUpper(strings.TrimSpace(ticker))
	s := strings.ToLower(strings.TrimSpace(source))
	if s == "q3d" || s == "q4d" || strings.HasPrefix(t, "REGIME:") || t == "SPX" || t == "SPY" || t == "XAO" {
		return "portfolio_risk"
	}
	if t == "" {
		return "portfolio"
	}
	return "security"
}

func performanceDecisionTitle(decision string, alertType string) string {
	decisionLabel := strings.ToUpper(strings.TrimSpace(decision))
	if decisionLabel == "IGNORE" {
		return "Ignored decision"
	}
	if decisionLabel == "" {
		return "Decision recorded"
	}
	return fmt.Sprintf("%s decision", decisionLabel)
}

func getPerformanceEvents(w http.ResponseWriter, r *http.Request) {
	resolveExpiredAlerts()

	limit := 500
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	if limit < 50 {
		limit = 50
	}
	if limit > 2000 {
		limit = 2000
	}

	events := make([]PerformanceEvent, 0, limit)
	appendEvent := func(event PerformanceEvent) {
		if event.ID == "" || event.EventType == "" || event.OccurredAt.IsZero() {
			return
		}
		events = append(events, event)
	}

	statementRows, err := db.Query(`
		SELECT statement_id, observed_at, total_value_aud, holdings_count, source
		FROM portfolio_daily_snapshots
		ORDER BY observed_at DESC, statement_id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for statementRows.Next() {
		var statementID int64
		var observedAt time.Time
		var totalValue float64
		var holdingsCount int
		var source string
		if err := statementRows.Scan(&statementID, &observedAt, &totalValue, &holdingsCount, &source); err != nil {
			statementRows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		value := totalValue
		appendEvent(PerformanceEvent{
			ID:          fmt.Sprintf("statement:%d", statementID),
			EventType:   "statement_imported",
			OccurredAt:  observedAt,
			Title:       "Statement imported",
			Scope:       "portfolio",
			Source:      source,
			Severity:    "neutral",
			StatementID: statementID,
			ValueAUD:    &value,
			Metadata: map[string]interface{}{
				"holdings_count": holdingsCount,
			},
		})
	}
	if err := statementRows.Err(); err != nil {
		statementRows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	statementRows.Close()

	alertRows, err := db.Query(`
		SELECT id, ticker, alert_type, COALESCE(strength, ''), COALESCE(source, ''),
		       COALESCE(exchange_prefix, ''), COALESCE(timeframe, ''), alert_price, created_at
		FROM alerts
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for alertRows.Next() {
		var id int64
		var ticker, alertType, strength, source, exchangePrefix, timeframe string
		var alertPrice sql.NullFloat64
		var createdAt time.Time
		if err := alertRows.Scan(&id, &ticker, &alertType, &strength, &source, &exchangePrefix, &timeframe, &alertPrice, &createdAt); err != nil {
			alertRows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var value *float64
		if alertPrice.Valid {
			v := alertPrice.Float64
			value = &v
		}
		appendEvent(PerformanceEvent{
			ID:         fmt.Sprintf("alert:%d", id),
			EventType:  "signal_received",
			OccurredAt: createdAt,
			Title:      fmt.Sprintf("%s signal", strings.ToUpper(strings.TrimSpace(alertType))),
			Scope:      performanceEventScope(ticker, source),
			Ticker:     ticker,
			Source:     source,
			Severity:   performanceEventSeverity(alertType),
			ValueAUD:   value,
			Metadata: map[string]interface{}{
				"strength":        strength,
				"exchange_prefix": exchangePrefix,
				"timeframe":       timeframe,
			},
		})
	}
	if err := alertRows.Err(); err != nil {
		alertRows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	alertRows.Close()

	expiredAlertRows, err := db.Query(`
		SELECT id, ticker, alert_type, COALESCE(source, ''), COALESCE(exchange_prefix, ''),
		       COALESCE(resolved_note, ''), resolved_at
		FROM alerts
		WHERE resolved_reason = 'EXPIRED'
		  AND resolved_at IS NOT NULL
		ORDER BY resolved_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for expiredAlertRows.Next() {
		var id int64
		var ticker, alertType, source, exchangePrefix, resolvedNote string
		var resolvedAt time.Time
		if err := expiredAlertRows.Scan(&id, &ticker, &alertType, &source, &exchangePrefix, &resolvedNote, &resolvedAt); err != nil {
			expiredAlertRows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		appendEvent(PerformanceEvent{
			ID:         fmt.Sprintf("alert-expired:%d", id),
			EventType:  "signal_expired",
			OccurredAt: resolvedAt,
			Title:      fmt.Sprintf("%s expired", strings.ToUpper(strings.TrimSpace(alertType))),
			Scope:      performanceEventScope(ticker, source),
			Ticker:     ticker,
			Source:     source,
			Severity:   "neutral",
			Metadata: map[string]interface{}{
				"alert_type":      alertType,
				"exchange_prefix": exchangePrefix,
				"reason":          "EXPIRED",
				"notes":           resolvedNote,
			},
		})
	}
	if err := expiredAlertRows.Err(); err != nil {
		expiredAlertRows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	expiredAlertRows.Close()

	decisionRows, err := db.Query(`
		SELECT d.id, COALESCE(a.ticker, ''), d.decision, COALESCE(d.notes, ''),
		       d.position_pct_after, d.created_at, COALESCE(a.alert_type, ''),
		       COALESCE(a.source, ''), COALESCE(a.strength, ''), COALESCE(a.timeframe, '')
		FROM decisions d
		LEFT JOIN alerts a ON a.id = d.alert_id
		ORDER BY d.created_at DESC, d.id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for decisionRows.Next() {
		var id int64
		var ticker, decision, notes, alertType, source, strength, timeframe string
		var positionPct sql.NullFloat64
		var createdAt time.Time
		if err := decisionRows.Scan(&id, &ticker, &decision, &notes, &positionPct, &createdAt, &alertType, &source, &strength, &timeframe); err != nil {
			decisionRows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var pct *float64
		if positionPct.Valid {
			v := positionPct.Float64
			pct = &v
		}
		appendEvent(PerformanceEvent{
			ID:         fmt.Sprintf("decision:%d", id),
			EventType:  "decision_recorded",
			OccurredAt: createdAt,
			Title:      performanceDecisionTitle(decision, alertType),
			Scope:      performanceEventScope(ticker, source),
			Ticker:     ticker,
			Source:     source,
			Severity:   performanceEventSeverity(decision),
			PctValue:   pct,
			Metadata: map[string]interface{}{
				"alert_type": alertType,
				"decision":   decision,
				"notes":      notes,
				"strength":   strength,
				"timeframe":  timeframe,
			},
		})
	}
	if err := decisionRows.Err(); err != nil {
		decisionRows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	decisionRows.Close()

	q3Rows, err := db.Query(`
		SELECT id, source_ticker, target_equity_pct, received_at
		FROM equity_sizing_history
		ORDER BY received_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for q3Rows.Next() {
		var id int64
		var sourceTicker string
		var targetPct float64
		var receivedAt time.Time
		if err := q3Rows.Scan(&id, &sourceTicker, &targetPct, &receivedAt); err != nil {
			q3Rows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		pct := targetPct
		appendEvent(PerformanceEvent{
			ID:         fmt.Sprintf("q3:%d", id),
			EventType:  "q3_target_changed",
			OccurredAt: receivedAt,
			Title:      "Q3 target changed",
			Scope:      "portfolio_risk",
			Ticker:     sourceTicker,
			Source:     "q3d",
			Severity:   "risk",
			PctValue:   &pct,
		})
	}
	if err := q3Rows.Err(); err != nil {
		q3Rows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	q3Rows.Close()

	var q4Active bool
	var q4Changed time.Time
	var q4Reason string
	err = db.QueryRow(`SELECT active, last_changed_at, COALESCE(reason, '') FROM q4_crisis_state WHERE id = 1`).Scan(&q4Active, &q4Changed, &q4Reason)
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err == nil {
		pct := 100.0
		title := "Q4 cleared"
		severity := "positive"
		if q4Active {
			pct = 10.0
			title = "Q4 crisis active"
			severity = "negative"
		}
		appendEvent(PerformanceEvent{
			ID:         "q4:state",
			EventType:  "q4_state_changed",
			OccurredAt: q4Changed,
			Title:      title,
			Scope:      "portfolio_risk",
			Source:     "q4d",
			Severity:   severity,
			PctValue:   &pct,
			Metadata: map[string]interface{}{
				"active": q4Active,
				"reason": q4Reason,
			},
		})
	}

	planRows, err := db.Query(`
		SELECT id, status, driver, COALESCE(title, ''), created_at, completed_at, approved_at
		FROM portfolio_rebalance_plans
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for planRows.Next() {
		var id int64
		var status, driver, title string
		var createdAt time.Time
		var completedAt, approvedAt sql.NullTime
		if err := planRows.Scan(&id, &status, &driver, &title, &createdAt, &completedAt, &approvedAt); err != nil {
			planRows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if strings.TrimSpace(title) == "" {
			title = "Portfolio target"
		}
		metadata := map[string]interface{}{"status": status, "driver": driver}
		appendEvent(PerformanceEvent{
			ID:         fmt.Sprintf("portfolio-target:%d:created", id),
			EventType:  "portfolio_target_created",
			OccurredAt: createdAt,
			Title:      title,
			Scope:      "portfolio",
			Severity:   "neutral",
			Metadata:   metadata,
		})
		if completedAt.Valid {
			appendEvent(PerformanceEvent{
				ID:         fmt.Sprintf("portfolio-target:%d:completed", id),
				EventType:  "portfolio_target_completed",
				OccurredAt: completedAt.Time,
				Title:      "Portfolio target completed",
				Scope:      "portfolio",
				Severity:   "positive",
				Metadata:   metadata,
			})
		}
		if approvedAt.Valid {
			appendEvent(PerformanceEvent{
				ID:         fmt.Sprintf("portfolio-target:%d:approved", id),
				EventType:  "baseline_approved",
				OccurredAt: approvedAt.Time,
				Title:      "Baseline approved",
				Scope:      "portfolio",
				Severity:   "positive",
				Metadata:   metadata,
			})
		}
	}
	if err := planRows.Err(); err != nil {
		planRows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	planRows.Close()

	overlayRows, err := db.Query(`
		SELECT id, status, from_q1_exposure_pct, to_q1_exposure_pct,
		       stage1_required_reduction_value, stage1_recorded_reduction_value,
		       triggered_at, stage1_applied_at, stage2_completed_at, baseline_accepted_at
		FROM overlay_events
		ORDER BY triggered_at DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for overlayRows.Next() {
		var id int64
		var status string
		var fromPct, toPct, requiredValue, recordedValue float64
		var triggeredAt time.Time
		var stage1AppliedAt, stage2CompletedAt, baselineAcceptedAt sql.NullTime
		if err := overlayRows.Scan(&id, &status, &fromPct, &toPct, &requiredValue, &recordedValue, &triggeredAt, &stage1AppliedAt, &stage2CompletedAt, &baselineAcceptedAt); err != nil {
			overlayRows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		value := requiredValue
		toValue := toPct
		metadata := map[string]interface{}{
			"status":         status,
			"from_q1_pct":    fromPct,
			"to_q1_pct":      toPct,
			"recorded_value": recordedValue,
		}
		appendEvent(PerformanceEvent{
			ID:         fmt.Sprintf("overlay:%d:triggered", id),
			EventType:  "portfolio_risk_action_created",
			OccurredAt: triggeredAt,
			Title:      "Portfolio risk action",
			Scope:      "portfolio_risk",
			Severity:   "risk",
			ValueAUD:   &value,
			PctValue:   &toValue,
			Metadata:   metadata,
		})
		if stage1AppliedAt.Valid {
			appendEvent(PerformanceEvent{
				ID:         fmt.Sprintf("overlay:%d:stage1", id),
				EventType:  "position_action_confirmed",
				OccurredAt: stage1AppliedAt.Time,
				Title:      "Position action confirmed",
				Scope:      "portfolio_risk",
				Severity:   "positive",
				ValueAUD:   &recordedValue,
				Metadata:   metadata,
			})
		}
		if stage2CompletedAt.Valid {
			appendEvent(PerformanceEvent{
				ID:         fmt.Sprintf("overlay:%d:stage2", id),
				EventType:  "statement_matched",
				OccurredAt: stage2CompletedAt.Time,
				Title:      "Statement matched",
				Scope:      "portfolio_risk",
				Severity:   "positive",
				Metadata:   metadata,
			})
		}
		if baselineAcceptedAt.Valid {
			appendEvent(PerformanceEvent{
				ID:         fmt.Sprintf("overlay:%d:baseline", id),
				EventType:  "baseline_approved",
				OccurredAt: baselineAcceptedAt.Time,
				Title:      "Baseline approved",
				Scope:      "portfolio_risk",
				Severity:   "positive",
				Metadata:   metadata,
			})
		}
	}
	if err := overlayRows.Err(); err != nil {
		overlayRows.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	overlayRows.Close()

	sort.SliceStable(events, func(i, j int) bool {
		if events[i].OccurredAt.Equal(events[j].OccurredAt) {
			return events[i].ID > events[j].ID
		}
		return events[i].OccurredAt.After(events[j].OccurredAt)
	})
	if len(events) > limit {
		events = events[:limit]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

func getSecurityPerformanceDirections(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		WITH ranked AS (
			SELECT
				UPPER(TRIM(COALESCE(ticker, name))) AS ticker_key,
				COALESCE(ticker, '') AS ticker,
				name,
				asset_class,
				observed_at,
				price,
				ROW_NUMBER() OVER (
					PARTITION BY UPPER(TRIM(COALESCE(ticker, name)))
					ORDER BY observed_at DESC, statement_id DESC
				) AS rn
			FROM security_position_snapshots
			WHERE COALESCE(ticker, name) IS NOT NULL
		),
		latest AS (
			SELECT * FROM ranked WHERE rn = 1
		),
		previous AS (
			SELECT * FROM ranked WHERE rn = 2
		)
		SELECT latest.ticker, latest.name, latest.asset_class, latest.observed_at,
		       previous.observed_at AS previous_at,
		       latest.price, COALESCE(previous.price, latest.price) AS previous_price
		FROM latest
		LEFT JOIN previous ON previous.ticker_key = latest.ticker_key
		ORDER BY latest.name ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	directions := []SecurityPerformanceDirection{}
	for rows.Next() {
		var item SecurityPerformanceDirection
		var previousAt sql.NullTime
		if err := rows.Scan(
			&item.Ticker,
			&item.Name,
			&item.AssetClass,
			&item.ObservedAt,
			&previousAt,
			&item.Price,
			&item.PreviousPrice,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if previousAt.Valid {
			item.PreviousAt = previousAt.Time
		}
		item.Change = item.Price - item.PreviousPrice
		if item.PreviousPrice != 0 {
			item.ChangePct = (item.Change / item.PreviousPrice) * 100
		}
		switch {
		case item.Change > 0.000001:
			item.Direction = "up"
		case item.Change < -0.000001:
			item.Direction = "down"
		default:
			item.Direction = "flat"
		}
		directions = append(directions, item)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(directions)
}

// Get all statements (summary only)
func getStatements(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, account_name, statement_date, total_value_aud, cash_aud,
		       usd_value, usd_aud, gbp_value, gbp_aud, aud_value, created_at
		FROM account_statements
		ORDER BY statement_date DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var statements []AccountStatement
	for rows.Next() {
		var s AccountStatement
		err := rows.Scan(&s.ID, &s.AccountName, &s.StatementDate, &s.TotalValueAUD, &s.CashAUD,
			&s.USDValue, &s.USDAUD, &s.GBPValue, &s.GBPAUD, &s.AUDValue, &s.CreatedAt)
		if err != nil {
			continue
		}
		statements = append(statements, s)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statements)
}

// Get statement detail with holdings
func getStatementDetail(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Get statement
	var statement AccountStatement
	err := db.QueryRow(`
		SELECT id, account_name, statement_date, total_value_aud, cash_aud,
		       usd_value, usd_aud, gbp_value, gbp_aud, aud_value, created_at
		FROM account_statements
		WHERE id = ?
	`, id).Scan(&statement.ID, &statement.AccountName, &statement.StatementDate,
		&statement.TotalValueAUD, &statement.CashAUD, &statement.USDValue, &statement.USDAUD,
		&statement.GBPValue, &statement.GBPAUD, &statement.AUDValue, &statement.CreatedAt)

	if err != nil {
		http.Error(w, "Statement not found", http.StatusNotFound)
		return
	}

	// Get holdings with company mappings (LEFT JOIN to handle unmapped companies)
	rows, err := db.Query(`
		SELECT h.id, h.statement_id, h.details, h.quantity, h.cost_aud, h.current_price,
		       h.value_aud, h.gain_loss_aud, h.gain_loss_pct, h.currency, h.market_value,
		       h.cash_reserve, m.ticker, m.exchange_prefix, m.template_id, h.created_at
		FROM statement_holdings h
		LEFT JOIN company_mappings m ON h.details = m.company_name
		WHERE h.statement_id = ?
		ORDER BY h.value_aud DESC
	`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var holdings []StatementHolding
	for rows.Next() {
		var h StatementHolding
		err := rows.Scan(&h.ID, &h.StatementID, &h.Details, &h.Quantity, &h.CostAUD,
			&h.CurrentPrice, &h.ValueAUD, &h.GainLossAUD, &h.GainLossPct, &h.Currency,
			&h.MarketValue, &h.CashReserve, &h.Ticker, &h.ExchangePrefix, &h.TemplateID, &h.CreatedAt)
		if err != nil {
			continue
		}
		holdings = append(holdings, h)
	}

	response := map[string]interface{}{
		"statement": statement,
		"holdings":  holdings,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Get latest statement with holdings
// IMPORTANT: This now reads from the unified holdings table (single source of truth)
func getLatestStatement(w http.ResponseWriter, r *http.Request) {
	// Get latest statement (for portfolio metadata)
	var statement AccountStatement
	err := db.QueryRow(`
		SELECT id, account_name, statement_date, total_value_aud, cash_aud,
		       usd_value, usd_aud, gbp_value, gbp_aud, aud_value, created_at
		FROM account_statements
		ORDER BY statement_date DESC
		LIMIT 1
	`).Scan(&statement.ID, &statement.AccountName, &statement.StatementDate,
		&statement.TotalValueAUD, &statement.CashAUD, &statement.USDValue, &statement.USDAUD,
		&statement.GBPValue, &statement.GBPAUD, &statement.AUDValue, &statement.CreatedAt)

	if err == sql.ErrNoRows {
		// No data yet - return empty statement with empty holdings
		log.Println("[ALPHA EDGE] No account statements found, returning empty statement")
		response := map[string]interface{}{
			"statement": AccountStatement{
				ID:            0,
				AccountName:   "",
				StatementDate: time.Time{},
				TotalValueAUD: 0.0,
				CashAUD:       0.0,
				USDValue:      0.0,
				USDAUD:        0.0,
				GBPValue:      0.0,
				GBPAUD:        0.0,
				AUDValue:      0.0,
				CreatedAt:     time.Time{},
			},
			"holdings": []StatementHolding{},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	if err != nil {
		log.Printf("[ALPHA EDGE] Error fetching latest statement: %v", err)
		http.Error(w, "Error fetching latest statement", http.StatusInternalServerError)
		return
	}

	log.Printf("[ALPHA EDGE] Latest statement fetched: ID=%d, Date=%s", statement.ID, statement.StatementDate)

	// Get cash-equivalent ETF value to add to cash_on_hand.
	var cashEquivalentValue float64
	cashTickerKey := stockAnalysisTickerKeySQL("COALESCE(m.ticker, h.ticker, '')")
	db.QueryRow(fmt.Sprintf(`
		SELECT COALESCE(SUM(value_aud), 0)
		FROM holdings h
		LEFT JOIN company_mappings m ON h.company_name = m.company_name
		WHERE h.is_active = 1
		  AND %s IN ('BSUB', 'AAA')
	`, cashTickerKey)).Scan(&cashEquivalentValue)
	if cashEquivalentValue > 0 {
		statement.CashAUD += cashEquivalentValue
	}

	// Get holdings from the unified holdings table (SINGLE SOURCE OF TRUTH)
	// This ensures consistency with groups, analysis, and all other features
	// Cash-equivalent ETFs are excluded here; the portfolio tab shows them under Cash/Reserve.
	rows, err := db.Query(fmt.Sprintf(`
		SELECT h.id, COALESCE(m.ticker, h.ticker), h.company_name, h.quantity, h.cost_aud, h.current_price,
		       h.value_aud, h.gain_loss_aud, h.gain_loss_pct, h.currency, h.market_value,
		       h.cash_reserve, COALESCE(m.exchange_prefix, h.exchange_prefix), m.template_id, h.created_at
		FROM holdings h
		LEFT JOIN company_mappings m ON h.company_name = m.company_name
		WHERE h.is_active = 1
		  AND %s NOT IN ('BSUB', 'AAA')
		ORDER BY h.value_aud DESC
	`, cashTickerKey))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var holdings []StatementHolding
	for rows.Next() {
		var h StatementHolding
		var ticker, exchangePrefix, templateID *string
		// Map from holdings table to StatementHolding structure
		err := rows.Scan(&h.ID, &ticker, &h.Details, &h.Quantity, &h.CostAUD,
			&h.CurrentPrice, &h.ValueAUD, &h.GainLossAUD, &h.GainLossPct, &h.Currency,
			&h.MarketValue, &h.CashReserve, &exchangePrefix, &templateID, &h.CreatedAt)
		if err != nil {
			log.Printf("[ALPHA EDGE] Error scanning holding: %v", err)
			continue
		}
		// Set statement_id for compatibility (not used in new architecture)
		h.StatementID = statement.ID
		// Convert pointers to struct fields
		if ticker != nil {
			h.Ticker = ticker
		}
		if exchangePrefix != nil {
			h.ExchangePrefix = exchangePrefix
		}
		if templateID != nil {
			h.TemplateID = templateID
		}
		holdings = append(holdings, h)
	}

	log.Printf("[ALPHA EDGE] Returning %d active holdings from unified holdings table", len(holdings))

	response := map[string]interface{}{
		"statement": statement,
		"holdings":  holdings,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Stock Analysis Endpoints
