CREATE TABLE statement_revisions (
    id INTEGER PRIMARY KEY,
    statement_id INTEGER NOT NULL REFERENCES account_statements(id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    source TEXT NOT NULL CHECK (source IN ('legacy_snapshot', 'import')),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    payload_sha256 TEXT,
    accepted_payload_json TEXT CHECK (accepted_payload_json IS NULL OR json_valid(accepted_payload_json)),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    UNIQUE(statement_id, revision)
);

-- This view captures persisted evidence, including resolved security identity.
CREATE VIEW statement_evidence_snapshot AS
SELECT a.id AS statement_id, json_object(
    'account', json_object('id', a.id, 'account_name', a.account_name,
        'statement_date', a.statement_date, 'total_value_aud', a.total_value_aud,
        'cash_aud', a.cash_aud, 'usd_value', a.usd_value, 'usd_aud', a.usd_aud,
        'gbp_value', a.gbp_value, 'gbp_aud', a.gbp_aud, 'aud_value', a.aud_value),
    'holdings', json((SELECT json_group_array(json_object(
        'security_id', h.security_id, 'details', h.details, 'quantity', h.quantity,
        'ticker', s.ticker, 'exchange_prefix', s.exchange_prefix, 'isin', s.isin,
        'canonical_name', s.canonical_name,
        'cost_aud', h.cost_aud, 'current_price', h.current_price, 'value_aud', h.value_aud,
        'gain_loss_aud', h.gain_loss_aud, 'gain_loss_pct', h.gain_loss_pct,
        'currency', h.currency, 'market_value', h.market_value, 'cash_reserve', h.cash_reserve
    )) FROM statement_holdings h LEFT JOIN security_identities s ON s.id = h.security_id
        WHERE h.statement_id = a.id))
) AS snapshot_json FROM account_statements a;

-- Earlier corrections cannot be reconstructed. Preserve only the state we have,
-- labelled as a migration snapshot, never as an original broker submission.
INSERT INTO statement_revisions(statement_id, revision, source, snapshot_json)
SELECT statement_id, 1, 'legacy_snapshot', snapshot_json FROM statement_evidence_snapshot;

CREATE TRIGGER statement_revisions_no_update BEFORE UPDATE ON statement_revisions
BEGIN SELECT RAISE(ABORT, 'Statement evidence is append-only'); END;
CREATE TRIGGER statement_revisions_no_delete BEFORE DELETE ON statement_revisions
BEGIN SELECT RAISE(ABORT, 'Statement evidence is append-only'); END;
