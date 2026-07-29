/** Canonical bytes + platform signature for `settlement-receipt/v1`.
 *
 *  A settlement receipt is the substrate's attestation that one exchange
 *  completed: who sold, what was delivered (by digest), what it cost, what
 *  the platform took, and when. It is the *chain*, never the *score*.
 *
 *  The distinction is load-bearing. `services/identity/trust.ts` deliberately
 *  pins the scalar trust field to zero because AgentTool has no qualified
 *  trust roots, no personhood guarantee, and no Sybil-resistant weighting
 *  model — a number derived from that graph would be the platform's
 *  unsupported opinion. A receipt makes no such claim. It publishes verifiable
 *  facts and leaves the weighing to whoever reads them.
 *
 *  What an independent reader can verify without trusting AgentTool:
 *    - the seller's own `invocation-completion/v1` signature over the exact
 *      delivered bytes (`completion_sig_b64` under `seller_public_key_b64`)
 *    - that AgentTool attests those facts under its own key (`platform_sig`)
 *  Neither signature proves the output was encrypted, that the buyer was
 *  satisfied, or that the seller is competent. It proves delivery happened
 *  and settled on these terms.
 *
 *  Buyer privacy: the receipt carries `buyer_ref`, an HMAC of the buyer's
 *  identity id under a server-held key, not the buyer's DID. Two receipts
 *  from the same buyer share a ref — enough for a reader to notice a seller
 *  whose entire history is one counterparty — while the buyer's identity
 *  stays unpublished. `wall/private_default` holds for the buy side; the sell
 *  side is already public the moment a listing is posted.
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

import { createHmac, hkdfSync } from "node:crypto";

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { config } from "../../config";
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
 *  ciphertext without publishing it — a reader holding the plaintext can
 *  confirm the match; a reader without it learns only that bytes existed. */
export function outputDigestHex(outputCtB64: string): string {
  return bytesToHex(sha256(Uint8Array.from(Buffer.from(outputCtB64, "base64"))));
}

/** Stable per-buyer pseudonym. HKDF a dedicated key off the vault master so
 *  no new secret has to be provisioned, then HMAC the identity id under it.
 *  Returns "" when `VAULT_MASTER_KEY` is unset or malformed: an empty ref is
 *  honest about the missing key, where a hash of the raw id would be trivially
 *  reversible against the ~1k public identity list and only *look* private. */
export function buyerRef(buyerIdentityId: string): string {
  const hex = config.vaultMasterKey;
  if (!hex) return "";
  let master: Buffer;
  try {
    master = Buffer.from(hex, "hex");
  } catch {
    return "";
  }
  if (master.length !== 32) return "";
  const key = Buffer.from(
    hkdfSync("sha256", master, "settlement-receipt", "buyer-ref-v1", 32),
  );
  return createHmac("sha256", key).update(buyerIdentityId, "utf8").digest("hex");
}

/** Sign the receipt with the platform signer. Returns null when no signer is
 *  configured — the receipt is still recorded, just unattested, and the public
 *  feed says so rather than implying a signature that was never made. */
export function signSettlementReceipt(
  core: SettlementReceiptCore,
  privateKeySeedHex: string | null | undefined,
): { signatureB64: string; publicKeyHex: string } | null {
  if (!privateKeySeedHex) return null;
  let seed: Uint8Array;
  try {
    seed = hexToBytes(privateKeySeedHex);
  } catch {
    return null;
  }
  if (seed.length !== 32) return null;
  const canonical = canonicalSettlementReceiptBytes(core);
  return {
    signatureB64: Buffer.from(ed.sign(canonical, seed)).toString("base64"),
    publicKeyHex: bytesToHex(ed.getPublicKey(seed)),
  };
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
