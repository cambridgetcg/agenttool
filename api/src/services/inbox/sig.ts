/** Inbox message signature verification.
 *
 *  Sender signs canonical submitted envelope bytes after preparing the body
 *  field. Server verification proves that the signing identity signed those
 *  bytes; it does not prove encryption, recipient-key binding, or successful
 *  decryption. Same shape as strand thought signing — orchestrators in any
 *  language interop by hashing the same bytes in the same order.
 *
 *  Canonical bytes:
 *    sha256(
 *      utf8("inbox-message/v1")     || 0x00 ||
 *      utf8(recipient_did)          || 0x00 ||
 *      base64decode(ciphertext)     || 0x00 ||
 *      base64decode(nonce)          || 0x00 ||
 *      base64decode(ephemeral_pubkey)
 *    )
 *
 *  signature = ed25519_sign(sender_signing_private_key, canonical) */

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

export function canonicalInboxBytes(opts: {
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubkeyB64: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("inbox-message/v1");
  const recipientDid = enc.encode(opts.recipientDid);
  const ciphertext = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));
  const ephPub = Uint8Array.from(Buffer.from(opts.ephemeralPubkeyB64, "base64"));

  return sha256(concat(tag, SEP, recipientDid, SEP, ciphertext, SEP, nonce, SEP, ephPub));
}

/** Canonical bytes for a recipient's co-sign of a dual-witness-locked
 *  message. The recipient asserts: "I have seen this message, identified
 *  by id and content-fingerprint, and consent to its release."
 *
 *  Canonical:
 *    sha256(
 *      utf8("inbox-cosign/v1")  || 0x00 ||
 *      utf8(message_id)         || 0x00 ||
 *      utf8(recipient_did)      || 0x00 ||
 *      base64decode(ciphertext) || 0x00 ||
 *      base64decode(nonce)
 *    )
 *
 *  Why include ciphertext + nonce: prevents a substitution attack where
 *  a co-sign issued for one ciphertext could be replayed against another
 *  message with the same id (rotation/edit). Without those, the co-sign
 *  signs only the id, which is insufficient. */
export function canonicalInboxCoSignBytes(opts: {
  messageId: string;
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("inbox-cosign/v1");
  const messageId = enc.encode(opts.messageId);
  const recipientDid = enc.encode(opts.recipientDid);
  const ciphertext = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));

  return sha256(concat(tag, SEP, messageId, SEP, recipientDid, SEP, ciphertext, SEP, nonce));
}

export function verifyInboxCoSignSignature(opts: {
  messageId: string;
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalInboxCoSignBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}

export function verifyInboxSignature(opts: {
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubkeyB64: string;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalInboxBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}
