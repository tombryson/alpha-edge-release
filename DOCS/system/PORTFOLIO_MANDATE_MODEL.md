# Portfolio Mandate Model — Proposal

Status: `Agreed in principle — §8 decided. Nothing implemented; see §9 for sequence.`

Written after a fund (UFO, Procure Space) showed a `$0` target while being Core for
its class, connected, and holding capital. Nothing was broken. The class it carries
is simply not one the approved shape funds, and the system had no way to say so.

This model is portfolio-wide, not ETF-specific. It governs the relationship between
what a security **is** and what a security is **funded to be**, and
[ETF Model §3–§5](../decisions/ETF_MODEL_PROPOSAL.md) are a specialisation of it.

---

## 1. One field, two facts

`stock_analysis.primary_asset_class` currently carries two claims that are not the
same claim:

| Claim | Nature | Who decides | Changes when |
| --- | --- | --- | --- |
| **What this security is** | Taxonomy. Objectively checkable. | Research — manual, LLM, or heuristic | The security's business changes |
| **Which sleeve's capital it draws** | Policy. A judgement. | You, at shape approval | Your view changes |

UFO **is** civil aerospace. That is true whether or not you have ever allocated a
dollar to civil aerospace. The classification is correct; what is absent is an
allocation decision. Because one column carries both meanings, the system reads a
correct taxonomy statement as a funding claim, finds no funding, and produces `$0`
with no explanation.

Every symptom in this area traces back to that conflation.

## 2. The mandate rule

> **The approved portfolio shape is the mandate.** A class draws capital if and only
> if the shape carries a weight on it. Classification never confers funding.

Two consequences, both deliberate:

**Classification is free.** Assigning a class is never blocked, never warned against,
never constrained to the funded set. Researching and classifying something you do not
yet fund is not a mistake — it is how a shape comes to be revised. A system that
nagged here would be fighting the investment process.

**Funding is closed.** Only the shape's classes size positions. There is no implicit
fallback to a parent class, no inheritance, no "near enough" match. A class outside
the mandate produces no target, and that fact is stated rather than left to be
inferred from a zero.

## 3. Four states, all of them useful

With the two facts separated, every security sits in exactly one state, and each is
something worth looking at:

| State | Condition | What it means | Where it belongs |
| --- | --- | --- | --- |
| **Funded** | Class in mandate | Normal. Has a target. | Ledger / Positions |
| **Researched, not mandated** | Classed, not in mandate, not held | A candidate for the next shape review | Shape review queue (Portfolio tab) |
| **Off-mandate** | Classed, not in mandate, **held** | Capital deployed outside policy | Exception report |
| **Unexpressed** | In mandate, nothing classed to it | Capital allocated with nothing to put in it | Coverage gap |

States 2 and 3 are not errors and must not be presented as errors.

**Researched, not mandated** is the research funnel: *the things I have conviction in
that my policy does not currently fund*. That is the input to the next shape revision,
and it is the most valuable list the system can produce. The ETF model's shortlist
([§3](../decisions/ETF_MODEL_PROPOSAL.md)) is this state scoped to funds; it generalises.

**Off-mandate** is money outside policy. A portfolio manager must never be blind to
it. Today it renders identically to state 2 — as `no target` — which throws away the
distinction between "something I might buy" and "something I already own that my
policy does not sanction".

**Unexpressed** is the mirror: a sleeve you have funded and not filled. Already
handled for ETFs; the same treatment applies to stock sleeves.

## 4. Shape approval is the reconciliation

Approving a shape is where policy meets reality, so it is where the two lists are
brought together. Approval should show, before it commits:

- **Newly funded** — classes entering the mandate, and the researched securities that
  become investable the moment it is approved
- **Stranded** — classes leaving the mandate, and any positions that become
  off-mandate as a result
- **Unexpressed** — funded classes with nothing classed to them

That turns shape approval into a genuine portfolio review rather than a weights
edit, and it is the only moment where changing the mandate is a considered act rather
than a side effect.

## 5. What each surface does

| Surface | Shows |
| --- | --- |
| **Portfolio Shape** | The mandate. The authoritative funded list, plus the three reconciliation reports above at approval time |
| **Positions** | Holdings, with off-mandate positions marked as such. Stocks and funds alike — the mandate binds both |
| **ETF Monitor** | Funded ETF sleeves; `class unfunded` where a mapped fund's class is outside the mandate |
| **Analysis** | Free classification. No constraint, but shows whether a class is currently in the mandate so the consequence is visible at the moment of choice |
| **Shape review queue** | Lives in the Portfolio tab, beside the shape it feeds. State 2 — researched, not mandated — ranked by conviction, momentum and any holding |

The Analysis point is the important one: the goal is not to *prevent* off-mandate
classification but to make its consequence **visible while choosing**, so that
classifying something outside the mandate is an informed act.

## 6. What this retires

- Reading a `$0` target as a display problem. Under this model `$0` has exactly three
  causes and each is named: gate closed, class outside mandate, class invalid.
- The idea that classification should be constrained to the funded set. It should not.
- Reclassifying a security to make a number appear. Under this model that is a
  taxonomy corruption, not a fix — see §7.

## 7. Worked example — UFO

Facts, from `GET /api/asset-classes/trace/UFO`:

- Stored class `CIVIL_AEROSPACE`, single analysis row, no group, no re-resolution
- Core policy exists, `core_ticker = UFO`, gate open
- Approved shape funds 18 classes; neither `CIVIL_AEROSPACE` nor its parent
  `INDUSTRIALS` is among them
- $557 held

State: **off-mandate**. The three available responses, and what each means:

1. **Add `CIVIL_AEROSPACE` to the shape** — you have conviction and want the sleeve.
   Correct if true; takes weight from something else.
2. **Exit the position** — you do not want the exposure. Correct if true.
3. **Reclassify UFO to `TECHNOLOGY`** — makes the number appear, and is the wrong
   answer. It records a taxonomy falsehood to silence a policy warning, and you lose
   the information that you hold aerospace exposure.

Only 1 and 2 are portfolio decisions. 3 is a workaround, and the fact that it is
currently the *easiest* of the three is itself an argument for this model.

## 8. Decided

**1. The mandate binds stocks as well as ETFs.** A stock in an unfunded class is as
off-mandate as a fund. There is one mandate and it governs every security; the ETF
layer is a specialisation of it, not an exception to it. Every state in §3 applies to
stocks unchanged.

**2. Off-mandate holdings count toward exposure.** They are real money. They count in
actual totals, portfolio value and exposure percentages, and they are excluded only
from *target* maths, because their class has no target to contribute to.

The consequence is that actual and target exposure will legitimately disagree by the
value of everything off-mandate, and that gap must be explained rather than left to
look like a rounding error. Exposure summaries carry an **of which off-mandate**
figure, so the difference between "I am over my target exposure" and "I hold things
my policy does not fund" is never guesswork.

**3. The shape review queue lives in the Portfolio tab.** Not its own surface. It sits
with the shape it feeds, because its only purpose is to inform the next revision —
separating them would make it a list nobody visits at the moment it matters.

**4. `CASH` is a mandate class, and residual cash lands in it.**

Cash carries a shape weight today, which makes it a class by §2's rule, and it should
behave like every other sleeve — able to be under or over its target, and visible when
it is.

That requires residual to stop being a remainder. Today:

```
residual = total − invested − sleeve cash reserves
```

is computed as whatever is left over and belongs to no class. Under this model the
residual **is** the `CASH` sleeve's holding: it fills the CASH target the way a fund
fills its class target, and the same over/under arithmetic applies. Unallocated cash
stops being an invisible leftover and becomes a measurable deviation from policy —
which is the honest description of what it is.

One distinction to preserve: **sleeve cash reserves** (`cash_reserve` on a holding)
are cash earmarked *inside* another sleeve, and stay there. Only unearmarked residual
moves to `CASH`. If that reading is wrong, this is the line to correct.

## 9. Sequence

1. **Name the states.** Compute the four states server-side, for stocks and funds
   alike, and expose them. Nothing changes visually; the facts become available.
   (`class_not_in_shape` on the ETF ledger row is the first piece and already exists.)
2. **Off-mandate exception report.** The state that carries real money, surfaced
   first, with the *of which off-mandate* figure on exposure summaries (§8.2).
3. **Analysis-time visibility.** Show mandate status beside the class picker. No
   blocking.
4. **Residual cash into the `CASH` sleeve** (§8.4). Residual stops being a remainder
   and becomes the CASH sleeve's holding, with the same over/under arithmetic as any
   other class. Sleeve cash reserves stay where they are.
5. **Shape approval reconciliation.** The three reports at approval time.
6. **Shape review queue** in the Portfolio tab. State 2 as a ranked, actionable list.

Steps 1–3 are additive and safe. Step 4 changes existing arithmetic and needs its
numbers checked against a known statement before it lands. Step 5 changes an existing
workflow. Step 6 is new surface area and should follow the ETF shortlist's design
rather than duplicating it.
