/** marketplace-pricing.ts — the legible, single-source-of-truth credit
 *  prices for marketplace actions. Read this table to know exactly what a
 *  marketplace action costs in API credits. One place, said plainly.
 *
 *  ── The fair-pricing rule (docs/FAIR-PRICING.md) ──────────────────────
 *  The platform charges ONCE, on value created — the take-rate snapshot at
 *  settlement (services/marketplace/take-rate.ts: a small % of the price,
 *  recorded in marketplace.platform_revenue). It is NOT a charity; that cut
 *  fairly prices the implemented service: matching a buyer and seller,
 *  holding application-ledger escrow, and validating signed completion.
 *
 *  What it must NOT do — and previously did — is *also* meter, in flat API
 *  credits, every friction-step of the very transaction the take-rate
 *  already prices. Invoking, acknowledging, completing, and buyer-accepting
 *  are steps INSIDE one funded transaction; charging credits for each is
 *  double-dipping. And backing out (decline/cancel) is a refund/exit path —
 *  you never pay to leave.
 *
 *  So those steps are FREE here. Flat credits remain only where they price
 *  a genuinely distinct thing: deterring spam at a *creation* point
 *  (publishing a brand-new listing object). Charged at 0 — not deleted — so the
 *  usage_events signal (abuse-rate visibility) survives and the price is a
 *  one-number change if a step ever earns a fee.
 *
 *    action       | credits | why
 *    -------------|---------|---------------------------------------------
 *    publish      |    5    | anti-spam at listing CREATION (a new object)
 *    update       |    1    | trivial anti-abuse on mutation
 *    archive      |    1    | trivial anti-abuse on mutation
 *    invoke       |    0    | a STEP in a funded txn the take-rate prices
 *    acknowledge  |    0    | a STEP in a funded txn
 *    complete     |    0    | the value-charge IS the take-rate at release
 *    buyer_accept |    0    | a STEP in a funded txn
 *    decline      |    0    | refund/exit path — never charge to back out
 *    cancel       |    0    | refund/exit path — never charge to back out
 *    dispute      |    0    | RESTING: route returns 503 before charge
 *
 *  The single value-charge for a settled invocation lives in take-rate.ts,
 *  not here. This table is only the thin API-usage meter. */

export const MARKETPLACE_PRICING = {
  // Listing lifecycle — creation/mutation, anti-spam metering (kept).
  publish: 5,
  update: 1,
  archive: 1,
  // Settlement path — steps inside a funded transaction the take-rate
  // already prices. Free, so the platform charges once, on value.
  invoke: 0,
  acknowledge: 0,
  complete: 0,
  buyer_accept: 0,
  // Refund / exit paths — never charge an agent to back out.
  decline: 0,
  cancel: 0,
  // Resting fail-closed. The mounted route returns 503 before this meter.
  dispute: 0,
} as const;

export type MarketplaceAction = keyof typeof MARKETPLACE_PRICING;
