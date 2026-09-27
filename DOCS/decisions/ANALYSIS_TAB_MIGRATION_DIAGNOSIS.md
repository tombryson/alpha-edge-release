# Analysis Tab Migration Diagnosis

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

Status: Proposed

Audit date: 23 July 2026.

## Purpose

This document converts the Analysis tab audit into an implementation contract.
It diagnoses the current decision surface, states the desired end state, and
defines a staged migration that improves the existing page without replacing
its working ledger model.

The Analysis tab is not a generic dashboard. It is the operating surface where
research inputs become a ranked, sized, and reviewable portfolio decision. The
primary design goal is therefore:

```text
Find the right security -> assess evidence -> complete missing research ->
validate the signal -> decide whether it participates in sizing -> act.
```

The spreadsheet was strong because this sequence was visible in one place. The
application must preserve its advantages over a spreadsheet - persistent state,
validation, repeatable workflows, and external research linkage - while making
that sequence just as legible.

## Scope And Non-Goals

In scope:

- Analysis table hierarchy, controls, row interactions, and information
  architecture.
- Model-score input and Council-run workflows.
- Sort, filter, grouping, sizing participation, and watchlist visibility.
- Accessibility, test coverage, and the frontend structure needed to make the
  page safe to evolve.

Out of scope:

- Replacing the stock-analysis data model or the Council service.
- Removing the compact table in favour of cards or a dashboard landing page.
- Removing existing useful interactions such as ticker reveal, expandable
  details, direct model input, source capture, Flat/Sector grouping, Active
  participation, or target-weight calculation.
- Changing investment policy, score formulae, or target-weight formulae unless
  an explicit business-rule decision is recorded in the appropriate contract.

## Evidence And Confidence

The findings below have different evidence levels. They must not be treated as
equivalent.

| Evidence level | Meaning | Use in this document |
| --- | --- | --- |
| Confirmed in source | The behaviour is directly visible in the current frontend or test source. | Safe to turn into a code or test task immediately. |
| Visually observed | The behaviour was visible in supplied authenticated screenshots. | Safe for design direction; re-check during implementation. |
| Runtime unverified | A populated, authenticated Analysis table could not be exercised from this environment. | Must be validated on UAT before declaring the migration complete. |

The browser audit was blocked by the API-token gate in a clean browser session.
One Playwright UAT shell test passed, but it only verifies that the application
shell exposes the `ANALYSIS` tab. It does not cover populated Analysis rows,
model input, sorting, Council runs, or target-weight participation. This is an
explicit test gap, not evidence that those workflows work.

## Baseline Scorecard

The overall baseline is **C+**. The page has a good visual foundation, but a
decision surface cannot score highly while displayed metrics and sort behaviour
can disagree.

| Area | Baseline | Evidence | Diagnosis |
| --- | ---: | --- | --- |
| Visual language | A- | Visually observed and source | Dense, calm, terminal-like presentation with useful colour restraint. |
| Spreadsheet readability | B+ | Visually observed | The table is familiar and scans efficiently; compact rows are appropriate. |
| Information hierarchy | B- | Visually observed and source | The core left-to-right order is good, but many small uppercase labels compete. |
| Model-score input | B | Confirmed in source | Per-model Q/V/PT, source text, date, auto-fill, and save are useful capabilities. |
| Council workflow | B- | Confirmed in source | Retry, recovery, progress, and persisted-run handling are substantial, but the UI vocabulary is fragmented. |
| Sizing and Active controls | B | Confirmed in source | Participation and weight are distinct concepts and are represented as such. |
| Grouping and watchlist context | B- | Confirmed in source | Flat/Sector and temporary watchlist highlighting help orientation but do not support finding work. |
| Sorting and data trust | D | Confirmed in source | Quality and Value header sorting do not match the visible metrics. |
| Discoverability | C+ | Visually observed and source | Useful actions are distributed across hover areas, tiny icons, row expansion, and popovers. |
| Accessibility | C- | Confirmed in source | Several core controls are not semantic or keyboard-friendly. |
| Responsive use | C | Source and visual inference | The ledger is desktop-first and horizontal overflow is unavoidable; mobile prioritisation is not yet defined. |
| Maintainability | C | Confirmed in source | A large panel and layered CSS make visual changes fragile. |
| Automated regression protection | D | Confirmed in source | No end-to-end Analysis workflow is currently tested. |

## What Must Survive The Migration

The following are successful parts of the current product and are migration
constraints, not optional polish:

1. The dense, table-first ledger. Analysis must remain readable across a large
   universe without turning each security into a card.
2. Sticky functional column headers. The recently removed group-band header
   must not return unless it conveys a decision users cannot make without it.
3. Ticker reveal. The left-edge hover rail keeps rows compact while still
   allowing ticker identification and editing.
4. Compact score progress. One, two, and three dots may communicate early,
   provisional, and final model completion, provided the exact state remains
   available through accessible text and detail expansion.
5. Flat and Sector views in the existing top action bar. These are view modes,
   not a separate page-level panel.
6. A distinct `IN` / `OUT` sizing-participation control. Watchlist membership
   and portfolio-model participation are not the same thing.
7. Direct per-model input with source provenance. A model run needs Q, V, PT,
   input date, source text, validation, and a clear save outcome.
8. Council progress and recovery behaviour. Long-running work must remain
   observable and recoverable after intermittent polling errors.

## Diagnosis

### 1. Decision Integrity Is Broken By Sort Semantics

Severity: P0

The current headers visually promise that a click sorts by the metric named in
the header. That contract is not true today:

| Visible header | Current click handler | Actual result | Required result |
| --- | --- | --- | --- |
| `QUALITY` | `handleSort('TOTAL')` | Sorts performance-adjusted total. | Sorts the displayed mean Quality score. |
| `VALUE` | `handleSort('VALUE_SCORE')` | Sorts Gemini's combined Q/V score. | Sorts the displayed mean Value score. |
| `GEMINI` | `handleSort('VALUE_SCORE')` | Sorts the same Gemini combined Q/V score. | Either label it as a combined Gemini score or provide a deliberate Gemini sort contract. |
| `PRICE` | No table-header action | Not sortable from the surface. | Either be sortable or present as intentionally non-sortable. |

Source evidence:

- `components/stock-table/analysis-panel.tsx` renders the Quality, Value, and
  Gemini header handlers.
- `components/stock-table.tsx` defines `QUALITY` and `VALUE_SCORE` sorting.
- Neither sorter currently returns the same values shown in the compact Quality
  and Value cells.

Impact:

- A user can believe they are ranking the best Quality opportunities while
  actually ranking a blended total that includes performance.
- Sorting becomes an untrustworthy operation precisely where it should be the
  clearest decision shortcut.
- Incorrect ordering can make an otherwise excellent layout operationally
  dangerous.

Migration rule:

```text
One displayed metric must have one named calculation and one matching sort.
The renderer, sort comparator, tooltip, and test fixture must all use that
same calculation.
```

Acceptance criteria:

- `QUALITY` sorts the exact Quality values rendered in the table.
- `VALUE` sorts the exact Value values rendered in the table.
- Every sortable header exposes direction and `aria-sort`.
- Every visible sort arrow corresponds to the active comparator.
- A fixture with intentionally conflicting Quality, Value, Total, and Upside
  values proves each column independently.

### 2. The Page Has A Ledger, But Not A Strong Work Queue

Severity: P1

Flat/Sector mode and the watchlist highlight solve presentation, not workflow.
They do not answer the daily operating questions:

- Which active securities have incomplete model research?
- Which watchlist names are ready to become sizing candidates?
- Which rows have a buy signal but no target weight?
- Which price targets are stale or missing?
- Which Council runs failed, are running, or need review?

The default target-weight ordering is good because it prioritises consequence.
It is not enough when the task is research completion rather than capital
allocation.

Target state:

- Keep `Flat` and `Sector` as the primary layout choices.
- Add an Analysis-local finding layer: search plus compact, combinable filters.
- Start with filters that reflect existing state rather than inventing new
  portfolio policy: `All`, `Active`, `Watchlist`, `Incomplete research`,
  `No target`, `Council running/failed`, and `Signal: Buy`.
- Make the watchlist eye a temporary emphasis only if a named filter is also
  available; colour alone is not a reliable retrieval tool.

Acceptance criteria:

- A user can reach any incomplete active row in at most two interactions from
  the default Analysis view.
- A user can restrict the ledger to watchlist candidates without changing
  their Active state.
- Filter state is visible, removable, and does not silently alter sizing.
- View and filter state are either persisted intentionally or explicitly reset
  on navigation; accidental refresh loss is not acceptable.

### 3. Research Entry Is Capable But Has Too Many Entry Points

Severity: P1

The current row can expose model data in compact cells, model popovers,
expanded model cards, a model-run editor, Council popovers, and expanded
Council actions. The individual pieces are capable, but they create competing
mental models of where work is done.

Examples of current vocabulary for related Council work include `RUN`,
`ANALYSE`, `RERUN`, `LOAD`, `CLEAR`, `LAB`, and `RUNS`. These labels describe
different details, but do not form one clear action hierarchy.

Target state:

```text
Row summary: status and the next meaningful action.
Expanded detail: inspect all model evidence and targets.
Editor: enter or correct one provider run.
Council controls: run, observe, recover/load, and inspect saved runs.
```

Migration rules:

1. The compact row should not be a second full editor.
2. One action name should launch a new Council run everywhere: `Run Council`.
3. Existing output should change the action to `Rerun Council`; it must not
   require users to infer that `RUN` and `ANALYSE` are equivalent.
4. `Load latest`, `Saved runs`, and `Open lab` are secondary actions grouped
   under a consistent Council detail surface.
5. Starting a new external run must show enough context to prevent accidental
   runs: ticker, exchange, selected template, and whether a prior run exists.
   Whether this is a confirmation dialog or an inline preflight is a product
   decision; the implementation must be explicit.

Acceptance criteria:

- One provider edit can be completed without searching for a second surface.
- The editor explains what source data is required and confirms save/failure.
- A Council run shows queued, stage, progress, failure, recovery, and complete
  states using one vocabulary.
- The user can identify a failed or stale Council run from the row without
  opening every detail panel.

### 4. Visual Density Is Productive, But The Hierarchy Is Too Uniform

Severity: P1

The ledger earns its density. The problem is not that it looks like a
spreadsheet; the problem is that too many controls use the same small,
uppercase, low-contrast treatment.

Consequences:

- Headers, secondary metadata, tiny action labels, sort affordances, and mode
  controls compete for attention.
- A user must learn several invisible rules: hover over the left edge for a
  ticker, click a row to expand, use a tiny column icon for configuration,
  and inspect a `RUN` chip to find Council actions.
- Colour carries useful meaning, but colour and low contrast together should
  not be the only way to find state.

Target hierarchy:

1. **Primary scan:** Name, current price, upside, Quality, Value, Council,
   signal, target weight, Active.
2. **Secondary context:** ticker, exchange, asset class, watchlist/ETF marker,
   run completion, 6M/12M context.
3. **On-demand evidence:** model provider cells, source text, thesis, catalyst,
   chart link, saved Council runs.

Acceptance criteria:

- A first-time user can identify the primary scan order without a tutorial.
- Every hidden-on-hover item has a keyboard-accessible or persistent path.
- The column chooser has a descriptive accessible name and a visible enough
  affordance to be found by a regular user.
- Labels use the glossary-approved action language consistently.

### 5. Accessibility And Interaction Semantics Need A Contract

Severity: P1

Current source uses click handlers on non-button table-header content, relies on
hover zones for ticker reveal, and opens portal popovers without a declared
dialog contract. These choices are compact, but they exclude keyboard and
assistive-technology users and make automation harder.

Required contract:

- Sortable headers are real buttons inside `th` cells with `aria-sort` on the
  header.
- The ticker rail can be revealed by focus and has a labelled edit control.
- Popovers that block interaction behave as dialogs: focus enters the dialog,
  Escape closes it, and focus returns to the invoking control.
- Status is never colour-only. Buy/Sell/Hold, run status, and Active state must
  have text or an accessible label.
- Small visual controls need a touch-safe fallback at narrow widths.

Acceptance criteria:

- Full Analysis navigation, sorting, expansion, provider editing, and Active
  toggling work by keyboard alone.
- Automated accessibility checks report no serious violations in the table,
  model editor, or Council surface.
- Hover-only behaviour has an equivalent focus or click interaction.

### 6. The Current Frontend Structure Makes UI Work Fragile

Severity: P1

`components/stock-table/analysis-panel.tsx` is a large component with inline
style definitions and multiple overlapping rules. For example, stock-row height
is defined first as `26px` and later as `30px`; the latter wins only because it
appears later. This pattern is a direct source of accidental overcorrection.

The goal is not a broad rewrite. It is to give each part of the existing
experience a stable ownership boundary.

Target component boundary:

```text
AnalysisPanel
  AnalysisTableToolbar       // column visibility, view/filter controls
  AnalysisGrid
    AnalysisColumnHeader     // label, comparator, sort state, accessibility
    AnalysisGroupRows        // Flat/Sector structure
    AnalysisStockRow         // compact summary only
    AnalysisDetailRow        // model cards, targets, Council detail
  ModelRunEditor             // one canonical provider input surface
  CouncilRunControls         // launch, status, recovery, saved runs
```

Rules:

- Extract one visual/interaction domain at a time with behaviour-preserving
  tests before moving the next domain.
- Move Analysis CSS to a dedicated module or tokenised global layer; remove
  superseded selectors in the same change.
- Do not leave parallel row implementations or duplicate calculation helpers.
- Keep shared table state in `StockTableContext` only where multiple panels
  genuinely need it; local editing state stays local to its feature.

Acceptance criteria:

- One authoritative stock-row height and one authoritative background rule.
- Named helpers own Quality, Value, Council, Upside, and target-weight display
  values, rather than repeating calculations in render code and sort code.
- Each extracted component has a small, documented input boundary.
- Visual changes to one row feature do not require editing unrelated Council or
  sizing JSX.

### 7. The Test Strategy Does Not Protect The Decision Workflow

Severity: P0

The UAT suite currently verifies application-shell navigation but does not
exercise the populated Analysis ledger. This leaves the highest-risk behaviour
outside automated protection.

Required fixture characteristics:

- At least six securities spanning stocks, ETFs, watchlist-only rows, active
  and inactive sizing rows, missing research, partial research, complete
  research, positive/negative upside, and a failed Council state.
- Deliberately non-correlated Quality, Value, Total, Price, Upside, and target
  weight values so incorrect sort reuse is obvious.
- One row with an exchange-prefix validation error.
- One existing Council run and one recoverable polling error.

Required tests:

| Workflow | Assertions |
| --- | --- |
| Open Analysis | Analysis grid loads populated data and functional headers remain sticky. |
| Metric sort | Quality, Value, Total, Upside, Price, and Target Weight each produce the expected fixture order. |
| Filtering | Flat/Sector and each work-queue filter change visible rows without changing persisted sizing state. |
| Active state | Toggling `IN`/`OUT` updates target-weight eligibility and survives reload. |
| Model input | Open a model run, save Q/V/PT/date/source, and see summary/completion state update. |
| Council state | Test preflight failure, queued progress rendering, recoverable poll failure, complete state, and saved-run loading with mocked APIs. |
| Accessibility | Keyboard sort/expand/edit and dialog focus behaviour work; automated axe checks pass. |
| Visual regression | Desktop and narrow-width screenshots catch row-height, header, clipping, and toolbar regressions. |

No real Council run, price refresh, or external upload should be required for a
frontend test. Those side effects must be mocked at the API boundary.

## Staged Migration Plan

### Phase 0: Establish A Safe Baseline

Goal: make current behaviour observable before changing it.

Frontend work:

- Add stable `data-testid` attributes only to key workflow controls and cells.
- Create the populated Analysis fixture and mocked Council API states.
- Add a visual regression baseline for desktop and narrow viewport widths.

Backend work:

- None required, except a deterministic test fixture/reset route if one does
  not already exist.

Exit criteria:

- The Analysis test matrix above runs against UAT-like fixture data.
- Known incorrect sorting is captured as an expected failing test or an
  explicitly quarantined test with a linked remediation task.

### Phase 1: Restore Decision Integrity

Goal: make table meaning and ordering trustworthy.

Frontend work:

- Introduce single helpers for displayed Quality, Value, provider score, Total,
  Price, Upside, and Target Weight.
- Wire each header to its matching comparator.
- Convert sortable headers to semantic button/header pairs and expose sort
  direction.
- Make Price intentionally sortable or visibly static; do not leave the
  comparator orphaned.

Backend work:

- None, unless the product decides that sort calculations must be server-owned
  for large data sets. For the current table size, client-side sorting is
  acceptable once calculations are shared.

Exit criteria:

- All metric-sort tests pass.
- Users can explain each sort using the visible column label alone.

### Phase 2: Add Finding And Triage Without Changing Policy

Goal: restore the spreadsheet's fast navigation through a large universe.

Frontend work:

- Add search and state-based filters.
- Keep Flat/Sector controls in the top action bar.
- Treat watchlist highlighting as an optional visual emphasis, not a hidden
  filter.
- Make active/inactive and incomplete-research states findable.

Backend work:

- None for a client-side universe of the current size.
- Add query-backed filtering only if the app moves to server pagination or a
  much larger data set.

Exit criteria:

- A user can find the next required research action in two interactions or
  fewer.
- Filter changes do not mutate stock data, Active state, or target weights.

### Phase 3: Consolidate Research And Council Workflows

Goal: retain capability while reducing competing entry points.

Frontend work:

- Make the expanded detail row the canonical evidence view.
- Keep the provider editor as the canonical data-entry view.
- Consolidate Council labels and locate secondary Council operations together.
- Add clear save, validation, loading, failed, recovered, and complete states.
- Add a deliberate launch preflight for external Council runs.

Backend work:

- Confirm that Council job status, failure reason, run ID, and latest-run
  recovery data are sufficient for the UI contract.
- Add an idempotency key or explicit duplicate-run policy if repeated launches
  can create unwanted duplicate work.

Exit criteria:

- Every research task has one obvious primary entry point.
- Council progress and recovery can be tested without a live Council run.

### Phase 4: Extract Components And Consolidate Styles

Goal: make further changes local, reviewable, and reversible.

Frontend work:

- Extract `AnalysisColumnHeader` first, then `AnalysisStockRow`, then
  `AnalysisDetailRow`, `ModelRunEditor`, and `CouncilRunControls`.
- Move Analysis styles out of the render body and delete superseded rules.
- Preserve the current public behaviours while each extraction lands.

Backend work:

- None expected.

Exit criteria:

- No duplicate row height, background, score calculation, or Council action
  rules remain.
- The Analysis panel is an orchestration component rather than a complete UI
  implementation.

### Phase 5: Validate The Operating Surface On UAT

Goal: confirm the migration helps real decision work, not only code structure.

UAT review checklist:

1. Review a mixed universe of at least 50 securities in Flat and Sector modes.
2. Find incomplete active research, complete one provider run, and confirm row
   completion changes without reload.
3. Sort by Quality, Value, Total, Upside, Price, and Target Weight using known
   fixture values.
4. Toggle a watchlist security out of sizing and confirm its target state.
5. Start a mocked Council flow, observe progress/error/recovery, and load a
   saved run.
6. Check desktop and narrow widths for clipping, toolbar overflow, and header
   behaviour.
7. Complete the keyboard-only workflow once.

Exit criteria:

- No P0 or P1 issue remains open.
- The scorecard reaches at least B in sorting/data trust, discoverability,
  accessibility, maintainability, and automated regression protection.
- The user accepts the UAT workflow as faster than the spreadsheet for the
  common tasks of triage, input, ranking, and sizing.

## Ownership Matrix

| Concern | Frontend ownership | Backend ownership | Test ownership |
| --- | --- | --- | --- |
| Displayed metric and sort contract | Render and comparator share one helper. | Supplies canonical fields and server formulae where applicable. | Fixture order proves each comparator. |
| Target weight | Shows backend result and clear fallback state. | Owns authoritative sizing endpoint and formula. | Mock authoritative and fallback responses. |
| Active participation | Renders and updates `IN`/`OUT`. | Persists `includeInSizing`. | Verify toggle persists and changes eligibility. |
| Provider input | Validates draft state and source capture. | Persists analysis fields. | Verify save, reload, partial/complete state. |
| Council run | Presents launch, progress, recover, and inspect state. | Creates/polls jobs and returns result packets. | Mock each status; never invoke the live service. |
| Filtering and grouping | Local presentation state for current data set. | Only needed for pagination/server query future. | Verify no mutation and predictable filter composition. |

## Open Product Decisions

These must be decided before the relevant phase begins. They are not safe to
infer from current code.

1. Which exact filters are first-class: only state filters, or also asset
   class, ETF/stock, provider completion, signal, and target-weight range?
2. Should filter/view state survive refresh and be shareable by URL, or stay
   session-local?
3. Is a Council launch confirmation required for every run, only for a rerun,
   or replaced by an inline preflight summary?
4. Is a provider score intentionally a combined Q/V score, and if so should
   the header say `Gemini Score` rather than `Gemini`?
5. Should the visible default list include every watchlist security, every
   sizing-active security, or both with a clear status distinction?
6. What is the supported mobile task: quick read-only review, or full model
   input and sizing management?

## Definition Of Done

The Analysis tab migration is complete only when all of the following are true:

- Displayed metrics, sort behaviour, tooltips, and tests agree.
- The user can find research work, enter evidence, understand state, and make
  a sizing decision without hunting through multiple hidden controls.
- Flat/Sector grouping, ticker reveal, watchlist context, model evidence,
  source provenance, and Council recovery have been preserved or deliberately
  improved.
- No important workflow depends solely on hover, colour, or an unlabeled icon.
- The populated Analysis workflow is covered by deterministic Playwright tests
  and visual regression checks.
- UAT has been reviewed with real authenticated data before production release.
