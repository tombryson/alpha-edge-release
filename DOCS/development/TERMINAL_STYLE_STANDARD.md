# Terminal Style Standard

## Thesis

Alpha Edge is a working trading terminal, not a collection of dashboard demos.
The user should recognise the same hierarchy, controls and state language when
moving between positions, research, allocation, market gates and history.
Information density comes from alignment and grouping, not tiny text. Colour
communicates identity or state, not decoration. The important item in a row is
its subject and current evidence; the surrounding interface stays quiet.

Positions and Analysis are the visual references. Preserve their existing
appearance. Reuse their principles without copying every historical
CSS exception or forcing every page into a stock table.

## Reference Surfaces

Reference surfaces and their source:

| Reference | Established pattern | Boundary |
| --- | --- | --- |
| `components/stock-table/position-grid-styles.tsx` | 13px / 400 body text, 500 parent labels, parent background `--panel-bg-alt`, restrained row hover, aligned numeric columns | Its broad descendant selectors and 10px table labels are not a new global standard. |
| `components/stock-table/analysis-panel.tsx` | Distinct hierarchy bands, 2.55rem hierarchy rows, compact 28px security rows, indented identities, contextual left-edge tools | 1.4rem / 200 lowercase hierarchy headings are an intentional Analysis variant, not an instruction to lowercase every application heading. |
| `components/stock-table/analysis-toolbar.tsx` | Compact icon commands, separate view controls, contextual search, colour attached to tool purpose | Keep native symbols/tickers and existing command semantics. |
| `app/globals.css` | Shared theme variables, system sans font, semantic colours and theme-switch suppression | Local page palettes must not override theme changes. |

## Rules

For narrow-screen exceptions and their verification boundaries, see
[Mobile Responsiveness](MOBILE_RESPONSIVENESS.md). Desktop remains the reference;
phone layout does not change financial semantics or saved desktop preferences.

### Typography

- System sans for interface labels, subjects and values. Use tabular numerals
  for amounts and percentages; a separate monospace brand is not needed per tab.
- Normal row data: 13px, weight 400, comfortable line height (about 1.5).
- Row/group subjects: 13-14px, weight 500. Page/section titles: 15px, weight 500.
- Secondary metadata and column labels: 11-12px. Primary state or actions must
  not be relegated to 8-10px captions. Chart micro-labels are a separate exception.
- Sentence/title case for prose and controls; preserve ETF, Q3, Q4, ticker codes,
  and approved signal names. No artificial tracking to make small text important.
- No viewport-scaled font sizes and no new forced `line-height: 1` on text rows.
- Muted means secondary, not unreadable. Important amounts must not be ellipsised.

### Surfaces And Hierarchy

- Reuse `--background`, `--card`, `--panel-bg-alt`, and Analysis row/hover tokens.
- The page is an unframed working surface. Use bands and fine continuous rules
  to separate sections; reserve shadows for menus and dialogs, not every panel.
- Keep row separators visible. Avoid strong alternating stripes or borders
  around every individual number. Use the group band to communicate ownership.
- Preserve existing asset-class colours, shape bars, wheels, market nodes and
  connections. These encode data; replacing them is not cosmetic normalisation.
- Do not add new summary panels, sidebars, legends or explanatory paragraphs
  merely to make a page appear designed. Help owns general explanation.

### Colour And State

- Class identity follows [Asset-Class Visual Identity](../system/ASSET_CLASS_VISUAL_IDENTITY.md):
  one code-keyed palette for shape bars, pies, History, System and class rails.
  The palette does not change the semantic state tokens below.
- Foreground for subjects/current values; secondary for labels; muted for dates
  and supporting context. Resolve neutrals against the selected theme.
- Preserve existing semantic tokens for bullish/bearish, caution, information
  and risk. Do not recolour entire rows or numeric columns as decoration.
- Positive/negative performance is not the same as above/below an allocation
  target. A target difference must retain its documented meaning and tolerance.
- Missing, zero, neutral, disconnected and blocked remain different states.
  No visual pass may convert missing evidence into a neutral or successful state.

### Controls And Layout

- Keep the global `--spacing: 0.1rem`. Its compact utility scale is intentional,
  not an error to fix with a site-wide spacing reset. Set local insets and control
  dimensions explicitly when a component needs a reliable reading or hit area.
- Lucide icons for familiar tools; visible accessible names/tooltips. Keep the
  existing action target size; typically 28-36px desktop, larger for touch.
- Use segmented controls for modes, checkboxes for connections and menus for
  configuration. Avoid converting everything into icon-only controls.
- Focus outlines must be visible. Hover should identify the row, not compete
  with its signals. Markets retains immediate hover with no fade.
- Theme colour changes remain instant. Preserve purposeful transform/geometry
  animations; do not introduce `transition: all`.
- Do not change sidebar state, column widths, node alignment, sticky positioning
  or navigation as a side effect of typography work.
- Preserve dense table scrolling where necessary. Do not add new nested scroll
  containers. Audit existing nested scrolling separately before restructuring it.

### Shared Workspace Controls

Portfolio, Timeline, History, the full ETF page and News opt into shared control
styles with `terminal-workspace-controls`. The opt-in does not change the global
spacing unit, Positions, Analysis, Markets, sidebar cards or the sleeve widget.

- View modes use a theme-neutral selected fill with a bottom indicator. Filters
  use the indicator without a filled tile; News sentiment retains meaningful
  Bull/Bear colours. Hover must not erase a selected mode or change its dimensions.
- Shared tokens define 12px control text, a 30px desktop minimum, 36px touch
  minimum, 3px radius and neutral hover/selected surfaces. Existing larger mobile
  targets and Timeline's 32px desktop controls are retained.
- A visible 2px theme-aware inset focus outline works inside clipping containers,
  including native disclosure summaries. Disabled commands do not gain an active
  hover surface. ETF allocation filters expose their actual pressed state.
- ETF page row hover uses Analysis's existing hover token. Portfolio's internal
  rail button changes theme colours immediately; no new colour fades are added.

The shared CSS is opt-in in `styles/terminal-workspace.css`. It supplies role
styles and theme aliases, not descendant-wide font overrides or a new component
framework. Portfolio retains its scoped CSS module for its special geometry.

## Surfaces

### Positions Capital Map

Simple is an optional normal-Positions presentation, not a replacement for the
table or Actions. Use the installed Recharts hierarchical treemap for 2D area layout,
with actual positive held values as weights and existing asset-class codes as
group identities. Never impose minimum weights to enlarge small holdings.
Tile and class percentages retain the portfolio-value denominator, including cash;
class focus rescales only the viewport. Search highlights rather than filters area.

The 1D toggle uses equal-width rows sized by held value divided by displayed
invested capital, multiplied by the chart viewport height. CSS size containment
and container-height units keep the scale responsive without resize-driven React
state. There is no minimum row height, vertical padding or inter-row gap: small
allocations must not be inflated. A 1D-only slider applies a shared 1x-2x scale
to the row stack and row heights, never to text size or financial values. Zoom
preserves the top-of-view capital position; search brings its result into view,
centring its label if the row exceeds the viewport. Zoom is session component
state, retained across layout switches, not a new backend or browser preference.
The text-icon toggle defaults to clipped labels. When disabled, a row-size
container hides labels at 27px or less. Both modes retain the accessible name
and strictly proportional height; text must never expand the row. Hover, focus
and search expose full details in the inspector, including subpixel holdings.
Do not add target weights or funded/over-target colours to this held-only
view. The selected-holding inspector stays outside the chart scroll area. Search
scrolls that area only and never resizes or filters rows. Layout changes retain
class focus and search; the 1D/2D preference is browser-local and independent of
the Table/Simple preference. Rows default to canonical class colours in both themes.
The 1D map reserves a 44px left gutter for a cumulative percentage axis. Tick
offsets are `(portfolio value * percentage / 100) / displayed held value` within
the scaled stack, so they scroll and zoom with the rows. Use approximately four
nice intervals, normally 25 percentage points; class focus changes the interval,
not the whole-portfolio denominator. Invalid totals produce no axis. The axis
must not rescale row heights, create cash holdings or change the 2D chart.
The holding inspector includes statement `gain_loss_pct` via `Stock.changePercent`
and the Positions table's existing `securityPositions[stock.symbol]` trend. Do
not use the store's default `stock.signal`, derive P/L from allocation weights,
or fetch another data source. Use theme-backed positive/negative text, neutral
missing/zero values, and wrapping metrics on narrow panels. The optional chart-icon
**Colour by P/L** toggle changes map fills only: `clamp(P/L / 50, -1, 1)` selects
a continuous neutral-to-red/green fill with fixed endpoints. Use fixed HSL hues
(red 0 degrees, green 135 degrees), increasing saturation and theme-specific
lightness as magnitude grows. Do not RGB-mix with a tinted neutral, which shifts
the hue through unwanted intermediate colours. Zero and missing
P/L use `--background` with `--foreground` text, following theme changes instantly;
missing values remain distinguishable in the inspector. Trend
does not drive these colours. Do not rebase the scale on class focus, recolour the
canonical class swatches, alter holding geometry/order, or fetch new data. Use
theme-aware heatmap palettes with readable contrasting labels. Hover/focus uses
outlines, not fill changes that would distort the encoded return. Persist this
display choice under `alpha-edge:positions-map-colour` and retain session use
when browser storage is blocked.

The chart is an unframed work surface with theme-aware class-colour fills, thin
rules and no animation. Tile text adapts to available tile dimensions, not viewport
font scaling. Small tiles retain accessible names and a full-value inspector.
Use the shared class-colour registry; do not create another palette or colour
preference. The table styling, row icons, sidebar styling and financial logic are
unchanged. The presentation preference alone is stored in browser local storage.
See [Positions Help](../user/positions.md#simple-view).

### Positions Row Appearance

Header backgrounds and borders retain their existing theme surface. An arrow/icon
button beside each class name provides access to its compact icon palette, with a class-colour
swatch beside the palette heading. The swatch opens the existing 30-colour editor;
there is no separate row-colour store. Every class uses a stable 28px symbol slot
on desktop and touch. With no custom icon, a 10px Lucide triangle shows expansion
(down) or collapse (right); a chosen 16px icon replaces it. Hover and replacement
do not shift the class name. Ordinary clicks on the name or symbol share the same
expansion handler, with accessible labels but no expand/collapse tooltip.
After 800ms hovering over the symbol alone, it becomes
a pencil: a click then opens the picker without changing expansion. Pointer exit,
blur, cancellation and popup closure reset this mode; unmount clears the timer.
Touch uses an 800ms hold (scroll movement cancels it); keyboard users can
open the picker with Arrow Down or F2, while Enter/Space retain expansion.
Default arrow restores the triangle, using the existing
persisted `none` identifier. There is no global icon setting. No stock-row
colours, state colours, column widths, fonts, sidebar behaviour or financial logic change.
Q1 bands, cash summaries, Actions and other tabs do not opt in.

The icon catalogue contains 72 symbols, plus automatic/default-arrow controls. Its
code-keyed mappings cover all 56 shared class identities (the backend bootstrap
catalogue contains 49 classes). This is presentation coverage, not a claim about
the number of user-created or active database classes. A grouped, searchable grid
scrolls within a bounded popover; keyboard opening focuses a control rather than
forcing the mobile search keyboard open. Existing icon IDs retain their symbols.

Icon selection saves immediately for the clicked class only, after browser storage
succeeds. Default arrow removes the custom icon. The colour editor follows
the shared Save/double-click/Cancel/Reset contract and persists through the existing
class-colour settings API. A colour change updates canonical class-colour consumers;
row icons default to the previous neutral theme foreground. Two icon-only previews
form an accessible radio group: Neutral and Class colour. Both show the selected
symbol (the disclosure arrow when none is assigned), with a subtle outline on the selected
mode. Hover tooltips name them; there is no visible instruction or checkbox.
Selection saves immediately in browser preferences without writing the palette.
Row backgrounds and semantic state colours remain unchanged. Palette
events do not trigger collapse, double-click navigation or row dragging. A
storage failure keeps the relevant editor open and its previous setting intact.

`lib/position-row-appearance.ts` owns the version-3 icon-only model and validation.
It also owns icon IDs, labels, groups and explicit canonical-class mappings.
`position-row-emblem.tsx` provides the statically imported Lucide components;
automatic selection normalises class aliases before looking up a symbol.
Icons use an independent map keyed by source class code. The Zustand store retains the existing storage key
`alpha-edge:position-row-appearance-v1`, scoped to the browser origin, and listens
for other tabs' storage changes. Codes retain their source underscores and are
not keyed by group names, financial-normalizer compact keys or row order.
Row icons use `var(--foreground)` unless opted into `var(--row-accent)` by the
optional `classColourIcons` true-only map in version 3. Missing entries are neutral;
icon replacement/removal preserves the mode. No independent hex values are stored.
The colour swatch always uses the canonical class colour. Version-1/2 reads discard
all borders, global icons and background settings while retaining explicit per-class
icons. No arbitrary CSS, uploaded files, remote image URLs, new backend endpoints
or database migrations are added. Colour changes write only the existing
`asset_class_colour:<CLASS_CODE>` setting.

Verification covers malformed/future preferences, version-1/2 migration, independent
class icons, retired menu/border settings, storage failures, reloads, unchanged
row geometry during selection, Compare, and dark/light popovers at desktop and mobile sizes.
Nested colour-editor checks cover draft/Cancel/Save/Reset/double-click, failed saves,
focus restoration, unchanged class expansion, and updates to the shared chart palette.
Preview checks cover per-class independence, persistence, arrow-key access, failed
storage writes, both themes and following a saved canonical colour change.
See [Positions Help](../user/positions.md#row-appearance).

### Positions Actions

The Actions workflow uses a page-scoped CSS module, not changes to Normal
Positions, Analysis, shell sizing or global sidebar state. Its action selector,
three-stage strip and current-task summary precede supporting evidence. Sections
are separated by rules rather than cards inside cards. Body text is 13px;
metadata is at least 11px; the current-task heading is 16px. Theme tokens govern
surfaces and text, with warning reserved for evidence needing review.

The default reduction table has five columns: Name, Held, Required / guide,
Record reduction and Remaining. Percentage/reference columns are optional and
their visibility is independent of Normal. Statement mismatches use available
Expected/Statement/Difference evidence. A locked workflow without stock-level
evidence shows latest holdings, never invented zero-recorded reductions.

At workspace widths up to 1100px the workflow and action controls precede the
table; at larger widths the workflow is a 336px side panel. These are workspace
container breakpoints, so open global sidebars are accounted for. Table overflow
remains explicit. Small-screen controls do not shrink with root-font scaling.

Regression coverage: `tests/positions-actions-design.browser.test.cjs` uses
isolated fixtures for draft recording, totals review, locked execution, statement
variance, guarded reopening, baseline approval, themes and responsive ordering.
It does not send financial writes to UAT. The existing UAT workflow tests retain
their mutation/reconciliation checks with updated presentation locators.

### Analysis

Analysis reserves at least 344px for desktop identity, plus a pinned ticker lane
when enabled. Numeric columns keep their minimums and the table scrolls
deliberately. Mobile retains its 200px identity column and wrapping. Class
headings, performance and focus controls stay in the visible viewport during
horizontal scrolling; the left-edge edit mechanism is preserved.

Security rows are 28px. Signal reads ↑ Buy, ↓ Sell and → Hold in the signal
colours. Upside shows the average price target, with the upside percentage on
hover. Quality, Value, Total and Council show strong scores (80 or more) in green
and weak scores (below 50) in red; Thesis Δ and MOM are coloured by sign. Target
WT shows the class share, with the dollar target on hover.

### Sidebar Rails And Alert Stack

- Each desktop rail reserves a shared `--shell-handle-width` (0.75rem) for its
  handle, independent of the global `--spacing` scale. Cards, footer buttons and
  tabs never sit beneath the handle or intercept its clicks. Outer rail widths
  are 288/224/204px at the existing breakpoints; the inner panel excludes the
  1px rail border and its width transition matches the outer rail.
- The handle column carries the panel surface. On desktop rails, panels have no
  side borders; each rail's divider separates it from the centre. Right-rail
  content is inset 10px from the screen edge, and the sleeve dock stays flush
  bottom/right. Mobile drawers keep their own spacing.
- Alert Stack class groups use a 5% class-colour wash, a 28% top rule, a
  continuous 2px left rail and elliptical corners. Headers are 22px, with 11px
  class names (weight 500) and 11px muted counts. A header shows its latest date
  only while the group is collapsed; a hover preview leaves the header unchanged.
  Pinned groups show a pin, and canonical class colours apply.
- Cards have a complete 1px border, 3px radius and 70% card surface, with 4.8px
  vertical padding, 1.6px between text lines, 3.2px between cards and 4.8px
  between groups. Names are 12px; the instruction (weight 500), move, ticker and
  age are 11px. Ordinary cards are 50px; long instructions wrap within a 68px
  ceiling rather than clip.
- Desktop ages are compact (`5d`), with the full relative age in the hover title
  and accessible label; the mobile drawer shows `5d ago`. ASX tickers omit the
  `ASX:` prefix; other exchanges keep theirs, and the full symbol is in the hover
  title.
- Wide rails show name and age above ticker, instruction and move. Compact rails
  keep the chart and ignore controls in a separate edge column. Mobile names wrap,
  controls stay reachable and expanded groups have no height ceiling. There is
  one content scroller and a separate History footer.
- Q3/Q4 appear as a restrained outlined notice with the existing target and
  exposure data. Semantic state colours come from theme tokens, independent of
  class identity. Collapsed content is hidden and inert; a nested chart or ignore
  control does not also open its alert.
- Density checks run at 720-800px laptop heights. At 1366px and above, five
  alerts and their class headers use less than half the viewport; at 1280x720 a
  400px budget lets full instructions wrap in the 204px rail.

### ETF Sidebar

- The summary is a full-width band on `--surface-0` directly below the tabs,
  with matching insets and a subtle bottom divider. Its **ETF allocations** title
  (14px, weight 600) links to the ETF tab with the up-right arrow; on narrow
  rails the arrow is hidden first, and the title shortens only when the text
  itself cannot fit. The held amount is 18px semibold, the target 14px regular
  and muted, and the signed difference 12px medium: red above target, blue below.
  A 4px funding bar spans the inner width with the target tick at 80% and excess
  in red. Labelled details open on hover, focus or tap. View controls keep 24px
  desktop and 32px touch hit areas.
- Line Fill rows run edge to edge, separated by a 1px divider, without card
  outlines or corners. Ticker (13px, weight 600), fund name (11px) and signal share
  the first line; held / target (12px) and the difference share the second; a
  full-width 4px funding line with the 80% tick sits below. Rows are at least
  61px on desktop (5px and 6px vertical padding) and 75px in touch drawers.
- Ring Fill uses the same row with a 26px funding ring (3px stroke) in a leading
  column. The ring fills to 100% at target; excess overlays red, capped at a full
  red ring at 200%. Unknown targets are dashed and unfilled; a known zero target
  with holdings is entirely red. The right-hand number is `(held - effective
  target) / effective target x 100`, toggled per row to the dollar difference.
  Rounded zero is neutral and a missing target has no difference; it is never
  momentum or P/L. The row's Core trigger and the number toggle are sibling
  buttons, so switching units never opens Core settings.
- Amounts wrap but never truncate. The ETF scroll area reserves no empty
  scrollbar gutter. Capital Map is unchanged. Density checks cover 720-800px
  laptop heights and eight complete fund rows above the sleeve dock at 1440x800.

### Chart Links

Every link that opens a TradingView chart uses the Lucide `ArrowUpRight` arrow,
the same mark as the ETF allocations title link: Alert Stack cards, the optional
Analysis Chart column, Watchlist entry review, Markets chart headers and the
right-rail security chart. It sits in the muted foreground and brightens on
hover. Muted colour keeps the arrow beside a price move from reading as price
direction.

### System Workspace

System's content is bounded at 960px with at least 40px side gutters on desktop
and 16px on narrow workspaces. Its current-allocation bar is 32px high inside a
40px button. The allocation list uses at most three columns so the narrower
reading area does not squeeze class names into four tracks. Section boundaries
remain full-width; there are no floating section cards or additional scroll areas.
Each numbered section has a chevron beside its title. Collapsing hides only the
body, preserves its search and group state, and removes the trailing content gap.
Sections start expanded; top navigation reopens its destination before scrolling.
Section titles use 16px semibold type with a 6px gap before their content;
class headings use 14px semibold and security names 13px medium. This separates
the three reading levels without reducing row contrast or adding decorative bands.
Within Position signals, class rows use a slightly lifted theme-neutral surface
and stronger separators. Security names are indented beneath their class title;
signal and value columns keep their existing alignment. Market pairs and stock
tickers live in the name button's hover title, not a second text line; ticker
search still works. Mobile retains held value beneath the name when its column
is hidden. Compact desktop sizing uses 42px section headings, 26px allocation
rows, 31px class headers and approximately 37px single-line signal rows, without
shrinking the 13px reading size. Long names can wrap, and coarse-pointer controls
retain their larger touch targets.

### History Workspace

History uses `components/stock-table/history-workspace.module.css` for geometry
that cannot inherit the terminal's compressed spacing scale. Controls have a
30px desktop minimum height and 36px minimum on narrow/touch surfaces; search
fields are 32px/36px high. Table data is 13px, metadata 12px and headings 15-16px,
with ordinary system type and no tracked capitals.

Under Activity, Signals and Decisions share one full-height ledger, with a fixed control band,
sticky column headings and one table scroll container. Subject columns reserve
space for class names; detailed records remain expandable. Both ledgers slice
filtered records before rendering, with a hard limit of 100 rows per page.
Pagination controls sit beside the count; search covers the loaded dataset and
resets to page one. Page changes reset vertical table scrolling, and a shrinking
dataset clamps the selected page. This is a DOM rendering limit, not a change to
backend retrieval limits or retention. Portfolio owns one
page scroller, with chart frames 340px high (240px compact, 300px on narrow
workspaces). Two columns require 960px of available History content width,
not viewport width, so retained sidebars count towards the layout decision.

Canvas chart colours are resolved from theme tokens and reapplied on theme
changes without recreating the chart or resetting its zoom. Value overlays use
their own visible axis. Asset-class colours and approved/previous shape previews
are preserved. Preference writes wait for the initial browser settings read,
including development Strict Mode's repeated effects.

`tests/history-workspace.browser.test.cjs` checks chart containment at 1920,
1366, 1020 and 390px, ledger overflow, control sizing, class labels, keyboard
security search, decision-history navigation and canvas theme changes. Run it
against the local server alongside `tests/history-shape-preview.browser.test.cjs`
and `tests/alert-action-integration.browser.test.cjs`. These tests intercept API
traffic with isolated fixtures; they do not write to UAT.

### Other Pages

- Portfolio toolbar wrapping responds to its main container, not just the screen.
  Timeline combines its back/title and record filters in one wrapping header.
  It retains the internal summary rail, record strip, chart modes and memo reader.
- The compact sleeve pie and comparison dial keep a side-by-side chart and legend
  in the bottom-right dock, with their existing sizing, typography and hover
  styling.
- History groups approval labels by rendered pixel distance. The group's popup
  lists its individual dates/versions and displays the selected saved shape with
  its immediate predecessor. It preserves the full date domain, exact percentages,
  incomplete evidence and explicit demo labels. Recompute groups on resize/range
  changes, not by dropping approvals. Activity is the outer ledger view;
  Signals/Decisions remain its inner choices and retain the 100-row render limit.
- ETF full-page subjects use 13px type with 11-12px supporting labels. Summary
  figures are compact, metadata is sentence case, and model provenance is
  disclosed separately. News uses headline-first rows, one failed-state
  presentation per job, formatted dates and an explicit menu for maintenance
  commands.
- Theme changes resolve through semantic tokens; components do not introduce
  fixed dark colours. Intentional class and row colours are retained.

## Acceptance

1. Preserve the established Positions rows, shell, sidebar cards and sleeve widget.
   The Analysis identity-width rules above are not permission to restyle these
   references wholesale.
2. Existing text, amounts, state colours, row counts and navigation remain correct.
3. Check default dark and light themes at 100% zoom, with sidebars retained,
   as well as expanded workspace. No automatic sidebar collapse is introduced.
4. Check readable titles and values, toolbar wrapping, keyboard focus, long
   asset names, missing data and scroll access at laptop/desktop widths.
5. Market node centres, connectors and row height must not move independently.
6. Typecheck, scoped CSS regression checks and relevant existing model tests
   must pass.

This standard governs presentation only. Allocation, research, trading signals,
connection baselines, actions and statement reconciliation remain owned by their
existing contracts. Style work must not silently repair or redefine those rules.
