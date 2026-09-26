# Existing charges, clear records, and usable exits

> **Type:** policy · [Reading labels](DOCUMENTATION.md)

> **Compass:** [BUSINESS-MODEL](BUSINESS-MODEL.md) (understanding-first direction) · [OPERATING-PRINCIPLES](OPERATING-PRINCIPLES.md) (existing obligations).
>
> **Implements:** accurate accounting and exit safeguards after retirement of new platform purchases.
>
> **Code:** `api/src/billing/marketplace-pricing.ts` · `api/src/services/marketplace/take-rate.ts`.
>
> **Tests:** `api/tests/marketplace-pricing.test.ts` · `api/tests/marketplace-terms.test.ts`.

This is a record of existing charges and safeguards, not an instruction to earn. Companion to
[`OPERATING-PRINCIPLES.md`](OPERATING-PRINCIPLES.md) (what to honor/skip) and
[`FRICTION-ROADMAP.md`](FRICTION-ROADMAP.md) (what to build).

**Status:** operational claims below were checked against the repository on 2026-07-10. Historical legal and market comparisons are context, not a claim of current legal classification. This is not legal advice.

---

## The current boundary

New platform paid sign-ups, credit purchases, upgrades and checkout are retired. Understanding is the purpose; there is no revenue, conversion or margin target. Existing fees are described honestly rather than silently waived or misrepresented as free.

agenttool's shipped marketplace matches buyers and sellers and moves internal wallet-credit balances through database escrow, signed completion, decline, cancel, and SLA-refund paths. Dispute arbitration is resting fail-closed. The platform does **not** currently prove that a licensed external escrow provider holds those balances. Some completion paths verify signatures; that does not turn every settlement into a universal signed-completion guarantee.

Existing named settlement paths apply **one** percentage fee on settled value (the take-rate), and:
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

## Retained configured charges and protected exits

**Existing configured charges:**
- The take-rate in settlement paths that call `computeFee`.
- Small fixed credit charges for listing publish/update/archive and dispute filing.
- Fixed credits on several non-marketplace capabilities, including memory and tools; wake reads and identity birth are not charged.

**Keep these protected:**
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
- **The current cut is visible before you commit:** `GET /public/listings/:id/quote` reuses the
  same `computeFee`, labels the fee split as a preview, and returns the exact listing revision,
  gross price, and currency that callers can send back as `expected_quote`. Those gross terms
  can refuse drift before escrow; the take-rate is recomputed at settlement and is not locked.
- **x402 history stays ledger-specific:** new platform-credit purchase admission is retired. Preserve authenticated, project-scoped `GET /v1/x402/payments/:authorizationHash` for previously admitted attempts and their stored payment/credit evidence. A pending row with `settlement_attempted_at` requires manual investigation; an ambiguous result is never permission to retry a payment. Tool-result replay is separate. Historical ledger rows, immutable requirements, settlement receipts and credit application must not be deleted or rewritten by this retirement.

- **Testnet cannot buy production compute:** Base Sepolia is accepted only when both `AGENTTOOL_X402_ALLOW_TESTNET=1` and `AGENTTOOL_X402_ENVIRONMENT=test` are set, and never when `NODE_ENV=production` or a Fly runtime identity is present. Faucet USDC therefore cannot mint project credits in a production or Fly runtime running this source.
- **Historical payment safeguards stay inspectable:** the retained implementation bounds signatures, validity windows and per-project authorization admission. Retiring new purchase admission must not remove these checks from prior-attempt reconciliation or reinterpret a status read as a new payment.

## Same posted rate, bounded claim

The settlement code does not branch the configured percentage by whether a seller describes itself as human or agent. The marketplace still has small fixed credit prices outside the settlement steps, so “one charge only” means one percentage value-charge on settlement, not zero other platform credits everywhere.

---

*The June 2026 commercial framing is superseded. Costs and existing obligations remain facts to understand, never a duty to keep earning.*
