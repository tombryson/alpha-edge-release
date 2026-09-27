# Decision hierarchy

System gives a top-down view of risk state, current allocation, market signals and the positions currently held. It is a map of the existing rules, not another source of trade instructions.

## Asset-Class Index

Open **System > Asset classes** for the full classification index, including
classes you do not hold. Search by name, class code, parent or rationale; use the
Q1, Q1-Defensive and Q1-Exempt filters to narrow it down. **Decision flow** returns
to the numbered system overview.

- **Q1** classes receive the full Q3 equity-reduction sensitivity.
- **Q1-Defensive** classes remain within Q1 but have reduced Q3 sensitivity.
- **Q1-Exempt** classes sit outside Q1 equity reductions. They can still be affected
  by liquidity rules and Q4; this is not a claim that they are risk-free.
- **Cash / unclassified** keeps reserve and incomplete classifications separate.

The index uses the same configured `overlay_eligible` and `q3_beneficiary` flags
as Positions and Analysis. These are the application's strategy classifications,
not a generic industry definition of defensiveness. For example, the default
Telecommunications classification is Q1, while Infrastructure is Q1-Exempt.
Group labels and system buckets are identified separately from allocation classes.
The rationale comes from the backend configuration, including custom classes.
Missing configuration is shown as unclassified, never silently labelled exempt.

The index is read-only: browsing it does not change budgets or strategy rules.

## Read From Top To Bottom

The numbered review sequence is **01 Risk → 02 Allocation → 03 Markets → 04 Positions**.
The navigation and section headings share these stage numbers. They indicate the
order of review, not completed steps or additional trade approvals.

Start with Q3/Q4 and the current permitted budget. Then inspect the current asset-class mix, commodity and producer evidence, and finally the held positions and their signals. A company in Analysis but not held does not become a position just because it has research.

The chevron beside each section title collapses or expands its contents; all four sections start expanded. Collapsing a section keeps its title, summary and navigation available without clearing its search or position-group choices. The top section links expand their destination before jumping to it within the same scrolling page.

The outward arrows at the right of section headings open Positions, Portfolio or Markets. Market rows open their existing market detail; security rows return to Positions. Position groups can be collapsed, or searched by name, ticker or asset class. Search temporarily reveals matching rows and their held subtotals without changing the current expansion choices or holdings.

## Allocation And Signals

**Current allocation** uses the current portfolio-mix read model, including class cash as defined by Portfolio. It is not the approved target. The bar and class percentages use the same weights, with the shared class colours; open Portfolio to compare with an approved shape.

Commodity and Equity are separate columns. A market's `CONFIRMED` / `BLOCKED` evidence is displayed as **Bull** / **Bear**, matching Markets; it is not an instruction to place a trade. Legacy Waiting and Partial evidence remains distinct from No signal. No combined market confirmation count is used as a budget or permission.

Held securities show their existing Buy / Sell trend and their own Outperform evidence where assigned. The security table excludes non-allocating instruments and does not turn watchlist research into a holding. Values remain available on narrow screens beneath the name when the separate Held column no longer fits.

The same class or security should agree with its detailed page. Use Positions, Portfolio or Markets to act on the underlying workflow rather than treating a System summary as separate approval.

## Missing State

An empty state means the backend lacks usable evidence or the request failed. Supplying an API token fixes authorisation only. It cannot populate a database, establish a TradingView baseline or create a broker statement.

System rereads the existing risk, mix, market and position endpoints every 30 seconds, or on refresh. This does not fetch new market prices or generate signals. Failed sections are named in a warning; previously received values are retained while other sections keep working. Missing risk data is never labelled Normal or Clear.

The asset-class index rereads the registry and classification configuration every
60 seconds while open, with a refresh button. A failed refresh is flagged and
retains previously loaded classifications; it does not substitute static defaults
for a private account's settings.
