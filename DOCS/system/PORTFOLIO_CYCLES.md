# Portfolio Cycles

Status: implemented, 18 September 2026. This policy governs shape approvals,
not the timing of individual security trades or Q3/Q4 protection.

## Approval Interval

- A cycle starts at a saved shape's approval timestamp and ends at the next
  approval. The latest cycle remains open through the current time.
- The first approval is unrestricted. Every subsequent approval must be at least
  **four calendar months** after the latest saved approval. This is not 120 days.
- Boundaries use UTC and preserve the time of day. Month ends clamp to the last
  valid day: 31 October becomes 28 February, or 29 February in a leap year.
- There is no discretionary override or reason-code bypass. Both Approve current
  and Approve baseline call the same transactional store guard. A restart does
  not reset the interval. A rejected approval changes neither the old shape nor
  the associated plan state.
- Research, comparisons and target planning remain available. A target plan may
  be prepared and its actions recorded, but the replacement baseline cannot be
  approved early. The confirmation UI shows the next permissible approval date.
- Q3/Q4 operate on implementation capacity and do not create a new approved
  shape. Their reductions, exits, reserve movements and confirmations are not
  delayed by this interval. Ordinary signal-driven adds/trims remain separate.
- Existing approval records are not deleted, merged or redated. Older cycles
  shorter than four months can still be inspected. Equal-date legacy approvals
  use the saved ID as a tie-breaker; no measurable period means no return.

## Return Measurement

**Return % is a fixed opening-basket adjusted-price reference, not personal P/L,
allocation change, or a return on the approved percentages themselves.**

1. Select the latest broker performance snapshot at or before approval, no more
   than seven calendar days old. Use its positive-unit, positive-value holdings,
   recorded asset classes and opening AUD market values. Never substitute
   today's holdings, research universe or target weights.
2. Match securities by exact exchange and ticker. Ambiguous or missing identity
   stays unavailable; an exchange is not guessed. Holdings sold later remain in
   the opening basket. New purchases enter the next cycle's opening basket.
3. At each boundary select the latest stored Yahoo daily adjusted close in the
   preceding seven calendar days, strictly before the UTC boundary date. This
   excludes a closing bar that may not yet have existed when approval occurred.
   No provider request or paid job is started by viewing this information.
4. Both prices must be positive, use the same Yahoo series and currency, and have
   different dates. The security return is `(ending adjusted close / opening
   adjusted close - 1) * 100`. Actual price dates are returned in the API.
5. Class return is the opening-AUD-capital-weighted average of its securities'
   listing-currency returns. Later purchases, sales and cash movements do not
   enter that calculation. Currency translation gains/losses, fees and personal
   trade timing are not measured. Provider price adjustments may incorporate
   splits and dividends; this is not a separate dividend accounting ledger.
6. Every opening holding in a class must have valid price evidence before a
   class return is shown. Missing members are not discarded or renormalised.
   Coverage counts and capital coverage remain available with the reason.
7. The best-performing security is the highest return across the entire opening
   basket, including ETFs. It is withheld unless the whole basket is covered.
   If every return is negative, the best performer can also be negative.
8. Cash has no assumed interest return. Classes without opening holdings,
   missing boundaries, stale prices, changed series or incomplete evidence show
   `—`, never an invented zero. Rounded near-zero returns have neutral styling.

This is a benchmark for the assets held when a shape was designated. It does
not establish that changing the shape caused the outcome. A genuine account
return requires complete trade, external cash-flow, dividend and FX accounting.

## Storage And Presentation

The implementation reads `portfolio_mix_snapshots`, `portfolio_mix_snapshot_rows`,
`portfolio_daily_snapshots`, `security_position_snapshots` and
`security_price_daily` in one read transaction. It adds no database tables and
does not rewrite existing evidence. Corrected statements or price corrections
can change a previously displayed result; the measure is recomputed, not a
frozen performance attestation. Historical snapshots without trustworthy
opening evidence remain unavailable. External positions absent from the broker
snapshot cannot be included in its cohort.

Portfolio places Return % directly after Approved, independent of Compare.
The compact cycle summary gives the interval and best performer. Its information
button explains the basis and coverage. Timeline approvals show the selected
version's cycle, not today's cycle; memo and unapproved draft records have no
cycle return. Historical allocation differences remain in percentage points.

The public demo uses isolated synthetic cycle fixtures with four-month approval
spacing, no private account data and no provider calls. These fixture dates are
not changes to any real approval history.

## API And Verification

- `GET /api/portfolio-mix/cycle-performance?snapshot_id=N`: omitted ID selects
  the latest approval. Explicit IDs must be positive; nonexistent IDs return
  404. Missing data is a 200 response with null returns and reasons, not a zero.
- `GET /api/portfolio-mix/approved` includes `approval_policy` with
  `minimum_months`, `can_approve` and `next_allowed_at` when a baseline exists.
- Both approval endpoints return HTTP 409 and JSON
  `code: PORTFOLIO_CYCLE_LOCKED`, `error`, `next_allowed_at` when locked.

Tests cover calendar boundaries, restarts, no reason bypass, active/closed
cycles, sold holdings, exchange collisions, corrections, missing/stale evidence,
changed currencies/series, no look-ahead and read-only behavior. Browser tests
cover column placement, Timeline selection, unavailable states and small screens.

See [user guide](../user/portfolio.md), [performance boundaries](PERFORMANCE_AND_CHARTING.md)
and [API reference](../api/API_REFERENCE.md).
