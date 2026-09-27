# Analysis And Council Pipeline

Audit date: 5 June 2026.

This document describes the Analysis workspace and its Analyst Council
integration. It covers research data, ratings, price targets, asset-class
routing, and links to external Council runs.

The Council is a capability of the separate Alpha Edge Intelligence Service;
the Trading Terminal remains the owner of analysis-row persistence and all
user-facing actions. The canonical service boundary is in
[Alpha Edge Product Architecture](PRODUCT_ARCHITECTURE.md).

## Ownership

| Layer | Responsibility |
| --- | --- |
| Backend | Stores analysis rows, validates asset classes, refreshes performance metrics, calls xAI classifier, persists council result fields. |
| Frontend | Presents analysis rows, editing controls, council launch/status UI, and links to council run artefacts. |
| Analyst Council (Intelligence Service) | Runs research jobs, produces report packets, Gantt/thesis map, and model outputs. |

Relevant frontend API routes:

```text
app/api/council/jobs
app/api/council/jobs/{jobId}
app/api/council/jobs/{jobId}/result
app/api/council/runs
app/api/council/runs/{runId}
app/api/council/runs/latest
```

Relevant backend routes:

```text
GET /api/analysis
POST /api/analysis
PATCH /api/analysis/{id}
POST /api/analysis/security-type
POST /api/analysis/classify-asset-class
POST /api/analysis/performance/refresh
```

## Positions Ideal Weight (18 September 2026)

Both views use `CalculateAllocations`. Analysis calls the read-only
`POST /api/sizing/allocations` with non-ETF stocks included in sizing. Positions
reads `/api/weight-policy`, which derives held direct stocks and research from
the backend, regardless of Analysis IN/OUT. Watchlist, external and
non-allocating instruments are excluded from that Positions universe; nonzero
units still count when valuation is zero. Membership is not derived from table
filters, collapsed groups, pending trades or signals.

`useSizingAllocations` remains the Analysis request path; Positions does not
submit browser scores as purchase authority. The holdings projection uses the engine's
unrounded within-class percentage and the ETF ledger's canonical class budget:

```text
Ideal wt = allocation_pct * stock_capacity_value / class_target_value
ETF Ideal wt = effective_target_value / class_target_value * 100
stock_capacity_value = max(0, class_target - max(effective_ETF_target, held_ETFs))
```

See [ETF allocation](ETF_ALLOCATION.md) for budget ownership. The result is a
display-only projection by default, not a rebalance instruction, cash movement, persistent
security target or change to Q3/Q4 permissions. Group/parent rows do not aggregate
percentages with incompatible class denominators. Missing research is warned in
Analysis's existing Data issues surface. If any held direct stock lacks a complete
primary-model Q/V/PT result or a positive current price, all direct-stock
references in that class are unavailable. Positions shows dashes, not weights
renormalised over a partially researched set. Complete classes and Core ETF
policy targets are unaffected; unheld watchlist gaps do not enter the check.
No concentration cap or basket-approval workflow is introduced.

The subsequently approved [Ideal weight management policy](IDEAL_WEIGHT_MANAGEMENT.md)
defines an optional replacement for the legacy individual purchase ceiling,
using backend persisted research for the held-stock reference. It is Off by
default; On constrains purchases without changing Analysis IN/OUT.
Positions now reads that same backend reference from `/api/weight-policy`.

The isolated demo uses only fixture identities and simulated research, and honours
the requested stock subset. It never forwards sizing requests to private services.
Tests: `npm run test:positions-model-weight`, `npm run test:analysis-metrics`,
`npm run test:access`, and `node --test tests/positions-model-weight.browser.test.cjs`.

## Monitoring Coverage (11 September 2026)

Analysis and Positions use [one indicator](../../components/alert-status-indicator.tsx)
backed by the pure [coverage projection](../../lib/monitoring-coverage.ts).
This is a read-only connection-ledger view, not a trade permission, current
direction, provider-health check or fresh-event assertion.

| Instrument/profile | Required connections |
| --- | --- |
| Stock, non-commodity class | CDF and TMS for that security |
| Stock, configured commodity producer class | CDF, TMS, and security/equity-benchmark Outperform CDF |
| ETF, `etf_tms` profile (default) | ETF TMS |
| ETF, `tms` profile | CDF and TMS; no stock Outperform requirement |

The producer-class benchmark comes from `GET /api/commodity-themes`:
`tactical.asset_class_code` maps to the `EQUITY_RELATIVE` stage's
`source.numerator`. This mapping and ticker/script normalisation are shared with
Alerts. They are not a hardcoded list of commodity classes or a Core ETF policy.
Changing a benchmark invalidates coverage against the old ratio. The existing
commodity-configuration event refreshes the mapping immediately.

`GET /api/alerts/active` supplies recorded connections; `GET /api/etf/management`
supplies fund profiles. Existing connection polling and tab navigation refresh
them. Full coverage requires every required connection; partial coverage names
the missing connections. No required connections is red. Missing/unavailable
configuration or connection/profile data is neutral, never assumed complete.
ETF coverage remains independent of commodity-configuration availability.

`atr_oscillator` aliases TMS and `etf_cdf` aliases ETF TMS. `ASX_DLY`/`ASX`
and `BATS`/`AMEX` follow existing Alerts aliases. Fully qualified tickers on
different exchanges do not match. Legacy unqualified single-symbol connections
retain symbol matching; ratio feeds require both normalised sources and cannot
satisfy either leg's standalone CDF. Old ETF-script records cannot satisfy a
stock or a TMS-managed fund. A recorded Sell connection counts just like Buy.

This change does not modify backend signal processing, allocation or initial
direction rules. Regression commands are in Testing.

## Announcement Subscription Setup

`GET/PATCH /api/announcement-subscriptions` provides a manual setup ledger, not
a provider subscription API or delivery-health check. Migration 0006 adds
`security_announcement_subscriptions`, keyed by stable `security_id`, with the
provider (`HOTCOPPER` or `SEEKING_ALPHA`), confirmed exchange/ticker, confirmation
time and update time. Existing records are not auto-confirmed.

The GET projects active nonzero holdings plus the Analysis universe, independent
of IN/OUT. NON_ALLOCATING and CVR instruments are excluded. Linked held/research
copies appear once. An unlinked fully qualified listing can resolve to an
existing identity without a GET write; a mutation links/creates identity when
needed. Provider defaults in the UI are suggestions, not stored confirmations.
ASX (including ASX_DLY) suggests HotCopper; every other known exchange suggests
Seeking Alpha. Missing exchange identity remains unresolved. Saved explicit
provider selections are retained unless the listing needs rechecking, when the
default is recalculated from the current exchange. This does not assert provider
coverage or validate external routing configuration.

PATCH validates up to 100 explicit selections atomically, checks their current
listing against the client snapshot, and rejects missing ticker/exchange on
confirmation. Resets retain provider but clear confirmation. A changed ticker or
exchange invalidates effective setup until reconfirmed. Restart and holding-row
replacement retain the record through security identity. GET never writes.

Alerts exposes an **Announcements** section with a missing-setup count and a
visible reminder above the other connection tables. The searchable inline list
supports bulk confirmation, reset and provider links; it is not in Analysis's
Data issues and does not use a separate dialog. It refreshes with the
existing holdings lifecycle and after setup mutations, without new provider
polling. The demo has read-only synthetic unconfirmed entries.

This ledger is deliberately separate from TradingView monitoring, source research,
announcement receipt and score calculation. No changes to signal processing,
trade permissions, weight availability, automatic router scores or alert queues.
A provider email subscription still needs the external mailbox/ingestion path to
be configured. Neither email silence nor a setup checkbox proves delivery.

See [user setup](../user/alerts.md#set-up-announcement-emails),
[API contracts](../api/contracts.json) and
[implementation](../../backend/announcement_subscriptions.go).

## Council Access And Submission Safety

This is a bounded caller-check and retry correction, not a multi-user
authentication system.

The browser uses its existing trading API bearer token for every
`/api/council/*` request, including job lists/results, run reports and Router
signals. Before any Council request, the Next proxy validates that token with
`GET /api/auth/check` on the configured trading backend. Only an authenticated
`204` allows forwarding. Missing/invalid caller tokens return `401`; an
unavailable validator returns `503` and does not contact Council. A public
health `200` is never accepted as authentication. `AUTH_DISABLED=true` also
fails closed for this check.

No new key is introduced and the proxy does not need a duplicate backend
`API_TOKEN`. The backend remains the token authority. The existing server-only
`COUNCIL_API_TOKEN` authenticates the separate upstream service and is never
sent to the browser or to the trading backend. Portfolio-result persistence
uses the authenticated caller's token rather than another stored copy.

Job submission makes **one attempt per invocation** in both browser and proxy,
for JSON and multipart requests. The proxy forbids retries for non-read methods
even if a caller requests them. Reads retain bounded retry behaviour. The
browser submission timeout is 45 seconds; proxy submission is 35 seconds plus
the bounded 5-second caller validation. Response-body reading is covered by
the timeout, not just arrival of HTTP headers. Redirects are not followed by
the server-to-server requests.

| Outcome | Meaning and user behaviour |
| --- | --- |
| Successful response with job ID | Submission accepted; poll that job ID. |
| Malformed request or explicit rejection | Submission rejected; fix the input/configuration. No automatic POST retry. |
| Caller validation unavailable or Council not configured | `submission_status: not_submitted`; no upstream job request was made. |
| Council service credentials rejected | `COUNCIL_AUTH_REJECTED`, returned as `502`, not a caller `401`. Do not erase the user's valid token. |
| Lost connection, timeout, upstream 5xx/408, or success without usable job ID | `COUNCIL_SUBMISSION_UNCERTAIN`, `submission_status: uncertain`. Council may already be running the job. Check existing jobs in Alpha Edge Intelligence before submitting again. |

The client does not convert an uncertain submission into a confirmed failure.
Stock analysis shows the uncertain message; Portfolio Memo persists
`submission_uncertain` locally and restores its warning after refresh. It does
not invent a job ID or begin polling without one. Layouts and research logic
are unchanged.

Limits: this is not exactly-once delivery. Deliberate repeat clicks, another
browser/device or an upstream internal retry can still create duplicate jobs.
Durable idempotency and lookup by submission ID require a compatible Intelligence
service contract; that service is outside this repository. This change does
not automatically locate an ambiguously accepted job or automatically resubmit.

## Analysis Row Fields

`stock_analysis` stores the working analysis state.

Important fields:

| Field | Meaning |
| --- | --- |
| `ticker`, `name` | Security identity. |
| `primary_asset_class` | Canonical `asset_classes.code`; null for non-allocating instruments. |
| `security_type` | `STOCK`, `ETF`, `CVR`, or `NON_ALLOCATING`. |
| `current_price` | Latest known analysis price, not necessarily broker statement truth. |
| `grok_quality`, `gemini_quality`, etc. | Model-specific quality scores. |
| `grok_value`, `gemini_value`, etc. | Model-specific value scores. |
| `*_pt` | Model or source-specific price target. |
| `council_quality`, `council_value`, `council_pt` | Aggregated council outputs. |
| `council_run_id`, `council_run_label` | Link back to the external council run. |
| `bear/base/bull_case_pt` and probabilities | Scenario path values where available. |
| `catalysts` | Catalyst text used in the analysis table. |
| `is_watchlist`, `is_external` | UI classification flags. |

## Price Target Rules

`AVG PT` should be a computed value, not a stale hand-maintained truth.

Preferred rule:

```text
avg_pt = mean(valid positive PT fields)
```

Candidate fields include:

```text
grok_pt
gemini_pt
gpt_pt
deer_flow_pt
perplexity_pt
claude_pt
council_pt
tipranks_pt
analyst_pt
bear/base/bull probability-weighted PT where available
```

Manual edits to an individual PT field are allowed where provider values are
wrong after a split, consolidation, or bad upstream data. Backend logic that
needs AVG PT should compute it at runtime rather than reading a stale `avg_pt`
database column.

## Asset Class Performance

Analysis hierarchy headings show the average six-month return as a percentage,
replacing the stock count, held value, portfolio share and average research
score. The repeated "6M avg" label is omitted; hover explains the measure.
This is the arithmetic mean
of the group's available `performance_6m_pct` adjusted-close price returns,
equally weighted across held and watchlist securities. Parent groups aggregate
their securities directly, not averages of child averages. Search and view
filters determine the included securities; collapsing a group does not change
its average.

The individual **MOM** cells also display and sort by `performance_6m_pct`
for both stocks and ETFs, preserving the existing ETF-first grouping. The
shared Analysis history pipeline supplies ETF returns even when a fund is
outside the ETF ranking universe. The period is six calendar months before
the latest available price, using the last available observation on or before
that anchor. A missing anchor remains unavailable, with no fallback to the
ETF engine. Only stocks retain the sizing modifier on hover; ETF sizing,
ranking and publication are unchanged.

ETFs use the same six-month dataset here, not the separate ETF engine's
80-session momentum return or score. Missing/non-finite values are excluded;
zero is a valid return. No valid observations display a neutral dash. Returns
are not capped by the stock-sizing momentum formula. Positive/negative values
use the existing success/destructive theme colours; zero is neutral.

Hover reveals coverage and the oldest price-data date. A **Stale** marker means
at least one included return is more than five days old or has no valid date,
matching the existing Analysis freshness threshold. This describes the current
Analysis universe, not a sector index, portfolio P/L, or a holdings-weighted
investment return. It is display-only and changes no allocation or signal logic.

## Ratings Total

The current business rule is:

```text
base_rating = average(quality_score, value_score)
performance_score = clamp(6m_return_pct, -40, 40) mapped to 0..5
ratings_total = base_rating + performance_score
```

Performance contribution:

- maximum: `+5`
- minimum: `0`
- `0%` six-month performance maps to `2.5`
- returns above `+40%` do not receive extra credit
- returns below `-40%` do not receive extra penalty beyond the floor

Positive performance values must render with the positive theme colour; negative
values must render with the destructive theme colour.

## Target Weight

Target Weight is the runtime stock-sizing output shown in the Analysis tab. It is
calculated by the backend endpoint `POST /api/sizing/allocations`; it is not a
stored database field. The frontend uses the backend result when available and
falls back to its local formula only if the sizing request is unavailable.

Backend formula:

```text
avg_pt = mean(all positive PT inputs)
upside_pct = (avg_pt - current_price) / current_price * 100
provider_score = (quality_score + value_score) / 2
base_rating = mean(completed Gemini, Perplexity, GPT, and Claude provider scores)
performance_score = 2.5 + (clamp(6m_return_pct, -40, 40) / 40) * 2.5
composite_score = base_rating + performance_score, only when base_rating > 0
composite_score = 0, when no completed model score exists
upside_multiplier = max(0, 1 + upside_pct / 20)
raw_weight = (composite_score * upside_multiplier) ^ 2
router_multiplier = 1 + clamp(router_score, -5, 5) * 0.03
effective_weight = raw_weight * router_multiplier
target_weight_pct = effective_weight / sum(all_effective_weights) * 100
```

The announcement-router score is optional and capped. A `+5` router score gives
a `+15%` weight modifier; a `-5` router score gives a `-15%` weight modifier.
Missing router data leaves the weight unchanged.

The upside multiplier is floored **before** squaring. At or below `-20%`
implied upside, the raw and effective weights are zero; a positive Router
modifier cannot restore them. Above `-20%`, the existing curve is unchanged.
If every weight in a class is zero, all of its suggested allocations remain
zero rather than being divided equally or transferred to another class.
This changes sizing suggestions only, not holdings, approved class budgets,
or CDF/TMS sell instructions. It does not introduce a concentration cap or
change the existing missing-price policy.

## Asset-Class Classification

The app has two classification paths:

1. Manual user assignment from active `asset_classes`.
2. xAI/Grok-assisted classification through `/api/analysis/classify-asset-class`.

The classifier must:

- use web-capable model behaviour where available
- return one canonical `asset_classes.code`
- include confidence and a short reason
- reject results not present in `asset_classes`
- never write hidden hardcoded defaults

The user remains able to override the assignment.

## Template Routing

The compact Research templates library shares one selection between source-only
retrieval and full Web UI analysis prompts. Stock-specific **Source research**
uses explicit Parallel Ultra 4x jobs and persists packets separately from Council
results. See [Source research](SOURCE_RESEARCH.md) for the contract, costs,
idempotency and attachment workflow. The copy-only manual router is retired;
the existing class-to-template mapping below remains authoritative for Council.

Council research must use the asset-class research lane matching the security's
canonical asset class. Example:

```text
stock_analysis.primary_asset_class = GOLD_MINERS
research template = gold_miner
```

Rules:

1. Template routing must be explicit and reviewed when asset classes change.
2. A missing mapping should fail visibly or fall back to `general_equity` with a
   recorded reason.
3. The app must not silently route `GOLD_MINERS` to `general_equity` because of
   a display-name mismatch.
4. Changes to research templates may need corresponding changes in the external
   Intelligence Service project.

## Council Run Linking

When a council run completes, Alpha Edge should store:

- `council_run_id`
- `council_run_label`
- returned quality/value/PT fields
- any report packet metadata needed by the UI

The Gantt/thesis map should link to the original Council run. The Announcement Router
must refer back to the saved run rather than rendering an unrelated placeholder
path.

## Known Gaps

1. Template mapping is not documented as a full table in this repo.
2. The external Intelligence Service contract is not versioned here.
3. Failed council runs need a clearer UI and persistence contract.
4. Split/consolidation correction rules for provider PT values are manual.
5. The analysis tab remains sensitive to large render payloads such as embedded
   chart/thesis content; heavy content should load on demand.
