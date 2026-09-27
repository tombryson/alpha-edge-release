package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

type exchangeTarget struct {
	Kind string `json:"kind"`
	ID   int64  `json:"id"`
}

type exchangeSecurity struct {
	exchangeTarget
	Name, Ticker, Prefix, ISIN, Currency string
	SecurityID                           int64
}

type exchangeMatch struct {
	Prefix string `json:"exchange_prefix"`
	Source string `json:"source"`
}

type exchangeAssignmentResult struct {
	exchangeTarget
	Name   string `json:"name"`
	Ticker string `json:"ticker"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
	exchangeMatch
}

var exchangeAssignmentLock sync.Mutex
var exchangeLookup = lookupMissingExchange

type exchangeQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func loadExchangeSecurity(ctx context.Context, q exchangeQueryer, target exchangeTarget) (exchangeSecurity, error) {
	s := exchangeSecurity{exchangeTarget: target}
	var err error
	if target.Kind == "holding" {
		err = q.QueryRowContext(ctx, `SELECT h.company_name, COALESCE(m.ticker, h.ticker, ''),
			COALESCE(m.exchange_prefix, h.exchange_prefix, ''), COALESCE(h.security_id, 0),
			COALESCE(h.isin, ''), COALESCE(h.currency, '')
			FROM holdings h LEFT JOIN company_mappings m ON m.company_name = h.company_name
			WHERE h.id = ? AND h.is_active = 1`, target.ID).
			Scan(&s.Name, &s.Ticker, &s.Prefix, &s.SecurityID, &s.ISIN, &s.Currency)
	} else {
		err = q.QueryRowContext(ctx, `SELECT name, COALESCE(ticker, ''), COALESCE(security_id, 0)
			FROM stock_analysis WHERE id = ?`, target.ID).Scan(&s.Name, &s.Ticker, &s.SecurityID)
	}
	s.Prefix, s.Ticker = splitSecurityTicker(s.Prefix, s.Ticker)
	return s, err
}

// Existing explicit assignments are stronger evidence than another provider lookup.
// Conflicting local records are never resolved by picking the first result.
func localExchangeMatch(ctx context.Context, q exchangeQueryer, s exchangeSecurity) (exchangeMatch, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT exchange_prefix, ticker FROM security_identities
		WHERE id = ? OR (? != '' AND UPPER(TRIM(isin)) = UPPER(TRIM(?)))
		UNION ALL SELECT exchange_prefix, ticker FROM company_mappings WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?))
		UNION ALL SELECT exchange_prefix, ticker FROM holdings WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?)) AND is_active = 1
		UNION ALL SELECT '', ticker FROM stock_analysis WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
	`, s.SecurityID, s.ISIN, s.ISIN, s.Name, s.Name, s.Name)
	if err != nil {
		return exchangeMatch{}, err
	}
	defer rows.Close()
	prefixes := map[string]bool{}
	for rows.Next() {
		var prefix, ticker sql.NullString
		if err := rows.Scan(&prefix, &ticker); err != nil {
			return exchangeMatch{}, err
		}
		p, symbol := splitSecurityTicker(prefix.String, ticker.String)
		if p == "" {
			continue
		}
		if symbol != s.Ticker || !supportedAssignmentExchange(p) {
			return exchangeMatch{}, errors.New("Existing listing information conflicts; review the security")
		}
		prefixes[p] = true
	}
	if err := rows.Err(); err != nil {
		return exchangeMatch{}, err
	}
	if len(prefixes) > 1 {
		return exchangeMatch{}, errors.New("Multiple exchanges in existing records; choose the intended listing")
	}
	for prefix := range prefixes {
		return exchangeMatch{Prefix: prefix, Source: "existing records"}, nil
	}
	return exchangeMatch{}, nil
}

func autoAssignExchanges(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Items []exchangeTarget `json:"items"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || len(request.Items) < 1 || len(request.Items) > 5 {
		http.Error(w, "Provide between 1 and 5 securities", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "Provide one JSON request", http.StatusBadRequest)
		return
	}
	seen := map[exchangeTarget]bool{}
	for _, item := range request.Items {
		if item.ID < 1 || (item.Kind != "holding" && item.Kind != "analysis") || seen[item] {
			http.Error(w, "Invalid or duplicate security reference", http.StatusBadRequest)
			return
		}
		seen[item] = true
	}
	if !exchangeAssignmentLock.TryLock() {
		http.Error(w, "Exchange assignment is already running. Try again shortly.", http.StatusConflict)
		return
	}
	defer exchangeAssignmentLock.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	results := make([]exchangeAssignmentResult, len(request.Items))
	securities := make([]exchangeSecurity, len(request.Items))
	var lookups sync.WaitGroup
	for i, item := range request.Items {
		results[i] = exchangeAssignmentResult{exchangeTarget: item, Status: "review"}
		s, err := loadExchangeSecurity(ctx, db, item)
		if err != nil {
			results[i].Reason = "Security is no longer available"
			continue
		}
		securities[i] = s
		results[i].Name, results[i].Ticker = s.Name, s.Ticker
		if s.Prefix != "" {
			results[i].Status, results[i].Reason = "skipped", "Exchange is already assigned"
			continue
		}
		if s.Ticker == "" {
			results[i].Reason = "Set the ticker first"
			continue
		}
		match, err := localExchangeMatch(ctx, db, s)
		if err != nil {
			results[i].Reason = err.Error()
			continue
		}
		if match.Prefix != "" {
			results[i].exchangeMatch = match
			continue
		}
		lookups.Add(1)
		go func(i int, s exchangeSecurity) {
			defer lookups.Done()
			match, err := exchangeLookup(ctx, s)
			if err != nil {
				results[i].Reason = err.Error()
				return
			}
			results[i].exchangeMatch = match
		}(i, s)
	}
	lookups.Wait()
	// Network calls finish before the short, serial write transactions begin.
	for i := range results {
		if results[i].Prefix == "" {
			continue
		}
		if err := saveExchangeAssignment(ctx, securities[i], results[i].exchangeMatch); err != nil {
			results[i].Reason = err.Error()
			continue
		}
		results[i].Status = "assigned"
		log.Printf("[EXCHANGE] Auto-assigned %s %d %s -> %s%s (%s)", results[i].Kind, results[i].ID,
			results[i].Name, results[i].Prefix, results[i].Ticker, results[i].Source)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"results": results})
}

func saveExchangeAssignment(ctx context.Context, before exchangeSecurity, match exchangeMatch) error {
	if !supportedAssignmentExchange(match.Prefix) {
		return errors.New("Exchange is not supported for automatic assignment")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	current, err := loadExchangeSecurity(ctx, tx, before.exchangeTarget)
	if err != nil {
		return err
	}
	if current.Prefix != "" || current.Ticker != before.Ticker || current.Name != before.Name || current.SecurityID != before.SecurityID || current.ISIN != before.ISIN || current.Currency != before.Currency {
		return errors.New("Security changed during lookup; existing assignment was preserved")
	}
	local, err := localExchangeMatch(ctx, tx, current)
	if err != nil {
		return err
	}
	if local.Prefix != "" && local.Prefix != match.Prefix {
		return errors.New("Existing assignment conflicts with lookup; review the security")
	}
	// Do not merge separate identities automatically, including an unqualified
	// identity and an already-established listing with the same ticker.
	var destinationID int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM security_identities WHERE exchange_prefix = ? AND ticker = ?`, match.Prefix, current.Ticker).Scan(&destinationID)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if destinationID != 0 && destinationID != current.SecurityID {
		return errors.New("Listing belongs to another security identity; review before linking")
	}
	securityID := current.SecurityID
	if securityID == 0 {
		result, err := tx.ExecContext(ctx, `INSERT INTO security_identities (isin, exchange_prefix, ticker, canonical_name) VALUES (NULLIF(?, ''), ?, ?, ?)`, current.ISIN, match.Prefix, current.Ticker, current.Name)
		if err != nil {
			return errors.New("Could not establish a unique listing identity; review the security")
		}
		securityID, err = result.LastInsertId()
		if err != nil {
			return err
		}
	} else {
		result, err := tx.ExecContext(ctx, `UPDATE security_identities SET exchange_prefix = ?, ticker = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ? AND (exchange_prefix = '' OR exchange_prefix = ?) AND (ticker = '' OR ticker = ?)`, match.Prefix, current.Ticker, securityID, match.Prefix, current.Ticker)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return errors.New("Linked identity conflicts with this listing; review the security")
		}
	}
	if err := addSecurityNameAliasTx(tx, securityID, current.Name, "exchange_auto_assign"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO company_mappings (company_name, ticker, exchange_prefix, security_id, enriched_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(company_name) DO UPDATE SET
		exchange_prefix = excluded.exchange_prefix, security_id = excluded.security_id, enriched_at = CURRENT_TIMESTAMP
		WHERE TRIM(COALESCE(company_mappings.exchange_prefix, '')) = '' AND UPPER(TRIM(company_mappings.ticker)) = excluded.ticker`, current.Name, current.Ticker, match.Prefix, securityID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE holdings SET exchange_prefix = ?, security_id = ?
		WHERE is_active = 1 AND TRIM(COALESCE(exchange_prefix, '')) = '' AND UPPER(TRIM(ticker)) = ?
		AND (security_id = ? OR company_name = ?)`, match.Prefix, securityID, current.Ticker, securityID, current.Name); err != nil {
		return err
	}
	// Only qualify matching bare tickers. Never rename a security or rewrite its
	// signal/execution/statement history, ETF profile, class or allocation.
	if _, err := tx.ExecContext(ctx, `UPDATE stock_analysis SET ticker = ?, security_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE UPPER(TRIM(ticker)) = ? AND (security_id = ? OR name = ?)`, match.Prefix+current.Ticker, securityID, current.Ticker, securityID, current.Name); err != nil {
		return fmt.Errorf("Could not update linked research; no changes saved: %w", err)
	}
	return tx.Commit()
}
