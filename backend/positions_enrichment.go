package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

func updateHolding(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var update struct {
		CashReserve *float64 `json:"cash_reserve"`
	}

	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if update.CashReserve != nil {
		_, err := db.Exec(`
			UPDATE holdings
			SET cash_reserve = ?
			WHERE id = ?
		`, *update.CashReserve, id)

		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

// Company Mapping & Ticker Enrichment

type CompanyMapping struct {
	ID             int       `json:"id"`
	CompanyName    string    `json:"company_name"`
	Ticker         string    `json:"ticker"`
	ExchangePrefix string    `json:"exchange_prefix"`
	TemplateID     *string   `json:"template_id"`
	EnrichedAt     time.Time `json:"enriched_at"`
	CreatedAt      time.Time `json:"created_at"`
}

type OpenAIRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OpenAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type TickerEnrichmentResult struct {
	CompanyName    string `json:"company_name"`
	Ticker         string `json:"ticker"`
	ExchangePrefix string `json:"exchange_prefix"`
}

func getCompanyMappings(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, company_name, ticker, exchange_prefix, template_id, enriched_at, created_at
		FROM company_mappings
		ORDER BY company_name
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var mappings []CompanyMapping
	for rows.Next() {
		var m CompanyMapping
		err := rows.Scan(&m.ID, &m.CompanyName, &m.Ticker, &m.ExchangePrefix, &m.TemplateID, &m.EnrichedAt, &m.CreatedAt)
		if err != nil {
			continue
		}
		mappings = append(mappings, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mappings)
}

func enrichTickers(w http.ResponseWriter, r *http.Request) {
	// Check if force parameter is set to re-enrich all companies
	force := r.URL.Query().Get("force") == "true"

	// Get all unique company names from latest statement
	var query string
	if force {
		// Re-enrich ALL companies
		query = `
			SELECT DISTINCT h.details
			FROM statement_holdings h
			INNER JOIN account_statements s ON h.statement_id = s.id
			WHERE s.id = (SELECT id FROM account_statements ORDER BY statement_date DESC LIMIT 1)
		`
	} else {
		// Only enrich unmapped companies
		query = `
			SELECT DISTINCT h.details
			FROM statement_holdings h
			INNER JOIN account_statements s ON h.statement_id = s.id
			WHERE s.id = (SELECT id FROM account_statements ORDER BY statement_date DESC LIMIT 1)
			AND h.details NOT IN (SELECT company_name FROM company_mappings)
		`
	}

	rows, err := db.Query(query)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var unmapped []string
	for rows.Next() {
		var name string
		err := rows.Scan(&name)
		if err != nil {
			continue
		}
		unmapped = append(unmapped, name)
	}

	if len(unmapped) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message": "No companies to enrich",
			"count":   0,
			"total":   0,
		})
		return
	}

	// Call AI to enrich tickers
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		http.Error(w, "OPENAI_API_KEY not configured", http.StatusInternalServerError)
		return
	}

	enriched := 0
	for _, companyName := range unmapped {
		result, err := callAIForTicker(companyName, apiKey)
		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to enrich %s: %v", companyName, err)
			continue
		}

		// Store mapping
		_, err = db.Exec(`
			INSERT INTO company_mappings (company_name, ticker, exchange_prefix, enriched_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(company_name) DO UPDATE SET
				ticker = excluded.ticker,
				exchange_prefix = excluded.exchange_prefix,
				enriched_at = CURRENT_TIMESTAMP
		`, companyName, result.Ticker, result.ExchangePrefix)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to store mapping for %s: %v", companyName, err)
			continue
		}

		enriched++
		log.Printf("[ALPHA EDGE] Enriched: %s -> %s%s", companyName, result.ExchangePrefix, result.Ticker)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Ticker enrichment completed",
		"count":   enriched,
		"total":   len(unmapped),
	})
}

func updateCompanyMapping(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var updates struct {
		Ticker         *string `json:"ticker"`
		ExchangePrefix *string `json:"exchange_prefix"`
		TemplateID     *string `json:"template_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Build update query dynamically
	query := "UPDATE company_mappings SET "
	args := []interface{}{}
	updates_made := false

	if updates.Ticker != nil {
		query += "ticker = ?, "
		args = append(args, *updates.Ticker)
		updates_made = true
	}

	if updates.ExchangePrefix != nil {
		query += "exchange_prefix = ?, "
		args = append(args, *updates.ExchangePrefix)
		updates_made = true
	}

	if updates.TemplateID != nil {
		query += "template_id = NULLIF(?, ''), "
		args = append(args, *updates.TemplateID)
		updates_made = true
	}

	if !updates_made {
		http.Error(w, "No updates provided", http.StatusBadRequest)
		return
	}

	query += "enriched_at = CURRENT_TIMESTAMP WHERE id = ?"
	args = append(args, id)

	_, err := db.Exec(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[ALPHA EDGE] Updated mapping ID %s", id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

func bulkUpdateMappings(w http.ResponseWriter, r *http.Request) {
	var mappings []struct {
		CompanyName    string `json:"company_name"`
		Ticker         string `json:"ticker"`
		ExchangePrefix string `json:"exchange_prefix"`
		TemplateID     string `json:"template_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&mappings); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	updated := 0
	for _, mapping := range mappings {
		// Update company_mappings table
		_, err := db.Exec(`
			INSERT INTO company_mappings (company_name, ticker, exchange_prefix, template_id, enriched_at)
			VALUES (?, ?, ?, NULLIF(?, ''), CURRENT_TIMESTAMP)
			ON CONFLICT(company_name) DO UPDATE SET
				ticker = excluded.ticker,
				exchange_prefix = excluded.exchange_prefix,
				template_id = COALESCE(NULLIF(excluded.template_id, ''), company_mappings.template_id),
				enriched_at = CURRENT_TIMESTAMP
		`, mapping.CompanyName, mapping.Ticker, mapping.ExchangePrefix, mapping.TemplateID)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to update mapping for %s: %v", mapping.CompanyName, err)
			continue
		}

		// Also update holdings table to reflect the new ticker immediately
		_, err = db.Exec(`
			UPDATE holdings
			SET ticker = ?, exchange_prefix = ?
			WHERE company_name = ? AND is_active = 1
		`, mapping.Ticker, mapping.ExchangePrefix, mapping.CompanyName)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to update holdings for %s: %v", mapping.CompanyName, err)
		}

		// Also update stock_analysis table (for watchlist items)
		// The ticker field in stock_analysis stores the full "PREFIX:SYMBOL" format
		fullTicker := mapping.ExchangePrefix + mapping.Ticker
		_, err = db.Exec(`
			UPDATE stock_analysis
			SET ticker = ?
			WHERE name = ?
		`, fullTicker, mapping.CompanyName)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to update stock_analysis for %s: %v", mapping.CompanyName, err)
		}

		log.Printf("[ALPHA EDGE] Updated: %s -> %s%s", mapping.CompanyName, mapping.ExchangePrefix, mapping.Ticker)
		updated++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Bulk update completed",
		"updated": updated,
		"total":   len(mappings),
	})
}

type YahooSearchResult struct {
	Quotes []struct {
		Symbol    string `json:"symbol"`
		Exchange  string `json:"exchange"`
		ShortName string `json:"shortname"`
		LongName  string `json:"longname"`
		QuoteType string `json:"quoteType"`
	} `json:"quotes"`
}

// Security Position Handlers

func getSecurityPositions(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, ticker, position_state, manual_override, COALESCE(stopped_waiting_reentry, 0), last_updated, created_at
		FROM security_positions
		ORDER BY ticker
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var positions []SecurityPosition
	for rows.Next() {
		var p SecurityPosition
		err := rows.Scan(&p.ID, &p.Ticker, &p.PositionState, &p.ManualOverride, &p.StoppedWaitingReentry, &p.LastUpdated, &p.CreatedAt)
		if err != nil {
			continue
		}
		positions = append(positions, p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(positions)
}

func updateSecurityPosition(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	ticker := vars["ticker"]

	var update struct {
		PositionState  *string `json:"position_state"`
		ManualOverride *bool   `json:"manual_override"`
	}

	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Build update query dynamically
	query := "UPDATE security_positions SET "
	args := []interface{}{}
	updates_made := false

	if update.PositionState != nil {
		query += "position_state = ?, "
		args = append(args, *update.PositionState)
		updates_made = true
	}

	if update.ManualOverride != nil {
		query += "manual_override = ?, "
		args = append(args, *update.ManualOverride)
		updates_made = true
	}

	if !updates_made {
		http.Error(w, "No updates provided", http.StatusBadRequest)
		return
	}

	query += "last_updated = CURRENT_TIMESTAMP WHERE ticker = ?"
	args = append(args, ticker)

	_, err := db.Exec(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[ALPHA EDGE] Updated position for %s", ticker)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

// ETF Position Handlers

func getETFPositions(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, ticker, position_state, allocation_pct, cash_allocated, manual_override, last_updated, created_at
		FROM etf_positions
		ORDER BY ticker
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	positions := []ETFPosition{}
	for rows.Next() {
		var p ETFPosition
		err := rows.Scan(&p.ID, &p.Ticker, &p.PositionState, &p.AllocationPct, &p.CashAllocated, &p.ManualOverride, &p.LastUpdated, &p.CreatedAt)
		if err != nil {
			continue
		}
		positions = append(positions, p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(positions)
}

func updateETFPosition(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	ticker := vars["ticker"]

	var update struct {
		PositionState  *string  `json:"position_state"`
		AllocationPct  *float64 `json:"allocation_pct"`
		CashAllocated  *float64 `json:"cash_allocated"`
		ManualOverride *bool    `json:"manual_override"`
	}

	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Get current position values for execution logging
	var currentAllocation, currentCash float64
	db.QueryRow(`SELECT allocation_pct, cash_allocated FROM etf_positions WHERE ticker = ?`, ticker).Scan(&currentAllocation, &currentCash)

	// Build update query dynamically
	query := "UPDATE etf_positions SET "
	args := []interface{}{}
	updates_made := false

	if update.PositionState != nil {
		query += "position_state = ?, "
		args = append(args, *update.PositionState)
		updates_made = true
	}

	if update.AllocationPct != nil {
		query += "allocation_pct = ?, "
		args = append(args, *update.AllocationPct)
		updates_made = true
	}

	if update.CashAllocated != nil {
		query += "cash_allocated = ?, "
		args = append(args, *update.CashAllocated)
		updates_made = true
	}

	if update.ManualOverride != nil {
		query += "manual_override = ?, "
		args = append(args, *update.ManualOverride)
		updates_made = true
	}

	if !updates_made {
		http.Error(w, "No updates provided", http.StatusBadRequest)
		return
	}

	query += "last_updated = CURRENT_TIMESTAMP WHERE ticker = ?"
	args = append(args, ticker)

	_, err := db.Exec(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log execution if allocation or cash changed
	if update.AllocationPct != nil || update.CashAllocated != nil {
		newAllocation := currentAllocation
		newCash := currentCash
		if update.AllocationPct != nil {
			newAllocation = *update.AllocationPct
		}
		if update.CashAllocated != nil {
			newCash = *update.CashAllocated
		}

		// Determine signal based on allocation change
		signal := "ADD"
		if newAllocation < currentAllocation {
			signal = "TRIM"
		} else if newAllocation == 0 {
			signal = "SELL"
		} else if currentAllocation == 0 {
			signal = "BUY"
		}

		db.Exec(`
			INSERT INTO etf_executions (ticker, signal, allocation_before, allocation_after, cash_before, cash_after)
			VALUES (?, ?, ?, ?, ?, ?)
		`, ticker, signal, currentAllocation, newAllocation, currentCash, newCash)
	}

	log.Printf("[ALPHA EDGE] Updated ETF position for %s", ticker)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

func getActiveRebalance(w http.ResponseWriter, r *http.Request) {
	// Get the current active rebalance. Superseded sequences are historical records
	// and should not reappear in the active ETF workflow.
	rows, err := db.Query(`
		SELECT id, sequence_number, rebalance_date, ticker, rank, return_60bar,
		       current_allocation, target_allocation, pending_delta, status,
		       weighted_portfolio_return, created_at, expires_at
		FROM etf_rebalance_targets
		WHERE expires_at > CURRENT_TIMESTAMP
		  AND status = 'PENDING'
		ORDER BY rebalance_date DESC, rank ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	targets := []ETFRebalanceTarget{}
	for rows.Next() {
		var t ETFRebalanceTarget
		err := rows.Scan(&t.ID, &t.SequenceNumber, &t.RebalanceDate, &t.Ticker, &t.Rank, &t.Return60Bar,
			&t.CurrentAllocation, &t.TargetAllocation, &t.PendingDelta, &t.Status,
			&t.WeightedPortfolioReturn, &t.CreatedAt, &t.ExpiresAt)
		if err != nil {
			continue
		}
		targets = append(targets, t)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(targets)
}

func dismissRebalance(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sequenceStr := vars["sequence"]

	sequence, err := strconv.Atoi(sequenceStr)
	if err != nil {
		http.Error(w, "Invalid sequence number", http.StatusBadRequest)
		return
	}

	// Update all targets with this sequence_number to CANCELLED status
	result, err := db.Exec(`
		UPDATE etf_rebalance_targets
		SET status = 'CANCELLED'
		WHERE sequence_number = $1
		  AND status != 'CANCELLED'
	`, sequence)

	if err != nil {
		log.Printf("[ALPHA EDGE] Failed to dismiss rebalance sequence %d: %v", sequence, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("[ALPHA EDGE] Dismissed rebalance sequence %d (%d targets cancelled)", sequence, rowsAffected)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":            "dismissed",
		"sequence_number":   sequence,
		"targets_cancelled": rowsAffected,
	})
}

func etfRebalanceWebhook(w http.ResponseWriter, r *http.Request) {
	acknowledgeAndProcessWebhook(w, r, "etf_rebalance")
}

func etfRebalanceWebhookSync(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		SequenceNumber          int     `json:"sequence_number"`
		RebalanceDate           string  `json:"rebalance_date"`
		WeightedPortfolioReturn float64 `json:"weighted_portfolio_return"`
		Allocations             []struct {
			Ticker      string  `json:"ticker"`
			Rank        int     `json:"rank"`
			Return60Bar float64 `json:"return_60bar"`
			Allocation  float64 `json:"allocation"`
		} `json:"allocations"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Parse rebalance date
	rebalanceDate, err := time.Parse("2006-01-02", payload.RebalanceDate)
	if err != nil {
		http.Error(w, "Invalid rebalance date format", http.StatusBadRequest)
		return
	}

	// Set expiry to 3 days from now
	expiresAt := time.Now().Add(72 * time.Hour)

	// Mark all previous rebalances as SUPERSEDED
	db.Exec(`UPDATE etf_rebalance_targets SET status = 'SUPERSEDED' WHERE status = 'PENDING'`)

	// Insert new rebalance targets
	for _, alloc := range payload.Allocations {
		// Get current allocation from etf_positions
		var currentAlloc float64
		db.QueryRow(`SELECT allocation_pct FROM etf_positions WHERE ticker = ?`, alloc.Ticker).Scan(&currentAlloc)

		pendingDelta := alloc.Allocation - currentAlloc

		_, err := db.Exec(`
			INSERT INTO etf_rebalance_targets
			(sequence_number, rebalance_date, ticker, rank, return_60bar, current_allocation,
			 target_allocation, pending_delta, status, weighted_portfolio_return, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
		`, payload.SequenceNumber, rebalanceDate, alloc.Ticker, alloc.Rank, alloc.Return60Bar,
			currentAlloc, alloc.Allocation, pendingDelta, payload.WeightedPortfolioReturn, expiresAt)

		if err != nil {
			log.Printf("[ALPHA EDGE] Error inserting rebalance target for %s: %v", alloc.Ticker, err)
		}
	}

	// Update etf_allocations with the new target allocations
	for _, alloc := range payload.Allocations {
		_, err := db.Exec(`
			INSERT INTO etf_allocations (ticker, allocation_percent, base_weight, last_updated)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(ticker) DO UPDATE SET
				allocation_percent = excluded.allocation_percent,
				base_weight = excluded.base_weight,
				last_updated = CURRENT_TIMESTAMP
		`, strings.ToUpper(strings.TrimSpace(alloc.Ticker)), alloc.Allocation, alloc.Allocation)
		if err != nil {
			log.Printf("[ALPHA EDGE] Error updating etf_allocation for %s: %v", alloc.Ticker, err)
		}
	}

	log.Printf("[ALPHA EDGE] Received rebalance webhook: sequence=%d, date=%s, %d allocations, return=%.2f%%",
		payload.SequenceNumber, payload.RebalanceDate, len(payload.Allocations), payload.WeightedPortfolioReturn)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "received"})
}

func migratePreviousAlerts(w http.ResponseWriter, r *http.Request) {
	// Fetch data from previous database
	previousDBURL := "https://tradingview-apiservice.fly.dev/webhook"

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(previousDBURL)
	if err != nil {
		http.Error(w, "Failed to fetch previous alerts: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	var previousAlerts []PreviousAlert
	if err := json.NewDecoder(resp.Body).Decode(&previousAlerts); err != nil {
		http.Error(w, "Failed to parse previous alerts: "+err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[ALPHA EDGE] Fetched %d alerts from previous database", len(previousAlerts))

	// Start transaction
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	alertsCreated := 0
	positionsCreated := 0

	for _, prevAlert := range previousAlerts {
		// Extract ticker from exchange:symbol format (e.g., "ASX_DLY:TEA" -> "TEA")
		ticker := prevAlert.Ticker
		if idx := len(ticker) - 1; idx >= 0 {
			// Find the last colon
			for i := len(ticker) - 1; i >= 0; i-- {
				if ticker[i] == ':' {
					ticker = ticker[i+1:]
					break
				}
			}
		}

		// Convert signal to uppercase (buy -> BUY, sell -> SELL)
		signal := ""
		switch prevAlert.Signal {
		case "buy":
			signal = "BUY"
		case "sell":
			signal = "SELL"
		default:
			log.Printf("[ALPHA EDGE] Unknown signal '%s' for %s, skipping", prevAlert.Signal, ticker)
			continue
		}

		// Create or update security position (only for BUY/SELL)
		_, err := tx.Exec(`
			INSERT INTO security_positions (ticker, position_state, last_updated)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(ticker) DO UPDATE SET
				position_state = excluded.position_state,
				last_updated = CURRENT_TIMESTAMP
		`, ticker, signal)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to create position for %s: %v", ticker, err)
			continue
		}
		positionsCreated++

		// Create alert
		_, err = tx.Exec(`
			INSERT INTO alerts (ticker, alert_type, strength, created_at, is_active)
			VALUES (?, ?, NULL, ?, 1)
		`, ticker, signal, prevAlert.DateUpdated)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to create alert for %s: %v", ticker, err)
			continue
		}
		alertsCreated++
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[ALPHA EDGE] Migration complete: %d positions, %d alerts created", positionsCreated, alertsCreated)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":           "Migration completed",
		"positions_created": positionsCreated,
		"alerts_created":    alertsCreated,
		"total_processed":   len(previousAlerts),
	})
}

func callAIForTicker(companyName string, apiKey string) (*TickerEnrichmentResult, error) {
	// Search with plain company name (Yahoo Finance works better without .AX suffix)
	searchURL := fmt.Sprintf("https://query2.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=10&newsCount=0",
		companyName)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("yahoo finance search failed: %v", err)
	}
	defer resp.Body.Close()

	var searchResult YahooSearchResult
	if err := json.NewDecoder(resp.Body).Decode(&searchResult); err != nil {
		return nil, fmt.Errorf("failed to parse yahoo response: %v", err)
	}

	// Filter for ASX exchange results
	var asxQuotes []struct {
		Symbol    string `json:"symbol"`
		Exchange  string `json:"exchange"`
		ShortName string `json:"shortname"`
		LongName  string `json:"longname"`
		QuoteType string `json:"quoteType"`
	}

	for _, quote := range searchResult.Quotes {
		if quote.Exchange == "ASX" || quote.Exchange == "AUS" {
			asxQuotes = append(asxQuotes, quote)
		}
	}

	// Fallback: if no ASX results found, use any major exchange result
	var quote struct {
		Symbol    string `json:"symbol"`
		Exchange  string `json:"exchange"`
		ShortName string `json:"shortname"`
		LongName  string `json:"longname"`
		QuoteType string `json:"quoteType"`
	}

	if len(asxQuotes) > 0 {
		// Prefer ASX results
		quote = asxQuotes[0]
	} else if len(searchResult.Quotes) > 0 {
		// Fallback to first result from any exchange
		quote = searchResult.Quotes[0]
		log.Printf("[ALPHA EDGE] WARNING: No ASX results for '%s', using %s exchange instead", companyName, quote.Exchange)
	} else {
		return nil, fmt.Errorf("no results found for %s", companyName)
	}

	// Strip .AX suffix from ticker if present (we store prefix separately)
	ticker := quote.Symbol
	if len(ticker) > 3 && ticker[len(ticker)-3:] == ".AX" {
		ticker = ticker[:len(ticker)-3]
	}

	// Map exchange names to prefixes
	exchangePrefix := "ASX:"
	switch quote.Exchange {
	case "ASX", "AUS":
		exchangePrefix = "ASX:"
	case "NMS", "NasdaqGS", "NASDAQ":
		exchangePrefix = "NASDAQ:"
	case "NYQ", "NYSE":
		exchangePrefix = "NYSE:"
	case "LSE", "LON":
		exchangePrefix = "LSE:"
	case "TSX", "TOR":
		exchangePrefix = "TSX:"
	default:
		// Use the exchange as-is with colon
		if quote.Exchange != "" {
			exchangePrefix = quote.Exchange + ":"
		}
	}

	result := &TickerEnrichmentResult{
		CompanyName:    companyName,
		Ticker:         ticker,
		ExchangePrefix: exchangePrefix,
	}

	log.Printf("[ALPHA EDGE] Yahoo Finance found: %s -> %s%s (from %s)",
		companyName, exchangePrefix, ticker, quote.Exchange)

	return result, nil
}

// Stock Groups API Handlers
