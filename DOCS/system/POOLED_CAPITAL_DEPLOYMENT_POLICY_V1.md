# Pooled Capital Deployment Policy v1.0

Status: `Partially live. The Security Action Queue projects advisory class-pool tickets; dedicated class-risk capacity and automatic candidate generation remain pending.`

This policy replaces the ambiguous initial-entry rule expressed as "Buy 50%".
It governs new direct-stock entries, TMS adds, re-entries, and breakouts that
draw from an asset-class tactical-cash pool. It does not create broker orders.

Related documents:

- [Business Logic](BUSINESS_LOGIC.md) owns the decision hierarchy, analysis
  sizing, CDF/TMS state, and cash concepts.
- [Decision Flows](DECISION_FLOWS.md) owns the cross-page user workflow.
- [Signal And Action Contract](SIGNAL_AND_ACTION_CONTRACT.md) owns alert,
  action, evidence, and reconciliation state.
- [Commodity Theme Live-Cap Policy](../decisions/COMMODITY_THEME_LIVE_CAP_POLICY_V1.md)
  owns any commodity-specific cap on an otherwise valid research target.

## Optional Weight Management (18 September 2026)

[Ideal weight management](IDEAL_WEIGHT_MANAGEMENT.md) is the accepted replacement
for the **individual** stored-allocation ceiling described below. Default Off removes
both the old individual ceiling and the new Ideal wt ceiling. On uses the live
backend ideal amount for purchase room and adds persistent, material excess
reduction proposals. The existing class, cash, risk and execution rules remain.

The legacy `w_i` / `stock_analysis.allocation` path below is historical where it
describes a stored individual ceiling. It is not a fallback in Off mode.
No automatic broker execution is authorised by either policy.

Where an earlier document says an initial entry is `50%`, a CDF `SELL` entry is
`50%`, or a second tranche is reserved for an individual stock, this policy
supersedes it.

## 1. Decision

Alpha Edge allocates capital top-down. A stock's calculated target is a desired
holding inside an approved sleeve. It is not cash permanently reserved for that
stock.

```text
Portfolio risk envelope
  -> approved asset-class target
  -> direct-stock sleeve target
  -> research target for each qualified stock
  -> class cash and capacity available now
  -> CDF / TMS / commodity eligibility
  -> one explicit deploy ticket
  -> user execution and statement reconciliation
```

The policy has three separate units. They must never be described by the same
unqualified percentage:

| Unit | Meaning | Example |
| --- | --- | --- |
| Research target | Desired current holding for one security inside a direct-stock sleeve. | `R_i = $1,200` |
| Class funding | Cash that is actually permitted and available for new deployment. | `F_c = $1,000` |
| Deploy ticket | One proposed purchase from that funding pool. | `B_c = $100` |

`Buy 50%` is prohibited language. The UI must show a dollar amount, the
remaining research-target shortfall, and the class-pool balance instead.

## 2. Target, Capacity, And Funding

For asset class `c` and security `i`:

```text
A_c = approved dollar target for asset class c
s_c = direct-stock sleeve ratio for asset class c
D_c = A_c * s_c                         direct-stock sleeve target
w_i = approved security target weight within class c
R_i = D_c * w_i                         full research target for security i
H_i = broker-confirmed current holding value for security i
H_c = broker-confirmed direct-stock holding value in class c
L_i = currently permitted target for security i
G_i = max(L_i - H_i, 0)                 remaining target shortfall
```

Normally, `L_i = R_i`. A separately approved overlay may set a lower permitted
target without changing the full research target. For example, the commodity
policy may apply an unvalidated 75%/100% outperformance cap. That policy is
not a cash reservation and must not be used as an initial-entry fraction.

At the opening of an execution cycle, spendable class funding is:

```text
C_c = confirmed tactical cash available to class c
K_c = max(D_c - H_c, 0)                 remaining direct-stock class capacity
P_c = capital that the active portfolio-risk envelope permits for class c
F_c = min(C_c, K_c, P_c)
```

`P_c` is class-specific permitted capacity. It must not be replaced with a
whole-portfolio Q3/Q4 headroom figure. A portfolio-wide risk number cannot by
itself fund every asset class.

### Current queue projection

The action queue retains legacy security targets, now constrained by the latest
approved class budget. These are not a new binding approval of live research
suggestions. The shared class-budget implementation (`pooled-capital-class-budget-v4`):

- `A_c` is the latest statement value multiplied by the approved class weight.
- `E_c` is the existing Core ratio plus its bounded automatic momentum
  adjustment, after the ETF Sell gate. No Core selection means no ETF target.
- `D_c = max(A_c - max(E_c, active ETF holdings in the class), 0)`. A reduced
  target releases unoccupied capacity, not unsold holdings or expected proceeds.
- Analysis dollar suggestions, ETF `stock_capacity_value`, and direct-stock
  purchase calculations share that same budget. They no longer apply the legacy
  `stock_allocation_ratio` or derive the class mandate from research allocations.
- `w_i` is the security's stored allocation, normalised within that
  asset class's direct stocks, excluding ETFs. It remains a legacy security-level
  cap, deliberately not a live browser-side score calculation or new approval.
- `H_i` and `H_c` use the current active holdings ledger.
- The Q3 working ceiling counts all class holdings and pending purchases. The
  direct-stock ceiling counts stock holdings and stock purchases; unsold/pending
  ETF capital is accounted for in `D_c`, not subtracted twice.
- ETF purchases use the chosen ETF's effective target, never the direct-stock
  allocation. Pending buys are tracked by class and security, including queued
  tickets during projection. Unknown model data pauses buys without hiding exits.
- `C_c` starts from the configured class cash proposal, excludes pending
  sale/deposit increments, and is constrained by statement-backed funding below.

### Purchase permissions (9 September 2026)

Implementation: `pooled-capital-gated-v3`. This extends the statement-backed cash boundary, without changing sell arithmetic or the
approved strategic shape.

```text
approved_class_budget = latest_statement_value * approved_class_weight / 100
Q3_factor = 1 - (1 - Q3_pct / 100) * class_q3_throttle_factor
working_class_budget = approved_class_budget * Q3_factor
class_room = max(working_class_budget - all_active_class_holdings - pending_class_buys, 0)
stock_budget = max(approved_class_budget - max(effective_ETF_target,
                   active_ETF_holdings + pending_ETF_buys), 0)
stock_room = max(stock_budget - active_stock_holdings - pending_stock_buys, 0)
remaining_stock_capacity = min(class_room, stock_room)
```

- Q3 reduces the ongoing spending ceiling, not the existence of TMS signals.
  A fully sensitive class approved at 10% has a 5% working budget at Q3=50.
  With a $10,000 portfolio, $350 held and no pending buys, $150 capacity remains.
  A $100 ticket is possible only if the class also has confirmed funding.
- The point-in-time risk sale remains `(1 - new_Q3 / last_applied_Q3)` times
  invested value at the signal, adjusted by class sensitivity. It is a separate
  calculation from the ongoing approved-budget ceiling above.
- Risk-reduction proceeds belong to portfolio reserve, not the reduced class's
  tactical reserve. Computing capacity neither creates cash nor transfers it.
- Active Q4 pauses purchases in classes with a positive Q4 liquidity factor.
  Clearing Q4 restores evaluation under the current Q3 state, not automatic 100%.
- Missing/unregistered required feeds pause recommendations even when a saved
  direction says Buy. No age-based expiry is applied to transition-driven feeds.
  This includes the applicable risk detectors, security CDF (ETF TMS for an ETF
  TMS-origin action), TMS for a TMS-origin action, and configured commodity feeds.
- Ordinary entries/adds/breakouts require a known stock Buy direction. Valid
  TMS REENTRY may proceed under stock CDF Sell, but still needs its feeds,
  class risk permission, market permission, target room and statement cash.
- Producer classes require a connected, initialised Equity-relative Buy feed.
  Physical commodity Sell is not a producer-equity block. Direct commodity
  classes instead require their physical trend to be Buy.
- Configured Outperform requires registration and a known direction; its Sell
  direction remains evidence, not an implementation of the unvalidated
  75%/100% capacity hypothesis. Source changes require a new matching baseline.
- Normal execution rechecks gates, class and security capacity, and cash in its
  transaction. Reported units cannot silently exceed those limits.

An already-executed purchase may be recorded as an explicit **purchase
exception**, with units, AUD spent and a reason. It is available in the existing
action drawer for open or priority-blocked security purchases. The exception
retains the policy/queue evidence, reserves the reported AUD amount, and waits
for statement unit matching. It neither approves the purchase nor changes
broker holdings/cash, clears Q4, or resolves a higher-priority Exit. Ambiguous
net buy/sell movements may still require review rather than automatic matching.

This does not introduce a draft portfolio, freeze live research, replace the
ETF engine, or finish R4's individual-stock approval workflow. Live research
remains display-only. The v4 class-budget calculation above extends v3's
permissions.

### Statement-backed funding (8 September 2026)

Implementation: `pooled-capital-cash-backed-v2`. This is a cash-safety boundary, not completion of
R4/R5 risk policy.

1. Only the latest account statement's `cash_aud` funds IG purchase tickets.
   Holding values, cash-equivalent ETFs, legacy per-security reserves, expected
   sale proceeds and proposed class reserves are not additional broker cash.
2. Configured class reserves remain editable proposals. Positive pending or
   mismatched `STOCK_SALE` / `EXTERNAL_CAPITAL` increments are subtracted from
   each class's usable proposal, floored at zero. No elapsed-time rule or newer
   statement alone confirms an individual cash-source claim.
   Downward revisions cancel expected funding first; an earlier reduction of
   existing cash cannot pre-fund a later expected sale or deposit.
3. If the sum of active classes' usable proposals exceeds statement cash, all
   IG buy tickets remain unfunded with an explanatory instruction. There is
   no proportional haircut, automatic class transfer, or arbitrary selection
   of which proposed class to fund. Unused classes still count in this check.
4. Reported purchases awaiting statement confirmation, including variances,
   reserve cash before any open ticket, both globally and in their recorded
   class. Reclassifying/removing a security cannot release its global commitment.
   A legacy reported purchase with no reliable amount blocks further funding.
   Remaining class proposals must also fit cash after these commitments; this
   prevents moving a commitment out of a class from funding other proposals.
5. Open tickets share what remains, subject to existing class/security shortfalls
   and the $100 minimum / 10% rule. Tickets are recalculated, not added as extra
   commitments on every refresh. `FUNDED` means cash-backed, not fully risk-cleared
   or a broker order. CDF/TMS behaviour, including valid re-entry, is unchanged.
6. Both Positions execution and Alert Stack buy decisions use the same atomic
   execution path. It rechecks funding inside the transaction before writing a
   decision, resolving the alert and recording the purchase commitment. Rejected
   buys do not create decisions or resolve their alerts.
7. An optional reported unit count reserves the larger of the proposed ticket
   and its AUD cost estimate. The original ticket stays intact; the separate
   `execution_cash_value` records the commitment. Foreign holding values use
   `value_aud / quantity`; a new holding requires an unambiguous ASX AUD quote
   for this estimate. Unknown cost or a cost beyond available funding is rejected.
8. Confirmed buys are not subtracted from broker cash twice: the newer statement
   already contains the cash change. Configured class proposals are not silently
   rewritten after a purchase, so they may need reducing to fit the newer cash
   balance. Variances remain conservatively reserved pending resolution.

Examples:

- Broker cash $500, class proposal $5,000: no funded ticket; retain the proposal.
- Broker cash $500, Gold $300 and Copper $300: no funded tickets until revised.
- Broker cash $500, Gold $500, reported purchase $200: $300 remains for new
  tickets, not $500. The reported purchase reserves first even if its signal
  arrived later than an unexecuted signal.
- Broker cash $500, class proposal $500 including $450 of pending sale proceeds:
  only $50 is usable, so no $100 ticket can be funded.
- A subsequent statement includes a confirmed $100 purchase and shows $400 cash:
  the broker cash input is $400, not $300. Revise stale class proposals if their
  total still exceeds that $400.

The cash-movement table does not yet have automatic source-provenance matching.
Once cash is actually present in the statement, the user can explicitly assign
existing broker cash with `PORTFOLIO_CASH_TRANSFER`. That replacement cancels
earlier pending/mismatched sale/deposit intents for the class, preserving them
as audit records; it does not label those source claims confirmed.

Limits: estimates do not guarantee execution price, fees, settlement availability
or unreported broker activity. External/manual holdings are outside IG funding.
The execution/projector lock assumes the current single-process backend; a
multi-writer deployment requires database-level reservation coordination.

The dedicated, class-specific `P_c` risk-capacity input does not exist yet. The
live queue therefore projects `min(C_c, K_c)` and labels every result as an
advisory ticket. It does **not** substitute global overlay headroom for `P_c`.
No ticket is a broker order, and no money is moved until a statement confirms it.

If `F_c` is zero, the system creates an unfunded opportunity or requires a
funding decision. It must not invent a stock-level cash reservation or pull
money silently from another class.

## 3. Eligibility Gates

Before a purchase ticket can be proposed, all applicable gates must pass:

1. The security is Analysis-qualified and has an approved asset class.
2. The class has remaining direct-stock capacity and confirmed funding.
3. The active Q3/Q4 portfolio-risk envelope permits new exposure in that class.
4. The stock is below its permitted target: `G_i >= $100`.
5. A new entry, ADD, or BREAKOUT has CDF state `BUY` and its configured VWMA
   entry condition is valid where one applies.
6. A re-entry has a valid TMS `REENTRY` event and a stopped/waiting position
   state. Re-entry eligibility is owned by TMS; CDF `SELL` does not cancel it.
7. For a commodity-linked producer equity, the configured equity-regime gate is
   `BUY`; any live-cap policy must also permit the amount.

CDF `SELL` has one precise meaning for ordinary new deployment:

```text
No holding:       no new entry.
Existing holding: no ordinary add.
Stopped/waiting:  a valid TMS re-entry remains eligible.
```

It is a trend and deployment gate, not a full exit command. Existing position
management remains independent and chronological:

- `cdf_sell_zone`: Sell Down 20% of current holding.
- TMS stop with embedded CDF `BUY`: Sell Down 50% of current holding.
- TMS stop with embedded CDF `SELL`: Exit the remaining current holding.
- TMS trim: reduce the defined percentage of current holding.

TMS owns the stopped/waiting and re-entry lifecycle. CDF informs normal trend
context and stop severity; it does not cancel a valid TMS re-entry.

## 4. Deploy Ticket Rule

The ticket is calculated from the class funding available at the start of the
queue projection. It is not recalculated after each candidate, because order of
arrival must not silently change the base dollar amount.

```text
F_c_open = funding available when the cycle starts
B_c      = max($100, 10% * F_c_open)
order_i  = min(B_c, G_i, F_c_remaining, liquidity_limit_i)
```

The system may propose an order only when `order_i >= $100`, the current broker
minimum. `liquidity_limit_i` is optional until a separately approved execution
policy defines it.

Examples:

| Class funding at cycle open | Base ticket | Meaning |
| ---: | ---: | --- |
| `$1,000` | `$100` | Five valid candidates can each receive a `$100` ticket while `$500` remains for later signals or higher-ranked names. |
| `$2,000` | `$200` | The ticket scales with class funding, subject to each stock's target shortfall. |
| `$300` | `$100` | The broker minimum exceeds 10%; execution remains possible but consumes one-third of the pool. |
| `< $100` | no order | The pool cannot satisfy the broker minimum; show an unfunded/insufficient-cash state. |

The `$300` example is an explicit small-pool trade-off, not hidden behaviour.
The user may later approve a minimum new-position pool threshold if preserving
small residual cash is preferable to making a concentrated minimum order.

Each security may receive at most one automatic recommendation per closed-bar
cycle. Concurrent qualified candidates compete for the same `F_c_remaining`.
The interface must disclose the pool balance and any candidates that remain
unfunded; it must not imply that every qualified candidate owns a future
tranche.

## 5. Signal Strength And Sizing

TMS strength remains valid evidence. It must not, however, imply a large and
unvalidated difference in buy dollars.

| Signal | Main user instruction | Initial v1 size treatment | Evidence treatment |
| --- | --- | --- | --- |
| `strong_add` | Add | One base deploy ticket | Keep `Strong` and timeframe as evidence. |
| `weak_add` | Add | One base deploy ticket | Keep `Weak` and timeframe as evidence. |
| `strong_trim` | Trim | Existing evidence-backed reduction rule against current holding. | Keep distinct from weak trim. |
| `weak_trim` | Trim | Existing defined reduction rule against current holding. | Keep distinct from strong trim. |

The primary action label is `Add` or `Trim`. Strength and timeframe are shown
as supporting evidence, for example `Strong setup · 1D`; they are not rendered
as a claim that one buy deserves a radically larger allocation.

No arbitrary frontend multiplier may assign different dollar amounts to Strong
and Weak Add events. A future buy-size distinction requires a portfolio-aware
test. A possible future comparison is a 10% base ticket against a 12.5% Strong
ticket, but that is not approved by this policy.

## 6. Initial Entries, Adds, Re-Entries, And Breakouts

All purchase paths use the same class-pool and ticket calculation unless a
future backtest supports a named exception.

| Purchase path | Required state | Suggested action |
| --- | --- | --- |
| New qualified candidate | CDF `BUY`, valid entry condition, class funding, target shortfall | Deploy one ticket. |
| TMS Add | Existing eligible position, CDF `BUY`, class funding, target shortfall | Add one ticket. |
| TMS Re-entry | Stopped/waiting state, valid TMS re-entry, class funding, target shortfall | Re-enter with one ticket. |
| Breakout | Valid breakout, CDF `BUY`, class funding, target shortfall | Deploy one ticket; mark as a breakout-originated demand. |

This policy deliberately does not reserve a "second tranche." A later valid
signal competes for then-current class capital. If that capital has been used by
a better opportunity, Alpha Edge shows the gap rather than fabricating funding.

## 7. Commodity-Linked Producer Equities

Commodity evidence remains an additional eligibility and permitted-target layer;
it is not a separate cash pool or a replacement for CDF/TMS.

```text
Equity regime BUY + security CDF BUY + valid entry + class funding
  -> producer equity may receive a normal deploy ticket.

Equity regime SELL
  -> block new producer-equity entries, adds, breakouts, and re-entries;
     emit the existing class-scoped Equity Regime Strong Trim.

Security Outperform BUY/SELL
  -> affects only a separately approved permitted-target cap; it never itself
     creates a purchase ticket.
```

The old `50% initial -> 75%/100% later` path is retired. Any 75%/100%
commodity concentration cap remains a policy hypothesis that requires its own
Gold and portfolio-aware backtest before it becomes an enforced limit.

## 8. User-Facing Requirements

Every buy-side action must show:

```text
Deploy / Add / Re-enter: $X
Class funding: $Y before, $Z after
Security target shortfall: $G
Why now: CDF, TMS event, commodity context, and rank evidence
```

Every percentage reduction must show its denominator:

```text
Sell Down 20% of current holding
Sell Down 50% of current holding
Trim N% of current holding
Exit remaining current holding
```

The system records the action instruction, its inputs, and the user's execution
report. Broker statement import remains the authority for actual holdings and
for the next calculation of `H_i`, `H_c`, and available class funding.

## 9. Required Validation Before Automation

No ticket may be automatically executed. Before the UI may treat ticket size as
an approved recommendation, test the following across a portfolio-aware,
walk-forward simulation:

1. Entry-ticket variants: 50%, 75%, 90%, and 100% of an equivalent capital
   budget, compared against the v1 `$100 / 10%` ticket rule.
2. Competing candidates inside the same class, rather than a single-symbol cash
   pool.
3. Class targets, direct-stock sleeve ratios, current holdings, Q3/Q4 limits,
   CDF/VWMA gates, TMS events, commodity gates, and broker minimums.
4. Fees, spread/slippage, turnover, concentration, cash utilisation, maximum
   drawdown, time underwater, and out-of-sample returns.
5. Strong versus Weak Add events, controlling for timeframe and market regime.

The test must establish an economically material improvement, not merely a
small in-sample return difference, before changing the base-ticket rule or
giving Strong Add a larger dollar amount.

## 10. Implementation Status

Implemented now:

1. The Security Action Queue derives a per-security target, direct-stock class
   capacity, class cash, and a persisted `$100 / 10%` advisory ticket.
2. Concurrent open candidates consume the same class pool in closed-bar order.
3. Strong and Weak Adds retain evidence but receive the same base ticket.
4. An ordinary Add/entry in current `SELL` state has no funded ticket, while a
   valid TMS Re-entry remains eligible.
5. The Positions action drawer shows ticket, class funding before/after, target
   shortfall, and blocks execution reporting until a ticket is funded.
6. The legacy Alert modal no longer creates an arbitrary percentage-sized Add.
7. The UAT event simulator seeds a dedicated Gold Miners cash pool and verifies
   a funded Add ticket through the normal webhook and queue path.

Still required before any automation:

1. Persist a consistent execution-cycle snapshot including class-specific
   `P_c`, rather than recomputing advisory values from the latest ledgers.
2. Build the dedicated class-risk-capacity input and commodity equity-regime
   gate into the ticket projection.
3. Generate new candidate entries from qualified CDF/VWMA state rather than
   only projecting already-created deploy alerts.
4. Add the approved commodity permitted-target cap after its separate
   portfolio-aware backtest.
5. Expand the simulator with action resolution and competing-candidate cases,
   then run the portfolio-aware validation in section 9.
