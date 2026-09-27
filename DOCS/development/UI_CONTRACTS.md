# UI Contracts

Audit date: 5 June 2026.

This document records user-facing interaction contracts that affect meaning.
It is not a pixel-perfect style guide. Small visual polish can change without
docs, but behaviours that affect interpretation must be documented here.

Presentation conventions and the staged cross-tab adoption plan live in
[Terminal Style Standard](TERMINAL_STYLE_STANDARD.md). Positions and Analysis
are its references; normalisation must preserve the interaction contracts here.

## Global Rules

1. Backend state owns business truth.
2. Frontend may hold draft editing state before save/confirm.
3. UI labels must use approved business language from `GLOSSARY.md`.
4. Do not duplicate the same alert name in multiple adjacent sections.
5. Do not show backend canonical codes as user-facing asset-class labels.
6. Dark and light themes must use tokens, not hardcoded white/black text.

## Top Navigation And Controls

The top app row has two conceptual areas:

1. page navigation
2. page-specific controls

They may share one horizontal band, but the controls are not navigation tabs.
Mode controls such as `Normal` / `Actions` should stay in a stable location so
clicking the toggle does not move the target.

Positions keeps the primary `Normal` / `Actions` workflow switch, one Position
View icon, and the compact `⊟` / `⊞` group-collapse command visible. Group
management, Compare / Metrics, asset-class ordering, Peek / Fixed, and row
visibility belong inside the Position View menu rather than appearing as
peer-level top-bar controls.

The header has neither the former Risk hover panel nor the trial Market regime
badge. Their removal does not change Q3/Q4 policy, Portfolio Risk actions or the
existing portfolio-shape views.

## Positions Tab

Purchase actions retain their source signal even when spending is paused. The
existing action drawer shows the backend permission/funding reason; normal
Record execution stays disabled without a funded ticket. In its chronological
ledger, an open or priority-blocked IG security purchase offers Record purchase
exception. This opens an inline form requiring units, AUD spent and a reason.
It does not submit on opening, unlock another action, or edit broker holdings.
Recorded exceptions remain visible through awaiting-statement, variance and
confirmed states. External executions retain their existing manual workflow.
The drawer uses a local 0.25rem spacing unit so form controls are not compressed
by the terminal table's 0.1rem spacing token; page/table spacing is unchanged.

Default column order:

```text
Name
Trend
Action
DCA
Value
P/L%
Class %
Ideal wt
Portfolio %
```

Column rules:

1. User column order and sizing are persisted by column identity, not index.
2. Defaults must be sane on a clean load.
3. Resizing changes only that column, including the last column. Pointer-down
   cannot change geometry, trigger sorting, or start reordering.
   Pointer capture covers mouse/touch; Escape, blur, cancellation and unmount
   discard an unfinished drag. Resizing at the scroll boundary must not feed the
   browser's scroll clamping back into the width calculation.
4. Automatic columns fill the available panel, subject to readable minima. A drag
   freezes the rendered visible widths; explicit widths remain fixed across
   sidebar/viewport changes, refreshed holdings, reordering and hide/show. Overflow
   belongs to the grid, never the page. Double-click resets one column; the Name
   menu resets all widths for that mode, including currently hidden columns.
5. Stock rows should not display `EXP%`; exposure is meaningful at class/sleeve
   level.

Ideal wt numbers remain visible, aligned with adjacent numeric cells in size,
weight and baseline. Their 2px bars reveal together across the entire Ideal wt
column when any cell or its header is hovered with a fine pointer or contains
keyboard focus. Hovering or focusing another part of a stock row must not reveal
the bars; overstretch bars remain visible at rest, including on
touch screens. The bars are positioned within a fixed-size wrapper, with no row
or text movement on reveal. Only opacity transitions, respecting reduced motion.
Class % and Portfolio % use the same independent column-hover/focus reveal for
their background fills and portfolio target markers, without header checkboxes.
Their numeric values, stats-peek visibility, sorting and resizing are unchanged.
The retired `terminal-percent-fill-columns` preference is no longer read or written.
This presentation does not change weight calculations, policy or class comparison
bars.

`ResizableGrid`, shared by `PositionGrid` and Analysis, owns sizing and pointer
state so moves do not rerender `StockTable` or `AnalysisPanel` and their security
rows. The colgroup and header share one width calculation, including
the phone's default 200px pinned Name column. Pixel preferences use
`terminal-position-column-widths-v4`; prior v3 deltas migrate once when their
columns are available. Normal, Review and Portfolio scopes remain separate, with
independent `-mobile` scopes. Null preferences record an explicit reset and prevent
legacy settings returning. No preference migration writes to the backend.

Group row rules:

Normal Positions renders only groups with remaining holdings, directly or in
descendant groups. Confirmed zero-unit, zero-value rows are excluded, but held
units with unavailable/zero prices remain visible. Watchlist-only groups and
empty parents do not create headings. Collapse-all considers visible groups
only and preserves hidden groups' saved state. This is a display filter, not
group deletion: it does not change class cash, targets, research, history or
Actions/portfolio reconciliation evidence. A Sell signal or recorded execution
is not itself confirmation that the holding is gone.

1. Parent display groups may use human names such as `Materials`.
2. Allocation leaf groups must link to canonical `asset_classes.code`.
3. Asset-class rows may show current/target context in the name cell:

```text
Gold Miners (14) 22.1% / 30.0%
```

4. Portfolio tab rows should not blindly inherit the same position-row target
   extension if it duplicates portfolio-specific context.
5. In normal grouped Positions mode, `Compare` replaces the aggregate metric
   cells with approved Target and live Now bars on a shared scale. `Metrics`
   restores the original aggregate cells.
6. A missing approved target must remain visibly distinct from a zero target.
   The comparison is read-only and must not alter portfolio business state.
7. Asset-class ordering is independent of stock-column sorting. Supported
   orders are saved order, approved Target %, live Current %, and absolute
   Drift. Missing values sort last and ties retain saved order.
8. Broker artifacts marked `CVR` or `NON_ALLOCATING` are hidden from the normal
   hierarchy. The Position View menu can reveal a separate excluded-instruments
   section so the classification remains reversible without entering portfolio
   totals, groups, targets, or actions.

Peek behaviour:

1. Stock rows are normally primary.
2. Hovering group rows can reveal group-level cells and dim stock rows.
3. Collapse/expand controls should switch state immediately, without hover fade.
4. Q1 row visibility must remain independently controllable.

## Actions Tab

Workflow sections:

1. Active Actions
2. Alert Type
3. Selected Sleeve
4. Workflow

Rules:

1. The specific trigger is the action name: `Q3 Detector`, `Q4 Crisis`,
   `New Portfolio Target`.
2. The broad family is the alert type: `Portfolio Risk` or
   `Portfolio Rebalancing`.
3. Selected Sleeve owns required/recorded/remaining metrics.
4. Workflow owns step state and primary action buttons.
5. Avoid explanatory paragraphs where the data and step labels already explain
   the action.

## Alert Stack

Alert Stack is an attention surface, not an execution backlog. Managed action
chips are limited to one current instruction or review issue per security or
shared class scope. Recorded executions and blocked later signals remain in
History, without reappearing as chips. A statement mismatch returns as a review
item; unresolved exits retain their protections. This does not change backend
ordering, reconciliation or cash availability. See the
[action contract](../system/SIGNAL_AND_ACTION_CONTRACT.md#alert-stack-and-decision-history-2026-09-11).

Sections:

1. Portfolio Risk
2. Position Alerts

Position alert groups use short labels from asset-class presentation metadata
and colours from the shared [Asset-Class Visual Identity](../system/ASSET_CLASS_VISUAL_IDENTITY.md)
registry plus saved class-colour overrides. The header palette menu's
**Asset class colours** editor saves one class at a time and offers a per-class
reset. Choices also apply to historical charts and do not alter signal colours.
Legacy `alert_color` values no longer override Terminal class colours.
Individual cards should show:

- company name
- ticker
- alert/action label
- P/L or signal context where available
- age
- chart link
- dismiss control

In the mobile Alert Stack drawer, position cards use explicit padding and
content-driven text heights, not dense-shell spacing utilities for line height.
Long names and signal details wrap without clipping. Expanded groups are not
capped at 900px, so every alert remains reachable through the stack's scroll area.
These spacing rules leave desktop cards unchanged.

The dismiss control is not available for an open **Exit**. Exit requires either
recorded execution followed by statement confirmation, or an explicit retained-
position override that remains visible as unresolved risk.

## Alerts Tab

Alerts is the TradingView connection surface. It retains the stock CDF/TMS
monitor, generic Q3/Q4/CTF detector registrations, and a matching
**Commodity Connections** table.

Each commodity market has exactly two CDF checkboxes: its physical commodity
chart and its producer-equity / commodity trend chart. Both persist in
`active_alerts`, like Stock Connections. Checking an unconfigured feed first
requires the user to select its current CDF `BUY` or `SELL` direction. The
setup atomically records that baseline and the matching connection. A checked
box confirms the matching TradingView alert exists; it is not inferred from a
received event and it does not display market direction, allocation, or a trade
action. Direction belongs to Markets.

Stock Connections adds one **Outperform** checkbox for non-ETF securities whose
asset class has a configured commodity-equity benchmark. Its initial setup uses
the same explicit `BUY` or `SELL` baseline and records the security / core-fund
ratio in `active_alerts` with an append-only Outperform state event.
Generic CTF remains a separate portfolio detector registration and does not
replace these scoped CDF connections.

## ETF Monitor

The right-rail ETF Monitor is a compact status and navigation surface.

It should show:

- actual ETF exposure against the approved effective Core ETF target
- the whole-book ETF suggestion as a separate planning reference, never as a
  deficiency or forced allocation gap
- current actual ETF exposure
- target ETF exposure
- tactical momentum rows
- mapped asset class where known
- BUY/SELL block state

It should not try to explain the whole ETF allocation ledger. Its **ETF
allocations** title is the link to the dedicated ETF allocation page (`#/etf`),
with an arrow beside it; there is no separate footer link. When the rail is
too narrow for the arrow it is hidden first, and the title shortens only when
the text itself cannot fit. The summary's held amount is 18px (target 14px);
fund rows keep 12px amounts.

The **Portfolio summary** footer (formerly Sleeve Summary) has two compact views:

1. **Show current portfolio shape** is the default: one ring sourced exclusively
   from saved approved `weight_pct` values, including approved classes with no holdings.
   Values remain percentages, are not converted to dollars, and partial totals are
   not renormalised. Its only routine caption is `Approved vN · DD/MM/YYYY`.
2. **Compare with current allocation** adds holdings as an inner ring, keeping the
   approved outer ring and primary percentages. Secondary Held values show actual
   allocations. Returning to Shape removes holdings rather than switching to an
   actual-only chart. There is no actual-only mode in this widget.

Without an approval, show **No approved shape**, or **Approved shape unavailable**
on retrieval failure; never substitute holdings. A saved approval remains visible
if refreshing fails. Stale/failed current reads cannot create zero holdings or a
fabricated current difference in comparison. Ring instructions stay out of the
visible layout. The approved ring has full colour strength.

The list control shows or hides the legend for either view; it is not a separate
Weights mode. The Positions shape-strip control toggles that independent footer.
The chart geometry, dock and allocation policy are unchanged.

The Portfolio overview joins approved and held classes, including unfilled targets
and off-shape holdings. Ribbons, table, comparison ring and Positions comparison
strip order by approved weight with canonical-code ties. Holdings movement cannot
reorder this reference; Difference mode may sort by absolute difference and Radial
keeps its fixed canonical axes. Colours come from the shared class identity.
No source percentages are rescaled. Approved classes are never filtered out merely
because they have no holdings.

The current approved shape opens alone by default, including on returning to
Portfolio from another tab. Its primary ribbon, row bars, cumulative values and
Per $1K always follow approved weights. **Compare** is a stable-label toggle:
selected adds the current-holdings ribbon, markers, Held/Difference columns and
implementation state; unselected removes those comparisons, never the approved
shape. Selecting Difference enables comparison; switching comparison off there
returns to Shape. Missing approval never substitutes held allocations as a shape.
Switching the display does not change any targets. The Positions comparison strip keeps
both numbers visible with approved first. Actual Positions rows, totals and
performance do not change. Independent mix reads keep saved approvals visible
when current holdings fail; differences and capacity evidence are withheld when
current holdings are unavailable or stale.

Label the two Portfolio ribbons **Approved** and **Current holdings**. Both use
the same 46px height so their two lines of text remain inside the bar. Segment
dividers must fit inside percentage widths, not add gaps beyond the 100% track.
Keep toolbar height intrinsic when its controls wrap. On mobile, the overview
uses one scrolling column so wrapped controls and ribbons cannot collapse the
class table to zero height. The toolbar keeps the fixed **Portfolio shape**
title without view-dependent subtitles. Button positions, dimensions and row
arrangement must remain unchanged at a given panel width across Shape,
Cumulative, Difference, Radial, and history comparison. Only a change in
available width may reflow the toolbar. Do not add
dates, totals, class counts or explanatory captions around the ribbons. Approval
metadata already lives in the summary rail. Concise missing/stale/incomplete-data
warnings remain conditional, never routine chart instructions.

3C must use `/portfolio-mix/approved` and `/portfolio-mix/current`; it must not
substitute ETF targets, momentum weights, or locally inferred trade actions.
Reserve closes genuine unallocated whole-portfolio capacity. Missing approved
data must remain visibly unavailable rather than becoming a zero target.

## Portfolio Timeline Navigation

Timeline renders inside the persistent Portfolio overview shell. The analytic
and comparison controls remain available, Timeline alone is selected as the
workspace, and its header includes a visible Back button. Clicking the selected
Timeline button again closes it, as does Back. Both restore the previous view
and comparison state; choosing an analytic mode returns
directly to that view. The overview's value rail and action footer stay hidden
in Timeline, preserving its full-width layout.

The snapshot strip contains approvals, target drafts and saved memos. Remove
type-filter/count tabs, the example flask and the refresh tool from this
surface. Broker observations remain available as comparison records. Opening
Timeline loads its archive; browsing never creates approvals or synthetic data.
Archive-wide Intelligence warnings do not occupy the page header. Individual
linked-memo failures stay in the memo reader; terminal-history errors and an
unavailable empty archive still offer targeted retry actions.

On selection, align the preceding snapshot to the left edge so the selected
snapshot is second from the left. The first snapshot has no preceding item.
Trailing scroll space preserves this placement for the last item; responsive
record widths fit both neighbours even on a narrow screen. Recalculate on
container resizing, without forcing the user to use navigation arrows.

## Portfolio Radial View

- **Radial** is an additional Portfolio overview mode beside Shape, Cumulative
  and Difference. Existing modes and the approval workflow are unchanged.
  Radial replaces the linear ribbons and table within that mode only.
- It consumes the same `PortfolioOverviewRow` data prepared by
  `portfolio-shape-view.tsx`: `current` is observed whole-portfolio weight;
  `target` is the approved class percentage. It does not use ETF momentum,
  research suggestions or Q3/Q4-constrained capacity as the approved shape.
- Each existing asset class, including Cash/Reserve, gets one spoke. Axis order
  is canonical class-code order, independent of current weights and input order.
  No invented aggregate classes or renormalization of partial totals are allowed.
- **>2% classes** is an optional display filter, off by default. It retains a
  class when held **or** approved weight is strictly greater than 2%, even when
  the approved overlay is hidden. Unknown holdings remain visible rather than
  being classified as negligible. The filter shows its class count and actual
  portfolio coverage; retained weights are not rescaled to sum to 100%.
  Removing spokes redistributes their angles, retaining relative class order;
  the percentage scale stays the same. Compare shapes with the same filter.
- Radius is linear percent of the total portfolio. One labelled scale covers
  both held and approved values, including when the overlay is hidden. The scale
  can grow with the data. Historical approved-shape comparison uses the
  separate read-only mode below, with an archive-wide scale and class universe.
- Flat class-colour tints at 24% opacity show the approved polygon by default on the shared
  Analysis row surface. No radial gradients, glow or separate chart palette;
  the surface, grid and text follow the active terminal theme. Its continuous
  outline has rounded joins and small markers. A blue dashed outline and a
  hollow marker on the inspected class distinguish current holdings without
  obscuring every approved vertex. With comparison off, only the approved
  polygon and approved readout remain visible.
  Historical comparison keeps its existing From/To roles. Colour is identity, not a
  performance or trading instruction. Polygon area is not portfolio value.
- **Compare** adds current holdings to the approved shape. Missing targets remain gaps;
  an explicit zero remains a real zero. Partial targets are labelled partial
  and are never filled into a complete polygon. Stale or unavailable holdings are
  withheld without removing the saved approved polygon.
- Pointer inspection and an accessible class selector expose held percentage,
  approved percentage and their percentage-point difference. Full asset-class
  names remain on the spokes at every width. Labels wrap to measured text widths;
  side-label columns are spaced without overlap and dense label sets receive
  more vertical room. Narrow layouts must not replace names with numbers or
  shrink label text. The class selector also uses names without numeric prefixes.
- Implementation: `lib/portfolio-radial.ts`,
  `components/stock-table/portfolio-radial-chart.tsx` and its CSS module.
  Model tests: `tests/portfolio-radial.test.cjs` cover ordering, scale, missing
  versus zero, partial totals, empty data, geometry and pointer selection,
  threshold filtering, portfolio coverage and closed/gapped outline paths.
- Local verification: 18 populated classes, overlay toggle, class selection,
  original view switching, and light/dark colours. DOM bounds checks at 320,
  390, 736, 1024, 1440 and 1920px found no overlapping chart labels or document
  horizontal overflow. Existing root theme-attribute hydration warnings remain
  outside this change. Backend, database and deployment configuration remain
  unchanged.

## Historical Shape Comparison

- **History** switches the existing Portfolio analytic views to saved
  approved allocations. Its label stays the same, with highlight and
  `aria-pressed` matching historical mode. Both comparison buttons always remain
  visible. During history mode, **Compare** is unselected; clicking it
  exits history and enables approved-versus-current comparison without changing
  the analytic view. The history header has an explicit **Back** button that
  exits history and restores the previous live comparison setting, including
  when the archive is empty, loading or unavailable. Turning history off does
  the same. Sidebar preferences and the approved target are untouched.
- One From/To pair persists across Shape, Cumulative, Difference and Radial.
  Defaults are the two latest loaded approvals. Dated/versioned selectors and
  previous/next arrows enforce From before To, including same-day approvals.
  Refresh and loading earlier pages retain selected snapshot identities.
- **Shape** shows paired class bars. **Difference** is `To - From` in percentage
  points; it does not apply current Q3 capacity, trade instructions or a
  gain/loss colour rule. **Cumulative** ranks each snapshot independently and
  compares the share assigned to its top N classes. It requires complete shapes.
- **Radial** uses the later approved shape as a flat class-colour fill and the
  earlier approved shape as a dashed outline. Full names and exact From/To/Change
  values remain available. All views retain whole-portfolio percentages.
- The class universe and weight scale are derived from the loaded archive,
  not reordered by each selected date. Current display names may be reused;
  colours always come from the canonical code-keyed palette, including its
  deterministic custom-class fallback. `>2% classes` retains a class if any loaded approval
  exceeded 2%, or a loaded record has unavailable coverage for that class.
  This keeps the radial spokes stable when stepping dates. Explicitly loading
  older pages or refreshing can expand the comparison universe/scale.
- Existing catalogue and portfolio-taxonomy aliases align legacy names such
  as GOLD with GOLD_MINERS. Physical commodities remain distinct from miners.
  Unknown/custom classes are retained, never assigned to Broad Equity merely
  because taxonomy resolution fails. Ambiguous catalogue aliases remain distinct.
- A complete shape has unique valid allocations totalling 100% within 0.01pp.
  An absent class in that complete allocation is zero. In an incomplete shape,
  an absent class remains unavailable and its change is not calculated. Invalid
  or duplicate raw class rows remain unavailable; known distinct legacy aliases
  for the same sleeve are aggregated. No partial total is rescaled to 100%.
- Only completed approved snapshots participate, never proposed memo weights,
  draft targets or broker holdings. An empty/single-approval archive is explicit.
  Fetch failures expose retry without discarding previously loaded history.
  The live rail remains labelled **Current portfolio value**; the historical
  chart has no live Portfolio attention/actions projection.
- Uses the filtered, cursor-paginated `/api/portfolio-history?kind=shape` read.
  A pre-update backend can supply approvals from its recent mixed records; the
  comparison explicitly says that archive is limited and offers no false
  full-history pagination. No database writes or new schema are required.
- This phase compares approved intention over time only. Historical holdings
  and comparison against the target effective on an observation date remain
  the next phase. Weight changes must not be labelled investment returns.

## History Tab

### Portfolio shape confirmations

- The **Asset class weights** chart plots durable portfolio-weight history and overlays approved portfolio-shape confirmations from `/api/portfolio-history`.
- Both the current `APPROVED` shape and historical `SUPERSEDED` shapes represent completed approvals. They appear at their exact approval timestamps as `APPROVED vN` labels on the chart x-axis.
- Draft targets, Council memos, and analysis runs do not create confirmation markers. Approval is the boundary that changes the portfolio-shape policy.
- A confirmation marker explains when the target mix changed; it does not assert that the holdings were rebalanced at that instant. The weight series continues to show the observed implementation path after approval.
- Hovering an approval line or its version label opens a read-only preview of that snapshot's saved asset-class percentages, approval date/time, version and recorded total. Click/tap pins the preview; Escape, outside click or its close button dismisses it. Keyboard focus opens it, and Arrow Down moves focus into the preview.
- Preview data comes from the approval entry's stored `rows`, never today's holdings or the currently active target. Superseded approvals retain their own allocation values. Missing, invalid and duplicate allocations are unavailable; partial totals are explicitly labelled and never rescaled to 100%.
- A compact stacked shape bar above the preview's asset-class headings uses the same saved percentages, descending order and colours as the list. Partial totals leave an empty remainder; unavailable or over-100% totals do not render a misleading bar. The list remains authoritative and shows the recorded values.
- The preview automatically shows the immediately preceding loaded approval above the selected approval, with dated/versioned shape bars and only one extra **Previous %** column. Both bars have the same width and horizontal origin, and share the list's class order and colours; no delta column or duplicate class list is added. Approval pairing happens before the chart's date filter, and never crosses real/demo history. There is no comparison toggle; if no earlier approval is available, the preview shows only the selected approval. Added/removed classes remain in the shared list; absent weights mean zero only for a complete saved shape, otherwise unavailable. This compares approved policy, not pre-trade holdings.
- The theme-aware preview is portalled outside the chart so table/sidebar overflow cannot clip it. Only one approval preview is open at a time, and the observed-weight tooltip is suppressed while inspecting an approval. No approval, trade, or target mutation is performed.

### Demo History

- **Demo history** in History > Portfolio switches only this performance panel to
  a frozen sample year (9 September 2025 to 9 September 2026). It is available
  only on localhost/loopback and `alpha-edge-uat-frontend.fly.dev`, never the
  production hostname. It is off by default and resets on reload.
- `lib/portfolio-history-demo.ts` stores eight synthetic approvals across the
  application's 18 existing asset classes, plus 58 simulated observations. Each
  approved allocation totals 100%. Observations gradually follow the last known
  approval and vary between dates; they do not reconstruct real trades or returns.
- The sample is versioned with the frontend as an isolated fixture, not inserted into `portfolio_mix_snapshots`, statements, holdings,
  performance tables or memo records. No fixture API or backend write is used.
- Demo labels, the date range and hover previews identify the data as simulated.
  Real signal events are excluded from the demo chart. The live header and both
  sidebars remain untouched; Positions, Stock History and portfolio policy never
  consume the synthetic records.
- Demo starts at **All**, with its own temporary date-range selection. Switching
  off restores live data and its saved range; it never persists a demo preference
  into the real History settings. The demo weight scale remains 0-100%.

History has separate modes:

1. Signals / Decisions
2. Performance
3. Stock History

Stock History should be reachable by:

- double-clicking a position name in Positions
- selecting from the stock selector in History

Events on charts need real labels, hover detail, and a legend when more than one
event type is visible.

## Analysis Tab

Column resizing uses the same `ResizableGrid` pointer, cancellation, keyboard,
reset and persistence mechanics as Positions. Preferences use
`terminal-analysis-column-widths-v1`, with separate `analysis` and
`analysis-mobile` scopes; they cannot overwrite Positions widths. Saved widths
are keyed by column identity and survive hide/show, notes expansion, data
refresh and navigation. Only the grid scrolls when the saved widths exceed the
panel. Name-header ticker controls and sorting are separate from the resize
boundary. The column menu includes a reset for all Analysis widths in the current
desktop/mobile scope, including hidden columns. No research values or backend
settings change when adjusting the layout.

The analysis table should keep identity fields separate:

```text
Ticker
Tags
Name
Asset Class
...
```

The name cell should not carry ticker, tags, watch status, and editable class
state all at once. Heavy thesis or chart content should load on demand, not for
every row on initial render.

Analysis hides `CVR` and `NON_ALLOCATING` rows by default. Its excluded-
instrument toggle reveals them under a non-allocating section for inspection or
restoration; revealed rows remain ineligible for target-weight sizing.

The shared **Momentum** column uses comparable evidence with instrument-specific sizing:

- stocks and ETFs display and sort by the same six-month adjusted-close return
  (`performance_6m_pct`), retaining ETF-first grouping;
- stocks may reveal the separate stock sizing modifier on hover;
- stocks and ETFs share sign-only return colours: buy/green above 0%,
  sell/red below 0%, neutral at zero;
- ETF momentum remains visible on hover because no stock sizing modifier applies;
- missing/non-finite six-month history renders a centred dash, never an
  80-session fallback; zero is a valid return;
- both instrument types retain price-date and stale-data details on hover;
- the ETF Ranking view's 80/240-session engine, scores and allocations are unchanged.
