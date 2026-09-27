# Webhook Contract

Audit date: 29 May 2026.

The per-security payloads below match the CDF, TMS and ETF TMS exports as of
September 2026. Live TradingView alert configuration is not verified here.

TradingView webhooks are split by business level. Do not route every script to one endpoint.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/webhook/tradingview` | Per-security CDF/TMS/price-target signals. |
| `POST /api/webhook/regime` | Generic regime state, Q3 detector, and Q4 detector signals. |
| `POST /api/webhook/etf-rebalance` | ETF momentum rebalance payloads. |
| `POST /api/webhook/theme-confirmation` | Scoped commodity-theme confirmation payloads. Live reads are advisory; the target policy also derives class and per-security action signals. |

Q3 and Q4 detector packets must use `/api/webhook/regime`. The backend rejects Q3/Q4 detector packets sent to `/api/webhook/tradingview`.

## Commodity Theme Confirmation

`POST /api/webhook/theme-confirmation` is reserved for the commodity-to-equity
transmission framework. It must not reuse the generic regime webhook because a
theme confirmation has stage, source-series, and optional stable-security
identity that generic `ticker + signal` state cannot represent.

The endpoint is live for the configured commodity-market registry. A Gold theme-level relative-strength
confirmation payload is:

```json
{
  "event_id": "gold-gdx-gold-2026-08-05-1d",
  "theme": "GOLD",
  "stage": "EQUITY_RELATIVE",
  "scope": "THEME",
  "signal": "BUY",
  "script": "cdf",
  "signal_version": "cdf.relative.v1",
  "source": {
    "kind": "RELATIVE_STRENGTH",
    "numerator": "BATS:GDX",
    "denominator": "BATS:GLD",
    "label": "Gold equities / gold"
  },
  "timeframe": "1D",
  "bar_closed_at": "2026-08-05T20:00:00Z",
  "close": 1.4321
}
```

The endpoint accepts theme-level commodity and equity-relative events plus a
security-scoped `SECURITY_OUTPERFORM` event when a resolvable security ticker
is supplied in `security.ticker`. CDF remains the canonical per-security trend,
deployment, and action state delivered through `/api/webhook/tradingview`.
Each commodity-enabled asset class posts its class-scoped events and a security
posts only one additional core-fund relative CDF signal: `SECURITY_OUTPERFORM`.
`SECURITY_TREND` remains an advisory compatibility read model; the retired
`SECURITY_LEADERSHIP` transport is no longer active. Theme evidence must not
trade, move cash, or change `IN` / `OUT`.

Before a theme feed may update state, its checkbox must be confirmed in Alerts.
That setup records the current `BUY` or `SELL` baseline through
`POST /api/commodity-themes/initialise-feed` and creates the matching CDF
connection in `active_alerts`. The webhook rejects a `BUY` or `SELL` source not
registered in that ledger. TradingView `CONNECT` payloads are ignored without
persistence or state changes, because server restarts can emit them repeatedly.

For a Gold Miner, the CDF relative alert may send TradingView-native symbols:

```json
{
  "event_id": "gold-aevt-outperform-2026-08-10-1d-sell",
  "theme": "GOLD",
  "stage": "SECURITY_OUTPERFORM",
  "scope": "SECURITY",
  "signal": "SELL",
  "script": "cdf",
  "signal_version": "cdf.relative.v1",
  "security": { "ticker": "ASX_DLY:AEVT" },
  "source": {
    "kind": "RELATIVE_STRENGTH",
    "numerator": "ASX_DLY:AEVT",
    "denominator": "BATS:GDX"
  },
  "timeframe": "1D",
  "bar_closed_at": "2026-08-10T06:00:00Z"
}
```

The validator canonicalises `ASX_DLY:` to `ASX:` and permits `BATS:` for the
same configured `AMEX:` ETF. It retains the original TradingView source pair
in the append-only event for audit.

### Target Action Semantics

The webhook remains evidence transport. It sends closed-bar state transitions;
the policy layer decides whether a user-facing alert follows. Alert, operator
decision, execution report, and statement reconciliation semantics are owned by
[Signal And Action Contract](../system/SIGNAL_AND_ACTION_CONTRACT.md).

| Event | Target consequence |
| --- | --- |
| `EQUITY_RELATIVE: BUY -> SELL` | Emit one class-scoped `EQUITY_REGIME_STRONG_TRIM` signal: 20% of current producer-equity holdings in the mapped class. Block direct-equity entries, TMS adds, breakouts, and re-entries while state remains `SELL`. |
| `EQUITY_RELATIVE: SELL -> BUY` | Restore producer-equity deployment permission. Do not create a buy. |
| `SECURITY_OUTPERFORM: BUY -> SELL` | Record one security-scoped `OUTPERFORM_LOST` alert. Once the live 75/100 capacity projection exists, it will also emit `REDUCE_TO_OUTPERFORM_LIMIT` when the holding exceeds its 75% cap. |
| `COMMODITY: BUY -> SELL` | Record the direct-commodity regime change only. The physical/direct-commodity exit policy remains separate and must not affect producer equities. |

`EQUITY_REGIME_STRONG_TRIM` is not a TMS oscillator `strong_trim`. It carries
the theme event as source, applies to the class's direct miners and mapped
producer ETFs, and excludes physical/direct commodity holdings. Action signals
remain chronological. The backend must not combine them into a net target or
submit a broker order.

The route sends `200 {"status":"accepted","type":"theme_confirmation",...}`
only after committing a durable inbox receipt, before asynchronous processing.
Failures are retained in the dead-letter queue.
See [Commodity Theme Presentation And Signal Contract](../system/COMMODITY_THEME_PRESENTATION_AND_SIGNAL_CONTRACT.md)
for the full request/response contract and validation rules.

## Dead-letter queue (added 2026-06-11)

All four webhook routes now commit a `webhook_inbox` receipt before returning
HTTP `200 accepted`. The response includes `receipt_id` and `duplicate`.
Malformed envelopes return 400; an event ID reused with a different body
returns 409; persistence failure returns 503, never a false acceptance. Existing
URLs, credentials and business-level payloads remain unchanged.

One worker processes pending receipts in arrival order. HTTP errors and panics
become linked `webhook_dead_letters` in the existing Failed Signals UI. The
inbox and that failure record are updated transactionally. No new user page or
message-broker service is introduced. URL query strings, Authorization headers
and the body `secret` are not retained. Existing dead-letter query strings are
removed on initialization, and failure logs no longer print raw payloads.

Endpoints: `GET /api/webhook-dead-letters` (`?include_resolved=true` for history), `POST /api/webhook-dead-letters/{id}/retry` (re-dispatches the stored payload to the original processor; success resolves the row, failure increments `retry_count` and keeps it visible), `POST /api/webhook-dead-letters/{id}/dismiss`.

### Recovery, Identity And Retention (8 September 2026)

- `PENDING` receipts survive restarts and resume automatically. If processing
  started but completion was not saved, the receipt becomes `FAILED` for review.
  The processors have multiple independent writes, so blindly replaying that
  ambiguous attempt could duplicate an action. Check current state before Retry.
- Explicit string `event_id` values deduplicate within each webhook type while
  the receipt exists. Without an ID, a recognized source timestamp plus the
  canonical payload provides identity. With neither, only consecutive identical
  packets from the same source within 60 seconds are suppressed. An intervening
  opposite signal is not suppressed. Legacy payloads cannot provide exact
  duplicate detection across arbitrary delays; add event identity when updating
  scripts, but existing alerts need not be rebuilt for this release.
- Recognized source dates are RFC3339 `bar_closed_at`, `timestamp`, or `time`,
  plus the ETF route's `rebalance_date` (UTC date). A packet received or dated
  more than 24 hours ago is retained for review, not executed as a new trading
  instruction. Retry does not bypass this guard; dismiss and obtain current
  source evidence. This is a transport recovery guard, separate from existing
  action-expiry rules.
- Where dates are supplied, an event older than an already-processed event
  from the same source is held for review. Source identity uses route, ticker,
  script, timeframe and applicable theme/stage/security/ratio fields, excluding
  display labels. Undated packets can only be ordered by receipt, not source time.
- An hourly cleanup removes `PROCESSED` and `DISMISSED` receipts seven days
  after completion/resolution. Resolved dead-letter rows older than seven days
  are also removed once no receipt references them. Active failures and pending
  work are never deleted just because they are old. Old pending work is moved
  to review by the worker rather than silently dropped.
- Cleanup never deletes alerts, decisions, commodity evidence or portfolio
  history. SQLite reuses freed pages; routine cleanup does not run VACUUM.
  Deduplication receipts are not a permanent event-identity archive.

`PROCESSED` means the existing synchronous handler returned a status below 400;
it does not independently certify every business projection. Failed handlers
may have partial effects. The worker and Retry/Dismiss are serialized in the
current single backend process; multi-worker leases and fully transactional
domain processing are not part of this implementation. Database-write failures
leave the receipt recoverable and log an operational error, without logging
credentials. The worker retries persistence/recovery on subsequent cycles.

## Ticker Format

Preferred per-security format:

```json
{
  "ticker": "ASX:BHP"
}
```

The backend strips the exchange prefix into:

- `exchange_prefix = "ASX:"`
- `ticker = "BHP"`

Portfolio detector tickers may arrive with a prefix, but are normalised internally:

- `SP:SPX` -> `SPX`
- `AMEX:SPY` -> `SPY`
- `ASX:XAO` -> `XAO`

## Per-Security Webhook

Endpoint:

```text
POST /api/webhook/tradingview
```

Used for:

- CDF trend/deployment state
- TMS add/trim/stop/re-entry signals
- price target updates
- connection setup packets

### CDF State Sync

Payload:

```json
{
  "ticker": "ASX:TLX",
  "signal": "buy",
  "script": "cdf",
  "analystPriceTarget": "18.50"
}
```

```json
{
  "ticker": "ASX:TLX",
  "signal": "sell",
  "script": "cdf"
}
```

Live behaviour:

- `buy` sets `security_positions.position_state = BUY`
- `sell` sets `security_positions.position_state = SELL`
- price target fields may be updated on `stock_analysis`
- plain CDF BUY/SELL does not create an actionable `alerts` row

Business logic note:

Plain CDF BUY/SELL is state sync only. CDF does not create full sell commands. The actionable CDF negative-zone path is `cdf_sell_zone`, which is normalised internally to `SELL_DOWN` and has target user-facing copy `Sell Down 20%`.

### TMS Signals

Payload examples:

```json
{
  "ticker": "ASX:WWI",
  "signal": "strong_add",
  "timeframe": "1D",
  "script": "tms"
}
```

Add/trim strength and timeframe are independent dimensions. The app normalises
the alert type to `ADD` or `TRIM`, while retaining strength/timeframe metadata
for display, charting, and audit. Strength does not carry a dollar amount and
must not create a client-side Strong/Weak buy-size multiplier.

```json
{"ticker":"ASX:WWI","signal":"strong_add","timeframe":"1D","script":"tms"}
{"ticker":"ASX:WWI","signal":"weak_add","timeframe":"2D","script":"tms"}
{"ticker":"ASX:WWI","signal":"strong_trim","timeframe":"1D","script":"tms"}
{"ticker":"ASX:WWI","signal":"weak_trim","timeframe":"3D","script":"tms"}
```

Event-style TMS payloads:

```json
{"ticker":"ASX:WWI","signal":"sell","script":"tms"}
{"ticker":"ASX:WWI","signal":"reentry","script":"tms"}
{"ticker":"ASX:WWI","signal":"cdf_buy_zone","script":"tms"}
{"ticker":"ASX:WWI","signal":"cdf_sell_zone","script":"tms"}
```

```json
{
  "ticker": "ASX:WWI",
  "signal": "cdf_sell_zone",
  "script": "tms"
}
```

Normalisation:

| TradingView signal | App alert type | Meaning |
| --- | --- | --- |
| `strong_add` | `ADD` | Add opportunity. `Strong` remains supporting evidence; the action uses the shared class-pool ticket. |
| `weak_add` | `ADD` | Add opportunity. `Weak` remains supporting evidence; the action uses the shared class-pool ticket. |
| `strong_trim` | `TRIM` | Trim opportunity using its defined percentage of current holding; `Strong` remains supporting evidence. |
| `weak_trim` | `TRIM` | Trim opportunity using its defined percentage of current holding; `Weak` remains supporting evidence. |
| `sell` + `cdf_state=BUY` | `SELL_50` | ATR/TMS stop while embedded CDF is still constructive; target user-facing action `Sell Down 50%`. |
| `sell` + `cdf_state=SELL` | legacy `SELL`, target `EXIT` | ATR/TMS stop while embedded CDF is bearish; target user-facing action `Exit`. |
| `reentry` | `REENTRY` | Re-enter after stopped state. |
| `cdf_buy_zone` | `BREAKOUT` | Breakout/high-priority buy state. |
| `cdf_sell_zone` | `SELL_DOWN` | Actionable `Sell Down 20%` signal. |

Metadata:

| Payload field | Meaning |
| --- | --- |
| `signal` | Source signal. Strong/weak variants are normalised to a base alert type. |
| `timeframe` | Signal window such as `1D`, `2D`, or `3D`; used for display and audit, not as a separate alert type. |
| `cdf_state` / `cdf_zone` | TMS stop context. Optional for transport acceptance, but necessary to distinguish `Sell Down 50%` from `Exit`. The repaired September repository source emits `cdf_state`. |
| strength | Derived from signal prefix: `strong_add`, `weak_add`, `strong_trim`, `weak_trim`. |

Legacy compatibility: TMS `sell` without `cdf_state` is accepted as the old stop path. It remains a full `SELL` alert, but the backend keeps the old waiting-for-re-entry flag until live scripts have been updated to send explicit CDF state.

**The raw 23 September export omitted this field; the repository repair restores
it.** A corrected BUY-zone stop is
`{"ticker":"ASX:WWI","signal":"sell","script":"tms","price":0.55,"cdf_state":"BUY"}`;
the SELL-zone variant sets `cdf_state` to `SELL`. The backend does not reconstruct
the embedded stop-zone context from another feed. No backend policy changed:
the repaired payload enables its existing 50%/full-exit distinction. Running
TradingView alerts still require explicit replacement after compilation and UAT
verification; old alerts and existing historical records are not rewritten.

Validation:

- ADD/TRIM/SELL_DOWN/BREAKOUT normally require active portfolio context.
- ADD and BREAKOUT can remain stored as evidence while CDF is `SELL`, but must not project a purchase ticket until CDF is `BUY` and class funding exists. A valid TMS REENTRY retains its own stopped/waiting eligibility.
- TMS signals require an active TMS alert registration unless backend logic explicitly accepts the context.
- REENTRY requires `security_positions.stopped_waiting_reentry = 1`. The TMS script owns the recovery condition; CDF SELL does not independently reject a valid re-entry event.
- ADD/TRIM/SELL_DOWN/REENTRY expire after three trading days.
- BREAKOUT expires after the breakout window, currently 30 days in business logic.

Side effects:

- inserts an `alerts` row when accepted
- may update `security_positions`
- broadcasts through SSE

### Connection Signal

Payload:

```json
{
  "ticker": "ASX:TLX",
  "signal": "connect",
  "script": "tms"
}
```

Side effects:

- upserts `active_alerts`
- may update analyst price target or current zone if provided

## Regime And Portfolio-Risk Webhook

Endpoint:

```text
POST /api/webhook/regime
```

Used for:

- generic regime BUY/SELL state
- Q3 detector equity percentage
- Q4 detector crisis BUY/SELL state

### Generic Regime State

Payload:

```json
{
  "ticker": "GOLD",
  "signal": "SELL"
}
```

Live behaviour:

- upserts `regimes`
- evaluates affected securities
- creates a `REGIME` alert with `affected_positions`
- can auto-exit stock positions when computed target reaches `0%`
- can update ETF allocations according to regime and sleeve state

Generic regime state is not Q3 detector state. Do not use `regimes` to display current Q3/Q4 portfolio-risk state.

### Q3 Detector

Payload:

```json
{
  "ticker": "SPX",
  "script": "q3d",
  "target_equity_pct": 35
}
```

Contract:

- `target_equity_pct` is required and authoritative.
- Q3 is not BUY/SELL.
- Preferred S&P ticker is `SPX`.
- Legacy `SPY` remains compatible and should be treated as approximately equivalent to `SPX`.
- `XAO` may also provide a Q3 detector percentage.
- The effective Q3 target is the lower available value between S&P and XAO inputs.
- If `SPX` exists, it takes precedence over legacy `SPY` for S&P state.

Side effects:

- upserts `equity_sizing`
- appends `equity_sizing_history`
- registers `active_alerts` for `q3d`
- syncs `overlay_signal_state`
- may create, update, cancel, or supersede `overlay_events`

Business rule:

- risk-off creates a Portfolio Risk action
- risk-off is a proportional throttle against the last applied Q3 detector state, not a total-portfolio cap
- risk-on creates a visible lightweight Portfolio Risk action showing higher Q1 allocation is allowed
- risk-on must not force buys
- risk-on must not create a portfolio target
- risk-on must not accept a baseline
- risk-on may route the user to Portfolio Shape review

Example response:

```json
{
  "status": "success",
  "source": "SPX",
  "pct": 35,
  "effective_pct": 35,
  "last_applied_q1_exposure_pct": 100,
  "pending_event_id": 12
}
```

### Q4 Detector

TradingView script output:

```pine
if trigger_buy and last_sent_signal != "BUY"
    alert('{"ticker": "' + tickerStr + '", "signal": "BUY", "script": "q4d"}', alert.freq_once_per_bar_close)
    last_sent_signal := "BUY"

if trigger_sell and last_sent_signal != "SELL"
    alert('{"ticker": "' + tickerStr + '", "signal": "SELL", "script": "q4d"}', alert.freq_once_per_bar_close)
    last_sent_signal := "SELL"
```

Payloads:

```json
{
  "ticker": "Q4",
  "signal": "SELL",
  "script": "q4d"
}
```

```json
{
  "ticker": "Q4",
  "signal": "BUY",
  "script": "q4d"
}
```

Contract:

- Q4D sends only `BUY` or `SELL`.
- Q4D does not send a percentage.
- Backend maps `SELL` to the hardcoded 10% market exposure crisis target.
- Backend maps `BUY` to 100%, clearing the crisis limiter.
- Q4 active state is persisted in `q4_crisis_state`.
- Active Q4 also writes `Q4D = 10` into `equity_sizing`.
- Cleared Q4 writes `Q4D = 100` into `equity_sizing`.
- Q4 outranks Q3 in the resolved Portfolio Risk action.
- Q3 state remains accepted and stored while Q4 is active.

#### Design decision: binary Q4 protocol is intentional (2026-06-11)

The external audit (ALPHA_EDGE_AUDIT addendum §4) noted that the Q4 PineScript
internally computes a continuous, vol-scaled equity percentage (floors at
15–20%) while the wire protocol carries only `BUY`/`SELL`, which the backend
maps to 100/10. This is a **deliberate decision, not a gap**, and the script
and protocol are not to be changed:

- Capital preservation is the #1 priority near crisis. One day of exposure in
  a severe drawdown can be devastating; being in cash costs only time and
  slippage (brokerage is $0).
- The binary cliff is the point: when Q4 fires, the operator wants a single
  unambiguous de-risk action, not a graduated target to second-guess.
- Whipsaw resistance lives in the script, where it belongs: 65/35 entry/exit
  hysteresis, confirmation bars, recovery gating (3-of-5 indicators clear plus
  sustained low-stress bars), and asymmetric ramping. Exhaustive
  strategy-tester backtests support this behaviour.
- The backend's 10% crisis target is **authoritative for the live system**.
  The script's internal `crisis_floor` (20%) and `min_equity` (15%) inputs
  affect only its own backtest accounting, not the terminal. The deliberate
  10% (vs 15–20%) is the more conservative figure, consistent with the
  capital-preservation rationale.

TODO (audit addendum item 4): record the live TradingView chart input settings
for each deployed script in `DOCS/api/TRADINGVIEW_SCRIPTS.md` — including whether
live Q3 runs with non-default `max_stress_drag` — so deployed parameters are
versioned alongside the script sources.

Side effects:

- updates `q4_crisis_state`
- upserts `equity_sizing.Q4D`
- appends `equity_sizing_history`
- syncs `overlay_signal_state`
- may create or reuse a Q4 `overlay_events` workflow
- returns resolved `portfolio_risk`

Example response:

```json
{
  "status": "success",
  "regime": "Q4",
  "signal": "SELL",
  "target_pct": 10,
  "q4_crisis": {
    "active": true,
    "reason": "q4d_sell_signal",
    "target_equity_pct": 10
  },
  "portfolio_risk": {
    "mode": "Q4_CRISIS",
    "label": "Q4 Crisis",
    "priority": 2,
    "target_pct": 10,
    "target_kind": "MARKET_EXPOSURE"
  }
}
```

## ETF Rebalance Webhook

Endpoint:

```text
POST /api/webhook/etf-rebalance
```

Payload:

```json
{
  "sequence_number": 15,
  "rebalance_date": "2026-05-17",
  "weighted_portfolio_return": 5.62,
  "allocations": [
    {
      "ticker": "FANG",
      "rank": 1,
      "return_60bar": 22.45,
      "allocation": 18.45
    }
  ]
}
```

Contract:

- The payload represents one complete legacy ETF rebalance sequence.
- The historical contract below describes an 11-ETF universe. The supplied
  active PineScript currently sends 15 ETFs, and the current Go handler does
  not enforce an instrument count, rank uniqueness, or allocation total.
  Treat this section as legacy transport documentation, not a statement of
  current enforcement. [ETF System v2.0](../decisions/ETF_SYSTEM_V2.md) owns the
  reconciliation and internal-engine migration.
- `sequence_number` identifies the rebalance and lets newer sequences supersede older pending targets. The PineScript counter resets on script reload, so it is not a durable monotonic identity.
- `rebalance_date` must be a valid `YYYY-MM-DD` date.
- `weighted_portfolio_return` is a legacy script diagnostic, not statement-derived portfolio performance.
- The current handler persists provided rows but does not validate rank uniqueness, allocation sum, or a zero-weight tail.

ETF methodology summary:

- 80-bar return signal and 240-bar momentum attenuation at `0.5`.
- A legacy price-level volatility adjustment at `0.05`; it is not a conventional Sharpe ratio.
- Top-8 linear rank decay, 25% cap, 5% threshold, and a forced ten-holding floor in the supplied 15-fund script.
- Full exact behaviour, source-symbol mapping, and the internal migration are in [ETF System v2.0](../decisions/ETF_SYSTEM_V2.md).

Side effects:

- supersedes previous pending ETF rebalance targets
- inserts one `etf_rebalance_targets` row per allocation
- calculates `pending_delta = target_allocation - current_allocation`
- updates `etf_allocations`
- returns `{"status":"received"}`

## Deprecated Or Ignored Signals

The current backend ignores or deprecates:

- `dca`
- `oms_buy_zone`
- `oms_sell_zone`

## Rejection Cases

The backend rejects:

- invalid JSON
- Q3/Q4 detector payloads sent to `/api/webhook/tradingview`
- Q4D signal other than `BUY` or `SELL`
- generic regime signal other than `BUY` or `SELL`
- TMS signals without required active context
- REENTRY when the position is not waiting for re-entry

## Required Improvements

1. Add UI regression coverage that verifies alert cards and history charts render `Sell Down 50%` and `Exit` distinctly after the action-label migration.
2. Add endpoint-level tests for Q3 risk-off, Q3 risk-on, Q4 activate, Q4 clear, and Q4 priority over Q3.
3. Add a strict JSON schema or OpenAPI equivalent for each webhook payload.
4. Keep old root webhook docs as pointers to this contract, or remove them from active guidance.
