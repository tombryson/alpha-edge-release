# Portfolio shape

Portfolio starts with the approved asset-class shape and compares current holdings against it. It separates portfolio construction decisions from signals on individual securities.

## Read The Shape

The approved version and date identify the reference. The approved ribbon appears first; holdings appear underneath in the same class order and colours. Classes are ordered by approved weight, with stable class-code ordering for ties, so market movement does not rearrange the plan. An approved class with no holdings stays visible. Holdings outside the approved shape remain visible and are labelled as such.

The page opens on the current **Approved** shape. The coloured bar, first percentage, Cumulative and Per $1K always follow approved weights. **Compare** adds the current holdings ribbon, markers and Held/Difference columns; turning it off removes that comparison, never the approved shape. The button is highlighted only while comparison is active. Difference means held minus approved, not investment return or an instruction to trade; selecting it enables comparison, and turning comparison off returns to Shape. Radial keeps the approved shape as the coloured polygon, adding holdings as a dashed outline only when Compare is selected.

The bottom-right **Portfolio summary** opens as a single ring of the current approved shape. **Compare with current allocation** adds holdings as the inner ring; the outer ring remains approved. **Show current portfolio shape** returns to the single approved ring. There is no actual-only view in this widget, and missing approval never substitutes current holdings. Its main percentages are saved approved weights, not dollar holdings or renormalised partial totals. The Positions comparison strip keeps approved amounts visible rather than hiding them until hover. Positions holdings, account totals and performance remain actual-first.

If there is no approval, the application explicitly shows holdings without an approved shape. If current data is stale or unavailable, saved approved weights remain visible; unavailable holdings are not reported as an empty portfolio and current differences are withheld. Approval and holdings refresh failures are reported independently.

## Inspect Without Changing Anything

Browse the timeline to inspect previous analyses, target drafts and approvals. The Portfolio toolbar stays available; click **Timeline** again or use **Back** to return to the previous view without resetting its settings. Select a saved memo to read its evidence in the Terminal. Opening a record does not approve it or start a new AI job.

The date strip combines approvals, targets and saved Portfolio Analysis memos from Alpha Edge Intelligence, including runs never previously opened in the Terminal. Selecting a record leaves its immediate neighbour visible on the left, so you can browse backwards without repeatedly using the arrow button. Daily broker observations stay out of this strip but remain available through **Compare with**. The memo and its proposed class weights appear together. Analyst and chairman documents are separate choices when their contents differ.

**Compare** adds a second record: compare two memos, approvals, or an approval against a memo. Both ribbons use the same class order, and the table includes classes removed from either shape. Change means the selected record minus the comparison, in percentage points. It is an allocation change, not investment return. Identical approvals say **No allocation change**.

An approved snapshot is headed by its version, such as **Approved v17**, followed by its approval date. Comparison shows the version and date for each snapshot, without repeating generic approval or source labels.

**Create target draft** saves the selected memo as evidence and opens the existing target workflow. It does not approve the recommendation. An approval without a linked memo remains manual; the application never guesses its source from a nearby analysis date.

Timeline loads saved records when opened. It has no type-filter count row, example generator or manual refresh toolbar. A memo archive failure does not interrupt browsing saved approvals; an unavailable linked memo is reported in its reader. Weights that do not total 100% are shown unchanged with a warning.

Shape, Cumulative, Difference and radial views offer different comparisons of the same class weights. Both comparison buttons remain visible. **History** stays highlighted while viewing saved approvals; **Back** in the history header returns to the live view with its previous comparison setting. **Compare** returns directly to approved-versus-current comparison. Historical overlays refer to the selected saved approval, not today's research recalculated backwards. Keep the asset-class legend and denominator in mind when comparing views.

## Run Portfolio Analysis

Select **Run portfolio analysis**, then optionally add **Investment plays** with a title and thesis. **Start analysis** submits the current portfolio and those ideas together. No saved memo is required. You can also start without any plays.

The independent ideal portfolio and current-portfolio assessment are completed before the models see your plays. Subsequent reviews assess each idea with a reasoned score out of 10 and an Include, Watch, Reject or Needs research verdict. An idea can introduce a new exposure; its funding must be explained. Results appear in the memo, not as automatic changes to holdings.

Plays save automatically to the Terminal database, including unfinished drafts. They survive refreshes and are available from other browsers using the same Terminal account/environment. **Saved** confirms storage; a failed save keeps the draft visible with a retry action. Closing the form does not start an analysis.

Check **Include in this analysis** for each saved play you want assessed. Existing plays are not automatically selected in a fresh session; new plays are selected as you add them. Deselecting retains the play in the library. The trash icon deletes it from the library, without changing past memos. Starting an analysis saves pending edits before submitting the selected plays.

## Change The Shape Deliberately

A new analysis is evidence for a possible target, not approval. Review the proposed class weights and compare them with the current approval and holdings. Use the target/rebalance workflow to formalise a change. Required reductions and later statement confirmation remain distinct from approving a new distribution.

Q3 can reduce the permitted class budget while still allowing purchases within the new limit. Q4 pauses increases in affected assets until it clears. Neither should be mistaken for a fresh user-approved shape.

## Portfolio Cycles

Once approved, a shape cannot be replaced for **four calendar months**. The first approval is unrestricted. Approval controls show the next available date; there is no early override. Research and target planning remain available, but a replacement baseline waits for that date. Q3/Q4 risk actions and ordinary security adds/trims are unaffected.

**Return %**, immediately after Approved, measures the assets held at the start of that shape's cycle. The compact summary shows the best-performing security. A completed cycle runs from one approval to the next; the current cycle runs from its approval to now. Select an approved version in Timeline to see its own cycle.

These are adjusted-price returns, not your personal P/L. Class results use opening holding values as weights, exclude later purchases and retain securities sold during the cycle. They do not include personal trade timing, fees or currency gains. Price-provider adjustments may include dividends and splits. Use the information icon for the opening statement, coverage and measurement details.

`—` means evidence is unavailable, not a zero return. A class needs price evidence for every opening holding; the best-performer summary needs the whole opening basket. Cash has no assumed interest return. Historical approvals are kept as recorded, including older versions closer together than the new four-month minimum.

## Colours And History

Click an asset-class colour square to choose from the shared palette. A single click previews the choice; Save or double-click confirms it. The same class colour is used across the application and does not represent Buy or Sell.

In [History](history.md), approval markers show the locked shape alongside the previous approval when available. An unavailable previous shape is not an all-zero portfolio.
