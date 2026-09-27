# Actions Workflows

Current-scope reconciliation: 11 September 2026. Earlier dated sections retain their historical context.

Actions are user-facing response workflows. They are not the same as incoming alerts, passive risk state, portfolio analysis, or raw statement imports.

## Alpha Scope Decisions (2026-09-08)

- Research scores, momentum and Analysis suggestions remain live and advisory.
  Repeated Council runs are not a reason to freeze research. Publishing a
  binding stock-level target is a different, still-unformalised workflow.
- The optional Analysis-suggestion column in Positions is implemented as advisory
  display, not approval of an automatic research-to-trade pipeline. No binding
  draft-portfolio or research-approval workflow is implied.
- Security execution now supports optional units and estimated quantity
  matching; see [Quantity Matching](SIGNAL_AND_ACTION_CONTRACT.md#quantity-matching-2026-09-08).
- Complete IG holdings statements are the supported broker input. External
  holdings remain legitimate but lower-priority/manual; do not build a
  multi-broker ledger or force them to wait for evidence IG cannot supply.
- Sale proceeds should become available only through the next validated daily
  statement, not an execution click or simply the passage of 24 hours.
  Statement-backed funding and complete/latest import protections were added in
  subsequent UAT work. Current rules are owned by
  [Pooled Capital Deployment Policy](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md)
  and [Signal And Action Contract](SIGNAL_AND_ACTION_CONTRACT.md). This does not
  establish a CMC import pipeline or turn live Analysis weights into approved targets.

An action exists when the user has something to review, record, confirm, or close.
The lifecycle from source signal to operator response and broker-statement
confirmation is defined in [Signal And Action Contract](SIGNAL_AND_ACTION_CONTRACT.md).
This document remains the owner of the Q3/Q4 and Portfolio Rebalancing workflow
state machines.

## Shared UI Structure

The portfolio-risk/rebalance Actions workspace uses the following sections.
This is not the optional right context sidebar or the position Alert Stack:

1. Active Actions
2. Alert Type
3. Selected Sleeve
4. Workflow

Meaning:

| Section | Purpose |
| --- | --- |
| Active Actions | Lists open action cards. Shows specific trigger first, broad family second. |
| Alert Type | Shows family and trigger contract, for example `Portfolio Risk` and `Q3 Detector - Pending`. |
| Selected Sleeve | Shows the selected class/sleeve context and current progress metrics. |
| Workflow | Shows the current step and locked/active/ready states. |

The action label is the specific event. The alert type is the broader family.

| Specific event | Alert type |
| --- | --- |
| Q3 Detector | Portfolio Risk |
| Q4 Crisis | Portfolio Risk |
| New Portfolio Target | Portfolio Rebalancing |

## Sequential Position Signals

Status: `Implemented for direct-security action alerts and the class-scoped
commodity Equity Regime Strong Trim. Other live-cap producers remain policy work.`

Since 10 September, these actions use the existing **Alert Stack** detail and
**History / Signals / Decision History**, not a standalone Security Action Queue
drawer. Positions' actionable Action cell opens the matching stack detail.
Since 11 September, statement waits and blocked later signals are kept in
Decision History, not repeated as active chips. Positions' Pending cell links
to that history; the stack's Decision history link opens all prior responses.
See [the UI contract](SIGNAL_AND_ACTION_CONTRACT.md#alert-stack-and-decision-history-2026-09-11)
for controls, status labels, failure behavior and ownership.

Per-security CDF/TMS actions, commodity-theme actions, and portfolio-level
reductions are evidence-led instructions for a human operator. They are not
inputs to a hidden net-target calculator.

Ordinary position alerts may expire or be ignored under their existing rules.
An Exit is different: it cannot be dismissed, ignored, or silently expired. A
retained position requires an explicit override that remains visible as an
unresolved risk item until reviewed again or statement-confirmed execution
occurs.

1. Project every eligible direct-security closed-bar action alert into a
   `security_actions` row with source ID, timestamp, and holding snapshot.
2. Show the highest-priority unresolved instruction in Positions. `EXIT`
   outranks reductions, which outrank deploy actions. The existing Alert Stack
   owns the current response; Decision History owns recorded/closed outcomes.
3. Keep blocked later actions in Decision History, not the active stack. Do not
   merge, cancel, or supersede the underlying records into a composite target.
4. After the user records execution, retain that action as
   `AWAITING_STATEMENT` and block later actions until the next statement either
   confirms the expected holding change or records a variance.
   The execution detail closes and its stack chip disappears after a successful
   save. A variance returns as one review item per security or class scope;
   ordinary statement waits are not another user task. Unresolved exits remain
   protected. The backend, not the display filter, releases later instructions.
5. When an earlier confirmed full exit leaves no holding, a later percentage
   instruction can become `NOT_APPLICABLE`. Simulator resets can also produce
   this status; the label alone is not proof of an executed sale.
6. Q3 and Q4 remain their own scoped workflows. Equity Regime Strong Trim is
   one shared class action, accessible from affected positions without creating
   a separate execution per holding.

## Workflow Families

| Family | Source | Parent table | Child rows | Requires statement? |
| --- | --- | --- | --- | --- |
| Q3 risk-off | `/api/webhook/regime`, `script=q3d` | `overlay_events` | `overlay_event_classes`, `overlay_stage1_sources` | Yes |
| Q3 risk-on | `/api/webhook/regime`, `script=q3d` | `overlay_events` or signal state | usually none requiring reductions | No |
| Q4 crisis | `/api/webhook/regime`, `script=q4d`, `SELL` | `overlay_events` | `overlay_event_classes`, `overlay_stage1_sources` | Yes |
| Portfolio target | `/api/portfolio-rebalances` | `portfolio_rebalance_plans` | `portfolio_rebalance_plan_rows` | Yes for reductions before baseline approval |

## Q3 Risk-Off

Trigger:

```text
Q3 target decreases below last applied Q3 state.
```

Example:

```text
Last applied: 100%
New Q3: 35%
Action: reduce Q1-sensitive invested exposure by the proportional signal change, adjusted by class factors.
```

Backend path:

1. `POST /api/webhook/regime`
2. `handlePositionSizingSignal`
3. `syncOverlaySignalStateAndEvent`
4. `createOverlayEventFromContext`
5. UI reads `GET /api/portfolio-overlay-summary`

### Read/sync split (2026-06-11)

`GET /api/portfolio-overlay-summary` is now **read-only with respect to signal
state**: it no longer calls `syncOverlaySignalStateAndEvent`, so polling can
never create, cancel, or supersede overlay events (closes audit §7 finding).
Signal-state sync happens at signal time — Q3/Q4 webhooks, stage handlers,
settings changes — and via the explicit recovery endpoint
`POST /api/portfolio-overlay/sync` (same reconciliation the GET used to run
implicitly). The GET retains two bounded, event-scoped reconciliations:
Stage-1 cash confirmation against the latest statement import, and event-class
backfill/repair for an existing PENDING event. Neither creates or supersedes
events.

Primary tables:

- `equity_sizing`
- `equity_sizing_history`
- `overlay_signal_state`
- `overlay_events`
- `overlay_event_classes`
- `overlay_stage1_sources`

State machine:

| UI step | DB state | User action | Backend transition |
| --- | --- | --- | --- |
| Adjust Positions | `overlay_events.status = PENDING` or `PARTIAL` | Enter reductions in `$ ADJUSTMENT` cells. | `mark-stage1-partial` saves draft, `apply-stage1` confirms. |
| Await Statement | `status = STAGE1_DONE`, `stage1_applied_at` set | Import broker/account statement. | Reconciliation checks expected reserve and holdings. |
| Complete | Statement matched, completion allowed | Complete reserve/stage flow or accept final state if required. | `complete-stage2` / `set-baseline` depending workflow state. |

Rules:

1. Risk-off is a forced Portfolio Risk action.
2. It must not be suppressed because current total-portfolio Q1 exposure is below the headline Q3 percentage.
3. The reduction is calculated against current Q1-sensitive invested value and class factors.
4. User-entered reductions must persist across refresh.
5. Confirming reductions moves the workflow to statement wait.
6. Incorrect statement import must show variance and allow reopening.
7. Completion must update last applied Q3 state only after the appropriate confirmation path.

## Q3 Risk-On

Trigger:

```text
Q3 target increases above last applied Q3 state.
```

Example:

```text
Last applied: 35%
New Q3: 80%
Action: notify the user that higher Q1 allocation is allowed.
```

Backend path:

1. `POST /api/webhook/regime`
2. `handlePositionSizingSignal`
3. `syncOverlaySignalStateAndEvent`
4. UI reads `GET /api/portfolio-overlay-summary`
5. User can close with `POST /api/portfolio-overlay/mark-reviewed`

State machine:

| UI step | DB state | User action | Backend transition |
| --- | --- | --- | --- |
| Review Allocation | detector state differs from last applied, no forced reductions required | Review signal. Optional route to Portfolio page. | none |
| Mark Reviewed | lightweight action visible | Mark reviewed. | `mark-reviewed` closes the action and records review state. |
| Complete | no open forced action | none | no statement required |

Rules:

1. Risk-on is still visible as an action.
2. It must not open adjustment cells.
3. It must not require a broker statement.
4. It must not create a portfolio target.
5. It must not approve or reset a baseline.
6. It may offer `Review Portfolio Shape`.
7. It may offer `Mark Reviewed`.

Do not label this as "Accept Baseline". That language implies a strategic portfolio approval, which is not what Q3 risk-on does.

## Q4 Crisis

Trigger:

```text
Q4D sends SELL.
```

Payload:

```json
{"ticker":"Q4","signal":"SELL","script":"q4d"}
```

Backend path:

1. `POST /api/webhook/regime`
2. `handleQ4DOverlaySignal`
3. update `q4_crisis_state`
4. write `equity_sizing.Q4D = 10`
5. `syncOverlaySignalStateAndEvent`
6. UI reads `GET /api/portfolio-overlay-summary`

State machine:

| UI step | DB state | User action | Backend transition |
| --- | --- | --- | --- |
| Adjust Positions | Q4 active, `overlay_events.status = PENDING` or `PARTIAL` | Enter reductions. | `mark-stage1-partial` / `apply-stage1`. |
| Await Statement | `status = STAGE1_DONE` | Import statement. | Reconcile reserve and expected reductions. |
| Complete | statement matched | Complete workflow. | `complete-stage2` / `set-baseline` depending state. |

Rules:

1. Q4 crisis target is 10% market exposure.
2. Q4 uses Q4 liquidity factors, not Q3 throttle factors.
3. Q4 outranks Q3 in the resolved Portfolio Risk action.
4. Q3 signals remain accepted and stored while Q4 is active.
5. Clearing Q4 with BUY releases the Q4 limiter but does not delete Q3 state.
6. Q4 action copy should be distinct: `Q4 Crisis` as event, `Portfolio Risk` as type.

## Portfolio Target Rebalance

Trigger:

- user creates a manual target
- user creates a target from AI analysis

Backend path:

1. `POST /api/portfolio-rebalances` or `/api/portfolio-rebalances/from-memo`
2. UI reads `/api/portfolio-rebalances/current`
3. UI reads `/api/portfolio-rebalances/current/adjustment-plan`
4. user records reductions
5. `mark-partial` or `complete`
6. later statement validation
7. `approve` writes new baseline

Primary tables:

- `portfolio_rebalance_plans`
- `portfolio_rebalance_plan_rows`
- `portfolio_mix_snapshots`
- `portfolio_mix_snapshot_rows`

State machine:

| UI step | DB state | User action | Backend transition |
| --- | --- | --- | --- |
| Draft Target | `status = OPEN`, target rows exist | Edit target mix. | update/create plan rows. |
| Adjust Positions | `status = OPEN` or `PARTIAL` | Record required decreases. | `mark-partial` persists rows. |
| Confirm Position Actions | recorded decreases meet tolerance | Confirm. | `complete` sets `status = COMPLETED`. |
| Await Statement | `status = COMPLETED` | Import statement. | adjustment-plan validation checks imported mix. |
| Approve Baseline | imported state matches | Approve target as baseline. | `approve` creates approved snapshot and marks plan `APPROVED`. |

Rules:

1. Decreases are actioned before increases.
2. Increases are pending until cash is available.
3. The action panel should not show redundant instructions that merely describe the spreadsheet.
4. Recorded values must persist across refresh.
5. `Save Draft`, `Review Totals`, and confirmation controls should use the same bottom dock language as Portfolio Risk where possible.
6. Approval is valid for portfolio targets, not for Q3/Q4 risk-on review.

## Statement Variance

Variance means imported statement evidence does not match the expected action result.

Possible causes:

- user recorded the wrong rows
- broker statement has not yet reflected the trades
- cash/reserve changed for unrelated reasons
- a different position was sold than recorded
- import data is stale or mapped incorrectly

Required UI behaviour:

1. Show variance clearly.
2. Allow reopening action fields.
3. Allow importing a later statement.
4. Do not silently complete.
5. Do not delete recorded rows without user intent.

## Button Language

Approved language:

| Context | Primary action |
| --- | --- |
| Q3 risk-off | `Review Totals`, then confirm reduction/reserve move |
| Q3 risk-on | `Review Portfolio Shape`, `Mark Reviewed` |
| Q4 crisis | `Review Totals`, then confirm reduction/reserve move |
| Portfolio target reductions | `Confirm Position Actions` |
| Portfolio target baseline | `Approve As Baseline` or `Approve Baseline` only after statement match |

Avoid:

- `Accept Cap Only`
- `Accept Baseline` for Q3/Q4 risk-on
- `Review Headroom` for risk-off
- repeated labels that duplicate the same event name across all sections

## Regression Requirements

Every workflow change should test:

1. backend state before signal
2. signal payload
3. persisted state after signal
4. visible Actions UI
5. editable/locked workflow controls
6. draft persistence across reload
7. statement match path
8. statement variance path
9. final completion state

See [Testing](../development/TESTING.md).
