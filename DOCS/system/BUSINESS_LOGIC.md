# Business Logic

Audit date: 29 May 2026.

This document describes Alpha Edge business logic. It contains both live
behaviour and approved target logic, so sections use the following status terms:

- `Live`: implemented behaviour that exists in the application today.
- `Policy`: approved business rule that may not yet be enforced everywhere.
- `Proposed`: target design that must not be treated as live implementation.

Where live implementation differs, the discrepancy is called out directly
instead of being hidden in vague wording.

## Decision Layer Hierarchy

Alpha Edge portfolio decisions flow through layers in strict order.

| Layer | Name | Function | Main inputs |
| --- | --- | --- | --- |
| 1 | Portfolio risk overlay | Sets Q1 exposure permission and crisis reduction requirements. | Q3 Detector, Q4 Detector |
| 2 | Strategic allocation | Sets intended asset-class portfolio shape. | User target, AI memo, macro thesis |
| 2A | Commodity-theme expression and outperformance overlay | For each configured commodity class, applies two class-scoped signals and one security / core-fund `OUTPERFORM` signal. It can restrict permitted producer-equity capacity, blocks new producer-equity deployment when the equity regime fails, and emits a class Strong Trim; it reads the existing CDF/TMS state rather than duplicating it. | Theme events, canonical CDF state, full research target, current holdings |
| 3 | Stock sizing | Allocates capital within an asset class by quality, value, and upside. | Analysis scores, price targets, probabilities |
| 4 | Momentum gating | Controls deployable amount and timing for each stock. | CDF, TMS, breakout, stop/re-entry |
| 5 | Statement validation | Confirms external execution evidence. | Broker/account statement import |

Live compatibility note: the external ETF rebalance webhook still behaves as a
parallel sleeve subsystem. The approved target direction is
[ETF System v2.0](../decisions/ETF_SYSTEM_V2.md): ETF momentum becomes a subordinate
Core ETF emphasis layer beneath portfolio shape. In
either state, ETF logic must not rewrite Q3/Q4 detector state or the strategic
stock-portfolio baseline.

Rules:

1. A lower layer must not rewrite the inputs of an upper layer.
2. A breakout signal must not alter a stock quality score.
3. A Q3/Q4 detector signal must not silently create a strategic portfolio target.
4. A portfolio target must not rewrite Q3/Q4 detector state.
5. Statement import is external truth for completion of workflows that require broker evidence.
6. The commodity-theme layer may create an outperformance-increment trim for a
   configured price-taker security, but it must not duplicate CDF, overwrite its
   full research target, `IN` / `OUT`, or the approved asset-class budget. Its
   capacity policy must use the shared pooled-capital ticket model; it may not
   restore a stock-specific staged tranche. See
   [Commodity Theme Live-Cap Policy v1.0](../decisions/COMMODITY_THEME_LIVE_CAP_POLICY_V1.md)
   and [Pooled Capital Deployment Policy v1.0](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).

## Macro News Narrative Layer

The News tab is a persistent narrative ledger, not a one-off model answer.

Rules:

1. The model run must use current web-search capable input, not static model memory.
2. The first run is a `BOOTSTRAP` foundation pass. It builds the long-horizon thesis map across the last 12 months, including major themes, leaders, laggards, and persistent macro theses.
3. Routine runs are `DAILY` maintenance passes. They inject the current thesis ledger into the model prompt and ask whether fresh evidence supports, challenges, modifies, confirms, resolves, or creates theses.
4. Each run persists a summary, market context, news items, thesis rows, and thesis-update evidence.
5. Theses are durable objects that can be supported, challenged, modified, confirmed, resolved, or rejected by later runs.
6. Timeframes are `1D`, `1W`, `1M`, `6M`, and `1Y`.
7. A news item may reference asset classes, but it must not change asset-class assignments, portfolio targets, Q3/Q4 detector state, or action workflows.
8. The user reads the news layer as macro context for portfolio decisions. It is not an automatic trading command.

## Alert Lifecycle

Alerts and decisions are separate audit concepts.

The formal vocabulary and target reconciliation lifecycle are defined in
[Signal And Action Contract](SIGNAL_AND_ACTION_CONTRACT.md). A signal event
may update state without creating an alert; an alert is created only when a
user response, review, or workflow hand-off is required. A recorded decision is
not broker execution evidence.

Lifecycle states:

1. `RECEIVED`: the webhook or manual alert has been stored.
2. `ACTIONED`: the user records an action such as `ADD`, `TRIM`, `BUY`, `SELL`, or `SELL_DOWN`.
3. `IGNORE`: the user explicitly rejects the alert.
4. `EXPIRED`: the alert window lapses without user action.
5. `DISMISSED`: the alert is removed from view without being recorded as a trading decision.
6. `NOT_APPLICABLE`: a mechanical disposition, including a later percentage
   action without a remaining holding or a simulator-reset record. It is not a
   trading decision, a strategy resolver, or proof of a sale by itself.

Rules:

1. `IGNORE` is a user decision.
2. `EXPIRED` is a system resolution, not a user decision.
3. Expired alerts are resolved on the `alerts` row with `resolved_reason = 'EXPIRED'`.
4. Expired alerts must not be inserted into `decisions` as `IGNORE`.
5. Reporting may group `IGNORE` and `EXPIRED` as "not acted", but the audit trail must preserve the distinction.
6. Charting should show both the original signal and the later expiry event where applicable.
7. Position and class actions remain separate chronological signals. The system
   must not silently net, merge, or supersede them into a composite target.
8. A full position action is presented as `Exit`, not `Liquidate`, in the
   Positions action column and user-facing alert copy. Existing raw `SELL`
   transport remains compatible until the action-record migration is complete.

## Layer 1: Portfolio Risk Overlay

### Q3 Detector

Q3 is the Q1 exposure throttle.

Q3 payload:

```json
{
  "ticker": "SPX",
  "script": "q3d",
  "target_equity_pct": 35
}
```

Rules:

1. Q3 is a percentage payload, not BUY/SELL.
2. `target_equity_pct` is stored in `equity_sizing`.
3. `SPX` is the preferred S&P detector ticker.
4. Legacy `SPY` remains compatible and is treated as an S&P detector input.
5. `XAO` may also provide an input.
6. The effective Q3 detector state is the lower available value between S&P and XAO.
7. If `SPX` exists, it takes precedence over legacy `SPY`.

### Q3 Risk-Off

Q3 risk-off is a forced proportional throttle against the last applied Q3 state.

It is not a total-portfolio cap.

Example:

```text
Last applied Q3 state: 100%
New Q3 state: 50%
Current Q1-sensitive invested value: $10,000
Raw required Q1-sensitive reduction: $5,000 before class factors
```

Rules:

1. The ratio is `new_q3_pct / last_applied_q3_pct`.
2. The reduction is calculated against current Q1-sensitive invested value.
3. The calculation uses the portfolio at the moment the signal is processed.
4. The action must not be suppressed just because Q1 exposure is below the headline detector percentage of total portfolio value.
5. Class-level reduction is adjusted by `asset_class_config.q3_throttle_factor`.
6. Cash/reserve receives factor `0`.
7. Full Q1-sensitive classes normally receive factor `1.0`.
8. Defensive Q1-sensitive classes may receive a partial factor such as `0.5`.
9. Q3 risk-off creates a Portfolio Risk action.
10. Q3 risk-off normally requires user-entered reductions and later statement validation.
11. TMS purchase hints continue, but purchases must fit the reduced working class
    budget. The approved class weight is unchanged; its spending ceiling is
    multiplied by `1 - (1 - Q3/100) * q3_throttle_factor`.
12. Q3 sale proceeds leave the class for portfolio reserve. They do not replenish
    that reduced class's tactical cash. Capacity and confirmed funding are
    separate checks. See [purchase permissions](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md#purchase-permissions-9-september-2026).

### Q3 Risk-On

Q3 risk-on means the detector permits higher Q1 allocation than the last applied state.

Rules:

1. Q3 risk-on updates detector state.
2. Q3 risk-on creates a visible lightweight Portfolio Risk action.
3. The action tells the user that higher Q1 allocation is allowed.
4. It does not force buys.
5. It does not open reduction adjustment cells.
6. It does not require a broker statement.
7. It does not create a portfolio rebalance plan.
8. It does not accept or create a strategic baseline.
9. It may route the user to the Portfolio page for optional strategic shape review.

Language:

- Use "allocation available" or "Q3 allocation available".
- Do not spam "headroom" throughout the UI.
- If "headroom" is used, reserve it for Q3 risk-on capacity, not Q3 risk-off reduction.

### Q4 Detector

Q4 is the crisis detector.

Q4D script emits only:

```json
{"ticker":"Q4","signal":"SELL","script":"q4d"}
```

or:

```json
{"ticker":"Q4","signal":"BUY","script":"q4d"}
```

Rules:

1. Q4D does not send a percentage.
2. Backend maps `SELL` to 10% market exposure.
3. Backend maps `BUY` to 100%, clearing crisis state.
4. Q4 active state is persisted in `q4_crisis_state`.
5. Active Q4 writes `Q4D = 10` into `equity_sizing`.
6. Cleared Q4 writes `Q4D = 100`.
7. Q4 has higher priority than Q3 in the resolved Portfolio Risk action.
8. Q3 signals are still accepted while Q4 is active.
9. Q4 does not erase Q3 state.
10. Q4 uses `asset_class_config.q4d_liquidity_factor`, not Q3 throttle factors.
11. Cash/reserve is excluded from Q4 reduction.
12. Q4 creates a Portfolio Risk action when active and reduction is required.
13. While active, Q4 pauses increases in classes with a positive Q4 liquidity
    factor. Clearing it restores the current Q3 limits, not unrestricted buying.
14. A disconnected required detector or trend feed cannot grant permission from
    its saved state. Already-executed purchases can be recorded explicitly as
    exceptions, retaining reasons and waiting for statement unit verification.

## Layer 2: Strategic Allocation

Strategic allocation is the intended asset-class shape of the portfolio.

It is stored as approved snapshots in:

- `portfolio_mix_snapshots`
- `portfolio_mix_snapshot_rows`

Rules:

1. The approved mix is a reference shape, not a command to constantly rebalance every drift.
2. Drift is normal because winners and losers move at different speeds.
3. The application should track drift, not automatically repair every drift.
4. Portfolio shape should generally be reviewed every 3 to 6 months unless a shock event forces review.
5. Q3/Q4 signal response must not silently create a new strategic portfolio target.
6. A new baseline requires explicit user confirmation.

### Shape Presentation

Portfolio shape overviews are reference-first: the saved approved allocation leads,
with actual holdings shown alongside it by default. The currently permitted
allocation is a separate implementation constraint, never a replacement for the
approved shape. Positions holdings, account values and performance remain actual-first.

Unfilled approved classes and off-shape holdings must both be visible. Missing
approval is not an implied approval of current holdings. Missing current data is
not zero holdings. Stale holdings cannot produce a current allocation difference,
but do not invalidate a saved approval. Comparing these layers creates no trade
instruction and does not make live research binding.

### Drift Monitoring

Drift should be measured at asset-class level.

Useful measures:

- current weight
- target/baseline weight
- absolute percentage-point difference
- relative difference from baseline
- current value
- target/baseline value
- whether movement came from price action, new capital, or manual changes

Display pattern:

```text
Gold: 29.0% / 30.0% - $24,498 / $29,493
```

Meaning:

- first percentage: current deployed or current class weight
- second percentage: approved target/baseline weight
- first dollar value: current value
- second dollar value: target/baseline value

This is context, not an automatic trade instruction.

### Extreme Drift

Extreme drift should trigger review, not automatic correction.

Accepted follow-up, 18 September 2026: the [Ideal weight management
contract](IDEAL_WEIGHT_MANAGEMENT.md#asset-class-review) retains the relative
threshold below and requires at least **one portfolio percentage point** of
absolute difference as well. The trigger is opt-in;
Portfolio's display tolerance is not a trading threshold.

Working rule:

```text
relative_drift = (current_weight - baseline_weight) / baseline_weight
```

Extreme drift:

```text
abs(relative_drift) > 50%
```

Example:

```text
Baseline Gold: 20%
Current Gold: 31%
Relative drift: (31 - 20) / 20 = 55%
Result: flag for review
```

Required implementation note:

- The system must store or retrieve the baseline snapshot timestamp.
- The portfolio view should compare current class weights against that approved snapshot.
- Price-driven drift and new-capital-driven drift should be distinguishable where possible.

### New Capital

New capital should not blindly feed losers or winners.

Rules:

1. New capital should start from strategic asset-class weights.
2. It should then respect deployable room inside each class.
3. Deployable room means capital that can actually be deployed given CDF/TMS state.
4. If a class has no BUY or BREAKOUT candidates, its allocation can become tactical class cash.
5. The app should show deployable gaps, not silently pick winners or losers.
6. New capital should not automatically repair all portfolio drift.

Practical ordering:

1. Respect active Q3/Q4 portfolio-risk limits.
2. Respect strategic class target or review decision.
3. Within each class, allocate by stock sizing.
4. Gate each stock by momentum state.
5. Undeployable amounts remain class tactical cash.

## Layer 3: Stock Sizing

Stock sizing determines base allocation before momentum gates.

The [optional Ideal weight policy](IDEAL_WEIGHT_MANAGEMENT.md) was approved on
18 September 2026. It replaces the
old individual purchase cap with a live ideal ceiling when On, and remove all
individual weight ceilings when Off. It does not remove class, cash or risk
limits. Positions Ideal wt remains advisory while Off. This change does not
enable the setting or deploy it to either hosted environment.

Asset-class breadth rule:

Status: `Policy`.

1. Each asset class should normally contain no more than 10 direct-stock holdings.
2. The 10-name limit applies to ordinary direct-stock deployment, not to system
   buckets or cash-equivalent instruments.
3. An 11th qualified candidate should be treated as a watchlist or overflow
   candidate until the user frees a class slot by trimming, removing, or
   replacing an existing holding.
4. This is a portfolio-construction rule, not a hard broker restriction.

Live backend formula for Analysis Target Weight:

```text
avg_pt = mean(all positive price target inputs)
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

Rules:

1. Target Weight is calculated at runtime by `POST /api/sizing/allocations`; it is not stored as a database column.
2. The frontend prefers the backend response and only falls back to the local formula if backend sizing is unavailable.
3. Target Weight is computed per asset class. Stocks with the same `asset_class` are normalised against each other; stocks in different classes do not compete.
4. The router score is an optional announcement-router conviction modifier. Missing router score means multiplier `1.0`.
5. A router score of `+5` increases weight by 15%; a score of `-5` reduces weight by 15%.
6. The sizing layer must not use CDF/TMS momentum state as a score input. Momentum gates deployment after base sizing.
7. Anchored dollar allocation requests approved class budgets. The HTTP handler resolves the stock budget from the approved target minus the larger of effective ETF target and occupied ETF capital. This produces a research reference, not spendable cash or a stock-level reservation.
8. `stock_allocation_ratio` remains a legacy stored field; it no longer controls this stock/ETF split. See [ETF allocation](ETF_ALLOCATION.md#effective-target-and-stock-capacity) for the live budget calculation.
9. Floor the upside multiplier at zero before squaring. Implied upside at or below `-20%` receives zero suggested weight; above that boundary, the existing curve is unchanged. If all class weights are zero, suggested allocations remain zero. This is not a sale instruction and does not change actual holdings or approved class budgets. Concentration limits and missing-price handling remain separate policy work.

### Anchored Dollar Cascade

```text
class_budget            = approved_asset_class_target
stock_budget            = max(0, class_budget - max(effective_ETF_target, held_ETFs))
research_target_i       = stock_budget × (target_weight_pct_within_class / 100)

spendable class funding is a separate calculation:
min(confirmed class cash, remaining class capacity, permitted class risk capacity)
```

The current detailed funding and ticket definitions are authoritative in
[Pooled Capital Deployment Policy v1.0](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).

## Layer 4: Momentum Gating

Momentum gating controls how much of base allocation is deployable now.

### CDF BUY

Rules:

1. CDF BUY sets or confirms positive trend state.
2. A BUY state permits an otherwise qualified purchase ticket. It does not
   reserve capital for a stock or define a universal entry fraction.
3. New entries, TMS adds, re-entries, and breakouts use the shared `$100 / 10%`
   class-pool ticket policy. A later TMS add competes for then-current class
   cash; it does not unlock a pre-reserved second tranche.
4. A commodity-linked stock remains subject to any separately approved
   commodity permitted-target cap, but that cap does not change ticket size.

### CDF SELL

Rules:

1. Plain CDF SELL is state sync only. It marks the trend/deployment state as bearish; it does not create a full sell command.
2. CDF never has authority to fully liquidate a position by itself.
3. CDF SELL blocks new entries and ordinary TMS adds. TMS retains ownership of
   stopped/waiting and re-entry lifecycle; a valid TMS re-entry remains
   eligible under its own rules.
4. The actionable CDF negative-zone alert is `cdf_sell_zone`, normalised internally to `SELL_DOWN` and shown to the user as `Sell Down 20% of current holding`.
5. Proceeds from a sold-down amount belong to asset-class tactical cash.
6. They do not become portfolio reserve cash unless the action is part of Q3/Q4 portfolio-risk reduction.

Stop-loss interaction rule:

1. CDF sell zone before an ATR/TMS stop is `Sell Down 20%`.
2. ATR/TMS stop while embedded CDF is in BUY state is `Sell Down 50%`.
3. ATR/TMS stop while embedded CDF is in SELL state is the target action `Exit`.
4. TMS owns post-stop and re-entry state. CDF remains a BUY/SELL trend input;
   it does not emit a separate re-entry instruction.

### TMS ADD / TRIM / SELL / REENTRY

Rules:

1. TMS ADD and TRIM create actionable alerts when the ticker has active portfolio context and valid setup. ADD uses the pooled-capital ticket rule only while CDF is BUY and class funding remains available.
2. ADD and TRIM expire after three trading days.
3. TMS `sell` with embedded CDF BUY is `Sell Down 50%` and marks the security as waiting for re-entry.
4. TMS `sell` with embedded CDF SELL becomes the target action `Exit` and does not mark the security as waiting for re-entry.
5. REENTRY is accepted only when the security is stopped and waiting for re-entry. TMS owns the re-entry condition; CDF SELL does not independently veto that recovery event.
6. Legacy TMS `sell` payloads without embedded CDF state are accepted for compatibility and retain the old waiting-for-re-entry behaviour until TradingView alerts are updated.

### Commodity-Linked Equity Regime

Status: `Policy`.

For a configured price-taker class, the class-level core-fund / commodity ratio
is an equity-expression gate. It does not govern the separate direct-commodity
sleeve.

1. An equity-regime `BUY` permits the normal CDF/VWMA/TMS entry process.
2. Any 75%/100% Outperform capacity cap is a separate policy hypothesis. It
   changes the permitted target, not the initial purchase fraction or the class
   ticket amount.
3. An equity-regime `SELL` blocks new producer-equity entries, TMS adds,
   breakouts, and re-entries.
4. That `SELL` transition creates one class-scoped **Equity Regime Strong Trim**
   signal: 20% of each current producer-equity holding, including a producer ETF
   assigned to the class and excluding the direct-commodity sleeve.
5. The Strong Trim is distinct from a TMS oscillator trim. It retains its
   commodity-theme source, closed-bar timestamp, and class scope.
6. A later equity-regime `BUY` restores permission only. It does not create a
   compulsory purchase or re-entry.

### BREAKOUT

BREAKOUT is a high-priority BUY state.

Rules:

1. BREAKOUT permits deployment up to 100% of base allocation immediately.
2. BREAKOUT must not modify quality, value, upside, or composite score.
3. BREAKOUT should use available class tactical cash first.
4. If cash is unavailable, show an unfunded breakout gap.
5. Do not silently pull capital from other asset classes for a single-stock breakout.
6. Clustered breakouts inside one asset class may justify portfolio-level review or class expansion.
7. Breakout state should expire after the defined breakout window, normally 30 bars.

## Cash Logic

Alpha Edge has two major cash concepts.

### Tactical Class Cash

Tactical cash is inside an asset class.

Status: `Live for manual intent capture`. Manual class cash is stored on
`asset_class_config.cash_reserve`. Each user edit must also write a
`cash_movements` row so the app records the user's declared cash source before
the next broker import arrives. The broader workflow for automatically ranking
funding gaps, routing class cash into entries, and showing unfunded opportunities
is not yet live end-to-end.

Sources:

- CDF sell-down or withheld allocation
- TMS trims
- commodity Equity Regime Strong Trims
- SELL-blocked allocation that cannot currently be deployed
- manual class-level reductions not tied to Q3/Q4 portfolio-risk reserve

Rules:

1. Tactical cash remains available to the same asset class.
2. It should be pooled at class level, not reserved permanently for individual stocks.
3. If a stock returns from SELL to BUY and class cash has been spent elsewhere, the app should show the unfunded opportunity instead of inventing reserved cash.
4. Recognised cash-equivalent instruments can hold or stage cash, but they are
   not a different cash concept. They are the instrument-level representation of
   cash/staging.
5. Intraday sleeve-cash edits must record user intent instead of guessing where
   the cash came from.
6. Broker statement import remains the authoritative source for actual holdings
   and account cash.

### Sleeve Cash Intent Sources

The app cannot always know the broker-side source of a cash movement until the
next statement import. When a user edits class cash manually, the UI must ask
for the intended source and persist it in `cash_movements`.

Allowed source intents:

- `PORTFOLIO_CASH_TRANSFER`: cash is being assigned from the general portfolio cash pool into an asset-class sleeve.
- `STOCK_SALE`: cash is expected to come from a stock sale in or around the sleeve.
- `EXTERNAL_CAPITAL`: new capital has been added outside the app and assigned to the sleeve.

Rules:

1. Source intent is not broker execution proof.
2. `asset_class_config.cash_reserve` is the displayed working sleeve-cash value.
3. Cash allocation edits start as `PENDING` until future reconciliation confirms or challenges them.
4. Each edit must write a `CASH_ALLOCATION` row to Decision History.
5. The app must not silently treat every sleeve-cash increase as coming from portfolio cash.
6. The app must not invent stock-level reserved cash from these movements.
7. Data repair is not a normal cash-allocation source. If needed, it should be handled through a separate admin/maintenance path, not the user cash source menu.

Live classification:

1. `BSUB`, `AAA`, `ASX:AAA`, and `ASX_DLY:AAA` are recognised cash-equivalent
   instruments.
2. They must be excluded from ordinary equity holdings.
3. They must be counted as available cash/reserve according to the workflow
   context.
4. Ticker handling must normalise `AAA`, `ASX:AAA`, and `ASX_DLY:AAA` to the
   same cash-equivalent key.

### Portfolio Reserve Cash

Reserve cash is portfolio-level staging cash.

Sources:

- Q3 risk-off reductions
- Q4 crisis reductions
- portfolio target reductions before pending adds

Rules:

1. Reserve cash is not the same as asset-class tactical cash.
2. Reserve cash should be reconciled through statement import where broker execution evidence is required.
3. Reserve cash can later be deployed through Stage 2, portfolio target actions, or user portfolio review.

### Non-Allocating Instruments

Broker statements can contain contingent value rights, options, rights,
warrants, merger records, and other administrative instruments that are not
deliberate portfolio allocations. These remain tracked records rather than
portfolio sleeves.

Rules:

1. A non-allocating instrument remains in the imported broker statement and audit history.
2. It must not be assigned to an asset class.
3. It must not contribute to portfolio weights, Q3/Q4 exposure, rebalance targets, AI allocation packets, or stock allocation advice.
4. A contingent value right uses `security_type = CVR`; other manually excluded broker artifacts use `security_type = NON_ALLOCATING`.
5. Both types require `primary_asset_class = NULL`, `allocation = 0`, and `include_in_sizing = FALSE`.
6. Normal Positions and Analysis views hide them by default, while a reversible maintenance toggle may reveal them.
7. A nonzero broker value remains part of the broker-authoritative account total even though the instrument is excluded from strategy calculations.
8. It should not be parked in `MISC`; `MISC` is not a valid substitute for non-allocating instruments.

### No Stock-Level Permanent Reservation

The system should not permanently reserve cash for individual stocks.

Reason:

- permanent stock-level reservation undermines pooled class cash
- it creates hidden priority rules
- it adds UI and business logic overhead
- it can prevent better opportunities inside the same class from being funded

When cash is insufficient:

1. use available class cash first
2. rank unfunded claims visibly
3. allow user decision
4. escalate to portfolio review only for strong or clustered opportunities

## Portfolio Target Workflow

Portfolio targets are deliberate strategic-shape decisions.

They can be:

- manual
- created from AI analysis
- created after discretionary review

Rules:

1. Portfolio targets are separate from Q3/Q4 portfolio-risk signals.
2. Q3 risk-on must not automatically create a target.
3. Q3/Q4 completion must not automatically approve a target.
4. Decreases are actionable first.
5. Increases remain pending until cash exists.
6. User-entered recorded moves are stored in `portfolio_rebalance_plan_rows.recorded_move_value`.
7. A completed target can be approved as the new baseline only after explicit user confirmation.
8. Approval writes `portfolio_mix_snapshots` and `portfolio_mix_snapshot_rows`.

## ETF Momentum Rebalance (Legacy Live Pipeline)

The current external webhook remains a live compatibility path. Its 15-fund
PineScript and the current backend do not yet implement the target hierarchy in
[ETF System v2.0](../decisions/ETF_SYSTEM_V2.md). The following records existing
methodology and current ledger behaviour; v2.0 owns future policy.

The intended target is a suggested ETF implementation mix inside the portfolio
model, not a minimum, separate sleeve, or forced broker-level rule. The initial
suggestion is 25%. Each selected Core ETF receives a base from its approved
asset-class budget, and momentum applies a bounded adjustment to that base. The
remaining class budget is available to direct-stock sizing. If a class has no
suitable ETF, the system must not force an ETF into that class or compensate by
overweighting an unrelated class.

Core methodology:

| Component | Rule |
| --- | --- |
| Legacy universe | The supplied active PineScript ranks 15 ETFs; the static bootstrap list still contains 11 and must be reconciled. |
| Rebalance cadence | Every 80 chart bars using `bar_index % 80`, approximately four months on a daily chart. |
| Return signal | 4-month / 80-bar return. |
| Momentum attenuation | 12-month / 240-bar momentum multiplied by `0.5`. |
| Volatility adjustment | `5%` weighting of a legacy `perf80 / sqrt(stdev(close, 240))` value. This is not a conventional Sharpe ratio. |
| Allocation method | Top 8 ETFs receive linear rank decay, then a 25% per-ETF cap and 5% allocation threshold apply. |
| Minimum holdings | If fewer than 10 allocations survive the threshold, top-ranked missing names receive a provisional 10% floor before final normalisation. |

Scoring formula:

```text
score = 4m_return * (1 + (12m_momentum / 100) * 0.5 + (sharpe * 0.05))
```

Rank decay:

| Rank | Decay weight |
| --- | ---: |
| 1 | 100.0% |
| 2 | 87.5% |
| 3 | 75.0% |
| 4 | 62.5% |
| 5 | 50.0% |
| 6 | 37.5% |
| 7 | 25.0% |
| 8 | 12.5% |
| 9-11 | 0.0% |

Rules:

1. ETF rebalance creates ETF target allocations, not stock-portfolio target rows.
2. A new ETF rebalance supersedes older pending ETF rebalance targets.
3. Legacy ETF momentum weights are stored in `etf_allocations` and remain the
   compatibility tactical ranking input until v2.0 runs are accepted.
4. ETF target deltas are calculated against latest statement holdings.
5. Core ETF targets are calculated only for asset classes with confirmed ETF
   mappings.
6. Momentum weights adjust selected Core ETF targets; they do not fill a
   whole-book ETF shortfall.
7. ETF execution state is tracked separately from Q3/Q4 Portfolio Risk and manual Portfolio Rebalancing.
8. ETF methodology details may remain in a specialist reference document, but the contract above is authoritative.
9. ETFs that do not fit a canonical stock-analysis class may be assigned to a
   custom fund allocation class. Custom classes can group and receive ETF/fund
   allocation, but they cannot route stock council analysis.
10. A custom ETF/fund class must define its risk bucket/quartile so Q3/Q4
   portfolio-risk calculations can treat the exposure deliberately.
11. `PINE_PARITY_V1` uses a `±2.0 percentage-point` per-ETF allocation
    acceptance band. Exact matches and drift inside the band require no user
    action; only a larger allocation difference or incomplete comparison must
    be rectified. Rank and return differences are diagnostic, not independent
    action triggers.
12. Core ETF identity is explicit policy. Mapping an ETF to an asset class, or
    having only one mapped candidate, does not select it as that class's Core
    ETF.
13. The compact ETF Monitor reports allocation variance neutrally. A positive
    or negative target delta does not become an `ADD`, `REDUCE`, or `EXIT`
    instruction until the relevant gate and action workflow create one.

## Statement Validation

Broker/account statement import is external evidence.

Rules:

1. The user records intended reductions or moves.
2. The system stores expected after-values.
3. A later statement import is compared against expected values.
4. If the statement matches within tolerance, the workflow can progress.
5. If it does not match, the workflow shows variance.
6. Variance must not be hidden behind automatic completion.
7. The user must be able to reopen actions or import a later statement.

## UI Language Rules

User-facing sections for action workflows:

1. Active Actions
2. Alert Type
3. Selected Sleeve
4. Workflow

Naming rules:

- The specific trigger is the action label: `Q3 Detector`, `Q4 Crisis`, `New Portfolio Target`.
- The broad family is the alert type: `Portfolio Risk`, `Portfolio Rebalancing`.
- Do not duplicate the same signal name in every section.
- Avoid unexplained labels like `Approve Baseline` for Q3/Q4 risk-on.
- Use exact business action language: `Review Portfolio Shape`, `Mark Reviewed`, `Confirm Position Actions`.

## Current Implementation Gaps

| Gap | Why it matters |
| --- | --- |
| Live TradingView TMS scripts must include `cdf_state` on stop alerts. | Without it, old `sell` payloads are treated as legacy full stops. |
| ETF momentum source cutover still requires accepted parity evidence. | The source is now explicit and fail-closed, but `LEGACY_COMPATIBILITY` remains authoritative until the internal run is deliberately selected. |
| Q3 risk-on wording and action treatment need regression protection. | It must be visible but must not force trades or create portfolio targets. |
| Portfolio reserve cash and asset-class tactical cash need clearer UI/API separation. | Confusing these cash types can mislead allocation decisions. |
| Breakout funding gaps are not yet a first-class workflow. | Users need to know when high-priority opportunities are unfunded. |
| Strategic drift review is not yet formalised as a passive review workflow. | Drift should be visible without becoming automatic churn. |
| Commodity-theme outperformance limits and deleverage actions are not implemented. | The current Markets summary is advisory, aggregates security-stage evidence at theme level, and duplicates CDF in its theme stage model. It is insufficient for per-security actioning. |
