# Data Model

Schema ownership updated against source: 12 September 2026. Individual table descriptions retain their earlier audit scope.

Alpha Edge uses SQLite. Startup now applies the
[versioned runner](../../backend/internal/database/migrate.go), with a
[generated, frozen baseline](../../backend/internal/database/migrations/0001_baseline.sql)
for the 76 application tables and indexes. That SQL is the exact baseline
reference; the hand-maintained table descriptions below explain domain purpose
and may contain older excerpts. The old Go bootstrap is retained for isolated
legacy tests, not production startup. Defaults only seed new databases.
Feature schema helpers do not rerun legacy DDL/backfills on managed databases.

The new `terminal_schema_migrations` ledger records version, name, content
checksum, application time and pre-upgrade backup path/hash. The historical
`schema_migrations` table found on UAT belongs to an absent earlier runner and
remains untouched. Adoption, supported older layouts, backup and isolated
recovery are defined in [Database upgrades and recovery](../operations/DATABASE_UPGRADES_AND_RECOVERY.md).

## Database Role

The database owns:

- broker statement truth
- current holdings
- ticker/company mapping
- analysis and asset-class classification
- alert history and active TradingView alert registrations
- per-security and ETF position state
- Q3/Q4 detector state
- Q3/Q4 action workflow state
- portfolio baseline and rebalance plans
- ETF rebalance targets
- sync history and import deltas

The frontend must render this state. It should not invent portfolio-risk state, Q3/Q4 state, portfolio target state, or action workflow state in the UI layer.

## Table Groups

| Group | Tables |
| --- | --- |
| Statements and holdings | `account_statements`, `statement_holdings`, `holdings`, `sync_history`, `sync_changes` |
| Analysis and classification | `stock_analysis`, `company_mappings`, `stock_groups`, `stock_group_assignments`, `asset_class_config` |
| News narrative | `news_runs`, `news_items`, `news_theses`, `news_thesis_updates` |
| Alerts and decisions | `alerts`, `decisions`, `active_alerts` |
| Position state | `security_positions`, `etf_positions`, `etf_allocations`, `etf_rebalance_targets`, `etf_executions` |
| Regime and portfolio risk | `regimes`, `equity_sizing`, `equity_sizing_history`, `q4_crisis_state`, `overlay_signal_state`, `overlay_events`, `overlay_event_classes`, `overlay_stage1_sources`, `overlay_stage1_state`, `overlay_stage1_state_classes` |
| Portfolio shape | `portfolio_mix_snapshots`, `portfolio_mix_snapshot_rows`, `portfolio_rebalance_plans`, `portfolio_rebalance_plan_rows` |
| App configuration | `settings` |
| Schema versioning | `terminal_schema_migrations`; historical `schema_migrations` retained where present |

## Critical State Ownership

| State | Source table | Notes |
| --- | --- | --- |
| Current broker/account snapshot | `account_statements`, `statement_holdings` | Imported external truth. Used for statement validation and portfolio totals. |
| Current live holdings | `holdings` | Current app view of positions. Rebuilt from statement import/sync paths. |
| Asset-class configuration | `asset_class_config` | Source of truth for active asset-class metadata, tactical cash reserve, and direct-stock sleeve ratio. |
| Security deployment state | `security_positions` | Plain CDF BUY/SELL updates this table. TMS stop also writes SELL and `stopped_waiting_reentry`. |
| Alert history | `alerts` | Stores actionable alert rows and mapping issues. Plain CDF state sync currently does not always create an alert row. |
| Active TradingView connections | `active_alerts` | Tracks expected running TradingView alert setup by ticker/script, including connection-only commodity and stock-relative Outperform CDF feeds. |
| Generic regime state | `regimes` | BUY/SELL by raw regime ticker. Separate from Q3/Q4 portfolio-risk detector state. |
| Q3 detector state | `equity_sizing` and `equity_sizing_history` | Current and historical `target_equity_pct` by source ticker. Preferred S&P ticker is `SPX`; legacy `SPY` is still compatible. |
| Q4 crisis state | `q4_crisis_state` plus `equity_sizing.Q4D` | Q4D BUY/SELL has no percentage payload. Backend maps SELL to 10 and BUY to 100. |
| Last applied Q3/Q4 workflow state | `overlay_signal_state` | Singleton row. Tracks current detector percentage versus last applied workflow percentage. |
| Active/past Q3/Q4 action event | `overlay_events` | Parent workflow event. Contains status, required reduction, recorded reduction, reserve confirmation, and completion fields. |
| Q3/Q4 event asset-class rows | `overlay_event_classes` | Per-asset-class trigger and target values for one overlay event. |
| Q3/Q4 recorded holding reductions | `overlay_stage1_sources` | Per-holding recorded action rows used for statement reconciliation. |
| Approved portfolio baseline | `portfolio_mix_snapshots`, `portfolio_mix_snapshot_rows` | Baseline strategic shape. Usually one `APPROVED` snapshot; old ones are `SUPERSEDED`. |
| Draft/current portfolio target | `portfolio_rebalance_plans`, `portfolio_rebalance_plan_rows` | Manual or AI-assisted target workflow. Separate from Q3/Q4 detector state. |
| Macro news narrative state | `news_runs`, `news_items`, `news_theses`, `news_thesis_updates`, `news_foundation_jobs`, `news_foundation_cohorts`, `news_foundation_cohort_theses` | Persisted daily macro brief, market context, active foundation cohort, visible theses, and evidence updates. |

## Status And Enum Contracts

These values are enforced either by SQLite `CHECK` constraints or backend logic.

| Field | Values |
| --- | --- |
| `security_positions.position_state` | `BUY`, `SELL` |
| `alerts.source` | `cdf`, `tms`, `etf_tms`, `ctf`, `q4d`, `q3d`, `unknown` |
| `decisions.decision` | `BUY`, `SELL`, `SELL_DOWN`, `SELL_50`, `ADD`, `TRIM`, `IGNORE`, `REBALANCE_DISMISS`, `CASH_ALLOCATION` in the live DB; older schema snippets may omit newer values |
| `active_alerts.script` | `cdf`, `tms`, `etf_tms`, `ctf`, `q4d`, `q3d`, `etf_rebalancing` |
| `regimes.signal` | `BUY`, `SELL` |
| `equity_sizing.source_ticker` | Common current rows: `SPX`, legacy `SPY`, `XAO`, `Q4D` |
| `overlay_events.status` | `PENDING`, `PARTIAL`, `STAGE1_DONE`, `STAGE2_DONE`, `BASELINED`, `SUPERSEDED`, `CANCELLED` |
| `portfolio_mix_snapshots.status` | `APPROVED`, `SUPERSEDED` |
| `portfolio_rebalance_plans.status` | `OPEN`, `PARTIAL`, `COMPLETED`, `APPROVED`, `CANCELLED`, `SUPERSEDED` |
| `etf_positions.position_state` | `BUY`, `SELL` |
| `etf_allocations.tactical_status` | `BUY`, `SELL` |
| `etf_rebalance_targets.status` | `PENDING`, `PARTIAL`, `COMPLETE`, `SUPERSEDED`, `CANCELLED` |
| `sync_history.sync_status` | `success`, `failed`, `partial` |
| `sync_changes.change_type` | `ADDED`, `UPDATED`, `REMOVED` |

## Core Tables

### `account_statements`

Broker/account-level snapshots. This table is the parent for imported statement holdings.

Columns:

```text
id INTEGER
account_name TEXT NOT NULL
statement_date DATETIME NOT NULL
total_value_aud REAL NOT NULL
cash_aud REAL NOT NULL
usd_value REAL DEFAULT 0
usd_aud REAL DEFAULT 0
gbp_value REAL DEFAULT 0
gbp_aud REAL DEFAULT 0
aud_value REAL DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `(account_name, statement_date)` is unique. A matching import replaces prior holdings for that statement.

### `statement_holdings`

Position rows attached to a broker/account statement.

Columns:

```text
id INTEGER
statement_id INTEGER NOT NULL
details TEXT NOT NULL
quantity REAL NOT NULL
cost_aud REAL NOT NULL
current_price REAL NOT NULL
value_aud REAL NOT NULL
gain_loss_aud REAL NOT NULL
gain_loss_pct REAL NOT NULL
currency TEXT NOT NULL DEFAULT 'AUD'
market_value REAL NOT NULL
cash_reserve REAL DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: rows are deleted when their parent statement is deleted. Statement import is the external evidence used by action workflows.

### `holdings`

Current app-level holding rows used by portfolio, positions, and actions surfaces.

Columns:

```text
id INTEGER
isin TEXT
ticker TEXT
company_name TEXT NOT NULL
exchange_prefix TEXT NOT NULL DEFAULT 'ASX:'
quantity REAL NOT NULL DEFAULT 0
cost_aud REAL NOT NULL DEFAULT 0
current_price REAL NOT NULL DEFAULT 0
value_aud REAL NOT NULL DEFAULT 0
gain_loss_aud REAL NOT NULL DEFAULT 0
gain_loss_pct REAL NOT NULL DEFAULT 0
currency TEXT NOT NULL DEFAULT 'AUD'
market_value REAL NOT NULL DEFAULT 0
cash_reserve REAL DEFAULT 0
is_active BOOLEAN DEFAULT 1
last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: live holdings are unique by `(company_name, is_active)`. Active ISIN rows are also unique where ISIN exists.

### `stock_analysis`

Analysis, valuation, classification, thesis, and watchlist metadata.

Columns:

```text
id INTEGER
ticker TEXT
name TEXT NOT NULL
grok_quality REAL DEFAULT 0
grok_value REAL DEFAULT 0
gemini_quality REAL DEFAULT 0
gemini_value REAL DEFAULT 0
grok_pt REAL DEFAULT 0
gemini_pt REAL DEFAULT 0
tipranks_pt REAL DEFAULT 0
analyst_pt REAL DEFAULT 0
upside_24m REAL DEFAULT 0
allocation REAL DEFAULT 0
market_cap TEXT
risk_profile TEXT
notes TEXT
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
gpt_quality REAL DEFAULT 0
gpt_value REAL DEFAULT 0
gpt_pt REAL DEFAULT 0
current_price REAL DEFAULT 0
deer_flow_quality REAL DEFAULT 0
deer_flow_value REAL DEFAULT 0
manus_quality REAL DEFAULT 0
manus_value REAL DEFAULT 0
perplexity_quality REAL DEFAULT 0
perplexity_value REAL DEFAULT 0
claude_quality REAL DEFAULT 0
claude_value REAL DEFAULT 0
council_quality REAL DEFAULT 0
council_value REAL DEFAULT 0
deer_flow_pt REAL DEFAULT 0
manus_pt REAL DEFAULT 0
perplexity_pt REAL DEFAULT 0
claude_pt REAL DEFAULT 0
council_pt REAL DEFAULT 0
council_run_id TEXT
council_run_label TEXT
primary_asset_class TEXT DEFAULT ''
security_type TEXT DEFAULT 'STOCK'
overlay_sell_priority INTEGER DEFAULT 3
thesis TEXT
bear_case_pt REAL DEFAULT 0
base_case_pt REAL DEFAULT 0
bull_case_pt REAL DEFAULT 0
bear_probability REAL DEFAULT 0
base_probability REAL DEFAULT 0
bull_probability REAL DEFAULT 0
catalysts TEXT
last_contributed_at DATETIME
is_watchlist BOOLEAN DEFAULT FALSE
is_external BOOLEAN DEFAULT FALSE
security_id INTEGER
```

Invariant: `(ticker, name)` is unique. `primary_asset_class` is a major input into asset-class grouping and overlay behaviour.

Non-allocating instruments: `security_type = CVR` is reserved for contingent
value rights. `security_type = NON_ALLOCATING` covers manually classified
options, rights, warrants, merger records, and other broker artifacts that are
not deliberate investments. Both may remain visible in statements for record
keeping, but they must have `primary_asset_class = NULL`, `allocation = 0`,
and `include_in_sizing = FALSE`.
They are excluded from asset-class snapshots, portfolio mix, Q3/Q4 overlay
calculations, AI target packets, performance refresh, alert setup, and rebalance
workflows. They are not `MISC` sleeve items because they are not deliberately
allocatable portfolio capital. `include_in_sizing` must not be used as a
substitute: that field controls candidate-universe participation for otherwise
valid securities.

`security_id` links the row to the stable instrument identity. Provider observations
must not modify `ticker`, `name`, or this link. Listing verification evidence is
stored separately in `security_listing_checks` and `security_listing_reviews`;
see [Watchlist Identity And Listing Verification v1.0](WATCHLIST_IDENTITY_VERIFICATION_V1.md).

### `company_mappings`

Ticker/company name mapping used by webhook ingestion and UI matching.

Columns:

```text
id INTEGER
company_name TEXT NOT NULL
ticker TEXT NOT NULL
exchange_prefix TEXT NOT NULL DEFAULT 'ASX:'
enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
template_id TEXT
```

Invariant: `company_name` is unique. Missing mappings create unmapped-alert workflow risk.

### `news_runs`

One row per macro narrative run. `mode = BOOTSTRAP` is the first foundation
pass that builds the 12-month thesis map. `mode = DAILY` is a routine update
that tests fresh evidence against the current thesis ledger.

Columns:

```text
id INTEGER
run_date DATE NOT NULL
mode TEXT NOT NULL DEFAULT 'DAILY'
status TEXT NOT NULL DEFAULT 'COMPLETED'
model TEXT NOT NULL DEFAULT ''
source_type TEXT NOT NULL DEFAULT ''
source_id TEXT NOT NULL DEFAULT ''
foundation_cohort_id INTEGER NOT NULL DEFAULT 0
daily_summary TEXT NOT NULL DEFAULT ''
market_context_json TEXT NOT NULL DEFAULT '{}'
raw_response_json TEXT NOT NULL DEFAULT '{}'
error_message TEXT NOT NULL DEFAULT ''
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `news_items`

Market-moving news items attached to one `news_runs` row.

Columns:

```text
id INTEGER
run_id INTEGER NOT NULL
headline TEXT NOT NULL
summary TEXT NOT NULL DEFAULT ''
timeframe TEXT NOT NULL DEFAULT '1D'
impact_score REAL NOT NULL DEFAULT 0
sources_json TEXT NOT NULL DEFAULT '[]'
asset_classes_json TEXT NOT NULL DEFAULT '[]'
tags_json TEXT NOT NULL DEFAULT '[]'
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `news_theses`

Persistent macro theses tracked across multiple news runs.

Columns:

```text
id INTEGER
slug TEXT NOT NULL UNIQUE
title TEXT NOT NULL
timeframe TEXT NOT NULL
status TEXT NOT NULL DEFAULT 'ACTIVE'
conviction REAL NOT NULL DEFAULT 0.5
summary TEXT NOT NULL DEFAULT ''
asset_classes_json TEXT NOT NULL DEFAULT '[]'
tags_json TEXT NOT NULL DEFAULT '[]'
source_type TEXT NOT NULL DEFAULT ''
source_id TEXT NOT NULL DEFAULT ''
foundation_cohort_id INTEGER NOT NULL DEFAULT 0
source_excerpt TEXT NOT NULL DEFAULT ''
supporting_evidence TEXT NOT NULL DEFAULT ''
opposing_evidence TEXT NOT NULL DEFAULT ''
invalidation_trigger TEXT NOT NULL DEFAULT ''
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
resolved_at DATETIME
```

`source_type/source_id/source_excerpt` preserve where a foundation thesis came
from. For memo-seeded foundation runs this is usually
`PORTFOLIO_MEMO / portfolio_memo_runs.memo_job_id`. Supporting, opposing, and
invalidation fields preserve the validation result so the ledger can explain
why a thesis exists and what would weaken it.

`foundation_cohort_id` is set for theses promoted by a foundation job. Daily
updates keep the same cohort ID when they modify an existing foundation thesis.
Daily-created theses may have `foundation_cohort_id = 0`.

### `news_foundation_candidates`

Structured thesis candidates extracted from a saved portfolio memo before the
web-validation pass.

Columns:

```text
id INTEGER
memo_job_id TEXT NOT NULL
title TEXT NOT NULL
timeframe TEXT NOT NULL
claim TEXT NOT NULL DEFAULT ''
reasoning TEXT NOT NULL DEFAULT ''
source_section TEXT NOT NULL DEFAULT ''
source_excerpt TEXT NOT NULL DEFAULT ''
status TEXT NOT NULL DEFAULT 'ACTIVE'
conviction REAL NOT NULL DEFAULT 0
supporting_evidence TEXT NOT NULL DEFAULT ''
opposing_evidence TEXT NOT NULL DEFAULT ''
invalidation_trigger TEXT NOT NULL DEFAULT ''
sources_json TEXT NOT NULL DEFAULT '[]'
asset_classes_json TEXT NOT NULL DEFAULT '[]'
tags_json TEXT NOT NULL DEFAULT '[]'
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: candidates are unique per `(memo_job_id, title, timeframe)` and
their `asset_classes_json` values must resolve through the canonical
`asset_classes` table or the bootstrap asset-class registry fallback.

### `news_foundation_research_tasks`

Audit trail for the research plan used by a memo-seeded foundation run. These
rows are not the visible ledger; they explain what the backend asked the web
validation pass to cover.

Columns:

```text
id INTEGER
memo_job_id TEXT NOT NULL
lane TEXT NOT NULL
timeframe TEXT NOT NULL DEFAULT '1Y'
query TEXT NOT NULL DEFAULT ''
priority INTEGER NOT NULL DEFAULT 0
asset_classes_json TEXT NOT NULL DEFAULT '[]'
tags_json TEXT NOT NULL DEFAULT '[]'
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Default lanes include macro cycle, commodities and energy, geopolitics and
defence, technology and AI, regional growth, candidate-specific memo priors,
and asset-class lanes derived from memo candidates or portfolio targets.

### `news_foundation_clusters`

Audit trail for backend canonical clustering after web validation. This table
records which semantically similar thesis titles were merged before quality
assessment and promotion.

Columns:

```text
id INTEGER
memo_job_id TEXT NOT NULL
canonical_key TEXT NOT NULL
timeframe TEXT NOT NULL DEFAULT '1Y'
title TEXT NOT NULL DEFAULT ''
absorbed_titles_json TEXT NOT NULL DEFAULT '[]'
asset_classes_json TEXT NOT NULL DEFAULT '[]'
tags_json TEXT NOT NULL DEFAULT '[]'
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: rows are unique per `(memo_job_id, canonical_key, timeframe)`.
Asset-class membership alone must not create a cluster. The cluster key is based
on thesis wording, evidence, and tags, so two unrelated theses in the same asset
class remain separate.

### `news_foundation_jobs`

Durable state for a foundation run. This lets the UI show progress and protects
the current ledger from half-finished or failed model calls.

Columns:

```text
id TEXT PRIMARY KEY
status TEXT NOT NULL DEFAULT 'QUEUED'
stage TEXT NOT NULL DEFAULT 'queued'
stage_message TEXT NOT NULL DEFAULT ''
progress_pct INTEGER NOT NULL DEFAULT 0
mode TEXT NOT NULL DEFAULT 'BOOTSTRAP'
source_type TEXT NOT NULL DEFAULT ''
source_id TEXT NOT NULL DEFAULT ''
source_memo_job_id TEXT NOT NULL DEFAULT ''
foundation_cohort_id INTEGER NOT NULL DEFAULT 0
run_id INTEGER NOT NULL DEFAULT 0
model TEXT NOT NULL DEFAULT ''
quality_score REAL NOT NULL DEFAULT 0
thesis_count INTEGER NOT NULL DEFAULT 0
candidate_count INTEGER NOT NULL DEFAULT 0
error_message TEXT NOT NULL DEFAULT ''
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
started_at DATETIME
finished_at DATETIME
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Terminal statuses:

```text
SUCCEEDED
FAILED
```

Only `SUCCEEDED` jobs promote a new active foundation cohort.

### `news_foundation_cohorts`

One promoted foundation ledger snapshot. The active cohort is the current
foundation base used by the News tab.

Columns:

```text
id INTEGER PRIMARY KEY
status TEXT NOT NULL DEFAULT 'BUILDING'
source_type TEXT NOT NULL DEFAULT ''
source_id TEXT NOT NULL DEFAULT ''
source_memo_job_id TEXT NOT NULL DEFAULT ''
run_id INTEGER NOT NULL DEFAULT 0
model TEXT NOT NULL DEFAULT ''
quality_score REAL NOT NULL DEFAULT 0
thesis_count INTEGER NOT NULL DEFAULT 0
candidate_count INTEGER NOT NULL DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
activated_at DATETIME
superseded_at DATETIME
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Status meanings:

```text
BUILDING    created but not yet visible as the user's foundation
ACTIVE      current foundation base
SUPERSEDED  replaced by a later successful cohort
FAILED      failed after creation and never became active
```

### `news_foundation_cohort_theses`

Snapshot of the exact theses promoted into a foundation cohort. This is separate
from the mutable `news_theses` table so the system can audit what the foundation
job originally produced.

Columns:

```text
id INTEGER PRIMARY KEY
cohort_id INTEGER NOT NULL
slug TEXT NOT NULL
title TEXT NOT NULL
timeframe TEXT NOT NULL
status TEXT NOT NULL DEFAULT 'ACTIVE'
relationship TEXT NOT NULL DEFAULT 'MODIFIES'
conviction REAL NOT NULL DEFAULT 0
conviction_delta REAL NOT NULL DEFAULT 0
summary TEXT NOT NULL DEFAULT ''
evidence TEXT NOT NULL DEFAULT ''
supporting_evidence TEXT NOT NULL DEFAULT ''
opposing_evidence TEXT NOT NULL DEFAULT ''
invalidation_trigger TEXT NOT NULL DEFAULT ''
source_excerpt TEXT NOT NULL DEFAULT ''
sources_json TEXT NOT NULL DEFAULT '[]'
asset_classes_json TEXT NOT NULL DEFAULT '[]'
tags_json TEXT NOT NULL DEFAULT '[]'
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `(cohort_id, slug)` is unique.

### `news_thesis_updates`

Evidence rows linking one daily run to one persistent thesis.

Columns:

```text
id INTEGER
thesis_id INTEGER NOT NULL
run_id INTEGER NOT NULL
relationship TEXT NOT NULL DEFAULT 'MODIFIES'
evidence TEXT NOT NULL DEFAULT ''
conviction_delta REAL NOT NULL DEFAULT 0
sources_json TEXT NOT NULL DEFAULT '[]'
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Allowed timeframes are `1D`, `1W`, `1M`, `6M`, and `1Y`. Allowed thesis
statuses are `ACTIVE`, `WATCH`, `RESOLVED`, and `REJECTED`. Allowed
relationships are `NEW`, `SUPPORTS`, `CHALLENGES`, `MODIFIES`, `CONFIRMS`,
and `RESOLVES`.

### `alerts`

Alert history and active actionable alert rows.

Columns:

```text
id INTEGER
ticker TEXT NOT NULL
alert_type TEXT NOT NULL
strength TEXT
expiry_date DATETIME
exchange_prefix TEXT DEFAULT 'ASX:'
timeframe TEXT
source TEXT
affected_positions TEXT
alert_price REAL
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
is_active BOOLEAN DEFAULT 1
resolved_at DATETIME
resolved_reason TEXT
resolved_note TEXT
needs_mapping BOOLEAN DEFAULT 0
```

Notes:

- `affected_positions` is JSON text for regime/generic impact payloads.
- `needs_mapping = 1` means the alert could not be matched cleanly to a known company/security.
- `resolved_reason` records alert lifecycle outcome such as `BUY`, `TRIM`, `IGNORE`, `EXPIRED`, or `DISMISSED`.
- `EXPIRED` is a system resolution; it is not written to `decisions` as a user `IGNORE`.
- Plain CDF BUY/SELL is state sync. `cdf_sell_zone` normalises internally to `SELL_DOWN` and has target user-facing copy `Sell Down 20%`. TMS stop alerts with embedded CDF BUY normalise to `SELL_50`; legacy full TMS exit transport remains `SELL` while target user-facing copy is `Exit`.

### `decisions`

Audit records for user decisions against alerts.

Columns:

```text
id INTEGER
alert_id INTEGER
decision TEXT NOT NULL
notes TEXT
position_pct_after REAL
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `active_alerts`

Registered TradingView alert setup state.

Columns:

```text
id INTEGER
ticker TEXT
script TEXT NOT NULL
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `(ticker, script)` is unique. This table controls whether certain TMS alerts are accepted as actionable and whether a scoped commodity feed is eligible to update Markets. Physical, equity-relative, and Outperform feed setup is performed by `/api/commodity-themes/initialise-feed`, which atomically creates this CDF connection and a manual `BUY` or `SELL` baseline event. That baseline must not change `security_positions`, ETF allocation, alert history, cash, target weights, or action queues.

### `security_positions`

Per-security deployment state.

Columns:

```text
id INTEGER
ticker TEXT NOT NULL
position_state TEXT NOT NULL
manual_override BOOLEAN DEFAULT 0
last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
entry_date DATETIME
stopped_waiting_reentry BOOLEAN DEFAULT 0
risk_profile TEXT
```

Invariant: `ticker` is unique. `position_state = SELL` plus `stopped_waiting_reentry = 1` is the TMS stop/re-entry path.

### `regimes`

Generic raw regime state, separate from Q3/Q4 detector state.

Columns:

```text
id INTEGER
ticker TEXT NOT NULL
signal TEXT NOT NULL
last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `ticker` is unique. Generic regime BUY/SELL can affect securities through regime impact evaluation, but this is not the Q3 detector contract.

### `equity_sizing`

Current Q3/Q4 detector sizing state.

Columns:

```text
id INTEGER
source_ticker TEXT NOT NULL
target_equity_pct REAL NOT NULL
last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
```

Rows:

- `SPX`: preferred S&P/Q3 detector input
- `SPY`: legacy S&P/Q3 detector input, still compatible
- `XAO`: Australian market/Q3 detector input
- `Q4D`: Q4 crisis limiter, written as `10` on active crisis and `100` when cleared

Invariant: `source_ticker` is unique. Effective Q3 uses the lower available S&P/XAO target. If `SPX` exists, it takes precedence over legacy `SPY`.

### `equity_sizing_history`

Append-only detector sizing history.

Columns:

```text
id INTEGER
source_ticker TEXT NOT NULL
target_equity_pct REAL NOT NULL
received_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `q4_crisis_state`

Singleton Q4 active-state controller.

Columns:

```text
id INTEGER
active BOOLEAN NOT NULL DEFAULT 0
last_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
last_acknowledged_at DATETIME
reason TEXT DEFAULT ''
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `id = 1`. Missing row means Q4 is inactive. The 10% Q4 target is not stored here; it is a backend constant surfaced through API response fields.

### `overlay_signal_state`

Singleton state that compares current detector state with the last applied workflow state.

Columns:

```text
id INTEGER
current_q1_exposure_pct REAL NOT NULL DEFAULT 100
last_applied_q1_exposure_pct REAL NOT NULL DEFAULT 100
spy_q1_exposure_pct REAL DEFAULT 100
xao_q1_exposure_pct REAL DEFAULT 100
governing_source TEXT DEFAULT 'SPY'
last_signal_changed_at DATETIME
last_applied_at DATETIME
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `id = 1`. `spy_q1_exposure_pct` is a legacy field name; with SPX preferred, it still stores the S&P detector value for compatibility.

### `overlay_events`

Parent Q3/Q4 portfolio-risk action workflow event.

Columns:

```text
id INTEGER
status TEXT NOT NULL DEFAULT 'PENDING'
from_q1_exposure_pct REAL NOT NULL
to_q1_exposure_pct REAL NOT NULL
adjustment_ratio REAL NOT NULL
governing_source TEXT
triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP
stage1_applied_at DATETIME
stage1_required_reduction_value REAL DEFAULT 0
stage1_recorded_reduction_value REAL DEFAULT 0
stage1_baseline_reserve_value REAL DEFAULT 0
stage1_expected_reserve_value REAL DEFAULT 0
stage1_import_baseline_at DATETIME
reserve_confirmed_at DATETIME
reserve_confirmed_value REAL
reserve_variance REAL
cash_confirmation_status TEXT DEFAULT ''
stage2_completed_at DATETIME
baseline_accepted_at DATETIME
superseded_at DATETIME
notes TEXT
```

Status meaning:

| Status | Meaning |
| --- | --- |
| `PENDING` | Action exists; user has not completed required position actions. |
| `PARTIAL` | Draft or partial recorded reductions exist. |
| `STAGE1_DONE` | Position reductions are confirmed and awaiting or validating statement evidence. |
| `STAGE2_DONE` | Reserve/stage-two handling has completed. |
| `BASELINED` | Workflow was accepted into baseline/completed state. |
| `SUPERSEDED` | A newer detector transition replaced this event. |
| `CANCELLED` | Event was closed because signal returned to the last applied state or user/system cancelled it. |

### `overlay_event_classes`

Per-asset-class rows attached to one Q3/Q4 overlay event.

Columns:

```text
id INTEGER
event_id INTEGER NOT NULL
asset_class TEXT NOT NULL
overlay_eligible BOOLEAN DEFAULT 0
trigger_invested_value REAL DEFAULT 0
trigger_invested_pct REAL DEFAULT 0
trigger_tactical_cash_value REAL DEFAULT 0
trigger_total_class_capital_value REAL DEFAULT 0
target_invested_value REAL DEFAULT 0
target_invested_pct REAL DEFAULT 0
q3_sell_priority INTEGER
stage2_target_pct REAL
stage1_recorded_reduction_value REAL DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `(event_id, asset_class)` is unique. These rows are the class-level basis for action totals and UI sleeve cards.

### `overlay_stage1_sources`

Holding-level recorded reductions for a Q3/Q4 action.

Columns:

```text
id INTEGER
event_id INTEGER NOT NULL
holding_id INTEGER
stock_name TEXT
ticker TEXT
asset_class TEXT
group_id TEXT
group_label TEXT
amount_sold REAL DEFAULT 0
before_value REAL DEFAULT 0
expected_after_value REAL DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: this is the table that ties user-entered spreadsheet reductions to later statement reconciliation.

### `overlay_stage1_state` and `overlay_stage1_state_classes`

Frozen snapshot tables for active Stage 1 overlay context.

`overlay_stage1_state` columns:

```text
id INTEGER
active BOOLEAN DEFAULT 1
activated_at DATETIME DEFAULT CURRENT_TIMESTAMP
released_at DATETIME
q1_exposure_pct REAL NOT NULL
spy_target_pct REAL DEFAULT 0
xao_target_pct REAL DEFAULT 0
governing_source TEXT
portfolio_value REAL DEFAULT 0
```

`overlay_stage1_state_classes` columns:

```text
id INTEGER
state_id INTEGER NOT NULL
asset_class TEXT NOT NULL
invested_value REAL DEFAULT 0
tactical_cash_value REAL DEFAULT 0
total_class_capital_value REAL DEFAULT 0
strategic_weight_pct REAL DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: only one active Stage 1 snapshot should exist.

### `asset_class_config`

Asset-class settings for portfolio-risk overlay logic and presentation metadata.
This table is not the user-facing assignment vocabulary. It holds behavioural
settings such as Q3/Q4 treatment, display ordering, alert-stack presentation,
stage-two defaults, and sleeve cash metadata.

UI assignment controls and model target packets must not use this table as their
option list. They must use `asset_classes`. If a stock, group, ETF assignment,
or target row cannot resolve to an active asset class, it belongs in an
explicit `UNASSIGNED` state until the user or classifier assigns it.

Columns:

```text
code TEXT
display_name TEXT NOT NULL
kind TEXT DEFAULT 'ASSET_CLASS'
parent_code TEXT
is_portfolio_sleeve BOOLEAN DEFAULT 0
is_system_bucket BOOLEAN DEFAULT 0
allow_grouping BOOLEAN DEFAULT 1
allow_target_weight BOOLEAN DEFAULT 1
overlay_eligible BOOLEAN DEFAULT 0
display_order INTEGER DEFAULT 999
q3_sell_priority INTEGER
q1_category BOOLEAN DEFAULT 0
q3_beneficiary BOOLEAN DEFAULT 0
regime_independent BOOLEAN DEFAULT 0
q3_throttle_factor REAL
q4d_liquidity_factor REAL
q3_rating TEXT
q3_logic TEXT
stage2_target_pct REAL
sector TEXT
cash_reserve REAL DEFAULT 0
active BOOLEAN DEFAULT 1
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

The legacy taxonomy columns are retained for compatibility with older config
rows and display joins. They do not make this table the selector source.
Canonical hierarchy and assignability come from `asset_classes`.

### `cash_movements`

User-declared sleeve-cash intent records. These rows explain why the displayed
class cash was changed before the next broker statement import can prove the
cash source.

Columns:

```text
id INTEGER PRIMARY KEY AUTOINCREMENT
asset_class_code TEXT NOT NULL
amount_delta REAL NOT NULL
previous_cash_reserve REAL NOT NULL DEFAULT 0
target_cash_reserve REAL NOT NULL DEFAULT 0
source_type TEXT NOT NULL
note TEXT DEFAULT ''
status TEXT NOT NULL DEFAULT 'PENDING'
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
confirmed_at DATETIME
statement_id INTEGER
```

Allowed `source_type` values:

- `PORTFOLIO_CASH_TRANSFER`
- `STOCK_SALE`
- `EXTERNAL_CAPITAL`

Allowed `status` values:

- `PENDING`
- `CONFIRMED`
- `MISMATCH`
- `CANCELLED`

Rules:

1. `asset_class_code` is the sleeve receiving the displayed cash change.
2. `previous_cash_reserve` and `target_cash_reserve` preserve the before/after values.
3. `amount_delta` is `target_cash_reserve - previous_cash_reserve`.
4. `PENDING` means the user has declared the source, but the next broker import has not reconciled it yet.
5. Each cash allocation edit also creates a `decisions` row with decision `CASH_ALLOCATION`.
6. Statement reconciliation can later attach `statement_id` and `confirmed_at`.

### `asset_classes`

Canonical allocation and assignment vocabulary. This is the table used by
analysis asset-class assignment, ETF asset-class assignment, group-name
autocomplete, portfolio target editors, portfolio rebalance plan validation, and
model target packets. It deliberately separates assignable classes from system
buckets and broader risk-overlay labels.

Columns:

```text
code TEXT PRIMARY KEY
asset_class_code TEXT NOT NULL
display_name TEXT NOT NULL
class_type TEXT DEFAULT 'ALLOCATION'
parent_code TEXT
allow_grouping BOOLEAN DEFAULT 1
allow_target_weight BOOLEAN DEFAULT 1
analysis_eligible BOOLEAN DEFAULT 1
instrument_scope TEXT DEFAULT 'BOTH'
risk_bucket TEXT DEFAULT ''
display_order INTEGER DEFAULT 999
active BOOLEAN DEFAULT 1
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Important distinction: `asset_class_config` contains risk-overlay settings and
presentation metadata; `asset_classes` contains the valid allocation buckets
used for portfolio construction. `code` is the canonical portfolio allocation
key. The `asset_class_code` field maps legacy/current stock classification
values onto that asset class. For example, a stock classified as `GOLD` can
resolve to the `GOLD_MINERS` allocation class. New group creation, analysis
assignment, ETF assignment, portfolio target creation, and model packets validate
against `asset_classes`, not against the full `asset_class_config` table.

`analysis_eligible` controls whether a class can be used as a stock-analysis or
council research lane. Custom fund classes must set this to `0`.

`instrument_scope` describes whether the class is intended for `STOCK`, `FUND`,
or `BOTH` assignment. MVP uses `FUND` for custom ETF/fund-only classes.

`risk_bucket` stores the required quartile/risk bucket for custom classes so the
portfolio-risk overlay can include or exclude the exposure intentionally.

Validation rules:

1. New position groups must use a valid active `asset_classes.code`.
2. Analysis classifications should be searchable from active canonical classes and must not free-type arbitrary class names.
3. Portfolio rebalance rows must use canonical asset-class codes.
4. Model target packets must include only canonical asset-class codes, display names, and allowed target weights.
5. Existing non-conforming values should be surfaced as `UNASSIGNED`, not silently mapped into `ADD`, `MISC`, or a nearby-looking class.
6. `CASH` and `UNASSIGNED` are system buckets. They may appear in current-state reconciliation, but should not be treated as normal investable group names.
7. Custom classes must be created as `class_type = CUSTOM`, must not be analysis
   eligible, and must define a non-empty risk bucket/quartile.

UI consumers:

- Analysis tab asset-class editing writes stock classification through
  `stock_analysis.primary_asset_class`; persisted active values must resolve to
  `asset_classes.code`.
- Positions tab group creation writes `stock_groups.asset_class_code` and should
  use `asset_classes.code` autocomplete/validation.
- Portfolio tab target creation writes `portfolio_rebalance_plan_rows.asset_class`
  and must use canonical `asset_classes.code` values.
- Portfolio Memo packets should use `asset_classes` as the target universe,
  not the full `asset_class_config` table.

Important distinction:

- `q3_throttle_factor` controls how much Q3 risk-off reduction applies to a class.
- `q4d_liquidity_factor` controls Q4 crisis liquidity treatment.
- The UI should not reuse Q3 language for Q4 if Q4 factors are being used.

### `portfolio_mix_snapshots`

Approved strategic portfolio shape snapshots.

Columns:

```text
id INTEGER
status TEXT NOT NULL DEFAULT 'APPROVED'
reason TEXT DEFAULT 'DISCRETIONARY'
source_rebalance_plan_id INTEGER
notes TEXT
approved_at DATETIME DEFAULT CURRENT_TIMESTAMP
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: there is normally one live `APPROVED` snapshot. Older approved snapshots are set to `SUPERSEDED`.

### `portfolio_mix_snapshot_rows`

Asset-class rows for an approved portfolio mix.

Columns:

```text
id INTEGER
snapshot_id INTEGER NOT NULL
asset_class TEXT NOT NULL
display_name TEXT NOT NULL
display_order INTEGER DEFAULT 999
governed_by_q1 BOOLEAN DEFAULT 0
weight_pct REAL DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Note: `governed_by_q1` is a legacy backend field name. It may remain in DB/API contracts for compatibility, but user-facing UI should avoid repeating it as a label.

### `portfolio_rebalance_plans`

Manual or AI-assisted portfolio target workflow parent row.

Columns:

```text
id INTEGER
status TEXT NOT NULL DEFAULT 'OPEN'
driver TEXT NOT NULL DEFAULT 'DISCRETIONARY'
title TEXT
notes TEXT
memo_job_id TEXT
source_snapshot_id INTEGER
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
completed_at DATETIME
approved_at DATETIME
```

### `portfolio_rebalance_plan_rows`

Asset-class target rows for a portfolio rebalance plan.

Columns:

```text
id INTEGER
plan_id INTEGER NOT NULL
asset_class TEXT NOT NULL
display_name TEXT NOT NULL
display_order INTEGER DEFAULT 999
governed_by_q1 BOOLEAN DEFAULT 0
current_weight_pct REAL DEFAULT 0
target_weight_pct REAL DEFAULT 0
recorded_move_value REAL DEFAULT 0
note TEXT
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Invariant: `(plan_id, asset_class)` is unique. `recorded_move_value` persists user-entered action progress.

## ETF Tables

### `etf_positions`

```text
id INTEGER
ticker TEXT NOT NULL
position_state TEXT NOT NULL DEFAULT 'SELL'
allocation_pct REAL DEFAULT 0
cash_allocated REAL DEFAULT 0
manual_override BOOLEAN DEFAULT 0
last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `etf_allocations`

```text
id INTEGER
ticker TEXT NOT NULL
allocation_percent REAL NOT NULL
base_weight REAL NOT NULL DEFAULT 0
tactical_status TEXT DEFAULT 'BUY'
last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
```

### ETF asset-class assignment

ETF instruments use the same assignment path as other securities. Their
canonical class is stored in `stock_analysis.primary_asset_class` with
`stock_analysis.security_type = 'ETF'`. The allocation ledger reads this field
to decide whether an ETF can count as core implementation for an approved
asset class. Tactical ETF eligibility still comes from `etf_allocations`.

There is no separate ETF asset-class vocabulary table. Legacy
`etf_asset_class_mappings` rows are migrated into `stock_analysis` and the
legacy table is dropped.

### `asset_class_etf_policies`

```text
asset_class TEXT PRIMARY KEY
core_security_id INTEGER
core_ticker TEXT NOT NULL DEFAULT ''
core_ratio_pct REAL NOT NULL DEFAULT 25
momentum_influence_pct REAL NOT NULL DEFAULT 50
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

This table selects at most one Core ETF for an asset class. `security_id` is
the durable relationship; `core_ticker` is retained as a compatibility and
display key. The ratio defines the class's suggested Core ETF base. Momentum
influence controls the bounded adjustment to that base. Neither value changes
the approved total asset-class budget.

### `etf_rebalance_targets`

```text
id INTEGER
sequence_number INTEGER NOT NULL
rebalance_date DATETIME NOT NULL
ticker TEXT NOT NULL
rank INTEGER
return_60bar REAL
current_allocation REAL DEFAULT 0
target_allocation REAL NOT NULL
pending_delta REAL
status TEXT DEFAULT 'PENDING'
weighted_portfolio_return REAL
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
expires_at DATETIME
```

### `etf_executions`

```text
id INTEGER
rebalance_id INTEGER
ticker TEXT NOT NULL
signal TEXT NOT NULL
allocation_before REAL
allocation_after REAL
cash_before REAL
cash_after REAL
executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

## Organisation And Sync Tables

### `stock_groups`

```text
id TEXT
name TEXT NOT NULL
asset_class_code TEXT
collapsed BOOLEAN DEFAULT 0
display_order INTEGER NOT NULL
parent_id TEXT
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

`asset_class_code` is the canonical asset-class link from a visual group.
New group creation should validate this against `asset_classes`, not against
the full `asset_class_config` table. The name is display text.

### `stock_group_assignments`

```text
company_name TEXT
group_id TEXT NOT NULL
assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `sync_history`

```text
id INTEGER
sync_type TEXT NOT NULL DEFAULT 'sheet_import'
sync_status TEXT NOT NULL
total_changes INTEGER DEFAULT 0
added_count INTEGER DEFAULT 0
updated_count INTEGER DEFAULT 0
removed_count INTEGER DEFAULT 0
error_message TEXT
synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `sync_changes`

```text
id INTEGER
sync_id INTEGER NOT NULL
change_type TEXT NOT NULL
ticker TEXT NOT NULL
company_name TEXT NOT NULL
old_quantity REAL
new_quantity REAL
old_value REAL
new_value REAL
acknowledged BOOLEAN DEFAULT 0
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `settings`

```text
key TEXT
value TEXT NOT NULL
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `regime_assignments`

Legacy regime assignment table.

```text
id INTEGER
security_ticker TEXT NOT NULL
security_type TEXT NOT NULL
regime_ticker TEXT NOT NULL
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Current note: the Regimes tab is not mounted in the main UI. Keep read-only compatibility if it is still used by old code paths, but do not use this table as the source of Q3/Q4 portfolio-risk state.

## Required Future Improvements

1. Roll out the locally tested versioned baseline through the database release gates.
2. Keep the frozen SQL reference and subsequent migrations authoritative; a full generated narrative/table catalogue remains optional follow-up.
3. Add database invariants tests for singleton tables: `overlay_signal_state`, `q4_crisis_state`, active Stage 1 snapshot.
4. Add migration tests for old `SPY` rows and preferred `SPX` rows.
5. Add generated schema docs for `SELL_50` once migrations are versioned.
6. Audit and remove unused legacy tables or clearly label them as compatibility-only.
