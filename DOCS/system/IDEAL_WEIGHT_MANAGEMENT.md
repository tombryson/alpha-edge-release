# Ideal Weight Management

Status: implemented. Default Off is advisory and removes the legacy individual allocation ceiling.
The persisted owner switch, purchase ceilings, observations and review actions
are implemented. Thresholds still need observation-only validation before production enablement.

Owner: this contract owns optional security-weight limits and excess reductions.
[Analysis and Council](ANALYSIS_AND_COUNCIL.md) owns research inputs;
[ETF allocation](ETF_ALLOCATION.md) owns Core targets;
[pooled capital](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md) owns cash and tickets;
[signal and action state](SIGNAL_AND_ACTION_CONTRACT.md) owns execution evidence.

## Purpose And Authority

Signals determine whether a trade is eligible. Weight management limits new
money and requests reviewable reductions for sustained, material excess. It is
not continuous rebalancing, a broker-order service, an investment recommendation
from the research provider, or an approval of a new portfolio shape.

Research stays live. The user does not approve a new stock basket after every
entry or exit. Enabling this policy explicitly promotes the modelled Ideal wt
from display-only advice to a purchase-sizing constraint and reduction-review
reference. It does not make the model an unconditional desired holding.

The percentage, its dollar reference, purchase permissions and reduction
proposals must use one backend-owned calculation. The existing
`stock_analysis.allocation` ceiling must be retired from this workflow, not
silently retained as a second limit. Browser-supplied scores or targets cannot
authorise purchases; the backend needs the same validated inputs and router
modifiers used to present the reference.

## Optional, Off By Default

The control is **Weight management**, a persistent owner/account
setting, default **Off**. It is not a browser-only visibility preference and
must have the same meaning across devices and execution entry points.

| Behaviour | Off | On |
| --- | --- | --- |
| Show live Ideal wt, research gaps and ETF coverage | Yes | Yes |
| Apply a security's Ideal wt purchase ceiling | No | Yes |
| Apply the old stored individual allocation ceiling | No | No |
| Generate weight-based reduction proposals | No | Yes, subject to this contract |
| Enforce class budgets, stock/ETF class capacity, confirmed cash and pending commitments | Yes | Yes |
| Enforce Q3/Q4, connections, signal eligibility and management-profile exits | Yes | Yes |
| Preserve recorded executions and statement reconciliation | Yes | Yes |

Off removes individual weight ceilings for stocks and ETFs, not class-level
capital accounting. The effective Core target still informs the stock budget;
actual ETF capital still occupies its class. Off does not authorise borrowing
from another class or spending pending sale proceeds. A non-Core ETF with no
target is not assigned a fabricated zero-target sale instruction.

Turning Off cancels unexecuted weight-only proposals with an audit reason and
stops generating new ones. It must not undo execution reports, release pending
commitments, dismiss an independent signal/risk action or unlock a statement
wait. Already-recorded reductions remain subject to reconciliation. Re-enabling
starts fresh observation evidence; it does not resurrect cancelled proposals.
If the saved mode cannot be read, the server must not assume Off to grant a buy.

## Reference And Measurement

Use the latest approved class budget and the current Core ETF ledger:

```text
A_c = portfolio value * approved class weight
D_c = max(0, A_c - max(effective ETF target, held ETF value))
w_i = unrounded share from the stock research engine within the held stock set
I_i = D_c * w_i                         stock ideal amount
I_e = effective Core ETF target         Core ETF ideal amount
Ideal wt = I / A_c * 100
H = confirmed holding value
coverage = H / I                        only for valid I > 0
```

Use consistent AUD valuations and one explicit as-of snapshot for holdings,
portfolio value, class budget and the allocation calculation. Retain the source
dates of research and published ETF momentum; those sources need not have been
published on the same date as the valuation.

The held-stock universe is independent of Analysis IN/OUT. Confirmed holdings
enter/leave automatically. ETFs, external holdings and non-allocating instruments
are not direct-stock candidates. For an eligible new entry, calculate a
prospective set of held direct stocks plus that candidate. Do not insert it in
the displayed held set before broker confirmation. Pending buys still consume
cash and capacity and must not be treated as new cash on a repeated projection.

**Do not subtract the displayed Class % from Ideal wt to calculate a trade.**
Class % currently divides by invested value in the display group; Ideal wt
divides by the approved class budget. For a $10,000 class with $8,000 invested,
a $2,000 stock is 25% of holdings but already meets a 20% ($2,000) ideal. The
policy compares holding dollars with ideal dollars, or percentages sharing the
same approved-class denominator.

## Purchase Ceiling

When On, both direct stocks and Core ETFs stop receiving new money at **100%
of their valid ideal amount**. Pending purchases count against the ceiling:

```text
security room = max(0, ideal amount - held value - pending purchase commitments)
proposed buy = min(existing pooled-cash ticket, security room,
                   remaining applicable class capacity, confirmed funding)
```

All existing minimum-ticket, risk and signal checks remain in force. A small
shortfall does not justify rounding a buy above the ceiling to meet a minimum.
Underweight alone never creates Buy, Add, Breakout or Re-entry. It is capacity
for an otherwise valid signal, not a command to average down.

When Off, omit security room and the legacy individual target from this
calculation. Keep all remaining gates and commitments. Review an already-made
purchase through the existing explicit exception workflow where applicable;
never rewrite broker truth to make a trade appear compliant.

## Reduction Thresholds

| Instrument role | New-money ceiling | Trigger coverage | Destination coverage |
| --- | ---: | ---: | ---: |
| Direct stock | 100% | At least 150% | 125% |
| Selected Core ETF | 100% | At least 125% | 100% |

These are percentages of the ideal dollar amount, not investment returns or
portfolio percentage points. Stock targets allow more passive appreciation
than new purchases; a Core ETF's effective target implements an explicit class
ratio. Core ETF thresholds apply to that role irrespective of ETF TMS versus
stock-style TMS management; script-specific exits are not changed.

```text
proposed stock reduction = max(0, H - 1.25 * I)
proposed Core ETF reduction = max(0, H - I)
minimum material reduction = max(A$100, 0.0025 * portfolio value)
```

Only create a trade proposal when both the trigger and the minimum material
reduction are met. Test materiality against the proposed sale, not merely the
excess above the ideal. Smaller deviations stay visible without a trade card.
The floor does not guarantee that brokerage, spread or tax makes a sale sensible.

For example, with a $50,000 portfolio the minimum is $125. A stock with a $1,000
ideal and $1,500 held qualifies for a proposed $250 reduction to $1,250. A Core
ETF with the same ideal and $1,250 held qualifies for a proposed $250 reduction
to $1,000. A $100 ideal stock with $150 held meets the coverage threshold but
its $25 proposed sale does not meet materiality.

## Evidence And Persistence

A reduction requires qualifying excess on **two consecutive eligible daily
valuation observations with distinct dates**, supported by fresh data. A page
refresh, duplicate import, restart or correction to the same date is not a
second observation. Replace corrected-date evidence and re-evaluate; do not
retain a breach disproved by the correction. A fresh observation below the
trigger or materiality floor resets confirmation. Stale or incomplete evidence
cannot confirm a breach or make a stale proposal executable.

Store each observation's inputs, source identities/dates, actual and ideal
amounts, Core role, policy version and enabled state. A later model result must
not retroactively replace an earlier day's research inputs. Recheck fresh
targets, policy mode and outstanding actions before execution is recorded.

Distinguish holding-value movement from research revisions, class-budget
changes and ETF-capacity changes. A price increase may both raise held value
and reduce implied upside in the model; the interface must not claim that
every breach was caused by market appreciation. Multiple causes can coexist.

## Missing And Zero Targets

Missing research, unavailable prices/budgets/model evidence and a genuine
calculated zero are different states. Never fill missing inputs with zero to
generate a sale. When On, an unavailable or zero ideal provides no model-backed
purchase room; expose the reason rather than falling back to the old ceiling.
Other independent risk and exit instructions remain available.

A genuine stock zero asks for research review, not an automatic Exit. An ETF
Sell state retains its management-profile consequences; the zero target alone
is not an additional liquidation instruction. Removing Core status, or holding
a non-Core ETF without a target, must not create a weight-based full sale.
Positions withholds **all direct-stock references in a class** if any held
direct stock lacks a complete sizing-model result or a positive current price.
The existing completeness rule requires positive Quality, Value and price target
from at least one of Gemini, Perplexity, GPT or Claude, not all four. Council PT
can contribute to the average target but Council alone does not establish the
sizing base score. This guard does not change the scoring formula.

The API marks affected stock references unavailable, sets their model amounts
and percentages to zero as an unavailable payload (not a calculated zero target),
retains `research_missing` and a reason, and provides no reduction amount.
Positions renders a dash without a bar; hover explains the gap. The existing
Analysis Data issues filter identifies missing complete model results. Completing
research restores references on refresh. When management is On, unavailable
references provide no model-backed purchase room and cannot generate reductions;
Off retains its existing no-individual-ceiling behaviour.

This is scoped to held direct stocks, including Analysis OUT holdings. Unheld
watchlist gaps do not invalidate Positions. Core ETF policy targets and complete
classes remain independent. A held security with no research identity is counted
against its resolved class; if its class cannot be resolved, stock references
remain unavailable until the identity/classification gap is resolved.

## Action Lifecycle And Cash

Use the existing reduction review, execution recording and statement
reconciliation workflow. There are no automatic broker orders.

- At most one outstanding weight proposal per security. New evidence updates
  an unexecuted proposal rather than producing duplicate Alert Stack cards.
- Do not add a conflicting weight proposal to an outstanding Exit, Q3/Q4 or
  class reduction. An existing signal trim and a weight proposal must not ask
  the user to sell the same capital twice; expose the controlling instruction.
- Do not generate a second trade while an execution is awaiting confirmation.
  Recalculate after the later statement, using the remaining confirmed holding.
- A proposal ceases to be actionable when its qualifying excess disappears or
  required evidence becomes unavailable. Preserve its history and reason.
- Capture targets and evidence at proposal and execution time. Preserve user
  dismissal and execution records rather than recreating identical dismissed
  recommendations on every poll. A dismissed or closed breach re-arms only
  after a fresh below-threshold day followed by two fresh qualifying dates.
- Ordinary weight reductions require broker confirmation and the existing
  explicit cash-source validation/allocation before becoming class tactical cash.
  The action recorder does not auto-credit reserves from estimated proceeds or
  a quantity match (neither proves sale proceeds). They do not silently
  fund peer purchases. Q3/Q4 and approved class-budget reductions retain their
  separate portfolio-reserve treatment.

## Asset-Class Review

Keep the strategic class review separate from per-security weight management.
The agreed review condition is an absolute relative deviation **above 50%**
from the approved class weight, with an absolute difference of **at least one
portfolio percentage point**. Both conditions must hold. A zero approved class
weight is an off-shape holding for explicit review, not a division by zero.

This flags review through the existing portfolio workflow, not an automatic
change to the approved shape or a collection of compulsory stock sales. It
does not replace the existing class purchase ceiling, Q3 or Q4 rules. The
Portfolio display tolerance is a presentation rule, not this trade policy.

## Implementation

- `GET /api/weight-policy` provides persisted mode and backend-owned references
  to Positions. `PATCH` requires `enabled` and the last observed `epoch`;
  a concurrent mode change returns 409. Public demo access is read-only.
- Migration 0005 defaults Off. `weight_observations` persists first observations
  per mode epoch, security and broker date. Statement content fingerprints detect
  in-place corrections. Changed earlier evidence is invalidated, not recomputed
  using later research. Corrections never count as a second date.
- Evaluation runs on action reads and every five minutes. The latest statement
  and available stock momentum observations must be at most four calendar days
  old; the two confirming dates must be no more than four days apart. Absent
  momentum history retains the existing engine's neutral modifier, not a
  fabricated return. Missing primary research prevents reduction generation.
- Server-side router scores use `COUNCIL_API_TOKEN` and `LLM_COUNCIL_API_URL`
  (default Intelligence host). When configured, refresh every five minutes;
  cache older than 15 minutes pauses model-backed purchases/reductions. When
  unconfigured, the modifier is neutral. Browser-only provider configuration
  does not authorise backend sizing; configure the server integration for parity.
- Evidence retains provider input timestamps, research-row modification time,
  stock momentum as-of and the selected ETF publication/update date when present.
  Research-row modification is not a claim of a new research run. ETF publication
  keeps its existing 80-session cadence; a new daily price does not republish it.
- `WEIGHT_REDUCE` carries a `weight_policy` evidence source, not a fabricated TMS
  signal. One compact card uses existing action detail, execution and History.
  `WEIGHT_CLASS_REVIEW` is review-only and shown beside the Portfolio class.
  Off, lost eligibility or competing reductions close unexecuted proposals
  with `closed_reason`; recorded trades continue reconciling.
- `expected_instruction_value` is required when recording a weight reduction.
  A changed amount returns 409 without recording. Purchase exceptions remain
  available for truthful reporting, not advance permission to breach limits.

## Delivery And Acceptance

Approved thresholds are hypotheses to observe and validate, not proven optimal
investment parameters. Implement the backend policy, persistence and one
cross-device switch together; do not ship a cosmetic switch that leaves an old
ceiling active. Keep the default Off and do not turn it on during migration.

Before release, require:

1. One canonical backend target calculation, including held/prospective
   membership, canonical identities, research coverage and router evidence.
2. On/Off tests for every purchase path, including ETFs; no legacy individual
   cap in Off, and no loss of class, risk, connection or funding safeguards.
3. Boundary tests at 100%, 125% and 150%, different class/holding denominators,
   materiality, rounding, unknown targets, zero targets and non-Core ETFs.
4. Daily observations surviving restarts, corrected statements, duplicates,
   stale data, enable/disable changes and material source changes.
5. Action tests for concurrent signals, existing reductions, execution locks,
   off-after-recording and later statement reconciliation; no duplicated cash.
6. Historical and current observation-only comparisons: proposal frequency,
   turnover, concentration, model revisions and interference with signal exits.
7. Help, API contracts and release notes that state what is implemented and
   deployed. Current documentation approval alone does not complete these gates.

Automated coverage lives in `backend/weight_policy_test.go` and the weight-policy
browser tests. Passing tests is not evidence that the thresholds improve returns;
proposal frequency and turnover still require observation-only evaluation.
