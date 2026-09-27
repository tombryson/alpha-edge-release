# Commodity Theme Live-Cap Policy v1.0

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

Status: `Policy v1.0; staged implementation.` The commodity registry now
records whether a direct-market signal has an explicitly approved broker
vehicle, and returns direct/equity sleeve capital separately from market
exposure. Per-security live-cap sizing, shared deploy tickets, and the full
action lifecycle remain future work. This document does not claim that the
current Markets page, sizing endpoint, or Actions page enforces the complete
policy.

Related documents:

- [Business Logic](../system/BUSINESS_LOGIC.md) owns the overall decision hierarchy,
  Q3/Q4 overlay, base sizing, CDF/TMS, and cash semantics.
- [Commodity Theme Presentation And Signal Contract](../system/COMMODITY_THEME_PRESENTATION_AND_SIGNAL_CONTRACT.md)
  owns the configured market registry, event payload, read APIs, and Markets
  presentation.
- [Actions Workflows](../system/ACTIONS_WORKFLOWS.md) owns durable user actions and
  broker-statement reconciliation.
- [Pooled Capital Deployment Policy v1.0](../system/POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md)
  owns the shared class-cash funding and deploy-ticket calculation.
- [Work Ledger And Strategy Migration](WORK_LEDGER_STRATEGY_MIGRATION.md)
  records the earlier exploratory capacity model. Where it conflicts with this
  document, this policy is authoritative.

## 1. Decision

Commodity-theme evidence is not a separate investment system or a Markets-only
dashboard. It is a live eligibility and position-sizing layer inside the
existing Alpha Edge decision hierarchy.

```text
Portfolio risk overlay (Q3/Q4)
  -> approved asset-class and sleeve budget
  -> research target for each eligible security
  -> existing CDF/VWMA/TMS deployment, stop, and execution workflow
  -> commodity-theme capacity limits and class-regime signals, where the theme applies
  -> broker execution and statement reconciliation
```

The layer applies only to configured price-taker or clearly commodity-linked
themes. It must not be generalized to businesses such as pharmaceuticals,
healthcare services, or broad technology merely because they have a sector.

The strategy intentionally uses correlated confirmation. Commodity economics,
producer-equity relative strength, security CDF state, and company outperformance are
not independent votes. Their agreement is the evidence that permits a more
concentrated expression of the same thesis.

## 2. Separate Direct Commodity And Equity Sleeves

Direct commodity exposure and producer-equity exposure are related, but they
are not substitutes and must not be counted as stages of one four-part gate.

| Sleeve | Gold example | Governing evidence | Result |
| --- | --- | --- | --- |
| Direct commodity | Physical gold or an approved bullion instrument | Gold-price regime | Governs the direct commodity sleeve only. |
| Producer equity | Gold miners, producer basket, or direct miner | core fund / commodity, existing CDF state, and company / core-fund outperformance | Governs the gold-equity sleeve only. |

A positive Gold price signal may make a physical-gold holding eligible. It does
not add any direct-miner allocation. Conversely, a fully confirmed gold-equity
path does not rewrite the physical-gold target or force a sale of physical
gold.

### 2.1 Direct Execution Is Explicit

A chart symbol is evidence, not evidence of broker access. `AMEX:GLD`, a spot
series, an ETF, or a futures chart must never be silently treated as something
the account can buy through IG.

Each configured direct sleeve therefore has one durable execution state:

| State | Meaning | Capital consequence |
| --- | --- | --- |
| `SIGNAL_ONLY` | The market source is configured, but no IG-accessible vehicle has been approved. | The signal is visible in Markets only. It creates neither a purchase ticket nor implied direct exposure. |
| `APPROVED` | The user has recorded a broker-accessible instrument label/ticker and kind. | The direct market signal may be evaluated against that separately approved direct sleeve. It still does not authorise producer equities. |

Every theme begins `SIGNAL_ONLY`. The approved instrument must come from the
user's IG availability list, not from a TradingView source or a guessed proxy.
The Markets configuration editor is the editable per-market record for that input, so a
later-discovered or retired vehicle can be recorded without a code change.
An existing direct position remains governed by its class policy until a
specific direct reduction/exit policy is approved; no generic exit behaviour
is inferred by recording a vehicle.

The policy does not require a permanent split between physical exposure, a
producer ETF, direct stocks, and breakouts. A producer basket may be an early
or broad implementation of a confirmed equity regime. A mature equity sleeve
may be entirely direct miners if the individual securities qualify. Any generic
ETF minimum-exposure policy remains a separate portfolio decision until the
ETF policy is explicitly reconciled with this one.

## 3. Signal Topology And Existing CDF

Each commodity-enabled asset class has exactly two new class-scoped alerts and
each direct stock has exactly one new stock-scoped alert. CDF/TMS remains the
existing per-stock feed; it is neither reposted nor reconstructed by the theme
system.

| Scope | User-facing signal | Gold example | Transport ownership | Purpose |
| --- | --- | --- | --- | --- |
| Asset class | `COMMODITY` | Raw Gold trend | Theme confirmation | Governs the direct commodity sleeve. |
| Asset class | `CORE FUND / COMMODITY` | `GDXJ / GLD` | Theme confirmation | Establishes the producer-equity expression context. |
| Stock | Company Trend (CDF) | Existing `BUY`, `SELL` | Existing security webhook | Normal trend and deployment authority. |
| Stock | TMS | Existing add, trim, stop, re-entry | Existing security webhook | Owns the position-management lifecycle and re-entry eligibility; it reads CDF state for stop severity and ordinary deployment context. |
| Stock | `OUTPERFORM` | Miner / `GDXJ` | Theme confirmation | Earns or removes the final concentration increment. |

`COMMODITY` and `CORE FUND / COMMODITY` are configured per asset class. For
example, Gold Miners use a raw-Gold signal and `GDXJ / GLD`; Copper Miners use a
copper signal and `COPX / copper`; Oil Producers use WTI and `XOP / WTI`.
The core fund is the configured equity benchmark for that asset class, not a
security-specific choice.

`OUTPERFORM` is a single `BUY` / `SELL` switch for one security against that
configured core fund. It is the only additional stock chart/alert connection.
The current backend name `SECURITY_LEADERSHIP` is legacy transport terminology;
the target API and all user-facing language use `SECURITY_OUTPERFORM` and
`Outperform`.

For a direct producer equity, the applicable evidence path is:

```text
1. Equity expression:   core fund / commodity is confirmed
2. Security CDF state:  the individual security is in the existing CDF BUY or SELL state
3. Outperform:           the individual security outperforms its core fund
```

For Gold the signals are, initially:

```text
Equity expression:   GDXJ / GLD
Security CDF state:  the security's existing closed-bar CDF state
Outperform:          security / GDXJ relative-strength state
```

CDF is already Alpha Edge's canonical security trend state. In
Markets, it may be labelled **Company Trend** so the path reads naturally. That
label is a presentation of the CDF `BUY` / `SELL` state only, not a new signal,
alert, or gate. TMS remains the existing add, trim, stop, and re-entry layer;
it owns the post-entry and post-stop lifecycle, not CDF. CDF continues to arrive through
`POST /api/webhook/tradingview`, update the normal security state, and use the
existing CDF/TMS action rules. The commodity-theme layer must read that state.
It must not receive a second `SECURITY_TREND` webhook, manufacture a parallel
company-trend state, or make plain CDF `SELL` mean a new full-liquidation rule.

`SECURITY_OUTPERFORM` is the new relative-performance evidence. TMS remains an
execution and stop/add/trim signal, using the canonical CDF state as context.
Neither the outperformance overlay nor the theme read model may replace the
CDF/TMS action contract.

### 3.1 Outperformance concentration overlay

The 75/25 outperformance concentration overlay is a policy hypothesis pending
Gold and portfolio-aware backtesting. It applies only while the core fund /
commodity signal is confirmed and the existing CDF state is `BUY`. It changes a
permitted target; it does not create, size, or reserve a purchase.

| Evidence state | Direct-stock outperformance limit |
| --- | ---: |
| Core fund / commodity and CDF are `BUY`; `OUTPERFORM` is not confirmed | `75%` of the security's research target |
| Core fund / commodity, CDF, and `OUTPERFORM` are `BUY` | `100%` of the security's research target |
| CDF is `SELL` | No new entry or ordinary add under the shared CDF gate. Existing CDF/TMS reduction, Exit, and TMS re-entry rules remain authoritative; this policy adds no separate full-exit rule. |
| Core fund / commodity is `SELL` | New producer-equity entries, adds, breakouts, and re-entries are blocked. A class-scoped Equity Regime Strong Trim requests a 20% reduction of producer-equity holdings. It does not touch the direct-commodity sleeve or force a full exit. |

This makes outperformance economically meaningful without duplicating CDF. The
existing CDF `BUY` state provides the normal deployment context. Outperformance
earns the final 25% concentration increment. CDF `SELL` retains its existing
semantics: plain state sync does not create a full sell command, `cdf_sell_zone`
is `Sell Down 20%`, and TMS stops determine stronger reduction or Exit.

An ETF or producer basket can be considered when the core fund / commodity is
confirmed but no direct security has a CDF `BUY` state. This is a
possible implementation choice, not a residual holding requirement and not a
way to bypass the direct-stock gates. Once the core fund / commodity is `SELL`,
the same entry/add/re-entry block applies to direct miners and producer ETFs.

### 3.2 Entry Timing Uses The Shared Pooled-Capital Ticket

The commodity overlay does not replace CDF/VWMA/TMS entry discipline or the
shared class-pool ticket:

```text
valid CDF BUY + configured VWMA entry condition -> eligible for one deploy ticket
later valid TMS buy/add                         -> eligible for a later ticket from then-current class cash
```

For a commodity-linked direct equity, the overlay may change the permitted
target, not the ticket amount:

| Equity regime | Outperform | Valid entry or add | Permitted target |
| --- | --- | --- | --- |
| `BUY` | `BUY` | One shared class-pool ticket when CDF/VWMA rules pass | `100%` of research target, subject to validation |
| `BUY` | not `BUY` | One shared class-pool ticket when CDF/VWMA rules pass | `75%` of research target, subject to validation |
| `SELL` | any | no new entry, add, breakout, or re-entry | no new producer-equity deployment |

`OUTPERFORM` is permission for the final 25% concentration increment. It is not
an entry trigger and must not force a purchase when it becomes `BUY`.

## 4. Target Taxonomy And Formula

The system must keep five values distinct. It must never silently overwrite one
with another.

| Value | Meaning | Owner |
| --- | --- | --- |
| Research target | The full dollar target from approved class budget and existing Analysis sizing. | Portfolio + sizing |
| Outperformance limit | The part of a CDF-BUY research target currently permitted by `OUTPERFORM` evidence. | Commodity-theme policy |
| Execution capacity | The amount that may be entered or added now under CDF/TMS and funding rules. | CDF/TMS + cash workflow |
| Actual holding | Broker-derived current quantity and value. | Statement/holdings |
| Required outperformance trim | The amount by which actual holding exceeds the outperformance limit. | Action projection |

For security `i`:

```text
research_target_i = output of the existing approved sizing cascade
equity_context_i  = 1 when CORE FUND / COMMODITY is CONFIRMED, else 0
cdf_i             = 1 when the existing CDF state for i is BUY, else 0
outperform_i      = 1 when SECURITY_OUTPERFORM is CONFIRMED for i, else 0

outperform_limit_i = research_target_i * (0.75 + 0.25 * outperform_i)
                     only after the 75%/100% cap policy is validated
required_trim_i    = max(actual_holding_i - outperform_limit_i, 0)
                     only when equity_context_i = 1 and cdf_i = 1

target_shortfall_i = max(outperform_limit_i - actual_holding_i, 0)
ticket_i           = min(shared_class_ticket,
                         target_shortfall_i,
                         remaining_class_funding)
                     only when the CDF/VWMA and commodity gates are valid
```

`ticket_i` is calculated by the shared pooled-capital policy. There is no
commodity-specific initial 50% order and no stock-specific second tranche. A
later valid TMS add competes for current class funding and can never exceed the
then-current permitted target.

Example:

```text
Research target for a Gold Miner:       $2,000
Core fund / commodity:                  CONFIRMED (`GDXJ / GLD`)
Security CDF:                           BUY
Outperform (`security / GDXJ`):         SELL

Outperformance limit:                   $1,500
Actual holding:                         $2,000
Required deleverage:                    $500
```

The base research target remains `$2,000`. The position is not "underweight"
against a target that has vanished. It is `$500 above its outperformance limit`.
If `OUTPERFORM` later reconfirms, the limit returns to `$2,000`; this creates
allocation capacity, not a compulsory purchase.

## 5. State Transitions And Required Actions

The word "optional" applies before capital is deployed. Once a position is
held because a gate was confirmed, removal of that gate changes its permitted
live size.

| Valid transition | Result | Action |
| --- | --- | --- |
| `SECURITY_OUTPERFORM: BUY -> SELL` while core fund / commodity and CDF remain `BUY` | Outperformance limit moves from `100% -> 75%` of research target. | Create a sequential `REDUCE_TO_OUTPERFORM_LIMIT` signal for the 25% increment. |
| CDF `BUY -> SELL` | CDF blocks new entry and ordinary add; the commodity policy does not recalculate a separate zero cap or veto TMS re-entry. | Use existing CDF/TMS handling only. Do not create a duplicate commodity action. |
| `CORE FUND / COMMODITY: BUY -> SELL` | Blocks new producer-equity deployment, including entries, adds, breakouts, and re-entry. | Create one class-scoped `EQUITY_REGIME_STRONG_TRIM` signal: reduce each current producer-equity holding by 20%. Exclude the direct-commodity sleeve. |
| Core fund / commodity or CDF returns to `BUY`, or `OUTPERFORM` becomes `BUY` | Relevant deployment or concentration capacity may expand. | No required buy. Expose allocation capacity or an unfunded opportunity only. |
| `COMMODITY: BUY -> SELL` | No change to producer-equity outperformance limits | Evaluate the direct-commodity sleeve under its own policy. |

An action is an auditable instruction to review and execute a deleverage. It
is not an automatic broker order. The action should contain the prior and new
gate state, policy version, full target, prior outperformance limit, new outperformance limit, current
holding estimate, required dollar and unit reduction, price timestamp, source
event, and deep links to Positions and Markets.

If an independent TMS stop, CDF sell-down, Q3/Q4 overlay, or portfolio rebalance
also calls for reduction, Alpha Edge records each valid signal in chronological
order. It must not manufacture a composite final target, silently merge signals,
or decide which trade the user should execute. An earlier full `SELL` appears
before later percentage reductions; once the user records execution, later cards
refresh against the broker-confirmed remaining holding. A percentage action with
no remaining holding becomes `NOT_APPLICABLE` for that mechanical reason only.

## 6. Event Validity, Staleness, And Audit

The commodity webhook is an evidence transport. Alpha Edge is responsible for
making its use reproducible and safe.

1. A newly confirmed feed receives one operator-selected `BUY` or `SELL`
   baseline through the Alerts connection ledger. The baseline establishes the
   current state but never projects an alert, action, allocation, or position
   change. Later closed-bar `BUY` or `SELL` webhooks update that state and may
   project their documented transitions. `CONNECT` is ignored entirely: it is
   not state, not evidence, and is not persisted. CDF company trend is read
   from its existing canonical security signal; it is not duplicated here.
2. Every event must retain `event_id` or a derived idempotency key, theme,
   stage, scope, stable `security_id` where applicable, source pair, script,
   signal version, timeframe, `bar_closed_at`, and raw payload.
3. State is determined by the latest valid event for the exact theme, stage,
   and security scope. Older events received late must not overwrite a newer
   closed bar.
4. The strategy/signal source is responsible for emitting a confirmed state
   transition rather than a transient intrabar observation. Alpha Edge must not
   invent a second, hidden hysteresis rule.
5. A `STALE` input blocks new capital from being unlocked and creates a review
   item. It preserves the last outperformance limit for existing holdings until an explicit
   stale-unwind policy is approved; staleness is uncertainty, not a `SELL`.
6. A recovery event records the new state but does not delete, merge, or resolve
   an earlier valid action. The action history and chronological evidence remain
   immutable; the user decides whether to act on the remaining signal set.

## 7. Funding And Cash Treatment

The policy produces permission and required reductions. It does not move cash.

| Situation | Correct treatment |
| --- | --- |
| A target is never deployed because `OUTPERFORM` is absent | Withheld or unreleased capacity. It is not cash and should not be shown as a deficit. |
| A CDF-BUY held stock loses `OUTPERFORM` | A pending `$` deleverage action for the outperformance increment until the trade is executed. |
| The deleverage is executed | Proceeds become expected tactical cash in the same asset class, subject to statement reconciliation. |
| Another qualified direct miner needs capital | It may compete for the class's pooled tactical cash through the normal funding workflow. |
| Physical gold is attractive | It requires its own approved sleeve and direct-commodity decision. Proceeds do not move there automatically. |

### 7.1 Class-Locked Capital

The application records three distinct values for each commodity sleeve:

```text
invested value + sleeve cash = class capital
```

`invested value` is current market exposure. `sleeve cash` is realised or
reserved capital attributed to that same asset class. `class capital` is the
sum and is useful for reviewing the approved sleeve against its target. Only
the first value is market exposure.

If a producer-equity gate is not confirmed, any producer-sleeve cash is held
inside that class. It is not a deficiency, not a cross-class funding pool, and
not a silent reason to reshape the portfolio. Markets and Portfolio show this
as **Class cash held**. Moving it to another commodity or removing the class
mandate remains an explicit Portfolio Shape decision.

If a direct sleeve has a target but remains `SIGNAL_ONLY`, Markets shows
**Direct vehicle review**. This is a configuration decision, not a buy alert;
the system cannot assume a product exists.

There is no permanent stock-level cash reservation. A recovered `OUTPERFORM`
signal does not recreate the cash that was used elsewhere; it can create a
funded or unfunded allocation opportunity.

## 8. Screen Responsibilities

| Surface | Required presentation |
| --- | --- |
| Markets | Full evidence path, source events, state history, direct and equity sleeves, and deep chart inspection. It explains why a permitted target changed. |
| Analysis | Preserve the full research target. On applicable rows or group context, reveal CDF state and `Outperform` status without turning the grid into a chart dashboard. |
| Positions | Show actual holding against the outperformance limit when it applies, and make the incremental amount explicit. This is the primary holding-level consequence. |
| Portfolio | Aggregate approved sleeve budget, actual exposure, and the sum of outperformance limits without double counting physical and equity sleeves. |
| Actions | Own chronological outperformance and equity-regime trim signals, their progress, execution evidence, and reconciliation. It must not turn the signal history into an automatic netting engine. |

The compact default should read as a boundary, not four competing target bars:

```text
Gold Miners
Actual $2,000 | Outperform limit $1,500 | Increment $500
Theme: GDXJ/GLD confirmed, CDF BUY, Outperform blocked
```

Hover or detail can expose full target, live-cap calculation, event time,
source pair, execution context, and action history.

## 9. Explicit Non-Automations

This policy must not:

- submit a broker order;
- change `IN` or `OUT` in the Analysis sizing universe;
- overwrite Quality, Value, Council, price targets, or the base research target;
- rewrite a strategic portfolio mix or transfer cash across asset classes;
- infer that a confirmed company qualifies every security in its asset class;
- create a second CDF state, CDF webhook, or CDF SELL action;
- present uninvested permitted capacity as cash or an allocation shortfall.

## 10. Current Implementation Gap

The existing commodity-theme slice is still primarily evidence and Markets
presentation. Its first capital-accounting slice deliberately distinguishes
execution availability, invested exposure, and class-held cash; it is not yet
eligible to enforce the complete policy.

| Current behaviour | Why it is insufficient for v1.0 |
| --- | --- |
| Theme-level `permitted_value` is calculated from an aggregate count of confirmed stages. | A different security can satisfy CDF and `OUTPERFORM` conditions, incorrectly implying full theme confirmation. Per-security outperformance limits must be calculated independently. |
| `available_value` is `permitted_value - actual_value`. | This is a policy arithmetic gap, not verified deployable cash. It must not be labelled or treated as cash. |
| Confirmation events are stored and surfaced. | They do not yet calculate per-security research target, permitted target, shared deploy ticket, required outperformance trim, class-scoped Equity Regime Strong Trim, or durable sequential actions. |
| The endpoint accepts configured security-stage payloads. | `SECURITY_TREND` duplicates the existing CDF source of truth. It must become a derived read-model field, while the theme endpoint accepts only `SECURITY_OUTPERFORM` for a security. |
| Markets, Analysis, and Positions consume an advisory summary. | They do not yet display full target, CDF state, outperformance limit, actual holding, or route an outperformance action. |
| Direct source symbols previously looked like possible holdings. | Direct expressions now default to `SIGNAL_ONLY` and require a recorded broker vehicle, but no direct order or direct exit policy is implemented. |
| Sleeve values previously risked conflating cash and exposure. | The API now returns `invested_value`, `sleeve_cash_value`, and `capital_value`; no cross-class transfer engine exists by design. |

## 11. Implementation Sequence

The policy should be delivered as an extension of the existing signal and alert
system, not as a parallel portfolio-risk workflow.

1. **Freeze registry and policy inputs.** Configure each commodity-enabled
   asset class with direct commodity, core fund / commodity pair, producer ETF
   mappings, stable security identifiers, and an explicit `SIGNAL_ONLY` or
   `APPROVED` direct broker vehicle. Gold starts with `GDXJ / GLD`; an IG
   direct instrument is not guessed from that source.
2. **Build one backend-owned per-security projection.** It reads the approved
   research target, current statement holding, canonical CDF state, latest
   equity-regime event, latest `OUTPERFORM` event, and the shared class-funding
   snapshot. It returns any permitted target, target shortfall, and proposed
   shared deploy ticket. It must not mutate Analysis scores, `IN` / `OUT`, or
   the research target.
3. **Extend the existing alert/action record.** Do not create a second
   per-stock workflow. Store source event key, scope (`SECURITY` or
   `ASSET_CLASS`), closed-bar time, policy version, holding/price snapshot,
   suggested percentage or dollars, affected holdings for a class action, and
   the mechanical `NOT_APPLICABLE` resolution.
4. **Generate sequential signals.** A security `OUTPERFORM BUY -> SELL` creates
   its own trim signal when it breaches the 75% cap. An `EQUITY_RELATIVE BUY ->
   SELL` creates exactly one class Strong Trim signal with 20% suggestions for
   current producer-equity holdings. Preserve all valid signals in timestamp
   order; never create a composite reduction target.
5. **Apply the equity-regime gate to increases only.** Block entry, TMS add,
   breakout, and re-entry while the class ratio is `SELL`. Preserve CDF/TMS
   ownership of ordinary entry timing, trim, stop, and re-entry state.
6. **Expose the same projection in the existing surfaces.** Markets explains
   the evidence; Analysis keeps the research target and compact context;
   Positions shows current holding, live cap, and pending signals; the Alert
   Stack shows the sequential action queue; Portfolio aggregates exposure
   without treating undeployed capacity as cash.
7. **Backtest and UAT Gold before expansion.** Test the shared `$100 / 10%`
   ticket and competing-candidate model against alternative entry utilisation
   fractions and any 75%/100% capacity policy, then test every adverse signal
   sequence using closed-bar fixtures and statement reconciliation.
8. **Define physical direct-commodity exit separately.** Do not enable a raw
   commodity `SELL` to alter physical holdings until its own reduction policy
   has been agreed and tested.

## 12. Implementation Acceptance Criteria

The policy is ready for implementation only when all of the following are true:

1. The backend projects a per-security outperformance limit from a versioned
   policy and does not aggregate CDF or `OUTPERFORM` evidence across securities.
2. The calculation reads the canonical CDF state, uses the existing full
   research target and class-budget controls, and does not mutate that target.
3. Every valid adverse transition creates one idempotent signal/action for its
   own closed-bar transition: per-security for `OUTPERFORM`, class-scoped for an
   equity-regime Strong Trim. Recovery never deletes the earlier signal.
4. Action amounts are based on a recorded holding and price snapshot and are
   reconciled against subsequent broker evidence.
5. Actions preserve their chronological source order across CDF/TMS, theme,
   Q3/Q4, and portfolio-rebalance signals. Later cards recompute their suggested
   amount only after recorded execution; no backend action resolver nets them.
6. UAT fixtures cover a valid `$100 / 10%` deploy ticket, target-shortfall and
   class-funding caps, CDF SELL's blocked-increase path, a class Strong Trim, a
   stale-review condition, and an `OUTPERFORM` loss from a live holding.
7. Markets, Analysis, Positions, Portfolio, and Actions read the same backend
   projection rather than recreating CDF or outperformance policy in components.
8. Gold is tested first; each additional commodity theme requires its own
   configured sources, economic rationale, and backtest before activation.

## 13. Decisions Still Open

The following are intentionally not hidden inside v1.0:

1. The required stale period for each source and whether a long stale state
   eventually forces a scheduled reduction rather than review only.
2. The direct-commodity `COMMODITY: BUY -> SELL` reduction/exit policy. It is
   separate from the producer-equity Strong Trim and must not be inferred from it.
3. The precise exchange, currency, and comparator treatment for non-US
   securities measured against US producer baskets.
4. Backtest thresholds for activation, including turnover, drawdown, lag, and
   whether the 75/25 increment is robust across each theme.

These are policy questions to resolve explicitly. They must not be answered by
an accidental UI calculation, a mock-data seed, or an opaque backend default.
