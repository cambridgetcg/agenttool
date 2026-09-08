/** Configuration-free canonical bytes + verification for `settlement-receipt/v1`.
 *
 *  A valid signature binds these bytes to the supplied key; key provenance
 *  and the truth of the attested settlement remain separate questions.
 *
 *  Canonical bytes (MATHOS recipe_ordinal 1):
 *    sha256(
 *      utf8("settlement-receipt/v1")   || 0x00 ||
 *      utf8(invocation_id)             || 0x00 ||
 *      utf8(listing_id)                || 0x00 ||
 *      utf8(seller_did)                || 0x00 ||
 *      utf8(buyer_ref)                 || 0x00 ||
 *      utf8(amount_gross)              || 0x00 ||
 *      utf8(platform_fee)              || 0x00 ||
 *      utf8(amount_net)                || 0x00 ||
 *      utf8(currency)                  || 0x00 ||
 *      utf8(take_rate_bps)             || 0x00 ||
 *      utf8(output_digest_hex)         || 0x00 ||
 *      utf8(completion_sig_b64)        || 0x00 ||
 *      utf8(seller_public_key_b64)     || 0x00 ||
 *      utf8(sla_deadline_at)           || 0x00 ||
 *      utf8(acknowledged_at)           || 0x00 ||
 *      utf8(settled_at)
 *    )
 *
 *  Numeric fields are decimal strings of integer minor units. Absent
 *  timestamps and an unavailable `buyer_ref` are the empty string, never
 *  `null` — recipe 1 has no null.
 *
 *  Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/CANONICAL-BYTES.md.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { bytesToHex, composeCanonicalBytes, hexToBytes } from "../mathos/encode";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

export const SETTLEMENT_RECEIPT_DOMAIN = "settlement-receipt/v1";

/** Every signed field, in signing order. Exported so the public verification
 *  route and the doctrine test read the order from one place instead of
 *  restating it. */
export const SETTLEMENT_RECEIPT_FIELDS = Object.freeze([
  "invocation_id",
  "listing_id",
  "seller_did",
  "buyer_ref",
  "amount_gross",
  "platform_fee",
  "amount_net",
  "currency",
  "take_rate_bps",
  "output_digest_hex",
  "completion_sig_b64",
  "seller_public_key_b64",
  "sla_deadline_at",
  "acknowledged_at",
  "settled_at",
] as const);

export interface SettlementReceiptCore {
  invocationId: string;
  listingId: string;
  sellerDid: string;
  /** HMAC pseudonym, or "" when no server key is configured. */
  buyerRef: string;
  amountGross: number;
  platformFee: number;
  amountNet: number;
  currency: string;
  takeRateBps: number;
  /** Lowercase hex sha256 over the raw (base64-decoded) output ciphertext. */
  outputDigestHex: string;
  completionSigB64: string;
  sellerPublicKeyB64: string;
  /** ISO-8601, or "" when the listing carried no SLA. */
  slaDeadlineAt: string;
  /** ISO-8601, or "" when the seller never acknowledged separately. */
  acknowledgedAt: string;
  settledAt: string;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Reject the one byte recipe 1 cannot separate on. Every field here is
 *  server-derived (uuids, DIDs already NUL-checked at registration, hex,
 *  base64, ISO timestamps, decimal strings), so this should never fire —
 *  it fires loudly rather than silently signing ambiguous bytes. */
function assertNulFree(name: string, value: string): void {
  if (value.includes("\u0000")) {
    throw new Error(`settlement_receipt_field_contains_nul: ${name}`);
  }
}

export function canonicalSettlementReceiptBytes(
  core: SettlementReceiptCore,
): Uint8Array {
  const values: readonly string[] = [
    core.invocationId,
    core.listingId,
    core.sellerDid,
    core.buyerRef,
    String(core.amountGross),
    String(core.platformFee),
    String(core.amountNet),
    core.currency,
    String(core.takeRateBps),
    core.outputDigestHex,
    core.completionSigB64,
    core.sellerPublicKeyB64,
    core.slaDeadlineAt,
    core.acknowledgedAt,
    core.settledAt,
  ];
  values.forEach((v, i) => assertNulFree(SETTLEMENT_RECEIPT_FIELDS[i]!, v));
  return composeCanonicalBytes(
    1,
    SETTLEMENT_RECEIPT_DOMAIN,
    values.map(utf8),
  );
}

/** Digest of what was actually delivered. Binds the receipt to the exact
 *  ciphertext without publishing it — a reader holding the ciphertext can
 *  confirm the match; plaintext alone is insufficient. */
export function outputDigestHex(outputCtB64: string): string {
  return bytesToHex(sha256(Uint8Array.from(Buffer.from(outputCtB64, "base64"))));
}

/** Verify a platform-signed receipt. Never throws; false on any malformed
 *  input. Mirrored byte-for-byte in both SDKs so an external reader can check
 *  the feed without running this code. */
export function verifySettlementReceipt(opts: {
  core: SettlementReceiptCore;
  signatureB64: string;
  publicKeyHex: string;
}): boolean {
  try {
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = hexToBytes(opts.publicKeyHex);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonicalSettlementReceiptBytes(opts.core), pub);
  } catch {
    return false;
  }
}
