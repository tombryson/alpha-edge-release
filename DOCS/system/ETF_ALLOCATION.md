# ETF Allocation

Status: current source contract. Reviewed 11 September 2026 against
[allocation code](../../backend/etf_allocations.go),
[management profiles](../../backend/etf_management.go) and
[pooled capital policy](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md).
This is the current entry point; the old [v2 design](../decisions/ETF_SYSTEM_V2.md)
and legacy requirements retain historical context only.

## Authority And Budget

An ETF is an instrument type. Core is its role inside an asset class. Its
management mode determines accepted signal scripts and exit/re-entry behaviour.
These are independent concepts; choosing TMS does not make a fund a stock.

The approved portfolio shape defines class budgets. Current risk rules constrain
permitted implementation. A selected Core ETF receives a configurable fraction
of that class budget: 1:4 means 25%, 1:2 means 50%, 1:1 means 100%.
The former 25%-of-portfolio ETF pool is a planning reference, not another
enforced allocation layered on top of the class budgets.

## Momentum Translation

The allocation source is selected by policy. Calculation freshness and publication
are separate; a fresh ranking is not necessarily the weight currently used for
allocation. See [freshness](DATA_REFRESH_AND_FRESHNESS.md) and
[the model design](../decisions/ETF_SYSTEM_V2.md) for calculation details.

For a fund with a usable model weight:

```text
approved class budget = latest statement portfolio value * approved class weight
Core base = approved class budget * Core ratio
relative preference = model weight / equal-share reference
bounded preference = clamp(relative preference, 0.5, 1.5)
multiplier = 1 + (bounded preference - 1) * influence
recommended ratio = min(Core ratio * multiplier, 100%)
recommended Core target = approved class budget * recommended ratio
```

Influence is a configurable percentage, clamped to 0..100. The fallback is 50%,
not a market fact. At that influence the model can modify the base by at most
25% in either direction. With no usable model weight, the base remains unchanged.
The equal-share reference is a normalisation benchmark, not contributed money.
In a complete 15-member legacy model whose weights sum to 100, it is
100/15 = 6.67%. The current code actually sums the non-negative weights of model
members present in the loaded allocation rows and divides by that row count.
It falls back from non-positive `allocation_percent` to `base_weight`. Missing
rows or a non-100 total can therefore change the reference; 6.67 is not a literal
backend constant. Do not derive it from held funds or all Analysis ETFs.
Expanding the model universe is a
separate configuration/calculation concern from adding an ETF to Analysis.

Example: a class budget of $4,000 and 1:4 ratio gives a $1,000 base. A model
weight at 1.2 times the equal-share reference, with 50% influence, produces a
1.10 multiplier and a $1,100 recommended target. These are sizing calculations,
not an instruction to spend $100. Targets across classes are not a zero-sum
redistribution within a fixed ETF pool.

## Effective Target And Stock Capacity

The ledger caps the recommended ratio at 100% of the approved class and makes
the effective ratio zero when the fund's tactical state is Sell. Its displayed
class dollar budget is based on the approved shape, not a claim that every dollar
is presently permitted under Q3/Q4. Risk, live capacity, connections and cash are
checked again by the purchase/funding projection. An effective ledger target
must not be described as a funded Buy instruction.

A reduced or Sell-blocked ETF target does not reserve unused ETF capacity.
Stocks share the same class budget:

```text
stock capacity = max(0, class budget - max(effective ETF target, ETFs held))
```

Existing holdings still occupy capacity even when a target is zero. Capacity is
not cash. A recorded sale does not release spendable funds until validated
statement evidence; pending purchases also consume capacity/funding.
Live Analysis suggestions remain display-only and do not publish approved
stock targets or bypass funded-ticket checks.

## Optional Weight Management

The [approved weight-management contract](IDEAL_WEIGHT_MANAGEMENT.md) adds an
opt-in Core ETF rule: stop new money at the effective target, and propose a
reduction back to that target when coverage is at least 125% on two qualifying
daily observations and the proposed sale meets materiality. The excess/coverage display alone is not a reduction command.

The policy is Off by default. Its Off mode removes individual weight ceilings,
including the fund ceiling, while keeping class budgets, occupied ETF capital,
cash, Q3/Q4 and management-profile signals authoritative. Neither the momentum
adjustment bound nor the sidebar's colour/track thresholds define this policy.
Existing executions must remain reconciled when it is switched off.

## Management Modes

- `etf_tms`: dedicated ETF script; Sell uses the ETF exit policy.
- `tms`: stock-style CDF plus TMS signals, including their stop and re-entry semantics; the instrument remains an ETF.

Changing mode checks the previous mode and rejects unresolved execution or
ambiguous-exchange cases. It removes obsolete connections and requires an
explicit initial direction. Reconfigure the matching TradingView alerts in
Alerts. It does not change broker holdings. Core assignment, management mode,
model membership and connection setup must not be inferred from each other.

### Choosing A Profile

This is user guidance, not an automatic assignment rule. TMS can suit holdings
where retaining exposure through weaker trends is worth accepting potentially
deeper drawdowns. Partial reductions can leave existing units invested and defer
realising their gains; this does not defer gains on units sold or establish an
after-tax advantage. ETF TMS can suit tactical holdings where a full Sell exit
is preferred. Neither Core status nor volatility alone determines the choice.

A paired TradingView screen of eight funds
found mixed outcomes. Its execution and dividend sensitivities
prevent treating it as a validated selection model. The short Management tooltip
and ETF Help explain the trade-off; no new policy, tax calculation or trading
permission follows from this guidance.

## User Surfaces And Tests

Positions pins held Core funds and shows their read-only ratio. The optional
right sidebar owns Core controls, ETF target coverage and Line Fill/Capital Map;
it is not an independent trade queue. The full ETF page owns allocation detail
and ranking evidence. [User guide](../user/etfs.md) is also rendered in Help.

Regression owners: [allocation tests](../../backend/etf_allocations_test.go),
[management tests](../../backend/etf_management_test.go),
[momentum tests](../../backend/etf_momentum_test.go),
[sidebar tests](../../tests/context-panel.browser.test.cjs).
