# Research ledger

Analysis holds security-level research, watchlist items, Quality, Value, Council evidence, price targets and suggested allocation. Its scores remain live and advisory.

## Adjust The Table

Drag the right edge of a column heading to resize that column without squeezing
its neighbours. Widths are saved in this browser and retained when you hide and
restore columns, change tabs or reload. Analysis and Positions have separate
layouts, as do desktop and mobile.

Double-click a column edge to reset it, or use **Reset column widths** in the
Name column menu to restore the automatic layout. Press Escape to cancel a drag.
Focused column edges also support arrow-key adjustments: 10px normally, 1px with
Shift. Sorting, ticker reveal/pinning and the optional notes columns still work
independently of resizing.

In Sector view, class headings share their icons with Positions. Click the
triangle or chosen icon to expand or collapse the class. Hover it for 800ms,
then click the pencil to choose a different icon. Right-click or focus the icon
and press Arrow Down to open the same picker; on touchscreens, hold for 800ms.
The picker also offers neutral or class-coloured icons and the shared class
colour palette. Icon choices are saved in this browser and apply in both tabs;
changing one does not change the class's holdings or suggested allocation.

## Build A Research Record

Add a watchlist item with its correct exchange and ticker. Assign its asset class and instrument type. Marking a fund as an ETF enables fund-specific behaviour; it does not automatically select it as Core, add it to the momentum engine or establish a TradingView connection.

A small raised exclamation mark at the top-right of a security name means its
exchange is missing. Click it to assign the exchange. The existing **Data issues**
panel includes missing exchanges alongside failed, stale or incomplete feeds;
healthy feeds are omitted, and long provider errors are under **Details**.
Choose **Auto-assign** to fill missing exchanges from existing listing records
or verified lookups. This covers the missing securities counted in the panel,
including watchlist and external holdings; search and class focus do not narrow
the batch. Progress and **Assignment results** show which listings were assigned
and why others need review. Existing assignments and tickers are never replaced.
Dual listings, conflicting identities and unavailable providers remain manual
reviews. Auto-assign does not create alert connections or refresh price history.
Use **Review securities** in its missing-exchanges section to filter Analysis.
Search and view choices still apply; the missing count is before search and class
focus. Use **Show all securities** in the same panel to clear the filter, or fix
the remaining exchanges and the filter clears automatically. Assigned exchanges
remain accessible through the row's existing hover/edit controls.

Run or refresh research deliberately. A job may take time and can fail. Check its status and existing results before resubmitting an uncertain request, particularly when a paid provider is involved.

Click a security row's non-interactive area, or its Quality/Value score, to expand
the research comparison. Model rows align Quality, Value, price target and input
date; partial records remain labelled **Partial**, and missing values are not zeroes.
Click anywhere on a model row to inspect its run and add or edit its source text.
The edit-output and plus icons open the same editor, including from the keyboard.
Cancel and Escape discard unsaved editor changes. The collapse arrow closes the
comparison; Escape from inside it also closes it and returns focus to the opener.
Score buttons support Enter/Space. The panel stays within the visible table width
when columns scroll horizontally. On narrow screens, dates sit beneath model names.

**Council** is a separate saved result, not the mean of the four Web UI models;
the model-completion count does not describe Council completion. Available
TradingView, TipRanks and DeerFlow targets appear as additional source rows.
Hover **Average target** for the sources included in its existing equal-weight
calculation. A positive price target can contribute even if that provider's
Quality/Value record is incomplete. **Suggested weight** remains live advice,
not an approved security target. This presentation does not change sizing.

**Run Council** and **Rerun Council** in an expanded security row open the same
Council controls as the table's Council cell. Neither starts an analysis.
Review source attachments there, then choose Run/Rerun to review the security,
exchange, template and document. Only **Confirm and run** submits the job.
Closing and reopening the controls always resets that confirmation step.

The centered **Council analysis** dialog opens source preparation from the
**Source research** row beneath the security identity and template. The
**Saved result** remains separate. Quality, Value and Price target remain editable;
changes save when you leave the field. The document icon beside **Saved result**
opens **Model output**, including the existing source text and input date.
Click it again to close the editor. **Load latest**, **Saved runs** and **Clear result**
manage the saved analysis through the download, history and trash icons beside
the result heading, independently of the attachment for the next run.
**Source research** is a view inside this same dialog, not another modal.
Use the back arrow or Escape to return to Council; **Done** is also available
after attaching sources. The attachment is retained. The close button closes
the entire dialog.

## Retrieve Research Sources

Open a stock's Council controls and choose **Source research**, then select
**Retrieve automatically** (the left-hand default) or **Attach your own**. Only
the controls for the selected method are shown; switching methods preserves a
pasted draft. Source research uses the same size and position as Council analysis.
Opening instructions, **Web UI prompts**, saved research or manual attachments
does not resize the dialog. Long prompts, source results and the paste editor
scroll inside it. The tabs,
source-method choice and bottom action remain visible.

For automatic retrieval, the small template selector beside the ticker is
preselected from the asset class; an unmapped class requires a selection.
Review the template, then choose **Retrieve sources** at the bottom right
to start a paid Parallel Ultra 4x retrieval. Selecting the
automatic option alone does not make a paid request. The run is saved and
continues if you close the dialog. **Retrieval instructions**, beside the
attachment status in the footer, reveals the prompt and its copy button when needed.

The **Saved research** button appears when this security has saved runs. Open it
to inspect their status, document summaries and evidence gaps within the same
dialog, then use **Source options** to return. There is no empty saved-research
section. **Ready**
means the source packet passed format and identity checks, not that every fact
has been independently verified. **Attach to Council** selects the packet as the
supplementary document, replacing any current attachment. It does not start
Council or update scores. Choose **Done** to return to Council and review the run
confirmation when ready.

Already have the evidence? Select **Attach your own**, then **Paste** and
**Attach sources**, or **Upload** a PDF, Markdown, text or JSON document (up to
20 MB). **Attach sources**, **Attach to Council** and the Web UI **Copy prompt**
action use that same bottom-right position in their respective views.
This is the same single attachment used by retrieved research, not a
second document slot. Replacing it changes the attachment for the next Council
run; the remove icon clears it. Manual material is not provider-validated.
Attaching does not make a paid request. A paperclip beside **Source research**
in Council controls indicates an attachment, and the run confirmation names it.
Attachments survive closing the dialog, but not a full page reload; saved
Parallel results remain available to attach again.

If submission is uncertain, do not start a replacement. **Check submission**
reuses the existing request. If the provider accepted a request but its ID was
lost, **Recover run** links its existing Parallel run ID after checking it belongs
to this request. Results marked **Needs review** can be downloaded but cannot be
attached as validated packets. A completed run may still have evidence gaps.

The toolbar's **Template library** remains available for manual work. Choose a
template once, then switch between **Source research** instructions and **Web UI
prompts** for full external investment analysis. **Copy prompt** copies the selected
instructions. Prompts opened from a stock include its name, exchange and ticker;
the global library keeps identity placeholders. Neither copying nor opening the
library makes a paid research call.

## Check Monitoring Coverage

The small connection indicator beside each security reports which required
TradingView alerts are recorded in Alpha Edge. Hover it to see missing setup:

- Green: all required connections are recorded.
- Amber: some are recorded; the tooltip names what is missing.
- Red: none of the required connections are recorded.
- Grey: connection data, required configuration or the ETF management profile
  is unavailable, or the ticker/benchmark needs configuration.

Stocks require CDF and TMS. Stocks assigned to a configured commodity producer
class also require their own Outperform CDF against that class's current equity
benchmark. A watchlist stock with only CDF is partially monitored, not fully
monitored. Complete the remaining setup in Alerts when appropriate.

ETFs follow their selected management profile: ETF mode requires ETF TMS; TMS
mode requires CDF and TMS. ETFs do not require the stock Outperform feed under
either profile. Core selection alone does not establish any connection.

Green does not mean Buy, permission to purchase, or proof that a feed is fresh.
A connected Sell signal still has full connection coverage. Positions and the
ETF sidebar use the same coverage rules.

## Read A Row

Columns run from the security to its sizing result: Price and Upside sit beside
the name, then Quality, Value and their **Total**, Council, Signal, Thesis Δ,
**Target WT**, MOM and In/Out.

- **Upside** shows the average price target. Hover it for the upside percentage,
  which is what sizing uses: red below 0%, amber below 50% and green at 50% or
  more.
- **Total** is the average of Quality and Value across the completed research
  models. Council scores and momentum do not change it; momentum and the
  Council price target reach only Target Weight.
- Quality, Value, Total and Council show strong scores (80 or more) in green
  and weak scores (below 50) in red; the middle range stays neutral.
- **Signal** shows ↑ Buy in green, ↓ Sell in red and → Hold in amber.
  **Thesis Δ** is green when positive and red when negative; zero is neutral.
- **Target WT** shows one value: the security's share of the class. Hover it for
  the anchored dollar target when class budgets apply.
- Council shows its source age only when it is older than 90 days.
- **In** and **Out** are plain text; select them to change sizing participation.

## Compare Like With Like

The **MOM** column displays and sorts by six-month adjusted-close returns for both stocks and ETFs, using the same price-history calculation as the asset-class performance summaries. Missing history displays a dash, not a zero or a return from a different period. Hover shows the price-data date and any stale-data warning.

Stocks and ETFs share the same sign-only return colours: green above 0%, red below 0% and neutral at zero. ETF returns remain visible on hover; no stock sizing modifier applies to them. The separate ETF Ranking view keeps its existing 80/240-session momentum model, scores and allocation logic unchanged.

Suggested percentages can change with research, momentum and new evidence. They do not approve a new portfolio shape or place orders. Analysis weights the IN research universe, including unheld candidates. Positions' **Ideal wt** uses the same engine across actual holdings, independently of Analysis IN/OUT, and expresses the result as a share of the whole class after ETF allocation. When both stock sets match, the weights agree after this ETF adjustment.

An optional [Weight management policy](positions.md)
defaults Off. Enabling it in Positions
uses the backend held-stock ideal amount to limit new purchases and review material
excess, without freezing research or turning the Analysis watchlist into holdings.

**Data issues > Incomplete sizing research** flags stocks without a complete
primary-model result (Quality, Value and that model's price target). It includes
IN research stocks and held stocks, even when OUT in Analysis. **Review research**
filters the table to those securities; **Show all securities** clears the filter.
Analysis can still compare its researched candidates. Positions is stricter:
if any held stock lacks a complete model result, the whole class's stock
**Ideal wt** values show dashes until research is complete. Core ETF targets
are independent. One complete Gemini, Perplexity, GPT or Claude result per held
stock is sufficient; all four are not required. Council alone does not provide
the sizing base score. Missing current prices also withhold the class reference;
use the existing price refresh controls. See [Ideal weight](positions.md).

## Review Identity Problems

A provider-name mismatch or unavailable listing opens evidence for review. It does not prove delisting or identify a successor ticker. Confirm name, exchange and ticker changes using reliable evidence; check the associated TradingView connections after changing symbols.

The archive icon beside a security's name retires it from allocations, rankings and strategy views. Unlike In/Out, which controls sizing participation while keeping research visible, archiving hides the instrument by default. Held instruments require confirmation; broker holdings, account totals and statement history are not deleted or sold. Use Analysis view options > Show excluded instruments to inspect archived rows and the restore arrow to return one to strategy, rather than creating a duplicate research row.
