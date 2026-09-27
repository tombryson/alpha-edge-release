# API Reference

Owner-mode browser authentication uses passkeys and same-origin session cookies.
See [owner sessions and demo](../operations/OWNER_SESSIONS_AND_DEMO.md) for the
security boundary and [OpenAPI](openapi.json) for the `/api/auth/*` contracts.
Legacy machine bearer routes remain supported; the public demo is a separate,
synthetic read-only server with no backend connection.

## Source Research

These authenticated Go routes belong to the Terminal backend, not the
independent Council service. See [Source research](../system/SOURCE_RESEARCH.md)
for lifecycle and [OpenAPI](openapi.json) for full request/response schemas.

| Method | Route | Behaviour |
| --- | --- | --- |
| GET | `/api/source-research/templates` | Configuration presence, Ultra 4x estimate and supported template versions; no provider call |
| GET | `/api/source-research/jobs?analysis_id=123` | Latest 20 saved runs for one Analysis row, without packet bodies |
| POST | `/api/source-research/jobs` | Persist and queue one explicit paid retrieval; idempotent by request ID |
| GET | `/api/source-research/jobs/{id}` | Saved detail; validated packet or quarantined provider output for review |
| POST | `/api/source-research/jobs/{id}/recover` | Link an existing provider run to an uncertain submission; never submit another paid request |

Create body:

```json
{
  "analysis_id": 123,
  "template_id": "gold_miner",
  "template_version": "hash returned by the catalogue",
  "expected_ticker": "ASX:EXAMPLE",
  "accepted_cost_usd": 1.2,
  "request_id": "client-generated-unique-request-id"
}
```

Creation returns 202 for a new queued run or 200 for an identical retained request.
Status and provider acceptance must be read from the saved job. On a lost response,
list saved jobs or explicitly repeat the same body and ID, never generate a new ID.
Identity/template/price conflicts and active-capacity limits return 409; missing
provider configuration returns 503. Application errors are `{ "error": "..." }`;
authentication retains the Terminal's `{ "code": "unauthorized", "message": "..." }`.
Recovery takes `{ "provider_run_id": "trun_existing_run" }` and checks its metadata.
No route starts Council, overwrites model scores, or changes holdings/class budgets.

The Terminal REST routes are registered in [backend/routes.go](../../backend/routes.go). Frontend callers are concentrated in [lib/api.ts](../../lib/api.ts).

This document explains selected contracts and side effects. The complete, source-checked inventory is [Route Catalogue](ROUTES.md). [OpenAPI](openapi.json) covers all 168 operations, ten selected request schemas and thirteen selected response contracts; remaining payload schemas are not yet complete. Do not mistake route coverage for full contract verification. [Signal Trace](SIGNAL_TRACE.md) follows incoming signals through persistence and user response.

## Base URLs

| Environment | Base URL |
| --- | --- |
| Local backend | `http://localhost:8080` |
| UAT backend | `https://alpha-edge-uat-backend.fly.dev` |
| Production backend | `https://alpha-edge-backend.fly.dev` |

All JSON endpoints return `Content-Type: application/json` unless they return an HTTP error via `http.Error`.

## Error Rules

Common error behaviour:

- invalid JSON: `400`
- invalid route parameter: `400`
- missing or invalid workflow state: usually `400` or `404`
- database or reconciliation failure: `500`
- CORS preflight: handled by backend middleware

The backend does not yet return a consistent structured error shape. This is a production documentation and API hygiene gap.

## Selected Route Contracts

### Health And Freshness

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check. |
| `GET` | `/api/auth/check` | Validate the existing API bearer token without DB queries. Authenticated `204`, invalid/missing token `401`, auth-disabled mode `503`. Used by the Council proxy; not a public health check. |
| `GET` | `/api/data-freshness` | Read-only application freshness ledger. Returns scheduler settings and one status per provider/event family, including last attempt, last success, conservative `data_fresh_through`, coverage, errors, cadence, and stale tolerance. It never starts provider or AI work. |

### Council Proxy

All Next `/api/council/*` handlers now validate the browser's existing trading
bearer token before using the server's Council credential. Job creation accepts JSON or multipart; malformed JSON is rejected
instead of forwarded as an empty paid-job request. Neither browser nor proxy
automatically retries submissions. Status/results may retry.

An ambiguous submission returns `502` with `code: COUNCIL_SUBMISSION_UNCERTAIN`,
`submission_status: uncertain` and a user-facing `detail`. Check existing jobs
before resubmitting. Validator/configuration failures explicitly identify
`submission_status: not_submitted`. Upstream credential rejection is mapped to
`502 COUNCIL_AUTH_REJECTED`, never a caller `401`. No durable idempotency guarantee
is claimed. See [Council safety contract](../system/ANALYSIS_AND_COUNCIL.md).

### Alerts And Decisions

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/alerts` | List alert rows. |
| `POST` | `/api/alerts` | Create a manual alert. |
| `POST` | `/api/alerts/{id}/dismiss` | Dismiss an alert without recording a trading decision. Sets `resolved_reason = DISMISSED` unless the alert already has a decision resolution. |
| `GET` | `/api/alerts/stream` | SSE alert stream. |
| `GET` | `/api/alerts/active` | List registered TradingView alert setups. |
| `POST` | `/api/alerts/active/setup` | Register a standard TradingView alert setup. Stock CDF and ETF TMS setup require an explicit current `BUY` or `SELL` state; TMS setup registers its connection only. |
| `POST` | `/api/alerts/active/remove` | Remove a TradingView alert setup. |
| `GET` | `/api/alerts/unmapped` | List alerts requiring ticker mapping. |
| `POST` | `/api/alerts/{id}/resolve` | Resolve unmapped alert. |
| `GET` | `/api/decisions` | List user decisions. |
| `POST` | `/api/decisions` | Create a decision for an alert. Single-security executions also accept optional positive `units`, persisted with the security action for statement matching; omit for estimated matching. |
| `GET` | `/api/security-actions` | List projected security/class actions for Alert Stack and Positions. Optional `ticker` filters one security; `includeHistory=true` includes terminal records for Decision History and individual alert detail. |
| `GET` | `/api/weight-policy` | Read the optional weight-management mode, epoch and backend-calculated Ideal wt references. Off by default. |
| `PATCH` | `/api/weight-policy` | Body: `{ "enabled": true, "epoch": 0 }`. Requires the current epoch; stale updates return 409. Turning Off closes unexecuted weight proposals, not recorded trades. |
| `POST` | `/api/security-actions/{id}/record-execution` | Body: `{ "notes": "optional", "units": 10 }`; `units` is optional, positive, and security-scoped (not one amount for a whole class). IG deployments require a funded class-pool ticket and await statement quantity matching. External executions complete manually without IG verification. |
| `POST` | `/api/security-actions/{id}/ignore` | Ignore a non-Exit primary action. Exit actions reject this request. |
| `POST` | `/api/security-actions/{id}/override-exit` | Record an explicit Exit override with required `reason` and optional RFC3339 `next_review_at`; the Exit remains unresolved. |

Expired alerts are system-resolved on read paths that inspect alerts or performance events. They are marked on `alerts` with `resolved_reason = EXPIRED` and surfaced to performance charting as `signal_expired`; they are not inserted into `decisions` as `IGNORE`.

Security action status is one of `OPEN`, `BLOCKED`, `AWAITING_STATEMENT`,
`CONFIRMED`, `VARIANCE`, `IGNORED`, `EXPIRED`, `OVERRIDDEN`, or
`NOT_APPLICABLE`. `GET /api/security-actions` computes the primary security
instruction using the contract priority and returns `queue_count` plus
`is_primary`; it does not manufacture a net target. Open `DEPLOY` actions also
return the current advisory ticket projection: `deployment_state`,
`instruction_value`, `target_value`, `target_shortfall_value`, and class
funding before/after. `FUNDED` is required for normal IG purchase recording.
`CDF_BLOCKED`, `Q4_BLOCKED`, `RISK_UNKNOWN`, `FEED_DISCONNECTED`, `TREND_UNKNOWN`,
`MARKET_BLOCKED`, `CAPACITY_REACHED`, `WEIGHT_LIMIT`, `TARGET_UNAVAILABLE`, `INSUFFICIENT_FUNDS`, and `BELOW_MINIMUM`
remain visible with a reason and no funded instruction.

Optional weight management emits `WEIGHT_REDUCE` security actions and
`WEIGHT_CLASS_REVIEW` class reviews through these same endpoints. Responses carry
`weight_evidence` and, after a proposal closes, `closed_reason`. Recording a
weight reduction additionally requires `expected_instruction_value` matching the
reviewed amount; a changed proposal returns 409 without recording execution.
Class reviews cannot record trades. See [Ideal Weight Management](../system/IDEAL_WEIGHT_MANAGEMENT.md)
for confirmation, freshness and precedence rules.

The standalone Security Action Queue UI was retired on 10 September 2026.
These endpoints, source IDs and persisted records remain in use; no data or
blocking policy was removed. Since 11 September the frontend hides ordinary
statement waits and blocked later signals from the active Alert Stack. Positions
links pending actions to Decision History, which joins `/api/decisions` to action
verification. One primary actionable or variance-review item is shown per scope.
`NOT_APPLICABLE` is deliberately neutral because it also covers simulator resets.

Purchase exceptions use the same `record-execution` endpoint with
`{ "units": 10, "cash_value": 600, "exception_reason": "Order already filled" }`.
The control requires `can_record_purchase_exception: true` from the backend;
an older backend does not enable it. All three fields are required together. Only non-external, security-scoped
DEPLOY actions in OPEN or BLOCKED accept this path. It records an actual trade,
not permission, and leaves other actions unresolved. Returned action history
includes `execution_cash_value`, `execution_exception_reason`, and
`execution_policy_snapshot` (a JSON-encoded audit string), alongside the existing
units and reconciliation state. Invalid evidence returns 400; stale/terminal
actions return 409. No holdings or statement cash are edited.

### Webhooks

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/webhook/tradingview` | Per-security CDF/TMS/price-target signals. |
| `GET` | `/api/webhook/tradingview` | HTML webhook status/debug view. |
| `POST` | `/api/webhook/regime` | Generic regime, Q3 detector, and Q4 detector signals. |
| `POST` | `/api/webhook/etf-rebalance` | ETF momentum rebalance targets. |
| `POST` | `/api/webhook/theme-confirmation` | Scoped commodity-theme confirmation event from TradingView. Current reads are advisory; the target policy derives sequential class and security action signals. |

See [Webhook Contract](WEBHOOK_CONTRACT.md).

Webhook HTTP 200 is now sent only after a durable inbox commit and includes
`receipt_id` and `duplicate`. Business processing remains asynchronous. Storage
failure returns 503. Completed receipts and resolved failures are cleaned after
seven days; unresolved events stay visible. Retry/Dismiss use the existing
`/api/webhook-dead-letters` endpoints. Source-age and ordering guards, legacy
deduplication limits and partial-processing recovery are specified in the
[Webhook Contract](WEBHOOK_CONTRACT.md#recovery-identity-and-retention-8-september-2026).

### Positions, Statements, Holdings

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/positions` | Security position states. |
| `PATCH` | `/api/positions/{ticker}` | Update security position state or manual override. |
| `POST` | `/api/statements/import` | Validate and import a complete current snapshot of the established broker account; older dates and external-position conflicts are rejected. |
| `GET` | `/api/statements` | List statements. |
| `GET` | `/api/statements/latest` | Latest statement with holdings. |
| `GET` | `/api/statements/{id}` | Statement detail. |
| `PATCH` | `/api/holdings/{id}` | Update holding metadata such as cash reserve. |
| `POST` | `/api/cash-movements` | Record a user-declared sleeve-cash intent and update displayed asset-class cash. |
| `GET` | `/api/portfolio` | Portfolio summary. |

### Analysis, Mappings, Groups

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/analysis` | List analysis rows. |
| `POST` | `/api/analysis` | Upsert analysis row. |
| `POST` | `/api/analysis/security-type` | Set `STOCK`, `ETF`, `CVR`, or `NON_ALLOCATING` treatment and primary asset class. Non-allocating types clear class and allocation. |
| `PATCH` | `/api/analysis/{id}` | Update analysis row. |
| `DELETE` | `/api/analysis/{id}` | Delete analysis row. |
| `PATCH` | `/api/analysis/{id}/rename` | Rename analysis row. |
| `POST` | `/api/analysis/{id}/contribute` | Log contribution. |
| `POST` | `/api/analysis/contribute-by-name` | Log contribution by name. |
| `POST` | `/api/analysis/refresh-prices` | Refresh watchlist prices and record advisory listing observations. Returns `updated`, `errors`, `open_reviews`, and `new_reviews`; it never changes identity metadata. |
| `GET` | `/api/analysis/listing-reviews` | List open advisory name/liveness reviews for watchlist identities. |
| `POST` | `/api/analysis/exchanges/auto-assign` | Fill missing exchanges for up to five holding/analysis IDs. Per-item assigned/review/skipped outcomes; preserves existing assignments. Full request/response schema in OpenAPI. |
| `POST` | `/api/analysis/performance/refresh` | Refresh trailing analysis performance metrics, including six-month return where available. |
| `POST` | `/api/analysis/classify-asset-class` | Use the configured xAI/Grok classifier to propose one canonical asset class with confidence and reason. |
| `POST` | `/api/sizing/allocations` | Runtime stock-sizing calculation for Analysis Target Weight. Accepts stock evidence, portfolio value, optional announcement-router scores, and `class_budgets[].class_budget`. The backend deducts each class's effective Core ETF ratio before returning anchored `allocation_dollar`; `class_budget_source` identifies the applied authority. |
| `GET` | `/api/news/brief` | Return the latest persisted macro news brief, active foundation cohort, latest foundation job, news items, theses, and thesis updates. |
| `POST` | `/api/news/run` | Run the xAI/Grok macro narrative job synchronously. This remains the daily-run path and a compatibility path for bootstrap. Body accepts `{ "mode": "daily" }`, `{ "mode": "bootstrap" }`, or `{ "mode": "bootstrap", "source_memo_job_id": "..." }`. Requires `XAI_API_KEY`. |
| `POST` | `/api/news/foundation-jobs` | Start an async foundation job. Body accepts `{ "source_memo_job_id": "..." }`. The job extracts memo candidates, builds research lanes, validates with Grok web search, clusters duplicate thesis families, quality-gates the result, and promotes a new active foundation cohort only on success. |
| `GET` | `/api/news/foundation-jobs/{id}` | Return foundation job status, stage, progress, model, quality score, promoted cohort/run IDs, and error message if failed. |
| `POST` | `/api/news/daily-jobs` | Start an asynchronous daily narrative update for the active foundation cohort. Manual operation remains available; the unified backend worker also schedules at most one active/successful run per UTC date after its configured hour. |
| `GET` | `/api/news/daily-jobs/{id}` | Return daily narrative job status, stage, progress, result linkage, and failure details. The frontend polls this only while the job is queued or running. |
| `POST` | `/api/enrich/tickers` | Enrich ticker mappings. |
| `GET` | `/api/mappings` | List company mappings. |
| `PATCH` | `/api/mappings/{id}` | Update company mapping. |
| `POST` | `/api/mappings/bulk` | Bulk update mappings. |
| `GET` | `/api/groups` | List stock groups. |
| `POST` | `/api/groups` | Save stock groups and assignments. |
| `DELETE` | `/api/groups/{id}` | Delete stock group. |

### ETF

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/etf/policy` | ETF policy readout: minimum ETF exposure and core sleeve ratio. |
| `GET` | `/api/etf/mappings` | Compatibility readout of ETF asset-class assignments stored on `stock_analysis`. |
| `PATCH` | `/api/etf/mappings/{ticker}` | Assign, change, or clear an ETF asset class on `stock_analysis.primary_asset_class`. |
| `GET` | `/api/etf/allocation-ledger` | Backend allocation ledger used by the ETF Monitor. Splits each ETF into actual, core target, tactical target, remaining, and status. |
| `GET` | `/api/etf/management` | Explicit ETF management profiles; funds without a record default to `etf_tms`. |
| `PUT` | `/api/etf/management/{ticker}` | Switch an ETF's management mode, not its classification or allocation model. Requires `mode` and `previous_mode` (`etf_tms` or `tms`), plus `initial_state` (`BUY` or `SELL`). Retires unexecuted old-script actions and requires reconnection in Alerts. Returns 409 for stale mode, unresolved reported execution, or ambiguous exchange symbol. |
| `GET` | `/api/etf/allocations` | ETF target allocations. |
| `POST` | `/api/etf/allocations/rebalance` | Manual ETF allocation rebalance. |
| `GET` | `/api/etf/actual-allocations` | Actual ETF allocations. |
| `GET` | `/api/etf/positions` | ETF tactical position states. |
| `PATCH` | `/api/etf/positions/{ticker}` | Update ETF position state. |
| `GET` | `/api/etf/rebalance` | Active ETF rebalance target. |
| `POST` | `/api/etf/rebalance/{sequence}/dismiss` | Dismiss ETF rebalance target. |
| `GET` | `/api/etf/momentum` | Internal ETF momentum workspace, including the latest evidence run, published run, calculation/data dates, coverage, rows, and backend automation status. |
| `POST` | `/api/etf/momentum/price-history/refresh` | Manual recovery refresh for cached ETF daily prices. The backend automation owns normal daily collection. |
| `POST` | `/api/etf/momentum/runs` | Calculate and persist a versioned internal ETF momentum run from cached prices. Manual runs do not bypass publication cadence. |
| `POST` | `/api/etf/momentum/tradingview-snapshots` | Persist an external TradingView result for parity comparison. It is not the production target source. |

Provider collection, publication cadence, and client polling are different
operations. See [Data Refresh And Freshness](../system/DATA_REFRESH_AND_FRESHNESS.md).

Class-budget update:
`GET /api/etf/allocation-ledger` uses active holdings for ETF capital and reports
`classes[].stock_capacity_value = max(class_target - max(effective_ETF_target,
actual_ETF_value), 0)`. This is capacity, not spendable cash.
Anchored `POST /api/sizing/allocations` resolves the server-approved class budgets
and statement total and returns `class_budget_source` as
`APPROVED_CLASS_MINUS_ETF_TARGET_OR_HELD`, plus `advisory_only: true`.
Legacy unanchored inputs remain advisory and are not purchase authority.
Purchase projections use `pooled-capital-class-budget-v4`, retaining the existing
cash, Q3/Q4 and signal checks and adding the same stock/ETF capacity accounting.

### Regime And Portfolio Risk

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/regimes` | Raw generic regime state. |
| `GET` | `/api/regimes/status` | Computed generic regime status. |
| `GET` | `/api/regimes/returns` | Latest persisted legacy regime return snapshot. This read never calls Yahoo. Before the first refresh it returns `[]` with `X-Data-Freshness-Status: NEVER_RUN`. |
| `POST` | `/api/regimes/returns/refresh` | Manual recovery refresh for the persisted legacy regime return snapshot. Normal collection belongs to the unified backend worker. |
| `GET` | `/api/equity-sizing` | Q3/Q4 detector sizing state and recent history. |
| `GET` | `/api/portfolio-risk/header-state` | Header pullout readout for Q3, Q4, and approved portfolio mix. |
| `GET` | `/api/regime-assignments` | Legacy assignment list. Regimes tab is currently unmounted. |

### Commodity Themes

A baseline of ten commodity and price-taker markets is configured. These routes compute an
advisory theme summary from append-only scoped confirmation events, the current
portfolio mix, and the latest approved target. They do not modify sizing, `IN`
 / `OUT`, cash, or an approved portfolio mix. The summary does not yet provide
the per-security outperformance limits or `REDUCE_TO_OUTPERFORM_LIMIT` actions in
[Commodity Theme Live-Cap Policy v1.0](../decisions/COMMODITY_THEME_LIVE_CAP_POLICY_V1.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/commodity-themes` | Compact market summaries for Markets, Analysis, Positions, and the two source labels in Commodity Connections. Each theme includes a `direct_expression`, direct/equity class-capital values, and non-actionable class reviews. Add `?include_securities=true` when the compact Positions Outperform indicator needs eligible-security states. |
| `POST` | `/api/commodity-themes` | Create a complete direct-commodity and producer-equity market pair. Requires a unique producer asset class, a direct asset class, and both TradingView source configurations. It creates no alerts or directional state. |
| `GET` | `/api/commodity-themes/{code}` | One theme's stages, eligible securities with latest stage evidence, chart-source configuration, direct execution state, and class-capital attribution. |
| `PATCH` | `/api/commodity-themes/{code}/configuration` | Update a market name, group, direct commodity source, or producer-equity pair. The security Outperform denominator follows the configured producer fund. Historical events remain immutable but no longer count if they describe the replaced source; the replacement must be connected and initialised in Alerts. |
| `DELETE` | `/api/commodity-themes/{code}` | Soft-remove a complete market pair from the live Markets and Commodity Connections views. Its configuration and historical evidence remain available in the database. |
| `POST` | `/api/commodity-themes/price-history/refresh` | Refresh cached daily prices for configured direct commodity chart sources. `COMMODITY` stages then expose a price-only `return_60d_pct` and `performance_as_of`; this never changes a confirmation state or action. |
| `POST` | `/api/commodity-themes/initialise-feed` | Register a physical, equity-relative, or security Outperform CDF feed and record the operator-selected current `BUY` or `SELL` baseline. The baseline establishes state only; it never projects an alert, action, position, or allocation change. |
| `PATCH` | `/api/commodity-themes/{code}/direct-expression` | Record `SIGNAL_ONLY` or an explicitly approved direct broker instrument. Markets exposes the per-market editor; `APPROVED` requires `instrument_label` or `instrument_ticker`. It never infers a product from a chart symbol, places a trade, or moves class capital. |
| `POST` | `/api/webhook/theme-confirmation` | Ingest a validated `BUY` or `SELL` class or security-relative CDF event for an already registered feed. `CONNECT` is ignored and never changes market state. `EQUITY_RELATIVE BUY -> SELL` projects one class Strong Trim; security Outperform transitions create visible confirmation/loss alerts, while per-security sizing remains pending. |

The full visual, payload, acknowledgement, validation, and persistence contract
is in [Commodity Theme Presentation And Signal Contract](../system/COMMODITY_THEME_PRESENTATION_AND_SIGNAL_CONTRACT.md).
`confirmation_count` and `confirmation_total` describe the three-step equity
path only. The separate `COMMODITY` stage gates the direct-commodity sleeve
and is returned in `stages` for context.

Class-capital fields keep `invested_value`, `sleeve_cash_value`, and
`capital_value` distinct. `sleeve_cash_value` remains class-locked and is not
portfolio cash or an automatic cross-class transfer instruction.

### Portfolio Risk Actions

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/portfolio-overlay-summary` | Current Q3/Q4 overlay summary and latest workflow event. |
| `GET` | `/api/portfolio-overlay/reconciliation` | Statement reconciliation for active overlay event. |
| `POST` | `/api/portfolio-overlay/apply-stage1` | Confirm recorded Stage 1 reductions. |
| `POST` | `/api/portfolio-overlay/reopen-stage1` | Reopen Stage 1 action fields. |
| `POST` | `/api/portfolio-overlay/mark-stage1-partial` | Save partial Stage 1 progress. |
| `POST` | `/api/portfolio-overlay/save-stage2` | Save Stage 2 target rows. |
| `POST` | `/api/portfolio-overlay/complete-stage2` | Complete Stage 2 after reserve handling. |
| `POST` | `/api/portfolio-overlay/set-baseline` | Accept overlay workflow into baseline/completed state. |
| `POST` | `/api/portfolio-overlay/mark-reviewed` | Close a no-forced-trade Q3 signal after user review. |

### Portfolio Mix And Targets

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/portfolio-mix/current` | Current asset-class mix from live holdings. |
| `GET` | `/api/portfolio-mix/approved` | Latest approved portfolio mix. |
| `POST` | `/api/portfolio-mix/approve-current` | Approve current mix as baseline. |
| `GET` | `/api/portfolio-rebalances/current` | Current portfolio rebalance plan. |
| `GET` | `/api/portfolio-rebalances/current/adjustment-plan` | Current rebalance adjustment plan. |
| `GET` | `/api/portfolio-rebalances/{id}/adjustment-plan` | Specific rebalance adjustment plan. |
| `POST` | `/api/portfolio-rebalances` | Create manual portfolio rebalance plan. |
| `POST` | `/api/portfolio-rebalances/from-memo` | Create rebalance from AI memo. |
| `POST` | `/api/portfolio-rebalances/{id}/mark-partial` | Persist partial recorded moves. |
| `POST` | `/api/portfolio-rebalances/{id}/complete` | Confirm position actions for target. |
| `POST` | `/api/portfolio-rebalances/{id}/approve` | Approve completed target as baseline. |

### Performance

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/performance/portfolio` | Statement-derived portfolio value series. |
| `GET` | `/api/performance/asset-classes` | Statement-derived asset-class value and weight series. |
| `GET` | `/api/performance/security/{ticker}` | Statement-derived security price, units, and value series. |
| `GET` | `/api/performance/events` | Chart event stream for signals, decisions, expiries, risk events, and portfolio target events. |
| `GET` | `/api/performance/security-directions` | Per-security recent movement direction used by UI performance indicators. |

### Config, Sync, Settings

The Terminal resolves class colours through its versioned visual-identity
registry plus saved `asset_class_colour:<CODE>` settings, keyed by
`asset_classes.code`. The header palette menu edits these through
`POST /api/settings`: a `#RRGGBB` value sets an override, an empty string resets
it. Codes must exist in `asset_classes`; invalid codes or colours return 400
before writes. Values are lowercased. These settings are shared by browsers
using the same Terminal backend, not scoped to individual accounts.
`asset_class_config.alert_color` is
legacy presentation metadata retained for compatibility, not a Terminal colour
override. See [Asset-Class Visual Identity](../system/ASSET_CLASS_VISUAL_IDENTITY.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/asset-class-config` | List portfolio-risk asset-class settings and alert presentation metadata. Do not use as an assignment selector. |
| `PATCH` | `/api/asset-class-config/{code}` | Update a portfolio-risk asset-class setting row. |
| `GET` | `/api/asset-classes` | List canonical asset classes for assignment selectors, ETF assignments, target editors, and model packets. |
| `POST` | `/api/asset-classes` | Create a custom fund/ETF allocation class. Requires `display_name` and `quartile`; creates `class_type = CUSTOM` and `analysis_eligible = false`. |
| `GET` | `/api/sync/changes` | Pending sync changes. |
| `POST` | `/api/sync/changes/acknowledge` | Acknowledge sync changes. |
| `GET` | `/api/sync/history` | Sync history. |
| `POST` | `/api/sync/tradingview` | Manual TradingView sync. |
| `GET` | `/api/settings` | App settings. |
| `POST` | `/api/settings` | Update settings. |

## Stateful Contract Details

### `GET /api/portfolio-risk/header-state`

Used by the top-bar portfolio-risk pullout.

Response:

```json
{
  "q3": {
    "target_pct": 35,
    "source": "SPX",
    "active": true,
    "spx_target_pct": 35,
    "xao_target_pct": 49,
    "spx_last_updated": "2026-05-17T00:00:00Z",
    "xao_last_updated": "2026-05-17T00:00:00Z",
    "last_signal_changed_at": "2026-05-17T00:00:00Z",
    "last_applied_pct": 100,
    "last_applied_at": null
  },
  "q4": {
    "active": false,
    "reason": "",
    "target_equity_pct": 0,
    "last_changed_at": null,
    "last_acknowledged_at": null,
    "updated_at": null
  },
  "baseline_mix": {
    "snapshot": null,
    "rows": []
  }
}
```

Persistence read path:

- `equity_sizing`
- `overlay_signal_state`
- `q4_crisis_state`
- `portfolio_mix_snapshots`
- `portfolio_mix_snapshot_rows`

Rules:

- missing Q3 rows return `q3: null`
- missing Q4 row returns `q4: null`
- missing baseline returns `baseline_mix.snapshot: null`
- `SPX` takes precedence over legacy `SPY`
- `spy_target_pct` and `spy_last_updated` may still be emitted as deprecated aliases for older clients

### `GET /api/portfolio-overlay-summary`

Primary Portfolio Risk action summary used by Actions/Positions.

Important response fields:

```json
{
  "effective_equity_pct": 35,
  "spx_target_pct": 35,
  "xao_target_pct": 49,
  "governing_source": "SPX",
  "overlay_status": "REDUCE",
  "portfolio_value": 111000,
  "portfolio_cash_bucket_value": 3000,
  "actual_eligible_invested_value": 56300,
  "allowed_eligible_invested_value": 36990,
  "required_de_risk_value": 19320,
  "available_headroom_value": 0,
  "last_applied_q1_exposure_pct": 100,
  "signal_adjustment_ratio": 0.35,
  "active_event_id": 12,
  "active_event_status": "PENDING",
  "stage1_required_reduction_value": 19320,
  "stage1_recorded_reduction_value": 0,
  "can_apply_stage1": false,
  "can_complete_stage2": false,
  "can_accept_baseline": false,
  "q4_crisis": {},
  "portfolio_risk": {},
  "stage2_workflow": null,
  "asset_classes": [],
  "settings": []
}
```

Deprecated compatibility alias: `spy_target_pct` may still be emitted with the same value as `spx_target_pct`.

Side effects:

- this endpoint reads signal state without creating or superseding overlay events
- it still reconciles Stage-1 cash confirmation against the latest statement
- it can backfill/repair class rows on an existing pending event

It is not entirely side-effect-free. Signal/event synchronisation belongs to the
signal and workflow write paths and explicit `POST /api/portfolio-overlay/sync`.
See [the read/sync contract](../system/ACTIONS_WORKFLOWS.md#readsync-split-2026-06-11).

### `POST /api/portfolio-overlay/mark-stage1-partial`

Persists draft/partial recorded reductions for the active Q3/Q4 event.

Request:

```json
{
  "sources": [
    {
      "holding_id": 123,
      "stock_name": "West Wits Mining Limited",
      "ticker": "WWI",
      "asset_class": "GOLD",
      "group_id": "gold",
      "group_label": "Gold",
      "amount_sold": 5000,
      "before_value": 18000,
      "expected_after_value": 13000
    }
  ]
}
```

Side effects:

- writes `overlay_stage1_sources`
- updates `overlay_events.stage1_recorded_reduction_value`
- can move event status to `PARTIAL`

### `POST /api/portfolio-overlay/apply-stage1`

Confirms recorded reductions for the active Q3/Q4 event.

Request shape matches `mark-stage1-partial`.

Side effects:

- writes final `overlay_stage1_sources`
- updates `overlay_events.stage1_applied_at`
- updates expected reserve fields
- moves workflow toward statement wait/reconciliation

### `POST /api/portfolio-overlay/reopen-stage1`

Reopens a Stage 1 action after statement wait or variance.

Request:

```json
{}
```

Side effects:

- clears or relaxes statement-wait state for the active event
- returns adjustment fields to editable state

### `GET /api/portfolio-overlay/reconciliation`

Compares expected post-action state with latest imported statement.

Reads:

- `overlay_events`
- `overlay_stage1_sources`
- latest `account_statements`
- latest `statement_holdings`
- current `holdings`

Used to decide whether the action can complete or must show variance.

### `POST /api/portfolio-overlay/mark-reviewed`

Closes a Q3 risk-on/no-forced-trade action after the user has reviewed it.

Request:

```json
{}
```

Side effects:

- closes the lightweight action
- must not create a portfolio target
- must not accept a portfolio baseline
- must not require statement evidence

### `GET /api/portfolio-history`

Returns the read-only Portfolio Timeline. `limit` defaults to `120` and is
capped at `250`.

The response merges, but does not conflate, four durable record types:

- `memo` from `portfolio_memo_runs`
- `target` from `portfolio_rebalance_plans` and plan rows
- `shape` from all `portfolio_mix_snapshots`, including superseded snapshots
- `actual` from `portfolio_daily_snapshots` and
  `asset_class_daily_snapshots`, with residual cash represented explicitly

Each entry carries its source identifiers (`memo_job_id`, `plan_id`,
`snapshot_id`, `source_snapshot_id`, or `statement_id`) plus the allocation rows
recorded for that event. `total_value` and `value_basis_at` identify the
historical broker value available for optional dollar comparisons. For proposed
or approved records, this is the latest portfolio snapshot at or before the
record timestamp; for actual records, it is the record's own observed value.
The endpoint has no write side effects.

`GET /api/portfolio-history?kind=shape&limit=100&before_id=N` is the
approved-shape comparison archive. `before_id` is optional on the first request.
It selects only `APPROVED` / `SUPERSEDED` snapshots with an approval timestamp,
before applying the limit, so broker records cannot crowd approvals out.
Responses include `kind: "shape"` and an optional `next_before_id`. Request that
cursor to load an older page; its absence means the archive is exhausted.
Pages use descending snapshot IDs, not offsets, so new approvals do not shift
the cursor. The client orders the loaded snapshots by approval time and ID.
This percentage-only endpoint variant does not attach historical dollar bases.
The existing unfiltered Timeline response and limit behaviour are unchanged.

Both variants resolve a shape's `memo_job_id` through its source rebalance plan,
even when that plan is outside the returned history page. No link is inferred
for manually approved shapes.

### `GET /api/council/portfolio-memos`

Authenticated, read-only Next proxy to Intelligence's saved
`portfolio-positioning-runs` list and detail endpoints. Returns
`{ memos: PortfolioMemoRun[], unavailable: string[], limit_reached: boolean }`.
The latest 50 artifacts are fetched with four concurrent readers and 12-second
timeouts per upstream read. A partial archive returns available memos and failed
run IDs; listing failure is an error, not an empty successful archive.
The caller bearer is validated by the Terminal; the separate Council credential
is server-only. Responses are private/no-store. No jobs or ledger writes occur.

Each memo retains its artifact `run_id`, analysis date, final structured targets
and available analyst/chairman documents. External records use
`memo_job_id = intelligence:<run_id>` until explicitly persisted on draft creation.

### `GET /api/portfolio-memos/{jobId}`

Returns one saved Portfolio Memo by its durable Council job identifier. This is
used to inspect an older analysis and, only after an explicit user action, seed
a new target draft. Reading a memo must not create or mutate a portfolio target.

### `POST /api/portfolio-rebalances`

Creates a manual portfolio target plan.

Request:

```json
{
  "driver": "DISCRETIONARY",
  "title": "New Portfolio Target - May 17th 2026",
  "notes": "",
  "memo_job_id": "",
  "rows": [
    {
      "asset_class": "GOLD_MINERS",
      "display_name": "Gold Miners",
      "display_order": 1025,
      "governed_by_q1": true,
      "current_weight_pct": 22.9,
      "target_weight_pct": 30,
      "recorded_move_value": 0,
      "note": ""
    }
  ]
}
```

Response:

```json
{
  "plan": {
    "id": 7,
    "status": "OPEN",
    "driver": "DISCRETIONARY",
    "title": "New Portfolio Target - May 17th 2026",
    "rows": []
  }
}
```

Side effects:

- supersedes other open/current rebalance plans where backend logic requires it
- inserts `portfolio_rebalance_plans`
- inserts `portfolio_rebalance_plan_rows`
- validates and normalises every row against `asset_classes`
- accepts legacy/current class codes such as `GOLD` only when they map to a
  recognised canonical class such as `GOLD_MINERS`

### `GET /api/portfolio-rebalances/{id}/adjustment-plan`

Builds the user-facing action plan for one portfolio target.

Important response fields:

```json
{
  "plan": {
    "id": "portfolio_rebalance:7",
    "source_type": "PORTFOLIO_TARGET",
    "source_status": "OPEN",
    "stage": "action_positions",
    "required_decrease_value": 49440,
    "recorded_decrease_value": 0,
    "remaining_decrease_value": 49440,
    "required_increase_value": 38935,
    "recorded_increase_value": 0,
    "remaining_increase_value": 38935,
    "ready_to_confirm": false,
    "rows": []
  }
}
```

Rules:

- decreases are actionable first
- increases are pending until cash is available
- the endpoint computes live deltas from current portfolio value and target rows

### `POST /api/portfolio-rebalances/{id}/mark-partial`

Persists user-entered recorded movement values.

Request:

```json
{
  "rows": [
    {
      "asset_class": "GOLD",
      "recorded_move_value": 13472
    }
  ]
}
```

Side effects:

- updates `portfolio_rebalance_plan_rows.recorded_move_value`
- can set plan status to `PARTIAL`

### `POST /api/portfolio-rebalances/{id}/complete`

Confirms position actions for the target.

Request:

```json
{
  "rows": [
    {
      "asset_class": "GOLD",
      "recorded_move_value": 13472
    }
  ]
}
```

Side effects:

- writes recorded move values
- sets `portfolio_rebalance_plans.status = COMPLETED`
- sets `completed_at`
- does not approve baseline

### `POST /api/portfolio-rebalances/{id}/approve`

Approves a completed portfolio target as the new baseline.

Request:

```json
{}
```

Side effects:

- creates a new `portfolio_mix_snapshots` row
- creates `portfolio_mix_snapshot_rows`
- marks earlier approved snapshots `SUPERSEDED`
- marks plan `APPROVED`

### `POST /api/statements/import`

Imports broker/account statement and holdings.

Request:

```json
{
  "account": {
    "account_name": "Share trading",
    "statement_date": "2026-05-17T00:00:00Z",
    "total_value_aud": 21000,
    "cash_aud": 3000,
    "usd_value": 0,
    "usd_aud": 0,
    "gbp_value": 0,
    "gbp_aud": 0,
    "aud_value": 18000
  },
  "holdings": [
    {
      "details": "West Wits Mining Limited",
      "ticker": "WWI",
      "exchange_prefix": "ASX:",
      "quantity": 100000,
      "cost_aud": 12000,
      "current_price": 0.18,
      "value_aud": 18000,
      "gain_loss_aud": 6000,
      "gain_loss_pct": 50,
      "currency": "AUD",
      "market_value": 18000,
      "cash_reserve": 0
    }
  ]
}
```

Side effects:

- upserts `account_statements`
- replaces `statement_holdings` for that statement
- updates current `holdings`
- writes sync history/change rows where applicable
- can unlock or validate waiting action workflows through later summary/reconciliation calls

Import safety contract (8 September 2026):

- Required account fields: nonblank `account_name`, `statement_date`, positive
  `total_value_aud`, explicit `cash_aud`. `holdings` must be an explicit array.
  Each row needs a nonblank `details` and `currency`, explicit nonnegative
  `quantity`, and `value_aud` or `market_value_native`, including deliberate zero.
- Native USD/GBP amounts require valid native/AUD summary pairs. Missing FX
  cannot silently convert native amounts 1:1. Holdings plus broker cash must
  reconcile to the reported AUD total after conversion. The rounding allowance
  is `max(AUD 1, AUD 0.02 + sum(0.01 * max(1, currency-to-AUD rate)))`, not a
  percentage of portfolio value. Earmarked `cash_reserve` is not extra cash.
- Reject malformed/missing fields, negative long-only quantities/values,
  duplicate names/ISINs, inconsistent totals and implausible future dates with
  HTTP `400`. At most the next UTC calendar date is accepted for Australian
  broker dates. A zero-total account closure requires review; a positive-value
  all-cash statement with `holdings: []` and zero-value rights remain supported.
- The first import establishes the account name. Subsequent imports must match
  the latest account name, ignoring case and surrounding whitespace. A different
  account, an older statement day, contradictory ISIN, repeated resolved identity,
  or collision with an externally flagged security returns HTTP `409`.
- A same-day correction replaces the same statement record and current book,
  but does not start action reconciliation. A newer statement day may reconcile
  actions after the import commits. Both successful cases retain HTTP `201`.
- An omitted external holding stays active. Omitted IG holdings become inactive
  only after validation. Existing matched IDs are preserved even if an incoming
  row omits an ISIN. Missing ISINs use SQL NULL, not a shared empty identifier.
- Required holdings, identities, Analysis state, sync history and performance
  snapshot writes share a transaction; read/write errors return HTTP `500` and
  roll back. Action reconciliation remains a separate post-commit operation.

This endpoint is not a historical-backfill or multi-broker merge API. There is
no new import approval screen. Totals validation cannot detect an extraction
error that still balances, or prove completeness of zero-value positions.
Original-document retention and append-only correction history remain separate
work; same-day corrections replace their prior snapshot as before.

### `POST /api/cash-movements`

Records the user's declared source intent for an asset-class sleeve-cash edit.
This endpoint updates the displayed sleeve cash in `asset_class_config.cash_reserve`
and writes a `cash_movements` audit row. It does not attempt to infer broker-side
cash provenance before the next statement import.

Request:

```json
{
  "asset_class_code": "GOLD_MINERS",
  "target_cash_reserve": 5000,
  "source_type": "PORTFOLIO_CASH_TRANSFER",
  "note": "Allocate idle cash to Gold Miners sleeve"
}
```

`source_type` must be one of:

- `PORTFOLIO_CASH_TRANSFER`
- `STOCK_SALE`
- `EXTERNAL_CAPITAL`

Response:

```json
{
  "movement": {
    "id": 12,
    "asset_class_code": "GOLD_MINERS",
    "amount_delta": 500,
    "previous_cash_reserve": 4500,
    "target_cash_reserve": 5000,
    "source_type": "PORTFOLIO_CASH_TRANSFER",
    "note": "Allocate idle cash to Gold Miners sleeve",
    "status": "PENDING",
    "created_at": "2026-06-15T10:12:00Z"
  },
  "asset_class_config": {
    "code": "GOLD_MINERS",
    "display_name": "Gold Miners",
    "cash_reserve": 5000
  }
}
```

Side effects:

- inserts one `cash_movements` row
- updates `asset_class_config.cash_reserve` for the selected class
- inserts one `decisions` row with decision `CASH_ALLOCATION`
- sets status to `PENDING` for declared funding sources
- an explicit `PORTFOLIO_CASH_TRANSFER` replacement cancels prior pending or
  mismatched sale/deposit intents for that class, without confirming their source

Displayed reserves are proposals, not proof of spendable cash. The purchase
projector excludes positive pending sale/deposit increments and requires the
aggregate usable proposals to fit statement cash. Outstanding purchase
commitments reserve cash before new tickets. See
[Pooled Capital Policy](../system/POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).

IG purchase execution through either `POST /api/decisions` or
`POST /api/security-actions/{id}/record-execution` uses the same atomic funding
check. An unfunded purchase returns `409` without recording a decision or
resolving the alert. Successful execution returns `status`, decision `id`, and
`message`. Optional units may increase the reserved AUD estimate above the
suggested ticket; an unknown or unaffordable estimate returns `409`.
The v3 implementation also rechecks class risk/feed permission and
class/security target room. Explicit exceptions above may record an already
executed purchase despite those restrictions; their full reported AUD amount
remains reserved until statement reconciliation. The legacy `/api/decisions`
path does not implicitly create exceptions.

## Required API Improvements

1. Generate OpenAPI from Go structs or a maintained schema file.
2. Return consistent structured errors.
3. Split read-only summary endpoints from mutating workflow-sync endpoints.
4. Add endpoint-level tests proving side effects for Q3, Q4, statement import, and portfolio target approval.
5. Remove or explicitly isolate legacy Regimes-tab assignment endpoints if they are no longer part of the UI.
