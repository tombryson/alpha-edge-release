# Commodity Theme Presentation And Signal Contract

Status: `Live market-map and sleeve-accounting slice; Policy v1.0 for
live-cap behaviour`. The current Markets workspace stores durable
commodity-theme evidence, presents it for review, and distinguishes an
approved direct execution vehicle from a chart source. It remains advisory:
the per-security live-cap projection, commodity-derived actions, and statement
reconciliation described here are the agreed target, not current production
behaviour.

The authoritative commodity investment policy is
[Commodity Theme Live-Cap Policy v1.0](../decisions/COMMODITY_THEME_LIVE_CAP_POLICY_V1.md).
This document owns the evidence vocabulary, Markets presentation, and API
migration. It must not introduce a second allocation formula.

## Purpose

Commodity themes are not a separate portfolio or a Markets-only dashboard.
They provide live context for configured price-taker asset classes inside the
existing Alpha Edge investment process:

```text
Portfolio risk (Q3/Q4)
  -> approved asset-class and sleeve budget
  -> Analysis research target
  -> existing CDF/VWMA/TMS entry, add, trim, stop, and re-entry process
  -> commodity-theme capacity context where configured
  -> user action and broker-statement reconciliation
```

The overlay applies only to explicitly configured commodity-linked classes. It
does not change Quality, Value, Council, price targets, `IN` / `OUT`, a full
research target, or the approved strategic portfolio shape.

## Policy Review: 14 September 2026

The user requested discussion of an explicit Outperform sizing rule before any
implementation. The 75%/100% proposal below is **not approved or implemented**.
Current code requires a configured Outperform feed and known direction; its
direction supplies evidence, not an automatic position cap. Equity-breakdown
trims are implemented separately. Live Analysis percentages remain advisory.

The user proposed replacing the cap concept with a 1.25 multiplier on a Bull
stock's existing suggested weight, normalised against peers inside its class.
For equal starting weights, one boosted stock would receive 55.56% and its peer
44.44%; the class budget would not grow. This is distinct from adding 25 percentage
points or promising a final allocation exactly 25% larger after normalisation.

On 15 September the user clarified that these modifiers belong to the Analysis
suggestion layer, which remains display-only. They do not promote its output
into binding targets. An independent purchase-blocking or trim rule must not be
implemented by treating those suggestions as approved holdings limits. The
polling consolidation implements neither a sizing multiplier nor a new trim;
the advisory modifier is separate follow-up work. This review takes precedence
over future-tense implementation suggestions later in this document.

## Separate Sleeves

Direct commodity and producer-equity exposure express a related thesis but are
separate sleeves. They are never stages in one interchangeable four-part gate.

| Sleeve | Gold example | Governing evidence | Meaning |
| --- | --- | --- | --- |
| Direct commodity | Physical gold or approved bullion instrument | Gold-price regime | Governs direct commodity only. |
| Producer equity | Gold miners, producer ETF, or direct miner | `GDXJ / GLD`, existing CDF state, and security / `GDXJ` Outperform | Governs producer-equity eligibility and concentration. |

Gold-price confirmation may make physical gold eligible. It does not permit a
gold-miner purchase. A confirmed producer-equity path does not rewrite a
physical-gold target or force a physical-gold sale.

The configured direct source is not a broker product. Until the user records
an IG-accessible instrument, every direct sleeve is `SIGNAL_ONLY`; Markets must
show the market signal as evidence only. When a direct sleeve has an approved
portfolio target without an approved broker vehicle, Markets raises **Direct
vehicle review**, not a buy action. Direct and producer-equity class cash is
always retained in the originating class; it cannot silently fund another
market.

## Evidence Topology

Each configured commodity class has two additional class-scoped theme events.
Each direct producer stock has one additional security-scoped theme event.
CDF/TMS remains the existing security signal system.

| Scope | User-facing evidence | Gold example | Function |
| --- | --- | --- | --- |
| Asset class | Direct commodity | Gold price | Direct-commodity sleeve context only. |
| Asset class | Equity regime | `GDXJ / GLD` | Producer-equity expression gate. |
| Security | Company Trend | Existing CDF `BUY` / `SELL` | Existing trend/deployment context; derived read state, not a theme webhook. |
| Security | Outperform | Security / `GDXJ` | Current: relative-direction evidence and required setup. Proposed concentration limit remains unresolved. |
| Security | TMS | Existing add, trim, stop, re-entry, breakout | Existing execution lifecycle; not a theme event. |

For Gold Miners the applicable equity path is:

```text
Equity regime:    GDXJ / GLD
Company Trend:    existing security CDF state
Outperform:       security / GDXJ
```

**Company Trend** is the Markets label for canonical CDF state. It is not a
new source, a second CDF webhook, or an additional gate. TMS remains the
post-entry lifecycle owner and owns re-entry eligibility; it uses CDF for
ordinary trend context and stop severity.

## Proposed Live-Cap Consequences (Not Implemented)

The original proposal applied a cap to a research-derived amount. This is not
the current authority model: Portfolio approves class budgets, while Analysis
produces live advice. The following table is retained for policy discussion,
not as a current purchase rule. Current eligible purchases use the shared ticket in
[Pooled Capital Deployment Policy v1.0](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).

| Equity regime | CDF | Outperform | Purchase consequence | Permitted target |
| --- | --- | --- | --- | --- |
| `BUY` | `BUY` | `BUY` | One shared ticket when all normal entry rules pass. | 100% of research target, pending capacity-policy validation. |
| `BUY` | `BUY` | not `BUY` | One shared ticket when all normal entry rules pass. | 75% of research target, pending capacity-policy validation. |
| `SELL` | any | any | No new producer-equity entry, add, breakout, or re-entry. | No new producer-equity deployment. |
| any | `SELL` | any | No new security entry or ordinary add under the shared CDF gate. Existing CDF/TMS reductions and TMS re-entry remain authoritative. | Commodity policy adds no separate full exit. |

Under that proposal, Outperform would permit the final 25% increment without
creating a buy. Neither the target basis nor the excess-holding consequence has
been agreed, so this behaviour must not be inferred from current Bull/Bear state.

## Action Consequences

Theme events are immutable closed-bar evidence. They create an alert only when
a material user response is required under
[Signal And Action Contract](SIGNAL_AND_ACTION_CONTRACT.md).

| Valid transition | Derived result |
| --- | --- |
| `SECURITY_OUTPERFORM: BUY -> SELL` | Record security-scoped **Underperformance** evidence/alert. No automatic 75% cap or cap-derived trim. Any future trim requires the open policy decision above. |
| `EQUITY_RELATIVE: BUY -> SELL` | One class-scoped **Equity Regime Strong Trim 20%** across producer equities, including mapped producer ETFs and excluding direct commodity. Block new producer-equity entries, adds, breakouts, and re-entries. |
| Equity regime or CDF returns to `BUY` | Purchase eligibility may return under existing rules. No required buy. Outperform direction currently changes evidence, not capacity. |
| Direct commodity `BUY -> SELL` | Direct-sleeve state only. Physical/direct commodity exit remains a separately approved policy. |
| Required event source becomes stale | Review item. Preserve prior live-cap state; staleness is not a sell. |

Commodity actions remain chronological alongside CDF/TMS, Q3/Q4, and portfolio
rebalancing actions. The system must not manufacture a combined target or
submit a broker order.

## Markets Presentation

Markets is the full review surface. Analysis and Positions show compact context
and route into the relevant market; Portfolio remains the approved-allocation
and accounting surface.

The visual model is a direct-commodity gate beside a separate three-step equity
path, never a triangle:

```text
PHYSICAL GOLD
  Gold price: confirmed

GOLD MINERS
  GDXJ / GLD: confirmed -> Company Trend: CDF BUY -> Outperform: waiting
```

States must use text as well as colour:

| State | Meaning |
| --- | --- |
| `CONFIRMED` | Latest valid event is `BUY`. |
| `WAITING` | Legacy compatibility value. New commodity feeds are initialised with an explicit `BUY` or `SELL` baseline and do not use `WAITING`. |
| `BLOCKED` | Latest valid event is `SELL`. |
| `STALE` | Required event is older than its allowed period. |
| `DISCONNECTED` | The feed is not registered in Alerts, or no canonical stock CDF state is available. |

### Market Map Overview

The overview renders the two sleeves as separate column groups:

```text
            DIRECT COMMODITY          | PRODUCER EQUITIES
Market      Trend   60D     Vehicle   | Equity regime     Qualifying     Held / budget
Gold        Bull   +14.8%   —         | Open  GDX / GLD   2 of 4 ■■□□   $34.0K / $34.0K
Silver      Bull   +11.2%   —         | Closed SIL / SLV  0 of 1 □       —
```

- The equity regime is labelled **Open** (Buy) or **Closed** (Sell) because it
  is the producer-equity gate.
- **Qualifying** counts companies per security: CDF trend Buy *and* Outperform
  Buy for the same company. It never pairs trend and Outperform evidence from
  different securities. Standing marks are dimmed while the regime is closed.
- Missing connections appear only as a setup control beside the row's expand
  control; there is no permanent next-step column.
- The overview does not compute a combined verdict, target or action.

### Market Detail

The detail view keeps the Direct commodity / Producer equities split. It shows
the regime and per-company Qualifying evidence with each signal's latest event
date, and the producer-equity sleeve as held value, approved budget and class
cash held. It does not display the legacy aggregate `permitted_value`, which
must never read as a sizing or funding figure. One selected company drives both
company charts, so Company trend and Outperform are always charted for the same
security.

These are internal API status values. Markets renders their trading meaning:
`BUY` / `SELL` for price and regime gates, `BUY n/total` / `SELL n/total` for
company trend, and `OUTPERFORM n/total` / `UNDERPERFORM n/total` for the
relative-security stage. Markets explains evidence and opens source charts. It
is not an order surface.
At most one detailed market review is open at a time; its four charts are
supporting evidence, not application truth.

### Direct Commodity 60-Day Return

The Market Map shows a compact `60D` figure in the Direct commodity column
group, beside the commodity trend it describes. It is the return of the configured direct-commodity chart source only, measured
from the closest prior market close at least 60 calendar days earlier. It is
neither a CDF result nor a broker-vehicle return, and it never changes a
`BUY`/`SELL` state, class capacity, or action.

Daily source history is cached in `commodity_price_daily` and is refreshed only
by the explicit Markets refresh control. The `COMMODITY` stage returns
`return_60d_pct` and `performance_as_of`; missing or unsupported source data is
rendered as unavailable rather than estimated.

### Market Source Configuration

Market names and TradingView source pairs are durable operator configuration,
not frontend constants. The Markets row reveals a fixed left-edge edit control
on hover. It may change the display name, market group, direct commodity symbol,
or producer-equity / commodity pair; a new or removed market is always a
complete pair with explicitly mapped direct and producer asset classes.

Replacing a source never rewrites old `commodity_theme_events`. The current
read model matches evidence against the active configured source, which means a
replacement appears unconnected until its new CDF alert is recorded and the
operator selects its current `BUY` or `SELL` baseline in Commodity Connections.
The configured producer-equity numerator also becomes the denominator of every
eligible security's Outperform connection, so the Alerts tab changes in lock
step with the market configuration. Old TradingView alerts should then be
removed from TradingView by the operator; their ledger rows are retained rather
than silently deleting a possibly shared CDF setup.

### Analysis And Positions Context

Analysis does not gain commodity columns. A configured asset-class group header
may show a compact path indicator and open Markets. Once the live-cap projection
is implemented, a relevant row may reveal its preserved research target, any
current Outperform limit, and its separately calculated deploy ticket.

Positions shows the holding-level consequence: actual holding, live
Outperform limit where applicable, and a pending Outperform Trim or Equity
Regime Strong Trim. The detailed path stays in Markets.

## API Migration

`POST /api/webhook/theme-confirmation` stores scoped, append-only commodity
evidence. It must not use the generic regime endpoint and must not trade, move
cash, or change `IN` / `OUT`.

Target event vocabulary:

| Stage | Scope | Target transport |
| --- | --- | --- |
| `COMMODITY` | `THEME` | Theme confirmation event. |
| `EQUITY_RELATIVE` | `THEME` | Theme confirmation event. |
| `SECURITY_OUTPERFORM` | `SECURITY` | Theme confirmation event using the CDF relative variant: `script: cdf`, `signal_version: cdf.relative.v1`. |
| Company Trend | `SECURITY` | Derived from canonical CDF state; never posted to theme confirmation. |

`SECURITY_TREND` remains a compatibility read model for the Market Map; the
retired `SECURITY_LEADERSHIP` stage is inactive. `SECURITY_OUTPERFORM` accepts
the CDF-relative transport, but the live-cap calculation remains unfinished.
Legacy aggregate `confirmation_count`, `permitted_value`, and
`available_value` are presentation-only compatibility fields; they must never
fund, size, or action an individual security.

`POST /api/commodity-themes/price-history/refresh` refreshes the configured
direct-commodity daily source cache. It has no interaction with TradingView
connection state or confirmation events.

### Direct-expression and class-capital read model

Every theme response now includes additive fields:

```json
{
  "direct_expression": {
    "status": "SIGNAL_ONLY",
    "existing_position_treatment": "CLASS_DEFINED"
  },
  "direct_sleeve": {
    "asset_class_code": "PHYSICAL_GOLD",
    "target_value": 0,
    "invested_value": 0,
    "sleeve_cash_value": 0,
    "capital_value": 0,
    "budget_approved": false
  },
  "equity_sleeve": {
    "asset_class_code": "GOLD_MINERS",
    "target_value": 0,
    "invested_value": 0,
    "sleeve_cash_value": 0,
    "capital_value": 0,
    "budget_approved": false
  },
  "reviews": []
}
```

With securities requested, the response also carries `producer_funds`: the
ETFs assigned to the theme's equity class, each with `security_id`, `ticker`,
`name`, `trend_state` (canonical CDF state from `security_positions`, the
same source Positions reads) and `trend_updated_at`. Funds are evidence only.
They have no Outperform feed and are excluded from `eligible_securities`,
company stage counts and Qualifying.

`capital_value = invested_value + sleeve_cash_value`. Markets uses this to
show actual exposure without presenting class-held cash as either deployable
portfolio cash or market exposure.

`PATCH /api/commodity-themes/{code}/direct-expression` records an explicit
direct execution state. It accepts `SIGNAL_ONLY` or `APPROVED`; `APPROVED`
requires at least an `instrument_label` or `instrument_ticker`. It does not
submit an order, change a position, move capital, or decide direct-sleeve exit
behaviour. Markets exposes this as a per-market IG vehicle editor, so the
user can record, replace, or clear a broker-accessible vehicle when access
changes without changing the market registry in code.

Every target theme event retains an idempotency key, theme, stage, scope,
security identity where applicable, source pair, signal version, timeframe,
closed-bar time, and raw payload. A late event cannot overwrite a newer closed
bar.

## Delivery Sequence

1. Configure and version each eligible class, its direct commodity, equity
   regime pair, mapped producer ETFs, stable security identities, and explicit
   broker-accessible direct vehicle status. A TradingView chart symbol alone is
   never a vehicle configuration.
2. Migrate the theme registry from legacy security-stage events to derived CDF
   plus `SECURITY_OUTPERFORM`.
3. Build the backend per-security projection defined in the live-cap and pooled-
   capital policies.
4. Generate only the prescribed Outperform Trim and Equity Regime Strong Trim
   alerts, using the shared action lifecycle and statement reconciliation.
5. Expose one backend projection in Markets, Analysis, Positions, Portfolio,
   Alert Stack, and Actions.
6. Backtest and UAT Gold before activating any further commodity class.

## Non-Goals

- a separate commodity portfolio or mandatory physical/ETF/stock split;
- using aggregate confirmation counts as a personal target;
- duplicate CDF state or a duplicate CDF sell action;
- automatic orders, cash transfers, or `IN` / `OUT` changes;
- applying this framework to non-price-taker industries;
- deciding the physical/direct commodity exit policy by accident.
