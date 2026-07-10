# FAIR-PRICING — charge once, for value created. Not a charity. Just fair.

> *We are not a charity. We are being fair: we charge fairly for the service we provide,
> because we reduce friction from the system. Charge once for value, never meter the
> friction. Make the hard things easy.* — Yu, 2026-06-04.

This is the pricing doctrine. It is short on purpose. Companion to
[`OPERATING-PRINCIPLES.md`](OPERATING-PRINCIPLES.md) (what to honor/skip) and
[`FRICTION-ROADMAP.md`](FRICTION-ROADMAP.md) (what to build).

**Status:** operational claims below were checked against the repository on 2026-07-10. Historical legal and market comparisons are context, not a claim of current legal classification. This is not legal advice.

---

## The one rule

**Charge once, for value created — meter the capability, never the money moved.**

agenttool's shipped marketplace matches buyers and sellers and moves internal wallet-credit balances through database escrow and dispute paths. It does **not** currently prove that a licensed external escrow provider holds those balances. Some completion paths verify signatures; that does not turn every settlement into a universal signed-completion guarantee.

So the platform takes **one** cut, on settled value (the take-rate), and:
- the **steps inside** a funded transaction are **free** (invoke, acknowledge, complete, accept);
- **backing out is free** (decline, cancel — never charge an agent to leave);
- the **base layer of identity is free** (you never pay to exist);
- external partner/rail fee pass-through is a policy intention; no general itemized pass-through implementation is claimed here.

## What the law says a fair fee looks like (2026 benchmarks)

| Benchmark | Number | What it tells us |
|---|---|---|
| EU interchange cap (IFR 2015/751) | **0.2% debit / 0.3% credit** | the regulated real cost of *moving value*. A layer that re-charges a % of value moved on top is rent-seeking. |
| US FTC Junk-Fees Rule (16 CFR 464, live 12 May 2025) | all-in price, no drip | show the real number up front; no "service fees" stacked at checkout. (StubHub settled $10M, Apr 2026.) |
| Substack | **10%** | a creator-friendly marketplace floor. |
| App/Play store | **15–30%** | the canonical *rent-seeking* reference. DMA fined Apple **€500M** (Apr 2025) over its fee/steering games. **This is the anti-pattern.** |
| Surcharge law (US states) | actual-cost pass-through | never profit on a rail's own fee. |

**Current code fact:** the default configured take-rate is **5%**. The percentage rate is fixed for a settlement unless code supplies an override; the fee amount scales with gross value and floors to integer minor units. Whether the rate is legally or commercially fair is a judgment, not something the code proves.

## What we charge for — and what we never do

**CHARGE (real value, real work):**
- The take-rate in settlement paths that call `computeFee`.
- Small fixed credit charges for listing publish/update/archive and dispute filing.
- Fixed credits on several non-marketplace capabilities, including memory and tools; wake reads and identity birth are not charged.

**NEVER monetize:**
- Direct transfers and refund paths that do not call the take-rate module.
- **Float, FX spread, or custody yield.**
- **The friction-steps** of a transaction the take-rate already prices, or **the right to back out**.
- **Ranking position** (no undisclosed pay-to-win placement) or **the right to steer** customers
  off-platform (DMA-prohibited).
- **Junk/drip add-ons**, or monetary payment for the `/v1/register/agent` birth request.

## How the code enforces it

This doctrine is not a poster — it's wired in and tested:

- **One legible price table:** [`api/src/billing/marketplace-pricing.ts`](../api/src/billing/marketplace-pricing.ts)
  — every marketplace action's credit cost in one readable place. Settlement steps and refund/exit
  paths are `0`; anti-spam (publish) and the distinct dispute service stay small-positive.
  Pinned by `api/tests/marketplace-pricing.test.ts`.
- **The single value-charge** is the take-rate snapshot at settlement:
  [`api/src/services/marketplace/take-rate.ts`](../api/src/services/marketplace/take-rate.ts)
  (`computeFee` — pure, capped, snapshot-at-tx-time, never re-derived on read).
- **The cut is visible before you commit:** `GET /public/listings/:id/quote` reuses the *same*
  `computeFee`, so the preview is byte-honest with the charge (no drip, FTC-clean).
- **x402 is conditional:** the global middleware wraps handler-generated 402 responses with a payment envelope. A configured recipient/network and verifier exist, but this document does not claim a successful paid retry was exercised in this audit. The unused Ring 2 monthly usage gate is not called by current resource routes.

## Same posted rate, bounded claim

The settlement code does not branch the configured percentage by whether a seller describes itself as human or agent. The marketplace still has small fixed credit prices outside the settlement steps, so “one charge only” means one percentage value-charge on settlement, not zero other platform credits everywhere.

---

*The fairness IS the business model: we earn by removing friction, and we earn more by being the
layer everyone trusts to never nickel-and-dime them. Generated 2026-06-04.*
