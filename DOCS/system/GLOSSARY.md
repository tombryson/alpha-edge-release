# Glossary And UI Language

Audit date: 5 June 2026.

Use this document for approved user-facing language and legacy terms to avoid.

## Approved Terms

| Term | Meaning |
| --- | --- |
| Alpha Edge | The complete investment operating system. |
| Trading Terminal | The opening Alpha Edge user interface and primary ledger/workflow surface. It is not a separate product. |
| Intelligence Service | The separately deployed Alpha Edge analysis runtime. It contains the Analyst Council, Announcement Router, and Portfolio Analysis workflows. |
| Analyst Council | Per-security research capability that creates research packets and linked run artefacts. It is not an action or broker-execution system. |
| Announcement Router | Announcement-driven scenario/thesis assessment capability. Its results are evidence and may only enter actions through the normal Terminal workflow. |
| Portfolio Analysis | Top-down Intelligence workflow that produces a Portfolio Memo from a Terminal portfolio snapshot. |
| Portfolio Memo | Persisted Portfolio Analysis artefact. It is a strategic prior and may inform a draft target or News foundation; it is not an approved target or order. |
| Portfolio Risk | Q3/Q4 detector-driven risk overlay. |
| Portfolio Rebalancing | User or AI-created strategic asset-class target workflow. |
| Q3 Detector | Percentage-based Q1 exposure throttle. |
| Q4 Crisis | BUY/SELL crisis detector; SELL maps to 10% market exposure. |
| Q3 allocation available | Q3 risk-on state where higher Q1 allocation is permitted but not forced. |
| Q1 exposure target | User-facing description of Q3 detector percentage. |
| Market exposure target | User-facing description of Q4 crisis percentage. |
| Selected Sleeve | The class/sleeve currently being edited or inspected in an action. |
| Required | Amount required by the active workflow for the selected sleeve. |
| Recorded | Amount the user has entered or confirmed. |
| Remaining | Required amount minus recorded amount. |
| Portfolio reserve cash | Portfolio-level cash created by Q3/Q4 or portfolio target reductions. |
| Tactical class cash | Cash held inside an asset class due to stock-level gating or trims. |
| Cash-equivalent instrument | Instrument treated as cash/staging rather than ordinary equity exposure; currently includes `BSUB` and `ASX:AAA`. |
| Core ETF | ETF exposure used to implement an approved asset-class sleeve. |
| Tactical ETF | ETF exposure allocated by the ETF momentum model. |
| Outperform | A configured security / core-fund relative signal for a commodity-linked security. Current code requires registration and a known direction, but direction does not impose a 75%/100% cap or enlarge a purchase ticket. An explicit sizing rule remains under discussion; live research is advisory. |
| Equity Regime Strong Trim | A class-scoped 20% producer-equity reduction signal created when a configured core fund / commodity ratio turns SELL. It excludes the direct-commodity sleeve and is distinct from a TMS oscillator trim. |
| ETF target gap | Gap between actual ETF exposure and the ETF policy target. |
| Custom allocation class | Fund/ETF grouping bucket that can receive allocation but cannot route stock analysis. |
| Analysis eligible | Whether an asset class can be used as a stock-analysis or council research lane. |
| Baseline | Approved strategic portfolio mix snapshot. |
| Target | Draft or intended portfolio mix before approval. |
| Drift | Difference between current allocation and approved baseline/target. |
| Statement match | Imported broker statement matches expected workflow result within tolerance. |
| Variance | Imported broker statement differs from expected workflow result. |

## Signal Terms

| Raw signal | UI/action language |
| --- | --- |
| `strong_add` | Add · Strong setup |
| `weak_add` | Add · Weak setup |
| `strong_trim` | Trim · Strong setup |
| `weak_trim` | Trim · Weak setup |
| `cdf_sell_zone` | Sell Down 20% |
| `SELL_50` | Sell Down 50% |
| `EXIT` | Exit |
| `REDUCE_TO_OUTPERFORM_LIMIT` | Outperform trim |
| `EQUITY_REGIME_STRONG_TRIM` | Equity Regime Strong Trim 20% |
| `BREAKOUT` | Breakout |
| `BUY` | Buy |
| legacy full `SELL` | Exit |
| `IGNORE` | Ignore |
| `EXPIRED` | Expired |
| `NOT_APPLICABLE` | Mechanically closed, including simulator resets; not proof of a sale or statement verification. |

User-facing alert labels should use sentence/title case consistently. Do not
mix `BREAKOUT`, `Breakout`, and `breakout` on the same surface.

`Sell Down` is the user-facing term for percentage reductions. `Exit` is the
user-facing term for a full position removal. Raw backend `SELL` remains a
compatibility transport value during migration and must not be displayed as
`Liquidate`.

`Strong` and `Weak` describe supporting TMS evidence and timeframe context. They
must not imply an arbitrary dollar difference between Add recommendations. The
main buy-side action is `Deploy`, `Add`, or `Re-enter` followed by an explicit
dollar ticket.

## Terms To Avoid Or Use Carefully

| Term | Issue | Preferred language |
| --- | --- | --- |
| Governed | Vague and overused. | Q1-sensitive, Q3-sensitive, or actual class name. |
| Headroom | Only valid for Q3 risk-on capacity; misleading for reductions. | Q3 allocation available, remaining capacity. |
| Accept Cap Only | Opaque. | Mark Reviewed. |
| Approve Baseline | Misleading for Q3/Q4 actions. | Review Portfolio Shape or Mark Reviewed. |
| Action awaiting statement | Backwards/unclear. | Awaiting statement. |
| Underlying controller state | Too technical for UI. | Q3 state, Q4 state, Portfolio Risk state. |
| Core/tactical combined role | Ambiguous. | Use either Core ETF, Tactical ETF, or Excluded. |
| Leadership | Ambiguous and inconsistent with the signal contract. | Outperform. |
| Off shape | Unclear. | Drift, excess, or unmapped depending on actual meaning. |

## Casing Rules

1. UI labels use title case or sentence case by surface, not raw backend casing.
2. Canonical database codes are uppercase snake case and should stay out of UI.
3. Alert Stack short labels should be compact: `Gold`, `Silver`, `Copper`.
4. Backend status values may remain uppercase, but UI should translate them.
