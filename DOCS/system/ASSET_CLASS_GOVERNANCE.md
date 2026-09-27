# Asset-Class Governance

Audit date: 5 June 2026.

Asset-class correctness is central to Alpha Edge. It controls portfolio shape,
analysis classification, group creation, ETF attribution, Q3/Q4 overlay
treatment, alert-stack presentation, and model packets. A small naming mistake
can make the UI show an existing class as a new `ADD` row or send the wrong
research lane to the model.

## Source Tables

| Table | Role | Use as assignment source? |
| --- | --- | --- |
| `asset_classes` | Canonical allocation and assignment vocabulary. | Yes. |
| `asset_class_config` | Risk-overlay behaviour and alert presentation metadata. | No. |
| `stock_analysis.primary_asset_class` | Per-security assignment, including ETFs. | Stores canonical class code. |
| `stock_groups.asset_class_code` | Visual group link to a canonical class. | Stores canonical class code. |
| `portfolio_mix_snapshot_rows.asset_class` | Approved target/baseline rows. | Stores canonical class code. |
| `portfolio_rebalance_plan_rows.asset_class` | Draft target rows. | Stores canonical class code. |

`asset_classes.code` is the canonical allocation key. User-facing display should
come from `asset_classes.display_name`, not from compressed backend strings.

Custom fund classes also live in `asset_classes`. They are valid allocation
buckets, but they are not stock-analysis classes.

## Canonical Versus Presentation

Canonical code:

```text
GOLD_MINERS
RARE_EARTHS_CRITICAL_MINERALS
PHARMA_BIOTECH
```

User-facing display:

```text
Gold Miners
Rare Earths & Critical Minerals
Pharma & Biotech
```

Alert-stack short label:

```text
Gold
Rare Earths
Pharma
```

These are three different jobs. Do not reuse the canonical code as UI text.

Colour is a fourth, presentation-only responsibility. The Terminal uses the
versioned code-keyed palette described in [Asset-Class Visual Identity](ASSET_CLASS_VISUAL_IDENTITY.md).
`asset_class_config.alert_color` remains stored for compatibility but no longer
overrides the Terminal palette. The colour registry does not define the list of
valid classes or change allocation assignments.

## Valid Assignment Flow

All assignment controls must read active rows from:

```text
GET /api/asset-classes
```

Consumers:

- Analysis tab `Asset Class` assignment
- ETF Monitor class assignment
- Positions group creation/autocomplete
- Portfolio target rows
- AI/model target packets
- stock recommendation logic

Rejected behaviour:

- free-typed class names that do not resolve to `asset_classes.code`
- hardcoded frontend class lists
- backend default maps that silently assign ETFs or stocks without user/system
  confirmation
- using `asset_class_config` as the selector list
- resolving unknowns to `MISC`, `ADD`, or a nearby class

Unknown or non-conforming values must surface as `UNASSIGNED`.

## Adding A New Asset Class

Example: `Mining Services`.

Required steps:

1. Add a canonical `asset_classes` row:

```text
code = MINING_SERVICES
asset_class_code = MINING_SERVICES
display_name = Mining Services
class_type = ALLOCATION
allow_grouping = 1
allow_target_weight = 1
active = 1
```

2. Add or update `asset_class_config` only if the class needs overlay behaviour
   or alert presentation metadata.
3. Add an Analyst Council research template mapping if the class needs its own
   research lane.
4. Update any seed/default registry file that creates canonical asset classes.
5. Run non-conforming assignment checks.
6. Run portfolio target creation and analysis assignment tests.

## Existing Data Migration Rule

Migration should be explicit and auditable.

Allowed:

- `GOLD` -> `GOLD_MINERS` when the security is a gold miner.
- `SILVER` -> `SILVER_MINERS` when the security is a silver miner.
- `ETF` security with known assignment -> valid `asset_classes.code`.

Not allowed:

- `RAREEARTHSCRITICALMINERALS` displayed directly to the UI.
- `PHARMA_BIOTECH` displayed directly to the UI.
- non-conforming stocks moved to `ADD`.
- ETFs assigned by hidden ticker defaults.

## ETF Assignment

ETF asset class assignment uses:

```text
stock_analysis.primary_asset_class
stock_analysis.security_type = ETF
```

Rules:

1. The value must resolve to active `asset_classes.code`.
2. Tactical-only ETFs may remain unmapped.
3. Core ETF attribution requires a confirmed asset class.
4. A missing ETF mapping must not hide the ETF from tactical momentum output.
5. ETFs may use a custom allocation class when no canonical stock-analysis class
   honestly describes the exposure.

## Custom Allocation Classes

Custom classes are allowed for fund and ETF grouping. They solve the case where
an ETF is useful for allocation but does not deserve a new stock-analysis
research lane.

Required properties:

```text
class_type = CUSTOM
analysis_eligible = false
instrument_scope = FUND
risk_bucket / quartile = required
```

Allowed:

- grouping funds and ETFs
- distributing portfolio target capital
- counting exposure in portfolio shape
- attributing ETF monitor rows

Not allowed:

- routing stock council analysis
- being created silently by hardcoded ticker maps
- replacing canonical classes where a proper canonical class already exists

## Model Packet Rule

AI portfolio target packets must send:

- canonical code
- display name
- allowed target status
- current weight/value
- optional policy metadata

They must not send:

- inactive asset classes
- `asset_class_config` rows that are not allocation buckets
- display parent groups
- unassigned securities as investable classes

## Validation Checklist

After asset-class changes:

1. `GET /api/asset-classes` returns the intended active vocabulary.
2. Analysis tab assignment dropdown uses that vocabulary.
3. ETF Monitor assignment dropdown uses that vocabulary.
4. Positions group creation rejects non-conforming groups.
5. New portfolio target starts from current shape without marking existing
   classes as `ADD`.
6. Model packets contain only canonical classes.
7. UI displays human-readable names, not compressed canonical codes.
