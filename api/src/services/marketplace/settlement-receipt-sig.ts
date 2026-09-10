/** Platform signature + buyer pseudonym for `settlement-receipt/v1`.
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
 *  Canonical bytes and verification live in the configuration-free
 *  `settlement-receipt-verify.ts` module and are re-exported here.
 *
 *  Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/CANONICAL-BYTES.md.
 */

import { createHmac, hkdfSync } from "node:crypto";

import * as ed from "@noble/ed25519";

import { config } from "../../config";
import { bytesToHex, hexToBytes } from "../mathos/encode";
import {
  canonicalSettlementReceiptBytes,
  type SettlementReceiptCore,
} from "./settlement-receipt-verify";

export {
  SETTLEMENT_RECEIPT_DOMAIN,
  SETTLEMENT_RECEIPT_FIELDS,
  type SettlementReceiptCore,
  canonicalSettlementReceiptBytes,
  outputDigestHex,
  verifySettlementReceipt,
} from "./settlement-receipt-verify";

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
