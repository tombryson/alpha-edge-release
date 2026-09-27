# Architecture

Audit date: 17 May 2026.

Alpha Edge is one investment operating system. Its primary operating surface is
the **Alpha Edge Trading Terminal**, supported by a separate **Alpha Edge
Intelligence Service**. The Terminal has a Next.js frontend and Go/SQLite
ledger API; the Intelligence Service runs the Analyst Council, Announcement
Router, and Portfolio Analysis workflows.

This document records the technical runtime boundary. The canonical product
language, cross-service ownership model, and shared user decision lifecycle are
defined in [Alpha Edge Product Architecture](PRODUCT_ARCHITECTURE.md).

## Runtime Components

| Component | Current location | Responsibility |
| --- | --- | --- |
| Trading Terminal frontend | Next.js app, [app/page.tsx](../../app/page.tsx#L1), [components/stock-table.tsx](../../components/stock-table.tsx#L1) | Opening user interface, UI shell, terminal workspaces, and user-entered workflow inputs. |
| API client | [lib/api.ts](../../lib/api.ts#L1) | Typed frontend calls to the Go backend. |
| Trading Terminal ledger API | [backend/main.go](../../backend/main.go#L29) | REST API, webhook ingestion, persistence, portfolio-risk calculations, action workflows, statement import, SSE. |
| Terminal SQLite ledger | `backend/trading.db` locally, Fly volume/remotely in deployed envs | Persistent portfolio, action, statement, market-evidence, and memo state. |
| Intelligence Service | `llm-council-analysis` external Fly app; Terminal proxy routes in `app/api/council` | Analyst Council, Announcement Router, and Portfolio Analysis jobs. Its source code is outside this repository. |
| TradingView | external | Sends CDF/TMS/Q3/Q4/ETF webhook packets. |
| Gmail / Apps Script | external | Sends announcement packets to the Announcement Router. Connector source is outside this repository. |
| Browser/UAT tests | `tests/uat` | Stateful workflow tests against backend and UI. |

## Inputs

| Input | Route | Main persistence |
| --- | --- | --- |
| Broker/account statement | `POST /api/statements/import` | `account_statements`, `statement_holdings`, `holdings`, sync tables |
| Per-security TradingView signal | `POST /api/webhook/tradingview` | `alerts`, `security_positions`, `stock_analysis`, `active_alerts` |
| Generic regime signal | `POST /api/webhook/regime` | `regimes`, `alerts`, `security_positions`, ETF allocation state |
| Q3 detector | `POST /api/webhook/regime` with `script=q3d` | `equity_sizing`, `equity_sizing_history`, `overlay_signal_state`, `overlay_events` |
| Q4 detector | `POST /api/webhook/regime` with `script=q4d` | `q4_crisis_state`, `equity_sizing`, `equity_sizing_history`, `overlay_signal_state`, `overlay_events` |
| ETF rebalance | `POST /api/webhook/etf-rebalance` | `etf_rebalance_targets`, `etf_allocations` |
| Manual portfolio target | `POST /api/portfolio-rebalances` | `portfolio_rebalance_plans`, `portfolio_rebalance_plan_rows` |
| AI-assisted portfolio target | `POST /api/portfolio-rebalances/from-memo` | `portfolio_rebalance_plans`, `portfolio_rebalance_plan_rows` |

## Ownership Boundaries

### Backend Owns

- database schema and persistence
- webhook routing and validation
- signal normalisation
- Q3/Q4 state resolution
- portfolio-risk action creation
- portfolio target creation and approval
- statement import and reconciliation
- portfolio mix calculations
- ETF rebalance target storage
- SSE alert fan-out

### Frontend Owns

- presentation
- user input capture
- local editing state before save/confirm
- table interactions
- workflow controls
- visual grouping and user language

### Frontend Must Not Own

- Q3/Q4 current state
- Q4 active state
- portfolio baseline state
- workflow completion state
- statement reconciliation truth
- portfolio-risk calculations

If the frontend needs any of those, it must read backend state.

## Main Data Flows

### Per-Security Alert Flow

```text
TradingView CDF/TMS
-> POST /api/webhook/tradingview
-> validate and normalise signal
-> update security_positions if required
-> insert alerts row if actionable
-> SSE notification
-> Alerts/Actions UI
```

### Q3/Q4 Portfolio Risk Flow

```text
TradingView Q3D/Q4D
-> POST /api/webhook/regime
-> update detector state
-> resolve active portfolio-risk mode
-> sync overlay_signal_state
-> create/reuse/supersede overlay_events
-> Positions Actions UI
-> user records reductions or review
-> statement import/reconciliation where required
-> completion
```

### Portfolio Target Flow

```text
User or AI memo
-> create portfolio_rebalance_plan
-> create plan rows
-> UI action records decreases
-> confirm position actions
-> statement import/reconciliation
-> approve target as baseline
-> portfolio_mix_snapshot rows become approved strategic shape
```

### Intelligence Flows

```text
Terminal Analysis
-> Next Council proxy
-> Analyst Council job
-> report packet / run result
-> Terminal records research fields and linked run metadata
```

```text
Gmail / Apps Script announcement
-> Announcement Router
-> scenario/thesis result or bounded score
-> Terminal Council proxy read model
-> Analysis evidence and, only where warranted, normal Alert/Action workflow
```

```text
Terminal Portfolio snapshot
-> Portfolio Analysis job
-> completed Portfolio Memo
-> Terminal persists portfolio_memo_runs
-> Portfolio target draft and/or News narrative foundation
```

## Portfolio-Risk State Model

Portfolio risk is not one database field. It is derived from several persisted states:

| Purpose | Table |
| --- | --- |
| Q3 detector current percentages | `equity_sizing` |
| Q3 detector history | `equity_sizing_history` |
| Q4 active/inactive state | `q4_crisis_state` |
| current versus last applied detector state | `overlay_signal_state` |
| active or historical action event | `overlay_events` |
| per-class action rows | `overlay_event_classes` |
| per-holding recorded reductions | `overlay_stage1_sources` |

Resolution rule:

1. Q4 active outranks Q3 in the resolved Portfolio Risk action.
2. Q3 state remains stored while Q4 is active.
3. Missing Q4 row means inactive.
4. Missing Q3 rows means no Q3 detector state is connected.
5. `SPX` is preferred over legacy `SPY`.

## Portfolio Shape Model

Portfolio shape is separate from portfolio risk.

| Concept | Table |
| --- | --- |
| approved baseline | `portfolio_mix_snapshots` |
| approved baseline rows | `portfolio_mix_snapshot_rows` |
| draft/current rebalance target | `portfolio_rebalance_plans` |
| draft/current rebalance rows | `portfolio_rebalance_plan_rows` |

Rules:

- Q3/Q4 should not silently create portfolio targets.
- Portfolio target approval should not rewrite Q3/Q4 detector state.
- Baseline approval is explicit.

## Current Technical Risks

| Risk | Impact |
| --- | --- |
| Domain handlers remain in a large shared Go package; `main.go` is now only startup. | Cross-domain dependencies can still be difficult to audit, despite extraction into separate files and central route registration. |
| Schema remains in bootstrap/runtime helpers; the previously documented versioned runner is absent. | A controlled migration runner and generated effective-schema reference remain release work. |
| Some read endpoints reconcile stored state. | Overlay polling no longer creates/supersedes signal events, but cash confirmation and pending-event class repair remain bounded writes. |
| Error responses are not structured consistently. | UI cannot reliably distinguish validation, variance, and server failure. |
| Older design history can still be mistaken for current contracts. | Current references, proposals and archive records are now separated; follow the ownership map rather than an older rollout paragraph. |
| Terminology is not centrally enforced. | UI copy can drift into misleading language like "Accept Cap Only" or overuse of "headroom". |

## Refactor Direction

Recommended backend extraction order:

1. portfolio-risk service
2. portfolio-target service
3. statement import/reconciliation service
4. webhook router/normaliser
5. asset-class config service
6. versioned migration runner and generated effective-schema documentation

This is not required before shipping small fixes, but it is required before the system can be considered cleanly auditable.
