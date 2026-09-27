# Testing

How Alpha Edge is tested: principles, layers, fixtures, feature suites and UAT
scenarios. Browser suites intercept API traffic with isolated fixtures and never
write to UAT or production. UAT suites are separate and can mutate UAT data.

## Testing Principles

1. Test from webhook/API input through persisted DB state and UI output.
2. Use deterministic seeds.
3. Assert both UI text and backend state.
4. Test refresh/reload persistence.
5. Test correct statement and incorrect statement paths.
6. Test old bugs directly so they do not return.

## Minimum Test Layers

### Workflow Coverage

History approval preview:

```sh
npm run test:portfolio-history-markers
# Requires the local frontend on port 3100; override HISTORY_PREVIEW_BASE_URL if needed.
node --test tests/history-shape-preview.browser.test.cjs
```

The eight marker tests cover snapshot-specific locked weights, superseded records,
partial and missing allocations, duplicate/invalid values, dates and source-data
immutability. The isolated Playwright browser test intercepts all API calls and
checks hover transfer, click pinning, keyboard dismissal/focus, theme changes,
mobile tapping, viewport containment and the absence of writes. It does not use
real tokens or mutate UAT.

The preview comparison extension adds model coverage for predecessors outside the
visible date range, deterministic ordering, real/demo isolation, added/removed
classes and incomplete previous snapshots. Browser coverage includes automatic comparison without a toggle,
one extra percentage column, vertically stacked bars with equal widths and aligned origins, saved segment widths,
shared colours, partial remainders, unavailable predecessors, and mobile containment.

Local/UAT history demo:

```sh
npm run test:portfolio-history-demo
node --test tests/history-shape-preview.browser.test.cjs
```

Seven fixture/model checks cover the exact environment allowlist, eight complete
approvals, class and cash totals, non-instant target implementation, deterministic
data, distinct demo marker identities, and absence of persistence/API writes.
The browser workflow also checks the demo toggle, eight markers, simulated hover
content, independent date filtering, restoration of live data, mobile access,
and reset to real data on reload. All API calls in this test are intercepted.

Historical approved-shape comparison:

```sh
npm run test:portfolio-comparison
cd backend
go test -vet=off ./... -run 'TestPortfolioShapeHistory|TestLoadPortfolioHistoryLinksMemoTargetShapeAndActual' -count=1
```

The model tests cover approval-only selection, chronology, legacy identities,
physical versus producer classes, incomplete records, new/removed classes,
signed percentage-point changes, independent concentration ranking, fixed
radial scales/axes and read-only UI ownership. Backend tests cover stable
cursor pagination, approval filtering, request validation and unchanged record
counts. `-vet=off` is needed locally because existing ETF benchmark tests use
`testing.B.Context` while the module declares Go 1.21; it does not skip tests.
Browser checks use stored UAT approvals without creating targets or actions.

| Layer | Purpose |
| --- | --- |
| Go backend tests | Calculation and persistence transitions. |
| API integration tests | Real HTTP request/response and DB side effects. |
| Playwright UAT | User workflows through browser UI. |
| Data fixture tests | Seed validity and accounting balance. |
| Docs traceability | Each business rule has at least one test or explicit gap. |

## Required Fixture State

The UAT seed must define:

- latest account statement
- holdings summing to statement total
- broker cash
- asset classes
- ticker/company mappings
- security position state
- active alert registrations where needed
- Q3/Q4 state reset
- no stale active overlay events unless scenario requires one
- no stale portfolio rebalance plan unless scenario requires one

Seed accounting invariant:

```text
sum(active holding values) + statement cash = statement total value
```

If this invariant fails, workflow tests are not trustworthy.

## Traceability Matrix

| Rule | Test required |
| --- | --- |
| Q3 risk-off creates forced Portfolio Risk action. | Send Q3 from 100 to 35 and assert action appears. |
| Q3 risk-off is not suppressed by total-portfolio exposure cap. | Seed low total Q1 share but non-zero Q1-sensitive book, send lower Q3, assert reduction action. |
| Q3 risk-on is visible but not forced. | Send Q3 from 35 to 80, assert allocation-available action, no adjustment cells, no statement wait. |
| Q4 SELL activates crisis. | Send Q4 SELL, assert `q4_crisis_state.active`, `Q4D=10`, Q4 UI. |
| Q4 BUY clears crisis. | Send Q4 BUY, assert `q4_crisis_state.active=false`, `Q4D=100`, Q3 state preserved. |
| Q4 outranks Q3. | Send Q3 then Q4 SELL, assert resolved action is Q4 and Q3 remains readable. |
| Portfolio target decreases action first. | Create target with decreases and increases, assert decreases actionable and increases pending. |
| Portfolio target approval requires completion. | Try approve before complete and assert blocked; complete then approve. |
| Correct statement completes workflow. | Record reductions, import matching statement, assert completion allowed. |
| Incorrect statement shows variance. | Record reductions, import non-matching statement, assert variance and reopen controls. |
| Draft values persist. | Enter adjustment values, save partial, reload, assert values remain. |
| Plain CDF SELL state sync. | Send plain CDF SELL and assert `security_positions.position_state = SELL` with no action alert. |
| TMS stop sizing. | Send TMS `sell` with `cdf_state=BUY` and assert `SELL_50` / target copy `Sell Down 50%`; send with `cdf_state=SELL` and assert legacy `SELL` / target copy `Exit`. |
| Pooled deploy ticket. | Seed a class with confirmed funding, class capacity, and qualified candidates. Assert `ticket = min(max($100, 10% of opening pool), target shortfall, remaining funding)`; no order below `$100`; no stock receives reserved future cash. |
| CDF SELL purchase block and TMS re-entry. | Send plain CDF SELL, then an ADD and BREAKOUT event. Assert the evidence remains auditable but no ordinary purchase ticket projects until CDF returns to BUY. Seed a stopped/waiting position and send valid TMS REENTRY; assert it remains eligible under TMS rules. Existing sell-down, stop, and Exit paths remain unchanged. |
| Add-strength sizing neutrality. | Send matching `strong_add` and `weak_add` events with identical class conditions. Assert both project the same ticket and retain their strength/timeframe metadata. |
| Commodity permitted target and ticket. | Seed `GDXJ / GLD` and stock CDF as BUY. Assert a commodity cap can restrict target shortfall but cannot alter the shared ticket calculation; `OUTPERFORM BUY` alone must not create a buy. |
| Equity-regime Strong Trim. | Send `EQUITY_RELATIVE BUY -> SELL` and assert exactly one class-scoped 20% signal includes direct miners and mapped producer ETFs, excludes physical gold, and blocks entry/add/breakout/re-entry. |
| Sequential action evidence. | Emit outperformance trim, sell-down, stop, and Q3/Q4 signals over separate closed bars. Assert the queue preserves order, never creates a combined target, and refreshes later suggestions only after recorded execution. |
| Direct commodity isolation. | Send raw commodity SELL and assert no producer-equity cap or Strong Trim is created. |
| Direct vehicle and class-cash accounting. | Assert every configured direct expression defaults to `SIGNAL_ONLY`; an approval without a broker label/ticker is rejected; direct/equity `invested_value`, `sleeve_cash_value`, and `capital_value` remain distinct; class-held cash creates a hold/review state but no cross-class funding instruction. |
| PineScript payloads match live TradingView scripts. | `webhook-contracts.spec.ts` should cover every payload listed in `TRADINGVIEW_SCRIPTS.md`. |
| Asset-class selectors use canonical table. | Assignment/dropdown tests should assert `GET /api/asset-classes`, not `asset_class_config` or hardcoded lists. |
| Analysis council routing uses canonical asset class. | Council launch tests should assert `GOLD_MINERS -> gold_miner` style routing and fail on silent `general_equity` fallback. |
| History chart events retain signal dimensions. | Stock-history tests should assert add/trim type, strength, timeframe, and expiry labels. |
| News bootstrap creates foundation thesis map. | Backend narrative tests should persist a `BOOTSTRAP` mock payload and assert `foundation_run`, thesis rows, and items. |
| News foundation job promotes active cohort. | Backend narrative tests should run a mocked memo-seeded foundation job and assert `news_foundation_jobs`, `news_foundation_cohorts`, `foundation_cohort_id`, and visible theses. |
| News daily run updates existing theses. | Backend narrative tests should mock `SUPPORTS`, `CHALLENGES`, `MODIFIES`, `CONFIRMS`, `RESOLVES`, and `NEW` relationships. |
| Resolved/rejected news theses leave active prompt ledger. | Backend narrative tests should assert completed theses remain stored but are not injected into daily prompts. |
| News asset-class references conform to canonical asset classes. | Backend narrative tests should reject fake model-returned classes when `asset_classes` exists. |
| Failed news model run does not replace latest completed brief. | Backend narrative tests should record a failed run and assert the UI response still uses the latest completed run. |
| Thin or failed news foundation job does not replace active cohort. | Backend narrative tests should fail the quality gate and assert the previous active cohort remains active. |

## Feature Suites

Run browser suites against a local frontend on port 3100 (`CONTEXT_PANEL_BASE_URL`
overrides the address). Backend commands run from `backend/`.

### Empty Positions Classes

```sh
node --test --test-concurrency=1 tests/positions-empty-classes.browser.test.cjs tests/positions-actions-design.browser.test.cjs tests/positions-view-menu.browser.test.cjs tests/positions-capital-map.browser.test.cjs
```

### Analysis Column Resizing

```sh
node --test --test-concurrency=1 tests/analysis-column-resizing.browser.test.cjs tests/analysis-group-performance.browser.test.cjs tests/analysis-monitoring.browser.test.cjs tests/positions-column-resizing.browser.test.cjs
```

### Positions Column Resizing

```sh
node --test tests/position-grid-sizing.test.cjs tests/mobile-responsive.test.cjs
node --test --test-concurrency=1 tests/positions-column-resizing.browser.test.cjs tests/positions-pinned-column.browser.test.cjs tests/positions-shape-footer.browser.test.cjs tests/positions-view-menu.browser.test.cjs tests/positions-actions-design.browser.test.cjs
npm run typecheck
npm run build
```

### Browser Lifecycle

```sh
node --test tests/runtime-lifecycle.browser.test.cjs tests/context-panel.browser.test.cjs
npm run typecheck
```

### Polling Consolidation

```sh
npm run test:polling
node --test --test-concurrency=1 tests/polling.browser.test.cjs tests/data-freshness.browser.test.cjs tests/context-panel.browser.test.cjs tests/alert-action-integration.browser.test.cjs
npm run typecheck
npm run build
```

### System Structure

```sh
node --test tests/system-architecture.browser.test.cjs
node --test tests/terminal-style-standard.test.cjs tests/mobile-responsive.test.cjs
npm run build
npm run docs:audit
```

### Portfolio Timeline

```sh
npx tsc lib/portfolio-timeline.ts app/api/council/portfolio-memos/route.ts --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck --outDir /tmp/alpha-edge-timeline --rootDir .
NODE_PATH=./node_modules node --test tests/portfolio-timeline.test.cjs
node --test tests/portfolio-timeline.browser.test.cjs tests/mobile-responsive.test.cjs
go test ./... -run 'Test.*Portfolio(History|ShapeHistory|Memo)' -count=1
```

### Alert Stack Recovery

```sh
node --test --test-concurrency=1 tests/alert-stack-recovery.browser.test.cjs tests/alert-stack-mobile.browser.test.cjs tests/alert-action-integration.browser.test.cjs tests/sidebar-density.browser.test.cjs
node --test --test-name-pattern='two-row ETF' tests/context-panel.browser.test.cjs
node --test tests/sidebar-separators.browser.test.cjs
node --test tests/etf-summary.browser.test.cjs
node --test tests/etf-ring.browser.test.cjs
npm run build
```

### Positions Capital Map

```sh
node --test tests/positions-capital-map.test.cjs tests/positions-capital-map.browser.test.cjs
node --test tests/position-row-appearance.test.cjs tests/position-row-appearance.browser.test.cjs
npm run typecheck
```

### Positions View Menu

```sh
node --test tests/positions-view-menu.browser.test.cjs
```

### Positions Row Appearance

```sh
node --test tests/position-row-appearance.test.cjs tests/position-row-appearance.browser.test.cjs
npm run test:position-shape
npx tsc --noEmit
```

### Database Upgrades And Recovery

```sh
go test ./...
go test -race ./internal/database ./cmd/dbtool -count=1
```

### Monitoring Coverage

```sh
npm run test:monitoring
node --test tests/analysis-monitoring.browser.test.cjs tests/context-panel.browser.test.cjs
npx tsc --noEmit
```

### Analysis Group Performance

```sh
npm run test:analysis-metrics
node --test tests/analysis-group-performance.browser.test.cjs
```

### Canonical Class Colours

```sh
npm run test:asset-class-colours
npm run test:portfolio-comparison
npm run test:portfolio-group-dial
npm run test:portfolio-history-markers
node --test tests/asset-class-colours.browser.test.cjs tests/history-shape-preview.browser.test.cjs tests/context-panel.browser.test.cjs
node --test tests/asset-class-colour-editor.browser.test.cjs
go test -vet=off ./... -run TestClassColour -count=1
```

### Alert Stack Consolidation

```sh
node --test tests/action-presentation.test.cjs tests/alert-action-integration.browser.test.cjs tests/purchase-exception.browser.test.cjs
node --test tests/context-panel.browser.test.cjs
npx tsc --noEmit
```

### Portfolio Tools Migration

```sh
go test -vet=off . -run 'TestClassBudget|TestCashBacking' -count=1
npx tsc lib/context-panel-model.ts --target ES2020 --module commonjs --moduleResolution node --skipLibCheck --outDir /tmp/alpha-edge-context-panel --rootDir .
node --test tests/context-panel-model.test.cjs
node --test tests/context-panel.browser.test.cjs
npx tsc --noEmit
go test -vet=off -run 'TestETFManagement|TestDeployment|TestSecurityAction|TestCDFSetup|TestCalculateCore|TestETF' -count=1 .
```

### Cash backing

```sh
go test -vet=off . -count=1
go test -race -vet=off . -run 'TestCashBacking|TestDeployment|TestRecordExecution' -count=1
go test -vet=off ./...
```

### Purchase Permission

```sh
go test -vet=off . -run 'TestDeployment|TestCashBacking|TestSecurityAction|TestRecordExecution' -count=1
node --test tests/purchase-exception.browser.test.cjs
```

### Council Proxy Regression

```sh
npm run test:council-proxy
npx tsc --noEmit --incremental false
go test -vet=off . -run 'TestCouncilCaller|TestAuth' -count=1
```

### Shared Class Budget

```sh
go test -vet=off . -count=1
go test -race -vet=off . -run 'TestClassBudget|TestDeployment|TestCashBacking|TestSecurityAction|TestRecordExecution' -count=1
go test -vet=off ./...
```

### Terminal Style Standard

```sh
node --test tests/terminal-style-standard.test.cjs
npm run test:portfolio-overview
npm run test:portfolio-history-markers
npx tsc --noEmit --incremental false
```

### Local Workflow Contracts And Freshness

```sh
node --test tests/workflow-api-contracts.test.mjs tests/data-freshness.test.cjs
node --test tests/data-freshness.browser.test.cjs
```

### Announcement Subscription Setup

```sh
go test -p 1 ./... -run TestAnnouncement -count=1
CONTEXT_PANEL_BASE_URL=http://127.0.0.1:3100 node --test tests/announcement-subscriptions.browser.test.cjs
npx tsc lib/announcement-subscriptions.ts --target ES2020 --module commonjs --moduleResolution node --skipLibCheck --outDir /tmp/alpha-edge-announcements --rootDir .
node --test tests/announcement-subscriptions.test.cjs
npm run test:access
```

## Portfolio Cycles

`cd backend && go test ./...` covers the transactional four-calendar-month guard,
month-end clamping, restarts, historical bounds, opening baskets, sold securities,
missing/changed price evidence, corrections and the read-only cycle endpoint.
`node --test tests/portfolio-cycle.browser.test.cjs` uses the local demo on port
3312 (override `PORTFOLIO_CYCLE_BASE_URL`) to check the Return % column, per-approval
Timeline results, null/error states and desktop/mobile layouts without private data.

## First-Visit Guide

With the isolated demo running via `npm run dev:demo`:

```sh
node --test tests/welcome-guide.browser.test.cjs
CONTEXT_PANEL_BASE_URL=http://127.0.0.1:3312 node --test tests/help-docs.browser.test.cjs
```

The guide suite defaults to port 3312; `WELCOME_GUIDE_BASE_URL` can point to
another isolated **demo** preview. It verifies first-visit dismissal, Help replay,
all seven routes, backward/manual navigation, focus, unchanged rails, preference
isolation, unavailable preference storage and desktop/320px/390px containment in
dark/light themes. Unexpected API mutations are intercepted and fail the tests.
The shared context-panel fixture represents a returning user and suppresses the
welcome so existing workflow tests are not obscured.

## Missing Exchange Auto-Assignment

`cd backend && go test ./... -run TestExchange` covers local identity reuse,
watchlist/external records, held mappings, transaction rollback, duplicate
identities, concurrent edits and batches, provider outages, ambiguous listings,
symbol/name/exchange/currency validation, and optional Sonar discovery that still
requires independent verification. Provider transports are fixtures: no paid calls
or live identity mutations are made by these tests.

`node --test tests/analysis-missing-exchange.browser.test.cjs` covers the name
warning, shared issues filter, automatic assignments, partial results, errors,
retry, mobile bounds and removal of the final warning. Browser responses are
isolated fixtures. Deploy the matching backend before trying the new button
against UAT; the local preview's existing UAT proxy does not run local Go code.

Audit date: 29 May 2026.

Alpha Edge workflow tests must exercise real backend state. UI-only mocks are not enough because the critical behaviours depend on persisted detector state, active workflow rows, statement imports, and reconciliation.

## UAT Scenario Map

The detailed acceptance narrative lives in `tests/uat/UAT_WORKFLOW_SPEC.md`. The authoritative regression map is:

| Scenario | Primary suite | Purpose |
| --- | --- | --- |
| Q3 reduction `100 -> 30/35` | `actions-ui-workflows.spec.ts`, `portfolio-risk-state.spec.ts` | Confirms Portfolio Risk action creation, adjustment entry, statement wait, and persisted detector state. |
| Q3 correct statement import | `actions-ui-workflows.spec.ts` | Confirms recorded reductions reconcile against broker/account import. |
| Q3 incorrect statement import | `actions-ui-workflows.spec.ts` | Confirms statement variance is visible and actions can be reopened. |
| Q3 source mismatch | `actions-ui-workflows.spec.ts` | Confirms cash match alone is insufficient when the wrong holdings were reduced. |
| Q3 risk-on `30/35 -> 80` | `actions-ui-workflows.spec.ts`, `portfolio-risk-state.spec.ts` | Confirms visible allocation-available action with no forced trades or statement wait. |
| Q4 crisis activation | `actions-ui-workflows.spec.ts`, `portfolio-risk-state.spec.ts`, `webhook-contracts.spec.ts` | Confirms Q4 state, 10% target, priority over Q3, and crisis action workflow. |
| Q4 clear | `portfolio-risk-state.spec.ts`, `webhook-contracts.spec.ts` | Confirms Q4 clears to 100 and stored Q3 state remains available. |
| Manual portfolio target | `actions-ui-workflows.spec.ts` | Confirms target rows, decreases first, pending increases, statement match, and baseline approval. |
| Portfolio target draft persistence | `actions-ui-workflows.spec.ts` | Confirms partial target edits survive reload and can clear back to zero. |
| ETF rebalance lifecycle | `etf-rebalance.spec.ts` | Confirms webhook, active targets, allocation update, supersession, and dismissal. |
| Per-security CDF/TMS split | `security-signal-workflows.spec.ts` | Confirms CDF state sync and TMS `SELL_DOWN` action path. |
| Security action queue | `security_actions_test.go` | Confirms Exit priority, blocked later actions, Exit ignore gate, execution report, statement confirmation, queue release, class-pool ticket competition, CDF add block, and TMS re-entry eligibility. |
| Execution quantity matching | `security_action_units_test.go`, `commodity_themes_test.go` | Covers optional units through both APIs, invalid/duplicate reports, current execution baselines, estimated 9/10/11-unit matches, undersized/oversized/wrong-direction movements, class price-only falls, per-member reductions, AUD-per-share estimates, Strong/Weak trim percentages, unresolved identities, older/same-day/other-account statements, and manually recorded external execution. |
| Event simulator | `tools/uat-event-simulator/` | Standalone local HTML runner that replays versioned CDF/TMS paths against UAT without becoming part of the application, including a funded `$100` class-pool Add ticket. |
| Pooled capital and commodity-linked position sequence | `commodity_themes_test.go`; planned `pooled-capital-deployment.spec.ts`, `commodity-theme-policy.spec.ts` | Confirms direct vehicle defaults/validation, class-specific capital attribution, no cross-class funding, no reserved tranche, strength sizing neutrality, commodity permitted target, class Strong Trim, sequential action order, and separation of physical and producer-equity sleeves. |
| One-week trading simulation | `week-trading-simulation.spec.ts` | Confirms the application can carry state across multiple trading days, signals, statements, portfolio target changes, and Q4 crisis. |
| Macro news narrative lifecycle | `news_narratives_test.go` | Confirms foundation/daily mode separation, thesis direction changes, completion handling, prompt injection, and model-output sanitisation. |

## Quantity-Matching Checks

Durable webhook inbox tests are in `backend/webhook_inbox_test.go`, with legacy
Retry/Dismiss tests in `backend/webhook_dead_letters_test.go`. Run
`go test -race -vet=off . -run 'TestWebhookInbox|Test.*DeadLetter|TestAsyncFailure' -count=1`
from `backend/`. Coverage includes persistence before ACK, SQLite reopen with
pending work, storage rejection, concurrent duplicates, intervening opposite
signals, interrupted processing, failed completion writes, panic/error review,
retry/dismiss, stale/out-of-order events and seven-day cleanup preserving
unresolved work and alert history. These tests use local disposable databases.

Statement import regressions are in `backend/statement_import_test.go`. Run
`go test -vet=off . -run '^TestStatementImport' -count=1` from `backend/`.
They check required fields, totals, dates, account mismatch, FX, duplicate
identities, external preservation/conflicts, missing ISINs, renames, all-cash
snapshots, zero-value rights, same-day correction IDs and next-day action
confirmation. Injected database read/write failures compare all affected tables
before and after to prove rollback. Tests use a disposable local database;
do not replay valid fixture snapshots into an account containing real UAT data.

Run from `backend/`:

```sh
go test -vet=off . -run 'TestSecurityAction|TestCommodityThemeClassAction' -count=1
go test -vet=off . -count=1
```

Run `npx tsc --noEmit` from the repository root for the optional-units UI and
API types. The deployment build provides the production compilation check.

## Macro News Narrative Tests

The News tab is tested with mocked model payloads, not live model calls.

Covered backend cases:

- `BOOTSTRAP` foundation run persists a long-horizon thesis map and is returned as `foundation_run`.
- `DAILY` run can update an existing thesis, create a new thesis, and resolve an old thesis without duplicating rows.
- Relationship directions are preserved as audit facts: `NEW`, `SUPPORTS`, `CHALLENGES`, `MODIFIES`, `CONFIRMS`, and `RESOLVES`.
- Resolved theses stay in history but are excluded from the active thesis ledger injected into the next daily prompt.
- Noisy model output is normalised: timeframes, statuses, relationships, conviction values, duplicate sources, duplicate tags, and asset classes.
- Asset-class references are filtered through the canonical `asset_classes` table when it exists.
- Memo-seeded foundation prompts extract structured thesis candidates from the latest saved portfolio memo before web validation.
- Candidate extraction dedupes repeated title/timeframe pairs and drops unknown asset-class codes when the canonical table is available.
- Persisted foundation theses keep memo provenance, source excerpt, supporting evidence, opposing evidence, and invalidation trigger fields.
- Failed model calls create a failed run record but do not replace the latest completed brief.
- Memo-seeded foundation runs persist research lanes before web validation.
- Backend canonical clustering collapses obvious duplicate thesis families, such as AI capex / AI earnings / AI infrastructure variants, before promotion.
- Async foundation jobs persist stage/progress state and promote successful runs into an active foundation cohort.
- Thin foundation jobs fail the quality gate and do not replace the previous active cohort.

Remaining useful coverage:

- API-level tests for `POST /api/news/foundation-jobs` handler behaviour around `202 Accepted` and job polling.
- UI tests for foundation job polling, failed-job display, stale state, memo-source reveal, full thesis-detail reveal, and completed-thesis display.

## Q3 Risk-Off Scenario

Setup:

1. reset overlay state to last applied `100`
2. clear Q4
3. seed Q1-sensitive holdings
4. ensure latest statement exists

Action:

```bash
curl -X POST "$API_BASE_URL/api/webhook/regime" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"SPX","script":"q3d","target_equity_pct":35}'
```

Assertions:

- `equity_sizing.SPX = 35`
- `overlay_signal_state.current_q1_exposure_pct = 35`
- `overlay_signal_state.last_applied_q1_exposure_pct = 100`
- open `overlay_events` row exists
- UI Active Actions shows `Q3 Detector`
- Alert Type shows `Portfolio Risk`
- workflow step is Adjust Positions
- adjustment cells are editable
- required reduction is greater than zero

## Q3 Risk-On Scenario

Setup:

1. last applied Q3 state is lower than new signal, for example `35`
2. no Q4 active crisis

Action:

```bash
curl -X POST "$API_BASE_URL/api/webhook/regime" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"SPX","script":"q3d","target_equity_pct":80}'
```

Assertions:

- detector state updates
- visible Portfolio Risk action exists
- no forced reduction cells
- no statement wait
- no portfolio rebalance plan is created
- UI offers review/mark-reviewed path

## Q4 Crisis Scenario

Action:

```bash
curl -X POST "$API_BASE_URL/api/webhook/regime" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"Q4","signal":"SELL","script":"q4d"}'
```

Assertions:

- `q4_crisis_state.active = 1`
- `equity_sizing.Q4D = 10`
- `portfolio_risk.mode = Q4_CRISIS`
- UI shows event `Q4 Crisis`
- UI shows type `Portfolio Risk`
- Q4 uses market exposure target 10%
- Q4 action follows reduction plus statement workflow

Clear action:

```bash
curl -X POST "$API_BASE_URL/api/webhook/regime" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"Q4","signal":"BUY","script":"q4d"}'
```

Assertions:

- Q4 state inactive
- Q3 detector state remains available

## Portfolio Target Scenario

Setup:

1. approved baseline exists or current mix is available
2. create target rows with both decreases and increases

Assertions:

- plan status `OPEN`
- rows persisted
- decreases appear in action workflow
- increases show pending until cash exists
- recorded values persist across reload
- complete sets `COMPLETED`
- approve creates approved `portfolio_mix_snapshots`
- old approved snapshot becomes `SUPERSEDED`

## Statement Match Scenario

For Q3/Q4:

1. trigger action
2. record reductions
3. confirm Stage 1
4. import statement where holdings/cash match expected after-values
5. assert workflow can complete

For portfolio target:

1. create target
2. record required decreases
3. complete position actions
4. import statement matching target movement
5. approve baseline

## Statement Variance Scenario

1. trigger action
2. record reductions
3. import statement where cash or holdings do not match
4. assert variance visible
5. assert reopen action works
6. correct values or import later statement
7. assert completion works after match

## Playwright Requirements

Playwright tests should:

- navigate to app
- open Positions and Actions
- send backend setup payloads directly where required
- commit adjustment cells with keyboard Enter
- check buttons and locked states
- reload page to verify persistence
- import or simulate statement results
- inspect both UI and backend state

Existing files:

- `tests/uat/actions-workflows.spec.ts`
- `tests/uat/actions-ui-workflows.spec.ts`
- `tests/uat/portfolio-risk-state.spec.ts`
- `tests/uat/webhook-contracts.spec.ts`
- `tests/uat/security-signal-workflows.spec.ts`
- `tests/uat/etf-rebalance.spec.ts`
- `tests/uat/UAT_WORKFLOW_SPEC.md`

## Webhook Contract Suite

Webhook tests must include both endpoint correctness and semantic correctness:

- Q3/Q4 detector payloads sent to `/api/webhook/tradingview` are invalid for
  portfolio risk and should not create ordinary ticker alerts.
- CDF/TMS payloads sent to `/api/webhook/regime` are invalid for per-security
  actions.
- Q3 is percentage-based; Q4 is BUY/SELL-based.
- TMS and ETF TMS retain `strength` and `timeframe` as dimensions separate from
  the action label.

The webhook contract suite lives at:

- `tests/uat/webhook-contracts.spec.ts`

It covers:

1. Q3 detector packets are rejected from `/api/webhook/tradingview`.
2. Q4 detector packets are rejected from `/api/webhook/tradingview`.
3. Q3 state accepts preferred `SPX`, legacy `SPY`, and `XAO`.
4. `SPX` takes precedence over legacy `SPY` for the S&P leg.
5. Q4 `SELL` persists active crisis state and writes `Q4D = 10`.
6. Q4 `BUY` clears crisis state and writes `Q4D = 100`.

Run:

```bash
UAT_WEBHOOK_CONTRACT_TEST=1 \
UAT_RESET_COMMAND="tests/uat/reset-fly-uat.sh" \
UAT_API_BASE_URL=https://alpha-edge-uat-backend.fly.dev/api \
npm run test:uat:webhooks
```

## Portfolio Risk State Suite

The portfolio risk state suite lives at:

- `tests/uat/portfolio-risk-state.spec.ts`

It covers:

1. Q3 before Q4.
2. Q3 changing while Q4 is active.
3. Q4 clearing back to the stored Q3 state.
4. Q3 risk-on being marked reviewed without trades, statement wait, or target creation.

Run:

```bash
UAT_PORTFOLIO_RISK_STATE_TEST=1 \
UAT_RESET_COMMAND="tests/uat/reset-fly-uat.sh" \
UAT_API_BASE_URL=https://alpha-edge-uat-backend.fly.dev/api \
npm run test:uat:risk-state
```

## Per-Security Signal Suite

The per-security signal suite lives at:

- `tests/uat/security-signal-workflows.spec.ts`

It covers:

1. Plain CDF `BUY` / `SELL` updates `security_positions` without creating action alerts.
2. TMS `cdf_sell_zone` creates an explicit `SELL_DOWN` (`Sell Down 20%`) action alert when the ticker has an active TMS setup.

This suite intentionally documents the split between CDF state sync and visible `SELL_DOWN` / `Sell Down 20%`.

Run:

```bash
UAT_SECURITY_SIGNAL_TEST=1 \
UAT_RESET_COMMAND="tests/uat/reset-fly-uat.sh" \
UAT_API_BASE_URL=https://alpha-edge-uat-backend.fly.dev/api \
npm run test:uat:security-signals
```

## UAT Event Simulator

The simulator is deliberately outside the Alpha Edge application. It is a
plain local module in `tools/uat-event-simulator/`, so production and UAT
application bundles, routes, schemas, and UI stay untouched. Its local server
is hard-coded to the UAT Fly app and a single fixture ticker; it does not create
an application endpoint.

Serve it locally from port 3000, which is already a permitted development
origin:

```bash
npm run serve:uat-event-simulator
```

Open `http://localhost:3000` beside the UAT application. Enter the UAT API
token into the runner; it remains in the browser session only. The local
machine also needs an authenticated Fly CLI session. **Start clean** uses that
local CLI to create or reset only the reserved `ASX:AEVT` fixture: a normal
100-unit `$500` UAT Gold Miner holding, stable security identity, and matching
statement snapshot. The fixture is not external, so it appears in the real UAT
Positions tab after refresh; the statement's UAT mock cash is reduced by `$500`.
The runner clears only its own fixture rows, simulator theme events, and active
fixture alerts; fixture alerts with recorded decisions are retired to preserve
their audit history. It then sends only fixed event payloads.

Use it in this order:

1. Open the local runner and select a scenario.
2. Choose **Start clean** to prepare the reserved UAT holding and statement fixture.
3. Choose **Next event** once per expected signal.
4. Compare the runner's expected and observed state with the genuine UAT
   Alert Stack in the separate Alpha Edge tab, then mark the step checked or
   flag the discrepancy.

The catalogue covers the full CDF/TMS security lifecycle, connection-routing
guardrails, and commodity-ratio transport. The commodity scenario verifies
`BATS:GDX / BATS:GLD` against the configured Gold equity regime and
`ASX_DLY:AEVT / BATS:GDX` against the Gold Outperform stage. It confirms the
persisted Market evidence, then transitions Gold equity regime `BUY -> SELL`
and confirms the one class-scoped Equity Regime Strong Trim action includes the
same fixture holding. Stock-level Outperform transitions also create visible
confirmation/loss alerts. The 75/100 live-cap and Outperform-reduction policy
remain unfinished.
The final lifecycle step intentionally records the current raw `SELL` full-stop
code so the forthcoming `Exit` gate migration can be tested rather than
obscured.

The runner is an operator aid, not a production API or a general webhook
injector. Formal automated coverage remains in the backend and Playwright UAT
suites for the underlying webhook and alert contracts.

## ETF Rebalance Suite

The ETF rebalance suite lives at:

- `tests/uat/etf-rebalance.spec.ts`

It covers:

1. `/api/webhook/etf-rebalance` creates active ETF rebalance targets.
2. The webhook updates `etf_allocations`.
3. A newer rebalance sequence supersedes the previous sequence in the active workflow.
4. Dismissal removes the active sequence from `/api/etf/rebalance`.

Run:

```bash
UAT_ETF_REBALANCE_TEST=1 \
UAT_RESET_COMMAND="tests/uat/reset-fly-uat.sh" \
UAT_API_BASE_URL=https://alpha-edge-uat-backend.fly.dev/api \
npm run test:uat:etf-rebalance
```

## One-Week Trading Simulation Suite

The week simulation suite lives at:

- `tests/uat/week-trading-simulation.spec.ts`

It is the orchestration test. The individual suites prove each contract; this suite proves the system can carry state across a realistic trading week without silently losing context.

It covers:

1. A clean baseline statement and approved starting portfolio mix.
2. Mock CDF/TMS alerts for SELL, SELL_DOWN, ADD, and BREAKOUT.
3. User decisions against those action alerts.
4. Daily statement imports showing share reductions, adds, price movement, and new cash.
5. Q3 risk-off from 100% to 35%.
6. Q3 position reductions, correct statement import, Stage 2 redistribution, and baseline close.
7. A new manual portfolio target with required decreases and pending increases.
8. New compensating positions added through the next statement.
9. Portfolio target statement validation and baseline approval.
10. Q4 SELL crisis liquidation to the 10% market-exposure target.

Run:

```bash
UAT_WEEK_SIMULATION_TEST=1 \
UAT_RESET_COMMAND="tests/uat/reset-fly-uat.sh" \
UAT_API_BASE_URL=https://alpha-edge-uat-backend.fly.dev/api \
npm run test:uat:week-simulation
```

The suite writes a Playwright attachment called `week-trading-simulation-timeline.json` showing the day-by-day cash, invested value, total value, and holding count.

Week simulation branch coverage still needed:

| Branch | Expected result |
| --- | --- |
| Stale statement after Q3 reductions | Workflow stays in variance/wait state until a later correct statement arrives. |
| Wrong holdings sold but cash matches | Cash confirmation alone is not enough; source-level discrepancy must be visible. |
| Q4 arrives while a portfolio target is open | Q4 becomes the resolved urgent action; the target must not be lost or silently approved. |
| Q3 risk-on arrives after Q4 clears | User sees allocation available, not forced buys or baseline approval. |
| New cash arrives with distorted baseline | App shows deployable gaps and portfolio-shape context; it does not auto-feed losers or winners. |
| Breakout appears with no sleeve cash | App shows an unfunded breakout gap rather than stealing from other sleeves silently. |

## Test Backlog

1. Add DB seed verifier that checks accounting balance and required mappings.
2. Add direct DB assertions after each Playwright workflow.
3. Add UI assertions that alert cards and history charts render `Sell Down 50%` and `Exit` distinctly after the action-label migration.
4. Add stock-sizing tests for quality/value/upside allocation.
5. Add tactical class cash versus portfolio reserve cash tests.
6. Add breakout funding-gap tests once the workflow exists.
7. Add passive drift-review threshold tests once drift state is formalised.
8. Split the week simulation into additional branch tests for stale statements, Q4 arriving during an unfinished portfolio target, and Q3 risk-on arriving after a completed Q4 crisis.
