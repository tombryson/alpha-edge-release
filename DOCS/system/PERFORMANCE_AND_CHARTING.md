# Performance And Charting

Portfolio's cycle-specific **Return %** is a separate opening-basket adjusted-price
reference, not a statement value change or personal P/L. Its approval boundaries,
four-month policy, coverage and calculation rules are defined in
[Portfolio cycles](PORTFOLIO_CYCLES.md).

Audit date: 5 June 2026.

Performance charts must be based on accounting truth first. External market data
can supplement charts, but it must not overwrite broker statement values used
for portfolio valuation.

## Source Of Truth

| Data | Authoritative source | Notes |
| --- | --- | --- |
| Portfolio value | Broker/account statement import | Used for portfolio performance. |
| Holding value and units | Broker/account statement import | Reflects actual holdings after trades/corporate actions. |
| Daily security price for held securities | Statement import where available | Preferred for held positions. |
| Watchlist or historical backfill price | External market API | Supplementary and potentially stale/wrong. |
| Decision/event history | `alerts`, `decisions`, workflow tables | Used as chart overlays. |

Yahoo or other free market APIs are useful for context, but broker-imported
prices remain authoritative for portfolio valuation.

## Backend Endpoints

```text
GET /api/performance/portfolio
GET /api/performance/asset-classes
GET /api/performance/security/{ticker}
GET /api/performance/events
GET /api/performance/security-directions
POST /api/analysis/performance/refresh
```

## Portfolio Performance

Portfolio performance should show statement-derived value over time.

Required chart data:

- statement date
- total value
- cash value
- invested value where available
- change and change percentage

Portfolio-level events may include:

- Q3 detector transitions
- Q4 crisis transitions
- portfolio target approval
- statement imports
- new capital

## Asset-Class Performance

Asset-class charts should show composition over time.

Required values:

- asset class code
- display name
- value
- portfolio weight percentage
- class cash where available
- statement date

Asset-class charts must use canonical display names from `asset_classes`, not
compressed backend codes.

## Security Performance

Security charts should show the selected ticker's price or value history.

Primary display:

- price line by default
- value line optional/toggleable
- units optional where useful

Price change is more important than position value change for a stock chart.
Value is useful context, but it should not dominate the chart if it hides price
movement.

## Event Overlays

Events should be labelled by their actual trading meaning, not generic source
terms.

Examples:

```text
ADD
TRIM
SELL_DOWN
SELL
BREAKOUT
IGNORE
EXPIRED
Q3
Q4
```

Rules:

1. ADD markers belong below the price line where practical.
2. TRIM/SELL markers belong above the price line where practical.
3. Strength and timeframe should be visible on hover or compact marker detail.
4. Multiple events on the same day should be grouped in a hover tooltip.
5. `IGNORE` and `EXPIRED` are distinct audit outcomes.
6. Do not render unexplained vertical lines without a legend or hover detail.

## Alert Expiry

`IGNORE` is a user decision.

`EXPIRED` is a system resolution caused by time passing without action.

Charting may group both as "not acted" in summaries, but the detailed event
tooltip must preserve the difference.

## Corporate Actions

Splits, consolidations, capital raisings, and in-specie events can distort
external price history.

Rules:

1. Statement imports are the correction source for actual holdings and values.
2. Large price discontinuities should be reviewable rather than silently trusted.
3. Manually corrected PT fields should not be overwritten by stale provider data.
4. External backfill should be labelled as supplementary if used.

## UI Contract

The History tab should separate:

1. signal/decision history
2. portfolio performance
3. selected security history

Opening stock history from the Positions tab should select the security and
route the user to the History tab. The stock selector in History should also
allow direct selection.

## Gaps

1. No dedicated time-series tables are documented for immutable daily snapshots.
2. External price source, rate limits, and failure behaviour are not formalised.
3. Event overlay marker collision rules are not final.
4. ETF attribution history is not yet persisted as daily core/tactical/drift
   snapshots.
