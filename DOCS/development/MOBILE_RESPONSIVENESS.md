# Mobile Responsiveness

## Contract

Alpha Edge remains a desktop trading terminal. Small screens use alternate
presentation, not different financial rules or a scaled-down desktop screenshot.
The approved shape, research, signal gates, action queue, broker reconciliation,
Core ETF ratios and momentum calculations are unchanged.

| Viewport | Shell | Page content |
| --- | --- | --- |
| Up to 767 CSS pixels | Menu navigation and overlay drawers | Phone layouts; tables scroll or rows reflow with metric labels |
| 768-1023 CSS pixels | Same overlay shell | Existing tablet/table layouts retain more columns |
| 1024 CSS pixels and above | Existing navigation and saved desktop rails | Existing desktop presentation |

These are viewport widths, not physical screen sizes. Browser zoom can cross a
breakpoint. Pinch zoom remains enabled; no maximum scale is imposed.

## Navigation And State

- The menu includes every current main tab, ETF allocations and Help. It shows
  the active page and uses existing hash routes, including back/forward handling.
- Alert Stack and ETF Monitor open from separate header icons. They overlay the
  content instead of reducing its width. Only one sidebar drawer is open at once.
- Radix Dialog owns focus trapping, Escape and outside dismissal. Closing returns
  focus to the opening control. Navigation closes the menu and sidebar drawer.
- Mobile drawer state is transient and separate from saved desktop rail state.
  Resizing back restores the desktop configuration, whether open or snapped.
- Starting the existing buy flow can reveal the right drawer; it still uses the
  same draft and confirmation handlers. No action is recorded by opening a drawer.
- Value, Cash and P/L remain visible. Safe-area insets and dynamic viewport height
  protect shell and drawer edges. Form fields use 16px phone text to avoid focus zoom.

## Page Treatments

| Surface | Small-screen treatment |
| --- | --- |
| Positions | All columns remain; a narrower identity column and horizontally scrollable grid. Sticky identity cells on phones. The shape strip wraps its controls. Review/workflow panels stack below the table and the review dock stays in document flow. |
| Analysis | Wrapped toolbar/search, 200px identity column, reduced indentation, wrapping company names, visible instrument controls and horizontal table scrolling. The existing ticker pin remains available instead of relying on edge hover. |
| Portfolio | Independent collapsed summary disclosure; asset-class rows reflow with Share, Cumulative, Per $1K, Target and Difference labels. No monetary values removed. |
| Portfolio history | Stated cards reflow values beneath the class name. Staircase bars occupy a second line. The Bars archive retains its comparison grid with horizontal scrolling. Existing record navigation and memo controls remain. |
| Markets | Four labelled stages beneath each market identity, a separate 60D line and next-step row. The edit pencil and evidence control have visible touch targets. Existing nodes and signal semantics are retained. |
| Alerts | Scrollable connection ledgers with sticky security identities, 44px connection hit areas, wrapping filters and viewport-constrained setup dialogs. |
| ETF allocations/ranking | Labelled two-column metric layouts. Metrics hidden by the existing narrow desktop container rules are explicitly restored on phones. Existing configuration controls remain. |
| System | Single-column class list and wrapping position identities; one main scroll flow instead of a capped inner positions scroller. |
| News | Wrapped commands and larger ledger filter targets; retains the existing narrow-screen stacked layout. |
| History | Wrapped controls and horizontally scrollable financial tables. Existing chart data and aggregation remain. |
| Help | Horizontally scrollable contents navigation above the article instead of a second sidebar. |

## Ownership And Maintenance

- `lib/use-mobile-layout.ts` owns the matching JS media queries. Its server
  snapshot is false; CSS hides desktop rails on narrow screens before hydration.
- `styles/terminal-mobile.css` owns shell and opt-in page overrides. It is imported
  directly by `app/layout.tsx`. Existing desktop selectors are only overridden
  inside the documented media queries.
- CSS modules own their local responsive rows for Portfolio, ETF and Alerts.
- Financial rows must retain their values and labels. Prefer scrolling a genuine
  comparison table to squeezing every column below readable size.
- Do not persist phone-specific column widths, summary disclosure or rail defaults
  into desktop preferences. Do not use viewport-scaled fonts or whole-app transforms.
- Do not add hover-only mobile commands. Primary shell targets are 44px; compact
  secondary controls use 36-44px targets without enlarging every icon.

## Verification

Check these viewports in the browser:

- 320x640: Help, Analysis, watchlist dialog containment and History navigation.
- 390x844: menu routing, Alert Stack and ETF drawers, Escape/close/focus return,
  populated Positions/Analysis, Portfolio rows and summary toggle, Alerts ledger,
  News layout and System held-position layout.
- 768x1024: overlay shell and Positions table containment.
- 1024x768, 1280x800, 1440x900 and 1920x1080: desktop shell bounds. Desktop menu
  remains hidden and original navigation returns. Open desktop rails survived a
  phone-width round trip unchanged.
- Document width stays within the viewport. Dense tables intentionally overflow
  their own scroll containers.

Automated guards:

```sh
node --test tests/mobile-responsive.test.cjs tests/terminal-style-standard.test.cjs
npm run test:shell-layout
npm run test:terminal-route
npm run test:portfolio-overview
npx tsc --noEmit --incremental false
git diff --check
```

The responsive tests check CSS scope, state ownership and markup contracts. They
are not a substitute for rendered interaction tests.
