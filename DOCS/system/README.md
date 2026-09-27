# System Guide

Current reference layer. Older documents may contain dated design history;
explicit unresolved sections remain unresolved. See the reconciliation report.

## Ownership Map

| Concern | Canonical reference |
| --- | --- |
| Product and service boundaries | [Product architecture](PRODUCT_ARCHITECTURE.md), [runtime architecture](ARCHITECTURE.md) |
| Portfolio rules and terminology | [Business logic](BUSINESS_LOGIC.md), [glossary](GLOSSARY.md) |
| Approved shape and mandate | [Portfolio mandate](PORTFOLIO_MANDATE_MODEL.md) |
| Four-month approval interval and cycle returns | [Portfolio cycles](PORTFOLIO_CYCLES.md) |
| Shared stock/ETF budget and funded purchases | [Pooled capital policy](POOLED_CAPITAL_DEPLOYMENT_POLICY_V1.md) |
| Optional Ideal wt limits and excess reductions | [Ideal weight management](IDEAL_WEIGHT_MANAGEMENT.md) (approved; implementation pending) |
| Current Core ETF translation | [ETF allocation](ETF_ALLOCATION.md) |
| Signal, execution and statement state | [Signal and action contract](SIGNAL_AND_ACTION_CONTRACT.md) |
| Q3/Q4 and rebalance workflows | [Actions workflows](ACTIONS_WORKFLOWS.md) |
| Decision process | [Decision flows](DECISION_FLOWS.md) |
| Tables and persistence | [Data model](DATA_MODEL.md), [database upgrades and recovery](../operations/DATABASE_UPGRADES_AND_RECOVERY.md) |
| Class identity and assignment | [Governance](ASSET_CLASS_GOVERNANCE.md), [visual identity](ASSET_CLASS_VISUAL_IDENTITY.md) |
| Research and Intelligence integration | [Analysis and Council](ANALYSIS_AND_COUNCIL.md), [source research](SOURCE_RESEARCH.md) |
| Listing evidence and renames | [Identity verification](WATCHLIST_IDENTITY_VERIFICATION_V1.md) |
| Commodity and producer gates | [Commodity presentation and signals](COMMODITY_THEME_PRESENTATION_AND_SIGNAL_CONTRACT.md) |
| Prices, scheduling and source dates | [Data freshness](DATA_REFRESH_AND_FRESHNESS.md) |
| Statement-derived performance | [Performance and charting](PERFORMANCE_AND_CHARTING.md) |

## Supporting Research


## Core Boundaries

The **Trading Terminal** owns holdings, approved class budgets, signal state,
operator responses and statement reconciliation. **Alpha Edge Intelligence**
hosts the Analyst Council, Announcement Router and Portfolio Analysis. This repo
contains the Terminal and its Council proxy, not the separate Alpha Edge
Intelligence implementation.

Broker holdings are evidence of what is owned. Approved shapes express intended
class allocation. Risk and trend gates constrain implementation. Live research
is currently advisory. The approved, not-yet-implemented [weight management
policy](IDEAL_WEIGHT_MANAGEMENT.md) defines explicit opt-in purchase ceilings and
reduction proposals; its default is Off. A signal, a user-recorded execution and a broker-confirmed change
are three different events. Alpha Edge does not place orders at the broker.
