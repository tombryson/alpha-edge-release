# Current positions

Positions shows holdings already in the portfolio, their current exposure, active action state and the evidence supporting a decision to add, reduce or exit.

## Read The Class Before The Security

Asset-class rows summarise their holdings and compare actual allocation with the approved shape. Compare views and compact numbers are views of the same class allocation, not competing targets.

Held Core ETFs stay pinned at the top of their class. Their ratio chip is read-only here. Double-click a security to open its details in the right sidebar; use its research and performance links to investigate further.

Once updated holdings confirm a full exit, Normal Positions hides that security.
A class disappears when none of its securities remain held; empty parent groups
disappear too. Selling one security does not hide other holdings in the class.
Zero-valued securities with remaining units are still shown. Recording a sale or
receiving a Sell signal alone does not change the holdings display.

This only filters the Positions view. Saved groups, class settings, research,
approved targets and historical records are not deleted, and the group returns
when holdings are added again. Actions and portfolio reconciliation retain their
class evidence. Any remaining cash continues to be accounted for separately.

## Ideal Weight

**Ideal wt**, beside Class %, shows a modelled allocation across the stocks you
currently hold in each asset class. It uses the same research scoring engine as
Analysis, but not its watchlist or IN/OUT selection. Confirmed entries and exits
update the calculation automatically. Analysis remains unchanged.

The number is a percentage of the whole approved class budget. Stocks divide the
budget remaining after ETF capacity; Core ETF rows show their effective ETF
target. For example, a 25% ETF target leaves 75% for stocks: two stocks with model
weights of 2:1 show 50% and 25%. If ETFs already occupy more than their target,
that occupied capital also reduces stock capacity.

Analysis percentages divide only its selected stock budget. When the stock sets
match, the proportions agree after accounting for the ETF allocation. Different
stock sets intentionally give different percentages. Neither number moves cash,
creates orders, or changes the approved shape or existing adds/trim permissions.

If any held stock lacks a complete sizing-model result, every stock in that
asset class shows a dash, not a zero or a partial recommendation. A complete
result means Quality, Value and price target from at least one of Gemini,
Perplexity, GPT or Claude; a usable current price is also required. All four
models are not required. Council alone does not supply the sizing base score.
**Analysis > Data issues > Incomplete sizing research** lists missing model
results. Complete the research to restore the class's stock weights automatically.
Unheld watchlist gaps do not affect Positions; Core ETF targets and complete
classes remain available. Analysis IN/OUT does not bypass a held-stock gap.
Unavailable budgets or sizing results also show a dash; hover for the reason.

Class % and Portfolio % keep their numbers visible, with their background fills
revealed across the corresponding column when its header or any cell is hovered
or contains keyboard focus. These columns no longer need fill checkboxes.

The Ideal wt percentage stays visible. The thin bar represents 0-100% of the whole class
and appears for the entire column when any Ideal wt cell or its header is hovered
or contains keyboard focus. Red overstretch bars remain visible even when the
column is not being inspected. On touch screens,
the percentage and red warnings remain available without hover. Hover the
percentage for its dollar equivalent; unavailable weights show a dash without a bar.
Its colour compares the displayed Class % with Ideal wt: matching percentages
are green, below ideal is lighter (darker in light mode), and at least 150% of
the ideal percentage for stocks or 125% for Core ETFs is red. Stale references
stay neutral; incomplete class research shows no bar. This shows the mix of holdings within the class, not
how fully the class budget is funded. The separate dollar-based trade rules
below are unchanged: the colours remain advisory, and red alone does not create
a trade alert.

Click the heading to sort; resize, reorder or hide the column using the existing
column controls. It appears only in Normal Positions, not the Actions workflow.

## Optional Weight Management

Open the shield beside **Ideal wt** to change **Weight management**.
It is optional and **Off by default**. Off keeps Ideal wt
visible without an individual weight limit or weight-based reduction proposals.
Off also removes the old individual allocation ceiling. Class budgets, cash,
signals and Q3/Q4 safeguards still apply. This portfolio setting is shared across
devices. The public demonstration is read-only.

When On, valid new purchases can fill a stock's ideal amount or a Core ETF's
effective target, but cannot exceed it. Being below target does not itself ask
you to buy: a valid signal, class capacity and confirmed cash are still needed.
Research keeps updating; you do not have to reselect your holdings after an
entry or exit.

Existing positions can grow above their target. The agreed reduction rules are:

- **Stocks:** at least 150% of the ideal amount prompts a proposed reduction to 125%.
- **Core ETFs:** at least 125% of the effective target prompts a proposed reduction to 100%.
- **Confirmation:** the excess must qualify on two consecutive daily valuation observations with different dates and fresh data. Refreshes and corrections to the same date do not count twice.
- **Minimum size:** the proposed reduction must be at least the greater of A$100 or 0.25% of portfolio value. Smaller differences do not create trade alerts.

For a $50,000 portfolio, that minimum is $125. A stock with a $1,000 ideal and
$1,500 held would propose a $250 reduction, leaving $1,250. A Core ETF with a
$1,000 target and $1,250 held would propose a $250 reduction, leaving $1,000.
These percentages measure target coverage, not profit or loss.

## Comparing Actual And Ideal

Class % shows the share of the group's currently invested value. Ideal wt shows
the modelled share of the approved class budget. They are useful side by side,
but their difference is not automatically a buy or sell amount.

For example, a $10,000 approved class with $8,000 invested could contain a
$2,000 stock. It shows 25% Class % but already meets a 20% ($2,000) ideal. Weight
management compares holding dollars and ideal dollars using consistent
valuations, rather than subtracting those displayed percentages.

## Reviewing Weight Reductions

The workflow creates a proposal for your review, never an automatic
order. **Reduce $X** opens the existing action detail with holding, ideal,
reduction, remaining amount, valuation date and rule. Differences can arise from
prices, research, the class budget or ETF capacity; the proposal does not claim
to identify a single cause. A missing or zero model target is
not an automatic Exit. A non-Core ETF without a target is not automatically sold.

Only one weight proposal per security is outstanding. Existing signal
reductions, risk actions and trades awaiting statements take precedence to avoid
duplicate sales. After execution is recorded, a later broker statement must
confirm the quantity change. Released cash still needs the existing cash-source
validation/allocation workflow; neither estimated sale proceeds nor a unit match
automatically credits a class reserve or finances another purchase.

Buy/Add alerts remain visible as **Add paused** when weight limits or missing
evidence prevent adding. Open the alert for the reason. Partially funded Adds
show the permitted amount. Already-executed purchases can still be recorded
through the existing purchase-exception option with units, AUD spent and a reason.

Dismissed weight proposals do not return on every refresh: the holding must
first register a fresh below-threshold day, then two new qualifying days.
Large class differences show a small review marker beside the class in Portfolio,
not another set of stock trade cards.

Switching Off cancels unexecuted weight proposals with a reason in History.
It does not undo recorded
trades, clear statement waits or disable independent signal and risk actions.
The thresholds are agreed starting hypotheses, not a promise that a
particular portfolio weight is financially optimal.

## View Options

The sliders button opens **Position view options**. Asset-class order keeps the
saved order or sorts by target percentage, current percentage or absolute drift.
Click the selected percentage/drift option again to reverse its direction.
**Peek / Fixed** selects row behaviour; **Visible rows** controls the existing
summary and value displays. **Groups** opens the group manager. Expand/collapse
all remains a separate button beside the menu. Escape closes the menu and returns
keyboard focus to the sliders button.

Drag the right edge of a column heading to resize that column. Other columns keep
their widths; scroll horizontally when the table no longer fits. Drag the heading
itself to reorder columns, or click its label to sort.

Double-click an edge to reset that column. **Reset column widths** in the Name
column's menu restores automatic sizing for the current mode. Widths are saved in
this browser, separately for Normal, Actions and phone layouts. Keyboard users can
focus a column edge and press Left/Right for 10px steps, or Shift+Left/Right for 1px.
Escape cancels an unfinished drag.

## Portfolio Actions

**Actions** contains portfolio-level workflows such as a Q3/Q4 reduction or an
approved target rebalance. Choose the workflow at the top of the panel. This is
separate from a security's Buy, Reduce or Exit instruction in the normal table.

The three stages are **Adjust positions**, **Check statement** and **Complete**.
The highlighted stage and the current-task heading explain what needs attention.

For a Q3 reduction, the heading states **Reduce Q1 by X%**, using the backend's
signal adjustment ratio. The exposure target underneath is the retained level,
not the reduction: moving from 100% to 49% means reducing by 51%. The dollar
requirement remains in the totals below, including any applicable defensive-class
adjustments. These percentages are not percentages of the whole portfolio.

- During adjustment, **Required / guide** is the required reduction for an asset
  class and proportional guidance for a stock. It is not the final holding target.
  Record the reduction actually executed. The **Remaining** column belongs to
  the class requirement, not a binding per-stock target. Optional percentage and
  reference columns are available from the column menu without changing Normal.
- Review the totals before confirming. Going back preserves the entered amounts
  and your expanded/collapsed rows. Saving a draft is not execution confirmation.
- Once execution is recorded, the inputs are locked. Where available, the table
  shows **Expected**, **Statement** and **Difference** from reconciliation evidence.
  Otherwise it shows the latest statement holdings, not invented stock-level
  execution records or zeros that imply the trades need repeating.
- Portfolio rebalance differences can be expanded by asset class. Recorded
  reductions, the remaining amount and any recording tolerance are distinct
  from statement verification. Approval stays unavailable until the existing
  statement checks pass. Reopening a risk adjustment requires confirmation.

On compact workspaces the workflow and its next action appear before the table.
On wide workspaces the workflow sits beside it. Neither arrangement automatically
changes the Alert Stack or right-sidebar visibility. No Analysis suggestion is
made binding by this view, and expected cash is not verified spending capacity.

## Simple View

The grid icon beside Normal and Actions switches to **Simple view**, a capital
map of the same holdings as the Positions table. The table icon returns to the
existing rows. Your choice is remembered in this browser; Actions keeps its
existing table workflow.

Inside Simple view, **2D** retains the tiled map; **1D** switches to stacked,
full-width rows like the ETF Monitor's capital map. The layout choice is also
remembered in this browser. Switching layouts keeps your class focus and search.

In 2D, each tile's area represents the security's actual held value in AUD. Holdings
are grouped by asset class and use the shared class colours, including your
colour overrides. Held ETFs remain within their classes. These colours identify
classes, not gains, losses, signals or purchase recommendations.

In 1D, each holding's fraction of the displayed invested capital determines its
row height against the available chart height, with no minimum height or gaps
inflating small allocations. A holding with 0.5% of the displayed capital occupies
0.5% of the chart height at **1x**. The scale slider enlarges the map up to **2x**,
with scrolling inside the chart. All holdings grow by the same factor, so larger
holdings also become taller. The scale stays selected while switching between
1D and 2D during the current visit; it starts at 1x when the view is reopened.
The text icon toggles clipped row labels. When enabled, text stays rendered and
clips at each row's boundaries. When disabled, labels appear only where they fit.
Neither choice makes small rows taller. Hover, keyboard focus or search reveals full details below the map.
Search also scrolls to a holding at the enlarged scale. Very small holdings may
occupy less than a screen pixel but remain searchable.
The displayed dollar values and percentages retain their usual rounding.
The left axis shows cumulative allocation from top to bottom as a percentage of
the whole portfolio, including cash. Its usual markers are 25%, 50% and 75%; they
move with the map when zooming or scrolling. Focusing on a class uses smaller
intervals without changing the denominator. The bottom is the displayed holdings'
share, not an assumed 100%. No axis is shown if the portfolio total is unavailable.
Unlike the ETF Monitor's
target-aware map, Positions sizes both views from held capital only.

The map fills its available space with positive-value holdings. Cash is not a
tile. Percentages shown on tiles and rows use the **whole portfolio
value**, including cash, just like the Positions stock rows. The heading states
how much of the portfolio the map covers. The details below the map also show
the holding's share of its invested asset class; this is not its approved target.

Hover or focus a holding, then click its class in the details below the map to
focus on that class. Use the back arrow to return to all classes. There is no
separate class legend above the map. Focusing enlarges tiles without changing
their values or portfolio percentages. Search highlights matching names, tickers
or classes without changing tile sizes; the matching-holding arrows also locate
very small positions. In 1D, search also brings the matching row into view.
Hover or keyboard focus reveals full details below the map.
The bottom bar also shows the selected holding's broker-reported **P/L %** and
the same **Buy / Sell trend** as the Positions table. Gains and Buy are green;
losses and Sell are red. Missing evidence is shown as a neutral dash, not zero
P/L or a default Buy. These fields do not change position sizes.
The **Colour by P/L** chart-icon toggle switches both map layouts from asset-class
colours to a performance heatmap. Losses become progressively deeper red and gains
stronger green, on a fixed -50% to +50% scale. Each direction keeps a fixed hue;
only saturation and lightness change with magnitude.
Beyond those endpoints the colour
stays saturated; the exact P/L remains in the holding details and hover text.
Zero and unavailable P/L use the active theme background, with missing data still shown as a
dash in the details. This uses broker-reported holding P/L, not daily returns or
Buy/Sell trend. It changes neither capital sizes nor ordering. Click the toggle
again to restore class colours; the choice is remembered in this browser.
Click a tile, or press Enter on it or a search result, to open the existing
Security sidebar.

Zero, negative and unavailable values are listed separately below the map rather
than assigned misleading tile areas. Watchlist and external holdings follow the
same inclusion rules as the current Positions table. Simple view does not change
targets, sizing, signals, broker values or any execution workflow.

## Row Appearance

Each class starts with a triangle beside its name: down when expanded, right
when collapsed. Click the name, triangle or chosen icon to expand or collapse
the class. Hover over the triangle or icon for 800ms: it becomes a pencil.
Click the pencil to open the icon and colour picker. Moving away restores normal
expand/collapse behaviour. On touchscreens, hold the symbol for 800ms;
with keyboard focus on it, press Arrow Down to open the picker.
A chosen icon replaces the triangle in the same fixed space; **Default arrow**
restores it. Both remain visible without hover, and changing the symbol does
not move the class name. The palette applies immediately to that class only.
**Class icon** selects a symbol based on that class. Icon choices never inherit
globally. Opening the
palette does not collapse the class.

The palette has 72 symbols grouped by sector, alongside **Class icon** and
**Default arrow**. Search by class or subject, such as lithium, nuclear, software or
healthcare. Class icon has explicit mappings for the shared class catalogue;
custom classes without a known mapping use the Global symbol until you choose
another. The scrollable grid keeps the palette within smaller screens.

Click the colour square beside the class name at the top of the icon popup
to open the shared 30-colour palette. Select a colour, then **Save**, or
double-click a colour to confirm it. **Cancel** discards the draft; **Reset**
restores that class's default colour without removing its icon. Saved colours
apply consistently to that class throughout the app, including historical charts,
and are stored on the backend. The icon popup has two previews of the selected
symbol: grey (**Neutral**) and **Class colour**, identified by their hover tooltips.
Click either preview; an outline marks the current choice. Grey is the default.
Coloured icons follow later changes to the class colour. When the default arrow
is selected, the previews show the arrow in its current expanded/collapsed state.

Icon choices and their colour mode are saved per class in this browser. They affect named class headers in normal Positions, with Compare on
or off. They do not change Q1 sections, cash summary rows, security rows,
Actions, allocation weights or the appearance of other tabs. Custom image
uploads are not part of this version.
The separate **Row appearance** menu and border controls have been removed.
Earlier border, global icon and background preferences are ignored; explicit
per-class icons and app-wide colour choices are retained. Row backgrounds and
borders keep the standard table styling.

## Responding To An Alert

Click a holding's Action cell or the matching Alert Stack item to open the same detail. Record execution only after acting at the broker. Units and an execution note are optional for the ordinary workflow; leaving units blank uses the existing estimated-quantity matching rules.

**Pending** means execution is recorded and awaits a later statement. **Check** means the statement did not match. Neither asks you to trade again. Ordinary statement waits and blocked later signals are kept in History instead of repeating as active chips. Later actions remain blocked until the backend resolves the outstanding one.

## Purchases And Exits

Ordinary IG purchases require a funded class ticket. An available purchase-exception control is only for a purchase already executed outside the recommendation: units, AUD spent and a reason are required. External holdings are recorded manually, not verified by IG.

An Exit cannot be ignored. Retain with reason records an explicit unresolved override. Recording a sale does not itself release spendable cash; confirmation comes from a later validated statement.

## Find Previous Responses

Decision history in the Alert Stack opens [History / Activity](history.md). A Pending cell opens the associated evidence. A system status of Not applicable is not proof of a sale.
