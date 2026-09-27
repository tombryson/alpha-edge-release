# Data Refresh And Freshness

Audit date: 27 August 2026.

This document owns the application-wide contract for external data collection,
scheduled calculations, event ingestion, persisted freshness, and frontend
polling. It distinguishes a real provider refresh from a browser rereading data
that Alpha Edge already holds.

## Core Distinctions

Alpha Edge has five different update mechanisms. They must not be presented as
one generic `Refresh` operation.

| Mechanism | Meaning | Examples |
| --- | --- | --- |
| Provider refresh | The backend calls an external data provider and persists the result. | Yahoo daily prices; xAI news research. |
| Event ingestion | An external system pushes a new event to Alpha Edge. | TradingView webhook; statement import. |
| Scheduled calculation | The backend derives and versions a result from persisted evidence. | ETF momentum evidence and publication. |
| Projection refresh | Alpha Edge recomputes a read model from its own persisted state. | Portfolio overlay, ETF allocation ledger, commodity market summary. |
| Client polling | The browser rereads persisted state or checks a running job. | Alerts every 30 seconds; Council job status every 2 seconds while active. |

Client polling is not evidence that market data is fresh. A successful
`GET /api/analysis` can return stale Yahoo-derived performance. Conversely, a
TradingView signal can be current even when no browser is open because it is
push-based.

## Source Authority

| Domain | Authority | Supporting evidence only |
| --- | --- | --- |
| Portfolio value, holdings, units, and actual exposure | Latest accepted broker/account statement | Yahoo prices and TradingView charts |
| Approved portfolio shape | Approved Portfolio Analysis record and portfolio-mix workflow | Current drift and UI projections |
| CDF, TMS, regime, and commodity confirmation state | Accepted TradingView webhook events and operator-initialised connection state | Embedded TradingView charts |
| Analysis trailing price performance | Persisted external daily price history | UI calculations |
| ETF momentum ranking | Published versioned internal ETF momentum run | Newer unpublished daily evidence; legacy TradingView parity snapshots |
| Macro narrative | Active News foundation cohort plus latest successful daily News run | Raw news items and failed jobs |
| Security identity | Stable Alpha Edge security identity plus verified corporate-action evidence | Yahoo name/listing observations |

External prices must never overwrite statement-derived portfolio valuation.
Provider identity observations must never silently rename a security.

## Provider And Update Inventory

### Yahoo Finance

Yahoo currently supports several distinct mechanisms. It should remain behind
backend adapters and persisted caches rather than becoming a page-level
dependency.

| Mechanism | Current implementation | Current trigger | Persisted result | Recommended policy |
| --- | --- | --- | --- | --- |
| Analysis price history and trailing returns | `fetchYahooAdjustedDailyPrices` requests 18 months of daily data; `POST /api/analysis/performance/refresh` remains manual recovery | Unified backend cycle after 10:00 UTC | `security_price_daily`; `stock_analysis.current_price`; six- and twelve-month metrics are derived on read | Implemented. The conservative freshness date is the oldest latest date among updated symbols; partial coverage retries after two hours. |
| Watchlist quote and listing observation | `POST /api/analysis/refresh-prices`; chart metadata plus Yahoo search fallback | Weekly backend verification after 11:00 UTC; manual recovery | `stock_analysis.current_price`, `security_listing_checks`, `security_listing_reviews` | Implemented as a separate identity/liveness check. Statement import no longer launches this Yahoo work. It never renames automatically. |
| ETF price history | `POST /api/etf/momentum/price-history/refresh` through the ETF provider adapter | Backend ETF automation and manual recovery | `security_price_daily` | Implemented: daily evidence collection after the configured UTC hour. |
| ETF momentum calculation and publication | `POST /api/etf/momentum/runs` and the backend ETF worker | Daily worker; publication defaults to every 80 trading sessions | Immutable momentum runs and rows; latest and published runs are separate | Implemented. Incomplete/stale evidence cannot alter published allocation weights. |
| Direct commodity return history | Configured source symbols map to Yahoo equivalents; `POST /api/commodity-themes/price-history/refresh` remains manual recovery | Unified backend cycle after 10:00 UTC | `commodity_price_daily` | Implemented. A missing series makes `60D` unavailable; it never changes BULL/BEAR state. |
| Legacy regime returns | Static ticker list with four years of Yahoo history; `POST /api/regimes/returns/refresh` remains manual recovery | Unified backend cycle after 10:00 UTC | `regime_return_snapshots` | Implemented. `GET /api/regimes/returns` only reads the newest persisted snapshot and returns an empty array with `X-Data-Freshness-Status: NEVER_RUN` before the first refresh. |

Yahoo is currently a single-provider dependency for supplementary price history.
The provider adapter, cached rows, coverage diagnostics, and manual recovery
routes reduce that risk, but a fallback provider has not been implemented.

### xAI And OpenAI

| Mechanism | Provider | Current trigger | Periodic? | Policy |
| --- | --- | --- | --- | --- |
| News daily narrative | xAI Responses API via `POST /api/news/daily-jobs` or compatibility `POST /api/news/run` | Backend cycle after 12:00 UTC; user-triggered recovery remains available | Yes | Implemented as at most one successful/active job per UTC date when an active foundation cohort and `XAI_API_KEY` exist. Missing prerequisites are recorded as `SKIPPED`. |
| News foundation rebuild | xAI Responses API via `POST /api/news/foundation-jobs` | Explicit user action or new Portfolio Memo workflow | No, by design | Run after a materially new approved Portfolio Memo or explicit rebuild. It is not a daily job. |
| Asset-class classification | xAI Responses API via `POST /api/analysis/classify-asset-class` | Explicit user action | No, by design | Keep on demand; persist the proposal and require canonical asset-class validation. |
| Ticker enrichment | OpenAI plus Yahoo search via `POST /api/enrich/tickers` | Explicit/manual | No, by design | Keep on demand. Automatic invocation is currently disabled because of rate limits. |
| IG statement extraction | OpenAI Chat Completions from `backend/google_apps_script/ig_statement_sync.gs` | Google Apps Script trigger/manual execution | External trigger | Treat extraction as part of statement ingestion, not as a market-data schedule. Apps Script trigger ownership must be recorded operationally. |

AI jobs have cost, latency, and model-version consequences. Opening a page or
polling a read endpoint must never start one.

### TradingView

TradingView is primarily an event source, not a provider that Alpha Edge should
periodically fetch.

| Mechanism | Endpoint | Update model | Freshness evidence |
| --- | --- | --- | --- |
| Security CDF, TMS, target, and breakout signals | `POST /api/webhook/tradingview` | Push event | Accepted event time, source bar time, connection initialisation, and last event |
| Q3/Q4 and generic regime signals | `POST /api/webhook/regime` | Push event | Same event audit discipline |
| Legacy ETF rebalance payload | `POST /api/webhook/etf-rebalance` | Push event | Compatibility evidence only; internal published momentum is the target source under ETF v2 |
| Commodity, equity-relative, and security-relative confirmations | `POST /api/webhook/theme-confirmation` | Push event | Registered feed, operator-selected baseline, accepted source event |
| Embedded charts | TradingView browser widgets | Loaded when the review surface opens | Visual evidence only; never canonical state |
| Legacy TradingView database sync | `POST /api/sync/tradingview` calls `tradingview-apiservice.fly.dev` | Manual pull | Legacy compatibility path |

The Alerts connection ledger records whether the operator has configured and
initialised the expected TradingView alert. It is not a live socket-health
monitor. Periodic polling of Alpha Edge's Alerts API only rereads this ledger.

### Broker Statements And Account State

`POST /api/statements/import` is the authoritative account-state ingestion
endpoint. The repository contains an IG Google Apps Script pipeline, but the
actual Apps Script trigger schedule is configured outside this repository and
cannot be audited from Go or frontend code.

Statement ingestion updates holdings, values, performance snapshots, and action
reconciliation. It does not start Yahoo price or listing work; the statement
itself remains valuation truth. FX conversions currently
come from imported statement data; there is no separate periodic FX-rate API.

Recommended operating rule:

1. Ingest each new broker statement once.
2. Persist source statement date, received time, processing time, and result.
3. Show statement freshness separately from market-price freshness.
4. Alert when the expected statement has not arrived; do not fill the gap with
   Yahoo valuation.

### Alpha Edge Intelligence Service

Analyst Council and Portfolio Analysis jobs are explicit research operations.
The Trading Terminal proxies their job APIs through `app/api/council/*` and
polls only while a job is queued or running. These jobs should not be placed on
a generic market-data timer.

The Announcement Router is also hosted by the Intelligence Service. Its Gmail
poller is an externally configured Google Apps Script dependency; its cadence
and credentials are not represented in this repository. The Trading Terminal
reads accepted Announcement Router evidence when it calculates sizing. This
external trigger must be included in the operational dependency register.

## Current Frontend Polling

Recurring application-state reads use one visibility-aware coordinator. These
are read-model refreshes, not external provider schedules.

| Approximate cadence | Current use |
| --- | --- |
| 2 seconds while active | News and Council job status |
| 5 seconds | Statement sync-change notification and active portfolio-overlay reconciliation |
| 30 seconds | Alerts, active actions, ETF ledger/momentum workspace, Markets summaries, regime state, portfolio risk, sizing inputs, System status |
| 60 seconds | ETF rebalance banner; freshness has its existing shared resource |
| 120 seconds | Holdings/application-state refresh |
| Event/focus based | Alert SSE and explicit mutation events; focus resumes due reads |

The coordinator shares identical store callbacks, uses a single one-second
clock to service aligned cadence boundaries, prevents a periodic callback overlapping itself,
and removes the clock while hidden or without subscribers. Visibility/focus
resumes due work once, not one request for every missed interval. Cadences may
be serviced up to one clock tick late; a slow read is not overlapped to catch up.
Explicit user refreshes and mutation events retain their existing behaviour.

Allowlisted Terminal GETs share an identical in-flight HTTP request, including
URL/query, headers and fetch options, with independent response bodies for each
caller. There is no response cache or TTL: sequential reads remain fresh requests.
Different credentials, caller-owned cancellation, unknown endpoints, SSE and
Intelligence calls are not combined. Shared reads have a 30-second transport
timeout. Mutations clear read-sharing before and after completion, including
failures; they are never coalesced or retried by this layer. Credential changes
also clear sharing. This is browser-only, never a cross-user server cache.

This consolidates recurring scheduling and overlapping reads, not every endpoint
into a persistent query cache. Component-specific error and rendering semantics
are preserved. News/Council active-job polling and the already-shared freshness
resource retain their separate lifecycle. Provider refresh jobs are unchanged.

## Implemented Refresh Architecture

### Backend ownership

Every external provider refresh should be backend-owned and should:

1. acquire a single-run lease;
2. record attempt time and trigger source;
3. fetch through a provider adapter with bounded concurrency and timeout;
4. validate coverage before publishing derived results;
5. persist data freshness separately from calculation time;
6. record partial failures rather than pretending the whole dataset is fresh;
7. retry with backoff without creating duplicate runs; and
8. expose status through a read-only freshness endpoint.

Manual controls remain recovery or operator-override tools. They are not the
normal source of daily freshness.

### Daily sequence

1. **Statement ingestion, event driven:** process a newly available broker
   statement and reconcile actions.
2. **Market-data collection:** after the relevant completed sessions, refresh
   the stock/Analysis universe, ETF universe, and configured commodity sources.
3. **Derived evidence:** calculate Analysis trailing returns, commodity 60-day
   returns, and the ETF daily evidence run.
4. **Controlled publication:** publish ETF weights only when the configured
   trading-session cadence is due.
5. **Narrative update:** run one News daily job only after its required portfolio
   foundation and current evidence are available.
6. **Staleness review:** create operational review state for failed, incomplete,
   or late sources. Staleness is not itself a trading signal.

The worker starts with the backend, checks due work immediately, and checks again
every 30 minutes. Default market-data work becomes eligible after 10:00 UTC,
weekly listing verification after 11:00 UTC, and News after 12:00 UTC. `FAILED`,
`PARTIAL`, and prerequisite-`SKIPPED` runs retry after two hours. A dataset has
one active database lease;
an abandoned `RUNNING` lease expires after 20 minutes.

A single UTC time cannot prove that ASX, US, futures, and OTC data have all completed.
Freshness should therefore be measured against the newest expected completed
session for each source, not merely the server date.

## Required Freshness Metadata

Each scheduled family should expose at least:

```json
{
  "source": "YAHOO",
  "dataset": "ANALYSIS_PRICE_HISTORY",
  "status": "COMPLETE",
  "last_attempt_at": "2026-08-27 10:00:00",
  "last_success_at": "2026-08-27 10:01:42",
  "data_fresh_through": "2026-08-26",
  "coverage_complete": true,
  "records_expected": 97,
  "records_updated": 97,
  "last_error": null
}
```

Required status vocabulary:

| Status | Meaning |
| --- | --- |
| `NEVER_RUN` | No attempt has been recorded. |
| `RUNNING` | One leased refresh is active. |
| `COMPLETE` | Required coverage was validated and persisted. |
| `PARTIAL` | Some sources updated, but required coverage is incomplete. |
| `FAILED` | No valid publishable result was produced. |
| `SKIPPED` | The scheduled opportunity was recorded but a declared prerequisite was unavailable or equivalent work is still queued/running. Prerequisites are rechecked after backoff. |
| `STALE` | Last successful evidence is older than the dataset's approved tolerance. |

The initial operational stale thresholds are four calendar days for Yahoo market
history and ETF evidence, two calendar days for News, and eight calendar days
for listing verification. Broker statements and TradingView signals expose the
latest accepted event but do not infer a stale threshold because their expected
arrival cadence is not owned by this backend. These thresholds are operational
warnings, never trading signals. A later market-calendar implementation should
replace calendar-day tolerances with expected completed sessions.

The scheduler settings are persisted in `settings`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `data_refresh_automation_enabled` | `true` | Master switch for the unified worker. |
| `data_refresh_daily_utc_hour` | `10` | Earliest UTC hour for Analysis, commodity, and legacy regime history. |
| `listing_verification_automation_enabled` | `true` | Enables weekly listing/name evidence checks. |
| `listing_verification_utc_hour` | `11` | Earliest UTC hour for a due weekly verification. |
| `news_daily_automation_enabled` | `true` | Enables idempotent News daily jobs. |
| `news_daily_utc_hour` | `12` | Earliest UTC hour for the News daily job. |
| `etf_momentum_automation_enabled` | `true` | Enables ETF evidence refresh within the unified worker. |
| `etf_momentum_daily_utc_hour` | `10` | Earliest UTC hour for ETF evidence. |
| `etf_momentum_publish_cadence` | `EIGHTY_TRADING_DAYS` | Separate authority for publishing complete ETF weights. |

Changing a setting changes scheduling only. It does not alter source authority,
published ETF weights, a trading signal, or broker state.

## Implementation Status And Remaining Priorities

### Complete: Daily market-data orchestrator

`startDataRefreshAutomation` coordinates Analysis history, ETF evidence,
commodity history, persisted legacy regime returns, weekly listing verification,
and News. `data_refresh_runs` records attempt, trigger, status, coverage, errors,
and source freshness. Existing manual POST routes acquire the same dataset lease.

### Complete: Remove provider work from regime GET

`GET /api/regimes/returns` reads `regime_return_snapshots`. Provider work occurs
only in scheduled or explicit manual refresh execution.

### Complete: Schedule the News daily job

The cycle creates at most one active/successful daily job per UTC date and skips
cleanly when its API key or active foundation is unavailable.

### Complete: Unified freshness read model

`GET /api/data-freshness` returns scheduled provider families plus synthetic
latest-event evidence for broker statements and TradingView. It never starts a
provider request or AI job.

### Complete: Split quote refresh from identity verification

Daily Analysis history updates supplementary Analysis prices. Yahoo search/name
verification is weekly or manual and no longer runs after statement import.

### Complete: Shared freshness presentation

Analysis, Markets, ETF allocations/ranking, News and System share a compact
**Data issues** panel. The indicator counts issue categories, not individual
failed tickers: unavailable, not-loaded, partial, failed and stale provider
families. Failures precede stale and incomplete feeds. Healthy families and quiet
event sources do not fill the list; source dates and coverage remain beside each
issue, and **Details** expands the full recorded provider error. The empty state
is neutral, and failed reads retain a warning rather than claiming all is well.

Analysis contributes one additional issue category for missing exchanges, with
its affected-security count and a filter action. Each affected name carries a
small raised exclamation that opens its exchange editor. The filter never writes
data and clears after the final exchange is assigned. Refresh controls remain
view-specific. Old TradingView events are not labelled stale or treated as
connection failures. These warnings never change permissions or allocation
targets. The read-only API retains the full eight-family status inventory.

**Auto-assign** is a separate explicit mutation in Analysis's missing-exchanges
section, not part of any refresh timer. The client submits database IDs in batches
of at most five, with progress and per-record outcomes. The backend first checks
linked identities, ISINs and existing same-name/ticker records. Otherwise it
searches both ticker and company name, requiring a single exact listing and
matching quote metadata (ticker, exchange, name, instrument type and available
holding currency). Legal name suffixes may differ, but names are not fuzzy-matched.
`PERPLEXITY_API_KEY` optionally enables Sonar discovery when search finds no exact
candidate; Sonar alone never authorises assignment. Provider failures and multiple
listings are not bypassed with a model guess. Requests time out and are not retried
automatically. Already-qualified records are skipped on a subsequent run.

Each assignment rechecks the live record in a transaction before filling the
missing exchange in its mapping, matching active holdings, linked research and
identity. Conflicting identities are not merged. Templates, instrument types,
class assignments, financial values and historical evidence are unchanged.
Successful assignments are logged with their source and mapping timestamp;
per-record result details live in the current UI session. Unresolved securities
remain in the missing-exchange filter, not a new alert or decision queue. This
does not resolve every listing-review issue or imply that price data is current.

Endpoint: `POST /api/analysis/exchanges/auto-assign`; request/response contract in
[OpenAPI](../api/openapi.json). No database migration is required.

One in-memory resource owns the freshness GET and a 60-second timer across all
mounted consumers. Concurrent reads are coalesced, hidden tabs skip timer reads,
focus/visibility changes refresh only when due, and the last unsubscribe removes
the timer. Failed checks retain explicitly labelled last-known evidence. An
authentication failure clears the cached evidence. Recheck only reads the ledger.

Manual provider work remains explicit and view-specific: Analysis history has a
history refresh distinct from quote/listing refresh; Markets uses its existing
commodity refresh; ETF refresh retrieves price history, not a publication of new
weights; News starts the existing daily narrative job. ETF calculation and
publication retain their backend schedule. Opening the panel never starts AI or
provider work. These controls do not create a generic refresh-everything job.

Implementation: [resource](../../lib/data-freshness.ts),
[panel](../../components/data-freshness-indicator.tsx),
[tests](../../tests/data-freshness.test.cjs).

### Complete: Consolidate recurring frontend state polling

[Polling coordinator](../../lib/polling.ts) now owns the application-state
cadences for Alerts, security actions, ETF and shape sidebar data, Markets,
System, portfolio overlays/reconciliation, rebalance, regime surfaces, sync
notifications and sizing-input revisions. [Shared reads](../../lib/shared-api-reads.ts)
coalesces overlapping requests for the allowlisted projections. A future revision
stream could remove more sequential reads, but is not necessary for this change.

### P3: Provider resilience

Keep Yahoo behind an interface, add provider health/coverage metrics, and assess
a second historical-price source before market history becomes a hard trading
dependency.

## Acceptance Criteria For A New Scheduled Feed

A new periodic provider integration is incomplete until it has:

1. a named owner and source authority;
2. a persisted schedule and disabled/manual mode;
3. a single-run lease and idempotency key;
4. bounded timeout, retry, and concurrency;
5. immutable or auditable run evidence;
6. `data_fresh_through` separate from `created_at`;
7. coverage and missing-symbol diagnostics;
8. a read-only status contract;
9. manual recovery without changing its normal schedule;
10. tests for unchanged source dates, partial coverage, restart, and failure;
11. UI language that distinguishes stale evidence from a trading signal; and
12. documentation in this file and [API Reference](../api/API_REFERENCE.md).
