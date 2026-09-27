# News Narrative Architecture

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

Draft date: 9 June 2026.

Status: implemented MVP plus hardening work. The current news ledger exists,
completed portfolio memo artefacts are persisted by the council result path,
and memo-seeded foundation runs now use a staged pipeline: memo-to-thesis
candidate extraction, research-lane planning, Grok web-search validation,
backend canonical clustering, quality gate, and active foundation cohort
promotion.

## Purpose

The News tab should maintain a durable macro narrative ledger. It should not be
a generic news feed and it should not rediscover the market from scratch every
day.

The strongest available long-horizon input is currently the Portfolio Memo
produced by **Portfolio Analysis**. That memo already reads the portfolio,
macro regime, sector conditions,
overweights, underweights, rejected alternatives, and asset-class target logic.
The news system should use that memo as a structured prior for the foundation
run, then use daily web-search evidence to maintain, challenge, confirm, modify,
or resolve those narratives.

## Current Implementation Facts

### News Ledger

Current backend owner: `backend/news_narratives.go`.

Current routes:

```text
GET  /api/news/brief
POST /api/news/run
POST /api/news/foundation-jobs
GET  /api/news/foundation-jobs/{id}
```

Current tables:

```text
news_runs
news_items
news_theses
news_thesis_updates
news_foundation_candidates
news_foundation_research_tasks
news_foundation_clusters
news_foundation_jobs
news_foundation_cohorts
news_foundation_cohort_theses
```

Current behaviour:

1. `POST /api/news/run` accepts `mode = bootstrap/foundation` or `mode = daily`.
2. `POST /api/news/foundation-jobs` is the preferred foundation path. It creates
   a durable background job and returns immediately.
3. Generic bootstrap mode calls xAI/Grok with web search and asks for a
   12-month foundation map.
4. Memo-seeded bootstrap mode loads the saved portfolio memo, extracts thesis
   candidates without web search, persists those candidates, builds a research
   lane plan, then validates and expands them with Grok web search.
5. A foundation job must pass a quality gate before it is promoted. A thin or
   failed foundation run does not replace the visible ledger.
6. Validation output is canonically clustered in the backend before storage so
   repeated phrasings of the same thesis family do not become separate ledger
   rows.
7. A successful foundation job creates a new active foundation cohort and
   supersedes the previous active cohort.
8. The daily prompt injects active theses from `news_theses` and asks for
   updates.
9. The response persists a run, news items, thesis rows, thesis updates, and
   per-thesis source/evidence fields.
10. Asset classes are normalised against the active canonical asset-class table.

This is the correct basic persistence shape. The main remaining weakness is the
depth of the live model prompt and broader end-to-end tests against realistic
portfolio memo artefacts.

### Portfolio Analysis And Portfolio Memo

Current frontend helper: `lib/portfolio-memo.ts`.

Current frontend consumers:

```text
components/stock-table.tsx
components/news-tab.tsx
```

Current behaviour:

1. The Trading Terminal starts a Portfolio Analysis job through the Next API
   Council proxy.
2. The frontend polls the council job.
3. On success, it fetches the council result.
4. The Next council result proxy detects completed portfolio-positioning jobs.
5. `buildPortfolioMemoSummary` extracts:
   - analysis date
   - primary theme
   - secondary theme
   - overall conviction
   - executive summary
   - analyst memo markdown
   - chairman memo markdown
   - asset-class targets
6. `buildPortfolioMemoPersistPayload` builds the backend persistence payload.
7. The council result proxy saves the artefact to `POST /api/portfolio-memos`.
8. The News tab reads `GET /api/portfolio-memos/latest` and uses the latest
   memo as the preferred Foundation source.
9. Browser `localStorage` is now only a compatibility fallback. If an old memo
   exists locally and the backend has no saved memo, the News tab can migrate it
   into the backend.
10. If the user creates a memo-derived portfolio target, the target rows and
   `memo_job_id` are persisted through `/api/portfolio-rebalances/from-memo`.

Current backend owner: `backend/portfolio_memos.go`.

```text
GET  /api/portfolio-memos/latest
POST /api/portfolio-memos
```

Current table:

```text
portfolio_memo_runs
```

Resolved gap:

```text
The backend now persists the memo artefact itself.
```

The news backend can now find the latest memo text, memo summary, source job,
and extracted strategic fields without treating browser localStorage as a source
of truth.

## Design Principle

The Portfolio Memo is a strategic prior. The news ledger is the evidence tracker.

They must not collapse into one feature.

```text
Portfolio memo:
  "What strategic macro and asset-class view should the portfolio consider?"

News narrative ledger:
  "What evidence has arrived since then, and does it confirm, challenge,
   modify, or resolve the durable theses?"
```

The memo can seed theses. It must not directly create trades, rewrite portfolio
targets, alter Q3/Q4 detector state, or classify securities.

## Target Architecture

### Layer 1: Persist Memo Artefacts

Implemented.

A backend-owned memo artefact table lets the news engine use memo output without
depending on frontend localStorage.

Current table:

```text
portfolio_memo_runs
```

Current fields:

```text
id INTEGER PRIMARY KEY
memo_job_id TEXT UNIQUE NOT NULL
run_id TEXT
mode TEXT
status TEXT
model TEXT
analysis_date TEXT
primary_theme TEXT
secondary_theme TEXT
overall_conviction TEXT
executive_summary TEXT
analyst_memo_markdown TEXT
chairman_memo_markdown TEXT
asset_class_targets_json TEXT
raw_result_json TEXT
created_at DATETIME
updated_at DATETIME
```

Rules:

1. One row per completed council portfolio memo job.
2. Store the raw council result for audit, but use extracted fields for prompts.
3. Do not use browser localStorage as backend truth.
4. Do not require the user to create a portfolio rebalance before a memo can
   seed the news foundation.

Implementation choice:

```text
Persist through the council result path.
```

This is cleaner because the artefact is saved when the memo exists, not only
when the user chooses to create a target from it.

Current implementation detail:

```text
app/api/council/jobs/[jobId]/result/route.ts
  -> fetches council result
  -> detects portfolio_positioning result
  -> POSTs memo artefact to backend /api/portfolio-memos
```

The persistence call is intentionally non-blocking for the council result
response. If memo persistence fails, the result is still returned and a warning
is logged.

### Layer 2: Extract Thesis Candidates

Implemented for memo-seeded foundation runs.

The first model call is a deterministic memo-to-thesis extraction step. It does
not use web search. Its job is to turn the portfolio memo into candidate claims,
not to validate whether those claims are true.

Input:

```text
portfolio_memo_runs.executive_summary
portfolio_memo_runs.analyst_memo_markdown
portfolio_memo_runs.chairman_memo_markdown
portfolio_memo_runs.asset_class_targets_json
current canonical asset classes
```

Output:

```text
news_foundation_candidates
```

Current fields:

```text
id INTEGER PRIMARY KEY
memo_job_id TEXT NOT NULL
title TEXT NOT NULL
timeframe TEXT NOT NULL
claim TEXT NOT NULL
reasoning TEXT
source_section TEXT
source_excerpt TEXT
status TEXT
conviction REAL
supporting_evidence TEXT
opposing_evidence TEXT
invalidation_trigger TEXT
sources_json TEXT
asset_classes_json TEXT
tags_json TEXT
created_at DATETIME
updated_at DATETIME
```

Extraction prompt should ask for claims such as:

- regime view
- inflation/rates/liquidity assumptions
- commodity and energy claims
- defensive versus risk-on claims
- asset-class overweight and underweight rationales
- rejected alternatives
- invalidation triggers where the memo implies them

The extraction step is capped at 20 candidates and deduped by title/timeframe.
Candidate asset classes are filtered against the canonical asset-class table,
falling back to the bootstrap registry only if the database cannot provide a
valid list.

### Layer 3: Build Research Lanes

Implemented for memo-seeded foundation runs.

Before web validation, the backend builds and persists an explicit research
plan. The memo is the starting prior, but it is not the whole foundation. The
research plan forces the validation pass to cover broad macro lanes and the
asset classes implied by the memo.

Output:

```text
news_foundation_research_tasks
```

Default macro lanes:

```text
macro_cycle
commodities_energy
geopolitics_defence
technology_ai
regional_relative_growth
```

The backend also adds:

- one lane per asset class referenced by memo candidates
- one lane per relevant portfolio target not already covered
- memo-prior lanes for the strongest extracted candidates

Each lane stores the memo job id, timeframe, query, priority, tags, and affected
asset classes. This makes the foundation run auditable: if the ledger looks
thin, the first question is whether the research plan covered the right lanes.

### Layer 4: Validate Candidates With Web Evidence

Implemented for memo-seeded foundation runs.

The second model call uses Grok web search to validate the extracted candidates
against the research plan. It produces the normal news payload shape: daily
summary, market context, news items, thesis rows, and thesis updates.

Input per batch:

```text
candidate title
candidate claim
candidate asset classes
candidate source excerpt
research lanes
current date
allowed timeframes
allowed relationships
canonical asset-class vocabulary
```

Output:

```text
news_theses
news_thesis_updates
news_items
```

Validation rules:

1. The model must return confirming evidence and challenging evidence where
   available.
2. Conviction is not just "how persuasive the memo sounded". It reflects the
   memo claim after current web evidence.
3. The model should merge duplicate ideas before returning. The backend also
   performs a canonical clustering pass after validation.
4. A candidate with weak evidence can become `WATCH`, not forced `ACTIVE`.
5. A candidate contradicted by evidence can become `REJECTED`.
6. Validation output may merge overlapping candidates into one thesis.

### Layer 5: Canonical Thesis Clustering

Implemented for memo-seeded foundation runs.

The backend clusters semantically repeated thesis variants before quality
assessment and persistence. This is deliberately not an asset-class mapping.
Asset-class membership alone is not enough to merge theses. The cluster key is
based on the title, summary, evidence, and tags.

Example variants:

```text
AI capex sustains Technology sector leadership
AI infrastructure supercycle drives sustained Tech outperformance
AI earnings leadership persists in US equities
```

These collapse into one `ai_technology_leadership` family unless the evidence
clearly separates them.

Cluster audit output:

```text
news_foundation_clusters
```

The cluster table stores the canonical key, promoted title, timeframe, absorbed
titles, asset classes, and tags for the memo job. It lets the backend explain
which duplicate variants were collapsed.

### Layer 6: Quality Gate And Cohort Promotion

Implemented for foundation jobs.

The validated payload is not immediately treated as the user's macro base. It
first passes a simple quality gate:

```text
memo-seeded foundation: at least 8 validated theses
generic foundation: at least 5 validated theses
at least 2 affected asset classes
enough supporting evidence across the returned theses
```

If the gate fails, the job is marked `FAILED` and the active foundation cohort is
left untouched. This is deliberate. A weak foundation run should be visible as a
failed attempt, not quietly overwrite the ledger.

On success:

```text
news_foundation_jobs.status = SUCCEEDED
news_foundation_cohorts.status = ACTIVE
previous ACTIVE cohort -> SUPERSEDED
news_runs.foundation_cohort_id = active cohort id
news_theses.foundation_cohort_id = active cohort id for foundation theses
news_foundation_cohort_theses stores the promoted snapshot
```

The visible ledger is loaded from:

```text
active foundation cohort theses
plus daily-created theses with no foundation cohort
excluding superseded theses
```

This gives the foundation pass a real replacement boundary without letting a
failed run poison the current user-facing state.

### Layer 7: Persist Foundation Source Links

Implemented as direct thesis fields plus cohort snapshots.

The current implementation preserves foundation source metadata on `news_runs`:

```text
news_runs.source_type
news_runs.source_id
```

For memo-seeded foundation runs:

```text
source_type = PORTFOLIO_MEMO
source_id = portfolio_memo_runs.memo_job_id
```

The MVP also preserves per-thesis source and validation fields directly on
`news_theses`:

```text
source_type TEXT DEFAULT ''
source_id TEXT DEFAULT ''
source_excerpt TEXT DEFAULT ''
supporting_evidence TEXT DEFAULT ''
opposing_evidence TEXT DEFAULT ''
invalidation_trigger TEXT DEFAULT ''
```

Preferred later model, if provenance needs to become many-to-one:

```text
news_thesis_sources
```

```text
id INTEGER PRIMARY KEY
thesis_id INTEGER NOT NULL
source_type TEXT NOT NULL
source_id TEXT NOT NULL
source_section TEXT
source_excerpt TEXT
created_at DATETIME
```

Use `source_type = PORTFOLIO_MEMO` for memo-seeded thesis provenance.

### Layer 8: Daily Maintenance

The daily news run should not receive the full memo. It should receive the
active thesis ledger.

Prompt input:

```text
active thesis title
timeframe
conviction
summary
asset classes
latest relationship
latest evidence
invalidation trigger where present
```

Daily output:

```text
news_items
news_thesis_updates
possibly new theses
possibly resolved/rejected theses
```

Rules:

1. Daily runs maintain the ledger.
2. They should not repeat old memo text.
3. They should not create broad new 1Y theses unless the evidence is genuinely
   structural.
4. They should make explicit whether fresh evidence confirms, supports,
   challenges, modifies, resolves, or creates a thesis.

## End-To-End Flow

```text
Council portfolio memo completes
  -> council result proxy persists portfolio_memo_runs
  -> News tab reads latest saved memo
  -> user runs memo-seeded Foundation
  -> backend creates news_foundation_jobs row
  -> backend extracts memo thesis candidates without web search
  -> backend persists news_foundation_candidates
  -> backend builds and persists news_foundation_research_tasks
  -> backend validates candidates with Grok web search against research lanes
  -> backend clusters duplicate thesis families into news_foundation_clusters
  -> backend applies quality gate
  -> backend creates/promotes active news_foundation_cohorts row
  -> persist news foundation run with source_type/source_id
  -> persist news theses, source/evidence fields, and initial updates
  -> daily news run maintains that ledger
```

## API Contract Shape

### Existing

```text
GET  /api/news/brief
POST /api/news/run
```

`POST /api/news/run` remains for compatibility and for the daily run. It should
not be the preferred UI path for foundation creation.

### Implemented MVP Additions

```text
GET  /api/portfolio-memos/latest
POST /api/portfolio-memos
POST /api/news/run { "mode": "bootstrap", "source_memo_job_id": "..." }
POST /api/news/foundation-jobs { "source_memo_job_id": "..." }
GET  /api/news/foundation-jobs/{id}
```

`POST /api/portfolio-memos` stores a completed council portfolio memo artefact.

`POST /api/news/foundation-jobs` starts a memo-seeded foundation job. Without
`source_memo_job_id`, it falls back to generic foundation input. The UI should
prefer a memo source when one exists.

Response shape:

```json
{
  "run": {},
  "foundation_run": {},
  "foundation_cohort": {
    "id": 12,
    "status": "ACTIVE",
    "source_type": "PORTFOLIO_MEMO",
    "source_id": "memo-job-id",
    "thesis_count": 14,
    "quality_score": 0.87
  },
  "foundation_job": {
    "id": "news_foundation_...",
    "status": "SUCCEEDED",
    "stage": "promoted",
    "progress_pct": 100
  },
  "items": [],
  "theses": [],
  "updates": []
}
```

## UI Contract

The News tab should make the source of the foundation clear without crowding the
daily workflow.

Recommended UI states:

1. No foundation:
   - show `Run Foundation`
   - if a memo exists, show `Seed from latest memo`
2. Foundation exists:
   - show foundation date and source
   - example: `Foundation 7 Jun, 23:59 / portfolio memo`
3. Foundation running:
   - show job stage and progress
   - do not change the visible ledger until the job succeeds
4. Foundation failed:
   - show the failure message
   - retain the previous active foundation cohort
5. Daily run:
   - show `Run Daily`
   - daily run should maintain existing narratives
6. Narrative details:
   - show memo source only in detail/hover/reveal, not as repeated main-card
     noise

The user should understand:

- what the latest daily evidence says
- which durable thesis changed
- whether the evidence confirms or challenges it
- what the underlying source thesis came from

## Prompt Boundary

The memo-seeded foundation prompt should use this hierarchy:

1. Extracted memo candidate.
2. Canonical asset classes.
3. Web evidence.
4. Final thesis object.

It should not be asked to:

- create a portfolio target
- change security classifications
- decide trades
- alter Q3/Q4 state
- rewrite the portfolio memo

## Testing Requirements

### Backend Unit Tests

Add tests for:

Implemented:

1. Persisting a portfolio memo artefact.
2. Upserting a portfolio memo artefact by `memo_job_id`.
3. Loading the latest portfolio memo artefact.
4. `POST /api/portfolio-memos` rejects missing `memo_job_id`.
5. `GET /api/portfolio-memos/latest` returns the saved memo.
6. Creating a memo-seeded foundation run with source metadata.
7. Daily run prompt includes active thesis ledger, not full memo text.
8. Asset-class labels normalise through `asset_classes.code`.
9. Extracting thesis candidates from a synthetic memo.
10. Rejecting duplicate candidate titles into one stable candidate.
11. Persisting candidate source/evidence/invalidation fields.
12. Filtering candidate asset classes against the canonical asset-class table.
13. Promoting a successful foundation job into an active cohort.
14. Failed or thin foundation jobs do not replace the active cohort.

Still required:

1. Live xAI contract smoke test in UAT with a known saved memo.
2. UI tests proving full thesis details are recoverable without clipping.
3. End-to-end test where a daily run modifies an active memo-seeded foundation
   cohort.

### Prompt Fixture Tests

Use a synthetic portfolio memo containing:

- inflationary late-cycle expansion
- Q2 overheating
- Q3 stagflation/oil shock tail
- energy overweight
- gold/physical gold support
- AI-linked equities
- fixed income and cash ballast
- rejected disinflationary 60/40 posture

Expected output:

- at least one 1Y regime thesis
- at least one 6M rates/inflation thesis
- at least one energy thesis
- at least one gold thesis
- at least one AI/semiconductor thesis
- no duplicated "AI earnings leadership" thesis unless materially distinct

### UI Tests

Add tests for:

1. Foundation source is visible.
2. Narrative ledger can reveal full detail without clipping.
3. Timeframe filters keep newest relevant items first.
4. Human-readable asset-class labels render in all news surfaces.
5. Running daily after foundation shows changes, not a second disconnected
   foundation map.

## Migration Plan

### Phase 1: Persistence

1. Add `portfolio_memo_runs`.
2. Persist completed council memo results.
3. Add `GET /api/portfolio-memos/latest`.
4. Keep existing localStorage cache only as a UI convenience.

Status: implemented.

### Phase 2: Foundation Source

1. Extend `POST /api/news/run` to accept `source_memo_job_id`.
2. Build memo-seeded bootstrap prompt.
3. Persist source metadata on `news_runs`.
4. Add tests for source preservation and failure behaviour.

Status: implemented for run-level source metadata and direct per-thesis source
fields.

### Phase 3: Extraction And Validation

1. Add memo candidate extraction.
2. Add web validation pass.
3. Add dedupe rules before thesis upsert.
4. Cap model output sizes so the UI remains readable.

Status: implemented MVP. Remaining work is operational hardening around failed
live validation, retries, and UI source review.

### Phase 4: UI

1. Show foundation source.
2. Add memo-source detail reveal.
3. Keep daily evidence and narrative changes as the primary user workflow.

## Open Decisions

1. Should direct `news_theses` source fields remain enough, or should we add
   `news_thesis_sources` when one thesis can be supported by multiple memo or
   news artefacts?
2. Should the generic bootstrap mode remain available after memo-seeded
   foundation exists?
3. Should extraction and validation stay on the same xAI model, or should
   extraction move to a cheaper structured model with no web search?

## Non-Goals

This architecture does not:

- automate trades
- change portfolio targets
- replace Portfolio Analysis or the Portfolio Memo
- classify individual stocks
- change ETF allocation logic
- use static model memory as macro truth
