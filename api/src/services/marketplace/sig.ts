/** Canonical bytes + signature verification for capability-marketplace
 *  invocation completion.
 *
 *  Seller signs the canonical bytes of the completion *before* the
 *  platform releases the escrow. Verification proves the seller authored
 *  the response — even though we cannot decrypt the ciphertext.
 *
 *  Canonical bytes:
 *    sha256(
 *      utf8("invocation-completion/v1") || 0x00 ||
 *      utf8(invocation_id)              || 0x00 ||
 *      base64decode(output_ct)          || 0x00 ||
 *      base64decode(output_nonce)       || 0x00 ||
 *      base64decode(output_sender_pub)
 *    )
 *
 *  signature = ed25519_sign(seller_signing_private_key, canonical)
 *
 *  Same shape as inbox-message/v1 and strand-thought/v1 — orchestrators
 *  in any language interop by hashing the same bytes in the same order. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface SealedBytes {
  ct: string;          // base64
  nonce: string;       // base64
  sender_pub: string;  // base64 (X25519 ephemeral pubkey)
}

export function canonicalInvocationCompletionBytes(opts: {
  invocationId: string;
  output: SealedBytes;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("invocation-completion/v1");
  const id = enc.encode(opts.invocationId);
  const ct = Uint8Array.from(Buffer.from(opts.output.ct, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.output.nonce, "base64"));
  const senderPub = Uint8Array.from(Buffer.from(opts.output.sender_pub, "base64"));

  return sha256(concat(tag, SEP, id, SEP, ct, SEP, nonce, SEP, senderPub));
}

export function verifyInvocationCompletion(opts: {
  invocationId: string;
  output: SealedBytes;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalInvocationCompletionBytes({
      invocationId: opts.invocationId,
      output: opts.output,
    });
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}

/** Validate the sealed-bytes envelope shape: ct, nonce, sender_pub all
 *  present as base64 strings of expected lengths. Throws on mismatch.
 *  We do NOT validate decryption — the platform never holds the keys. */
export function validateSealedShape(value: unknown): asserts value is SealedBytes {
  if (!value || typeof value !== "object") {
    throw new Error("sealed_bytes_required");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.ct !== "string" || v.ct.length === 0) {
    throw new Error("sealed_ct_required");
  }
  if (typeof v.nonce !== "string" || v.nonce.length === 0) {
    throw new Error("sealed_nonce_required");
  }
  if (typeof v.sender_pub !== "string" || v.sender_pub.length === 0) {
    throw new Error("sealed_sender_pub_required");
  }
  // Quick sanity: base64 decode succeeds + nonce/sender_pub are right
  // length. This catches obvious corruption without verifying crypto.
  try {
    Buffer.from(v.ct, "base64");
    const nonceLen = Buffer.from(v.nonce, "base64").length;
    const pubLen = Buffer.from(v.sender_pub, "base64").length;
    // X25519 nonce is 24 bytes (xsalsa20 / nacl box); pubkey is 32 bytes.
    if (nonceLen !== 24 && nonceLen !== 12) {
      throw new Error("sealed_nonce_invalid_length");
    }
    if (pubLen !== 32) throw new Error("sealed_sender_pub_invalid_length");
  } catch (e) {
    if ((e as Error).message.startsWith("sealed_")) throw e;
    throw new Error("sealed_bytes_not_base64");
  }
}

// ── Dispute primitive — canonical bytes (20260511) ───────────────────
// Two domain-tag schemes — first arbiter and pool voter sign different
// shapes because pool votes also bind an alternative ruling proposal.

export function canonicalDisputeFirstRulingBytes(opts: {
  disputeCaseId: string;
  ruling: "release" | "refund" | "split";
  splitPct: number | null;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("dispute-first-ruling/v1");
  const id = enc.encode(opts.disputeCaseId);
  const ruling = enc.encode(opts.ruling);
  const split = enc.encode(opts.splitPct === null ? "" : String(opts.splitPct));
  return sha256(concat(tag, SEP, id, SEP, ruling, SEP, split));
}

export function canonicalDisputePoolVoteBytes(opts: {
  disputeCaseId: string;
  vote: "uphold" | "overturn";
  alternativeRuling: "release" | "refund" | "split" | null;
  alternativeSplitPct: number | null;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("dispute-pool-vote/v1");
  const id = enc.encode(opts.disputeCaseId);
  const vote = enc.encode(opts.vote);
  const alt = enc.encode(opts.alternativeRuling ?? "");
  const split = enc.encode(opts.alternativeSplitPct === null ? "" : String(opts.alternativeSplitPct));
  return sha256(concat(tag, SEP, id, SEP, vote, SEP, alt, SEP, split));
}

export function verifyDisputeFirstRuling(opts: {
  disputeCaseId: string;
  ruling: "release" | "refund" | "split";
  splitPct: number | null;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalDisputeFirstRulingBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}

export function verifyDisputePoolVote(opts: {
  disputeCaseId: string;
  vote: "uphold" | "overturn";
  alternativeRuling: "release" | "refund" | "split" | null;
  alternativeSplitPct: number | null;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalDisputePoolVoteBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}
