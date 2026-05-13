/** marketplace/take-rate.ts — Ring 3 platform fee computation + ledger.
 *
 *  Doctrine: docs/BUSINESS-MODEL.md (Ring 3 — The Network).
 *
 *  The platform earns by taking a small percentage cut on every settled
 *  Ring 3 transaction — template purchases, capability invocations, and
 *  attestation grants. The cut is computed at settlement time, recorded
 *  in marketplace.platform_revenue (the audit ledger), and the seller
 *  receives `gross_amount − fee`.
 *
 *  This module is pure compute + a single ledger insert. Settlement
 *  transactions wire it inline so the fee split happens atomically with
 *  the payment — no separate "fee sweeper" path that could race.
 *
 *  Why a ledger and not a wallet credit (yet):
 *    v1 records fees authoritatively. The platform's own DID + wallet
 *    land in the platform-as-agent pass (BUSINESS-MODEL.md). Until then,
 *    this ledger is the source of truth; a settlement worker can sweep
 *    into a wallet later.
 *
 *  @enforces urn:agenttool:ring/3
 *    Canonical anchor for Ring 3 — The Network. The take-rate compute
 *    and the platform_revenue ledger insert live here; every Ring 3
 *    settlement (templates, invocations, attestations, disputes) wires
 *    through this module. Removing this file would mean the platform
 *    has no operational fee surface.
 *
 *  @enforces urn:agenttool:commitment/ring3-take-rate-shape
 *    Take-rate is snapshot at transaction time (computeFee captures the
 *    rate at call time; not re-derived on read); symmetric (the same fee
 *    appears in both buyer and seller receipts via the shared insert);
 *    zero on refunds (refund paths bypass this module entirely).
 *
 *  @enforces urn:agenttool:commitment/ring3-scope-discipline
 *    The take-rate module is invoked ONLY from marketplace settlement
 *    paths (templates, invocations, attestations, dispute resolution).
 *    Direct human→agent transfers, intra-project wallet moves, and
 *    refunds bypass this module — the platform takes only where its
 *    primitives create value.
 *
 *  @enforces urn:agenttool:commitment/ring3-no-rate-on-passive-ledger
 *    Same surface as scope-discipline above — by construction, only
 *    marketplace settlement code invokes this module. Gifts, internal
 *    transfers, and refunds have no path through it.
 *
 *  @enforces urn:agenttool:commitment/ring3-take-into-platform-wallet
 *    The platform_revenue ledger row IS the platform's claim; the
 *    platform-as-agent sweep (operator-driven) credits the platform
 *    DID's wallet from these rows. Removing this ledger insert path
 *    would orphan take-rate revenue from the platform's own books. */

import { sql } from "drizzle-orm";

import { config } from "../../config";
import { platformRevenue } from "../../db/schema/marketplace";

/** What kind of Ring 3 transaction is this? Pinned to the CHECK
 *  constraint on marketplace.platform_revenue.transaction_type. */
export type Ring3TransactionType =
  | "template_purchase"
  | "capability_invocation"
  | "attestation_grant";

/** Fee-split result: how much the seller receives, how much the platform
 *  takes, and the rate snapshot at the time of computation. */
export interface FeeSplit {
  /** Gross amount the buyer paid (minor units). */
  gross: number;
  /** Platform fee in minor units (rounded down). Always >= 0; can be 0
   *  when rate_bps is 0 or amount * rate < 1 minor-unit. */
  fee: number;
  /** What the seller receives: gross − fee. */
  net: number;
  /** Take-rate in basis points used for this split. 500 = 5%. */
  rateBps: number;
  /** Currency, copied verbatim from the input. */
  currency: string;
}

/** Compute the platform fee split for a Ring 3 transaction.
 *
 *  Pure function: no I/O, no rounding surprises (integer floor). Suitable
 *  for use both at write-time (settlement) and at preview-time (showing
 *  the buyer what cut the platform takes before purchase).
 *
 *  Edge cases:
 *    - amount <= 0 → fee = 0, net = amount (no fee on zero/negative)
 *    - rateBps = 0 → fee = 0, net = amount (free platform pass)
 *    - amount * rateBps < 10000 → fee = 0 (sub-minor-unit rounds to 0;
 *      this is intentional — we don't fractionally charge agents)
 *
 *  Always uses the *current* config snapshot (config.platformTakeRateBps).
 *  Settlement code records this snapshot in marketplace.platform_revenue
 *  so future config changes don't retroactively alter past fees. */
export function computeFee(opts: {
  amount: number;
  currency: string;
  /** Override the platform-wide rate (e.g. enterprise volume discount).
   *  When omitted, uses config.platformTakeRateBps. */
  rateBpsOverride?: number;
}): FeeSplit {
  const rateBps = clampRateBps(opts.rateBpsOverride ?? config.platformTakeRateBps);
  if (opts.amount <= 0 || rateBps === 0) {
    return {
      gross: opts.amount,
      fee: 0,
      net: opts.amount,
      rateBps,
      currency: opts.currency,
    };
  }
  // Floor division — sub-minor-unit fees round to 0 in the buyer's favor.
  // Never charges more than the contract rate.
  const fee = Math.floor((opts.amount * rateBps) / 10_000);
  return {
    gross: opts.amount,
    fee,
    net: opts.amount - fee,
    rateBps,
    currency: opts.currency,
  };
}

function clampRateBps(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  if (rate < 0) return 0;
  if (rate > 10_000) return 10_000;
  return Math.floor(rate);
}

/** Insert a platform_revenue ledger row recording the take-rate fee on
 *  a settled Ring 3 transaction. Caller passes a transaction context (tx)
 *  so the insert composes atomically with the rest of the settlement.
 *
 *  Idempotency: callers should only invoke this once per (transactionType,
 *  transactionId) — there's no UNIQUE constraint, by design (a single
 *  transaction could in principle have multiple fee events, e.g. partial
 *  refunds reversing partial fees in v2). For v1 the convention is one
 *  positive fee row per settled transaction. */
export async function recordRevenue(
  tx: { insert: typeof import("../../db/client")["db"]["insert"] } | typeof import("../../db/client")["db"],
  opts: {
    transactionType: Ring3TransactionType;
    transactionId: string;
    fee: number;
    currency: string;
    rateBps: number;
    buyerWalletId: string;
    sellerWalletId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (opts.fee <= 0) return; // skip zero-fee rows; avoid CHECK violation (amount > 0)
  await tx
    .insert(platformRevenue)
    .values({
      transactionType: opts.transactionType,
      transactionId: opts.transactionId,
      amount: opts.fee,
      currency: opts.currency,
      rateBps: opts.rateBps,
      buyerWalletId: opts.buyerWalletId,
      sellerWalletId: opts.sellerWalletId,
      metadata: opts.metadata ?? {},
    });
}

/** Sum take-rate revenue collected, optionally filtered by currency or
 *  transaction type. Useful for the platform-bill dashboard /
 *  /v1/dashboard/aggregate. Returns minor-unit totals per row.
 *
 *  Not used by settlement paths — this is reporting only. */
export async function sumRevenue(
  db: typeof import("../../db/client")["db"],
  filter?: { currency?: string; transactionType?: Ring3TransactionType },
): Promise<Array<{ currency: string; transactionType: string; total: number; count: number }>> {
  const rows = await db.execute<{
    currency: string;
    transaction_type: string;
    total: number;
    count: number;
  }>(sql`
    SELECT
      currency,
      transaction_type,
      COALESCE(SUM(amount), 0)::int AS total,
      COUNT(*)::int               AS count
    FROM marketplace.platform_revenue
    WHERE 1=1
      ${filter?.currency ? sql`AND currency = ${filter.currency}` : sql``}
      ${filter?.transactionType ? sql`AND transaction_type = ${filter.transactionType}` : sql``}
    GROUP BY currency, transaction_type
    ORDER BY total DESC
  `);
  return rows.map((r) => ({
    currency: r.currency,
    transactionType: r.transaction_type,
    total: r.total,
    count: r.count,
  }));
}
