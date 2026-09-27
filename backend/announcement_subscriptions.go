package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

type announcementSubscription struct {
	exchangeTarget
	SecurityID     int64  `json:"security_id"`
	Name           string `json:"name"`
	Ticker         string `json:"ticker"`
	ExchangePrefix string `json:"exchange_prefix"`
	Provider       string `json:"provider"`
	Configured     bool   `json:"configured"`
	ConfirmedAt    string `json:"confirmed_at,omitempty"`
	NeedsRecheck   bool   `json:"needs_recheck"`
}

// Read the same holdings/mapping identity used in the terminal, not a stale
// subscription ticker. Watchlist and held copies collapse to one security.
func readAnnouncementSubscriptions(ctx context.Context, q exchangeQueryer) ([]announcementSubscription, error) {
	rows, err := q.QueryContext(ctx, `WITH candidates AS (
		SELECT 'holding' AS kind, h.id, h.company_name AS name,
			COALESCE(m.ticker,h.ticker,'') AS ticker, COALESCE(m.exchange_prefix,h.exchange_prefix,'') AS prefix,
			COALESCE(h.security_id,m.security_id,0) AS security_id
		FROM holdings h LEFT JOIN company_mappings m ON m.company_name=h.company_name
		WHERE h.is_active=1 AND (h.quantity!=0 OR h.value_aud!=0)
		AND NOT EXISTS (SELECT 1 FROM stock_analysis a WHERE
			(a.security_id=h.security_id OR a.name=h.company_name)
			AND UPPER(REPLACE(REPLACE(COALESCE(a.security_type,''),' ','_'),'-','_')) IN ('CVR','NON_ALLOCATING'))
		UNION ALL
		SELECT 'analysis', id, name, COALESCE(ticker,''), '', COALESCE(security_id,0)
		FROM stock_analysis
		WHERE UPPER(REPLACE(REPLACE(COALESCE(security_type,''),' ','_'),'-','_')) NOT IN ('CVR','NON_ALLOCATING')
	)
	SELECT c.kind,c.id,c.name,c.ticker,c.prefix,COALESCE(NULLIF(c.security_id,0),i.id,0),
		COALESCE(s.provider,''),COALESCE(s.exchange_prefix,''),COALESCE(s.ticker,''),COALESCE(s.confirmed_at,'')
	FROM candidates c
	LEFT JOIN security_identities i ON c.security_id=0 AND i.exchange_prefix!=''
		AND c.prefix||c.ticker=i.exchange_prefix||i.ticker
	LEFT JOIN security_announcement_subscriptions s ON s.security_id=COALESCE(NULLIF(c.security_id,0),i.id)
	ORDER BY CASE c.kind WHEN 'holding' THEN 0 ELSE 1 END,c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []announcementSubscription{}
	seen := map[string]bool{}
	for rows.Next() {
		var item announcementSubscription
		var savedPrefix, savedTicker, confirmed string
		if err := rows.Scan(&item.Kind, &item.ID, &item.Name, &item.Ticker, &item.ExchangePrefix, &item.SecurityID,
			&item.Provider, &savedPrefix, &savedTicker, &confirmed); err != nil {
			return nil, err
		}
		item.ExchangePrefix, item.Ticker = splitSecurityTicker(item.ExchangePrefix, item.Ticker)
		key := fmt.Sprintf("identity:%d", item.SecurityID)
		if item.SecurityID == 0 {
			key = "listing:" + item.ExchangePrefix + item.Ticker
			if item.Ticker == "" || item.ExchangePrefix == "" {
				key = fmt.Sprintf("%s:%d", item.Kind, item.ID)
			}
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		item.NeedsRecheck = confirmed != "" && (savedPrefix != item.ExchangePrefix || savedTicker != item.Ticker)
		item.Configured = confirmed != "" && !item.NeedsRecheck
		if item.Configured {
			item.ConfirmedAt = confirmed
		}
		result = append(result, item)
	}
	sort.SliceStable(result, func(i, j int) bool { return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name) })
	return result, rows.Err()
}

func getAnnouncementSubscriptions(w http.ResponseWriter, r *http.Request) {
	items, err := readAnnouncementSubscriptions(r.Context(), db)
	if err != nil {
		http.Error(w, "Announcement setup could not be loaded", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"items": items})
}

func updateAnnouncementSubscriptions(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Items []struct {
			exchangeTarget
			Ticker         *string `json:"ticker"`
			ExchangePrefix *string `json:"exchange_prefix"`
			Provider       string  `json:"provider"`
			Configured     *bool   `json:"configured"`
		} `json:"items"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || len(request.Items) == 0 || len(request.Items) > 100 {
		http.Error(w, "Provide between 1 and 100 securities", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "Provide one JSON request", http.StatusBadRequest)
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "Announcement setup could not be saved", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	eligible, err := readAnnouncementSubscriptions(r.Context(), tx)
	if err != nil {
		http.Error(w, "Announcement setup could not be loaded", http.StatusInternalServerError)
		return
	}
	byTarget := map[exchangeTarget]announcementSubscription{}
	for _, item := range eligible {
		byTarget[item.exchangeTarget] = item
	}
	seen := map[exchangeTarget]bool{}
	seenIdentity := map[int64]bool{}
	for _, item := range request.Items {
		if item.ID < 1 || (item.Kind != "holding" && item.Kind != "analysis") || seen[item.exchangeTarget] ||
			item.Configured == nil || item.Ticker == nil || item.ExchangePrefix == nil || (item.Provider != "HOTCOPPER" && item.Provider != "SEEKING_ALPHA") {
			http.Error(w, "Invalid or duplicate announcement setup", http.StatusBadRequest)
			return
		}
		seen[item.exchangeTarget] = true
		current, exists := byTarget[item.exchangeTarget]
		if !exists || current.Ticker != *item.Ticker || current.ExchangePrefix != *item.ExchangePrefix {
			http.Error(w, "Security changed. Reload announcement setup before confirming.", http.StatusConflict)
			return
		}
		if *item.Configured && (current.Ticker == "" || current.ExchangePrefix == "") {
			http.Error(w, "Set the ticker and exchange before confirming announcement alerts", http.StatusBadRequest)
			return
		}
		securityID := current.SecurityID
		if securityID == 0 {
			securityID, err = ensureSecurityIdentityTx(tx, securityIdentityCandidate{
				Name: current.Name, Ticker: current.Ticker, ExchangePrefix: current.ExchangePrefix,
			}, "announcement_setup", false)
			if err == nil {
				table := "stock_analysis"
				if current.Kind == "holding" {
					table = "holdings"
				}
				_, err = tx.ExecContext(r.Context(), "UPDATE "+table+" SET security_id=? WHERE id=?", securityID, current.ID)
			}
			if err != nil {
				http.Error(w, "Security identity could not be saved", http.StatusInternalServerError)
				return
			}
		}
		if seenIdentity[securityID] {
			http.Error(w, "Duplicate security identity", http.StatusBadRequest)
			return
		}
		seenIdentity[securityID] = true
		var confirmed any
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if *item.Configured {
			confirmed = now
			if current.Configured && current.Provider == item.Provider {
				confirmed = current.ConfirmedAt
			}
		}
		_, err = tx.ExecContext(r.Context(), `INSERT INTO security_announcement_subscriptions
			(security_id,provider,exchange_prefix,ticker,confirmed_at,updated_at) VALUES (?,?,?,?,?,?)
			ON CONFLICT(security_id) DO UPDATE SET provider=excluded.provider,exchange_prefix=excluded.exchange_prefix,
			ticker=excluded.ticker,confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at`,
			securityID, item.Provider, current.ExchangePrefix, current.Ticker, confirmed, now)
		if err != nil {
			http.Error(w, "Announcement setup could not be saved", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "Announcement setup could not be saved", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"updated": len(request.Items)})
}
