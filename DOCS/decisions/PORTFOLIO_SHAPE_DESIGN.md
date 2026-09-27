# Portfolio Shape — Design Exploration

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

*Document for design review and brainstorming. Written for Claude Design.*

Class colours now follow [Asset-Class Visual Identity](../system/ASSET_CLASS_VISUAL_IDENTITY.md).
Current, target and historical shapes use the same code-keyed palette. Earlier
mockup palettes are design references, not separate colour authorities. Return,
risk and target-difference colours retain their existing semantic meanings.

---

## The Core Problem

The portfolio has two kinds of truth at once: **shape** (what percentage of capital sits in each asset class) and **positions** (the individual stocks that produce that shape). The current UI treats both as equal citizens on the PORTFOLIO tab, which means neither reads cleanly.

The positions list is already on the POSITIONS tab. Repeating it on PORTFOLIO without the shape comparison wastes the tab entirely — the user lands there and sees a table they already have elsewhere, without the thing they actually came for.

**The shape is the immutable object. Positions are its implementation.**

---

## What "Shape" Means

At any point the portfolio has:

- A **current shape**: the actual weight of each asset class, derived live from holdings
- A **target shape** (optional): an approved snapshot of intended weights, set deliberately by the user

The gap between these two is the portfolio's **drift** — which classes are overweight, which are underweight, which are in-line. This drift is the most actionable signal on the tab and it should be immediately legible without any interaction.

---

## Implemented: Portfolio Overview v3

The PORTFOLIO tab opens to an operational overview of the current shape, its
latest approved target, and the constraints governing implementation. It does
not duplicate the Positions table and it does not create a second action queue.

The overview uses four coordinated surfaces:

1. A narrow, collapsible summary rail containing portfolio value, asset-class
   count, approved-target date, estimated rebalance turnover, target-difference
   counts, the largest differences, and the current portfolio-level
   implementation state.
2. A permanent current-portfolio ribbon and an optional approved-target ribbon.
   Both use the same asset-class ordering and colour identity.
3. One asset-class ledger with three interchangeable readings: **Shape**,
   **Cumulative**, and **Deviation**.
4. A collapsed **Portfolio Attention** section containing read-only exceptions
   derived from the same target and overlay evidence.

### Portfolio 2 Retirement

The experimental **Portfolio 2** surface has been retired. Its shape ledger,
target comparison, portfolio bands, and summary functions are superseded by
the canonical Portfolio overview and timeline. Its separate Needs Review queue
and frontend-derived market-gate calculations are deliberately not retained:
Actions remains authoritative for execution, while implementation constraints
come from the portfolio overlay.

Legacy `#/portfolio2` links and saved `PORTFOLIO2` tab preferences migrate to
`PORTFOLIO`. The canonical Portfolio surface loads current and approved shape
data directly in both overview and target-workflow modes, polls while active,
preserves the last valid data when refresh fails, and exposes an explicit retry
control. The former sleeve decomposition may be reconsidered later as a focused
enhancement to asset-class row expansion; it is not a separate product surface.

The summary rail is deliberately compact because the terminal already has the
global Alert Stack and ETF Monitor sidebars. Timeline remains full width and
does not show this overview rail.

### The Three Ledger Views

- **Shape** shows the live asset-class weight. When approved comparison is
  enabled, the approved weight is a white marker and the difference between
  current and target is visually distinct.
- **Cumulative** ranks the held shape and shows how quickly the portfolio fills
  as successive asset classes are added. This is the in-ledger concentration
  staircase; it is not repeated in another sidebar.
- **Deviation** uses a zero-centred percentage-point scale. An above-target
  portion is solid. A below-target portion that the overlay permits is solid;
  any remaining constrained portion is hatched. This prevents a strategic
  shortfall from being misrepresented as immediately deployable capital.

Rows can expand to show the held securities that currently implement the asset
class. Holding-level actions remain owned by Positions and Actions.

### Target Difference Is Not an Instruction

The UI preserves three separate quantities:

- **Approved target**: the strategic portfolio shape.
- **Current holding**: statement-derived capital presently in the class.
- **Permitted implementation**: the amount allowed by current Q3/Q4 and overlay
  controls.

Accordingly:

- below target does not mean buy;
- above target does not mean sell;
- Q3/Q4 changes implementation permission, not the approved shape;
- Q4 suspends new deployment, while reductions and exits remain active;
- no approved target means there is no target difference or portfolio-attention
  classification;
- stale current data suppresses current/difference conclusions;
- the Actions workflow remains authoritative for trade execution.

Estimated turnover is `0.5 × Σ |current weight − approved weight|`. It is a
minimum two-sided movement implied by the two shapes, not an order quantity.
The tolerance for classifying a row as within target is currently ±0.5
percentage points.

The footer retains **New Portfolio Target** (enters workflow mode) and **Run
Portfolio Analysis**. Portfolio Analysis creates reviewable evidence and never
silently changes the approved target.

### Portfolio Timeline

The Portfolio header switches between **Overview** and **Timeline**. Overview
remains the default operational shape comparison. Timeline is the historical
inspection surface the portfolio previously lacked; it is not another target
editor.

The timeline presents one chronologically ordered ledger across four distinct
records:

- **Analysis**: saved Portfolio Memos produced by Portfolio Analysis.
- **Target**: proposed portfolio-rebalance plans, including their source memo
  when applicable.
- **Approved**: immutable approved portfolio-shape snapshots.
- **Actual**: statement-derived asset-class allocation snapshots, including
  residual cash.

Timeline is a full-width historical workspace. The operational Portfolio Value
rail and target-workflow footer belong to Overview and must not appear in
Timeline. The historical workspace provides four interchangeable readings of
the same durable records:

- **Stated**: horizontally browsable **Shape, Stated** cards following the 2A
  portfolio-design structure.
- **Bars**: the compact chronological ledger in which every record retains its
  proportional portfolio-shape bar. This preserves the original high-density
  history view.
- **Staircase**: the design handoff's **Concentration Staircase**, ranking asset
  classes by weight and showing cumulative portfolio concentration. When an
  approved shape exists at or before the record date, its cumulative position
  is shown as the white comparison tick.
- **Memos**: a first-class in-app reader for historical Portfolio Analysis
  memos, including executive summary, analyst assessment, chairman conclusion,
  and the explicit Create Target handoff.

The Stated, Staircase, and Memo views support optional allocation ribbons. The
ribbon toggle changes presentation only and is not persisted as portfolio
state. A Stated card preserves its stage, status, source, identifiers, and
recorded date, then presents:

- a proportional asset-class ribbon for immediate visual comparison
- taxonomy-backed group headings and the actual asset classes beneath them
- recorded weight, historical dollar value, and dollars per $1,000
- a compact one-line statement of the largest sleeves

Horizontal views use scroll snapping and previous/next controls. Bars remains a
vertically scrollable high-density ledger. Filters and visualization selection
alter only presentation. Group headings come from the existing portfolio target
taxonomy; the timeline must not invent allocation buckets solely for display.

The dollar column uses the latest broker portfolio snapshot available at or
before the record date. The API returns that timestamp as `value_basis_at`.
When no historical basis exists, the value is explicitly unavailable; the UI
must never apply today's portfolio value silently to an older shape. Recorded
weights are not normalised to hide bad source data. Totals outside 100% are
shown as exceptions.

Portfolio Analysis has an explicit progress state on this page. Completion
creates a durable memo and a review prompt, never a target draft. Historical
memos are owned and readable by Alpha Edge; the Intelligence service is not the
only inspection surface. **Create target** is an explicit action available from
a completed memo and hands off to the existing target workflow. This preserves
the authority sequence:

`Analysis evidence -> user review -> target proposal -> approval -> broker action -> statement-derived actual`

### Positions Asset-Class Comparison

The normal POSITIONS view provides a compact **Position View** menu beside the
Normal / Actions workflow switch. The menu owns the **Compare / Metrics** mode,
asset-class ordering, row behavior, visibility, and group management. Expand /
collapse remains an adjacent `⊟` / `⊞` command because it
is a frequent table action rather than a display preference. These secondary
display controls do not compete with navigation in the top bar. Compare is the
default view for grouped asset-class rows; Metrics restores the previous Cash,
P/L, Class %, and Portfolio % aggregate cells.

Compare mode replaces only those aggregate cells with a compact, right-aligned
3A comparison instrument. It does not draw a row-wide track. The instrument
uses two untracked 5px bars inside a 36px asset-class header:

- **Target** is the latest approved portfolio-shape weight.
- **Now** is the live invested asset-class weight derived from holdings.
- Both bars use one scale calculated across the visible asset classes, so their
  lengths remain comparable between rows.
- The right edge reports percentage-point drift and distinguishes overweight,
  underweight, and in-line classes using the established portfolio colour
  language.
- A missing approved target is shown as **No target** and its target bar is
  omitted. It is not interpreted as a zero-percent target.

Asset-class ordering is independent of stock-column sorting. The menu supports
saved order, approved Target %, live Current %, and absolute percentage-point
Drift. Selecting the active numeric order reverses its direction. Missing
targets remain last in either direction; ties retain saved group order. Parent
wrappers stay in governance order while their asset-class children sort within
the wrapper.

The mode is a local display preference and does not change portfolio state,
targets, actions, or allocations.

---

## Approaches Worth Exploring Further

### 1. Shape Overlay on the Positions Tab (Hover Panel)

**Status**: Superseded for the primary comparison by the persistent Compare mode
described above. A hover panel may still be useful later for deeper funding and
workflow detail, but it should not duplicate the two-bar comparison.

**Why valuable**: Users spend most of their time on POSITIONS. Bringing shape context to them in-context removes the need to switch tabs to understand drift. The panel disappears on mouseout, so it doesn't add permanent visual weight.

**Implementation note**: The existing `hoveredPortfolioAssetClassCodes` state and `setHoveredPortfolioAssetClassCodes` are already wired in context — the hover event is already tracked. A `PositionGroupShapeTooltip` component could read from `overlaySummary.asset_classes` and `approvedPortfolioMix.rows` to render without any new data fetching.

---

### 2. Inline Drift Indicator on Group Headers

**Idea**: Each asset class group header in the positions table gets a subtle pill or mini-bar: `33.7% → 35.2% (+1.5%)`. No interaction needed — it's ambient information.

**Why valuable**: The user sees drift while scanning their positions without switching contexts. Overweight classes get amber tint, underweight get a cool tint, in-line get neutral. This makes the drift physically legible in the layout where positions live.

**Implementation note**: `overlayRowsByCode` already maps asset class codes → overlay rows with `target_weight_pct`. The group header render function (`renderGroupBranch`) receives the asset class code and could look up the delta inline. CSS variable colour tokens (`--signal-buy`, amber, sky) already exist.

---

### 3. Shape Ring / Radial View (3C Group Dial)

**Status**: Implemented as the comparison toggle in the right-rail Sleeve
Summary widget.

The dial deliberately answers a broader question than the ordinary composition
pie. Its outer ring is the latest approved portfolio-shape snapshot and its
inner ring is the current statement-derived portfolio mix. Both use the same
starting angle, block order, colour identity, and whole-portfolio percentage
basis. The adjacent four-row ledger reports Target, Now, and percentage-point
Difference.

The comparison uses the same asset classes, order, colour identity, and labels
as the approved Portfolio Shape and the ordinary composition wheel. It must not
invent display-only buckets such as `Satellites`, because those categories do
not exist in portfolio policy and prevent a direct comparison with the rest of
the application.

Cash/Reserve appears only when the portfolio-mix source contains an explicit
Cash row. The dial does not manufacture a residual Reserve slice and does not
re-normalise asset classes to conceal a source total below or above 100%.
No-data is kept distinct from a 100% Reserve portfolio. A missing approved
snapshot leaves the outer target track empty and is explicitly labelled; it is
never interpreted as a zero target.

The implementation is SVG, not Three.js. A canvas/3D dependency would add
rendering and interaction cost without improving a two-dimensional allocation
comparison.

---

### 4. Shape on the Analysis Tab

**Idea**: The analysis tab header or sidebar shows a compact shape indicator — a mini horizontal stacked bar showing current class weights. When `classBudgetsApplied` is true, the Target Weight column already shows anchored dollars; the mini shape bar would let users see why a class has the budget it does without leaving the tab.

**Why valuable**: When a user is in analysis mode evaluating a BUY candidate, the question "how much room does this class have?" is immediately relevant. Showing the shape in-context reduces the need to flip to PORTFOLIO to check.

**Implementation note**: A `<PortfolioShapeMiniBar />` component: a single narrow `<div>` with segments for each asset class, proportional widths, colour-coded by drift. The data is already loaded via `overlaySummary` which polls on the ANALYSIS tab.

---

### 5. Target vs Current Delta Column in Positions Table

**Idea**: A new column in the positions table (visible only in PORTFOLIO workflow mode) showing how much the stock's current allocation deviates from its target allocation, as a dollar or percentage delta.

**Why valuable**: In workflow mode the user is trying to close gaps. Showing per-stock delta makes it immediately obvious which positions to add to and which to trim, without mental arithmetic.

**Implementation note**: This requires a per-stock target allocation, which is currently derived from `portfolioRebalanceRows`. The row has `current_weight_pct` and `target_weight_pct` at the class level. Per-stock allocation would need a pro-rata split within the class, or a saved per-stock target weight in the rebalance plan.

---

### 6. Shape as the Tab Icon / Status Indicator

**Idea**: The PORTFOLIO tab label (or a small dot next to it) gets a colour-coded status: green = portfolio is in-shape (all classes within ±1%), amber = drift exists, red = significant drift or no target set. This appears even when the user is on another tab.

**Why valuable**: The portfolio's shape health becomes ambient information across the entire terminal. Users see at a glance — without switching tabs — whether attention is needed.

**Implementation note**: Requires computing a single aggregate drift score from `approvedPortfolioMix` vs `portfolioMix`. Could be as simple as "any class >2% off target → amber". The tab renderer already conditionally renders badges on tab labels for other signals.

---

## Design Principles to Hold Onto

**Shape is primary, positions are secondary.** The PORTFOLIO tab's job is to show shape. The positions list is a workflow tool invoked on demand.

**Drift should have colour language.** The amber/sky/green system (overweight/underweight/in-line) should be consistent across every surface where drift appears — shape view, positions tab indicators, analysis tab, everywhere.

**No required interaction.** The best shape information is visible without clicking anything. Hover panels and collapsible details are additive, not gatekeeping.

**Regime-aware.** The regime overlay already affects what can be deployed. Shape views should reflect regime constraints — in REDUCE mode the headroom is zero and the shape view should communicate that the target gap cannot currently be closed, not just show the delta.
