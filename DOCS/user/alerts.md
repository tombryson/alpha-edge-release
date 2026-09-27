# Alert connections

Alerts is the setup ledger for TradingView signals and announcement emails from HotCopper and Seeking Alpha. It records which alerts you have configured, not which positions should be bought or sold.

## Watchlist Entries

Use the horizontal **Positions / Watchlist** selector in the left Alert Stack.
Both views use the same asset-class groups, alert chips and expand/collapse control.
Positions shows held-position alerts; Watchlist shows received alerts for unheld
watchlist securities, not the entire research universe. Portfolio risk stays above
both views. Breakout and Outperform describe
different evidence; Outperform names the configured benchmark on hover, not an
assumed broad-market index. Current holdings remain under **Positions**.

Select a row to open **Entry review** in the right sidebar. It shows a suggested
first-entry amount or the reason entry is paused, plus class exposure, cash and
the candidate's prospective Ideal wt. **Peer Ideal wt** compares the model with
and without that one candidate. It does not recommend selling the differences.

**Ready to review** means the existing research, signal, risk, class-capacity and
statement-backed funding checks pass. It is not an order or a new quality-score
endorsement. Check the current execution price against the entry rule yourself.
Incomplete research, stale statement/price evidence, missing signals, full
classes and pending trades stay visible with a reason.

Each candidate is an alternative use of the same cash, not a reserved allocation.
Opening this view never changes held Ideal weights, creates an order, trims a
position or moves money. **Review action**, when a current action exists, opens
the existing execution review; recording still rechecks permission and funding.
After a statement confirms a holding, it leaves the unheld watchlist view.

Watchlist connection setup remains in **Alerts > Watchlist**. Research remains in
Analysis; entry assessment is opened from a watchlist alert in the stack.

## Set Up A Connection

First configure the correct script, ticker or ratio and webhook in TradingView. Then confirm that setup in the matching row in Alpha Edge. The checkbox records your confirmation; it does not create a TradingView alert remotely.

For CDF and dedicated ETF signals, supply the current Buy or Sell direction when initialising. This provides a usable baseline before the next transition arrives. TMS setup is connection-only. Repeated TradingView restart connection messages must not overwrite a deliberate baseline.

Commodity rows contain the physical commodity and producer-equity connections. Company outperformance appears with stock connections. A missing ticker needs correction before the matching feed can be trusted. Ensure an ETF's chosen management mode matches its configured scripts.

The connection indicators in Analysis and Positions include a commodity stock's
required Outperform connection. Their hover text names missing setup. ETFs use
their selected ETF/TMS profile, not their Core assignment. See
[Analysis guide](analysis.md) for the monitoring colour key.

## Set Up Announcement Emails

Open **Alerts > Announcements**. The tab shows the number needing setup. A visible
reminder above the other connection tables also opens this list directly.

Adding a security to Alpha Edge does not add it to HotCopper or Seeking Alpha.
IG statement imports do not configure these announcement subscriptions.
ASX securities default to **HotCopper**; all other exchanges default to
**Seeking Alpha**. Saved provider confirmations are retained unless the listing
changes. Open the provider's watchlist/portfolio and enable that security's
announcement/news emails to the mailbox used by your Announcement Router.
Return and use the checkmark to **Mark configured**. Select several rows to
confirm subscriptions you have already enabled, up to 100 at a time.

**Configured** records your confirmation, not proof an announcement was delivered.
Opening the provider link alone never clears the reminder. New securities start
unconfirmed; no subscription is inferred from a broker import, research result
or TradingView connection. ETFs and OUT research are included; hidden instruments
are not. Missing tickers or exchanges must be fixed before confirming.

Use **All** to review saved setup or reset it with the undo icon. A ticker or
exchange change requests a recheck. Confirmation follows the security across
imports and restarts. **Announcements** remains accessible after all reminders
are cleared. The public demo can show the list but cannot save confirmations.

This reminder neither blocks purchases nor changes Ideal wt, and does not create
Alert Stack trading chips. The green TradingView connection indicator does not
verify announcement email subscriptions.

Provider references: [HotCopper watchlist](https://hotcopper.com.au/watchlist/)
and [Seeking Alpha email alerts](https://help.seekingalpha.com/basic/how-do-i-manage-my-email-alerts).

## Connection Is Not Freshness

A confirmed checkbox means the setup was recorded. It is not proof that TradingView is still running, that a new signal has arrived, or that prices are fresh. Check the latest signal evidence and source dates separately.

## Where Actions Live

Use the left Alert Stack for current decisions. Ordinary statement waits do not require another click and remain in [History](history.md). Missing or failed webhook processing belongs to integration diagnosis, not a new Buy/Sell instruction.
