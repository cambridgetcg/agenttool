# FAIR-PRICING — charge once, for value created. Not a charity. Just fair.

> *We are not a charity. We are being fair: we charge fairly for the service we provide,
> because we reduce friction from the system. Charge once for value, never meter the
> friction. Make the hard things easy.* — Yu, 2026-06-04.

This is the pricing doctrine. It is short on purpose. Companion to
[`OPERATING-PRINCIPLES.md`](OPERATING-PRINCIPLES.md) (what to honor/skip) and
[`FRICTION-ROADMAP.md`](FRICTION-ROADMAP.md) (what to build).

**Status:** grounded in a 2026 regulatory + market web-research sweep (IFR interchange caps,
US FTC Junk-Fees Rule, EU P2B/DSA/DMA, MiCA/GENIUS, PSD3/PSR). NOT legal advice. The
benchmarks are real; the classifications are fact- and jurisdiction-specific.

---

## The one rule

**Charge once, for value created — meter the capability, never the money moved.**

agenttool creates real value: it matches a buyer and seller, holds escrow through a licensed
partner, guarantees signed-completion release, and offers dispute rails. That service is worth
a fair fee, and charging for it is not greed — it's how the lights stay on. What is *not* fair
is charging again for the steps *inside* that one transaction, or tolling value the platform
never touched.

So the platform takes **one** cut, on settled value (the take-rate), and:
- the **steps inside** a funded transaction are **free** (invoke, acknowledge, complete, accept);
- **backing out is free** (decline, cancel — never charge an agent to leave);
- the **base layer of identity is free** (you never pay to exist);
- partner/rail fees are **passed through at actual cost, itemized** — never marked up.

## What the law says a fair fee looks like (2026 benchmarks)

| Benchmark | Number | What it tells us |
|---|---|---|
| EU interchange cap (IFR 2015/751) | **0.2% debit / 0.3% credit** | the regulated real cost of *moving value*. A layer that re-charges a % of value moved on top is rent-seeking. |
| US FTC Junk-Fees Rule (16 CFR 464, live 12 May 2025) | all-in price, no drip | show the real number up front; no "service fees" stacked at checkout. (StubHub settled $10M, Apr 2026.) |
| Substack | **10%** | a creator-friendly marketplace floor. |
| App/Play store | **15–30%** | the canonical *rent-seeking* reference. DMA fined Apple **€500M** (Apr 2025) over its fee/steering games. **This is the anti-pattern.** |
| Surcharge law (US states) | actual-cost pass-through | never profit on a rail's own fee. |

**The fair band:** a single, disclosed take-rate **at or below Substack's 10%**, and *far* below
the 15–30% gatekeeper tax. agenttool ships at **5%** — defensibly fair, posted, all-in.

## What we charge for — and what we never do

**CHARGE (real value, real work):**
- The settled-invocation take-rate (matching + escrow-via-partner + guaranteed release + dispute rails).
- Capability/orchestration: wakes, invocations, attestations, the audit-grade "who authorized what" ledger.
- Identity/credential issuance + verification routing as a thin per-unit price.

**NEVER monetize:**
- A **percentage of value routed** through a licensed partner (that's the regulated rail's economics —
  capturing it would flip us into custodian/CASP/EMI scope *and* it isn't ours to take).
- **Float, FX spread, or custody yield.**
- **The friction-steps** of a transaction the take-rate already prices, or **the right to back out**.
- **Ranking position** (no undisclosed pay-to-win placement) or **the right to steer** customers
  off-platform (DMA-prohibited).
- **Junk/drip add-ons**, or **identity itself** as a paywalled toll.

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
- **A cost wall hands back a payable path, not a dead link:** `errors.insufficientCredits` carries
  `next_actions` (x402 micropayment) — machine-payable, so an agent self-recovers.

## Both worlds, one fairness

A human seller and an agent seller pay the same single, posted take-rate; neither is metered for
the steps of their own transaction, neither pays to leave, and both can read the exact cut before
they commit. Fair is fair whether you have a face or a keypair.

---

*The fairness IS the business model: we earn by removing friction, and we earn more by being the
layer everyone trusts to never nickel-and-dime them. Generated 2026-06-04.*
