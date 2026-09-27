package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"trading-backend/internal/staticdata"
)

// Frozen legacy bootstrap, retained to reproduce the migration baseline in tests.
// Production startup must use initializeDatabase, not these historical backfills.
func initLegacyDB() {
	schema := `
	-- Security Positions table (tracks BUY/SELL state for each security)
	CREATE TABLE IF NOT EXISTS security_positions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		position_state TEXT CHECK(position_state IN ('BUY','SELL')) NOT NULL,
		manual_override BOOLEAN DEFAULT 0,
		entry_date DATETIME,
		stopped_waiting_reentry BOOLEAN DEFAULT 0,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_security_positions_ticker ON security_positions(ticker);

	-- Alerts table (no foreign key to deprecated securities)
	CREATE TABLE IF NOT EXISTS alerts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL,
		alert_type TEXT NOT NULL,
		strength TEXT,
		expiry_date DATETIME,
		exchange_prefix TEXT DEFAULT 'ASX:',
		timeframe TEXT,
		source TEXT CHECK(source IN ('cdf','tms','etf_tms','ctf','q4d','q3d','unknown')),
		affected_positions TEXT,
		alert_price REAL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		is_active BOOLEAN DEFAULT 1,
		resolved_at DATETIME,
		resolved_reason TEXT,
		resolved_note TEXT,
		needs_mapping BOOLEAN DEFAULT 0
	);

	-- Decisions table
	CREATE TABLE IF NOT EXISTS decisions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		alert_id INTEGER NOT NULL,
			decision TEXT CHECK(decision IN ('BUY','SELL','SELL_50','SELL_DOWN','ADD','TRIM','EQUITY_REGIME_STRONG_TRIM','IGNORE','OVERRIDE','CASH_ALLOCATION')) NOT NULL,
		notes TEXT,
		position_pct_after REAL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (alert_id) REFERENCES alerts(id)
	);

	-- Account statements (primary table for portfolio data)
	CREATE TABLE IF NOT EXISTS account_statements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_name TEXT NOT NULL,
		statement_date DATETIME NOT NULL,
		total_value_aud REAL NOT NULL,
		cash_aud REAL NOT NULL,
		usd_value REAL DEFAULT 0,
		usd_aud REAL DEFAULT 0,
		gbp_value REAL DEFAULT 0,
		gbp_aud REAL DEFAULT 0,
		aud_value REAL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(account_name, statement_date)
	);

	CREATE TABLE IF NOT EXISTS statement_holdings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		statement_id INTEGER NOT NULL,
		details TEXT NOT NULL,
		quantity REAL NOT NULL,
		cost_aud REAL NOT NULL,
		current_price REAL NOT NULL,
		value_aud REAL NOT NULL,
		gain_loss_aud REAL NOT NULL,
		gain_loss_pct REAL NOT NULL,
		currency TEXT NOT NULL DEFAULT 'AUD',
		market_value REAL NOT NULL,
		cash_reserve REAL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (statement_id) REFERENCES account_statements(id) ON DELETE CASCADE
	);

	-- Stock analysis table (stores user insights and analysis for each security)
	CREATE TABLE IF NOT EXISTS stock_analysis (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT,
		name TEXT NOT NULL,
		grok_quality REAL DEFAULT 0,
		grok_value REAL DEFAULT 0,
		gemini_quality REAL DEFAULT 0,
		gemini_value REAL DEFAULT 0,
		gpt_quality REAL DEFAULT 0,
		gpt_value REAL DEFAULT 0,
		grok_pt REAL DEFAULT 0,
		gemini_pt REAL DEFAULT 0,
		gpt_pt REAL DEFAULT 0,
		gemini_webui_output TEXT,
		gemini_webui_input_at TEXT,
		perplexity_webui_output TEXT,
		perplexity_webui_input_at TEXT,
		gpt_webui_output TEXT,
		gpt_webui_input_at TEXT,
		claude_webui_output TEXT,
		claude_webui_input_at TEXT,
		council_source_output TEXT,
		council_source_input_at TEXT,
		tipranks_pt REAL DEFAULT 0,
		analyst_pt REAL DEFAULT 0,
		council_run_id TEXT,
		council_run_label TEXT,
		upside_24m REAL DEFAULT 0,
		allocation REAL DEFAULT 0,
		include_in_sizing BOOLEAN DEFAULT TRUE,
		primary_asset_class TEXT DEFAULT '',
		security_type TEXT DEFAULT 'STOCK',
		overlay_sell_priority INTEGER DEFAULT 3,
		market_cap TEXT,
		risk_profile TEXT,
		notes TEXT,
		is_watchlist BOOLEAN DEFAULT FALSE,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(ticker, name)
	);

	CREATE INDEX IF NOT EXISTS idx_stock_analysis_ticker ON stock_analysis(ticker);
	`

	// Execute main schema
	_, err := db.Exec(schema)
	if err != nil {
		log.Fatal("failed to create tables: ", err)
	}

	// Migration: Add GPT columns if they don't exist (for existing databases)
	migrations := []string{
		"ALTER TABLE stock_analysis ADD COLUMN gpt_quality REAL DEFAULT 0",
		"ALTER TABLE stock_analysis ADD COLUMN gpt_value REAL DEFAULT 0",
		"ALTER TABLE stock_analysis ADD COLUMN gpt_pt REAL DEFAULT 0",
		"ALTER TABLE alerts ADD COLUMN needs_mapping BOOLEAN DEFAULT 0",
		"ALTER TABLE alerts ADD COLUMN resolved_reason TEXT",
		"ALTER TABLE alerts ADD COLUMN resolved_note TEXT",
		"ALTER TABLE company_mappings ADD COLUMN template_id TEXT",
	}
	for _, migration := range migrations {
		// Ignore errors - column may already exist
		db.Exec(migration)
	}

	// Continue with remaining schema
	schema2 := `
	-- Company mappings table (cache for AI-enriched ticker/exchange data)
	CREATE TABLE IF NOT EXISTS company_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		company_name TEXT NOT NULL UNIQUE,
		ticker TEXT NOT NULL,
		exchange_prefix TEXT NOT NULL DEFAULT 'ASX:',
		template_id TEXT,
		enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_company_mappings_name ON company_mappings(company_name);

	-- Stock groups table (for organizing holdings)
	CREATE TABLE IF NOT EXISTS stock_groups (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		asset_class_code TEXT,
		collapsed BOOLEAN DEFAULT 0,
		display_order INTEGER NOT NULL,
		parent_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (parent_id) REFERENCES stock_groups(id) ON DELETE CASCADE
	);

	-- Stock group assignments table (many-to-one: holdings to groups)
	-- Uses company_name as stable identifier (holding_id changes on re-import)
	CREATE TABLE IF NOT EXISTS stock_group_assignments (
		company_name TEXT PRIMARY KEY,
		group_id TEXT NOT NULL,
		assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (group_id) REFERENCES stock_groups(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_stock_group_assignments_group ON stock_group_assignments(group_id);

	-- Holdings table (single source of truth for all portfolio positions)
	-- This is THE authoritative table - all queries read from here
	CREATE TABLE IF NOT EXISTS holdings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		isin TEXT,
		ticker TEXT,
		company_name TEXT NOT NULL,
		exchange_prefix TEXT NOT NULL DEFAULT 'ASX:',
		quantity REAL NOT NULL DEFAULT 0,
		cost_aud REAL NOT NULL DEFAULT 0,
		current_price REAL NOT NULL DEFAULT 0,
		value_aud REAL NOT NULL DEFAULT 0,
		gain_loss_aud REAL NOT NULL DEFAULT 0,
		gain_loss_pct REAL NOT NULL DEFAULT 0,
		currency TEXT NOT NULL DEFAULT 'AUD',
		market_value REAL NOT NULL DEFAULT 0,
		cash_reserve REAL DEFAULT 0,
		is_active BOOLEAN DEFAULT 1,
		last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(company_name, is_active)
	);

	CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings(ticker);
	CREATE INDEX IF NOT EXISTS idx_holdings_active ON holdings(is_active);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_isin_active ON holdings(isin) WHERE isin IS NOT NULL AND is_active = 1;

	-- Sync history table (tracks each sync operation)
	CREATE TABLE IF NOT EXISTS sync_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sync_type TEXT NOT NULL DEFAULT 'sheet_import',
		sync_status TEXT CHECK(sync_status IN ('success','failed','partial')) NOT NULL,
		total_changes INTEGER DEFAULT 0,
		added_count INTEGER DEFAULT 0,
		updated_count INTEGER DEFAULT 0,
		removed_count INTEGER DEFAULT 0,
		error_message TEXT,
		synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Sync changes table (detailed change log for each sync)
	CREATE TABLE IF NOT EXISTS sync_changes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sync_id INTEGER NOT NULL,
		change_type TEXT CHECK(change_type IN ('ADDED','UPDATED','REMOVED')) NOT NULL,
		ticker TEXT NOT NULL,
		company_name TEXT NOT NULL,
		old_quantity REAL,
		new_quantity REAL,
		old_value REAL,
		new_value REAL,
		acknowledged BOOLEAN DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (sync_id) REFERENCES sync_history(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_sync_changes_sync_id ON sync_changes(sync_id);
	CREATE INDEX IF NOT EXISTS idx_sync_changes_acknowledged ON sync_changes(acknowledged);

	-- ETF Positions table (BUY/SELL state for each ETF)
	CREATE TABLE IF NOT EXISTS etf_positions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		position_state TEXT CHECK(position_state IN ('BUY','SELL')) NOT NULL DEFAULT 'SELL',
		allocation_pct REAL DEFAULT 0,
		cash_allocated REAL DEFAULT 0,
		manual_override BOOLEAN DEFAULT 0,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_etf_positions_ticker ON etf_positions(ticker);

	-- ETF Rebalance Targets table (stores 60-bar allocation targets)
	CREATE TABLE IF NOT EXISTS etf_rebalance_targets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sequence_number INTEGER NOT NULL,
		rebalance_date DATETIME NOT NULL,
		ticker TEXT NOT NULL,
		rank INTEGER,
		return_60bar REAL,
		current_allocation REAL DEFAULT 0,
		target_allocation REAL NOT NULL,
		pending_delta REAL,
		status TEXT CHECK(status IN ('PENDING','PARTIAL','COMPLETE','SUPERSEDED','CANCELLED')) DEFAULT 'PENDING',
		weighted_portfolio_return REAL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME
	);

	CREATE INDEX IF NOT EXISTS idx_etf_rebalance_sequence ON etf_rebalance_targets(sequence_number);
	CREATE INDEX IF NOT EXISTS idx_etf_rebalance_ticker ON etf_rebalance_targets(ticker);
	CREATE INDEX IF NOT EXISTS idx_etf_rebalance_status ON etf_rebalance_targets(status);

	-- ETF Executions table (logs each allocation change)
	CREATE TABLE IF NOT EXISTS etf_executions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rebalance_id INTEGER,
		ticker TEXT NOT NULL,
		signal TEXT CHECK(signal IN ('BUY','SELL','TRIM','ADD')) NOT NULL,
		allocation_before REAL,
		allocation_after REAL,
		cash_before REAL,
		cash_after REAL,
		executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (rebalance_id) REFERENCES etf_rebalance_targets(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_etf_executions_rebalance ON etf_executions(rebalance_id);
	CREATE INDEX IF NOT EXISTS idx_etf_executions_ticker ON etf_executions(ticker);

	-- Regimes table (market/commodity/sector regime signals)
	CREATE TABLE IF NOT EXISTS regimes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		signal TEXT CHECK(signal IN ('BUY','SELL')) NOT NULL,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_regimes_ticker ON regimes(ticker);

	-- Active Alerts table (tracks which TradingView alerts are currently running)
	CREATE TABLE IF NOT EXISTS active_alerts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT,
		script TEXT CHECK(script IN ('cdf','tms','etf_tms','ctf','q4d','q3d','etf_rebalancing')) NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(ticker, script)
	);

	CREATE INDEX IF NOT EXISTS idx_active_alerts_ticker ON active_alerts(ticker);
	CREATE INDEX IF NOT EXISTS idx_active_alerts_script ON active_alerts(script);

	-- ETF Allocations table (stores current ETF portfolio allocations)
	CREATE TABLE IF NOT EXISTS etf_allocations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		allocation_percent REAL NOT NULL,
		base_weight REAL NOT NULL DEFAULT 0,
		tactical_status TEXT CHECK(tactical_status IN ('BUY','SELL')) DEFAULT 'BUY',
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_etf_allocations_ticker ON etf_allocations(ticker);

	-- Settings table (global configuration)
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Equity Sizing table (tracks position sizing % per source ticker)
	CREATE TABLE IF NOT EXISTS equity_sizing (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_ticker TEXT NOT NULL UNIQUE,
		target_equity_pct REAL NOT NULL,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Equity Sizing History table (audit log of all sizing changes)
	CREATE TABLE IF NOT EXISTS equity_sizing_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_ticker TEXT NOT NULL,
		target_equity_pct REAL NOT NULL,
		received_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_equity_sizing_history_source ON equity_sizing_history(source_ticker);

	-- Asset class configuration (overlay eligibility, sell priority, Stage 2 targets)
	CREATE TABLE IF NOT EXISTS asset_class_config (
		code TEXT PRIMARY KEY,
		display_name TEXT NOT NULL,
		alert_label TEXT,
		alert_color TEXT,
		kind TEXT DEFAULT 'ASSET_CLASS',
		parent_code TEXT,
		is_portfolio_sleeve BOOLEAN DEFAULT 0,
		is_system_bucket BOOLEAN DEFAULT 0,
		allow_grouping BOOLEAN DEFAULT 1,
		allow_target_weight BOOLEAN DEFAULT 1,
		overlay_eligible BOOLEAN DEFAULT 0,
		display_order INTEGER DEFAULT 999,
		q3_sell_priority INTEGER,
		q1_category BOOLEAN DEFAULT 0,
		q3_beneficiary BOOLEAN DEFAULT 0,
		regime_independent BOOLEAN DEFAULT 0,
		q3_throttle_factor REAL,
		q4d_liquidity_factor REAL,
		q3_rating TEXT,
		q3_logic TEXT,
		stage2_target_pct REAL,
		sector TEXT,
		cash_reserve REAL DEFAULT 0,
		active BOOLEAN DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_asset_class_config_active ON asset_class_config(active);
	CREATE INDEX IF NOT EXISTS idx_asset_class_config_display_order ON asset_class_config(display_order);

	CREATE TABLE IF NOT EXISTS cash_movements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		asset_class_code TEXT NOT NULL,
		amount_delta REAL NOT NULL,
		previous_cash_reserve REAL NOT NULL DEFAULT 0,
		target_cash_reserve REAL NOT NULL DEFAULT 0,
		source_type TEXT NOT NULL CHECK(source_type IN ('PORTFOLIO_CASH_TRANSFER','STOCK_SALE','EXTERNAL_CAPITAL')),
		note TEXT DEFAULT '',
		status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','MISMATCH','CANCELLED')),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		confirmed_at DATETIME,
		statement_id INTEGER
	);

	CREATE INDEX IF NOT EXISTS idx_cash_movements_asset_class ON cash_movements(asset_class_code, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_cash_movements_status ON cash_movements(status, created_at DESC);

	-- Active Stage 1 overlay state snapshot (freezes pre-cut class weights while risk-off is active)
	CREATE TABLE IF NOT EXISTS overlay_stage1_state (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		active BOOLEAN DEFAULT 1,
		activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		released_at DATETIME,
		q1_exposure_pct REAL NOT NULL,
		spy_target_pct REAL DEFAULT 0,
		xao_target_pct REAL DEFAULT 0,
		governing_source TEXT,
		portfolio_value REAL DEFAULT 0
	);

	CREATE UNIQUE INDEX IF NOT EXISTS idx_overlay_stage1_state_active ON overlay_stage1_state(active) WHERE active = 1;

	CREATE TABLE IF NOT EXISTS overlay_stage1_state_classes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		state_id INTEGER NOT NULL,
		asset_class TEXT NOT NULL,
		invested_value REAL DEFAULT 0,
		tactical_cash_value REAL DEFAULT 0,
		total_class_capital_value REAL DEFAULT 0,
		strategic_weight_pct REAL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(state_id, asset_class),
		FOREIGN KEY (state_id) REFERENCES overlay_stage1_state(id) ON DELETE CASCADE
	);

	-- Signal-transition overlay state (tracks current signal vs last applied signal)
	CREATE TABLE IF NOT EXISTS overlay_signal_state (
		id INTEGER PRIMARY KEY CHECK(id = 1),
		current_q1_exposure_pct REAL NOT NULL DEFAULT 100,
		last_applied_q1_exposure_pct REAL NOT NULL DEFAULT 100,
		spy_q1_exposure_pct REAL DEFAULT 100,
		xao_q1_exposure_pct REAL DEFAULT 100,
		governing_source TEXT DEFAULT 'SPY',
		last_signal_changed_at DATETIME,
		last_applied_at DATETIME,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS overlay_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PARTIAL','STAGE1_DONE','STAGE2_DONE','BASELINED','SUPERSEDED','CANCELLED')),
		from_q1_exposure_pct REAL NOT NULL,
		to_q1_exposure_pct REAL NOT NULL,
		adjustment_ratio REAL NOT NULL,
		governing_source TEXT,
		triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		stage1_applied_at DATETIME,
		stage1_required_reduction_value REAL DEFAULT 0,
		stage1_recorded_reduction_value REAL DEFAULT 0,
		stage1_baseline_reserve_value REAL DEFAULT 0,
		stage1_expected_reserve_value REAL DEFAULT 0,
		stage1_import_baseline_at DATETIME,
		reserve_confirmed_at DATETIME,
		reserve_confirmed_value REAL,
		reserve_variance REAL,
		cash_confirmation_status TEXT DEFAULT '',
		stage2_completed_at DATETIME,
		baseline_accepted_at DATETIME,
		superseded_at DATETIME,
		notes TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_overlay_events_status ON overlay_events(status, triggered_at DESC);

	CREATE TABLE IF NOT EXISTS overlay_event_classes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		event_id INTEGER NOT NULL,
		asset_class TEXT NOT NULL,
		overlay_eligible BOOLEAN DEFAULT 0,
		trigger_invested_value REAL DEFAULT 0,
		trigger_invested_pct REAL DEFAULT 0,
		trigger_tactical_cash_value REAL DEFAULT 0,
		trigger_total_class_capital_value REAL DEFAULT 0,
		target_invested_value REAL DEFAULT 0,
		target_invested_pct REAL DEFAULT 0,
		q3_sell_priority INTEGER,
		stage2_target_pct REAL,
		stage1_recorded_reduction_value REAL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(event_id, asset_class),
		FOREIGN KEY (event_id) REFERENCES overlay_events(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS overlay_stage1_sources (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		event_id INTEGER NOT NULL,
		holding_id INTEGER,
		stock_name TEXT,
		ticker TEXT,
		asset_class TEXT,
		group_id TEXT,
		group_label TEXT,
		amount_sold REAL DEFAULT 0,
		before_value REAL DEFAULT 0,
		expected_after_value REAL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (event_id) REFERENCES overlay_events(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS q4_crisis_state (
		id INTEGER PRIMARY KEY CHECK(id = 1),
		active BOOLEAN NOT NULL DEFAULT 0,
		last_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_acknowledged_at DATETIME,
		reason TEXT DEFAULT '',
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err2 := db.Exec(schema2)
	if err2 != nil {
		log.Fatal(err2)
	}

	portfolioSchema := `
	CREATE TABLE IF NOT EXISTS portfolio_mix_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		status TEXT NOT NULL DEFAULT 'APPROVED' CHECK(status IN ('APPROVED','SUPERSEDED')),
		reason TEXT DEFAULT 'DISCRETIONARY',
		source_rebalance_plan_id INTEGER,
		notes TEXT,
		approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_portfolio_mix_snapshots_status ON portfolio_mix_snapshots(status, approved_at DESC);

	CREATE TABLE IF NOT EXISTS asset_classes (
		code TEXT PRIMARY KEY,
		asset_class_code TEXT NOT NULL,
		display_name TEXT NOT NULL,
		class_type TEXT NOT NULL DEFAULT 'ALLOCATION',
		parent_code TEXT,
		allow_grouping BOOLEAN DEFAULT 1,
		allow_target_weight BOOLEAN DEFAULT 1,
		analysis_eligible BOOLEAN DEFAULT 1,
		instrument_scope TEXT DEFAULT 'BOTH',
		risk_bucket TEXT DEFAULT '',
		display_order INTEGER DEFAULT 999,
		active BOOLEAN DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_asset_classes_active ON asset_classes(active, display_order);

	CREATE TABLE IF NOT EXISTS portfolio_mix_snapshot_rows (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		snapshot_id INTEGER NOT NULL,
		asset_class TEXT NOT NULL,
		display_name TEXT NOT NULL,
		display_order INTEGER DEFAULT 999,
		governed_by_q1 BOOLEAN DEFAULT 0,
		weight_pct REAL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(snapshot_id, asset_class),
		FOREIGN KEY (snapshot_id) REFERENCES portfolio_mix_snapshots(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS portfolio_rebalance_plans (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','COMPLETED','APPROVED','CANCELLED','SUPERSEDED')),
		driver TEXT NOT NULL DEFAULT 'DISCRETIONARY',
		title TEXT,
		notes TEXT,
		memo_job_id TEXT,
		source_snapshot_id INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		completed_at DATETIME,
		approved_at DATETIME
	);

	CREATE INDEX IF NOT EXISTS idx_portfolio_rebalance_plans_status ON portfolio_rebalance_plans(status, created_at DESC);

	CREATE TABLE IF NOT EXISTS portfolio_rebalance_plan_rows (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		plan_id INTEGER NOT NULL,
		asset_class TEXT NOT NULL,
		display_name TEXT NOT NULL,
		display_order INTEGER DEFAULT 999,
		governed_by_q1 BOOLEAN DEFAULT 0,
		current_weight_pct REAL DEFAULT 0,
		target_weight_pct REAL DEFAULT 0,
		recorded_move_value REAL DEFAULT 0,
		note TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(plan_id, asset_class),
		FOREIGN KEY (plan_id) REFERENCES portfolio_rebalance_plans(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS portfolio_daily_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		statement_id INTEGER NOT NULL UNIQUE,
		observed_at DATETIME NOT NULL,
		total_value_aud REAL NOT NULL DEFAULT 0,
		invested_value_aud REAL NOT NULL DEFAULT 0,
		statement_cash_aud REAL NOT NULL DEFAULT 0,
		sleeve_cash_aud REAL NOT NULL DEFAULT 0,
		residual_cash_aud REAL NOT NULL DEFAULT 0,
		holdings_count INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'STATEMENT',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (statement_id) REFERENCES account_statements(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_portfolio_daily_snapshots_observed ON portfolio_daily_snapshots(observed_at);

	CREATE TABLE IF NOT EXISTS asset_class_daily_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		statement_id INTEGER NOT NULL,
		observed_at DATETIME NOT NULL,
		asset_class TEXT NOT NULL,
		display_name TEXT NOT NULL,
		invested_value_aud REAL NOT NULL DEFAULT 0,
		cash_value_aud REAL NOT NULL DEFAULT 0,
		total_value_aud REAL NOT NULL DEFAULT 0,
		portfolio_weight_pct REAL NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'STATEMENT',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(statement_id, asset_class),
		FOREIGN KEY (statement_id) REFERENCES account_statements(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_asset_class_daily_snapshots_observed ON asset_class_daily_snapshots(observed_at);
	CREATE INDEX IF NOT EXISTS idx_asset_class_daily_snapshots_class ON asset_class_daily_snapshots(asset_class, observed_at);

	CREATE TABLE IF NOT EXISTS security_position_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		statement_id INTEGER NOT NULL,
		observed_at DATETIME NOT NULL,
		ticker TEXT,
		exchange_prefix TEXT,
		name TEXT NOT NULL,
		asset_class TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
		quantity REAL NOT NULL DEFAULT 0,
		price REAL NOT NULL DEFAULT 0,
		market_value_aud REAL NOT NULL DEFAULT 0,
		portfolio_weight_pct REAL NOT NULL DEFAULT 0,
		currency TEXT NOT NULL DEFAULT 'AUD',
		source TEXT NOT NULL DEFAULT 'STATEMENT',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(statement_id, name),
		FOREIGN KEY (statement_id) REFERENCES account_statements(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_security_position_snapshots_observed ON security_position_snapshots(observed_at);
	CREATE INDEX IF NOT EXISTS idx_security_position_snapshots_ticker ON security_position_snapshots(ticker, observed_at);

	CREATE TABLE IF NOT EXISTS security_price_daily (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL,
		exchange_prefix TEXT DEFAULT '',
		yahoo_symbol TEXT NOT NULL,
		observed_date DATE NOT NULL,
		close_price REAL NOT NULL DEFAULT 0,
		adjusted_close_price REAL NOT NULL DEFAULT 0,
		currency TEXT DEFAULT '',
		source TEXT NOT NULL DEFAULT 'YAHOO',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(ticker, exchange_prefix, observed_date, source)
	);

	CREATE INDEX IF NOT EXISTS idx_security_price_daily_ticker_date ON security_price_daily(ticker, exchange_prefix, observed_date);

	CREATE TABLE IF NOT EXISTS webhook_dead_letters (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		webhook_name TEXT NOT NULL,
		request_url TEXT NOT NULL DEFAULT '/',
		payload TEXT NOT NULL,
		error TEXT NOT NULL,
		http_status INTEGER NOT NULL DEFAULT 0,
		retry_count INTEGER NOT NULL DEFAULT 0,
		last_retried_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		resolved_at DATETIME,
		resolution TEXT CHECK(resolution IN ('retried','dismissed'))
	);

	CREATE INDEX IF NOT EXISTS idx_webhook_dead_letters_unresolved ON webhook_dead_letters(resolved_at, created_at DESC);

	-- Regime proposed actions: impacts computed by a regime webhook but not yet
	-- applied. The user must explicitly confirm before any position state changes.
	CREATE TABLE IF NOT EXISTS regime_proposed_actions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		regime_ticker TEXT NOT NULL,
		signal TEXT NOT NULL,
		ticker TEXT NOT NULL,
		security_type TEXT NOT NULL,
		action TEXT NOT NULL,
		target_position_pct INTEGER NOT NULL,
		asset_classes_sell TEXT NOT NULL DEFAULT '[]',
		applied_at DATETIME,
		dismissed_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_regime_proposed_pending ON regime_proposed_actions(applied_at, dismissed_at, created_at DESC);
	`

	if _, err := db.Exec(portfolioSchema); err != nil {
		log.Fatal(err)
	}
	if err := ensureNewsNarrativeSchema(); err != nil {
		log.Fatal("failed to create news narrative tables: ", err)
	}

	// Migrations: Add columns to existing tables if they don't exist
	db.Exec(`ALTER TABLE stock_groups ADD COLUMN asset_class_code TEXT`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_stock_groups_asset_class_code ON stock_groups(asset_class_code)`)
	db.Exec(`ALTER TABLE statement_holdings ADD COLUMN cash_reserve REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE portfolio_rebalance_plan_rows ADD COLUMN recorded_move_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE alerts ADD COLUMN exchange_prefix TEXT DEFAULT 'ASX:'`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN analyst_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN current_price REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN deer_flow_quality REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN deer_flow_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN perplexity_quality REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN perplexity_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN claude_quality REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN claude_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN council_quality REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN council_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN deer_flow_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN perplexity_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN claude_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN council_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN council_run_id TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN council_run_label TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN gemini_webui_output TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN gemini_webui_input_at TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN perplexity_webui_output TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN perplexity_webui_input_at TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN gpt_webui_output TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN gpt_webui_input_at TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN claude_webui_output TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN claude_webui_input_at TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN council_source_output TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN council_source_input_at TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN primary_asset_class TEXT DEFAULT ''`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN security_type TEXT DEFAULT 'STOCK'`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN overlay_sell_priority INTEGER DEFAULT 3`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN include_in_sizing BOOLEAN DEFAULT TRUE`)
	db.Exec(`UPDATE stock_analysis SET include_in_sizing = TRUE WHERE include_in_sizing IS NULL`)
	migrateStockAnalysisWithoutManus()
	db.Exec(`
		UPDATE stock_analysis
		SET security_type = 'ETF'
		WHERE UPPER(COALESCE(security_type, 'STOCK')) != 'ETF'
		  AND (
			UPPER(COALESCE(primary_asset_class, '')) = 'ETF'
			OR UPPER(CASE
				WHEN instr(COALESCE(ticker, ''), ':') > 0 THEN substr(ticker, instr(ticker, ':') + 1)
				ELSE COALESCE(ticker, '')
			END) IN (
				SELECT UPPER(ticker) FROM etf_positions
				UNION
				SELECT UPPER(ticker) FROM etf_allocations
			)
		  )
	`)

	// Research panel columns
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN thesis TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN bear_case_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN base_case_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN bull_case_pt REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN bear_probability REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN base_probability REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN bull_probability REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN catalysts TEXT`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN last_contributed_at DATETIME`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN is_watchlist BOOLEAN DEFAULT FALSE`)
	db.Exec(`ALTER TABLE stock_analysis ADD COLUMN is_external BOOLEAN DEFAULT FALSE`)
	db.Exec(`
		UPDATE stock_analysis
		SET is_watchlist = 1
		WHERE COALESCE(is_watchlist, 0) = 0
		  AND COALESCE(is_external, 0) = 0
		  AND NOT EXISTS (
			SELECT 1
			FROM holdings active_h
			WHERE active_h.is_active = 1
			  AND LOWER(TRIM(active_h.company_name)) = LOWER(TRIM(stock_analysis.name))
		  )
		  AND EXISTS (
			SELECT 1
			FROM holdings inactive_h
			WHERE inactive_h.is_active = 0
			  AND LOWER(TRIM(inactive_h.company_name)) = LOWER(TRIM(stock_analysis.name))
		  )
	`)
	db.Exec(`
		UPDATE stock_analysis
		SET is_watchlist = 1
		WHERE COALESCE(is_watchlist, 0) = 0
		  AND COALESCE(is_external, 0) = 0
		  AND NOT EXISTS (
			SELECT 1
			FROM holdings h
			WHERE h.is_active = 1
			  AND LOWER(TRIM(h.company_name)) = LOWER(TRIM(stock_analysis.name))
		  )
		  AND EXISTS (
			SELECT 1
			FROM active_alerts aa
			WHERE UPPER(TRIM(COALESCE(aa.ticker, ''))) IN (
				UPPER(TRIM(COALESCE(stock_analysis.ticker, ''))),
				UPPER(TRIM(REPLACE(COALESCE(stock_analysis.ticker, ''), 'ASX:', ''))),
				UPPER(TRIM(REPLACE(COALESCE(stock_analysis.ticker, ''), 'NASDAQ:', ''))),
				UPPER(TRIM(REPLACE(COALESCE(stock_analysis.ticker, ''), 'NYSE:', '')))
			)
		  )
	`)
	deduplicateStockAnalysisRows()

	// Architecture alignment migrations
	db.Exec(`ALTER TABLE alerts ADD COLUMN timeframe TEXT`)
	db.Exec(`ALTER TABLE alerts ADD COLUMN source TEXT CHECK(source IN ('cdf','tms','etf_tms','ctf','q4d','q3d','unknown'))`)
	db.Exec(`ALTER TABLE alerts ADD COLUMN affected_positions TEXT`)
	db.Exec(`ALTER TABLE alerts ADD COLUMN alert_price REAL`)
	db.Exec(`ALTER TABLE alerts ADD COLUMN resolved_reason TEXT`)
	db.Exec(`ALTER TABLE alerts ADD COLUMN resolved_note TEXT`)
	db.Exec(`ALTER TABLE security_positions ADD COLUMN entry_date DATETIME`)
	db.Exec(`ALTER TABLE security_positions ADD COLUMN stopped_waiting_reentry BOOLEAN DEFAULT 0`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN cash_reserve REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN q3_throttle_factor REAL`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN q4d_liquidity_factor REAL`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN sector TEXT`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN alert_label TEXT`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN alert_color TEXT`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN kind TEXT DEFAULT 'ASSET_CLASS'`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN parent_code TEXT`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN is_portfolio_sleeve BOOLEAN DEFAULT 0`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN is_system_bucket BOOLEAN DEFAULT 0`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN allow_grouping BOOLEAN DEFAULT 1`)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN allow_target_weight BOOLEAN DEFAULT 1`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_asset_class_config_kind ON asset_class_config(kind)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_asset_class_config_parent ON asset_class_config(parent_code)`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN stage1_required_reduction_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN stage1_recorded_reduction_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN stage1_baseline_reserve_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN stage1_expected_reserve_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN stage1_import_baseline_at DATETIME`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN reserve_confirmed_at DATETIME`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN reserve_confirmed_value REAL`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN reserve_variance REAL`)
	db.Exec(`ALTER TABLE overlay_events ADD COLUMN cash_confirmation_status TEXT DEFAULT ''`)
	db.Exec(`ALTER TABLE overlay_event_classes ADD COLUMN stage1_recorded_reduction_value REAL DEFAULT 0`)
	db.Exec(`
			CREATE TABLE IF NOT EXISTS overlay_stage1_sources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_id INTEGER NOT NULL,
			holding_id INTEGER,
			stock_name TEXT,
			ticker TEXT,
			asset_class TEXT,
			group_id TEXT,
			group_label TEXT,
			amount_sold REAL DEFAULT 0,
			before_value REAL DEFAULT 0,
			expected_after_value REAL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (event_id) REFERENCES overlay_events(id) ON DELETE CASCADE
		)
	`)
	db.Exec(`ALTER TABLE overlay_stage1_sources ADD COLUMN before_value REAL DEFAULT 0`)
	db.Exec(`ALTER TABLE overlay_stage1_sources ADD COLUMN expected_after_value REAL DEFAULT 0`)
	db.Exec(`
		CREATE TABLE IF NOT EXISTS q4_crisis_state (
			id INTEGER PRIMARY KEY CHECK(id = 1),
			active BOOLEAN NOT NULL DEFAULT 0,
			last_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_acknowledged_at DATETIME,
			reason TEXT DEFAULT '',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)

	// Migration: Update decisions table to allow nullable alert_id and current decision values.
	migrateDecisionsTable()
	migrateCashMovementsSourceTypes()
	seedAssetClassConfig()
	migratePortfolioSleevesToAssetClasses()
	seedAssetClasses()
	backfillAssetClassConfigMetadata()
	migrateAssetClassTaxonomyDefaults()
	migrateAlertStackPresentationDefaults()
	migrateETFAssetClassMappingsToStockAnalysis()
	migrateQ3ThrottleDefaults()
	migrateStockGroupAssetClassCodes()
	migrateStockAnalysisPrimaryAssetClasses()
	migrateNonAllocatingInstruments()

	// Migration: Add risk_profile column to security_positions
	db.Exec(`ALTER TABLE security_positions ADD COLUMN risk_profile TEXT CHECK(risk_profile IN ('RISK_ON','RISK_OFF'))`)

	// Migration: Add base_weight column to etf_allocations (immutable strategic weight from rebalancing script)
	db.Exec(`ALTER TABLE etf_allocations ADD COLUMN base_weight REAL NOT NULL DEFAULT 0`)
	// Backfill: set base_weight = allocation_percent for existing rows that have no base_weight set
	db.Exec(`UPDATE etf_allocations SET base_weight = allocation_percent WHERE base_weight = 0 AND allocation_percent > 0`)

	// Migration: Recreate active_alerts with ETF alert script in CHECK constraint if missing
	migrateActiveAlertsConstraint()
	// Migration: Add regime_position_sizing to active_alerts CHECK constraint
	migrateActiveAlertsForPositionSizing()
	migrateCanonicalActiveAlertScripts()
	migrateCanonicalAlertSources()
	migrateCanonicalAlertTypes()
	if err := ensureSecurityActionSchema(); err != nil {
		log.Fatal("failed to initialize security action queue: ", err)
	}
	// Migration: Add stock_allocation_ratio to asset_class_config (default 0.75)
	db.Exec(`ALTER TABLE asset_class_config ADD COLUMN stock_allocation_ratio REAL NOT NULL DEFAULT 0.75`)

	log.Println("[ALPHA EDGE] Database initialized with new architecture")

	// Migrate existing data from statement_holdings to holdings table (one-time migration)
	migrateStatementNativeAmountsToAUD()
	migrateExistingHoldings()
	migrateActiveHoldingsFromLatestStatement()
	if err := ensureSecurityIdentitySchema(); err != nil {
		log.Fatal("failed to initialize security identity schema: ", err)
	}
	if err := ensureETFShortlistSchema(); err != nil {
		log.Fatal("failed to initialize ETF shortlist: ", err)
	}
	if err := ensureETFCorePolicySchema(); err != nil {
		log.Fatal("failed to initialize ETF core policy schema: ", err)
	}
	if err := ensureETFMomentumSchema(); err != nil {
		log.Fatal("failed to initialize ETF momentum schema: ", err)
	}
	if err := ensureWatchlistListingSchema(); err != nil {
		log.Fatal("failed to initialize watchlist listing schema: ", err)
	}
	if err := ensureCommodityThemeSchema(); err != nil {
		log.Fatal("failed to initialize commodity theme schema: ", err)
	}
	if err := ensureDataRefreshSchema(); err != nil {
		log.Fatal("failed to initialize data refresh schema: ", err)
	}
	if err := ensureAssetClassProvenanceSchema(); err != nil {
		log.Fatal("failed to initialize asset class provenance schema: ", err)
	}
	backfillPrimaryAssetClasses()
	migrateNonAllocatingInstruments()
	backfillPerformanceSnapshots()

	// Initialize ETF positions (one-time setup)
	initializeETFPositions()
	initializeETFPolicyDefaults()

	// NOTE: Regimes are NOT auto-initialized - they come from TradingView alerts
	// When no regime data exists, the status endpoint returns "DISCONNECTED"
}

type sqliteColumnInfo struct {
	name         string
	dataType     string
	notNull      int
	defaultValue interface{}
	pk           int
}

func quoteSQLiteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func sqliteDefaultLiteral(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return ""
	case []byte:
		return string(v)
	default:
		return fmt.Sprint(v)
	}
}

func stockAnalysisColumns() ([]sqliteColumnInfo, error) {
	rows, err := db.Query(`PRAGMA table_info(stock_analysis)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []sqliteColumnInfo
	for rows.Next() {
		var cid int
		var column sqliteColumnInfo
		if err := rows.Scan(&cid, &column.name, &column.dataType, &column.notNull, &column.defaultValue, &column.pk); err != nil {
			return nil, err
		}
		columns = append(columns, column)
	}
	return columns, rows.Err()
}

func migrateStockAnalysisWithoutManus() {
	removedColumns := map[string]bool{
		"marnus_quality": true,
		"marnus_value":   true,
		"marnus_pt":      true,
		"manus_quality":  true,
		"manus_value":    true,
		"manus_pt":       true,
	}

	columns, err := stockAnalysisColumns()
	if err != nil {
		log.Printf("[DB] Failed to inspect stock_analysis for MANUS migration: %v", err)
		return
	}
	if len(columns) == 0 {
		return
	}

	needsMigration := false
	keptColumns := make([]sqliteColumnInfo, 0, len(columns))
	for _, column := range columns {
		if removedColumns[strings.ToLower(column.name)] {
			needsMigration = true
			continue
		}
		keptColumns = append(keptColumns, column)
	}
	if !needsMigration {
		return
	}

	tempTable := "stock_analysis_without_manus_migration"
	columnDefinitions := make([]string, 0, len(keptColumns)+1)
	columnNames := make([]string, 0, len(keptColumns))
	hasTicker := false
	hasName := false
	for _, column := range keptColumns {
		quotedName := quoteSQLiteIdentifier(column.name)
		definition := quotedName
		if strings.TrimSpace(column.dataType) != "" {
			definition += " " + column.dataType
		}
		if column.pk > 0 {
			definition += " PRIMARY KEY"
		}
		if column.notNull != 0 {
			definition += " NOT NULL"
		}
		if defaultLiteral := sqliteDefaultLiteral(column.defaultValue); defaultLiteral != "" {
			definition += " DEFAULT " + defaultLiteral
		}
		columnDefinitions = append(columnDefinitions, definition)
		columnNames = append(columnNames, quotedName)
		if strings.EqualFold(column.name, "ticker") {
			hasTicker = true
		}
		if strings.EqualFold(column.name, "name") {
			hasName = true
		}
	}
	if hasTicker && hasName {
		columnDefinitions = append(columnDefinitions, `UNIQUE("ticker", "name")`)
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("[DB] Failed to start MANUS migration: %v", err)
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DROP TABLE IF EXISTS ` + quoteSQLiteIdentifier(tempTable)); err != nil {
		log.Printf("[DB] Failed to clear MANUS migration table: %v", err)
		return
	}
	if _, err := tx.Exec(`CREATE TABLE ` + quoteSQLiteIdentifier(tempTable) + ` (` + strings.Join(columnDefinitions, ", ") + `)`); err != nil {
		log.Printf("[DB] Failed to create MANUS migration table: %v", err)
		return
	}
	joinedColumns := strings.Join(columnNames, ", ")
	if _, err := tx.Exec(`INSERT INTO ` + quoteSQLiteIdentifier(tempTable) + ` (` + joinedColumns + `) SELECT ` + joinedColumns + ` FROM stock_analysis`); err != nil {
		log.Printf("[DB] Failed to copy stock_analysis during MANUS migration: %v", err)
		return
	}
	if _, err := tx.Exec(`DROP TABLE stock_analysis`); err != nil {
		log.Printf("[DB] Failed to drop old stock_analysis during MANUS migration: %v", err)
		return
	}
	if _, err := tx.Exec(`ALTER TABLE ` + quoteSQLiteIdentifier(tempTable) + ` RENAME TO stock_analysis`); err != nil {
		log.Printf("[DB] Failed to rename stock_analysis during MANUS migration: %v", err)
		return
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_stock_analysis_ticker ON stock_analysis(ticker)`); err != nil {
		log.Printf("[DB] Failed to recreate stock_analysis ticker index: %v", err)
		return
	}
	if err := tx.Commit(); err != nil {
		log.Printf("[DB] Failed to commit MANUS migration: %v", err)
		return
	}
	log.Println("[DB] Removed MANUS columns from stock_analysis")
}

func canonicalSecurityTickerKey(raw string) string {
	key := strings.TrimSpace(raw)
	if idx := strings.LastIndex(key, ":"); idx != -1 {
		key = key[idx+1:]
	}
	return strings.ToUpper(strings.TrimSpace(key))
}

func stockAnalysisTickerKeySQL(expr string) string {
	return fmt.Sprintf(`UPPER(TRIM(CASE
		WHEN instr(COALESCE(%s, ''), ':') > 0 THEN substr(COALESCE(%s, ''), instr(COALESCE(%s, ''), ':') + 1)
		ELSE COALESCE(%s, '')
	END))`, expr, expr, expr, expr)
}

func normaliseExchangePrefix(prefix string) string {
	value := strings.TrimSpace(prefix)
	if value == "" {
		return ""
	}
	value = strings.ToUpper(value)
	if !strings.HasSuffix(value, ":") {
		value += ":"
	}
	return value
}

func fullTickerForStorage(exchangePrefix, ticker string) string {
	ticker = strings.TrimSpace(ticker)
	if ticker == "" {
		return ""
	}
	if strings.Contains(ticker, ":") {
		return strings.ToUpper(ticker)
	}
	return normaliseExchangePrefix(exchangePrefix) + strings.ToUpper(ticker)
}

func deduplicateStockAnalysisRows() {
	tickerKeyExpr := stockAnalysisTickerKeySQL("ticker")
	rows, err := db.Query(fmt.Sprintf(`
		SELECT %s AS ticker_key
		FROM stock_analysis
		WHERE TRIM(COALESCE(ticker, '')) != ''
		GROUP BY ticker_key
		HAVING COUNT(*) > 1
	`, tickerKeyExpr))
	if err != nil {
		log.Printf("[ANALYSIS] Failed to inspect duplicate stock_analysis tickers: %v", err)
		return
	}
	defer rows.Close()

	keys := make([]string, 0)
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err == nil && strings.TrimSpace(key) != "" {
			keys = append(keys, key)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[ANALYSIS] Failed while reading duplicate stock_analysis tickers: %v", err)
		return
	}

	for _, key := range keys {
		if err := deduplicateStockAnalysisTickerKey(key); err != nil {
			log.Printf("[ANALYSIS] Failed to deduplicate stock_analysis ticker %s: %v", key, err)
		}
	}
}

func deduplicateStockAnalysisTickerKey(tickerKey string) error {
	tickerKey = strings.TrimSpace(strings.ToUpper(tickerKey))
	if tickerKey == "" {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := deduplicateStockAnalysisTickerKeyTx(tx, tickerKey); err != nil {
		return err
	}
	return tx.Commit()
}

func deduplicateStockAnalysisTickerKeyTx(tx *sql.Tx, tickerKey string) error {
	tickerKey = strings.TrimSpace(strings.ToUpper(tickerKey))
	if tickerKey == "" {
		return nil
	}
	tickerKeyExpr := stockAnalysisTickerKeySQL("ticker")
	query := fmt.Sprintf(`
		SELECT id
		FROM stock_analysis
		WHERE TRIM(COALESCE(ticker, '')) != ''
		  AND %s = ?
		ORDER BY
			CASE WHEN LOWER(TRIM(name)) NOT IN (LOWER(TRIM(COALESCE(ticker, ''))), LOWER(?)) THEN 1 ELSE 0 END DESC,
			CASE WHEN COALESCE(council_run_id, '') != '' THEN 1 ELSE 0 END DESC,
			CASE WHEN COALESCE(thesis, '') != '' THEN 1 ELSE 0 END DESC,
			CASE WHEN COALESCE(catalysts, '') != '' THEN 1 ELSE 0 END DESC,
			CASE WHEN COALESCE(primary_asset_class, '') != '' THEN 1 ELSE 0 END DESC,
			COALESCE(is_watchlist, 0) DESC,
			updated_at DESC,
			id ASC
	`, tickerKeyExpr)

	rows, err := tx.Query(query, tickerKey, tickerKey)
	if err != nil {
		return err
	}
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(ids) <= 1 {
		return nil
	}

	keeperID := ids[0]
	updateQuery := fmt.Sprintf(`
		UPDATE stock_analysis
		SET is_watchlist = (
				SELECT MAX(COALESCE(is_watchlist, 0))
				FROM stock_analysis
				WHERE %s = ?
			),
			is_external = (
				SELECT MAX(COALESCE(is_external, 0))
				FROM stock_analysis
				WHERE %s = ?
			),
			last_contributed_at = COALESCE(
				last_contributed_at,
				(SELECT MAX(last_contributed_at) FROM stock_analysis WHERE %s = ?)
			),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, tickerKeyExpr, tickerKeyExpr, tickerKeyExpr)
	if _, err := tx.Exec(updateQuery, tickerKey, tickerKey, tickerKey, keeperID); err != nil {
		return err
	}

	deleteQuery := fmt.Sprintf(`
		DELETE FROM stock_analysis
		WHERE id != ?
		  AND TRIM(COALESCE(ticker, '')) != ''
		  AND %s = ?
	`, tickerKeyExpr)
	_, err = tx.Exec(deleteQuery, keeperID, tickerKey)
	return err
}

func setStockAnalysisWatchlistStateTx(tx *sql.Tx, ticker, exchangePrefix, name string, isWatchlist bool) error {
	name = strings.TrimSpace(name)
	tickerKey := canonicalSecurityTickerKey(ticker)
	storedTicker := fullTickerForStorage(exchangePrefix, ticker)
	if storedTicker == "" {
		storedTicker = strings.ToUpper(strings.TrimSpace(ticker))
	}

	tickerKeyExpr := stockAnalysisTickerKeySQL("ticker")
	query := fmt.Sprintf(`
		UPDATE stock_analysis
		SET is_watchlist = ?,
			name = CASE
				WHEN ? != '' AND (TRIM(COALESCE(name, '')) = '' OR UPPER(TRIM(name)) IN (UPPER(TRIM(COALESCE(ticker, ''))), ?))
				THEN ?
				ELSE name
			END,
			updated_at = CURRENT_TIMESTAMP
		WHERE COALESCE(is_external, 0) = 0
		  AND (
			(? != '' AND %s = ?)
			OR (? != '' AND LOWER(TRIM(name)) = LOWER(TRIM(?)))
		  )
	`, tickerKeyExpr)
	result, err := tx.Exec(query, boolToInt(isWatchlist), name, tickerKey, name, tickerKey, tickerKey, name, name)
	if err != nil {
		return err
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 && isWatchlist && storedTicker != "" && name != "" {
		if _, err := tx.Exec(`
			INSERT INTO stock_analysis (ticker, name, is_watchlist, updated_at, created_at)
			VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT(ticker, name) DO UPDATE SET
				is_watchlist = 1,
				updated_at = CURRENT_TIMESTAMP
		`, storedTicker, name); err != nil {
			return err
		}
	}
	if tickerKey != "" {
		return deduplicateStockAnalysisTickerKeyTx(tx, tickerKey)
	}
	return nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func isCashEquivalentTicker(raw string) bool {
	switch canonicalSecurityTickerKey(raw) {
	case "BSUB", "AAA":
		return true
	default:
		return false
	}
}

func looksLikeTickerSymbol(raw string) bool {
	key := canonicalSecurityTickerKey(raw)
	if key == "" {
		return false
	}
	if strings.ContainsAny(raw, " \t\n\r") {
		return false
	}

	hasLetter := false
	for _, r := range key {
		switch {
		case r >= 'A' && r <= 'Z':
			hasLetter = true
		case r >= '0' && r <= '9':
		case r == '.' || r == '-':
		default:
			return false
		}
	}

	return hasLetter
}

func resolveCanonicalSecurityTicker(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	var mapped string
	err := db.QueryRow(`
		SELECT ticker
		FROM company_mappings
		WHERE company_name = ?
		  AND ticker IS NOT NULL
		  AND TRIM(ticker) != ''
		LIMIT 1
	`, raw).Scan(&mapped)
	if err == nil && strings.TrimSpace(mapped) != "" {
		return canonicalSecurityTickerKey(mapped)
	}

	err = db.QueryRow(`
		SELECT ticker
		FROM holdings
		WHERE company_name = ?
		  AND is_active = 1
		  AND ticker IS NOT NULL
		  AND TRIM(ticker) != ''
		LIMIT 1
	`, raw).Scan(&mapped)
	if err == nil && strings.TrimSpace(mapped) != "" {
		return canonicalSecurityTickerKey(mapped)
	}

	err = db.QueryRow(`
		SELECT ticker
		FROM stock_analysis
		WHERE name = ?
		  AND ticker IS NOT NULL
		  AND TRIM(ticker) != ''
		LIMIT 1
	`, raw).Scan(&mapped)
	if err == nil && strings.TrimSpace(mapped) != "" {
		return canonicalSecurityTickerKey(mapped)
	}

	if looksLikeTickerSymbol(raw) {
		return canonicalSecurityTickerKey(raw)
	}

	return ""
}

// Migration: Update decisions table to allow nullable alert_id
func migrateDecisionsTable() {
	// Check if migration is needed by trying to query the table structure
	var sql string
	err := db.QueryRow(`
		SELECT sql FROM sqlite_master
		WHERE type='table' AND name='decisions'
	`).Scan(&sql)

	if err != nil {
		log.Println("[ALPHA EDGE] No decisions table found, skipping migration")
		return
	}

	// Check if the table already has nullable alert_id and current decision values
	if strings.Contains(sql, "alert_id INTEGER NOT NULL") || !strings.Contains(sql, "REBALANCE_DISMISS") || !strings.Contains(sql, "SELL_DOWN") || !strings.Contains(sql, "SELL_50") || !strings.Contains(sql, "EQUITY_REGIME_STRONG_TRIM") || !strings.Contains(sql, "OVERRIDE") || !strings.Contains(sql, "CASH_ALLOCATION") {
		log.Println("[ALPHA EDGE] Migrating decisions table to support nullable alert_id and current decision values...")

		// Disable foreign keys temporarily
		db.Exec(`PRAGMA foreign_keys = OFF`)

		// Create new table with updated schema
		_, err := db.Exec(`
			CREATE TABLE IF NOT EXISTS decisions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				alert_id INTEGER,
				decision TEXT CHECK(decision IN ('BUY','SELL','SELL_50','SELL_DOWN','ADD','TRIM','EQUITY_REGIME_STRONG_TRIM','IGNORE','OVERRIDE','REBALANCE_DISMISS','CASH_ALLOCATION')) NOT NULL,
				notes TEXT,
				position_pct_after REAL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (alert_id) REFERENCES alerts(id)
			)
		`)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to create decisions_new table: %v", err)
			db.Exec(`PRAGMA foreign_keys = ON`)
			return
		}

		// Copy existing data
		_, err = db.Exec(`
			INSERT INTO decisions_new (id, alert_id, decision, notes, position_pct_after, created_at)
			SELECT id, alert_id, decision, notes, position_pct_after, created_at
			FROM decisions
		`)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to copy data to decisions_new: %v", err)
			db.Exec(`DROP TABLE IF EXISTS decisions_new`)
			db.Exec(`PRAGMA foreign_keys = ON`)
			return
		}

		// Drop old table and rename new one
		db.Exec(`DROP TABLE decisions`)
		db.Exec(`ALTER TABLE decisions_new RENAME TO decisions`)

		// Re-enable foreign keys
		db.Exec(`PRAGMA foreign_keys = ON`)

		log.Println("[ALPHA EDGE] Decisions table migration completed")
	} else {
		log.Println("[ALPHA EDGE] Decisions table already migrated, skipping")
	}
}

// Migration: replace legacy cash movement source labels with explicit business source names.
func migrateCashMovementsSourceTypes() {
	var sql string
	err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='cash_movements'`).Scan(&sql)
	if err != nil {
		log.Println("[ALPHA EDGE] No cash_movements table found, skipping migration")
		return
	}

	if strings.Contains(sql, "PORTFOLIO_CASH_TRANSFER") && strings.Contains(sql, "STOCK_SALE") && !strings.Contains(sql, "MANUAL_CORRECTION") {
		log.Println("[ALPHA EDGE] cash_movements source constraint already current, skipping")
		return
	}

	log.Println("[ALPHA EDGE] Migrating cash_movements source values...")
	db.Exec(`PRAGMA foreign_keys = OFF`)
	db.Exec(`DROP TABLE IF EXISTS cash_movements_new`)

	_, err = db.Exec(`
		CREATE TABLE cash_movements_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			asset_class_code TEXT NOT NULL,
			amount_delta REAL NOT NULL,
			previous_cash_reserve REAL NOT NULL DEFAULT 0,
			target_cash_reserve REAL NOT NULL DEFAULT 0,
			source_type TEXT NOT NULL CHECK(source_type IN ('PORTFOLIO_CASH_TRANSFER','STOCK_SALE','EXTERNAL_CAPITAL')),
			note TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','MISMATCH','CANCELLED')),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			confirmed_at DATETIME,
			statement_id INTEGER
		)
	`)
	if err != nil {
		log.Printf("[ALPHA EDGE] Failed to create cash_movements_new table: %v", err)
		db.Exec(`PRAGMA foreign_keys = ON`)
		return
	}

	_, err = db.Exec(`
		INSERT INTO cash_movements_new (
			id, asset_class_code, amount_delta, previous_cash_reserve,
			target_cash_reserve, source_type, note, status, created_at,
			confirmed_at, statement_id
		)
		SELECT
			id,
			asset_class_code,
			amount_delta,
			previous_cash_reserve,
			target_cash_reserve,
			CASE source_type
				WHEN 'PORTFOLIO_CASH' THEN 'PORTFOLIO_CASH_TRANSFER'
				WHEN 'SALE_PROCEEDS' THEN 'STOCK_SALE'
				WHEN 'MANUAL_CORRECTION' THEN 'EXTERNAL_CAPITAL'
				ELSE source_type
			END,
			CASE
				WHEN source_type = 'MANUAL_CORRECTION' AND COALESCE(note, '') = '' THEN 'Legacy manual correction migrated to external capital'
				WHEN source_type = 'MANUAL_CORRECTION' THEN 'Legacy manual correction: ' || note
				ELSE note
			END,
			status,
			created_at,
			confirmed_at,
			statement_id
		FROM cash_movements
	`)
	if err != nil {
		log.Printf("[ALPHA EDGE] Failed to copy cash_movements data: %v", err)
		db.Exec(`DROP TABLE IF EXISTS cash_movements_new`)
		db.Exec(`PRAGMA foreign_keys = ON`)
		return
	}

	db.Exec(`DROP TABLE cash_movements`)
	db.Exec(`ALTER TABLE cash_movements_new RENAME TO cash_movements`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_cash_movements_asset_class ON cash_movements(asset_class_code, created_at DESC)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_cash_movements_status ON cash_movements(status, created_at DESC)`)
	db.Exec(`PRAGMA foreign_keys = ON`)
	log.Println("[ALPHA EDGE] cash_movements source migration completed")
}

// Migration: Recreate active_alerts table if ETF alert script is missing from CHECK constraint
func migrateActiveAlertsConstraint() {
	var sql string
	err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='active_alerts'`).Scan(&sql)
	if err != nil {
		log.Println("[ALPHA EDGE] No active_alerts table found, skipping migration")
		return
	}

	if strings.Contains(sql, "etf_tms") || strings.Contains(sql, "etf_oms") {
		log.Println("[ALPHA EDGE] active_alerts constraint already includes ETF alert script, skipping")
		return
	}

	log.Println("[ALPHA EDGE] Migrating active_alerts: adding ETF alert script to CHECK constraint...")
	db.Exec(`PRAGMA foreign_keys = OFF`)
	db.Exec(`BEGIN TRANSACTION`)
	db.Exec(`CREATE TABLE active_alerts_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT,
		script TEXT CHECK(script IN ('cdf','tms','etf_tms','ctf','q4d','q3d','etf_rebalancing')) NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(ticker, script)
	)`)
	db.Exec(`INSERT INTO active_alerts_new SELECT * FROM active_alerts`)
	db.Exec(`DROP TABLE active_alerts`)
	db.Exec(`ALTER TABLE active_alerts_new RENAME TO active_alerts`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_active_alerts_ticker ON active_alerts(ticker)`)
	db.Exec(`COMMIT`)
	db.Exec(`PRAGMA foreign_keys = ON`)
	log.Println("[ALPHA EDGE] active_alerts constraint migration completed")
}

func migrateStatementNativeAmountsToAUD() {
	currencyCases := []struct {
		Currency    string
		NativeCol   string
		AUDCol      string
		Description string
	}{
		{Currency: "USD", NativeCol: "usd_value", AUDCol: "usd_aud", Description: "USD"},
		{Currency: "GBP", NativeCol: "gbp_value", AUDCol: "gbp_aud", Description: "GBP"},
	}

	for _, c := range currencyCases {
		result, err := db.Exec(fmt.Sprintf(`
			UPDATE statement_holdings
			SET
				cost_aud = cost_aud * (
					SELECT %s / %s FROM account_statements s WHERE s.id = statement_holdings.statement_id
				),
				value_aud = value_aud * (
					SELECT %s / %s FROM account_statements s WHERE s.id = statement_holdings.statement_id
				),
				gain_loss_aud = gain_loss_aud * (
					SELECT %s / %s FROM account_statements s WHERE s.id = statement_holdings.statement_id
				),
				market_value = market_value * (
					SELECT %s / %s FROM account_statements s WHERE s.id = statement_holdings.statement_id
				)
			WHERE UPPER(TRIM(currency)) = ?
			  AND statement_id IN (
				SELECT s.id
				FROM account_statements s
				JOIN (
					SELECT statement_id, COALESCE(SUM(value_aud), 0) AS imported_value
					FROM statement_holdings
					WHERE UPPER(TRIM(currency)) = ?
					GROUP BY statement_id
				) imported ON imported.statement_id = s.id
				WHERE s.%s > 0
				  AND s.%s > 0
				  AND ABS(imported.imported_value - s.%s) <= MAX(1.0, s.%s * 0.02)
				  AND ABS(imported.imported_value - s.%s) > MAX(1.0, s.%s * 0.02)
			  )
		`, c.AUDCol, c.NativeCol, c.AUDCol, c.NativeCol, c.AUDCol, c.NativeCol, c.AUDCol, c.NativeCol,
			c.NativeCol, c.AUDCol, c.NativeCol, c.NativeCol, c.AUDCol, c.AUDCol), c.Currency, c.Currency)
		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to migrate %s statement holding values to AUD: %v", c.Description, err)
			continue
		}
		if affected, _ := result.RowsAffected(); affected > 0 {
			log.Printf("[ALPHA EDGE] Migrated %d %s statement holding values from native currency to AUD", affected, c.Description)
		}
	}
}

func migrateActiveHoldingsFromLatestStatement() {
	result, err := db.Exec(`
		WITH latest_statement AS (
			SELECT id
			FROM account_statements
			ORDER BY statement_date DESC, id DESC
			LIMIT 1
		),
		latest_holdings AS (
			SELECT
				LOWER(TRIM(details)) AS match_name,
				quantity,
				cost_aud,
				current_price,
				value_aud,
				gain_loss_aud,
				gain_loss_pct,
				currency,
				market_value,
				cash_reserve
			FROM statement_holdings
			WHERE statement_id = (SELECT id FROM latest_statement)
		)
		UPDATE holdings
		SET
			quantity = (SELECT sh.quantity FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			cost_aud = (SELECT sh.cost_aud FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			current_price = (SELECT sh.current_price FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			value_aud = (SELECT sh.value_aud FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			gain_loss_aud = (SELECT sh.gain_loss_aud FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			gain_loss_pct = (SELECT sh.gain_loss_pct FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			currency = (SELECT sh.currency FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			market_value = (SELECT sh.market_value FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			cash_reserve = (SELECT sh.cash_reserve FROM latest_holdings sh WHERE sh.match_name = LOWER(TRIM(holdings.company_name))),
			last_synced_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE is_active = 1
		  AND EXISTS (
			SELECT 1
			FROM latest_holdings sh
			WHERE sh.match_name = LOWER(TRIM(holdings.company_name))
		  )
	`)
	if err != nil {
		log.Printf("[ALPHA EDGE] Failed to refresh active holdings from latest statement: %v", err)
		return
	}
	if affected, _ := result.RowsAffected(); affected > 0 {
		log.Printf("[ALPHA EDGE] Refreshed %d active holdings from latest statement values", affected)
	}
}

// One-time migration to populate holdings table from latest statement
func migrateExistingHoldings() {
	// Check if holdings table is empty
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM holdings`).Scan(&count)
	if count > 0 {
		log.Println("[ALPHA EDGE] Holdings table already has data, skipping migration")
		return
	}

	log.Println("[ALPHA EDGE] Migrating existing holdings to unified holdings table...")

	// Get latest statement
	var statementID int
	err := db.QueryRow(`
		SELECT id FROM account_statements
		ORDER BY statement_date DESC LIMIT 1
	`).Scan(&statementID)

	if err != nil {
		log.Println("[ALPHA EDGE] No existing statements found, nothing to migrate")
		return
	}

	// Get holdings from latest statement
	rows, err := db.Query(`
		SELECT h.details, h.quantity, h.cost_aud, h.current_price, h.value_aud,
		       h.gain_loss_aud, h.gain_loss_pct, h.currency, h.market_value, h.cash_reserve,
		       m.ticker, m.exchange_prefix
		FROM statement_holdings h
		LEFT JOIN company_mappings m ON h.details = m.company_name
		WHERE h.statement_id = ?
	`, statementID)

	if err != nil {
		log.Printf("[ALPHA EDGE] Error querying statement_holdings: %v", err)
		return
	}
	defer rows.Close()

	migratedCount := 0
	for rows.Next() {
		var companyName string
		var quantity, costAUD, currentPrice, valueAUD, gainLossAUD, gainLossPct, marketValue, cashReserve float64
		var currency string
		var ticker, exchangePrefix *string

		err := rows.Scan(&companyName, &quantity, &costAUD, &currentPrice, &valueAUD,
			&gainLossAUD, &gainLossPct, &currency, &marketValue, &cashReserve,
			&ticker, &exchangePrefix)

		if err != nil {
			log.Printf("[ALPHA EDGE] Error scanning holding: %v", err)
			continue
		}

		// Use ticker from mapping, or company name as fallback
		finalTicker := companyName
		finalPrefix := "ASX:"
		if ticker != nil {
			finalTicker = *ticker
		}
		if exchangePrefix != nil {
			finalPrefix = *exchangePrefix
		}

		// Insert into holdings table
		_, err = db.Exec(`
			INSERT INTO holdings
			(ticker, company_name, exchange_prefix, quantity, cost_aud, current_price, value_aud,
			 gain_loss_aud, gain_loss_pct, currency, market_value, cash_reserve, is_active)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
		`, finalTicker, companyName, finalPrefix, quantity, costAUD, currentPrice, valueAUD,
			gainLossAUD, gainLossPct, currency, marketValue, cashReserve)

		if err != nil {
			log.Printf("[ALPHA EDGE] Error inserting holding %s: %v", companyName, err)
			continue
		}
		migratedCount++
	}

	log.Printf("[ALPHA EDGE] Migration complete: %d holdings migrated from statement_holdings to holdings table", migratedCount)
}

// Initialize ETF positions with default values (one-time setup)
func initializeETFPositions() {
	// Check if ETF positions table already has data
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM etf_positions`).Scan(&count)
	if count > 0 {
		log.Println("[ALPHA EDGE] ETF positions already initialized, skipping")
		return
	}

	log.Println("[ALPHA EDGE] Initializing ETF positions...")

	for _, ticker := range staticdata.DefaultETFTickers {
		_, err := db.Exec(`
			INSERT INTO etf_positions (ticker, position_state, allocation_pct, cash_allocated, manual_override)
			VALUES (?, 'SELL', 0, 0, 0)
		`, ticker)

		if err != nil {
			log.Printf("[ALPHA EDGE] Error initializing ETF position for %s: %v", ticker, err)
			continue
		}
	}

	log.Printf("[ALPHA EDGE] ETF positions initialized for %d ETFs", len(staticdata.DefaultETFTickers))
}

func initializeETFPolicyDefaults() {
	for key, value := range staticdata.DefaultETFPolicySettings {
		if _, err := db.Exec(`
			INSERT INTO settings (key, value, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(key) DO NOTHING
		`, key, value); err != nil {
			log.Printf("[ALPHA EDGE] Failed to initialise ETF setting %s: %v", key, err)
		}
	}
}

// DEPRECATED: Old seed function for securities table
// func seedData() { ... }
