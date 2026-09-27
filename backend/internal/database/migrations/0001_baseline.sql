CREATE TABLE account_statements (
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

CREATE TABLE active_alerts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT,
		script TEXT CHECK(script IN ('cdf','tms','etf_tms','ctf','q4d','q3d','etf_rebalancing')) NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(ticker, script)
	);

CREATE TABLE alerts (
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

CREATE TABLE asset_class_config (
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
	, stock_allocation_ratio REAL NOT NULL DEFAULT 0.75);

CREATE TABLE asset_class_daily_snapshots (
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

CREATE TABLE asset_class_etf_policies (
			asset_class TEXT PRIMARY KEY,
			core_security_id INTEGER,
			core_ticker TEXT NOT NULL DEFAULT '',
			core_ratio_pct REAL NOT NULL DEFAULT 25,
			momentum_influence_pct REAL NOT NULL DEFAULT 50,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(core_security_id) REFERENCES security_identities(id) ON DELETE SET NULL
		);

CREATE TABLE asset_classes (
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

CREATE TABLE cash_movements (
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

CREATE TABLE commodity_price_daily (
			source_symbol TEXT NOT NULL,
			provider_symbol TEXT NOT NULL,
			observed_date DATE NOT NULL,
			close_price REAL NOT NULL,
			currency TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT 'YAHOO',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(source_symbol, observed_date, source)
		);

CREATE TABLE commodity_theme_direct_expressions (
			theme_code TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'SIGNAL_ONLY' CHECK(status IN ('SIGNAL_ONLY', 'APPROVED')),
			instrument_label TEXT NOT NULL DEFAULT '',
			instrument_ticker TEXT NOT NULL DEFAULT '',
			instrument_kind TEXT NOT NULL DEFAULT '',
			existing_position_treatment TEXT NOT NULL DEFAULT 'CLASS_DEFINED',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(theme_code) REFERENCES commodity_themes(code) ON DELETE CASCADE
		);

CREATE TABLE commodity_theme_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_key TEXT NOT NULL UNIQUE,
			theme_code TEXT NOT NULL,
			stage_key TEXT NOT NULL,
			scope TEXT NOT NULL CHECK(scope IN ('THEME', 'SECURITY')),
			security_id INTEGER,
			security_ticker TEXT NOT NULL DEFAULT '',
			signal TEXT NOT NULL CHECK(signal IN ('BUY', 'SELL', 'CONNECT')),
			script TEXT NOT NULL,
			signal_version TEXT NOT NULL,
			source_json TEXT NOT NULL,
			timeframe TEXT NOT NULL DEFAULT '',
			bar_closed_at DATETIME,
			close REAL,
			received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			raw_payload_json TEXT NOT NULL DEFAULT '{}',
			FOREIGN KEY(theme_code) REFERENCES commodity_themes(code) ON DELETE CASCADE,
			FOREIGN KEY(security_id) REFERENCES security_identities(id) ON DELETE SET NULL
		);

CREATE TABLE commodity_theme_stages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			theme_code TEXT NOT NULL,
			stage_key TEXT NOT NULL,
			stage_order INTEGER NOT NULL,
			scope TEXT NOT NULL CHECK(scope IN ('THEME', 'SECURITY')),
			label TEXT NOT NULL,
			source_kind TEXT NOT NULL,
			source_symbol TEXT NOT NULL DEFAULT '',
			source_numerator TEXT NOT NULL DEFAULT '',
			source_denominator TEXT NOT NULL DEFAULT '',
			source_label TEXT NOT NULL DEFAULT '',
			required_script TEXT NOT NULL DEFAULT '',
			active BOOLEAN NOT NULL DEFAULT 1,
			UNIQUE(theme_code, stage_key),
			FOREIGN KEY(theme_code) REFERENCES commodity_themes(code) ON DELETE CASCADE
		);

CREATE TABLE commodity_themes (
			code TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			market_group TEXT NOT NULL DEFAULT '',
			strategic_floor_asset_class_code TEXT NOT NULL,
			tactical_asset_class_code TEXT NOT NULL,
			active BOOLEAN NOT NULL DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE company_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		company_name TEXT NOT NULL UNIQUE,
		ticker TEXT NOT NULL,
		exchange_prefix TEXT NOT NULL DEFAULT 'ASX:',
		template_id TEXT,
		enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	, security_id INTEGER);

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

CREATE TABLE "decisions" (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				alert_id INTEGER,
				decision TEXT CHECK(decision IN ('BUY','SELL','SELL_50','SELL_DOWN','ADD','TRIM','EQUITY_REGIME_STRONG_TRIM','IGNORE','OVERRIDE','REBALANCE_DISMISS','CASH_ALLOCATION')) NOT NULL,
				notes TEXT,
				position_pct_after REAL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (alert_id) REFERENCES alerts(id)
			);

CREATE TABLE equity_sizing (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_ticker TEXT NOT NULL UNIQUE,
		target_equity_pct REAL NOT NULL,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE equity_sizing_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_ticker TEXT NOT NULL,
		target_equity_pct REAL NOT NULL,
		received_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE etf_allocations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		allocation_percent REAL NOT NULL,
		base_weight REAL NOT NULL DEFAULT 0,
		tactical_status TEXT CHECK(tactical_status IN ('BUY','SELL')) DEFAULT 'BUY',
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE etf_executions (
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

CREATE TABLE etf_positions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		position_state TEXT CHECK(position_state IN ('BUY','SELL')) NOT NULL DEFAULT 'SELL',
		allocation_pct REAL DEFAULT 0,
		cash_allocated REAL DEFAULT 0,
		manual_override BOOLEAN DEFAULT 0,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE etf_rebalance_targets (
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

CREATE TABLE etf_shortlist (
			ticker TEXT PRIMARY KEY,
			display_name TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			asset_class_hint TEXT NOT NULL DEFAULT '',
			added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE holdings (
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
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, security_id INTEGER,
		UNIQUE(company_name, is_active)
	);

CREATE TABLE news_daily_jobs (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'QUEUED',
			stage TEXT NOT NULL DEFAULT 'queued',
			stage_message TEXT NOT NULL DEFAULT '',
			progress_pct INTEGER NOT NULL DEFAULT 0,
			run_id INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			started_at DATETIME,
			finished_at DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE news_foundation_candidates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL,
			title TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			claim TEXT NOT NULL DEFAULT '',
			reasoning TEXT NOT NULL DEFAULT '',
			source_section TEXT NOT NULL DEFAULT '',
			source_excerpt TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			conviction REAL NOT NULL DEFAULT 0,
			supporting_evidence TEXT NOT NULL DEFAULT '',
			opposing_evidence TEXT NOT NULL DEFAULT '',
			invalidation_trigger TEXT NOT NULL DEFAULT '',
			sources_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE news_foundation_clusters (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL,
			canonical_key TEXT NOT NULL,
			timeframe TEXT NOT NULL DEFAULT '1Y',
			title TEXT NOT NULL DEFAULT '',
			absorbed_titles_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(memo_job_id, canonical_key, timeframe)
		);

CREATE TABLE news_foundation_cohort_theses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cohort_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			title TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			relationship TEXT NOT NULL DEFAULT 'MODIFIES',
			conviction REAL NOT NULL DEFAULT 0,
			conviction_delta REAL NOT NULL DEFAULT 0,
			summary TEXT NOT NULL DEFAULT '',
			evidence TEXT NOT NULL DEFAULT '',
			supporting_evidence TEXT NOT NULL DEFAULT '',
			opposing_evidence TEXT NOT NULL DEFAULT '',
			invalidation_trigger TEXT NOT NULL DEFAULT '',
			source_excerpt TEXT NOT NULL DEFAULT '',
			sources_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(cohort_id, slug)
		);

CREATE TABLE news_foundation_cohorts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			status TEXT NOT NULL DEFAULT 'BUILDING',
			source_type TEXT NOT NULL DEFAULT '',
			source_id TEXT NOT NULL DEFAULT '',
			source_memo_job_id TEXT NOT NULL DEFAULT '',
			run_id INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			quality_score REAL NOT NULL DEFAULT 0,
			thesis_count INTEGER NOT NULL DEFAULT 0,
			candidate_count INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			activated_at DATETIME,
			superseded_at DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE news_foundation_jobs (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'QUEUED',
			stage TEXT NOT NULL DEFAULT 'queued',
			stage_message TEXT NOT NULL DEFAULT '',
			progress_pct INTEGER NOT NULL DEFAULT 0,
			mode TEXT NOT NULL DEFAULT 'BOOTSTRAP',
			source_type TEXT NOT NULL DEFAULT '',
			source_id TEXT NOT NULL DEFAULT '',
			source_memo_job_id TEXT NOT NULL DEFAULT '',
			foundation_cohort_id INTEGER NOT NULL DEFAULT 0,
			run_id INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			quality_score REAL NOT NULL DEFAULT 0,
			thesis_count INTEGER NOT NULL DEFAULT 0,
			candidate_count INTEGER NOT NULL DEFAULT 0,
			error_message TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			started_at DATETIME,
			finished_at DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE news_foundation_research_tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL,
			lane TEXT NOT NULL,
			timeframe TEXT NOT NULL DEFAULT '1Y',
			query TEXT NOT NULL DEFAULT '',
			priority INTEGER NOT NULL DEFAULT 0,
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE news_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL,
			headline TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			timeframe TEXT NOT NULL DEFAULT '1D',
			impact_score REAL NOT NULL DEFAULT 0,
			sources_json TEXT NOT NULL DEFAULT '[]',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP, sentiment TEXT NOT NULL DEFAULT 'NEUTRAL',
			FOREIGN KEY (run_id) REFERENCES news_runs(id) ON DELETE CASCADE
		);

CREATE TABLE news_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_date DATE NOT NULL,
			mode TEXT NOT NULL DEFAULT 'DAILY',
			status TEXT NOT NULL DEFAULT 'COMPLETED',
			model TEXT NOT NULL DEFAULT '',
			daily_summary TEXT NOT NULL DEFAULT '',
			market_context_json TEXT NOT NULL DEFAULT '{}',
			raw_response_json TEXT NOT NULL DEFAULT '{}',
			error_message TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		, source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '', foundation_cohort_id INTEGER NOT NULL DEFAULT 0);

CREATE TABLE news_theses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			slug TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			timeframe TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			conviction REAL NOT NULL DEFAULT 0.5,
			summary TEXT NOT NULL DEFAULT '',
			asset_classes_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			source_type TEXT NOT NULL DEFAULT '',
			source_id TEXT NOT NULL DEFAULT '',
			source_excerpt TEXT NOT NULL DEFAULT '',
			supporting_evidence TEXT NOT NULL DEFAULT '',
			opposing_evidence TEXT NOT NULL DEFAULT '',
			invalidation_trigger TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			resolved_at DATETIME
		, foundation_cohort_id INTEGER NOT NULL DEFAULT 0, relevance_score REAL NOT NULL DEFAULT 0, invalidation_check_due_at DATETIME);

CREATE TABLE news_thesis_conviction_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			thesis_id INTEGER NOT NULL,
			run_id INTEGER NOT NULL,
			conviction REAL NOT NULL,
			relationship TEXT NOT NULL DEFAULT '',
			recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (thesis_id) REFERENCES news_theses(id) ON DELETE CASCADE
		);

CREATE TABLE news_thesis_updates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			thesis_id INTEGER NOT NULL,
			run_id INTEGER NOT NULL,
			relationship TEXT NOT NULL DEFAULT 'MODIFIES',
			evidence TEXT NOT NULL DEFAULT '',
			conviction_delta REAL NOT NULL DEFAULT 0,
			sources_json TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP, sentiment TEXT NOT NULL DEFAULT 'NEUTRAL',
			FOREIGN KEY (thesis_id) REFERENCES news_theses(id) ON DELETE CASCADE,
			FOREIGN KEY (run_id) REFERENCES news_runs(id) ON DELETE CASCADE
		);

CREATE TABLE overlay_event_classes (
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

CREATE TABLE overlay_events (
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

CREATE TABLE overlay_signal_state (
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

CREATE TABLE overlay_stage1_sources (
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

CREATE TABLE overlay_stage1_state (
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

CREATE TABLE overlay_stage1_state_classes (
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

CREATE TABLE portfolio_daily_snapshots (
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

CREATE TABLE portfolio_memo_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memo_job_id TEXT NOT NULL UNIQUE,
			run_id TEXT NOT NULL DEFAULT '',
			mode TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			analysis_date TEXT NOT NULL DEFAULT '',
			primary_theme TEXT NOT NULL DEFAULT '',
			secondary_theme TEXT NOT NULL DEFAULT '',
			overall_conviction TEXT NOT NULL DEFAULT '',
			executive_summary TEXT NOT NULL DEFAULT '',
			analyst_memo_markdown TEXT NOT NULL DEFAULT '',
			chairman_memo_markdown TEXT NOT NULL DEFAULT '',
			asset_class_targets_json TEXT NOT NULL DEFAULT '[]',
			raw_result_json TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

CREATE TABLE portfolio_mix_snapshot_rows (
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

CREATE TABLE portfolio_mix_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		status TEXT NOT NULL DEFAULT 'APPROVED' CHECK(status IN ('APPROVED','SUPERSEDED')),
		reason TEXT DEFAULT 'DISCRETIONARY',
		source_rebalance_plan_id INTEGER,
		notes TEXT,
		approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE portfolio_rebalance_plan_rows (
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

CREATE TABLE portfolio_rebalance_plans (
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

CREATE TABLE q4_crisis_state (
		id INTEGER PRIMARY KEY CHECK(id = 1),
		active BOOLEAN NOT NULL DEFAULT 0,
		last_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_acknowledged_at DATETIME,
		reason TEXT DEFAULT '',
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE regime_proposed_actions (
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

CREATE TABLE regimes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		signal TEXT CHECK(signal IN ('BUY','SELL')) NOT NULL,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE security_actions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			alert_id INTEGER NOT NULL UNIQUE,
			ticker TEXT NOT NULL,
			scope TEXT NOT NULL DEFAULT 'SECURITY' CHECK(scope IN ('SECURITY', 'ASSET_CLASS', 'PORTFOLIO')),
			asset_class_code TEXT NOT NULL DEFAULT '',
			affected_tickers_json TEXT NOT NULL DEFAULT '[]',
			source_event_key TEXT UNIQUE,
			intent TEXT NOT NULL CHECK(intent IN ('DEPLOY', 'REDUCE', 'EXIT', 'REVIEW')),
			instruction_basis TEXT NOT NULL DEFAULT 'NONE',
			instruction TEXT NOT NULL DEFAULT '',
			priority INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'BLOCKED', 'AWAITING_STATEMENT', 'CONFIRMED', 'VARIANCE', 'IGNORED', 'EXPIRED', 'OVERRIDDEN', 'NOT_APPLICABLE')),
			blocked_by_action_id INTEGER,
			holding_quantity_snapshot REAL NOT NULL DEFAULT 0,
			holding_value_snapshot REAL NOT NULL DEFAULT 0,
			holding_price_snapshot REAL NOT NULL DEFAULT 0,
			policy_version TEXT NOT NULL DEFAULT 'security-action-v1',
			deployment_state TEXT NOT NULL DEFAULT '',
			deployment_policy_version TEXT NOT NULL DEFAULT '',
			instruction_value REAL NOT NULL DEFAULT 0,
			target_value REAL NOT NULL DEFAULT 0,
			target_shortfall_value REAL NOT NULL DEFAULT 0,
			class_funding_before REAL NOT NULL DEFAULT 0,
			class_funding_after REAL NOT NULL DEFAULT 0,
			execution_reported_at DATETIME,
			execution_sync_id INTEGER,
			execution_note TEXT,
			override_reason TEXT,
			next_review_at DATETIME,
			reconciled_statement_id INTEGER,
			reconciled_at DATETIME,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, execution_units REAL, execution_cash_value REAL, execution_exception_reason TEXT NOT NULL DEFAULT '', execution_policy_snapshot TEXT NOT NULL DEFAULT '', execution_snapshot_json TEXT NOT NULL DEFAULT '[]', reconciliation_method TEXT NOT NULL DEFAULT '',
			FOREIGN KEY(alert_id) REFERENCES alerts(id),
			FOREIGN KEY(blocked_by_action_id) REFERENCES security_actions(id),
			FOREIGN KEY(reconciled_statement_id) REFERENCES account_statements(id)
		);

CREATE TABLE security_identities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			isin TEXT,
			exchange_prefix TEXT NOT NULL DEFAULT '',
			ticker TEXT NOT NULL DEFAULT '',
			canonical_name TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE security_name_aliases (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			security_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'backfill',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(security_id, normalized_name),
			FOREIGN KEY (security_id) REFERENCES security_identities(id) ON DELETE CASCADE
		);

CREATE TABLE security_position_snapshots (
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

CREATE TABLE security_positions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticker TEXT NOT NULL UNIQUE,
		position_state TEXT CHECK(position_state IN ('BUY','SELL')) NOT NULL,
		manual_override BOOLEAN DEFAULT 0,
		entry_date DATETIME,
		stopped_waiting_reentry BOOLEAN DEFAULT 0,
		last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	, risk_profile TEXT CHECK(risk_profile IN ('RISK_ON','RISK_OFF')));

CREATE TABLE security_price_daily (
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

CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

CREATE TABLE statement_holdings (
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP, security_id INTEGER,
		FOREIGN KEY (statement_id) REFERENCES account_statements(id) ON DELETE CASCADE
	);

CREATE TABLE stock_analysis (
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP, current_price REAL DEFAULT 0, deer_flow_quality REAL DEFAULT 0, deer_flow_value REAL DEFAULT 0, perplexity_quality REAL DEFAULT 0, perplexity_value REAL DEFAULT 0, claude_quality REAL DEFAULT 0, claude_value REAL DEFAULT 0, council_quality REAL DEFAULT 0, council_value REAL DEFAULT 0, deer_flow_pt REAL DEFAULT 0, perplexity_pt REAL DEFAULT 0, claude_pt REAL DEFAULT 0, council_pt REAL DEFAULT 0, thesis TEXT, bear_case_pt REAL DEFAULT 0, base_case_pt REAL DEFAULT 0, bull_case_pt REAL DEFAULT 0, bear_probability REAL DEFAULT 0, base_probability REAL DEFAULT 0, bull_probability REAL DEFAULT 0, catalysts TEXT, last_contributed_at DATETIME, is_external BOOLEAN DEFAULT FALSE, security_id INTEGER, asset_class_source TEXT, asset_class_set_at DATETIME,
		UNIQUE(ticker, name)
	);

CREATE TABLE stock_group_assignments (
		company_name TEXT PRIMARY KEY,
		group_id TEXT NOT NULL,
		assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP, security_id INTEGER,
		FOREIGN KEY (group_id) REFERENCES stock_groups(id) ON DELETE CASCADE
	);

CREATE TABLE stock_groups (
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

CREATE TABLE sync_changes (
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

CREATE TABLE sync_history (
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

CREATE TABLE webhook_dead_letters (
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

CREATE INDEX idx_active_alerts_script ON active_alerts(script);

CREATE INDEX idx_active_alerts_ticker ON active_alerts(ticker);

CREATE INDEX idx_asset_class_config_active ON asset_class_config(active);

CREATE INDEX idx_asset_class_config_display_order ON asset_class_config(display_order);

CREATE INDEX idx_asset_class_config_kind ON asset_class_config(kind);

CREATE INDEX idx_asset_class_config_parent ON asset_class_config(parent_code);

CREATE INDEX idx_asset_class_daily_snapshots_class ON asset_class_daily_snapshots(asset_class, observed_at);

CREATE INDEX idx_asset_class_daily_snapshots_observed ON asset_class_daily_snapshots(observed_at);

CREATE INDEX idx_asset_class_etf_policies_security
			ON asset_class_etf_policies(core_security_id);

CREATE INDEX idx_asset_classes_active ON asset_classes(active, display_order);

CREATE INDEX idx_cash_movements_asset_class ON cash_movements(asset_class_code, created_at DESC);

CREATE INDEX idx_cash_movements_status ON cash_movements(status, created_at DESC);

CREATE INDEX idx_commodity_price_daily_source_date
			ON commodity_price_daily(source_symbol, observed_date DESC);

CREATE INDEX idx_commodity_theme_events_security
			ON commodity_theme_events(theme_code, stage_key, security_id, bar_closed_at DESC, id DESC);

CREATE INDEX idx_commodity_theme_events_stage
			ON commodity_theme_events(theme_code, stage_key, scope, bar_closed_at DESC, id DESC);

CREATE INDEX idx_company_mappings_name ON company_mappings(company_name);

CREATE INDEX idx_company_mappings_security_identity ON company_mappings(security_id);

CREATE UNIQUE INDEX idx_data_refresh_runs_active
			ON data_refresh_runs(dataset) WHERE status = 'RUNNING';

CREATE INDEX idx_data_refresh_runs_dataset
			ON data_refresh_runs(dataset, started_at DESC, id DESC);

CREATE INDEX idx_equity_sizing_history_source ON equity_sizing_history(source_ticker);

CREATE INDEX idx_etf_allocations_ticker ON etf_allocations(ticker);

CREATE INDEX idx_etf_executions_rebalance ON etf_executions(rebalance_id);

CREATE INDEX idx_etf_executions_ticker ON etf_executions(ticker);

CREATE INDEX idx_etf_momentum_run_rows_run_rank
			ON etf_momentum_run_rows(run_id, rank_value, display_ticker);

CREATE INDEX idx_etf_momentum_runs_lookup
			ON etf_momentum_runs(universe_code, algorithm_version, as_of_date, id DESC);

CREATE INDEX idx_etf_momentum_tradingview_snapshots_latest
			ON etf_momentum_tradingview_snapshots(universe_code, as_of_date DESC, id DESC);

CREATE INDEX idx_etf_momentum_universe_active
			ON etf_momentum_universe_members(universe_code, active, display_order);

CREATE INDEX idx_etf_positions_ticker ON etf_positions(ticker);

CREATE INDEX idx_etf_rebalance_sequence ON etf_rebalance_targets(sequence_number);

CREATE INDEX idx_etf_rebalance_status ON etf_rebalance_targets(status);

CREATE INDEX idx_etf_rebalance_ticker ON etf_rebalance_targets(ticker);

CREATE INDEX idx_holdings_active ON holdings(is_active);

CREATE UNIQUE INDEX idx_holdings_isin_active ON holdings(isin) WHERE isin IS NOT NULL AND is_active = 1;

CREATE INDEX idx_holdings_security_identity ON holdings(security_id);

CREATE INDEX idx_holdings_ticker ON holdings(ticker);

CREATE INDEX idx_news_daily_jobs_status
			ON news_daily_jobs(status, created_at DESC);

CREATE INDEX idx_news_foundation_candidates_memo
			ON news_foundation_candidates(memo_job_id, updated_at DESC);

CREATE UNIQUE INDEX idx_news_foundation_candidates_memo_slug
			ON news_foundation_candidates(memo_job_id, title, timeframe);

CREATE INDEX idx_news_foundation_clusters_memo
			ON news_foundation_clusters(memo_job_id, timeframe, canonical_key);

CREATE INDEX idx_news_foundation_cohort_theses_cohort
			ON news_foundation_cohort_theses(cohort_id);

CREATE INDEX idx_news_foundation_cohorts_status
			ON news_foundation_cohorts(status, updated_at DESC);

CREATE INDEX idx_news_foundation_jobs_status
			ON news_foundation_jobs(status, created_at DESC);

CREATE INDEX idx_news_foundation_research_tasks_memo
			ON news_foundation_research_tasks(memo_job_id, priority, id);

CREATE INDEX idx_news_items_run ON news_items(run_id);

CREATE INDEX idx_news_items_timeframe ON news_items(timeframe, impact_score DESC);

CREATE INDEX idx_news_runs_date ON news_runs(run_date DESC, created_at DESC);

CREATE INDEX idx_news_runs_mode ON news_runs(mode, status, created_at DESC);

CREATE INDEX idx_news_theses_invalidation ON news_theses(invalidation_check_due_at) WHERE invalidation_check_due_at IS NOT NULL;

CREATE INDEX idx_news_theses_status_timeframe ON news_theses(status, timeframe, last_updated_at DESC);

CREATE INDEX idx_news_thesis_conviction_history_thesis ON news_thesis_conviction_history(thesis_id, recorded_at ASC);

CREATE UNIQUE INDEX idx_news_thesis_conviction_history_thesis_run ON news_thesis_conviction_history(thesis_id, run_id);

CREATE INDEX idx_news_thesis_updates_run ON news_thesis_updates(run_id);

CREATE INDEX idx_news_thesis_updates_thesis ON news_thesis_updates(thesis_id, created_at DESC);

CREATE INDEX idx_overlay_events_status ON overlay_events(status, triggered_at DESC);

CREATE UNIQUE INDEX idx_overlay_stage1_state_active ON overlay_stage1_state(active) WHERE active = 1;

CREATE INDEX idx_portfolio_daily_snapshots_observed ON portfolio_daily_snapshots(observed_at);

CREATE INDEX idx_portfolio_memo_runs_updated
			ON portfolio_memo_runs(updated_at DESC, id DESC);

CREATE INDEX idx_portfolio_mix_snapshots_status ON portfolio_mix_snapshots(status, approved_at DESC);

CREATE INDEX idx_portfolio_rebalance_plans_status ON portfolio_rebalance_plans(status, created_at DESC);

CREATE INDEX idx_regime_proposed_pending ON regime_proposed_actions(applied_at, dismissed_at, created_at DESC);

CREATE INDEX idx_regime_return_snapshots_created
			ON regime_return_snapshots(created_at DESC, id DESC);

CREATE INDEX idx_regimes_ticker ON regimes(ticker);

CREATE INDEX idx_security_actions_alert ON security_actions(alert_id);

CREATE INDEX idx_security_actions_asset_class
			ON security_actions(asset_class_code, status, priority, created_at, id)
	;

CREATE INDEX idx_security_actions_queue
			ON security_actions(ticker, status, priority, created_at, id);

CREATE UNIQUE INDEX idx_security_actions_source_event ON security_actions(source_event_key);

CREATE UNIQUE INDEX idx_security_identities_exchange_ticker
			ON security_identities(exchange_prefix, ticker)
			WHERE ticker != '';

CREATE UNIQUE INDEX idx_security_identities_isin
			ON security_identities(UPPER(TRIM(isin)))
			WHERE TRIM(COALESCE(isin, '')) != '';

CREATE INDEX idx_security_listing_reviews_open
			ON security_listing_reviews(status, last_seen_at DESC);

CREATE INDEX idx_security_name_aliases_name
			ON security_name_aliases(normalized_name);

CREATE INDEX idx_security_position_snapshots_observed ON security_position_snapshots(observed_at);

CREATE INDEX idx_security_position_snapshots_ticker ON security_position_snapshots(ticker, observed_at);

CREATE INDEX idx_security_positions_ticker ON security_positions(ticker);

CREATE INDEX idx_security_price_daily_ticker_date ON security_price_daily(ticker, exchange_prefix, observed_date);

CREATE INDEX idx_statement_holdings_security_identity ON statement_holdings(security_id);

CREATE INDEX idx_stock_analysis_asset_class_source
			ON stock_analysis(asset_class_source)
	;

CREATE INDEX idx_stock_analysis_security_identity ON stock_analysis(security_id);

CREATE INDEX idx_stock_analysis_ticker ON stock_analysis(ticker);

CREATE INDEX idx_stock_group_assignments_group ON stock_group_assignments(group_id);

CREATE INDEX idx_stock_group_assignments_security_identity ON stock_group_assignments(security_id);

CREATE INDEX idx_stock_groups_asset_class_code ON stock_groups(asset_class_code);

CREATE INDEX idx_sync_changes_acknowledged ON sync_changes(acknowledged);

CREATE INDEX idx_sync_changes_sync_id ON sync_changes(sync_id);

CREATE INDEX idx_webhook_dead_letters_unresolved ON webhook_dead_letters(resolved_at, created_at DESC);

CREATE INDEX webhook_inbox_cleanup ON webhook_inbox(status,completed_at);

CREATE INDEX webhook_inbox_hash ON webhook_inbox(webhook_name,payload_hash,received_at);

CREATE INDEX webhook_inbox_pending ON webhook_inbox(status,id);

CREATE INDEX webhook_inbox_stream ON webhook_inbox(stream_key,event_time,status);

