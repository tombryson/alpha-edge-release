# ETF System v2.0: Core ETF Momentum Allocation

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

> Original proposal status (historical): Status: `Policy v1.0; staged migration. Not live.`

Implementation note (9 September 2026): the broad status above describes the
original staged proposal, not every subsequently shipped feature. The shared
class-budget integration is recorded in [ETF Model Proposal](ETF_MODEL_PROPOSAL.md).
A further frontend release keeps
Core management in the sidebar and demotes the ETF rail to one optional Portfolio
tools view. [Portfolio Tools Migration](CONTEXT_PANEL_MIGRATION.md) supersedes
older sidebar/ring UI descriptions without changing the allocation policy.
Its 10 September refinement restores the original read-only Positions ratio
chips and removes inline allocation/target rows; unheld Core targets stay in the
sidebar, superseding the unfunded Positions slots proposed below.

This document is the future-state authority for ETF policy. It replaces the
target-policy portions of ETF Allocation Requirements
where they conflict. That older document remains useful as an inventory of the
currently deployed ledger, routes, and tables until the migration is complete.

The current external TradingView rebalance webhook remains live compatibility
behaviour. Nothing in this document claims that the current ETF Monitor,
allocation ledger, or position actions already enforce this policy.

Related documents:

- [Business Logic](../system/BUSINESS_LOGIC.md) owns the top-level decision hierarchy,
  Q3/Q4, portfolio shape, CDF/TMS, cash, and statement truth.
- [Pooled Capital Deployment Policy v1.0](../system/POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md)
  owns class-cash funding and deploy-ticket rules.
- [Signal And Action Contract](../system/SIGNAL_AND_ACTION_CONTRACT.md) owns durable
  signals, user decisions, and statement reconciliation.
- [Asset-Class Governance](../system/ASSET_CLASS_GOVERNANCE.md) owns canonical asset
  class assignment and custom fund classes.
- [TradingView Script Reference](../api/TRADINGVIEW_SCRIPTS.md) owns external
  transport inventory while the legacy webhook remains supported.

## 1. Decision

ETF momentum is not a second portfolio and it is not a portfolio-shape
authority. Core ETFs implement part of each approved asset class. The momentum
model adjusts how strongly that Core ETF is emphasised relative to direct
stocks inside the same class.

```text
Q3 / Q4 portfolio-risk overlay
  -> approved portfolio shape and asset-class budgets
  -> per-class implementation choice: Core ETF, direct stocks, or both
  -> suggested Core ETF base and momentum adjustment
  -> ETF CDF/TMS gate and ETF action workflow
  -> broker execution and statement reconciliation
```

The hierarchy answers four distinct questions:

| Question | Owner | It must not decide |
| --- | --- | --- |
| Which economic exposures should exist? | Portfolio shape, memo, user | Which ETF currently ranks first. |
| Which broad instrument implements a named sleeve? | Per-class Core ETF configuration | Q3/Q4 state or research scores. |
| How strongly should an eligible Core ETF be emphasised? | ETF momentum engine | Strategic class weights, Core ETF identity, or a full liquidation. |
| May capital be added or must exposure be reduced? | ETF CDF/TMS and Q3/Q4 | The research or portfolio-shape baseline. |

The old rule, "put all remaining cash into the ETF system", is retired. It
created a second allocator that could compete with named asset-class budgets.
The whole-book 25% value is a suggested ETF implementation mix, not a mandatory
minimum and not an independently funded sleeve. Portfolio reserve cash,
blocked class cash, and cash assigned to another sleeve must not be silently
redirected to satisfy it.

## 2. Current State And Script Audit

The supplied PineScript is the present reference implementation:

```text
ETF Rebalancing - 12-Month Momentum + 24-Month Vol (15 ETFs)
```

It is more specific than the simplified 11-ETF / 60-bar documentation that
currently exists in parts of Alpha Edge.

### 2.1 Actual Universe

The script ranks 15 ETFs:

```text
FANG  GPEQ  ESPO  ASIA  SGDJ
SLVR  ARMR  SEMI  LSX   NUCL
VPN   LITP  LSF   UFO   COPJ
```

The operational `etf_allocations` table may contain additional ETFs created by
alert setup, statement holdings, or Core selection. Those rows are not members
of `LEGACY_15` and must not change its member count or neutral model weight. In
August 2026, UAT contained `WREE` as a valid operational ETF but not as a member
of the supplied PineScript universe. The correct neutral weight remains
`100 / 15 = 6.67%`, not `100 / 16`.

The live static bootstrap universe and historical webhook documentation name
only the first 11. The current Go webhook accepts an arbitrary allocation list,
so the live code does not enforce that old 11-instrument contract. This is a
high-risk documentation and configuration discrepancy that must be resolved
before an internal engine becomes authoritative.

The source symbols are also mixed:

```text
ASX_DLY: FANG, GPEQ, ESPO, ASIA, ARMR, SEMI, LSX, LSF
LSE_DLY: NUCL, VPN
BATS:    SGDJ, SLVR, LITP, UFO, COPJ
```

An internal universe must retain each instrument's stable Alpha Edge security
identity, broker availability, TradingView symbol, Yahoo/provider symbol,
currency, asset-class mapping, and active status. A display ticker alone is
not enough.

### 2.2 Exact Existing Calculation

At each evaluation point, the PineScript calculates:

| Component | Actual implementation |
| --- | --- |
| Short return | 80 daily bars of `close`, described as four months. |
| Long momentum | 240 daily bars of `close`, described as 12 months. |
| Volatility | `stdev(close, 240)` with a floor of `1.0`. |
| Score | `perf80 * (1 + 0.5 * mom240 / 100 + 0.05 * (perf80 / sqrt(vol240)))`. |
| Rank | Count of scores strictly greater than the instrument score, plus one. |
| Selection | Ranks 1-8 receive a linear rank-decay multiplier. |
| Cap | 25% maximum per ETF by default, then one proportional redistribution pass. |
| Minimum allocation | Allocations below 5% are zeroed. |
| Minimum holdings | If fewer than 10 remain, top-ranked missing names receive a 10% provisional floor before final normalisation. |
| Final result | Weights are normalised to 100% of the legacy ETF sleeve. |
| Rebalance timing | `bar_index % 80 == 0`, not a stored calendar schedule. |

The script also calculates 240-bar correlations to an equal-price composite,
but correlations are display-only. They do not alter ranks, score, caps, or
allocations.

### 2.3 Important Interpretation Limits

The current source should be preserved for parity testing, not treated as an
unexamined financial specification.

1. The comment says "24-month volatility", but 240 daily bars is roughly 12
   trading months, not 24 calendar months.
2. Volatility is the standard deviation of price levels, not daily returns.
   Therefore the named `sharpe` value is not a conventional Sharpe ratio and
   is sensitive to the ETF's nominal price scale.
3. The strategy has no natural cash state. Normalisation and the ten-holding
   floor can still allocate capital when the selected scores are broadly weak
   or negative. ETF CDF/TMS is the separate loss/trend protection layer.
4. A rank is relative, not an absolute buy signal. A first-ranked ETF can be
   negative on an absolute-return basis.
5. `bar_index % 80` ties the rebalance cadence to chart history rather than a
   defined calendar or stored epoch. An internal implementation must record a
   schedule explicitly.
6. `weighted_portfolio_return` is a script diagnostic, not statement-derived
   portfolio performance. It applies current 80-bar returns to newly stored
   weights and cannot be used as Alpha Edge performance accounting.
7. The payload field `return_60bar` contains the script's 80-bar return. The
   label is legacy transport vocabulary and must not be copied into v2.

These observations do not invalidate the strategy. They define what must be
replicated in a parity run and what must be separately backtested before it is
called an improvement.

## 3. ETF Roles And Capital Attribution

One ETF can serve two economic purposes at the same time. The broker sees one
holding; Alpha Edge must keep the reasons for those dollars separate.

| Term | Meaning |
| --- | --- |
| Core ETF | The selected broad implementation of an approved asset class. Its base target comes from that class budget. |
| Momentum adjustment | A bounded increase or decrease applied to the Core ETF base. It changes ETF-versus-stock implementation inside the class and does not create class capital. |
| ETF CDF/TMS gate | Existing trend and loss-control evidence which blocks additions and may create a reduction action. It does not select an asset class. |
| Class ETF capacity | The portion of an approved asset-class budget the user allows to be expressed through ETFs. |
| Tactical class cash | Realised or undeployed cash that remains assigned to its source asset class. It is not a global rotation pool. |
| Custom fund class | An explicit Q1-compatible allocation class for approved ETFs that do not belong cleanly to a named strategic sleeve. |

The prior "Core ETF, Tactical ETF, or Excluded" exclusive role model is too
coarse for this policy. The correct distinction is:

```text
instrument eligibility:  core eligible?  momentum eligible?
dollar attribution:      core base + momentum adjustment + drift/excess
```

The UI should still show one ETF row. It discloses `Core base`, `Momentum`,
`Target`, `Actual`, and `Delta` rather than presenting Core and momentum as
separate holdings.

## 4. Capital Policy

### 4.1 Portfolio Shape Is Authoritative

For asset class `c`:

```text
B_c = approved dollar budget for class c
g_c = suggested Core ETF implementation ratio for class c
core_base_c = B_c * g_c
```

`g_c` is a user-approved class setting. Its default is 25%, making the
historical whole-book value a suggestion expressed through Core ETFs rather
than a separate portfolio rule. A class may use a different ratio or zero.

If a class has no suitable or accessible ETF, `g_c = 0`. Alpha Edge must not
invent a proxy merely to satisfy an ETF percentage.

### 4.2 Momentum Adjustment Is Bounded

For a selected Core ETF `i` in class `c`:

```text
momentum_adjustment_i = bounded_adjustment(core_base_i, momentum_weight_i)
recommended_etf_target_i = core_base_i + momentum_adjustment_i
effective_etf_target_i = 0 on the ETF Sell gate; otherwise recommended_etf_target_i
stock_capacity_c = max(0, B_c - max(effective_etf_target_i, active_ETF_holdings_c))
```

The ranking engine determines relative preference among eligible Core ETFs. It
does not create class capital, select the Core ETF, or alter the approved class
budget. An increase in the ETF target reduces the class's direct-stock capacity
by the same amount; a decrease increases potential stock capacity but does not
automatically create a stock purchase.

The adjustment must be bounded and versioned. Until its multiplier is
backtested, the production projection uses a configurable influence and a hard
range around the Core base. The detailed allocation surface must show the base
and adjustment separately so the recommendation remains auditable. The compact
ETF Monitor shows `actual / effective target` and the configured Core ratio
(`1:4`, `1:2`, or `1:1`); it does not promote immaterial dollar modifiers into
the daily scan surface.

The backend also exposes the effective ETF implementation ratio for every
class. Analysis sends the full class target to
`POST /api/sizing/allocations`; the sizing handler owns the subtraction:

```text
advisory_stock_budget_c
  = max(approved_class_target_c - max(effective_ETF_target_c, active_ETF_holdings_c), 0)
```

The browser must not calculate or silently reconstruct this value. If the ETF
projection cannot be resolved, anchored stock targets fail closed and remain
blank rather than reverting to a whole-portfolio stock allocation.

Implementation update: the HTTP handler
uses the server's approved shape and statement value rather than trusting a
submitted dollar budget. Analysis stays live and advisory (`advisory_only=true`);
it does not approve individual-stock targets or create purchases. The ETF ledger
and purchase calculations share this class split. Purchase permission separately
applies Q3/Q4, stock/ETF gates, pending purchases and confirmed cash. A no-Core or
Sell-blocked class does not retain an unused ETF reservation, but ETFs still held
remain occupied capital. The ledger now reads the active holdings used by purchase
capacity, rather than a separate latest-statement-only ETF valuation query.

The initial transparent projection is:

```text
neutral_weight = mean(model weights across the registered momentum universe)
relative_weight_i = clamp(model_weight_i / neutral_weight, 0.50, 1.50)
influence = momentum_influence_pct / 100
momentum_adjustment_i = core_base_i * (relative_weight_i - 1) * influence
recommended_target_i = core_base_i + momentum_adjustment_i
```

For human explanation, the equivalent multiplier form is preferred:

```text
momentum_multiplier_i
  = 1 + ((model_weight_i / neutral_weight) - 1) * influence
recommended_target_i
  = class_budget_c * core_ratio_c * momentum_multiplier_i
```

This keeps the units explicit. Portfolio shape and the Core policy remain in
the percentage domain; the calculation converts to dollars once when it
produces the ETF target. A multiplier of `0.95` means retain 95% of the normal
Core allocation. It does not mean subtract five percentage points from the
portfolio or create a separate cash allocation.

The initial influence is 50%. Therefore the model can move a Core ETF target
at most 25% above or below its base. This is an explicit migration default, not
a claim of optimality; changing it requires a recorded policy update and later
backtest evidence. Missing model data leaves the Core base unchanged. A
registered zero-weight result applies the lower bound.

`neutral_weight` is the equal-weight baseline of the registered momentum
universe, not a market benchmark. For a legacy table whose member weights sum
to 100%, it is `100 / member_count`. Small dollar adjustments are expected when
the class budget or Core base is small, or when a fund is close to the neutral
weight. Such adjustments remain audit evidence; they are not independently
actionable merely because the projection changed. Holding-versus-target trade
materiality remains governed by the separately approved drift and execution
policy; the `PINE_PARITY_V1` comparison tolerance is not an execution rule.

When an ETF falls in rank, the recommendation moves toward the lower bound; it
does not erase the strategic Core ETF base. A reduction review may be created
when actual ETF value exceeds the revised target. ETF CDF/TMS, Q3/Q4, or an
explicit portfolio-shape action remains authoritative for executable
reductions and exits.

### 4.2.1 Momentum Source Authority

`etf_momentum_source` makes the live weighting input explicit:

| Value | Behaviour |
| --- | --- |
| `LEGACY_COMPATIBILITY` | Uses the TradingView-compatible weights in `etf_allocations`. This remains the default during parity migration. |
| `INTERNAL_PUBLISHED` | Uses only the latest explicitly published complete internal run. Daily evidence runs cannot alter live weights until the publication cadence accepts them. If no published complete run exists, the ledger fails instead of falling back silently. |

ETF CDF/TMS state remains sourced from the live ETF alert state in both modes.
Changing the source is a deliberate cutover decision; a daily evidence run
never becomes authoritative merely because it is newer.

The ETF Monitor connection mark is sourced only from the registered
`active_alerts` setup for that ETF. A cached momentum or tactical direction must
never create a green connection mark. Direction text may use the persisted ETF
state only while that connection remains registered; without a connection the
monitor reports `No signal`.

### 4.3 The Whole-Portfolio ETF Suggestion

The historical 25% value has one unambiguous meaning:

```text
suggested_etf_value = portfolio_value * suggested_etf_exposure_pct
```

It is a planning reference, not a floor, deficiency, or forced trade. The sum
of per-class Core ETF recommendations may be above or below it because some
classes have no suitable ETF, class ratios differ, momentum changes emphasis,
or CDF/TMS blocks deployment. Alpha Edge displays `Suggested`, `Effective`,
and `Actual` ETF exposure without automatically filling a gap.

An ETF that does not map to a named strategic class may receive capital only
through an explicit custom Q1 fund class. It must not be bought merely to make
the portfolio equal 25% ETFs.

### 4.4 ETF CDF/TMS Treatment

ETF CDF/TMS is a lower-level protection gate.

| State | Capital consequence |
| --- | --- |
| Eligible / BUY | A permitted Core ETF recommendation may receive a normal add/rebalance action, subject to available class cash. |
| CDF/TMS blocks additions | No normal top-up is created. Unspent capital stays in its source class. |
| CDF/TMS reduction or exit event | Use the existing ETF action contract and record the resulting cash in the same class after statement confirmation. |
| Q3/Q4 reduction | Outranks ETF policy and is handled through the portfolio-risk workflow. |

This policy deliberately does not invent a new ETF sell percentage. The
existing ETF CDF/TMS action rules remain in force until their exact reduction
and exit mapping is audited and versioned separately.

### 4.5 Fund Management Modes

The instrument stays
ETF in both the backend and UI. A separate management mode chooses `etf_tms`
(displayed as ETF) or standard `tms` with CDF (displayed as TMS). Asset class,
Core eligibility, Core ratio and automatic bounded ETF momentum are unchanged.
Mode selection does not establish which script performs better.

| Mode | Existing event contract | Connection requirements |
| --- | --- | --- |
| ETF (default) | Sell produces a full-exit action; Buy restores direction. | ETF TMS, initialised in Alerts. |
| TMS | Stop with explicit CDF Buy becomes SELL_50 and waits for re-entry. Stop with CDF Sell is a full exit without oscillator re-entry. Missing CDF state preserves the legacy full-stop/wait behaviour. ADD/TRIM use the existing standard TMS contract. | CDF for first entry; CDF plus TMS once held, including externally flagged holdings. |

The sidebar chip's Core editor and Security signal section expose the mode
control. Selection edits a draft; Save mode requires an explicit initial Buy or
Sell direction. A switch clears both scripts' connection registrations, resets
the previous stopped/manual state, and requires confirmation of the selected
connections in Alerts. Core and momentum settings are not written by this API.
The Alerts wrapper checkbox continues to identify the fund as an ETF while its
CDF/TMS controls follow the management mode.

`etf_management_profiles` stores the selected mode and
`etf_management_changes` retains the transition/direction history. Existing funds
without a profile default to ETF TMS. The ledger uses the managed position state
and required connections instead of stale ETF tactical state; standard TMS state
changes also synchronise the legacy ETF state. A stopped/disconnected fund's
effective target is zero until deployment is eligible again. This is a purchase
gate, **not a new full-exit instruction**: SELL_50 remains a half-sale action.
The recommended Core/momentum target remains available and unchanged.

Old-script webhooks are acknowledged as ignored without changing research,
position state or actions. Old-script connection setup is rejected. Switching
retires unexecuted security-script actions as NOT_APPLICABLE and resolves their
alerts, retaining history; macro-risk actions are untouched. AWAITING_STATEMENT
or VARIANCE actions block a switch until reconciled. Stale editor saves conflict
rather than overwriting a newer mode. Q3/Q4, class budgets and confirmed-cash
rules continue to govern purchases. Mode changes and signal/setup writes are
serialised; execution reporting shares the funding lock with a switch.

Storage follows the existing symbol-keyed position ledger. Switching is rejected
when Analysis contains the same symbol on multiple distinct exchanges; this
does not claim to solve the application's broader security-identity migration.

## 5. Internal Momentum Engine

Universe expansion remains a separate, unimplemented workflow. Membership is
stored in `etf_momentum_universe_members`, but `runETFMomentumParity` enforces
the original 15-member legacy universe. Marking an instrument ETF, selecting
Core, or switching its management mode does not enrol it in momentum ranking.
Do not append a database row to bypass this constraint: the run will reject a
changed member count. An extensible production universe needs reviewed provider
symbols/history, versioned membership and deliberate recalculation/publication,
while preserving the fixed legacy universe for TradingView comparisons. Adding
members can change every fund's rank, neutral reference and relative weight.

### 5.1 Objective

Move calculation, persistence, auditability, and target translation into Alpha
Edge. This removes the TradingView webhook as the sole computing authority. It
does not mean that Alpha Edge has no market-data provider: Yahoo or another
provider remains external market data.

The first internal calculation is available as soon as enough history is
backfilled. It does not wait four months to begin; four months is an 80-bar
lookback window.

### 5.2 Provider And Price Rules

Alpha Edge already persists daily `close_price` and `adjusted_close_price` in
`security_price_daily`. ETF v2 should reuse that storage only after every ETF
universe record has a reviewed provider symbol and enough valid history.

Rules:

1. Price refresh runs on a schedule and writes the database. A user opening
   the ETF Monitor must never cause fifteen live provider calls.
2. A parity engine uses the closest equivalent to the PineScript's raw daily
   close. An improved research version may use adjusted closes and realised
   return volatility only under a new version identifier and backtest.
3. The engine records provider, provider symbol, price basis, as-of date,
   source freshness, and missing-data diagnostics with every run.
4. A stale or incomplete price series blocks new tactical allocation. It is a
   review state, not an automatic SELL.
5. Yahoo is a useful initial provider but must sit behind a provider adapter
   and cached history. It is not broker valuation truth and must have a
   documented fallback/retry policy.

**Current implementation status:** the unified backend data-refresh worker runs
the ETF daily evidence cycle after the configured UTC hour. The cycle refreshes cached Yahoo daily prices through
the provider adapter and calculates an immutable `PINE_PARITY_V1` run only when
the conservative universe freshness date has advanced. Weekends, market
holidays, and repeated polling therefore do not create duplicate runs. A failed
or incomplete refresh remains visible as automation evidence and cannot alter
live allocation weights.

The calculation clock and allocation-publication clock are deliberately
separate:

1. `latest_run` is the newest daily evidence available for review.
2. `published_run` is the complete run currently authorised to supply internal
   model weights to the ETF allocation ledger.
3. The default publication cadence is 80 trading sessions measured from the
   published run's conservative freshness date. A run at 79 sessions remains
   evidence; the first complete run at or after 80 sessions is published.
4. On migration, the latest existing complete run is marked
   `MIGRATION_BASELINE`. Deployment therefore preserves the current model
   snapshot instead of silently replacing it with a newly calculated run.

The scheduler defaults are persisted settings rather than frontend behaviour:

| Setting | Default | Meaning |
| --- | --- | --- |
| `etf_momentum_automation_enabled` | `true` | Enables the backend evidence cycle. |
| `etf_momentum_daily_utc_hour` | `10` | Earliest UTC hour at which that day's cycle may run. |
| `etf_momentum_publish_cadence` | `EIGHTY_TRADING_DAYS` | Controls when a complete evidence run becomes the published weight snapshot. |

The unified worker polls persisted due state every 30 minutes, runs ETF evidence at most once per UTC date,
and waits two hours after a failed attempt before retrying. `as_of_date` is the
requested model date; `created_at` is when Alpha Edge calculated the run; and
`data_fresh_through` is the oldest latest-price date across all active universe
members. The Ranking view labels these separately and also identifies the
published run and session progress toward the next publication.

The existing `regimes.go` return helper cannot be reused for this engine as-is:
it uses raw close returns and has no run snapshot, universe version, or parity
contract.

### 5.3 Versioned Runs

The internal engine should create an immutable run and rows, not overwrite the
current allocation in place.

```text
etf_momentum_universes
  -> approved universe, symbols, eligibility, effective dates

etf_momentum_runs
  -> run id, algorithm version, price basis, parameters, schedule, provider,
     as-of date, status, source freshness, comparison result

etf_momentum_run_rows
  -> security id, return_80, momentum_240, volatility input, score, rank,
     decay, requested overlay weight, diagnostics
```

The existing `etf_allocations` table remains the live compatibility projection
during migration. It must eventually become a derived current-state view of
the approved Core ETF configuration, latest accepted momentum run, CDF/TMS
state, and statement values rather than the primary source of strategy truth.

### 5.4 Parity Before Improvement

Two engine modes are required:

| Mode | Purpose |
| --- | --- |
| `PINE_PARITY_V1` | Replicates the supplied formula, universe, thresholding, rank decay, caps, and rebalance schedule as closely as the chosen market-data source permits. |
| `RISK_NORMALISED_V2` | Candidate research model using adjusted returns and return-volatility. It is not enabled until independently backtested against parity and portfolio objectives. |

#### Parity acceptance and rectification

Parity is an automated acceptance test, not a recurring visual-inspection task.
The economically actionable comparison is the final allocation produced for
each ETF:

```text
allocation_drift_pp = internal_allocation_pct - reference_allocation_pct
```

The `PINE_PARITY_V1` acceptance band is `±2.0 percentage points` per ETF.

| Result | Rule | User consequence |
| --- | --- | --- |
| `MATCH` | Formula fields and allocation agree within the narrow calculation tolerance. | None. |
| `ACCEPTABLE_DRIFT` | `abs(allocation_drift_pp) <= 2.0`. | None; retain as evidence. |
| `ACTION_REQUIRED` | `abs(allocation_drift_pp) > 2.0`. | Investigate and rectify the price source, symbol mapping, bar alignment, or calculation. |
| `PARTIAL_REFERENCE` / `MISSING_INTERNAL` | The comparison is incomplete. | Rectification is required because parity cannot be established. |

Exactly `2.0pp` is acceptable; only a worse result requires action. Rank,
return, momentum, decay, volatility-proxy, and score differences remain
diagnostics for explaining a breach. They do not create user work when final
allocation remains inside the accepted band.

The migration must not silently replace the PineScript's price-level volatility
with a conventional realised-volatility metric and call the outputs equivalent.
That would be a strategy change, not a technical refactor.

## 6. Data Model And Configuration

### 6.1 ETF Universe

Each ETF needs a durable record rather than a hardcoded static ticker list:

```text
security_id
display_ticker
display_name
broker_accessible
tradingview_symbol
provider_symbol
currency
active_from / inactive_at
rank_eligible
tactical_eligible
canonical_asset_class_id (nullable)
custom_fund_class_id (nullable)
```

`security_id` is the relationship key. Tickers and exchange symbols can change
without breaking historical momentum runs or Core ETF configuration.

### 6.2 Per-Asset-Class ETF Policy

Each eligible class needs a configuration record:

```text
asset_class_id
core_etf_security_id (nullable)
core_base_ratio_pct
tactical_overlay_cap_pct
allow_tactical_overlay
effective_from / effective_to
policy_version
```

There is initially at most one selected Core ETF per class. More complex
multi-ETF implementation can be considered later, but should not be inferred
from a momentum rank.

### 6.3 Tactical Fund Classes

An ETF that does not fit a named asset class may be assigned to an explicit
custom allocation class with `instrument_scope = FUND` and a deliberate Q1
risk classification. It remains separate from stock research and cannot
become a named exposure merely because it ranks well.

## 7. Screen Responsibilities

| Surface | Required behaviour |
| --- | --- |
| Portfolio Shape | Selects Core ETF, base ratio, overlay capacity, or no ETF for each eligible asset class. This is the policy-editing surface. |
| Positions | Pins an actual held Core ETF to the top of its asset class. If selected but unheld, show a compact unfunded implementation slot in the class header, not a fabricated position row. |
| Analysis | Keeps ETFs visibly pinned and distinguishes Core ETF context from ordinary ETF classification without ranking ETFs against stocks. Its Momentum cell displays and sorts by the same six-month adjusted-close return and colour scale as stocks; it does not show the stock sizing modifier. |
| ETF Monitor | Compact asset-class-grouped surface: Suggested mix, Effective target, Actual exposure, Core Base, Momentum adjustment, Delta, rank freshness, and CDF/TMS state. Clicking a held ETF chip owns Core selection, Core ratio configuration, and removal. |
| ETF Allocation workspace | Allocation view owns mappings and target attribution. Ranking view exposes the latest internal full-universe run, inputs, score, rank, model weight, freshness, and coverage without mixing TradingView parity diagnostics into the production surface. |
| Actions | Receives chronological ETF reduction/exit actions and tactical rebalance reviews. It must not merge them into a hidden net target. |

The Ranking view keeps its metrics neutral so rank, return, momentum, score,
volatility, and model weight remain independently readable. The Analysis
Momentum column uses the same sign-only return colours for stocks and ETFs:
green above 0%, red below 0% and neutral at zero (three bands until 26 September
2026). Both use the
shared Analysis price-history pipeline; missing six-month history is a dash,
not a fallback to this engine's 80-session return. That ETF value remains
visible on hover because ETFs have no stock sizing modifier to reveal. This
display convention does not change the Ranking view's 80/240-session model,
scores, publication or allocations. Run-state warnings retain their semantic
warning/error colours.

### 7.1 ETF Monitor Display Contract

The compact ETF Monitor is an implementation readout and the direct Core ETF
configuration surface. It is not a trade-action queue.

Rules:

1. Its portfolio summary must show `Suggested`, `Effective`, and `Actual` ETF
   exposure together. `Suggested` is the whole-book planning reference,
   `Effective` is the sum of approved per-class Core recommendations after
   momentum and gates, and `Actual` comes from statement holdings.
2. `Core` status requires an explicit `asset_class_etf_policies` selection. A
   sole mapped ETF is a candidate and must never be promoted automatically.
3. A Core allocation indicator represents only `Actual / Effective target`.
   It must not represent momentum weight. A missing effective target renders no
   progress indicator, and exposure above target remains visibly distinct from
   an exactly filled target.
4. Holding-versus-target differences use neutral language such as `Above $282`
   or `Below $449`. They are allocation variance, not `Add`, `Reduce`, or `Exit`
   instructions. Executable language appears only after the appropriate action
   workflow exists.
5. Momentum-only instruments are shown separately as candidates. Their
   percentage is labelled `Model weight`; it is not presented as portfolio
   weight, class weight, target completion, or an executable allocation.
6. Held ETFs that are not explicitly selected Core ETFs remain visible as
   other ETF holdings. Their existence must not manufacture Core policy.

## 8. Migration Sequence

### Phase 0: Freeze And Audit

1. Register the full 15-instrument legacy universe and all TradingView/Yahoo
   symbols.
2. Record which ETFs are actually accessible through IG and which can be Core
   ETF candidates.
3. Preserve current webhook payloads and allocation history as legacy evidence.
4. Resolve the 11-versus-15 contract discrepancy and stop describing an
   80-bar return as `return_60bar` in new interfaces.

### Phase 1: Shadow Momentum Data And Parity

1. Backfill enough daily ETF price history for the 240-bar lookback.
2. Persist daily `PINE_PARITY_V1` evidence runs without changing live targets.
   Price freshness and date alignment are recorded on every run; unchanged
   market dates do not create duplicate evidence.
3. Capture the current complete TradingView table as a dated parity snapshot,
   then compare all reported inputs, ranks, selected instruments, and weights
   against the internal run for that same date. Scheduled rebalance webhooks
   are not a parity reference because they can be months old.
4. Apply the automated `±2.0pp` allocation acceptance band. Record supporting
   differences caused by price source, symbol mapping, missing bars, or schedule
   semantics, but require rectification only for an allocation breach or an
   incomplete comparison.

### Phase 2: Core ETF Configuration

1. Create per-class Core ETF configuration backed by stable security identity.
2. Seed proposed base ratios from current `stock_allocation_ratio` only for
   review; do not automatically approve them.
3. Present the selected Core ETF and its unfilled/blocked state in Portfolio
   and Positions.
4. Keep the legacy external allocation webhook operating in read-only
   comparison mode until this projection is correct.

### Phase 3: Target Translation

1. Translate accepted momentum rows into bounded adjustments to selected Core
   ETF targets inside their asset class or explicit custom fund class.
2. Separate `core_target_value`, `momentum_adjustment_value`, recommended
   target, effective target, actual, and delta in the ledger.
3. Respect ETF CDF/TMS and Q3/Q4 before an increase reaches Actions.
4. Keep proceeds class-locked after a reduction until broker evidence confirms
   the resulting tactical class cash.

Implementation status: items 1-3 are wired through the ETF ledger and backend
stock-sizing budget resolution. Item 4 remains part of the execution and
statement-reconciliation workstream.

### Phase 4: Cutover

1. Make the internal run the source for tactical ranking after parity and
   backtesting acceptance.
2. Retain the TradingView webhook for a defined fallback period only.
3. Deprecate the webhook once internal data freshness, result parity, and UAT
   scenarios are stable.

## 9. Required Tests

1. A 15-instrument universe persists all source symbols and stable identities.
2. A complete parity run classifies every ETF as `MATCH`, `ACCEPTABLE_DRIFT`,
   or `ACTION_REQUIRED`; only allocation drift greater than `2.0pp` requires
   rectification.
3. Missing 240-bar history creates `STALE`/`INCOMPLETE`, never a zero-score
   allocation.
4. A selected Core ETF receives its base from the approved class budget even
   when its tactical rank is absent.
5. A weak rank reduces the recommendation only within the configured bound; it
   does not erase the Core ETF base.
6. ETF CDF/TMS blocks normal additions and never silently transfers capital to
   another named class.
7. A reduction/exit records class cash only after the expected broker result is
   confirmed by statement import.
8. Q3/Q4 reductions outrank ETF increases.
9. An unmapped high-ranked ETF can receive capital only through an explicit
   custom tactical fund class.
10. Positions shows no invented holding when a Core ETF is configured but not
    currently owned.
11. A newer unpublished daily run cannot alter live internal allocation
    weights.
12. The 80-session publication rule rejects session 79 and accepts session 80.
13. The daily worker runs no more than once per UTC date and respects retry
    backoff after a failed attempt.

## 10. Decisions Still Open

These must be chosen deliberately before target-translation code is enabled:

1. Which asset classes should have a Core ETF, and what should their class
   implementation ratios be after the initial 25% suggestion?
2. What bounded momentum influence should be adopted after parity and
   backtesting?
3. What exact ETF CDF/TMS reduction and exit mapping applies to a Core ETF
   recommendation after momentum adjustment?
4. Should the default 80-trading-session publication cadence be replaced by a
   calendar schedule after comparative backtesting? Any change must be an
   explicit setting and must not rewrite prior run history.
5. Should `RISK_NORMALISED_V2` replace price-level volatility after a separate
   evidence review, or should Pine parity remain the production strategy?
6. What maximum capital is permitted in the custom Q1 tactical fund class?
7. Which IG-accessible instruments and currency conversions are valid for each
   configured ETF?

No answer to these questions may be hidden in a frontend default, mock seed,
or unversioned webhook payload.
