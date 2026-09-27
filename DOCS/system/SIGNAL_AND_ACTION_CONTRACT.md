# Signal And Action Contract

Status: `Implemented for direct security actions and the class-scoped
commodity equity-regime reduction`. The future per-security Outperform live-cap
projection remains policy work. The security action queue projects existing
per-security action alerts into a lifecycle without replacing the raw alert or
portfolio-risk records.

## Purpose

Alpha Edge must distinguish market evidence from the work it creates. A source
signal is never evidence that a trade happened. A user-recorded action is never
evidence that a broker filled it. The broker statement remains the external
truth of execution.

```text
Closed-bar signal event
  -> current state or policy projection
  -> actionable instruction, only where a response is required
  -> operator records action or explicit override
  -> broker statement confirms or shows variance
```

This contract extends the existing Actions workflow. It does not create a
second portfolio-risk engine, replace CDF/TMS, or change the Analysis sizing
universe.

## Terms

| Term | Meaning |
| --- | --- |
| Signal event | Immutable source evidence: a closed-bar CDF, TMS, Q3/Q4, ETF, or commodity-theme event. |
| State | Latest valid interpretation of a signal source, such as CDF `BUY`, Q4 active, or `OUTPERFORM` `SELL`. State can be visible without creating work. |
| Policy projection | Backend-owned consequence of current state plus portfolio facts, such as permitted capacity, a required reduction, or a class block. |
| Alert | Immutable source evidence and the existing user-facing alert record. |
| Security action | A lifecycle projection for a direct security alert: scope, intent, instruction, holding snapshot, queue status, and reconciliation state. |
| Decision | The user's recorded response to an alert. It is not execution proof. |
| Execution report | The user's record that an external trade was placed or completed. |
| Reconciliation | Comparison of the reported action against a later broker statement: matched or variance. |

`active_alerts` remains the existing internal name for TradingView connection
registrations. It is not an open user action and must not be presented as one.

`security_actions` does not replace `alerts`. It derives one row from each
eligible direct-security alert and keeps the original alert ID as its audit
link. An Equity Regime Strong Trim is the one implemented exception: a valid
commodity-theme `EQUITY_RELATIVE` breakdown creates one asset-class action,
linked to a derived alert and the immutable commodity event key. The affected
holdings are snapshot context, not cloned action records. Q3/Q4 stay in their
own workflow tables.

## Alert Contract

Every actionable alert must declare these fields before it reaches the Alert
Stack or Actions surface:

| Field | Required meaning |
| --- | --- |
| Scope | `SECURITY`, `ASSET_CLASS`, or `PORTFOLIO`. |
| Intent | `DEPLOY`, `REDUCE`, `EXIT`, or `REVIEW`. |
| Instruction basis | `PERCENT_OF_CURRENT_HOLDING`, `DOLLAR_VALUE`, `TARGET_HOLDING_VALUE`, `TARGET_EXPOSURE`, or `NONE`. |
| Instruction | One explicit requested amount, target, or review outcome. |
| Source | Immutable source event, script, closed-bar time, policy version, and reason. |
| Holding snapshot | Current quantity, value, and price where the alert affects a holding. |
| Validity | Creation time, expiry where applicable, and stale/mapping status. |
| Reconciliation requirement | Whether broker-statement confirmation is required after the user records execution. |

Different units are valid. They must not be disguised as the same kind of
alert. For example, `Sell Down 20% of current holding`, `Reduce $500 to the
Outperform limit`, and `Reduce Q1 exposure to the required portfolio amount`
are three explicit instructions with different scopes and bases.

## Lifecycle

### Trade alerts

`DEPLOY`, `REDUCE`, and `EXIT` alerts follow this lifecycle:

```text
OPEN
  -> EXECUTION_REPORTED
  -> AWAITING_STATEMENT
  -> CONFIRMED | VARIANCE
```

For ordinary time-bounded alerts, `IGNORE`, `EXPIRED`, and `NOT_APPLICABLE`
remain valid outcomes under the existing alert rules. `NOT_APPLICABLE` is a
mechanical closure, not proof of a sale. It can mean a later percentage
instruction has no remaining holding, but the backend also uses it to retire
simulator-reset records. The UI must not label every such record "No holding
remaining" or "Statement confirmed".

The next trading-day work surface must show open alerts from the prior day as
unreported work, and execution reports without a matching statement as
`Awaiting statement`. This makes it visible whether the user acted, rather
than treating the absence of a click as an outcome.

### Review alerts

`REVIEW` alerts do not imply a trade and do not require a statement. Q3
allocation available is the existing example: the user may review Portfolio
Shape and mark the item reviewed, without creating a target, a reduction, or a
broker-confirmation task.

### Portfolio workflows

Q3 risk-off, Q4 Crisis, and Portfolio Rebalancing retain their existing parent
workflows and statement checks. A compact alert may route the user into that
workflow, but it must not duplicate its totals, recorded reductions, or final
status in a second position-alert record.

## Exit Gate

An `EXIT` is the highest-severity security action. It is the user-facing result
of a full TMS stop in bearish CDF context; the raw source event may remain
`sell`, but the Alert Stack and Positions action column use **Exit**.

An open Exit cannot be dismissed, ignored, or allowed to disappear by expiry.
It can reach a completed state only after:

1. the operator records the exit execution; and
2. a later broker statement confirms the expected remaining holding.

The operator may deliberately retain the position, but only through an explicit
recorded override with a reason and, where useful, a next-review time. That
override leaves the Exit visible as an unresolved risk item; it is not a bypass
or a completed action.

## Alert Stack And Decision History (2026-09-11)

The Positions **Action** cell is an attention surface, not a compressed target
calculator. It shows one primary unresolved instruction per security. Clicking
an actionable instruction opens its detail through the left **Alert Stack**, revealing
the rail on desktop. On mobile the detail replaces the stack drawer while open
and returns to it on close, avoiding competing modal focus traps. Clicking the
alert in the stack opens the same detail. There is no separate Security Action
Queue drawer.

- **Pending** in Positions means execution was recorded and awaits a statement;
  **Check** means a statement mismatch. Tooltips spell out the state. The old
  queue-count / `stmt` shorthand is removed. Pending links to filtered Decision
  History rather than reopening an active-alert detail.
- Alert Stack contains at most one managed attention item per security or
  shared class/portfolio scope. Only a backend-primary `OPEN` instruction,
  `VARIANCE`, or `OVERRIDDEN` record is eligible. If multiple review records
  coexist, an unresolved Exit takes precedence, then a review issue over an
  ordinary instruction, then the backend primary, oldest source time and ID.
  This selects a display representative; it does not promote or merge actions.
- `AWAITING_STATEMENT`, `BLOCKED`, non-primary open actions and closed records
  do not generate chips, even if their raw alerts remain active or cached.
  Independent non-action alerts retain their existing behaviour. A dismissed
  raw alert cannot hide an eligible unresolved Exit or review issue.
  The mounted reader remembers managed alert IDs so stale raw alerts cannot
  reappear when completed records leave the pending API. This is in-memory
  display suppression, not an API write, expiry or deletion policy.
- Successful recording/ignoring closes the detail; an execution disappears
  from the stack while the backend checks subsequent statements. A mismatch
  returns labelled **Statement mismatch**, without presenting the old trim
  percentage as a fresh trade. A retained Exit remains an explicit review item.
- Open primary alerts retain optional units and an execution note. Funded IG
  purchases show the current backend ticket; unfunded purchases cannot use
  ordinary execution recording. An Exit has **Retain with reason**, not Ignore.
- Where the backend permits it, **Record purchase exception** captures an
  already-executed purchase with positive units, AUD spent and a reason. It is
  not purchase approval and still awaits a statement. External execution is
  labelled as manually recorded, not IG-verified.
- Failed writes leave the alert visible. Unavailable execution status disables
  write controls and exposes Retry. Reads refresh on an action change, when the
  page becomes visible, and every 30 seconds while visible.
- **Decision history** at the bottom of Alert Stack opens History / Signals.
  The same link in an alert detail filters it to that ticker. Decision History
  joins saved decisions to current verification state by alert ID and includes
  pending executions, blocked/open source records and closed system records
  without a user decision. Open/blocked rows say **Not recorded**, not System
  closure, and retain their original signal date. **View record** exposes source,
  dates, execution notes/units, exceptions and statement references when stored.
  It does not create a duplicate editable queue or infer missing trade evidence.

The **Alerts tab** remains the TradingView connection ledger. Portfolio Q3/Q4
and rebalance workflows are unchanged. This is a UI consolidation, not deletion
of `security_actions`, source alerts, decisions or reconciliation rules.

### Backend Ordering (Unchanged)

Primary action priority is:

1. `EXIT`
2. `REDUCE`: `SELL_50`, `SELL_DOWN`, and `TRIM`
3. `DEPLOY`: `ADD`, `BUY`, `BREAKOUT`, and `REENTRY`

Within a priority tier, the earlier closed-bar alert is first. The primary
action remains open while all later unresolved actions for that security are
`BLOCKED`. Recording execution changes the primary action to
`AWAITING_STATEMENT`; it remains primary and continues to block later action
records. The next broker statement either changes it to `CONFIRMED` or
`VARIANCE`. Only a confirmed, ignored, expired, or mechanically
not-applicable action releases the next action. The stack hiding a pending or
blocked row does not release that action or make its proceeds spendable.

An explicit Exit override remains unresolved and continues to block later
security actions. A variance also remains primary until the operator resolves
the mismatch outside the automated queue.

### Quantity Matching (2026-09-08)

- Execution accepts optional positive `units`. These are the user's reported
  traded units, matched to the statement quantity change with only a 0.0001-unit
  numerical allowance. This verifies the reported execution, not compliance
  with the original suggested trade size.
- With units omitted, capture the latest holding quantities at execution-report
  time. `SELL_DOWN` expects a 20% decrease, `SELL_50` expects 50%, and `EXIT`
  expects the entire remaining holding. A class reduction checks 20% of **each**
  affected IG holding, not the combined market value.
- Estimated movements match within +/-10% of expected units: 9 or 11 against
  an estimate of 10 both match. Zero movement, the wrong direction, and
  materially too-small or too-large movements do not. Exit still requires no
  remaining units; the tolerance does not turn a partial sale into an exit.
- Deployment estimates use the funded AUD ticket divided by AUD value per
  share. Existing holdings supply `value_aud / quantity`; a new ASX holding can
  use an explicitly ASX-qualified research quote. Missing prices or an
  unconverted foreign quote do not justify inventing a quantity estimate.
- TMS `TRIM` uses the existing Alert Stack percentages: Strong 20%, Weak 5%.
  These now also produce the backend quantity estimate; they are not new
  sizing rules. An unclassified legacy Trim has no known percentage: without
  reported units it retains the quantity-decrease check, labelled
  `QUANTITY_DIRECTION` (amount not verified), not a successful 10% size check.
- Stable security identity takes precedence over names. A missing name match
  is not proof of exit. Inferring zero requires a stable identity and a complete
  statement with no unresolved security identities. Legacy records without an
  execution-time quantity snapshot are not silently upgraded to unit matches.
- Where a baseline statement exists, only a newer dated statement for that
  same account is eligible. This guard does not replace validation of the
  statement import itself; complete IG snapshots remain the input assumption.
- External securities use manual completion (`MANUAL_EXTERNAL`), not IG
  verification. Mixed class actions check IG members and retain the manual
  external distinction. No new broker/account model is introduced. Recording
  these actions does not credit broker cash or create spendable proceeds.

## Approved Position Language

| Source or derived type | User-facing label | Intent | Basis |
| --- | --- | --- | --- |
| CDF `BUY` / `SELL` | Buy / Sell trend | state only | none; SELL blocks new entries and ordinary adds but is not a full exit command or a TMS re-entry veto |
| TMS `strong_add` / `weak_add` | Add | deploy | one shared class-pool ticket; strength/timeframe are supporting evidence, not a dollar multiplier |
| TMS `strong_trim` / `weak_trim` | Trim | reduce | source-specific percentage of current holding; strength/timeframe remain supporting evidence |
| `SELL_DOWN` | Reduce | reduce | 20% of current holding in action detail |
| `SELL_50` | Reduce | reduce | 50% of current holding in action detail |
| TMS full `SELL` in CDF `SELL` context | Exit | exit | remaining current holding |
| `REENTRY` | Re-enter | deploy | one shared class-pool ticket when TMS stopped/waiting requirements and funding are satisfied |
| `BREAKOUT` | Enter | deploy | one shared class-pool ticket, only while CDF is BUY and funding exists |
| `REDUCE_TO_OUTPERFORM_LIMIT` | Outperform Trim (proposed) | reduce | Not generated by a current 75% cap; target basis and trim policy remain unresolved. |
| `EQUITY_REGIME_STRONG_TRIM` | Equity Regime Strong Trim 20% | reduce | 20% of each affected producer-equity holding |

The shared ticket, its funding inputs, and its `$100 / 10%` calculation are
defined in [Pooled Capital Deployment Policy v1.0](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).
No client-side Strong/Weak sizing multiplier is permitted.

`Liquidate` is retired from the Positions action column and alert copy. The
canonical backend code may remain compatible during migration, but its target
action meaning is `EXIT`.

## Optional Weight-Based Reductions

The [Ideal weight management policy](IDEAL_WEIGHT_MANAGEMENT.md) defines a new
opt-in source of reduction proposals, not another interpretation of TMS TRIM.
Stocks trigger at 150% of ideal and reduce to 125%; Core ETFs trigger at 125%
and reduce to 100%, subject to two qualifying daily observations and the
greater-of-A$100-or-0.25%-of-portfolio proposed-sale floor.

`WEIGHT_REDUCE` uses the existing action detail and statement matching. The API
reports `source: weight_policy` and `weight_evidence`; it does not impersonate
TradingView. Recording requires `expected_instruction_value` to match the reviewed
proposal. `WEIGHT_CLASS_REVIEW` is review-only in Portfolio. Adds paused by the
individual ceiling retain their source alert with `deployment_state: WEIGHT_LIMIT`.

Delivery must reuse execution/reconciliation, preserve source attribution and
deduplicate per security. Weight proposals cannot double-count an existing
reduction or bypass an Exit, risk action or statement wait. Off cancels only
unexecuted weight proposals; already-recorded actions stay locked for statement
confirmation. Missing or zero model targets must not be normalised to SELL.

## Commodity Theme Consequences

Commodity-theme events are evidence transport. They create alerts only at the
following adverse, material transitions:

| Event | Result |
| --- | --- |
| `SECURITY_OUTPERFORM: BUY -> SELL` | Current: Underperformance evidence/alert. No automatic 75% cap or cap-derived trim. Explicit sizing remains under discussion. |
| `CORE FUND / COMMODITY: BUY -> SELL` | One asset-class Equity Regime Strong Trim 20%, plus a block on producer-equity increases. |
| Theme source becomes stale | Review item; preserve existing live cap and do not treat staleness as a sell. |

`COMMODITY: BUY -> SELL` remains a direct-commodity sleeve state only until its
separate physical/direct-commodity exit policy is approved. It must not create
a producer-equity action.

## Ordering And Evidence

Every valid position action remains visible in the ledger in closed-bar order.
The primary grid instruction is sorted by risk priority above, so a later Exit
correctly interrupts an earlier deploy or reduction instruction without
deleting it. The system must not calculate a hidden net target. After statement
confirmation, later percentage suggestions refresh against the remaining
broker-confirmed holding.

The Alert Stack shows origin and urgency. Actions owns the instruction,
operator response, statement wait, reconciliation, and immutable history.

## Implementation Boundaries

1. `security_actions` stores scope, intent, instruction basis, policy version,
   holding snapshot, execution report, reconciliation state, and Exit override
   data. The originating `alerts` row remains immutable evidence.
2. Q3/Q4 and Portfolio Rebalancing stay on their existing workflow tables;
   they are not copied into this security queue.
3. Legacy full `SELL` position alerts display as `Exit` in the queue and
   Positions Action cell.
4. Legacy raw signals and decisions remain available for chart history and
   audit.
5. A newer `EQUITY_RELATIVE BUY -> SELL` event now projects one idempotent
   `ASSET_CLASS` Equity Regime Strong Trim into this queue. It snapshots the
   current held producer securities and producer ETFs, requests a 20% reduction
   of each, and reconciles their individual statement quantities. Raw commodity SELL
   remains excluded. `SECURITY_OUTPERFORM` trim projection remains pending the
   persistent, backend-owned research-target snapshot required to calculate the
   precise excess above the 75% cap; it must not use the legacy `allocation`
   field as a substitute.
