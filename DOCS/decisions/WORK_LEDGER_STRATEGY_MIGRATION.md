# Work Ledger And Strategy Migration

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

Status: `Proposed planning document`. This document does not authorise an
implementation or introduce a trading rule by itself.

## Purpose

Alpha Edge is moving from a collection of capable screens into a durable
investment operating system. The next stage should make the application's
daily work explicit without collapsing research, portfolio construction,
market timing, and trade execution into one opaque status.

This document is the decision register and migration backlog for that work. It
is intended to guide future discussions about product design, implementation,
and financial logic before code is written.

Related contracts:

- [Decision Flows](../system/DECISION_FLOWS.md) defines the separation between
  qualification, portfolio room, cash, market timing, and execution.
- [Business Logic](../system/BUSINESS_LOGIC.md) defines current portfolio-risk,
  sizing, ETF, cash, and TradingView policies.
- [Analysis And Council Pipeline](../system/ANALYSIS_AND_COUNCIL.md) defines research
  evidence and score inputs.
- [Actions Workflows](../system/ACTIONS_WORKFLOWS.md) owns action and reconciliation
  lifecycle rules.
- [Pooled Capital Deployment Policy v1.0](../system/POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md)
  owns purchase-ticket and CDF deployment rules. It supersedes any conflicting
  entry/tranche wording in this planning document.

## Working Thesis

The primary product should be a relational investment ledger with a separate,
durable attention layer.

```text
Facts and evidence   -> holdings, analysis, Council runs, signals, cash, alerts
Attention ledger     -> what a human needs to assess, decide, or confirm
Daily note           -> a concise briefing generated from the attention ledger
AI assistance        -> explains, prioritises, and challenges; does not invent facts
```

The attention ledger is not a spreadsheet filter and it is not a second source
of investment truth. It is a persistent projection of unfinished work with a
human-controlled lifecycle.

## Architectural Principles

1. **Separate facts from attention.** A Council failure, stale price target, or
   TradingView event remains stored in its owning system. A work item references
   that fact and records that it needs attention.
2. **Separate research from execution.** Analysis qualifies and ranks a
   candidate. CDF/TMS and Actions determine timing, trimming, exit, and
   reconciliation.
3. **Use stable security identity.** Work must link to `security_id`, not a
   company name or bare ticker, so a renamed company does not duplicate or
   orphan its history.
4. **Rules create work; AI interprets it.** Deterministic rules create,
   resolve, or supersede work items. AI may summarise evidence and propose
   priorities, but it must not silently create a financial action.
5. **Every dismissal is auditable.** A user can resolve, dismiss with a reason,
   or snooze an item. The original condition and the decision remain visible.
6. **No raw signal changes the sizing universe automatically.** `IN` / `OUT`
   represents deliberate inclusion in relative stock sizing. A Buy or Sell
   signal changes deployment or execution context, not fundamental
   qualification.
7. **Use relational storage first.** The workload needs transactionality,
   uniqueness, status transitions, scheduled queries, and audits. SQLite is an
   appropriate first store. A graph projection can be considered later for
   thesis, evidence, and dependency exploration, not as the initial work queue.

## State Ownership

| State | Owner | Meaning | Must not do |
| --- | --- | --- | --- |
| Research evidence | `stock_analysis`, provider data, Council run | Scores, price targets, source evidence, completion, staleness. | Execute or infer trades. |
| Candidate universe | `stock_analysis.include_in_sizing` | A deliberate decision to let a stock compete for relative target weight. | Change automatically because a live signal changed. |
| Market and position signal | TradingView state, `security_positions`, `alerts` | Buy/Sell context, stop, add, trim, re-entry, breakout. | Rewrite Quality, Value, research completion, or portfolio baseline. |
| Portfolio room and funding | Portfolio mix, class cash, reserve cash, sizing output | Whether a qualified opportunity can be funded. | Silently transfer cash across classes. |
| Attention ledger | Proposed `work_items` | What a human needs to review, decide, finish, or confirm. | Become an alternative source of pricing, signal, or execution truth. |
| Daily note | Proposed daily briefing run | A readable daily prioritisation of open work and important changes. | Alter portfolio state or resolve work without explicit policy. |

## Historical Commodity Theme Exploration (Superseded)

> **Superseded for live-cap rules.** This section records the exploration that
> led to the commodity-theme model. Its `33% / 67% / 100%` capacity examples
> are not the current direct-stock allocation policy. The authoritative v1.0
> rule is [Commodity Theme Live-Cap Policy v1.0](COMMODITY_THEME_LIVE_CAP_POLICY_V1.md):
> equity regime governs the available expression, the existing CDF/TMS contract
> remains the only security trend/deployment authority, and `OUTPERFORM` permits
> the final 25% concentration increment in a CDF-BUY context. Retain this
> section as design history and its broader migration rationale, not as an
> implementation formula. No new implementation, test, payload, or UI copy may
> use the historical capacity percentages below.

### Decision Title

**Commodity Theme Gating And Expression**

Status: `Proposed`. This is a strategy and portfolio-construction change. It
must be validated before it is allowed to alter a live target, funding rule, or
execution recommendation.

### Problem

The current strategic mix treats an allocation such as `Gold Miners` or
`Energy Producers` as a broad destination weight. It does not distinguish
between:

- owning a commodity or commodity-linked instrument because its own regime is
  constructive;
- owning the industry's equity beta because producers are outperforming the
  commodity they sell;
- owning a researched company because it is individually investable; and
- concentrating the final increment in a company that is leading its peer
  group.

That allows an apparently attractive stock to receive capital while the
underlying commodity or industry complex is breaking down. It also loses the
opportunity to take lower-specific-risk commodity exposure before attempting
to capture producer and company alpha.

### Core Policy

Treat a commodity-linked opportunity as a **theme**, not merely as an
asset-class row. A theme has a single approved maximum budget and a sequence
of evidence gates. The gates determine both the amount of theme exposure that
is permitted and which kinds of instrument may express it.

This is intentionally a correlated, increasing-conviction strategy. It does
not attempt to remove commodity, industry, and company correlation. Agreement
between those layers is the reason that more of the theme budget may be
deployed.

```text
Portfolio risk overlay
  -> approved direct-commodity sleeve and approved equity sleeve
  -> direct commodity gate, for the direct sleeve only
  -> producer basket / commodity relative regime
  -> existing CDF/TMS deployment state and research qualification
  -> company / producer-basket leadership
  -> funding, entry, and execution confirmation
```

The initial theme registry should cover only businesses with a sufficiently
clear economic link to a priced underlying. It must not be applied to every
asset class or used as a generic substitute for the existing research and
portfolio process.

### Capacity Does Not Prescribe The Implementation

The recommended model is a **gated capacity envelope**, rather than a rule
that permanently holds set percentages in physical exposure, an ETF,
individual stocks, and breakouts.

A breakout is a characteristic of an individual equity, not a separate
investment vehicle. Likewise, a producer ETF is a broad implementation choice,
not necessarily a holding that must remain in the portfolio once individual
leaders are available.

The direct commodity sleeve and the equity sleeve are separate. A positive
commodity regime permits the direct sleeve. It is evidence for the broader
thesis, but it is not an equity gate.

For an approved **equity** theme budget `B`:

| Confirmed equity gates | Permitted equity capacity | Newly eligible implementation |
| --- | ---: | --- |
| None | `0% of B` | No new equity deployment. |
| Producer basket / commodity relative strength | `33% of B` | Broad producer ETF/basket, if that is the selected implementation. |
| Above + qualified company trend | `67% of B` | Researched, `IN`, eligible individual producers. |
| Above + company leadership / breakout | `100% of B` | Full approved equity capacity, prioritising the leading eligible companies. |

Example, with a `$20,000` approved Gold Theme budget:

```text
Gold price confirmation                  -> physical-gold sleeve may be held
Gold equities / gold                     -> up to $6,667 in gold equities
Above + qualified miner trend            -> up to $13,333 in gold equities
Above + miner leadership                 -> up to $20,000 in gold equities
```

At full confirmation, the valid implementation of the equity budget may be
`$20,000` in selected miners, with no residual producer-ETF holding. Any
separately approved physical-gold sleeve remains outside the equity rotation.
The equity gates remain prerequisites and evidence; they are not mandatory
permanent ETF positions. This is how the system captures underlying beta first
while still allowing the mature expression of the thesis to be mostly or
entirely alpha.

The alternative, a mandatory implementation split, remains a possible future
portfolio policy but is not the recommended starting rule. It would
confuse evidence stages with holdings, force capital into lower-conviction
vehicles after the strategy has identified leaders, and treat a breakout as if
it were an asset class.

### Direct Commodity And Equity Theme Budgets

Physical gold and gold equities are different sleeves with different gates.
They may coexist in the broader Gold theme, but must not be made contingent on
one another:

| Sleeve | Gate | Treatment when producer or company gates become positive |
| --- | --- | --- |
| Physical gold | Gold-price regime. | Remains a separate diversification or direct-commodity decision. It is not counted as an equity gate. |
| Gold equities | `GDX / GLD`, existing company CDF state, then company / `GDX`. | Uses the existing CDF/TMS contract for deployment and adds leadership concentration for selected miners. |

For example:

```text
Physical Gold target:                $5,000
Gold Miners equity maximum:         $20,000

Commodity regime only:
  physical gold is eligible; gold-miner capacity is still $0

All three equity gates confirmed:
  physical gold remains separately governed + up to $20,000 equity exposure
```

This permits the `Gold Miners` equity maximum to become 100% direct miners at
full confirmation, while a separately approved physical-gold requirement stays
in its own sleeve. It preserves the move from beta to alpha without treating
physical gold as a preliminary form of gold-miner equity exposure.

Physical gold must remain its own allocation sleeve for accounting, risk,
statement reconciliation, and class-level controls. It can roll up into the
parent `GOLD` theme beside `GOLD_MINERS`, but it must not be relabelled as a
gold-miner security or silently included in direct-miner rankings.

### Theme, Sleeve, Signal, And Security Are Different Things

The following data concepts must not be collapsed into the current
`asset_classes` row alone:

| Concept | Example for gold | Responsibility |
| --- | --- | --- |
| Theme | `GOLD` | Connects related direct and equity sleeves without collapsing their gate states. |
| Sleeve / implementation type | Physical gold, broad miner ETF, direct miners | Describes where approved capital is expressed. |
| Signal instrument | `GLD` gold-price proxy, `GDX / GLD`, company / `GDX` | Produces a transparent direct-regime or equity-eligibility state. It is not necessarily held. |
| Execution instrument | Local bullion ETF, GDX, or a selected ASX/NYSE miner | What can actually be bought, held, and reconciled. |
| Security | A specific company | Owns Quality, Value, Council, price-target, and individual momentum evidence. |

The existing `PHYSICAL_GOLD` and `GOLD_MINERS` asset classes are useful
starting sleeves under the existing `GOLD` parent. They do not yet provide the
parent-level budget, gate state, or explicit instrument eligibility required by
this policy.

### Initial Theme Definitions

Each theme must declare exchange-qualified signal instruments, execution
options, a peer basket, and the reason its economics support the model. Bare
tickers are not enough because symbols can be ambiguous across venues.

| Theme | Commodity regime | Producer-relative regime | Company leadership comparator | Notes |
| --- | --- | --- | --- | --- |
| Gold producers | `GLD` gold-price proxy | `GDX / GLD` | Company / `GDX` | Direct gold is separate; Gold Miners use the three equity gates. |
| Silver producers | Silver bullion | `SIL / SLV` or `SILJ / SLV` by producer type | Company / matching producer basket | Silver carries greater industrial-cycle sensitivity. |
| Copper producers | Copper reference | `COPX / copper reference` | Company / COPX | Use an exchange-qualified physical/futures reference. |
| Oil producers | WTI crude | Producer basket / WTI | Company / producer basket | Separate E&P from oil services. |
| Oil services | Upstream investment cycle | Oil-services basket / a defined capex proxy | Company / oil-services basket | Do not treat this as the same immediate signal as oil producers. |
| Uranium producers | Uranium reference | Uranium producer basket / uranium reference | Company / producer basket | Use slower, contract-aware testing. |
| Natural-gas producers | Relevant gas benchmark | Producer basket / relevant gas benchmark | Company / producer basket | Account for regional pricing and hedging. |
| PGM producers | Defined PGM price composite | PGM producer basket / composite | Company / producer basket | A single company is not the industry-layer benchmark. |
| Lithium producers | Lithium chemical price reference | Lithium producer basket / lithium reference | Company / producer basket | A broad battery-metals basket is not automatically a lithium proxy. |
| Steel producers | Regional steel-margin reference | Steel producer basket / regional reference | Company / producer basket | Commodity price alone may omit important input-cost effects. |

### Interaction With The Current Portfolio Screen

The Portfolio screen should ultimately show three values for each applicable
theme, instead of presenting one broad target as if it were fully deployable at
all times:

```text
Gold market
  Physical-gold target:     $5,000  (gated by Gold price)
  Gold-miners maximum:     $20,000
  Equity permitted now:    $13,333  (two of three equity gates)
  Equity currently held:   $13,000  (direct miners)
```

The approved strategic floor and tactical maximum remain user-owned
portfolio-construction decisions. The permitted tactical amount is a
transparent, live policy result. Actual exposure is derived from holdings.
None of these values may overwrite, substitute for, or be double counted in
the others.

For non-commodity themes, the current broad asset-class target model remains
valid. This framework is an additional structure for appropriately classified
price-taker themes, not a replacement for Pharma & Biotech, Healthcare
Services, technology, or other businesses whose economics cannot be captured
through a single underlying-price transmission chain.

### Required Tests Before Policy Approval

1. Pre-register each theme's exact instruments, exchange, currency, start
   date, rebalancing frequency, and trading-cost assumptions.
2. Test the commodity regime and producer-relative signal separately. The
   relative signal must add information beyond the commodity simply being up.
3. Test the complete capacity path against a static theme allocation and a
   commodity-only allocation, including drawdown and turnover.
4. Test each theme independently. Do not tune gold parameters and assume they
   transfer to uranium, oil services, lithium, or steel.
5. Define failure and unwind rules before live use: capacity reduction, new
   purchase block, existing-position review, and the treatment of a strategic
   bullion floor must be deterministic.
6. Keep all outputs advisory until the user approves a trade. No regime event
   may create an order, move cash, or rewrite a strategic mix snapshot.

### Implementation Shape After Approval

This is deliberately not the next implementation task. When approved, it will
require:

- a persisted theme registry and versioned signal-instrument mapping;
- parent-level theme budgets and a view that aggregates physical, ETF, and
  direct-stock exposure without double counting;
- stored gate snapshots and source evidence, rather than a hidden runtime
  calculation;
- an eligibility result passed into existing sizing, funding, and work-ledger
  projections; and
- a Portfolio and Analysis presentation that distinguishes strategic maximum,
  permitted capacity, actual expression, and pending work.

## Proposed Work Ledger

### Scope

The ledger should unify attention across Analysis, Portfolio, Positions, and
Actions while preserving the responsibility of each source system. It should
allow the user to work from a daily queue without losing the deep source
context behind an item.

### Tentative Data Model

The following is a design starting point, not yet a database contract.

```text
work_items
  id
  status              OPEN | IN_PROGRESS | SNOOZED | RESOLVED | DISMISSED | SUPERSEDED
  type                RESEARCH | COUNCIL | QUALIFICATION | FUNDING |
                      EXECUTION | PORTFOLIO_REVIEW | DATA_QUALITY
  priority            CRITICAL | HIGH | NORMAL | LOW
  security_id         nullable stable identity reference
  asset_class_code    nullable canonical asset class
  source_type         analysis | council_run | alert | portfolio | signal | import
  source_id           nullable source-record reference
  rule_key            deterministic rule that created the item
  dedupe_key          unique key for one unresolved condition
  title
  explanation
  evidence_json       small snapshot of inputs at time of creation/update
  route               ANALYSIS | POSITIONS | PORTFOLIO | ACTIONS | NEWS
  route_context_json  row, tab, panel, or filter context for deep-linking
  due_at
  snoozed_until
  created_at
  updated_at
  resolved_at
  resolution_reason

work_item_events
  id
  work_item_id
  event_type          CREATED | UPDATED | SNOOZED | RESOLVED | DISMISSED |
                      SUPERSEDED | REOPENED
  actor               USER | RULE_ENGINE | DAILY_BRIEF
  payload_json
  created_at
```

Rules must create items idempotently through `dedupe_key`. When the underlying
condition disappears, the existing item should transition to `RESOLVED` or
`SUPERSEDED`; it should not be deleted.

### First Rule Families

| Type | Example trigger | Route | Notes |
| --- | --- | --- | --- |
| `RESEARCH` | An `IN` stock has no completed provider Quality, Value, and PT run. | Analysis | Does not mean the stock should be bought. |
| `COUNCIL` | A Council run failed, stalled, or requires saved-run review. | Analysis | Requires durable Council status before it can be reliable. |
| `QUALIFICATION` | A researched candidate lacks an asset class, valid target, or security identity. | Analysis | Data-quality and investment-readiness are distinct reasons. |
| `FUNDING` | A qualified, deployable candidate lacks class tactical cash or class room. | Portfolio | Must not silently source cash from another class. |
| `EXECUTION` | A confirmed TMS/CDF action is awaiting user confirmation or statement evidence. | Actions / Positions | A projection of alert state, not a replacement for it. |
| `PORTFOLIO_REVIEW` | Strategic drift, an approved-review cadence, or a funded opportunity requires a class decision. | Portfolio | A review is not an automatic rebalance. |
| `DATA_QUALITY` | Price, mapping, source date, or broker identity requires review. | Analysis / Positions | Can be created by imports and scheduled checks. |

### Priority Policy

Priority must be explainable, never a hidden score. Initial rules should use
ordered policy rather than a numeric model:

1. `CRITICAL`: time-sensitive confirmed execution or portfolio-risk action.
2. `HIGH`: failed work or a funded decision blocked by missing required evidence.
3. `NORMAL`: research, classification, target, and portfolio-review work.
4. `LOW`: quality improvements, stale optional evidence, and deferred review.

The daily note may sort within a priority tier using recency, funding status,
capital consequence, or explicit user pinning. Those inputs must be shown to
the user and recorded in the item evidence.

## `IN` / `OUT` And Live Signals

The current `IN` / `OUT` control is a sizing-universe decision. It determines
whether a stock participates in relative target-weight normalisation. The UI
should eventually use a clearer name such as `UNIVERSE` or `MODEL`, while
retaining concise `IN` and `OUT` states.

The following policy is proposed:

| Event | `IN` / `OUT` result | Work-ledger result |
| --- | --- | --- |
| Quality, Value, or PT missing | No automatic change. | Create or update `RESEARCH`. |
| Council failure | No automatic change. | Create or update `COUNCIL`. |
| CDF Sell for an unheld candidate | No automatic change. | Show deployment context or review; CDF Sell blocks a new deployment ticket without disqualifying the candidate from the research universe. |
| TMS stop for a held position | No automatic change. | Project the required action into `EXECUTION`. |
| User concludes the thesis is invalid or the candidate should not compete for capital | User changes to `OUT`. | Resolve or supersede related research/funding items with a recorded reason. |
| User changes a candidate back to `IN` | User changes to `IN`. | Reopen applicable qualification and research work. |

This preserves the difference between "a good company worth monitoring",
"a candidate that may receive capital", and "a position that needs an action
today".

## Daily Briefing

The first daily briefing should be a stored, deterministic summary generated
from open work items and their source evidence. It should be usable without an
LLM, then enhanced by AI once data quality and policy are proven.

Suggested daily structure:

```text
Daily operating note
  Urgent execution: confirmed actions awaiting review or reconciliation
  Funding decisions: qualified opportunities with capital constraints
  Research work: incomplete evidence, failed Council work, stale targets
  Portfolio review: drift, class capacity, and cash context
  Changes since prior note: new, resolved, reopened, and snoozed items
```

The note should link each item directly to its source screen and preserve the
rule/evidence that created it. A reminder may surface the note once per trading
day, but reminders must not mark work as reviewed or completed.

## AI Role

AI is useful once the ledger is populated, but it should be bounded.

Allowed:

- summarise the daily open-work set in plain language
- group related items by asset class, thesis, or funding constraint
- identify conflicts in evidence and explain why a priority is high
- draft a research brief using linked source evidence
- ask for missing user decisions explicitly

Not allowed without a separately approved policy:

- create a trade, transfer cash, change `IN` / `OUT`, dismiss work, or approve
  an execution action
- create a financial fact that is not present in a source record
- silently elevate priority because of untraceable model reasoning

Every AI statement should retain links to the work items and source evidence it
used. AI suggestions are advisory objects, not status transitions.

## Migration Sequence

### Phase 0: Reconcile Current Contracts

Before a new feature, audit live schema and source ownership. The current
documentation claims a versioned migration runner exists, but the referenced
`backend/internal/migrate` and `backend/migrations` paths are not present in
this checkout. Resolve that discrepancy before adding the ledger schema.

Also update the Data Model and Analysis documentation for `security_id` and
name aliases before allowing work items to reference securities.

Exit criteria:

- one approved schema-migration path exists
- the actual production schema is documented
- `security_id` identity migration/backfill has a tested contract

### Phase 1: Define Economic And Workflow Policy

Decide which rule families are appropriate before any task generator exists.
The first approved rules should be low-risk, objective, and non-execution:

1. incomplete research for an `IN` stock
2. failed or stalled Council run
3. missing asset-class assignment
4. missing or stale target evidence

Exit criteria:

- every rule has a source, explanation, dedupe key, resolution rule, and owner
- no rule changes target weights, signal state, cash, or execution state

### Phase 2: Persist And Generate Work Items

Implement the minimum relational schema, rule runner, API, audit events, and
stable deep links. Run the rule generator after relevant source changes and in
an idempotent scheduled sweep.

Exit criteria:

- reload-safe item state
- no duplicate open item for one unresolved condition
- automatic resolution only when its specific source condition is resolved
- manual snooze, dismiss with reason, and reopen are audited

### Phase 3: Add The Work Surface

Build a compact cross-application queue with priority, type, source, and route.
The Analysis tab should show its own research/qualification items; Actions
should continue to show execution items. The top-level queue can combine both
without concealing their origin.

Exit criteria:

- an item opens the relevant security and context in one action
- filtering the queue never mutates source state
- work type and priority are understandable without colour alone

### Phase 4: Add Daily Briefing And Reminder

Persist a daily note from the ledger, expose it in the app, and optionally send
one daily reminder. Start with deterministic text and counts. Add AI narrative
only after the deterministic briefing is trusted.

Exit criteria:

- the briefing has source-linked sections and previous-day comparison
- the reminder is informational only
- no live execution workflow is hidden behind the note

### Phase 5: Add Funding And Execution Projections

Once research work is stable, add explicit funding gaps and projections of
already-confirmed Actions/alerts. This is where financial policy must be
reviewed carefully because priority and funding conditions can influence real
capital decisions.

Exit criteria:

- tactical class cash and portfolio reserve cash remain distinct
- work items do not duplicate or contradict action lifecycle state
- all execution-related tasks link to their alert and reconciliation evidence

## Decision Register For Future Discussions

Each proposed development direction should be recorded here before
implementation using this template:

```text
Decision title:
Status: OPEN | APPROVED | REJECTED | DEFERRED

Question:
What business problem are we solving?

Options:
What are the realistic alternatives?

Financial and economic reasoning:
What assumption, risk, incentive, liquidity constraint, or portfolio effect
supports each option?

State ownership:
Which existing source owns the underlying fact? Is a new persisted state needed?

Recommended policy:
The proposed rule, including what must never happen automatically.

Implementation shape:
Schema, backend, UI, scheduling, external-service, and migration implications.

Verification:
Unit, integration, Playwright, UAT, and financial-scenario tests required.

Open questions:
What cannot safely be inferred yet?
```

## Initial Discussion Backlog

These are subjects to assess with the user before implementation. They are not
approved requirements.

| Topic | Core question | Why it matters |
| --- | --- | --- |
| Qualification threshold | What minimum evidence makes a stock eligible for the sizing universe? | Prevents weak or partial evidence from distorting relative weights. |
| Score construction | How should Quality, Value, Council, momentum, and scenario evidence combine? | Avoids double-counting correlated evidence or treating a modifier as a thesis score. |
| Target integrity | How should stale, implausible, split-adjusted, or highly dispersed price targets be handled? | Protects upside and target weight from bad inputs. |
| Target-weight limits | What caps, floors, concentration limits, and class-relative rules should apply? | Prevents a single outlier from consuming unrealistic capital. |
| Candidate capacity | Is ten direct stocks per asset class the right policy, and when is an exception justified? | Balances diversification against research capacity and concentration. |
| Signal policy | When does CDF/TMS block, cap, or merely prioritise deployment? | Keeps timing rules from silently invalidating research decisions. |
| Commodity-theme policy | Which price-taker themes earn a transmission model, what is each theme budget, and are physical holdings tactical or strategic? | Turns broad class targets into transparent permitted-capacity decisions without conflating signals, holdings, and execution. |
| Funding policy | When may a funded candidate ask for class cash, a trim, or portfolio review? | Keeps cash routing explicit and avoids hidden reallocation. |
| ETF policy | How should core and tactical ETFs coexist with direct-stock candidate sizing? | Prevents unlike investment vehicles from being ranked as if they carry the same role and risk. |
| Daily AI role | What may AI summarise, challenge, or recommend, and what remains exclusively user-controlled? | Retains traceability and prevents invented operational state. |
| Reminder policy | What should happen daily, weekly, or only when an exception occurs? | Avoids notification noise and creates a sustainable operating cadence. |

## Non-Goals For The First Work-Ledger Slice

- replacing the Analysis, Positions, Portfolio, or Actions tabs
- automatic changes to target weights, cash, or execution from a work item
- graph-database migration
- automatic trade execution or broker integration changes
- AI-generated tasks without deterministic source rules
- adding every possible portfolio metric before the core daily workflow works

## Definition Of Readiness

The ledger should not be implemented until the following are true:

1. The user approves the first low-risk rule families and their resolution
   policy.
2. The storage migration path is real, versioned, and tested.
3. Security identity is stable enough to link tasks across company-name changes.
4. Execution tasks are explicitly treated as projections of existing alert and
   action state, not independent trade instructions.
5. The daily note has a defined cadence, delivery surface, and user control.
