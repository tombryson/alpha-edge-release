# Signal Trace

Status: source-checked integration map, 11 September 2026. Payload details remain
owned by [Webhooks](WEBHOOK_CONTRACT.md); state semantics by
[Signal and action contract](../system/SIGNAL_AND_ACTION_CONTRACT.md).

## Reception Is Not Execution

```text
TradingView closed bar
  -> authentication and envelope validation
  -> durable webhook_inbox receipt
  -> HTTP acknowledgement
  -> asynchronous handler and business validation
  -> stored evidence / current state / eligible action
  -> human response at broker, then execution recorded in Alpha Edge
  -> later complete statement confirms quantity change or flags variance
```

The inbox is committed before acknowledgement. A later validation or processing
failure is retained in `webhook_dead_letters`. An accepted response is neither
proof of application-state change nor proof of a broker trade. Alpha Edge never
places that order. [Inbox implementation](../../backend/webhook_inbox.go) owns
recovery, deduplication and replay limits.

Stable `event_id` plus matching payload identifies duplicate transport. Reusing
the same ID with a different payload is rejected. Legacy packets without an ID
have bounded burst suppression, not indefinite exactly-once delivery. A worker
receipt and a business action have separate identities and lifecycles.

Failed receipts are inspected through `GET /api/webhook-dead-letters`; explicit
retry/dismiss endpoints are in [the catalogue](ROUTES.md). Retry requires review
of the original event and current state, not a fresh event ID to evade dedupe.
Automatic replay is bounded; no blanket end-to-end exactly-once claim is made.

## Routing And Ownership

| Family | Entry route | Processing owner | Persistence / consumer |
| --- | --- | --- | --- |
| Security CDF / TMS | `POST /api/webhook/tradingview` | [webhooks](../../backend/webhooks.go) and [security actions](../../backend/security_actions.go) | `active_alerts`, `security_positions`, `alerts`, `security_actions`; Positions and Alert Stack |
| ETF TMS | `POST /api/webhook/tradingview` | [management mode](../../backend/etf_management.go), security webhook | ETF tactical state and eligible actions; optional ETF sidebar |
| Q3 / Q4 | `POST /api/webhook/regime` | [regimes](../../backend/regimes.go), [overlay handlers](../../backend/portfolio_overlay_handlers.go) | `equity_sizing`, `overlay_signal_state`, `overlay_events`, event classes; portfolio-risk workflow |
| Commodity / Equity / Outperform | `POST /api/webhook/theme-confirmation` | [commodity themes](../../backend/commodity_themes.go) | `commodity_theme_events`, stage state; Markets, class actions where implemented |
| Legacy ETF allocation packet | `POST /api/webhook/etf-rebalance` | [ETF rebalance](../../backend/positions_enrichment.go) | Legacy allocation evidence; not a replacement for approved class budgets |
| Broker complete holdings | `POST /api/statements/import` | [Statement import](../../backend/statements_performance.go) and [quantity matching](../../backend/security_action_units.go) | Statements, holdings, reconciliation evidence; History and funding |
| Council / Announcement Router | Next `/api/council/*` proxy | [proxy](../../app/api/council/_lib.ts), external Intelligence Service | Research and memo evidence; not a TradingView transport or broker execution |

## Connection Ledger Versus Signal State

The **Alerts tab** records a user's confirmed TradingView setup. CDF and ETF
TMS setup require the current Buy/Sell direction; TMS setup is connection-only.
Commodity sources are initialised through their scoped feed endpoint. Restart
`CONNECT` messages must not replace an explicitly established direction.
An ETF's accepted scripts depend on its selected management mode.

The **Alert Stack** shows work requiring a response. Ordinary awaiting-statement
records and blocked later signals are not repeated as chips. One primary item
per security/class scope is presented; unresolved Exit and variance review remain
protected. **History / Signals** retains the evidence, including closed records.
Hiding a chip does not delete its action or release its backend block.

## Response And Reconciliation

`POST /api/security-actions/{id}/record-execution` records the user's report,
not an order. Optional positive units take priority over estimated matching.
Normal IG purchases require backend funding eligibility. Purchase exceptions
are a distinct already-executed workflow requiring units, cash and reason.
Exit cannot be ignored; its explicit override retains an unresolved item.

Complete/latest IG imports are authoritative. External holdings remain manual
and must not be erased or claimed as confirmed by an IG-only statement. Cash
availability follows validated statement-backed funding, not an execution click.
Q3 reductions leave the reduced class budget; Q4 pauses increases in affected
assets until cleared. See [Actions](../system/ACTIONS_WORKFLOWS.md) and
[funding](../system/POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).

## Regression Evidence

- [Joined workflow test](../../backend/workflow_contract_test.go): authenticated
  HTTP handlers, durable signal receipt, duplicate acknowledgement, funded action,
  Q4 rejection, execution recording, database reopen, same-day non-confirmation,
  next-day confirmation, correction to variance and corrected confirmation.
  This uses a temporary SQLite database and a real inbox worker; it does not call
  a broker or kill/restart an operating-system process.
- [Response contract test](../../tests/workflow-api-contracts.test.mjs): captures
  that workflow's actual responses and validates status, media type and JSON
  bodies against the published schema definitions. Date/business validation
  remains the handlers' responsibility, not the schema validator's.

- [Inbox tests](../../backend/webhook_inbox_test.go): receipt before ACK, failures, duplicates, restart and replay.
- [Security action tests](../../backend/security_actions_test.go) and [unit matching](../../backend/security_action_units_test.go): execution, blocking and verification.
- [Management mode tests](../../backend/etf_management_test.go): accepted scripts and mode changes.
- [Alert presentation](../../tests/action-presentation.test.cjs) and [browser integration](../../tests/alert-action-integration.browser.test.cjs): active work versus historical evidence.
- [UAT webhook contracts](../../tests/uat/webhook-contracts.spec.ts): endpoint routing and payload expectations. These are not production probes.

The OpenAPI inventory does not replace these state-machine tests. Independent
Intelligence Service internals remain outside this repository's verified scope.

### Corrected Statements

Reimporting a statement updates that account/date's statement record. It is not
an immutable new revision of that record, although a new sync is recorded.
Actions confirmed or flagged against that statement are rechecked against the
corrected quantities. Removing the expected movement changes `CONFIRMED` to
`VARIANCE`; restoring valid evidence can confirm it again. The captured execution
baseline is retained. A correction to the execution baseline's own date cannot
confirm the action: evidence must still be from a later calendar day. Unrelated
later statements do not silently clear an existing variance.
