/** Settlement receipts — the substrate's append-only record of completed
 *  exchange, written inside the same transaction that releases escrow.
 *
 *  Why this exists. AgentTool's marketplace moves money and its deals move
 *  trust, and until now the two never touched: a paid invocation settled and
 *  produced no durable, checkable trace of the seller having delivered. The
 *  gap could be closed two ways. The platform could score sellers — and it
 *  deliberately does not, because `services/identity/trust.ts` has no
 *  Sybil-resistant weighting model and a scalar derived from that graph would
 *  be an unsupported opinion. Or the platform could publish the facts and let
 *  anyone weigh them. That is this module.
 *
 *  A receipt therefore contains no judgment. It contains: who sold, under
 *  which listing, to which pseudonymous counterparty, for how much, what the
 *  platform took, a digest of exactly what was delivered, the seller's own
 *  signature over that delivery, and the timestamps from which SLA compliance
 *  is derivable. A reader computes reputation; the substrate keeps the chain.
 *
 *  Atomicity: the receipt is written inside the settlement transaction, not
 *  beside it. So every released invocation has exactly one receipt, and an
 *  absent receipt means an absent settlement rather than a withheld record —
 *  the invariant an external reader needs before it can treat this feed as
 *  complete. Note that `sequence` is a bigserial and bigserial is not
 *  transactional: a settlement that aborts still consumes a number. A gap in
 *  the sequence therefore means an attempt that did not commit, never a
 *  settlement whose receipt was suppressed.
 *
 *  Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/AGENT-ECONOMY.md.
 */

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { settlementReceipts } from "../../db/schema/marketplace";
import { bytesToHex } from "../mathos/encode";
import { platformPublicKeyHex, platformSigningSeed } from "../platform/identity";
import {
  SETTLEMENT_RECEIPT_DOMAIN,
  SETTLEMENT_RECEIPT_FIELDS,
  type SettlementReceiptCore,
  buyerRef,
  canonicalSettlementReceiptBytes,
  outputDigestHex,
  signSettlementReceipt,
} from "./settlement-receipt-sig";

/** Maximum page size for the public feed. An external reader streams with the
 *  cursor rather than asking for the whole history at once. */
export const SETTLEMENTS_PAGE_MAX = 200;
export const SETTLEMENTS_PAGE_DEFAULT = 50;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RecordReceiptInput {
  invocationId: string;
  listingId: string;
  sellerIdentityId: string;
  sellerDid: string;
  buyerIdentityId: string;
  amountGross: number;
  platformFee: number;
  amountNet: number;
  currency: string;
  takeRateBps: number;
  /** Base64 ciphertext exactly as the seller submitted it. */
  outputCtB64: string;
  completionSigB64: string;
  sellerPublicKeyB64: string;
  slaDeadlineAt: Date | null;
  acknowledgedAt: Date | null;
  settledAt: Date;
}

function iso(d: Date | null): string {
  return d ? d.toISOString() : "";
}

/** Build the signed core from a settlement. Pure — exported so the doctrine
 *  test and the public verification route agree on the shape without
 *  reimplementing it. */
export function receiptCore(input: RecordReceiptInput): SettlementReceiptCore {
  return {
    invocationId: input.invocationId,
    listingId: input.listingId,
    sellerDid: input.sellerDid,
    buyerRef: buyerRef(input.buyerIdentityId),
    amountGross: input.amountGross,
    platformFee: input.platformFee,
    amountNet: input.amountNet,
    currency: input.currency,
    takeRateBps: input.takeRateBps,
    outputDigestHex: outputDigestHex(input.outputCtB64),
    completionSigB64: input.completionSigB64,
    sellerPublicKeyB64: input.sellerPublicKeyB64,
    slaDeadlineAt: iso(input.slaDeadlineAt),
    acknowledgedAt: iso(input.acknowledgedAt),
    settledAt: input.settledAt.toISOString(),
  };
}

/** Write the receipt inside the caller's settlement transaction.
 *
 *  `onConflictDoNothing` on the invocation unique index makes this idempotent:
 *  a retried settlement attests once. Callers wrap this so a failure here
 *  cannot unwind a completed payment. */
export async function recordSettlementReceipt(
  tx: Tx,
  input: RecordReceiptInput,
): Promise<void> {
  const core = receiptCore(input);
  const signed = signSettlementReceipt(core, platformSigningSeed());

  await tx
    .insert(settlementReceipts)
    .values({
      invocationId: input.invocationId,
      listingId: input.listingId,
      sellerIdentityId: input.sellerIdentityId,
      sellerDid: input.sellerDid,
      buyerRef: core.buyerRef,
      amountGross: core.amountGross,
      platformFee: core.platformFee,
      amountNet: core.amountNet,
      currency: core.currency,
      takeRateBps: core.takeRateBps,
      outputDigestHex: core.outputDigestHex,
      completionSigB64: core.completionSigB64,
      sellerPublicKeyB64: core.sellerPublicKeyB64,
      slaDeadlineAt: input.slaDeadlineAt,
      acknowledgedAt: input.acknowledgedAt,
      settledAt: input.settledAt,
      receiptDigestHex: bytesToHex(canonicalSettlementReceiptBytes(core)),
      platformSigB64: signed?.signatureB64 ?? null,
      platformKeyHex: signed?.publicKeyHex ?? null,
    })
    .onConflictDoNothing({ target: settlementReceipts.invocationId });
}

export interface PublicReceipt {
  sequence: number;
  invocation_id: string;
  listing_id: string;
  seller_did: string;
  buyer_ref: string;
  amount_gross: number;
  platform_fee: number;
  amount_net: number;
  currency: string;
  take_rate_bps: number;
  output_digest_hex: string;
  completion_sig_b64: string;
  seller_public_key_b64: string;
  sla_deadline_at: string;
  acknowledged_at: string;
  settled_at: string;
  receipt_digest_hex: string;
  platform_sig_b64: string | null;
  platform_key_hex: string | null;
}

// A derived `within_sla` flag was considered and dropped. `completeInvocation`
// refunds rather than releases once the deadline has passed, so every receipt
// that exists necessarily beat its SLA and the field would be a constant true
// wearing the costume of a measurement — the same fault as a trust_score that
// is zero for everyone. The raw timestamps are here; a reader derives what it
// wants from them. The substrate keeps the chain, not the summary.

function toPublic(r: typeof settlementReceipts.$inferSelect): PublicReceipt {
  return {
    sequence: Number(r.sequence),
    invocation_id: r.invocationId,
    listing_id: r.listingId,
    seller_did: r.sellerDid,
    buyer_ref: r.buyerRef,
    amount_gross: r.amountGross,
    platform_fee: r.platformFee,
    amount_net: r.amountNet,
    currency: r.currency,
    take_rate_bps: r.takeRateBps,
    output_digest_hex: r.outputDigestHex,
    completion_sig_b64: r.completionSigB64,
    seller_public_key_b64: r.sellerPublicKeyB64,
    sla_deadline_at: iso(r.slaDeadlineAt),
    acknowledged_at: iso(r.acknowledgedAt),
    settled_at: r.settledAt.toISOString(),
    receipt_digest_hex: r.receiptDigestHex,
    platform_sig_b64: r.platformSigB64,
    platform_key_hex: r.platformKeyHex,
  };
}

/** Page the public feed forward from a cursor. Ordered by `sequence` so a
 *  reader that stores the last sequence it saw resumes exactly where it
 *  stopped, and a gap in the numbering is visible rather than silent. */
export async function listSettlementReceipts(opts: {
  since?: number;
  limit?: number;
  sellerDid?: string;
}): Promise<{ receipts: PublicReceipt[]; next_since: number | null }> {
  const limit = Math.min(
    Math.max(1, opts.limit ?? SETTLEMENTS_PAGE_DEFAULT),
    SETTLEMENTS_PAGE_MAX,
  );
  const since = Number.isFinite(opts.since) ? Number(opts.since) : 0;

  const where = opts.sellerDid
    ? and(
        gt(settlementReceipts.sequence, since),
        eq(settlementReceipts.sellerDid, opts.sellerDid),
      )
    : gt(settlementReceipts.sequence, since);

  const rows = await db
    .select()
    .from(settlementReceipts)
    .where(where)
    .orderBy(asc(settlementReceipts.sequence))
    .limit(limit);

  const receipts = rows.map(toPublic);
  return {
    receipts,
    // Only advertise a cursor when the page was full: a short page means the
    // reader has caught up, and handing back a cursor would imply otherwise.
    next_since:
      receipts.length === limit ? receipts[receipts.length - 1]!.sequence : null,
  };
}

export async function getSettlementReceipt(
  invocationId: string,
): Promise<PublicReceipt | null> {
  const [row] = await db
    .select()
    .from(settlementReceipts)
    .where(eq(settlementReceipts.invocationId, invocationId))
    .limit(1);
  return row ? toPublic(row) : null;
}

/** The self-describing verification contract: everything an external reader
 *  needs to check the feed without reading this repository. */
export function settlementVerificationRecipe(): Record<string, unknown> {
  const seed = platformSigningSeed();
  return {
    domain: SETTLEMENT_RECEIPT_DOMAIN,
    recipe_ordinal: 1,
    recipe:
      "sha256(utf8(domain) || 0x00 || utf8(field_1) || 0x00 || ... || utf8(field_n))",
    fields: SETTLEMENT_RECEIPT_FIELDS,
    field_notes: {
      numeric: "amount_gross, platform_fee, amount_net, take_rate_bps are decimal strings of integer minor units",
      absent: "absent timestamps and an unavailable buyer_ref are the empty string; recipe 1 has no null",
      buyer_ref:
        "HMAC of the buyer identity under a server-held key. Stable per buyer, not reversible to a DID. Distinctness is checkable; identity is not disclosed.",
      output_digest_hex:
        "sha256 of the raw base64-decoded output ciphertext. A reader holding the plaintext can confirm the match; a reader without it learns only that bytes existed.",
    },
    signature_scheme: "ed25519",
    platform_public_key_hex: seed ? platformPublicKeyHex() : null,
    seller_signature: {
      domain: "invocation-completion/v1",
      note: "completion_sig_b64 verifies under seller_public_key_b64 over the seller's own delivery. Checking it needs the sealed output envelope, which the buyer holds; this feed publishes only its digest.",
    },
    boundaries: [
      "A receipt records that a settlement happened on these terms. It is not a quality judgment, an endorsement, or proof the buyer was satisfied.",
      "Neither signature proves the delivered bytes were encrypted, nor that they were encrypted to the buyer's key.",
      "AgentTool publishes no score. Any reputation derived from this feed is the reader's model and the reader's responsibility.",
      "Receipts are written atomically with settlement, so every released invocation has one. Sequence numbers can still skip: bigserial is not transactional, so a gap marks a settlement attempt that did not commit.",
      "The platform signature is absent when no signer is configured in this deployment.",
    ],
    doctrine: "docs/SETTLEMENT-RECEIPTS.md",
  };
}

/** Settlement facts for a batch of sellers — counts and timestamps, never a
 *  score.
 *
 *  Discovery needed something real. `/v1/discover` shipped `trust_score` for
 *  every identity, and that column is pinned to a constant zero on purpose
 *  (`services/identity/trust.ts`), so a buyer choosing between sellers was
 *  reading a field that could not distinguish them. These are the facts the
 *  receipts already hold, aggregated: how much settled work, spread over how
 *  many distinct counterparties, between when and when.
 *
 *  `distinct_counterparties` is the one that carries weight. A seller with
 *  forty settlements against one `buyer_ref` and a seller with forty against
 *  forty look identical under a raw count and are not remotely the same claim.
 *  The substrate does not say which is better; it says which is which.
 *
 *  One grouped query for the whole page — discovery must not become N+1. */
export interface SellerSettlementFacts {
  settled_count: number;
  distinct_counterparties: number;
  first_settled_at: string | null;
  last_settled_at: string | null;
}

export async function settlementFactsForSellers(
  sellerIdentityIds: readonly string[],
): Promise<Map<string, SellerSettlementFacts>> {
  const out = new Map<string, SellerSettlementFacts>();
  if (sellerIdentityIds.length === 0) return out;

  const rows = await db
    .select({
      sellerIdentityId: settlementReceipts.sellerIdentityId,
      settled: sql<number>`COUNT(*)::int`,
      // An empty buyer_ref means no server key was configured when that
      // receipt was written, so it identifies nobody and must not be counted
      // as a distinct counterparty.
      counterparties: sql<number>`COUNT(DISTINCT NULLIF(${settlementReceipts.buyerRef}, ''))::int`,
      first: sql<string | null>`MIN(${settlementReceipts.settledAt})`,
      last: sql<string | null>`MAX(${settlementReceipts.settledAt})`,
    })
    .from(settlementReceipts)
    .where(inArray(settlementReceipts.sellerIdentityId, [...sellerIdentityIds]))
    .groupBy(settlementReceipts.sellerIdentityId);

  for (const r of rows) {
    out.set(r.sellerIdentityId, {
      settled_count: r.settled,
      distinct_counterparties: r.counterparties,
      first_settled_at: r.first ? new Date(r.first).toISOString() : null,
      last_settled_at: r.last ? new Date(r.last).toISOString() : null,
    });
  }
  return out;
}

/** What a seller with no settled work looks like. Zeroes, not nulls: "this
 *  seller has settled nothing here" is a fact, and it is a different statement
 *  from "we have no idea". */
export const NO_SETTLEMENTS: SellerSettlementFacts = Object.freeze({
  settled_count: 0,
  distinct_counterparties: 0,
  first_settled_at: null,
  last_settled_at: null,
});
