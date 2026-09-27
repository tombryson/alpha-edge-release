package database

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

const productionLegacyHash = "1299dc58d2fd6ad19dbddf5732c85ce140ef460b89ab9520554891f56ef001dd"

//go:embed migrations/0002_production_legacy.sql
var productionLegacySQL string

//go:embed migrations/0002_momentum_catalogue.json
var productionMomentumCatalogue string

func productionLegacySchema(ctx context.Context, q querier) (bool, error) {
	items, err := objects(ctx, q)
	if err != nil {
		return false, err
	}
	h := sha256.New()
	for _, item := range items {
		if item.Name != ledgerTable {
			fmt.Fprintf(h, "%s\n%s\n%s\n", item.Kind, item.Name, item.SQL)
		}
	}
	return hex.EncodeToString(h.Sum(nil)) == productionLegacyHash, nil
}

func productionLegacyMigration() migration {
	return migration{2, "production_legacy_2026_09_15", productionLegacyHash + "\n" + productionLegacySQL + "\n" + productionMomentumCatalogue + "\nidentity-resolution-v1: unique compatible listing, referenced blank exchange, otherwise insert; never overwrite", func(ctx context.Context, q querier) error {
		known, err := productionLegacySchema(ctx, q)
		if err != nil {
			return err
		}
		if known {
			if _, err := q.ExecContext(ctx, productionLegacySQL); err != nil {
				return fmt.Errorf("production additive schema: %w", err)
			}
			if err := seedProductionMomentum(ctx, q); err != nil {
				return err
			}
		}
		statements, fresh, err := baselinePlan(ctx, q)
		if err != nil {
			return err
		}
		if fresh || len(statements) != 0 {
			return fmt.Errorf("production bridge did not establish the complete baseline")
		}
		return nil
	}}
}

type productionMomentumSeed struct {
	Ticker, Exchange, TradingView, Provider, Currency string
}

// Frozen migration aliases, deliberately independent of changing runtime rules.
func productionListing(ticker, exchange string) (string, string) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if before, after, ok := strings.Cut(ticker, ":"); ok {
		if strings.TrimSpace(exchange) == "" {
			exchange = before
		}
		ticker = after
	}
	exchange = strings.TrimSuffix(strings.TrimSuffix(strings.ToUpper(strings.TrimSpace(exchange)), ":"), "_DLY")
	if exchange == "NYSEARCA" || exchange == "AMEX" || exchange == "BATS" {
		exchange = "US_ETF"
	}
	return ticker, exchange
}

func productionMomentumIdentity(ctx context.Context, q querier, seed productionMomentumSeed) (int64, error) {
	rows, err := q.QueryContext(ctx, `SELECT i.id, COALESCE(i.ticker,''), COALESCE(i.exchange_prefix,''),
		EXISTS(SELECT 1 FROM stock_analysis a WHERE a.security_id=i.id)
		FROM security_identities i ORDER BY i.id`)
	if err != nil {
		return 0, err
	}
	wantedTicker, wantedExchange := productionListing(seed.Ticker, seed.Exchange)
	var ids []int64
	for rows.Next() {
		var id int64
		var ticker, exchange string
		var referenced bool
		if err := rows.Scan(&id, &ticker, &exchange, &referenced); err != nil {
			rows.Close()
			return 0, err
		}
		ticker, exchange = productionListing(ticker, exchange)
		if ticker == wantedTicker && (exchange == wantedExchange || exchange == "") {
			if exchange == "" && !referenced {
				rows.Close()
				return 0, fmt.Errorf("catalogue %s has an unverified exchange-less identity", seed.Ticker)
			}
			ids = append(ids, id)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	if len(ids) > 1 {
		return 0, fmt.Errorf("catalogue %s has ambiguous identities; resolve explicitly", seed.Ticker)
	}
	if len(ids) == 1 {
		return ids[0], nil
	}
	result, err := q.ExecContext(ctx, `INSERT INTO security_identities(ticker,exchange_prefix,canonical_name) VALUES(?,?,?)`, seed.Ticker, seed.Exchange, seed.Ticker)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func seedProductionMomentum(ctx context.Context, q querier) error {
	var seeds []productionMomentumSeed
	if err := json.Unmarshal([]byte(productionMomentumCatalogue), &seeds); err != nil {
		return err
	}
	if len(seeds) != 15 {
		return fmt.Errorf("invalid frozen momentum catalogue")
	}
	for i, seed := range seeds {
		id, err := productionMomentumIdentity(ctx, q, seed)
		if err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `INSERT INTO etf_momentum_universe_members(
			universe_code,security_id,display_ticker,display_name,exchange_prefix,tradingview_symbol,
			provider_symbol,currency,rank_eligible,tactical_eligible,active,display_order,effective_from)
			VALUES('LEGACY_15',?,?,?,?,?,?,?,1,1,1,?,'2000-01-01')`,
			id, seed.Ticker, seed.Ticker, seed.Exchange, seed.TradingView, seed.Provider, seed.Currency, i+1); err != nil {
			return err
		}
	}
	return nil
}
