# Portfolio Tools And Core ETF Migration

> Design record: the decisions and implementation history behind this area. For current rules, see the [system ownership map](../system/README.md).

Status: implemented (September 2026).

## Purpose And Ownership

The right rail is optional context, not a second allocator or action queue.

Position action recording belongs to the left Alert Stack. Since 10 September,
clicking a Positions Action cell opens that alert's detail there, not a separate
Security Action Queue drawer. From 11 September, pending statement checks and
blocked signals live in History / Signals, accessible from Positions' Pending
cell or the stack's Decision history link. The stack shows current instructions
and review exceptions, not the processing backlog. The right context panel and its security double-click
behavior are unchanged by this consolidation.
Positions retains compact held ETF rows; the sidebar owns Core configuration and
target coverage. The initial Asset class
view was removed after review; the sidebar retains ETFs, Security and Shape.

| Surface | Responsibility |
| --- | --- |
| Positions | Broker holdings with the original single-line ETF layout, Core pinning/tint and read-only ratio chip. No inline Core editor, allocation bar or unheld target row. |
| Security | Details of the security double-clicked in Positions: holdings, Core selection/ratio editing, existing signals, research, advisory sizing and ETF momentum provenance. Links onward to Performance history and Analysis. No manual security picker. |
| Shape | Existing current/historical approved-shape comparison and associated memo access, unchanged by the revision. |
| ETFs | Previous compact summary/card styling and chart icon. Line Fill or Capital Map only; no Numbers, Ring Fill or duplicate list below the map. Core or held funds, not an unsolicited watchlist. |
| Portfolio summary | Independent bottom dock, outside the selected view's scroll area. Existing wheel/list/shape controls are retained. |
| Alerts / Actions | Connection setup and executable decisions stay in their existing workflows. |

The sidebar header provides icon-only ETFs, Security and Shape tabs (chart,
research document and pie), with hover titles and accessible names. Arrow keys move between tabs;
the selected view remains persisted. The duplicate minimise button is removed:
the existing desktop rail handle and mobile drawer close control own that action.
The security itself is selected directly from Positions, not from a dropdown.
The 10 September refinement restores the original Positions ratio chip and row
height. Ratios still reflect saved sidebar changes, but clicking the chip does
not open an editor. Unheld Core targets remain in the sidebar's ETF ledger only.

Security typography is scoped independently: the company name leads, with the
ticker and exchange shown separately underneath (for example, AUC and ASX).
Held value has primary emphasis over units/target. Signal evidence precedes
research so a long thesis cannot bury the current trend. Research metrics use
aligned label/value rows; dates and provenance form a quieter group. The full
research note remains available in a keyboard-accessible disclosure, closed by
default when selecting a security. The content has a consistent 16px minimum inset;
section rules separate groups without adding cards. Labels wrap while numbers
stay intact; narrow sidebars also stack the two primary holding metrics into
label/value rows. Onward navigation uses borderless text links with 32px desktop
and 40px mobile hit areas. ETF cards retain their line-fill and Core editing
behaviour, but use a separate class-name line with 12px labels and 14px primary
figures. The ETF summary's amount leads; its target reference and held/target
totals remain secondary. All colours come from the existing theme/state tokens;
no allocation formula or tolerance changes. Shape and Portfolio summary charts are
unchanged by this design pass.

The right sidebar owns two sibling regions: a flexible workspace above and the
Portfolio summary dock below. Scrolling or switching ETFs, Security, Shape or the
Buy Ledger cannot move or unmount the dock. Hiding the rail or mobile drawer
hides both regions together. The dock is capped at half the available height on
short screens; its contents can scroll without covering the workspace above.

Dock refinement: the widget surface reaches the viewport's
right and bottom edges, with no outer gutter or floating card frame. Internal
left spacing clears the rail handle. The title/collapse row sits above grouped
view controls with 24px buttons (32px on small or touch screens), 14px icons and
theme-aware active/focus states. Compact chart columns yield only when needed
to keep legend values inside a narrow rail. Current and comparison wheels retain
their list toggle; the separate sleeve-weights view has been removed.
Calculations are unchanged.

## Interaction And Persistence

- Default view is ETFs. Saved Asset class or invalid views migrate to ETFs.
- Double-clicking a normal Positions security row selects its qualified ticker,
  switches the panel to Security and opens the right rail or mobile drawer.
  The main page stays on Positions. Enter on a keyboard-focused row does the same.
- Ordinary row clicks retain existing selection behavior; they do not reopen
  the rail or change the panel view. Embedded buttons/inputs do not trigger the
  row's double-click action.
- Performance history opens the existing stock History view with the selected
  ticker and name. Open research reuses the existing Analysis navigation/filter.
  A compact TradingView daily price chart appears below Signal evidence. Its
  frame is 238px high and starts with automatic, unlocked price scaling. It uses
  the selected security's qualified exchange/ticker (including ETFs), not the
  broker's portfolio-value history. It follows light/dark theme changes and has
  an external full-chart link. Missing exchange metadata is disclosed rather
  than guessed; provider load failures offer retry. Unsupported symbols/data
  permissions are reported by TradingView within its embed.
- View, selected security/shape and Line Fill/Capital Map preferences remain
  local under `alpha-edge:context-panel`. Legacy Numbers/Ring preferences become
  Line Fill; Capital Map is retained.
- No sidebar is automatically collapsed by this revision.

## Allocation And Data

ETF management is selectable separately from
Core via the chip editor or Security's Signal evidence section. The compact
ETF/TMS label names the management mode, not the instrument classification.
Ratios and ETF momentum remain unchanged. See ETF System V2 section 4.5 for
switching, connection and execution safeguards. The header refresh button is
removed; automatic polling and change-event refresh remain active.

Allocation policy is unchanged: the approved class budget and explicit Core ratio
establish the ETF base; existing bounded momentum and trend gates determine the
effective target. One Core ETF per class remains supported.

Line-view chips follow the four-view monitor,
retaining its Core surface, separate right-hand held/gap amounts
and thin fill line. Short ticker symbols leave room for class names. Below
260px of chip-container width, the class sits below the ticker rather than
wrapping the whole identity or shrinking numeric text. Connection bars are now
14px tall, centred beside the ticker, not stretched across the card. Current
management-aware connection rules remain. ETF/TMS settings
stay in the menu instead of adding another competing label to each chip.

Local line-view follow-up: Core chips have no decorative border or inset edge.
Their connection indicator and subtle Core background remain. Line fill uses a
fixed scale with the target at 80% of the track: 50% funded occupies 40%, fully
funded occupies 80%, and 10% over target adds 8% in red. At 25% over target the
remaining 20% is full; further excess is still reported by the monetary values.
Unknown targets show no allocation fill. A real zero target with a holding shows
only the excess zone in red. Summary and capital-map scales are unchanged.

Choosing a ratio edits a draft only. Clicking Core applies it; Non-Core removes
the selection without selling a holding. The restored compact menu has ratios
on the left and Core / Non-Core on the right, matching the historical controls.
Pointer access anchors at the click with viewport collision handling; keyboard
access anchors to the trigger. Both Core and nested management menus sit above
the mobile drawer. The same anchored editor is accessible from the sidebar ETF
chip and Security view. Failed saves retain the prior policy, and a failed ledger refresh
disables policy writes until an authoritative refresh succeeds.

The existing stock budget remains:

```text
max(approved class budget - max(effective ETF target, occupied ETF capital), 0)
```

Lower ETF targets release unoccupied class capacity, not verified cash. Live
Analysis suggestions remain advisory. This UI does not alter weights, model
membership, risk gates, cash backing, purchase tickets or broker reconciliation.

The shared provider reads the existing ETF ledger and current/approved mix.
It refreshes every 30 seconds while visible, on visibility return, manual refresh,
and existing allocation/cash events. No new backend endpoint, database table,
API key or scheduler is introduced. The optional Security view loads its chart
directly from TradingView in the browser; it does not feed prices, signals or
allocation decisions back into the application. The first-pass class
implementation endpoint and its added backend projection were removed.

A zero target is valid and distinct from a missing target. Unfilled capacity
stays empty; only holdings above a known target show red. Missing targets stay
neutral. Line Fill retains the compact held value and target difference on the
right, with full held/target values in the accessible description and tooltip.
Capital Map shows held/target pairs directly and uses the larger of held or
target for relative block size, with a minimum readable block height.

Security separates the latest internal ETF 80-session calculation from the
published/compatibility weight actually used for allocation. Stock six-month
returns and advisory sizing remain separately labelled. Shape retains canonical
saved classes, incomplete-history disclosure and the exact associated memo.

## Verification And Rollout

Model tests cover qualified ticker identity, valid zero/missing targets, excess
fills, preference migration and saved shape comparisons. Isolated browser tests
cover Core editing/failures, ratio draft behavior, Positions double-click and
closed-rail reopening, History/Analysis navigation, map/list exclusivity, Shape
persistence/memo access, and mobile/editor bounds.

The change is frontend-only and uses existing backend contracts. See [Testing](../development/TESTING.md) for commands and
[ETF Model Proposal](ETF_MODEL_PROPOSAL.md) for the broader allocation policy.
