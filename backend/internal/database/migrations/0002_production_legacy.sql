-- Additive bridge for the fingerprinted production v187 schema only.
CREATE TABLE asset_class_etf_policies (
			asset_class TEXT PRIMARY KEY,
			core_security_id INTEGER,
			core_ticker TEXT NOT NULL DEFAULT '',
			core_ratio_pct REAL NOT NULL DEFAULT 25,
			momentum_influence_pct REAL NOT NULL DEFAULT 50,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(core_security_id) REFERENCES security_identities(id) ON DELETE SET NULL
		);

CREATE TABLE data_refresh_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			dataset TEXT NOT NULL,
			trigger_source TEXT NOT NULL DEFAULT 'SCHEDULED',
			status TEXT NOT NULL,
			started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			finished_at DATETIME,
			data_fresh_through DATE,
			expected_count INTEGER NOT NULL DEFAULT 0,
			updated_count INTEGER NOT NULL DEFAULT 0,
			error_count INTEGER NOT NULL DEFAULT 0,
			message TEXT NOT NULL DEFAULT ''
		);

CREATE TABLE etf_management_changes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ticker TEXT NOT NULL,
			previous_mode TEXT NOT NULL,
			mode TEXT NOT NULL,
			initial_state TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE etf_management_profiles (
			ticker TEXT PRIMARY KEY,
			mode TEXT NOT NULL CHECK(mode IN ('etf_tms', 'tms')),
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE etf_momentum_run_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL,
			universe_member_id INTEGER NOT NULL,
			security_id INTEGER NOT NULL,
			display_ticker TEXT NOT NULL,
			display_name TEXT NOT NULL,
			tradingview_symbol TEXT NOT NULL,
			provider_symbol TEXT NOT NULL,
			price_date DATE,
			close_price REAL,
			data_points INTEGER NOT NULL DEFAULT 0,
			return_80_pct REAL,
			momentum_240_pct REAL,
			volatility_240 REAL,
			sharpe_proxy REAL,
			score REAL,
			rank_value INTEGER,
			decay REAL,
			raw_weight_pct REAL,
			capped_weight_pct REAL,
			final_weight_pct REAL,
			status TEXT NOT NULL,
			diagnostic TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(run_id, universe_member_id),
			FOREIGN KEY(run_id) REFERENCES etf_momentum_runs(id) ON DELETE CASCADE,
			FOREIGN KEY(universe_member_id) REFERENCES etf_momentum_universe_members(id),
			FOREIGN KEY(security_id) REFERENCES security_identities(id)
		);

CREATE TABLE etf_momentum_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			universe_code TEXT NOT NULL,
			algorithm_version TEXT NOT NULL,
			as_of_date DATE NOT NULL,
			price_basis TEXT NOT NULL,
			provider TEXT NOT NULL,
			parameters_json TEXT NOT NULL,
			expected_members INTEGER NOT NULL,
			ready_members INTEGER NOT NULL,
			status TEXT NOT NULL,
			data_fresh_through DATE,
			comparison_status TEXT NOT NULL DEFAULT 'WAITING_FOR_TRADINGVIEW',
			published_at DATETIME,
			publication_reason TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE etf_momentum_tradingview_snapshot_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			snapshot_id INTEGER NOT NULL,
			ticker TEXT NOT NULL,
			return_80_pct REAL NOT NULL,
			momentum_240_pct REAL NOT NULL,
			decay_pct REAL NOT NULL,
			sharpe_proxy REAL NOT NULL,
			score REAL NOT NULL,
			rank_value INTEGER NOT NULL,
			allocation_pct REAL NOT NULL,
			FOREIGN KEY(snapshot_id) REFERENCES etf_momentum_tradingview_snapshots(id) ON DELETE CASCADE,
			UNIQUE(snapshot_id, ticker)
		);

CREATE TABLE etf_momentum_tradingview_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			universe_code TEXT NOT NULL,
			as_of_date DATE NOT NULL,
			source TEXT NOT NULL DEFAULT 'TRADINGVIEW_TABLE',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE etf_momentum_universe_members (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			universe_code TEXT NOT NULL,
			security_id INTEGER NOT NULL,
			display_ticker TEXT NOT NULL,
			display_name TEXT NOT NULL,
			exchange_prefix TEXT NOT NULL DEFAULT '',
			tradingview_symbol TEXT NOT NULL,
			provider_symbol TEXT NOT NULL,
			currency TEXT DEFAULT '',
			rank_eligible BOOLEAN NOT NULL DEFAULT 1,
			tactical_eligible BOOLEAN NOT NULL DEFAULT 1,
			active BOOLEAN NOT NULL DEFAULT 1,
			display_order INTEGER NOT NULL DEFAULT 999,
			effective_from DATE NOT NULL DEFAULT '2000-01-01',
			inactive_at DATE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(universe_code, security_id),
			UNIQUE(universe_code, display_ticker),
			FOREIGN KEY(security_id) REFERENCES security_identities(id)
		);

CREATE TABLE etf_shortlist (
			ticker TEXT PRIMARY KEY,
			display_name TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			asset_class_hint TEXT NOT NULL DEFAULT '',
			added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE regime_return_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			data_json TEXT NOT NULL,
			data_fresh_through DATE,
			expected_tickers INTEGER NOT NULL DEFAULT 0,
			updated_tickers INTEGER NOT NULL DEFAULT 0,
			error_count INTEGER NOT NULL DEFAULT 0,
			errors_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE security_listing_checks (
			security_id INTEGER NOT NULL,
			provider TEXT NOT NULL,
			requested_exchange_prefix TEXT NOT NULL DEFAULT '',
			requested_ticker TEXT NOT NULL DEFAULT '',
			observed_exchange_prefix TEXT NOT NULL DEFAULT '',
			observed_ticker TEXT NOT NULL DEFAULT '',
			observed_name TEXT NOT NULL DEFAULT '',
			quote_type TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'UNAVAILABLE', 'SOURCE_ERROR')),
			last_error TEXT NOT NULL DEFAULT '',
			consecutive_failures INTEGER NOT NULL DEFAULT 0,
			last_checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_success_at DATETIME,
			PRIMARY KEY (security_id, provider),
			FOREIGN KEY (security_id) REFERENCES security_identities(id) ON DELETE CASCADE
		);

CREATE TABLE security_listing_reviews (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			security_id INTEGER NOT NULL,
			review_type TEXT NOT NULL CHECK(review_type IN ('NAME_CHANGE_CANDIDATE', 'LISTING_UNAVAILABLE')),
			provider TEXT NOT NULL,
			current_name TEXT NOT NULL DEFAULT '',
			observed_name TEXT NOT NULL DEFAULT '',
			current_ticker TEXT NOT NULL DEFAULT '',
			observed_ticker TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'DISMISSED', 'RESOLVED', 'SUPERSEDED')),
			dedupe_key TEXT NOT NULL UNIQUE,
			first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			seen_count INTEGER NOT NULL DEFAULT 1,
			resolved_at DATETIME,
			resolution_note TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (security_id) REFERENCES security_identities(id) ON DELETE CASCADE
		);

CREATE TABLE webhook_inbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		webhook_name TEXT NOT NULL,
		request_path TEXT NOT NULL,
		payload TEXT NOT NULL,
		payload_hash TEXT NOT NULL,
		event_key TEXT,
		stream_key TEXT NOT NULL,
		event_time INTEGER,
		status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','PROCESSED','FAILED','DISMISSED')),
		received_at INTEGER NOT NULL,
		completed_at INTEGER,
		dead_letter_id INTEGER UNIQUE,
		UNIQUE(webhook_name,event_key)
	);

ALTER TABLE security_actions ADD COLUMN execution_units REAL;

ALTER TABLE security_actions ADD COLUMN execution_cash_value REAL;

ALTER TABLE security_actions ADD COLUMN execution_exception_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE security_actions ADD COLUMN execution_policy_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE security_actions ADD COLUMN execution_snapshot_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE security_actions ADD COLUMN reconciliation_method TEXT NOT NULL DEFAULT '';

ALTER TABLE stock_analysis ADD COLUMN asset_class_source TEXT;

ALTER TABLE stock_analysis ADD COLUMN asset_class_set_at DATETIME;

CREATE INDEX idx_asset_class_etf_policies_security
			ON asset_class_etf_policies(core_security_id);

CREATE UNIQUE INDEX idx_data_refresh_runs_active
			ON data_refresh_runs(dataset) WHERE status = 'RUNNING';

CREATE INDEX idx_data_refresh_runs_dataset
			ON data_refresh_runs(dataset, started_at DESC, id DESC);

CREATE INDEX idx_etf_momentum_run_rows_run_rank
			ON etf_momentum_run_rows(run_id, rank_value, display_ticker);

CREATE INDEX idx_etf_momentum_runs_lookup
			ON etf_momentum_runs(universe_code, algorithm_version, as_of_date, id DESC);

CREATE INDEX idx_etf_momentum_tradingview_snapshots_latest
			ON etf_momentum_tradingview_snapshots(universe_code, as_of_date DESC, id DESC);

CREATE INDEX idx_etf_momentum_universe_active
			ON etf_momentum_universe_members(universe_code, active, display_order);

CREATE INDEX idx_regime_return_snapshots_created
			ON regime_return_snapshots(created_at DESC, id DESC);

CREATE INDEX idx_security_listing_reviews_open
			ON security_listing_reviews(status, last_seen_at DESC);

CREATE INDEX idx_stock_analysis_asset_class_source
			ON stock_analysis(asset_class_source)
	;

CREATE INDEX webhook_inbox_cleanup ON webhook_inbox(status,completed_at);

CREATE INDEX webhook_inbox_hash ON webhook_inbox(webhook_name,payload_hash,received_at);

CREATE INDEX webhook_inbox_pending ON webhook_inbox(status,id);

CREATE INDEX webhook_inbox_stream ON webhook_inbox(stream_key,event_time,status);
