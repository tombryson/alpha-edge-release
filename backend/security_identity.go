package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// securityIdentityCandidate carries the stable identifiers available from a
// broker import, mapping, or analysis row. Names are aliases, never the first
// identity key when an ISIN or full exchange+ticker is available.
type securityIdentityCandidate struct {
	ISIN           string
	Ticker         string
	ExchangePrefix string
	Name           string
}

var errSecurityIdentityConflict = errors.New("security identity conflict")

func checkSecurityIdentityISIN(candidateISIN, storedISIN string, id int64) error {
	candidateISIN = strings.ToUpper(strings.TrimSpace(candidateISIN))
	storedISIN = strings.ToUpper(strings.TrimSpace(storedISIN))
	if candidateISIN != "" && storedISIN != "" && candidateISIN != storedISIN {
		return fmt.Errorf("%w: incoming ISIN %s differs from security %d ISIN %s; review the security mapping", errSecurityIdentityConflict, candidateISIN, id, storedISIN)
	}
	return nil
}

func normalizedSecurityName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(name)), " "))
}

func splitSecurityTicker(exchangePrefix, ticker string) (string, string) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	prefix := normaliseExchangePrefix(exchangePrefix)
	if index := strings.Index(ticker, ":"); index >= 0 {
		if prefix == "" {
			prefix = normaliseExchangePrefix(ticker[:index])
		}
		ticker = strings.TrimSpace(ticker[index+1:])
	}
	return prefix, ticker
}

func securityIdentityTickerKey(exchangePrefix, ticker string) (string, string, bool) {
	prefix, symbol := splitSecurityTicker(exchangePrefix, ticker)
	return prefix, symbol, prefix != "" && symbol != ""
}

func ensureSecurityIdentitySchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS security_identities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			isin TEXT,
			exchange_prefix TEXT NOT NULL DEFAULT '',
			ticker TEXT NOT NULL DEFAULT '',
			canonical_name TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS security_name_aliases (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			security_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'backfill',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(security_id, normalized_name),
			FOREIGN KEY (security_id) REFERENCES security_identities(id) ON DELETE CASCADE
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_security_identities_isin
			ON security_identities(UPPER(TRIM(isin)))
			WHERE TRIM(COALESCE(isin, '')) != ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_security_identities_exchange_ticker
			ON security_identities(exchange_prefix, ticker)
			WHERE ticker != ''`,
		`CREATE INDEX IF NOT EXISTS idx_security_name_aliases_name
			ON security_name_aliases(normalized_name)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}

	for _, table := range []string{
		"holdings",
		"statement_holdings",
		"stock_analysis",
		"company_mappings",
		"stock_group_assignments",
	} {
		db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN security_id INTEGER", table))
	}
	for _, index := range []string{
		`CREATE INDEX IF NOT EXISTS idx_holdings_security_identity ON holdings(security_id)`,
		`CREATE INDEX IF NOT EXISTS idx_statement_holdings_security_identity ON statement_holdings(security_id)`,
		`CREATE INDEX IF NOT EXISTS idx_stock_analysis_security_identity ON stock_analysis(security_id)`,
		`CREATE INDEX IF NOT EXISTS idx_company_mappings_security_identity ON company_mappings(security_id)`,
		`CREATE INDEX IF NOT EXISTS idx_stock_group_assignments_security_identity ON stock_group_assignments(security_id)`,
	} {
		if _, err := db.Exec(index); err != nil {
			return err
		}
	}

	return backfillSecurityIdentityLinks()
}

func findSecurityIdentityTx(tx *sql.Tx, candidate securityIdentityCandidate) (int64, bool, error) {
	isin := strings.ToUpper(strings.TrimSpace(candidate.ISIN))
	if isin != "" {
		var id int64
		err := tx.QueryRow(`
			SELECT id FROM security_identities
			WHERE UPPER(TRIM(COALESCE(isin, ''))) = ?
			LIMIT 1
		`, isin).Scan(&id)
		if err == nil {
			return id, true, nil
		}
		if err != sql.ErrNoRows {
			return 0, false, err
		}
	}

	if prefix, ticker, ok := securityIdentityTickerKey(candidate.ExchangePrefix, candidate.Ticker); ok {
		var id int64
		var storedISIN string
		err := tx.QueryRow(`
			SELECT id, COALESCE(isin, '') FROM security_identities
			WHERE exchange_prefix = ? AND ticker = ?
			LIMIT 1
		`, prefix, ticker).Scan(&id, &storedISIN)
		if err == nil {
			if err := checkSecurityIdentityISIN(isin, storedISIN, id); err != nil {
				return 0, false, err
			}
			return id, true, nil
		}
		if err != sql.ErrNoRows {
			return 0, false, err
		}
	}

	nameKey := normalizedSecurityName(candidate.Name)
	if nameKey == "" {
		return 0, false, nil
	}
	rows, err := tx.Query(`
		SELECT DISTINCT aliases.security_id, COALESCE(identities.isin, '')
		FROM security_name_aliases aliases
		JOIN security_identities identities ON identities.id = aliases.security_id
		WHERE aliases.normalized_name = ?
		LIMIT 2
	`, nameKey)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()

	type identityMatch struct {
		id   int64
		isin string
	}
	var matches []identityMatch
	for rows.Next() {
		var match identityMatch
		if err := rows.Scan(&match.id, &match.isin); err != nil {
			return 0, false, err
		}
		matches = append(matches, match)
	}
	if err := rows.Err(); err != nil {
		return 0, false, err
	}
	if len(matches) == 1 {
		if err := checkSecurityIdentityISIN(isin, matches[0].isin, matches[0].id); err != nil {
			return 0, false, err
		}
		return matches[0].id, true, nil
	}
	return 0, false, nil
}

func addSecurityNameAliasTx(tx *sql.Tx, securityID int64, name, source string) error {
	name = strings.TrimSpace(name)
	nameKey := normalizedSecurityName(name)
	if securityID == 0 || nameKey == "" {
		return nil
	}
	_, err := tx.Exec(`
		INSERT INTO security_name_aliases (security_id, name, normalized_name, source)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(security_id, normalized_name) DO NOTHING
	`, securityID, name, nameKey, source)
	return err
}

func ensureSecurityIdentityTx(
	tx *sql.Tx,
	candidate securityIdentityCandidate,
	source string,
	updateCanonicalName bool,
) (int64, error) {
	candidate.ISIN = strings.ToUpper(strings.TrimSpace(candidate.ISIN))
	candidate.Name = strings.TrimSpace(candidate.Name)
	candidate.ExchangePrefix, candidate.Ticker = splitSecurityTicker(candidate.ExchangePrefix, candidate.Ticker)

	id, found, err := findSecurityIdentityTx(tx, candidate)
	if err != nil {
		return 0, err
	}
	if !found {
		if candidate.Name == "" {
			return 0, fmt.Errorf("security identity requires a name or stable identifier")
		}
		result, err := tx.Exec(`
			INSERT INTO security_identities (isin, exchange_prefix, ticker, canonical_name)
			VALUES (NULLIF(?, ''), ?, ?, ?)
		`, candidate.ISIN, candidate.ExchangePrefix, candidate.Ticker, candidate.Name)
		if err != nil {
			return 0, err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return 0, err
		}
	} else {
		_, err = tx.Exec(`
			UPDATE security_identities
			SET isin = CASE WHEN TRIM(COALESCE(isin, '')) = '' THEN NULLIF(?, '') ELSE isin END,
				exchange_prefix = CASE WHEN exchange_prefix = '' THEN ? ELSE exchange_prefix END,
				ticker = CASE WHEN ticker = '' THEN ? ELSE ticker END,
				canonical_name = CASE WHEN ? = 1 AND ? != '' THEN ? ELSE canonical_name END,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, candidate.ISIN, candidate.ExchangePrefix, candidate.Ticker, boolToInt(updateCanonicalName), candidate.Name, candidate.Name, id)
		if err != nil {
			return 0, err
		}
	}

	if err := addSecurityNameAliasTx(tx, id, candidate.Name, source); err != nil {
		return 0, err
	}
	return id, nil
}

func backfillSecurityIdentityLinks() error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	type identityRow struct {
		id        int64
		candidate securityIdentityCandidate
	}
	var holdings []identityRow
	rows, err := tx.Query(`
		SELECT id, COALESCE(isin, ''), COALESCE(ticker, ''), COALESCE(exchange_prefix, ''), company_name
		FROM holdings
		WHERE security_id IS NULL
	`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var row identityRow
		if err := rows.Scan(&row.id, &row.candidate.ISIN, &row.candidate.Ticker, &row.candidate.ExchangePrefix, &row.candidate.Name); err != nil {
			rows.Close()
			return err
		}
		holdings = append(holdings, row)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, row := range holdings {
		securityID, err := ensureSecurityIdentityTx(tx, row.candidate, "holding_backfill", false)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE holdings SET security_id = ? WHERE id = ?`, securityID, row.id); err != nil {
			return err
		}
	}

	var analyses []identityRow
	rows, err = tx.Query(`
		SELECT id, COALESCE(ticker, ''), name
		FROM stock_analysis
		WHERE security_id IS NULL
	`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var row identityRow
		if err := rows.Scan(&row.id, &row.candidate.Ticker, &row.candidate.Name); err != nil {
			rows.Close()
			return err
		}
		analyses = append(analyses, row)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, row := range analyses {
		securityID, err := ensureSecurityIdentityTx(tx, row.candidate, "analysis_backfill", false)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE stock_analysis SET security_id = ? WHERE id = ?`, securityID, row.id); err != nil {
			return err
		}
	}

	var mappings []identityRow
	rows, err = tx.Query(`
		SELECT id, ticker, exchange_prefix, company_name
		FROM company_mappings
		WHERE security_id IS NULL
	`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var row identityRow
		if err := rows.Scan(&row.id, &row.candidate.Ticker, &row.candidate.ExchangePrefix, &row.candidate.Name); err != nil {
			rows.Close()
			return err
		}
		mappings = append(mappings, row)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, row := range mappings {
		securityID, err := ensureSecurityIdentityTx(tx, row.candidate, "mapping_backfill", false)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE company_mappings SET security_id = ? WHERE id = ?`, securityID, row.id); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`
		UPDATE stock_group_assignments
		SET security_id = (
			SELECT security_id
			FROM security_name_aliases aliases
			WHERE aliases.normalized_name = LOWER(TRIM(stock_group_assignments.company_name))
			GROUP BY security_id
			LIMIT 1
		)
		WHERE security_id IS NULL
		  AND 1 = (
			SELECT COUNT(DISTINCT security_id)
			FROM security_name_aliases aliases
			WHERE aliases.normalized_name = LOWER(TRIM(stock_group_assignments.company_name))
		)
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		UPDATE statement_holdings
		SET security_id = (
			SELECT security_id
			FROM security_name_aliases aliases
			WHERE aliases.normalized_name = LOWER(TRIM(statement_holdings.details))
			GROUP BY security_id
			LIMIT 1
		)
		WHERE security_id IS NULL
		  AND 1 = (
			SELECT COUNT(DISTINCT security_id)
			FROM security_name_aliases aliases
			WHERE aliases.normalized_name = LOWER(TRIM(statement_holdings.details))
		)
	`); err != nil {
		return err
	}

	return tx.Commit()
}

func syncSecurityIdentityReferencesTx(
	tx *sql.Tx,
	securityID int64,
	oldName string,
	candidate securityIdentityCandidate,
) error {
	if securityID == 0 {
		return nil
	}
	oldName = strings.TrimSpace(oldName)
	candidate.Name = strings.TrimSpace(candidate.Name)
	storedTicker := fullTickerForStorage(candidate.ExchangePrefix, candidate.Ticker)

	if _, err := tx.Exec(`
		UPDATE stock_analysis
		SET security_id = ?,
			name = CASE
				WHEN ? != '' AND LOWER(TRIM(name)) = LOWER(TRIM(?)) THEN ?
				ELSE name
			END,
			updated_at = CURRENT_TIMESTAMP
		WHERE security_id = ?
		   OR (
			security_id IS NULL
			AND ? != ''
			AND UPPER(TRIM(COALESCE(ticker, ''))) = UPPER(TRIM(?))
		)
	`, securityID, oldName, oldName, candidate.Name, securityID, storedTicker, storedTicker); err != nil {
		return err
	}

	if oldName != "" {
		if _, err := tx.Exec(`
			UPDATE company_mappings
			SET security_id = ?
			WHERE security_id = ? OR LOWER(TRIM(company_name)) = LOWER(TRIM(?))
		`, securityID, securityID, oldName); err != nil {
			return err
		}
	}
	if storedTicker != "" && candidate.Name != "" {
		var templateID sql.NullString
		_ = tx.QueryRow(`
			SELECT template_id
			FROM company_mappings
			WHERE security_id = ?
			ORDER BY CASE WHEN template_id IS NULL OR template_id = '' THEN 1 ELSE 0 END, id ASC
			LIMIT 1
		`, securityID).Scan(&templateID)
		if _, err := tx.Exec(`
			INSERT INTO company_mappings (company_name, ticker, exchange_prefix, template_id, security_id, enriched_at)
			VALUES (?, ?, ?, NULLIF(?, ''), ?, CURRENT_TIMESTAMP)
			ON CONFLICT(company_name) DO UPDATE SET
				ticker = excluded.ticker,
				exchange_prefix = excluded.exchange_prefix,
				template_id = COALESCE(NULLIF(company_mappings.template_id, ''), excluded.template_id),
				security_id = excluded.security_id,
				enriched_at = CURRENT_TIMESTAMP
		`, candidate.Name, splitTickerSymbol(storedTicker), splitTickerPrefix(storedTicker), templateID.String, securityID); err != nil {
			return err
		}
	}

	var groupID string
	groupErr := tx.QueryRow(`
		SELECT group_id
		FROM stock_group_assignments
		WHERE security_id = ? OR LOWER(TRIM(company_name)) = LOWER(TRIM(?))
		ORDER BY CASE WHEN security_id = ? THEN 0 ELSE 1 END
		LIMIT 1
	`, securityID, oldName, securityID).Scan(&groupID)
	if groupErr != nil && groupErr != sql.ErrNoRows {
		return groupErr
	}
	if groupErr == nil && candidate.Name != "" {
		if _, err := tx.Exec(`
			INSERT INTO stock_group_assignments (company_name, group_id, security_id, assigned_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(company_name) DO UPDATE SET
				group_id = excluded.group_id,
				security_id = excluded.security_id,
				assigned_at = CURRENT_TIMESTAMP
		`, candidate.Name, groupID, securityID); err != nil {
			return err
		}
		if oldName != "" && !strings.EqualFold(oldName, candidate.Name) {
			if _, err := tx.Exec(`DELETE FROM stock_group_assignments WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?))`, oldName); err != nil {
				return err
			}
		}
	}

	return addSecurityNameAliasTx(tx, securityID, candidate.Name, "broker_import")
}

func splitTickerPrefix(fullTicker string) string {
	prefix, _ := splitSecurityTicker("", fullTicker)
	return prefix
}

func splitTickerSymbol(fullTicker string) string {
	_, symbol := splitSecurityTicker("", fullTicker)
	return symbol
}
