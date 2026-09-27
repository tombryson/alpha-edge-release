# ETF Model — Proposal

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

Status: `Partly implemented; shared class budgets are implemented. The decisions
below (9 September 2026) supersede the earlier momentum/reservation proposal.
Multiple funds per class remains proposed, not implemented.`

## Confirmed Decisions (9 September 2026)

- Retain automatic, bounded ETF momentum adjustment after explicit Core selection.
- Do not permanently reserve unused ETF capacity. A lower effective target releases
  unoccupied capacity to direct stocks in the same class; unsold ETFs still count.
- Live Analysis suggestions remain display-only and advisory. No binding research
  approval, new individual-stock targets, or automatic orders are introduced.
- Core selection/removal and ratio editing remain explicit in the sidebar's
  Security and ETF views. Positions retains its compact, read-only ratio chips.

Analysis dollar suggestions, the ETF ledger and purchase projection now share
`max(approved class budget - max(effective ETF target, ETF capital held), 0)`.
The ledger uses active holdings, including external holdings, for occupied capital;
this does not permit funding external holdings with IG cash. Purchase checks also
account for pending buys, Q3/Q4 permissions and statement-backed class funding.
ETF targets retain the existing bounded model; its empirical calibration is not
established by this implementation. The single Core policy schema is retained.
See [Pooled Capital Policy](../system/POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).

The remaining proposal describes future work, not deployment state. It revises assumptions in
[ETF System v2.0](ETF_SYSTEM_V2.md) §3, §4.2 and §7.1, which were written when
ETFs were still a separate sleeve.

Sits under [Portfolio Mandate Model](../system/PORTFOLIO_MANDATE_MODEL.md), which governs the
relationship between what a security *is* and what it is *funded* to be. §3's
shortlist is that model's "researched, not mandated" state scoped to funds.

---

## 1. What an ETF is now

An ETF is not a portfolio. It is not a sleeve. It is **the way an asset class gets
expressed**, alongside direct stocks in the same class.

```text
portfolio shape        decides which classes exist and their weights
  → class fund ratio   decides how much of a class goes via funds
    → mapped funds     decide which funds express it
      → gate           decides whether that expression is currently permitted
```

Capital allocation is owned entirely by the first line. Nothing below it creates,
moves, or competes for class capital. This is the rule the old model broke.

## 2. Core

**Core is a description, not a status.** A fund is core to an asset class when it
captures that class's beta. That is the whole meaning, and it stands. What was wrong
was *where that fact lives*.

### What this section claimed, and why it failed

The first version said that mapping a fund to a class **is** calling it core, that
`stock_analysis.primary_asset_class` therefore already carries the designation, and
that `asset_class_etf_policies.core_ticker` was redundant and should go.

Checked against the live database, that is false. `primary_asset_class` is **analysis
metadata**: it is written for every ETF that has ever been researched, including funds
sold to zero, funds never held, and funds parked in placeholder classes (`EQUITY`,
`TECHNOLOGY`, and in one case `ETF` itself). Every ETF in the research set carries one.

So "mapped" as a membership rule admits the entire research universe. Shipped in
`067803c` and deployed, it did exactly that: the rail filled with classed, unselected,
unheld funds. The premise was never checked against the data before it was written
down, and it should have been.

### The correction

Core is still not a separate *status* — there is no core / non-core flag to toggle
independently of the class a fund expresses. But the fund↔class relationship is a
**portfolio decision, and a portfolio decision needs its own record.** Analysis
metadata cannot double as one.

- A fund expresses a class when a **mapping record** says so. Creating that record is
  the whole of "making it core". There is still no second designation step and no
  separate core flag.
- `primary_asset_class` is demoted to a **hint**: it seeds the class when you map a
  fund, and it powers the unmapped-holdings gap report. It never confers membership.
- More than one fund can express a class (GDX and GDXJ are both gold-miner beta). The
  current schema cannot hold that — `asset_class_etf_policies` is keyed by
  `asset_class` with a single `core_ticker` column. The mapping therefore moves to its
  own table keyed by **(class, fund)**, carrying the per-fund weight from §5. The
  policy row keeps the per-class ratio and loses `core_ticker`.
- There is still no "non-core ETF" as a display category. A held fund with no mapping
  is **unmapped** — a gap to fix. A classed, unmapped, unheld fund is a **candidate**,
  and belongs in the shortlist (§3), not in the ledger.
- No state blocks funding on core-ness. What the ceremony loses is the funding gate
  and the separate selection step — not the record itself.

### The membership rule

> A fund is in the ledger because a mapping record puts it there, **or** because it is
> holding capital.

The second clause is not a concession to legacy. An unmapped holding is real money in
the book and cannot be invisible; it appears in the ledger *and* in the gap report,
which is the point — it is money with no stated intent behind it.

## 3. Universe

Two sets, with different jobs.

| Set | Definition | Job |
| --- | --- | --- |
| **Mapped funds** | A fund with a mapping *record* for a class (§2). Held or not. | The funds that express your classes. These are the ledger rows. |
| **Shortlist** | Funds you are explicitly watching, not yet mapped. Includes funds that merely carry a `primary_asset_class`. | Discovery. Candidates for classes you don't yet express, or replacements for ones you do. |

The fixed 15-fund PineScript universe is retired as an authority. It was coherent
when ranking *was* the allocator; it has no relationship to your current class set.
Members that are still relevant enter through mapping or the shortlist like anything
else.

This also closes the current three-doors problem, where a fund appears because the
legacy webhook pushed a weight, **or** because it's on the statement, **or** because
it's typed ETF in analysis — with no way to tell which.

## 4. The sidebar

Superseded by the approved [Portfolio Tools Migration](CONTEXT_PANEL_MIGRATION.md).
The earlier requirement
for a permanent four-layout ETF-only rail is retired.

The optional right panel has **ETFs, Security and Shape** views. The first-pass
Asset class addition was removed after review.
Positions retains its original single-line ETF rows, Core pinning and read-only
ratio chips. Core controls and held/target coverage stay in the sidebar. Unheld
Core funds remain in the ETF ledger, not in Positions.
Double-clicking a security in Positions opens its Security details in
the right panel without leaving Positions. Its Performance history command opens
the existing History view. Ordinary clicks do not reopen the rail.

Within ETFs, **Line Fill and Capital Map** remain. Numbers and Ring Fill are
removed. The previous compact card/header styling and chart icon are retained,
without the ETF MONITOR heading. The ledger includes selected Core funds or funds with
actual capital; unheld/unselected watchlist funds stay in Analysis and the class
Core selector. Held funds without Core selection remain visible with no invented
target. The original Sleeve Summary remains independent below every panel view.

The same ledger supplies the Positions ratio chips and optional ETF view. Alerts,
Actions and the full ETF ranking
page keep their existing responsibilities. No new policy mapping table or
multiple-fund allocation rule is introduced by this UI migration.

## 5. The ratio

**Manual base, per class; automatic momentum adjustment retained.** The Core ratio
sets the ordinary share of the class allocated to its chosen ETF. The existing
bounded momentum multiplier adjusts its effective emphasis within that class;
neither changes the approved class weight.

Where a class has more than one mapped fund, the split between them is also
**proposed, not implemented**. This build retains one explicitly selected Core
ETF per class and its existing ratio controls.

```text
core_base          = approved_class_target × core_ratio
recommended_target = core_base × bounded_momentum_multiplier
effective_target   = 0 on the existing ETF Sell gate; otherwise recommended_target
class_stock_budget = max(approved_class_target − max(effective_target, ETFs_held), 0)
```

For the future multiple-fund design, `fund_weight` across mapped funds must sum to
100%. A class with a single
mapped fund needs no setting — its weight is 100% by definition. The setting appears
only when a second fund is mapped, and mapping that second fund is what prompts for
the split.

The holdings term includes non-Core ETFs in the class. A Sell signal, de-selection,
or sale intention is not evidence that the holding has gone. Pending ETF purchases
also occupy capacity during purchase checks. Once reconciliation records a sale,
capacity may increase; cash is still independently verified from the statement.

**Unused capacity is not ring-fenced.** A zero ETF target with no remaining ETF
holding leaves the full approved class budget available to stocks. This does not
fund a different class, select another ETF, or generate a purchase automatically.

`asset_class_config.stock_allocation_ratio` is the superseded static version of the
same idea. It is no longer used by the shared sizing/ETF/purchase calculation;
the stored field and unrelated legacy consumers have not been deleted.

## 6. Momentum — Retained Adjustment And Future Evidence

The four evidence ideas below remain proposals. The earlier suggestion to retire
the automatic multiplier was declined. The existing engine and configured source
remain active; no new ranking formula, universe migration, or backtest is claimed.

The signal is real. Its current *shape* is the problem: a cross-sectional rank
normalised to 100% is an allocator output, and allocation is no longer its to do.
Each job below states what it computes and where it appears.

**a. Ratio evidence — fund vs the class's own stocks.**
Return differential between the mapped fund and your holdings in the same class over
a common window. Appears beside the manual ratio. Answers *more via fund, or more via
names* — comparing like with like, which the cross-class rank never did.

**b. Beta capture quality — tracking drift.**
Correlation and tracking error between fund return and class return. Same two series
as (a), different statistic and different question: (a) asks which performed better,
(b) asks whether they still move together. A fund that stops tracking its class has
quietly stopped being core, and nothing currently notices.

**c. Class conviction evidence at shape review.**
Fund and class absolute trend surfaced when reviewing portfolio shape, as one human
input to class weight. Deliberately not automatic: an automatic path creates a loop
where class weight sets the fund target, fund performance moves the class weight, and
the target resets. Same information, human in the loop.

**d. Opportunity detection — strong fund, absent class.**
Shortlist funds ranked by absolute momentum, filtered to classes you're underweight
or don't hold. This is where the cross-sectional rank keeps a legitimate life: as a
**discovery** ranking over candidates, not an allocation ranking over holdings.

Rank decay, model weight limits and the bounded Core multiplier are retained in
this implementation. Evaluating their financial merit is separate from unifying
the class-budget calculation.

## 7. Controls

Core selection, removal and ratio editing stay in the sidebar chip popover.
No new approval ceremony or read-only replacement is introduced.

## 8. Earlier Retirement Proposal (Not Implemented)

The list below records the earlier proposal, not current behaviour. In particular,
the model source, singleton Core policy, existing chip interactions and momentum
multiplier are retained. Only the static stock ratio is removed from the shared
budget path in this build; schema deletion and multiple-fund migration are deferred.

- `etf_allocations` as a strategy input, and the TradingView weight path that feeds it
- The fixed 15-fund universe as an authority
- `core_ticker` as a per-class singleton, replaced by a (class, fund) mapping record (§2)
- `primary_asset_class` as anything more than a hint — it never confers membership
- Core / non-core as a display distinction
- The momentum target multiplier and its allocation machinery (§6)
- `stock_allocation_ratio` as a live input

## 9. Earlier Sequence

This records the earlier branch's state. The confirmed decisions above take
precedence; do not treat its proposed retirement steps as implementation authority.

Where this actually stands, then what is left. Branch `etf-model-v3`.

### Standing

- **Shortlist.** `etf_shortlist` table, `GET/PUT/DELETE /api/etf/shortlist`,
  `GET /api/etf/unmapped-holdings`, with tests. Commit `067803c`. Not yet wired to
  any surface.
- **Sidebar rebuilt as a ledger.** One flat list sorted by the size of the gap to
  target, with four views — numbers, ring fill, line fill, capital map — and the
  Watchlist retained beneath it for classed-but-unselected funds. Uncommitted.

### To be reverted

- **One-door membership** in `buildETFAllocationLedger` (`067803c`): a fund enters
  the ledger because `primary_asset_class` is set. This rests on the §2 premise that
  has now been falsified, and against real data it admits everything. Until the
  mapping table exists, membership stays **mapping-record-or-held**, which is what
  the code did before the change.

### Remaining

1. **Mapping table.** `asset_class_fund_mappings(asset_class, ticker,
   fund_weight_pct, created_at)`, keyed on the pair, so a class can hold more than one
   fund. Backfill from existing `asset_class_etf_policies.core_ticker` rows, then drop
   that column; the policy row keeps `core_ratio_pct` and `momentum_influence_pct`.
2. **Ledger membership reads the mapping table.** `primary_asset_class` becomes a
   hint and a gap-report input only.
3. **Ratio, per-fund weights and reservation** — one source for the class split (§5).
   This is the step that makes targets non-zero; see the note below.
4. **Momentum jobs (a) and (b)** — they attach to decisions that already exist.
5. **Momentum jobs (c) and (d)** — these need surfaces outside the sidebar.

The old step "rebuild the sidebar as class rows" is dropped: §4 is now fund rows, and
that rebuild is already done.

Step 7 (where the ratio is edited) must be settled before step 3, since it decides
which screen owns the write.

### Blocking note on targets

No class currently has a Core policy row. In `buildETFAllocationLedger`,
`coreTickerByClass` is only populated inside `if configured, found :=
corePolicies[assetClass]; found`, and the loop that computes `effectiveTargetByTicker`
iterates over `coreTickerByClass` — so with no policy rows it runs zero times and
**every fund's `effective_target_value` is `$0`**.

This is not a display defect. The ETF layer is computing no targets at all. Until
steps 1–3 land, the only way to get a real target is to select a Core ETF and a ratio
per class through the existing row popover, which writes the policy row.


## 10. Asset-class provenance

*Not ETF-specific, but it surfaced here: a fund showed `Technology` in Positions
and `Civil Aerospace` in the ETF Monitor, and therefore had no target, because
its class had been assigned twice through two different surfaces.*

`stock_analysis.primary_asset_class` has four writers and, until now, no record
of which one set the current value:

| Source | Written by |
| --- | --- |
| `MANUAL` | a person — analysis tab, ETF mapping endpoint |
| `LLM_AUTO` | the auto-assign feature (declares itself via `asset_class_source`) |
| `SIGNAL` | a class arriving on an alert payload |
| `GROUP` | derived from the security's stock group |
| `HEURISTIC` | `guessPrimaryAssetClassFromIdentity` — a hardcoded ticker/name table |

### What was wrong

A precedence rule already existed — group beat everything — but it was applied
only inside `backfillPrimaryAssetClasses`, which runs once at boot and
**overwrote the stored value in place**. So the effective rule was:

- between restarts, last write wins, neither writer aware of the other;
- at the next deploy, the group wins retroactively and silently, using a group
  membership that may have been set months earlier.

The outcome of the same two actions therefore depended on whether a release
happened in between. That is what made class assignments untrustworthy.

### The rule now

Precedence is explicit, ranked, and enforced at write time:

```
MANUAL  >  LLM_AUTO  >  SIGNAL  >  GROUP  >  HEURISTIC  >  unattributed
```

**Manual outranks group.** A group is an organisational construct for looking at
holdings; it does not get to silently overrule a deliberate decision about which
class owns a security's capital. Equal ranks mean the newer write wins, so a
second manual edit still replaces the first.

- The boot backfill fills empty rows and renormalises code spellings. It no
  longer changes *which* class a row belongs to when a higher-ranked source set
  it — a decision made at boot is a decision nobody sees.
- Disagreements are reported, not resolved: `GET /api/asset-classes/conflicts`
  lists every security whose stored class differs from the one its group
  implies, with the stored value's provenance and timestamp.
- The heuristic still fills empty rows so nothing sits unassigned, but it is
  stamped `HEURISTIC` and loses to every real assignment.

### Still open

Provenance fixes the *writer* conflict. It does not fix **read-time
re-resolution**: `loadETFAssetClassMappings` re-resolves the stored class on
every read, and `matchClassCode`'s third pass matches on `ParentCode` — so a
stored parent code resolves to whichever child sorts first by `display_order`.
That can still move a fund's class at display time with no data change at all,
and it is the more likely cause of the `Technology` / `Civil Aerospace` split
that started this. It needs its own decision: drop the ParentCode fallback from
assignment resolution, stop re-resolving on read, or both.
